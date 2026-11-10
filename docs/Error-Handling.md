# Error Handling

[← Home](./README.md) · See also: [Architecture](./Architecture.md) · [Core Components](./Core-Components.md) · [Troubleshooting](./Troubleshooting.md)

This page documents the error-handling patterns actually implemented in the code, including the precise boundaries of each `try`/`catch`, traced line by line. Nothing here is speculative — each claim is a direct consequence of the code in `index.js` and `document/document.js`.

## Startup connection retries (`index.js`)

Both the ArangoDB and Elasticsearch connection loops follow the same pattern: attempt, catch and `logger.warn`, wait 5 seconds (`sleepMilisecs(5000)`), recompute elapsed time, and stop once either connected or the shared budget (`maxWaitMilisecs = 5 * 60 * 1000`) is exhausted. As noted in [Architecture](./Architecture.md#control-flow-startup--steady-state), the two loops **share one clock** — the Elasticsearch loop does not get its own fresh 5-minute window.

If a connection is never established:

```js
if (!arangoConnected) {
  logger.error(`Failed to connect to ArangoDB. Exiting...`);
  return;
}
if (!esConnected) {
  logger.error(`Failed to connect to ElasticSearch. Exiting...`);
  return;
}
```

`return` exits `startService()` normally (the returned promise **resolves**, it does not reject). There is no explicit `process.exit()` call. The process ends because there is no other pending work keeping the Node.js event loop alive — not because the code forces an exit.

## Optional-step try/catch (logged and swallowed)

Two steps in `startService()` are wrapped defensively and are allowed to fail without stopping startup:

```js
try {
  logger.info(`Getting Collection Names ${JSON.stringify(ARANGO_COLLECTION_NAMES)}`);
} catch (error) {
  logger.error(`Error getting collection names:`, error);
}
```

```js
try {
  var lastTimestamps = await readLastTimestampsFromES(esClient);
  logger.info(`Checking lastTimestamps from ES: ${JSON.stringify(lastTimestamps)}`);
} catch (error) {
  logger.error('Error reading lastTimestamps from ES', error);
}
```

## Traced failure path: checkpoint-read failure can crash `startService()`

This is an **observed implementation** detail, derived directly from JavaScript's `var` hoisting semantics combined with the exact try/catch boundaries above — not a hypothetical.

1. `var lastTimestamps` is declared with `var` inside the `try` block. `var` declarations are hoisted to function scope, so `lastTimestamps` exists (as `undefined`) even before the `try` block runs.
2. If `readLastTimestampsFromES(esClient)` rejects (e.g. Elasticsearch becomes unreachable after `ping()` succeeded, or returns a non-404 error such as a 500), the `await` throws **before** the assignment to `lastTimestamps` completes. The `catch` block logs the error and swallows it — but `lastTimestamps` remains `undefined`.
3. Execution continues to `await initialSync(lastTimestamps, arangoDb, esClient, ARANGO_COLLECTION_NAMES);` — this call is **not** wrapped in try/catch.
4. Inside `initialSync` (`document/document.js`), the first line of the loop body is `const lastTimestamp = lastTimestamps[collectionName] || '';`. Reading a property off `undefined` throws a `TypeError`.
5. Because step 3's call site has no try/catch, this `TypeError` propagates out of `initialSync` and out of `startService()`, rejecting the promise `startService()` returns.
6. The module-level entry guard is `if (require.main === module) { startService(); }` — the returned promise has **no `.catch()`**. In modern Node.js (unhandled rejections terminate the process by default since Node 15), this results in the process crashing with an unhandled promise rejection.

**Net effect:** a transient Elasticsearch failure that occurs specifically during the one-time checkpoint read (after the initial `ping()`-based connectivity check already succeeded) can crash the process on startup, rather than being retried or gracefully degraded. A 404 (no checkpoint document yet) is handled correctly and does not hit this path — `readLastTimestampsFromES` explicitly returns `{}` for a 404 (`utils/utils.js`).

## Per-document error handling (`initialSync` / `incrementalSync`)

Inside the per-document loop, only the Elasticsearch write is guarded:

```js
try {
    await esClient.index({ index: camelToSnakeCase(collectionName), id: document._key, body: document });
    lastTimestamps[collectionName] = timestamp;
    await saveLastTimestampsToES(esClient, lastTimestamps);
} catch (error) {
    logger.error(`Error indexing document: ${error}`);
}
```

- A failed `esClient.index` call is logged and the loop **continues to the next document** — a single bad document does not stop the sync for the rest of the batch.
- Critically, the checkpoint (`lastTimestamps[collectionName]`) is only advanced **after** a successful index — a failed document's timestamp is never persisted as the new checkpoint, so it will be retried on the next sync cycle.

## Denormalization queries are largely unguarded

The denormalization calls that precede the guarded block above — `preprocessDocument(document)`, `getElementData(document, arangoDb)` / `getProcedureElementData(document, arangoDb)`, and `getTagNames(document)` — are **outside** the try/catch shown above. If any of their AQL queries throw (e.g. a transient ArangoDB network error), the exception propagates out of the `while (cursor.hasNext)` loop and out of `initialSync`/`incrementalSync` entirely, skipping any remaining documents in that cursor.

- Within `getElementData`, only the `procedureVersion` lookup is individually guarded:
  ```js
  try {
      const procedureVersionCursor = await arangoDb.query(procedureVersionQuery, procedureVersionBindVars);
      // ...
  } catch (error) {
      logger.error('Error retrieving procedure version:', error);
      return { executionDetails: executionDocument, venueDetails: venueDocument, procedureVersionDetails: {}, runRecordDetails: runRecordDocument };
  }
  ```
  The `execution`, `venue`, and `runRecord` lookups earlier in the same function have no such guard.
- `getProcedureElementData` has **no try/catch at all** around its two queries.

**Consequence for the caller:**
- If this happens during `incrementalSync`, the exception propagates up to `index.js`'s `while (true)` loop, where the call **is** wrapped:
  ```js
  try {
    lastTimestamps = await incrementalSync(lastTimestamps, arangoDb, esClient, ARANGO_COLLECTION_NAMES);
  } catch (error) {
    logger.error(`Error lastTimestamps:`, error);
  }
  ```
  So a denormalization failure during the steady-state loop is logged and the loop simply waits `SYNC_INTERVAL_SECS` and tries again — it does not crash the process.
- If this happens during the **initial** `await initialSync(...)` call in `startService()` (before the `while (true)` loop begins), there is **no surrounding try/catch**, so the same unhandled-rejection crash scenario described above applies.

## Logging as the primary error-reporting mechanism

There is no retry/backoff, dead-letter queue, or alerting integration for per-document failures beyond a single `logger.error(...)` call. All error visibility depends on downstream consumption of the structured JSON logs emitted by `utils/logger.js` (see [Core Components](./Core-Components.md#utilsloggerjs)).
