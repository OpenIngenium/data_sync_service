# Core Components

[← Home](./README.md) · See also: [API Reference](./API-Reference.md) · [Data Flow](./Data-Flow.md) · [Error Handling](./Error-Handling.md)

Module-by-module deep dive. File paths are relative to the repository root.

## `config/config.js`

**Purpose:** the single source of runtime configuration. Evaluated once, at `require()` time — see [Configuration](./Configuration.md) for the full variable table and load-order implications.

```js
module.exports = {
    ARANGO_URL: process.env.ARANGO_URL || 'http://127.0.0.1:18529',
    ARANGO_USER: process.env.ARANGO_USER || 'root',
    ARANGO_PASSWORD: process.env.ARANGO_ROOT_PASSWORD || 'password',
    ARANGO_DB_NAME: process.env.ARANGO_DB_NAME || 'ingenium',
    ARANGO_COLLECTION_NAMES: ['element', 'procedureElement'],
    ES_HOST: process.env.ES_HOST || '127.0.0.1',
    ES_PORT: isNaN(parseInt(process.env.ES_PORT)) ? 19200 : parseInt(process.env.ES_PORT),
    INIT_SYNC_DELAY_SECS: /* ... */,
    INIT_SYNC_TRIGGER_ELEM_COUNT: /* ... */,
    INIT_SYNC_CHUNK_SIZE: /* ... */,
    SYNC_INTERVAL_SECS: /* ... */,
    SYNC_CHUNK_SIZE: isNaN(parseInt(process.env.INIT_SYNC_CHUNK_SIZE)) ? 100000 : parseInt(process.env.INIT_SYNC_CHUNK_SIZE),
    LOG_LEVEL: 'info'
};
```

**Notable implementation details:**
- `ARANGO_COLLECTION_NAMES` and `LOG_LEVEL` are **not** environment-configurable — they are literal values in the module.
- `SYNC_CHUNK_SIZE` reads from `process.env.INIT_SYNC_CHUNK_SIZE`, the *same* env var as `INIT_SYNC_CHUNK_SIZE`. There is no separate `SYNC_CHUNK_SIZE` env var (confirmed by `tests/unit/config.test.js`, which asserts this explicitly as a "known quirk").
- The env var is named `ARANGO_ROOT_PASSWORD` but the exported config key is `ARANGO_PASSWORD` — the naming diverges between the environment and the internal config object.
- Numeric env vars use the pattern `isNaN(parseInt(x)) ? default : parseInt(x)`. Because `parseInt` parses leading digits and ignores trailing non-numeric characters, a value like `"20abc"` resolves to `20`, not the default — invalid-looking values are not always rejected.

## `db/db.js`

**Purpose:** two async factory functions that construct client instances; it holds no state and performs no connection testing itself.

```js
async function getArangoDb() {
  const db = new Database({
    url: ARANGO_URL,
    databaseName: ARANGO_DB_NAME,
    auth: { username: ARANGO_USER, password: ARANGO_PASSWORD },
  });
  return db;
}

async function getEsClient() {
  return new Client({ node: `http://${ES_HOST}:${ES_PORT}` });
}
```

- `getArangoDb()` passes basic-auth credentials to `arangojs`'s `Database` constructor.
- `getEsClient()` passes **no auth option** to `@elastic/elasticsearch`'s `Client`, and hardcodes the `http://` scheme (not derived from any config value). See [Security](./Security.md).
- Both functions are called exactly once per process lifetime, from `index.js`'s connection-retry loops (a new client is constructed on every retry attempt, not reused across attempts).

## `document/document.js`

The sync engine. Exports: `preprocessDocument`, `initialSync`, `incrementalSync`, `notADate`, `processEntries`, `getTagNames`, `getElementData`, `getProcedureElementData`.

### `DATE_KEYS`

A constant array of key-paths (each an array of one or more property names) identifying every date-typed field the service knows about, e.g. `['time_completed']`, `['execution', 'results', 'entries', 'ert']`, `['venue_status', 'started_on']`. Paths that traverse an array (e.g. `entries`) are handled recursively — see `_sanitizeDateFields` below. This list must be updated whenever a new date field is introduced that needs ES-safe null-handling (see [Contributing & Extending](./Contributing-Extending.md)).

### `notADate(value)`

Returns `true` when `Date.parse(value)` is `NaN` (e.g. empty string, non-date text) — used to decide whether a date field should be nulled out.

### `_sanitizeDateFields(parent, keys)`

Not exported (internal helper). Walks a key-path through a nested object. For each key:
- If the current value is an array and there are more keys remaining, it recurses into **every array element** with the remaining key path (this is how a path like `['execution', 'results', 'entries', 'ert']` reaches into each entry of the `entries` array).
- Once the full path is resolved, if the final value is an array, each element that fails `notADate` is set to `null` in place; otherwise, if the single value fails `notADate`, the parent's key is set to `null`.
- If any key in the path is missing (`hasOwnProperty` check fails), the function exits without modifying anything — missing fields are left absent, not created as `null`.

