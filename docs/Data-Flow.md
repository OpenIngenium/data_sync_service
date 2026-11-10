# Data Flow

[← Home](./README.md) · See also: [Architecture](./Architecture.md) · [Core Components](./Core-Components.md) · [Configuration](./Configuration.md)

This page traces the exact, end-to-end behavior of the service from process start through steady-state syncing, using the real function/variable names from `index.js` and `document/document.js`.

## 1. Startup

```text
process start (node index.js)
→ startService()
→ connect to ArangoDB (retry every 5s; shared 5-min budget)
→ connect to Elasticsearch (retry every 5s; remainder of the same 5-min budget)
→ [if either failed] logger.error(...) → return (process exits naturally, no explicit process.exit)
→ log ARANGO_COLLECTION_NAMES (try/catch around JSON.stringify)
→ sleep(INIT_SYNC_DELAY_SECS)   // default 60s — lets ES apply index mappings first
→ readLastTimestampsFromES(esClient)  // GET syncdata/last_timestamps, {} if 404
→ initialSync(lastTimestamps, arangoDb, esClient, ARANGO_COLLECTION_NAMES)
→ enter incremental loop (see §3)
```

Source: `index.js`, function `startService`.

## 2. `initialSync` — bulk catch-up pass

Runs once, for each collection in `ARANGO_COLLECTION_NAMES` (`['element', 'procedureElement']`), independently:

```text
lastTimestamp = lastTimestamps[collectionName] || ''

Step A — count pending documents:
  AQL: FOR doc IN <collection>
       LET timestamp = DECODE_REV(doc._rev).date
       FILTER timestamp >= @lastTimestamp
       SORT timestamp ASC
       RETURN timestamp
  → materialize the full `timestamps` array in memory (cursor ttl 3600s, batchSize 10000)

Step B — trigger check:
  IF timestamps.length <= INIT_SYNC_TRIGGER_ELEM_COUNT (default 500000):
      → do nothing for this collection; the entire backlog is left for incrementalSync.
  ELSE:
      → proceed to chunked windowed indexing (Step C)
```

**Step C — chunked windowed indexing** (only reached when the trigger is exceeded):

```text
fromTimestamp = lastTimestamp
for i = INIT_SYNC_CHUNK_SIZE; i < timestamps.length; i += INIT_SYNC_CHUNK_SIZE:
    toTimestamp = timestamps[i]
    AQL: FOR doc IN <collection>
         LET timestamp = DECODE_REV(doc._rev).date
         FILTER timestamp >= @fromTimestamp AND timestamp <= @toTimestamp
         SORT timestamp ASC
         RETURN {doc, timestamp}
    for each {doc, timestamp} in cursor:
        preprocessDocument(doc)
        doc = { ...doc, ...denormalization(doc) }       // getElementData or getProcedureElementData
        doc = { ...doc, ...getTagNames(doc) }
        try:
            esClient.index({ index: camelToSnakeCase(collectionName), id: doc._key, body: doc })
            lastTimestamps[collectionName] = timestamp
            saveLastTimestampsToES(esClient, lastTimestamps)
        catch (error):
            logger.error(`Error indexing document: ${error}`)   // continue to next document
    fromTimestamp = toTimestamp
```

**Important, code-traced detail (observed implementation):** the loop bound is `i < timestamps.length`, starting at `i = INIT_SYNC_CHUNK_SIZE` and stepping by `INIT_SYNC_CHUNK_SIZE`. This means the **final partial window** — from the last processed `toTimestamp` up to the true last timestamp in the array — is *not* covered by `initialSync`. That tail is left with `lastTimestamps[collectionName]` set to the last fully-processed chunk boundary, so it is picked up automatically by the next `incrementalSync` call (its `FILTER timestamp >= @lastTimestamp` will include it). This is the concrete mechanism behind the README's claim that "the regular incremental loop takes over" after the initial chunked pass.

## 3. `incrementalSync` — steady-state pass

