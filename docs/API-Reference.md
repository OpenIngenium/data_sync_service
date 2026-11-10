# API Reference

[← Home](./README.md) · See also: [Core Components](./Core-Components.md) · [Data Flow](./Data-Flow.md)

`data_sync_service` exposes **no HTTP endpoints and no CLI subcommands.** It is started as a single process (`npm start` / `node index.js` / the Docker image's `CMD`) and runs until stopped by a process signal. The "API" here is the set of functions each module exports — consumed internally by `index.js` and by the Jest test suite.

## `index.js`

```js
const { startService, sleepMilisecs } = require('./index');
```

| Export | Signature | Description |
| --- | --- | --- |
| `startService` | `async function startService(): Promise<void>` | Runs the full connect → initial-sync → incremental-loop lifecycle described in [Data Flow](./Data-Flow.md). Never resolves under normal operation (the incremental loop is `while (true)`); resolves early (without throwing) if either datastore connection cannot be established within the retry budget. |
| `sleepMilisecs` | `async function sleepMilisecs(miliSecs: number): Promise<void>` | Thin `setTimeout` wrapper used only by the connection-retry loops. |

## `db/db.js`

```js
const { getArangoDb, getEsClient } = require('./db/db');
```

| Export | Signature | Description |
| --- | --- | --- |
| `getArangoDb` | `async function getArangoDb(): Promise<Database>` | Returns a new `arangojs` `Database` instance configured from `config/config.js` (`ARANGO_URL`, `ARANGO_DB_NAME`, basic-auth `ARANGO_USER`/`ARANGO_PASSWORD`). Does **not** verify connectivity — callers must call e.g. `db.exists()` themselves (as `index.js` does). |
| `getEsClient` | `async function getEsClient(): Promise<Client>` | Returns a new `@elastic/elasticsearch` `Client` pointed at `http://${ES_HOST}:${ES_PORT}`. No auth is configured. Does not verify connectivity — callers must call e.g. `client.ping()` themselves. |

## `document/document.js`

```js
const {
  preprocessDocument,
  initialSync,
  incrementalSync,
  notADate,
  processEntries,
  getTagNames,
  getElementData,
  getProcedureElementData,
} = require('./document/document');
```

| Export | Signature | When to use it |
| --- | --- | --- |
| `preprocessDocument` | `function preprocessDocument(document: object \| null \| undefined): void` | Mutates `document` in place: strips ArangoDB-internal fields, nulls invalid date fields, stringifies verification/output values. Called on every document (top-level or denormalized) before it is indexed. No-op if `document` is falsy. |
| `notADate` | `function notADate(value: any): boolean` | `true` if `Date.parse(value)` is `NaN`. Used internally by date sanitization; also directly unit-tested. |
| `processEntries` | `function processEntries(entries: object[]): object[]` | Returns a new array where each entry's truthy `verification_value` is coerced with `String(...)`. |
| `getTagNames` | `function getTagNames(document: object): { tag_names: string[] }` | Derives display tag names from `document.procedureVersionDetails.tags` filtered by `document.tag_ids`. |
| `getElementData` | `async function getElementData(document: object, arangoDb: Database): Promise<{ executionDetails, venueDetails, procedureVersionDetails, runRecordDetails }>` | Denormalizes an `element` document. See [Core Components](./Core-Components.md#getelementdatadocument-arangodb) for the exact queries and fallback behavior. |
| `getProcedureElementData` | `async function getProcedureElementData(document: object, arangoDb: Database): Promise<{ procedureDetails, procedureVersionDetails }>` | Denormalizes a `procedureElement` document. |
| `initialSync` | `async function initialSync(lastTimestamps: object, arangoDb: Database, esClient: Client, arangoCollectionNames: string[]): Promise<object>` | One-shot bulk catch-up pass, called once from `startService()`. Only acts on a collection whose pending-document count exceeds `INIT_SYNC_TRIGGER_ELEM_COUNT`. Returns the updated checkpoint map. |
| `incrementalSync` | `async function incrementalSync(lastTimestamps: object, arangoDb: Database, esClient: Client, arangoCollectionNames: string[]): Promise<object>` | Steady-state pass, called repeatedly from `startService()`'s `while (true)` loop. Fetches at most `SYNC_CHUNK_SIZE` documents per collection per call. Returns the updated checkpoint map. |

### Example — calling `initialSync`/`incrementalSync` directly (from `tests/unit/document.test.js`)

```js
const { initialSync } = require('./document/document');
const { makeArangoDb } = require('./tests/unit/mocks/mockDatabase');
const { makeEsClient } = require('./tests/unit/mocks/mockSearchClient');
const { makeCursor } = require('./tests/unit/mocks/testHelpers');

const arangoDb = makeArangoDb({
  queryImpl: async (query) => {
    if (query.includes('RETURN timestamp')) return makeCursor(['t0', 't1']);
    if (query.includes('RETURN {doc: doc, timestamp: timestamp}')) {
      return makeCursor([{ doc: { _key: 'k1', execution_id: 'x1', elem_id: 'e1', version_id: '' }, timestamp: 't1' }], 1);
    }
    return makeCursor([]);
  },
});
const esClient = makeEsClient();

const lastTimestamps = await initialSync({}, arangoDb, esClient, ['element']);
// lastTimestamps => { element: 't1' }
```

This is a direct adaptation of the real test in `tests/unit/document.test.js` — it is representative of how the functions are actually invoked, not a hypothetical usage example.

## `utils/utils.js`

```js
const { sleep, camelToSnakeCase, saveLastTimestampsToES, readLastTimestampsFromES } = require('./utils/utils');
```

| Export | Signature | Description |
| --- | --- | --- |
| `sleep` | `(ms: number) => Promise<void>` | `setTimeout`-based delay. Used for `INIT_SYNC_DELAY_SECS` and the inter-cycle `SYNC_INTERVAL_SECS` wait. |
| `camelToSnakeCase` | `(str: string) => string` | `procedureElement` → `procedure_element`; strings with no uppercase letters (e.g. `element`) are returned unchanged. |
| `saveLastTimestampsToES` | `async (esClient: Client, lastTimestamps: object) => Promise<void>` | Indexes `{ data: lastTimestamps }` into ES `syncdata/last_timestamps`. Swallows and logs errors; never rejects. |
| `readLastTimestampsFromES` | `async (esClient: Client) => Promise<object>` | Reads ES `syncdata/last_timestamps`. Returns `{}` on 404. Logs and **re-throws** on any other error. |

## `utils/logger.js`

```js
const logger = require('./utils/logger');
logger.info('message');
logger.warn('message', errorObjectOrDetail);
logger.error('message', errorObjectOrDetail);
```

A single shared Winston logger instance (not a class/factory) — see [Core Components](./Core-Components.md#utilsloggerjs) for the JSON formatting mechanism. There is no exported way to change the log level or add transports at runtime; it is fixed at module load from `config.LOG_LEVEL` (hardcoded to `'info'`).

## `config/config.js`

```js
const config = require('./config/config');
```

Exports a plain object of constants — see the full table in [Configuration](./Configuration.md). There is no function API here; it is evaluated once at `require()` time.