### `processEntries(entries)`

Maps over an array of "entry" objects and stringifies a truthy `verification_value` (`String(entry.verification_value)`). Falsy values (including `0`) are left untouched — this preserves the falsy/zero distinction rather than coercing everything.

### `preprocessDocument(document)`

The single sanitization entry point applied to **every** document fetched from ArangoDB (top-level and denormalized sub-documents alike):
1. Returns immediately (`undefined`) if `document` is falsy.
2. Deletes `_id`, `_version`, and `specification` from the document.
3. Runs `_sanitizeDateFields` for every path in `DATE_KEYS`.
4. Applies `processEntries` to `authoring_user_input.entries`, `execution_user_input.entries`, and `execution.results.entries` when present.
5. Stringifies truthy `value` fields inside `execution.results.outputs` (custom script outputs).

### `getTagNames(document)`

Reads `document.procedureVersionDetails.tags` (an array of `{ tag_id, name }`) and `document.tag_ids`, returning `{ tag_names: [...] }` — the names of tags whose `tag_id` is present in `document.tag_ids`. Returns `{ tag_names: [] }` if `procedureVersionDetails.tags` is missing or not an array.

### `getElementData(document, arangoDb)`

Denormalizes an `element` document by querying, in sequence:
1. `execution` — filtered by `execution.execution_id == document.execution_id`.
2. `venue` — filtered by `venue.venue_id == executionDocument.venue_id` (depends on step 1's result).
3. `runRecord` — filtered by `runRecord._to == "element/" + document.elem_id`.
4. `procedureVersion` — **only if** `document.version_id` is truthy — filtered by `procedureVersion.version_id == document.version_id`, wrapped in try/catch (logs `Error retrieving procedure version:` and falls back to `{}` on failure).

Each fetched document is passed through `preprocessDocument` before being attached. Returns `{ executionDetails, venueDetails, procedureVersionDetails, runRecordDetails }`.

### `getProcedureElementData(document, arangoDb)`

Denormalizes a `procedureElement` document by querying `procedure` (filtered by `procedure.procedure_id == document.procedure_id`) and `procedureVersion` (filtered by `procedureVersion.version_id == document.version_id`). Neither query is wrapped in try/catch. Returns `{ procedureDetails, procedureVersionDetails }`.

### `initialSync(lastTimestamps, arangoDb, esClient, arangoCollectionNames)`

The bulk catch-up pass, run exactly once at startup (from `index.js`). Full algorithm documented in [Data Flow](./Data-Flow.md). Returns the (possibly updated) `lastTimestamps` map.

### `incrementalSync(lastTimestamps, arangoDb, esClient, arangoCollectionNames)`

The steady-state polling pass, run in `index.js`'s `while (true)` loop every `SYNC_INTERVAL_SECS`. Fetches up to `SYNC_CHUNK_SIZE` documents per collection. Returns the updated `lastTimestamps` map.

## `utils/utils.js`

- **`sleep(ms)`** — `Promise`-wrapped `setTimeout`; used for the inter-cycle delay (`SYNC_INTERVAL_SECS`) and the startup `INIT_SYNC_DELAY_SECS` wait.
- **`camelToSnakeCase(str)`** — regex-based conversion (`/[A-Z]/g` → `_` + lowercase letter). Used solely to derive the Elasticsearch index name from the ArangoDB collection name.
- **`saveLastTimestampsToES(esClient, lastTimestamps)`** — indexes `{ data: lastTimestamps }` into ES index `syncdata`, document id `last_timestamps`. Catches and logs errors; never throws.
- **`readLastTimestampsFromES(esClient)`** — `GET`s the same document. Returns `{}` on a 404 (first run, no checkpoint yet). Logs and **re-throws** on any other error.

## `utils/logger.js`

A single module-level Winston logger instance (not a factory/class):

```js
const logger = createLogger({
  level: LOG_LEVEL,                                    // always 'info' (hardcoded in config.js)
  format: format.combine(format(json_formatter)()),
  transports: [new transports.Console()],
});
```

`json_formatter` overwrites the internal `Symbol.for('message')` property with a hand-built JSON string `{"timestamp": <Date>, "level": <UPPERCASE>, "message": <message>}` — this is why every log line is single-line JSON rather than Winston's default formatted output. There is exactly one transport (`Console`); no file transport, no external log shipper integration.

## `index.js`

**Purpose:** process entry point and orchestrator. See [Data Flow](./Data-Flow.md) for the full startup sequence and [Error Handling](./Error-Handling.md) for its try/catch boundaries.

- **`sleepMilisecs(miliSecs)`** — a second, separate sleep helper (distinct from `utils/utils.js`'s `sleep`), used only inside the connection-retry loops. Exported for testability.
- **`startService()`** — the orchestrator described in [Architecture](./Architecture.md#control-flow-startup--steady-state). Exported for testability.
- Entry-point guard: `if (require.main === module) { startService(); }` — this line is marked `/* istanbul ignore next */` in the source and is only exercised when the file is run directly (`node index.js` / `npm start`), not under Jest.
