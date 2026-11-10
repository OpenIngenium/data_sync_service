# Development

[← Home](./README.md) · See also: [Testing](./Testing.md) · [Configuration](./Configuration.md)

## Prerequisites

- Node.js `>=24.22.1` — pinned in `.nvmrc` (`24.22.1`) and `package.json`'s `engines.node`. If using `nvm`, run `nvm use` from the repo root to pick this up automatically.
- A reachable ArangoDB instance with an `ingenium` database (or whatever `ARANGO_DB_NAME` is set to) containing the `element`, `procedureElement`, `execution`, `venue`, `runRecord`, `procedure`, and `procedureVersion` collections.
- A reachable Elasticsearch instance.

**Not present in this repository:** there is no `docker-compose.yml` or equivalent to spin up ArangoDB/Elasticsearch locally — both must be provisioned separately.

## Setup

```bash
git clone https://github.com/OpenIngenium/data_sync_service.git
npm install
```

`npm install` installs both `dependencies` and `devDependencies` (there is no separate lockfile-only "prod install" step for local dev — that is what `Dockerfile`'s `npm ci --omit=dev` is for, at image-build time only).

## Running locally

```bash
export ARANGO_URL=http://localhost:8529
export ARANGO_USER=root
export ARANGO_ROOT_PASSWORD=<your-arango-password>
export ARANGO_DB_NAME=ingenium
export ES_HOST=localhost
export ES_PORT=9200
npm start        # equivalent to: node index.js
```

The process logs structured single-line JSON to stdout (see `utils/logger.js`) and runs until stopped (`Ctrl+C` or a process signal) — see [Data Flow](./Data-Flow.md) for what happens at each stage.

## npm scripts (`package.json`)

| Script | Command | Purpose |
| --- | --- | --- |
| `npm start` | `node index.js` | Runs the service. |
| `npm test` | `jest` | Runs the full Jest unit test suite once. |
| `npm run test:watch` | `jest --watch` | Re-runs affected tests on file change. |
| `npm run test:coverage` | `jest --coverage` | Runs tests and enforces the 100% coverage threshold in `jest.config.js`. |

## Linting, formatting, type checking

**None are configured.** There is no ESLint config, no Prettier config, and no TypeScript / JSDoc type-checking setup anywhere in the repository (`package.json` has no `lint`, `format`, or `typecheck` script, and no corresponding devDependencies). Code style is currently whatever the existing files already follow — there is no automated enforcement beyond the test suite itself.

## Debugging

- All logging goes through the single Winston logger in `utils/logger.js`, which is fixed at `LOG_LEVEL: 'info'` (hardcoded in `config/config.js`, not env-configurable). There is no built-in `debug`-level logging path to enable without editing `config/config.js`.
- Because `esClient.index` failures inside `initialSync`/`incrementalSync` are caught and logged (`Error indexing document: ${error}`) rather than thrown, a stuck/silent sync is more likely to show up as repeated identical log lines (same `lastTimestamp` across cycles) than as a crash — see [Troubleshooting](./Troubleshooting.md).
- For deeper local debugging, run `node --inspect index.js` (or set `NODE_OPTIONS=--inspect` for `npm start`) and attach a debugger — this is standard Node.js tooling, not something the repository configures itself.

## Building the Docker image

```bash
docker build -t data_sync_service .
```

`Dockerfile` uses `node:24.22.1-slim` as the base image, runs `npm ci --omit=dev` (production dependencies only), copies the full working tree (subject to `.dockerignore`, which excludes `tests`, `coverage`, `jest.config.js`, `docs`, and `*.md`), and starts the container with `CMD ["npm", "start"]`.
