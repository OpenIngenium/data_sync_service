# Ingenium Data Sync Service

**Continuous ArangoDB → Elasticsearch synchronization service for the Ingenium platform.**

[![CI](https://github.com/OpenIngenium/data_sync_service/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenIngenium/data_sync_service/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24.22.1-brightgreen.svg)](.nvmrc)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](#license)

## Overview

`data_sync_service` is a long-running Node.js worker that keeps an Elasticsearch index in sync with `element` and `procedureElement` collections stored in an ArangoDB database. It is built for the Ingenium platform, where procedure-execution documents live in ArangoDB but need to be searchable in Elasticsearch.

> **Looking for implementation-level detail?** See the [Developer Wiki](./docs/README.md) for architecture diagrams, the exact sync algorithms, module-by-module internals, and traced error-handling behavior. This README covers what the service does and how to run it; the wiki covers how it works internally and how to extend it.

On each cycle, the service reads ArangoDB's internal revision timestamp (`DECODE_REV(doc._rev).date`) to find documents that changed since the last checkpoint, denormalizes related records (execution, venue, procedure, procedure version, run record), sanitizes the payload, and indexes the result into Elasticsearch. The last processed timestamp per collection is itself persisted in Elasticsearch, so the service can resume where it left off after a restart.

## Features

- **Checkpointed incremental sync** — tracks the last synced ArangoDB revision timestamp per collection (persisted in an ES `syncdata` index) so restarts resume without reprocessing everything.
- **Chunked catch-up for large backlogs** — when a collection has more pending documents than `INIT_SYNC_TRIGGER_ELEM_COUNT`, an initial bulk pass indexes them in `INIT_SYNC_CHUNK_SIZE`-sized time windows before the regular incremental loop takes over.
- **Document denormalization** — `element` documents are enriched with their related `execution`, `venue`, `runRecord`, and `procedureVersion` data; `procedureElement` documents are enriched with `procedure` and `procedureVersion` data.
- **Data sanitization** — strips internal ArangoDB fields (`_id`, `_version`, `specification`), nulls out invalid date fields, and coerces verification/output values to strings so Elasticsearch indexing doesn't fail on malformed data.
- **Resilient startup** — retries ArangoDB and Elasticsearch connections for up to 5 minutes before giving up.
- **Structured JSON logging** — all logs are emitted as single-line JSON via [Winston](https://github.com/winstonjs/winston), suitable for log aggregation.

## Prerequisites

- Node.js `>=24.22.1` (see `.nvmrc`)
- A reachable ArangoDB instance
- A reachable Elasticsearch instance

## Installation

```bash
git clone https://github.com/OpenIngenium/data_sync_service.git
cd data_sync_service
npm install
```

### Docker

A `Dockerfile` is provided for building a production image (installs only production dependencies):

```bash
docker build -t data_sync_service .
docker run --rm \
  -e ARANGO_URL=http://host.docker.internal:8529 \
  -e ARANGO_USER=root \
  -e ARANGO_ROOT_PASSWORD=<password> \
  -e ARANGO_DB_NAME=ingenium \
  -e ES_HOST=host.docker.internal \
  -e ES_PORT=9200 \
  data_sync_service
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Point the service at your ArangoDB and Elasticsearch instances
export ARANGO_URL=http://localhost:8529
export ARANGO_USER=root
export ARANGO_ROOT_PASSWORD=<your-arango-password>
export ARANGO_DB_NAME=ingenium
export ES_HOST=localhost
export ES_PORT=9200

# 3. Run the service
npm start
```

The service logs structured JSON to stdout as it connects and syncs:

```json
{"timestamp":"2026-01-01T00:00:00.000Z","level":"INFO","message":"ArangoDB Connected"}
{"timestamp":"2026-01-01T00:00:00.000Z","level":"INFO","message":"ES Connected"}
{"timestamp":"2026-01-01T00:00:00.000Z","level":"INFO","message":"Getting Collection Names [\"element\",\"procedureElement\"]"}
{"timestamp":"2026-01-01T00:00:00.000Z","level":"INFO","message":"initialSync Processing collection: element lastTimestamp: "}
{"timestamp":"2026-01-01T00:00:00.000Z","level":"INFO","message":"incrementalSync Processing collection: element lastTimestamp: 2026-01-01"}
```

## Usage

`data_sync_service` is a service, not a CLI or library — start it with `npm start` (or `node index.js`, or the Docker image) and let it run. On startup it:

1. Retries connecting to ArangoDB and Elasticsearch for up to 5 minutes; exits if either connection can't be established.
2. Waits `INIT_SYNC_DELAY_SECS` seconds (to give Elasticsearch time to apply index mappings).
3. Reads the last synced checkpoint per collection from the ES `syncdata` index.
4. Runs an **initial sync** pass — only performs work for a collection if its pending-document count exceeds `INIT_SYNC_TRIGGER_ELEM_COUNT`; otherwise the backlog is left for the incremental loop.
5. Enters an infinite **incremental sync** loop: every `SYNC_INTERVAL_SECS`, fetches up to `SYNC_CHUNK_SIZE` changed documents per collection, preprocesses/denormalizes them, and indexes them into Elasticsearch (index name derived from the collection name in snake_case, e.g. `procedureElement` → `procedure_element`).

The process runs indefinitely; stop it with a standard process signal (e.g. `Ctrl+C`, or your container orchestrator's stop mechanism).

## Configuration

All configuration is provided via environment variables, read in `config/config.js`. There is no config file to edit.

| Variable | Default | Description |
| --- | --- | --- |
| `ARANGO_URL` | `http://127.0.0.1:18529` | ArangoDB connection URL |
| `ARANGO_USER` | `root` | ArangoDB username |
| `ARANGO_ROOT_PASSWORD` | `password` | ArangoDB password |
| `ARANGO_DB_NAME` | `ingenium` | ArangoDB database name |
| `ES_HOST` | `127.0.0.1` | Elasticsearch host |
| `ES_PORT` | `19200` | Elasticsearch port |
| `INIT_SYNC_DELAY_SECS` | `60` | Seconds to wait after startup (before the first sync) so Elasticsearch mappings can settle |
| `INIT_SYNC_TRIGGER_ELEM_COUNT` | `500000` | Pending-document threshold above which a collection triggers the chunked initial sync |
| `INIT_SYNC_CHUNK_SIZE` | `100000` | Number of documents per time-window chunk during initial sync. **Note:** this variable also determines `SYNC_CHUNK_SIZE` (there is no separate `SYNC_CHUNK_SIZE` environment variable) |
| `SYNC_INTERVAL_SECS` | `30` | Seconds between incremental sync polls |

Two additional values are currently hard-coded (not environment-configurable) in `config/config.js`:
- **Synced collections** — `element` and `procedureElement`.
- **Log level** — `info`.

## Project Structure

```text
.
├── config/         # Environment-driven configuration (config.js)
├── db/             # ArangoDB / Elasticsearch client construction (db.js)
├── document/       # Preprocessing, denormalization, and sync logic (document.js)
├── utils/          # Logger (Winston) and small helpers (utils.js)
├── tests/unit/     # Jest unit tests and mocks
├── docs/           # Developer wiki (architecture, internals, data flow — see below)
├── .github/workflows/  # CI workflow (ci.yml)
├── Dockerfile
└── index.js        # Service entry point
```

For a deeper look at how these pieces fit together, see the [Developer Wiki](./docs/README.md).

## Development

```bash
npm install            # install all dependencies, including devDependencies
npm start               # run the service (node index.js)
npm test                # run the Jest unit test suite
npm run test:watch      # run tests in watch mode
npm run test:coverage   # run tests with a coverage report
```

There are currently no configured lint, format, or type-check scripts in `package.json`.

## Testing & CI

Unit tests live in `tests/unit/` and run with [Jest](https://jestjs.io/). `jest.config.js` enforces a **100% coverage threshold** (branches, functions, lines, and statements) across the codebase (tests and `node_modules` excluded).

The GitHub Actions workflow at `.github/workflows/ci.yml` runs on pushes and pull requests targeting `devel` and `main`:
- **Test** — checks out the repo, sets up Node.js from `.nvmrc`, runs `npm ci`, then `npm run test:coverage`.
- **Docker Build** — (after tests pass) builds the Docker image from the `Dockerfile`.

## Contributing

There is no `CONTRIBUTING.md` in this repository yet. To contribute:

1. Clone the repository and create a feature branch.
2. Make your changes, keeping `npm run test:coverage` passing (100% coverage is enforced).
3. Open a pull request against `devel`.

## License

This project is licensed under the **Apache License, Version 2.0**. See the [`LICENSE`](./LICENSE) file for the full text.
