# Testing

[← Home](./README.md) · See also: [Development](./Development.md) · [CI/CD](./CI-CD.md) · [Core Components](./Core-Components.md)

## Framework and configuration

Tests run with [Jest](https://jestjs.io/) (`jest ^30.4.2` devDependency). Configuration lives in `jest.config.js`:

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/unit/**/*.test.js'],
  collectCoverageFrom: ['**/*.js', '!**/node_modules/**', '!**/tests/**', '!**/coverage/**', '!jest.config.js'],
  coveragePathIgnorePatterns: ['/node_modules/', '/coverage/'],
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
  coverageThreshold: { global: { branches: 100, functions: 100, statements: 100, lines: 100 } },
  clearMocks: true,
  restoreMocks: true,
};
```

- **Only `tests/unit/**/*.test.js` files are collected** — there is no separate integration or e2e test glob/directory in this repository.
- **Coverage threshold is 100%** across branches, functions, statements, and lines, computed over every `*.js` file in the repo (excluding `node_modules`, `tests`, `coverage`, and `jest.config.js` itself). `npm run test:coverage` fails the process if any metric drops below 100%.
- `clearMocks`/`restoreMocks: true` means every `jest.fn()` mock and every `jest.spyOn` is automatically reset/restored between tests — tests that need call-history to survive module load (e.g. constructor-call assertions) explicitly use `jest.isolateModules` to work around this (see below).

## Test suite structure

| Test file | Covers |
| --- | --- |
| `tests/unit/config.test.js` | `config/config.js` — defaults, env overrides, numeric-parsing fallback, the `SYNC_CHUNK_SIZE`/`INIT_SYNC_CHUNK_SIZE` quirk. |
| `tests/unit/db.test.js` | `db/db.js` — `getArangoDb`/`getEsClient` construct clients with the right constructor arguments (mocks `arangojs` and `@elastic/elasticsearch` entirely). |
| `tests/unit/document.test.js` | `document/document.js` — `notADate`, `processEntries`, `preprocessDocument` (including the recursive date-array sanitization), `getTagNames`, `getElementData`, `getProcedureElementData`, `initialSync`, `incrementalSync`. |
| `tests/unit/index.test.js` | `index.js` — `startService`'s happy path, connection-failure paths, error-swallowing branches, and the collection-name-logging edge case. |
| `tests/unit/logger.test.js` | `utils/logger.js` — logger construction options and the `json_formatter`'s rewriting of the Winston `MESSAGE` symbol. |
| `tests/unit/utils.test.js` | `utils/utils.js` — `sleep`, `camelToSnakeCase`, `saveLastTimestampsToES`, `readLastTimestampsFromES` (including the 404-vs-other-error branch). |

There are **no integration tests against a real ArangoDB/Elasticsearch instance** and **no end-to-end tests** in this repository — every test mocks the datastore clients (`arangojs`, `@elastic/elasticsearch`) or the internal modules that wrap them.

## Shared test doubles (`tests/unit/mocks/`)

- **`mockDatabase.js` — `makeArangoDb({ queryImpl, exists = true })`**: returns `{ exists: jest.fn(async () => exists), query: jest.fn(queryImpl || (async () => makeCursor([]))) }`. Tests supply `queryImpl` as a router function that inspects the AQL string (e.g. `query.includes('FOR execution IN execution')`) to decide what cursor to return — see `document.test.js`'s `router(routes)` helper for the pattern.
- **`mockSearchClient.js` — `makeEsClient({ ping = true, getImpl, indexImpl })`**: returns `{ ping, get, index }` jest mocks with sensible defaults (`get` resolves `{ _source: { data: {} } }`; `index` resolves `{ result: 'created' }`).
- **`testHelpers.js`**:
  - `makeCursor(items = [], count)` — mimics the ArangoDB cursor contract the production code actually relies on: a `hasNext` **getter** (not a method) and an async `next()`. This precisely matches how `document/document.js` consumes cursors (`while (cursor.hasNext) { const x = await cursor.next(); }`).
  - `snapshotEnv()` — captures `process.env` and returns a restore function, used by `config.test.js` to test env-var overrides without leaking state between tests.

## Notable testing patterns

- **`jest.isolateModules`** is used wherever a module's top-level (require-time) behavior needs to be re-observed per test — e.g. `config.test.js`'s `loadConfig()` helper re-requires `config/config.js` inside `jest.isolateModules` after mutating `process.env`, and `logger.test.js`'s `load()` helper re-requires both `winston` (mocked) and `utils/logger.js` together so the constructor-call assertions aren't wiped by `clearMocks`.
- **`jest.doMock` + `jest.isolateModules`** (in `index.test.js`'s "collection-name logging failure" test) is used for a one-off scenario requiring a *different* mock configuration (a circular-reference `ARANGO_COLLECTION_NAMES` value that breaks `JSON.stringify`) than the rest of the suite's top-level `jest.mock` calls — it explicitly `jest.dontMock`s everything afterward to avoid leaking into subsequent tests.
- **Deterministic time control**: `index.test.js`'s `mockAdvancingDate(step)` replaces the global `Date` constructor so the connection-retry loops' `elapsedTime` calculation advances deterministically, letting tests exercise the "never connects, budget exhausted" branch without real 5-minute waits. `setTimeout` is likewise mocked to invoke its callback immediately.

## Running tests

```bash
npm test               # single run
npm run test:watch     # watch mode
npm run test:coverage  # single run + coverage report (text summary + coverage/lcov-report/index.html)
```

## CI enforcement

`npm run test:coverage` is the exact command run by the GitHub Actions `test` job in `.github/workflows/ci.yml` — see [CI/CD](./CI-CD.md) for the full workflow.
