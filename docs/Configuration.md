# Configuration

[← Home](./README.md) · See also: [Core Components](./Core-Components.md#configconfigjs) · [Development](./Development.md)

All configuration is environment-variable driven and read exactly once, at module load time, in `config/config.js`. There is no config file, no `.env` loader (no `dotenv` dependency in `package.json`), and no runtime reload — changing `process.env` after the module has been `require()`'d has no effect for the life of the process.

## Environment variables

| Variable | Default (if unset) | Config key | Notes |
| --- | --- | --- | --- |
| `ARANGO_URL` | `http://127.0.0.1:18529` | `ARANGO_URL` | Passed directly to `arangojs`'s `Database` constructor as `url`. |
| `ARANGO_USER` | `root` | `ARANGO_USER` | Basic-auth username for ArangoDB. |
| `ARANGO_ROOT_PASSWORD` | `password` | `ARANGO_PASSWORD` | **Env var name and config key name differ.** Basic-auth password for ArangoDB. |
| `ARANGO_DB_NAME` | `ingenium` | `ARANGO_DB_NAME` | ArangoDB database name. |
| `ES_HOST` | `127.0.0.1` | `ES_HOST` | Elasticsearch host (no scheme). |
| `ES_PORT` | `19200` | `ES_PORT` | Parsed with `parseInt`; see "Numeric parsing" below. |
| `INIT_SYNC_DELAY_SECS` | `60` | `INIT_SYNC_DELAY_SECS` | Seconds `startService` sleeps after connecting, before reading checkpoints / starting sync. |
| `INIT_SYNC_TRIGGER_ELEM_COUNT` | `500000` | `INIT_SYNC_TRIGGER_ELEM_COUNT` | Pending-document threshold above which `initialSync` performs chunked bulk indexing for a collection; below it, `initialSync` does nothing for that collection. |
| `INIT_SYNC_CHUNK_SIZE` | `100000` | `INIT_SYNC_CHUNK_SIZE` **and** `SYNC_CHUNK_SIZE` | See quirk below — this single env var drives two config keys. |
| `SYNC_INTERVAL_SECS` | `30` | `SYNC_INTERVAL_SECS` | Seconds between `incrementalSync` calls in the steady-state loop. |

## Not environment-configurable (hardcoded)

| Config key | Value | Location |
| --- | --- | --- |
| `ARANGO_COLLECTION_NAMES` | `['element', 'procedureElement']` | `config/config.js` literal |
| `LOG_LEVEL` | `'info'` | `config/config.js` literal |

There is no environment variable for either of these. Changing the synced collections or the log level requires editing `config/config.js` and redeploying.

## Documented quirk: `SYNC_CHUNK_SIZE` has no dedicated env var

```js
INIT_SYNC_CHUNK_SIZE: isNaN(parseInt(process.env.INIT_SYNC_CHUNK_SIZE)) ? 100000 : parseInt(process.env.INIT_SYNC_CHUNK_SIZE),
SYNC_CHUNK_SIZE:      isNaN(parseInt(process.env.INIT_SYNC_CHUNK_SIZE)) ? 100000 : parseInt(process.env.INIT_SYNC_CHUNK_SIZE),
```

Both `INIT_SYNC_CHUNK_SIZE` (used by `initialSync`'s chunk-window size) and `SYNC_CHUNK_SIZE` (used by `incrementalSync`'s per-cycle `LIMIT`) read from the **same** `process.env.INIT_SYNC_CHUNK_SIZE` variable. Setting `INIT_SYNC_CHUNK_SIZE=7` changes both values to `7` simultaneously — there is no way to set them independently via environment variables. This is explicitly asserted in `tests/unit/config.test.js` ("Known quirk: SYNC_CHUNK_SIZE is derived from INIT_SYNC_CHUNK_SIZE") and called out in the root README.

## Numeric parsing behavior

Every numeric env var uses the pattern:

```js
isNaN(parseInt(process.env.X)) ? <default> : parseInt(process.env.X)
```

Because `parseInt` parses a leading numeric prefix and stops at the first non-digit character, a value such as `ES_PORT="9200abc"` parses to `9200` (not the default) — partially-numeric strings are **not** rejected, only strings with **no** leading digits (e.g. `""`, `"abc"`) fall back to the default. This is verified in `tests/unit/config.test.js`'s "falls back to numeric defaults when env values are not numbers" test, which only exercises fully non-numeric inputs.

## Precedence

1. The corresponding environment variable, if set and it parses to a usable value (non-empty string for URL/host/user fields; a value where `parseInt` doesn't yield `NaN` for numeric fields).
2. Otherwise, the hardcoded default shown above.

There is no third tier (no config file, no CLI flags, no secrets manager integration observed in this repository).

## Example — Quick Start values (from the root README)

```bash
export ARANGO_URL=http://localhost:8529
export ARANGO_USER=root
export ARANGO_ROOT_PASSWORD=<your-arango-password>
export ARANGO_DB_NAME=ingenium
export ES_HOST=localhost
export ES_PORT=9200
npm start
```

## Docker

The `Dockerfile` does not set any `ENV` defaults inside the image — all values above must be supplied at `docker run` time (e.g. via `-e VAR=value`), or the module-level defaults in `config/config.js` apply. See the root README's Docker section for a full `docker run` example.