Called once immediately after `initialSync` returns, then repeatedly from `index.js`'s `while (true)` loop, once every `SYNC_INTERVAL_SECS` (default 30s):

```text
for each collectionName in ARANGO_COLLECTION_NAMES:
    lastTimestamp = lastTimestamps[collectionName] || ''
    AQL: FOR doc IN <collection>
         LET timestamp = DECODE_REV(doc._rev).date
         FILTER timestamp >= @lastTimestamp
         SORT timestamp ASC
         LIMIT SYNC_CHUNK_SIZE
         RETURN {doc, timestamp}
    for each {doc, timestamp} in cursor:
        preprocessDocument(doc)
        doc = { ...doc, ...denormalization(doc) }
        doc = { ...doc, ...getTagNames(doc) }
        try:
            esClient.index({ index: camelToSnakeCase(collectionName), id: doc._key, body: doc })
            lastTimestamps[collectionName] = timestamp
            saveLastTimestampsToES(esClient, lastTimestamps)
        catch (error):
            logger.error(`Error indexing document: ${error}`)   // continue to next document
return lastTimestamps
```

If more than `SYNC_CHUNK_SIZE` documents are pending, only the first `SYNC_CHUNK_SIZE` (sorted ascending by timestamp) are processed per call; the remainder is picked up on the next cycle, `SYNC_INTERVAL_SECS` later.

## 4. Per-document denormalization + sanitization pipeline

This is the shared sub-pipeline invoked by both `initialSync` and `incrementalSync` for every fetched document:

```text
raw ArangoDB document
→ preprocessDocument(document)
    - delete _id, _version, specification
    - null out invalid dates at every path in DATE_KEYS (via _sanitizeDateFields)
    - String()-coerce truthy verification_value in authoring_user_input/execution_user_input/execution.results entries
    - String()-coerce truthy value in execution.results.outputs
→ denormalization (branches on collectionName):
    element        → getElementData(document, arangoDb)
                       → execution (by execution_id) [preprocessed]
                       → venue (by execution.venue_id) [preprocessed]
                       → runRecord (by _to == "element/"+elem_id) [preprocessed]
                       → procedureVersion (by version_id, if set; try/catch → {} on failure) [preprocessed]
    procedureElement → getProcedureElementData(document, arangoDb)
                       → procedure (by procedure_id) [preprocessed]
                       → procedureVersion (by version_id) [preprocessed]
→ getTagNames(document)  // reads procedureVersionDetails.tags + tag_ids → tag_names[]
→ merged document, ready for Elasticsearch
→ esClient.index({ index: camelToSnakeCase(collectionName), id: document._key, body: mergedDocument })
→ checkpoint update: lastTimestamps[collectionName] = timestamp; saveLastTimestampsToES(...)
```

## 5. Checkpoint persistence contract

- **Storage location:** Elasticsearch index `syncdata`, document id `last_timestamps`, body shape `{ data: <lastTimestamps map> }` (`utils/utils.js`).
- **Write frequency:** after **every successfully indexed document** (not batched), inside the same try block as the `esClient.index` call for that document.
- **Read frequency:** once, at startup (`readLastTimestampsFromES`), immediately before `initialSync` is first called.
- **Shape:** a flat object keyed by ArangoDB collection name, e.g. `{ "element": "2026-01-01T00:00:00.000Z", "procedureElement": "2026-01-01T00:00:00.000Z" }` (values are the ArangoDB revision-decoded timestamp strings returned by `DECODE_REV(doc._rev).date`, not wall-clock sync time).

## 6. Elasticsearch index naming

| ArangoDB collection | Elasticsearch index (`camelToSnakeCase`) |
| --- | --- |
| `element` | `element` |
| `procedureElement` | `procedure_element` |
| *(checkpoint, not a synced collection)* | `syncdata` |

`camelToSnakeCase` is a general regex transform (`/[A-Z]/g` → `_` + lowercase); it is not a lookup table, so any future collection name added to `ARANGO_COLLECTION_NAMES` will be transformed the same way automatically.
