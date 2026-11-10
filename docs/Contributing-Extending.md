# Contributing & Extending

[← Home](./README.md) · See also: [Testing](./Testing.md) · [Core Components](./Core-Components.md)

## Contribution workflow (as documented in the repository)

There is no `CONTRIBUTING.md`. Per the root README:

1. Clone the repository and create a feature branch.
2. Make changes, keeping `npm run test:coverage` passing (100% coverage is enforced by `jest.config.js`).
3. Open a pull request against `devel`.

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs `npm run test:coverage` and a Docker build on every push/PR targeting `devel` or `main` — see [CI/CD](./CI-CD.md).

## Extension points

There is **no plugin architecture, dependency-injection container, or generic collection-handler registry** in this codebase. Extension happens by directly editing the modules below. The service is architected as a fixed two-collection pipeline (`element`, `procedureElement`), not a generic N-collection framework.

### Adding a new synced ArangoDB collection

Based on how `element` and `procedureElement` are currently wired through the codebase, adding a third collection requires touching all of the following:

1. **`config/config.js`** — add the new collection name to the hardcoded `ARANGO_COLLECTION_NAMES` array (there is no environment variable for this list).
2. **`document/document.js`** — `initialSync` and `incrementalSync` both dispatch denormalization with a binary check:
   ```js
   if (collectionName == 'element') {
       const elementDetails = await getElementData(document, arangoDb);
       document = {...document, ...elementDetails}
   } else {
       const procedureDetails = await getProcedureElementData(document, arangoDb);
       document = {...document, ...procedureDetails}
   }
   ```
   This `if/else` is binary, not a map/switch over collection names — adding a third collection requires either extending this to an `if/else if/else` chain (or a lookup map keyed by collection name) in **both** functions, since the dispatch logic is duplicated between `initialSync` and `incrementalSync` rather than factored into a shared helper.
3. If the new collection needs its own denormalization (joining to other collections), write a new `get<Name>Data(document, arangoDb)` function following the pattern of `getElementData`/`getProcedureElementData` — each existing example calls `preprocessDocument` on every sub-document it fetches before returning it.
4. If the new collection has date fields that need ES-safe null handling, add their key-paths to `DATE_KEYS` in `document/document.js` (see [Core Components](./Core-Components.md#datekeys) for the path-array format, including how array-typed intermediate keys like `entries` are expressed).
5. The Elasticsearch index name is derived automatically via `camelToSnakeCase` (`utils/utils.js`) — no separate mapping step is needed for the index name itself, though the index's ES mapping (if any) is outside this repository's code (see `INIT_SYNC_DELAY_SECS`'s stated purpose of letting ES apply mappings before sync starts — the mapping definitions themselves are not present in this repository).

### Adding tests

Follow the existing per-module pattern in `tests/unit/*.test.js`:
- Use `tests/unit/mocks/mockDatabase.js`'s `makeArangoDb({ queryImpl })` with a router function that switches on substrings of the AQL query text (see the `router(routes)` helper pattern in `tests/unit/document.test.js`) to control what each `arangoDb.query(...)` call returns.
- Use `tests/unit/mocks/mockSearchClient.js`'s `makeEsClient({ indexImpl, getImpl })` to control Elasticsearch responses.
- Use `tests/unit/mocks/testHelpers.js`'s `makeCursor(items, count)` to build any AQL cursor response — it must expose a `hasNext` **getter** and an async `next()`, matching what the production code actually calls.
- Because `jest.config.js` enforces 100% coverage across branches/functions/lines/statements, any new code path (a new `if` branch, a new denormalization function, a new dispatch case) needs a corresponding test or `npm run test:coverage` will fail in CI.

### Adding integrations

**Not documented in this repository.** There is no existing example of integrating a third external system (beyond ArangoDB and Elasticsearch) to extend from, and no abstraction layer (e.g. a generic "sink" or "source" interface) that a new integration would plug into. Any such addition would currently mean modifying `db/db.js`, `document/document.js`, and `index.js` directly.

## What NOT to assume

- There is no lint/format tooling to run before committing (see [Development](./Development.md)) — code style consistency is a manual/review responsibility, not automated.
- There is no `LICENSE` file, and the license is inconsistently stated between the README (Apache 2.0) and `package.json` (ISC) — do not assume either is authoritative without confirming with the repository owners.
