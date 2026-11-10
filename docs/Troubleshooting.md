# Troubleshooting

[← Home](./README.md) · See also: [Error Handling](./Error-Handling.md) · [Configuration](./Configuration.md) · [Development](./Development.md)

This page covers problems that can be established from the service's own log messages, configuration, and code paths. It does not include speculative scenarios that have no basis in the repository.

## "Failed to connect to ArangoDB. Exiting..." / "Failed to connect to ElasticSearch. Exiting..."

These are the exact `logger.error` messages `index.js` emits when a connection is never established within the retry budget (see [Architecture](./Architecture.md#control-flow-startup--steady-state) and [Error Handling](./Error-Handling.md#startup-connection-retries-indexjs)).

- **Check:** `ARANGO_URL`/`ARANGO_USER`/`ARANGO_ROOT_PASSWORD`/`ARANGO_DB_NAME` (for the ArangoDB message) or `ES_HOST`/`ES_PORT` (for the Elasticsearch message) — see [Configuration](./Configuration.md).
- **Remember the shared timer:** because both retry loops share one 5-minute clock (not 5 minutes each), a slow-to-connect ArangoDB instance reduces how long the service will retry Elasticsearch afterward. If you see the ArangoDB message appear quickly followed by the Elasticsearch message with very few retry attempts logged, the budget may have been mostly consumed by ArangoDB retries.
- **After this message, the process exits on its own** (no explicit `process.exit`) — it will not attempt to reconnect again unless the whole process is restarted (e.g. by a container orchestrator's restart policy).

## Repeated `logger.warn` lines: "Trial: N. Failed to connect to ArangoDB:" / "...ElasticSearch:"

Expected during startup if the datastore isn't reachable yet — these are retried every 5 seconds. If they continue for the full retry budget, the "Exiting..." error above will follow. Check basic network reachability and credentials for the relevant datastore.

## Service starts but never logs "initialSync Processing collection..." or "incrementalSync Processing collection..."

Both connections must succeed, then `INIT_SYNC_DELAY_SECS` (default 60s) must elapse, then the checkpoint read must complete, before `initialSync` (and its per-collection log lines) begins. If the process appears to hang between "Waiting for N seconds before starting the data sync" and the first `initialSync`/`incrementalSync` log line for longer than `INIT_SYNC_DELAY_SECS`, see the traced checkpoint-read failure path in [Error Handling](./Error-Handling.md#traced-failure-path-checkpoint-read-failure-can-crash-startservice) — a checkpoint-read failure at that exact point can crash the process with no further sync-related log output.

## `npm run test:coverage` fails in CI or locally

`jest.config.js` enforces a 100% coverage threshold (branches, functions, lines, statements) over every `*.js` file except `node_modules`, `tests`, `coverage`, and `jest.config.js` itself. Any new code added without a corresponding test will fail this check — this mirrors the GitHub Actions `test` job in `.github/workflows/ci.yml`. See [Testing](./Testing.md) for the mocking patterns already used, to model new tests on.

## Elasticsearch indexing errors logged as "Error indexing document: ..."

This is the per-document catch in `initialSync`/`incrementalSync` (see [Error Handling](./Error-Handling.md#per-document-error-handling-initialsync--incrementalsync)). The sync loop continues past the failing document, and that document's checkpoint is **not** advanced, so it will be retried on the next sync pass. Repeated errors for the same document across cycles suggest a persistent issue with that specific document's shape (e.g. a field Elasticsearch's index mapping rejects that `preprocessDocument` does not currently sanitize).

## Docker build includes unexpected files, or excludes files you expected

Check `.dockerignore` — it excludes `node_modules`, `.env`, logs/temp files, `.git`, `tests`, `coverage`, `jest.config.js`, `docs` (this wiki), and `*.md` (including the root README) from the build context. If you need documentation inside the image for some reason, it is currently excluded by design.

## "SYNC_CHUNK_SIZE doesn't seem to change when I set it"

There is no `SYNC_CHUNK_SIZE` environment variable — it is derived from `INIT_SYNC_CHUNK_SIZE` (see the documented quirk in [Configuration](./Configuration.md#documented-quirk-sync_chunk_size-has-no-dedicated-env-var)). Set `INIT_SYNC_CHUNK_SIZE` instead; it affects both the initial-sync chunk window size and the incremental-sync per-cycle limit simultaneously.

## Not established by this repository

The repository contains no issue tracker content, code comments describing known bugs (beyond the intentional at-least-once-indexing note already covered in [Architecture](./Architecture.md#idempotency-note-documented-in-code)), or a troubleshooting/FAQ section in the README beyond what is reflected above. Problems outside of what can be traced from the code, tests, and configuration files are not documented here rather than guessed at.
