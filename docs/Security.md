# Security

[← Home](./README.md) · See also: [Configuration](./Configuration.md) · [Error Handling](./Error-Handling.md)

This page documents security-relevant facts that can be established directly from the implementation. **It is not a security audit and makes no claim that the service is secure.** Absence of a mechanism below means the repository does not implement it — not that it is unnecessary.

## Network exposure

The service has **no inbound network surface**: no HTTP server, no listening socket, no CLI argument parsing of untrusted input. It only makes outbound connections to ArangoDB and Elasticsearch (`db/db.js`). This significantly limits its attack surface relative to a network-facing service, but does not make it "secure" — it is still a privileged client of two datastores.

## Credentials

- ArangoDB credentials (`ARANGO_USER`, `ARANGO_ROOT_PASSWORD`) are read from environment variables in `config/config.js` and passed as HTTP basic auth to `arangojs`'s `Database` constructor (`db/db.js`, `getArangoDb`).
- **Default credentials, if the corresponding env vars are unset:** `ARANGO_USER=root`, `ARANGO_PASSWORD=password` (the literal string `'password'`, hardcoded in `config/config.js`). These defaults are documented in the root README as example/dev values, but the code will silently use them in any environment where the env vars are not set — there is no startup check that rejects a default/weak credential.
- Credentials are plain `process.env` values. No secrets-manager integration (e.g. Vault, AWS Secrets Manager) is present in this repository.

## Elasticsearch client has no authentication configured

```js
async function getEsClient() {
  return new Client({ node: `http://${ES_HOST}:${ES_PORT}` });
}
```

`getEsClient()` (`db/db.js`) constructs the `@elastic/elasticsearch` `Client` with only a `node` URL — **no `auth` option is passed.** If the target Elasticsearch cluster requires authentication, this client would fail to connect; if it does not require authentication, this service connects to it anonymously. There is no environment variable in `config/config.js` for an ES username/password/API key.

## Transport / TLS

- `ARANGO_URL` is a full URL supplied by the operator, so `https://` is possible if configured, but the default (`http://127.0.0.1:18529`) and every documented example (README Quick Start, Docker run example) use plain `http://`.
- The Elasticsearch connection URL scheme is **hardcoded** to `http://` in `getEsClient()` (`` `http://${ES_HOST}:${ES_PORT}` ``) — there is no configuration path to use `https://` for Elasticsearch without editing `db/db.js` directly.
- No certificate/TLS configuration (CA bundles, client certs) is present for either client.

## Input handling

`preprocessDocument` (`document/document.js`) performs targeted sanitization, not general validation:
- Removes ArangoDB-internal fields (`_id`, `_version`, `specification`) that would conflict with Elasticsearch indexing.
- Nulls out fields at known paths (`DATE_KEYS`) that fail to parse as a `Date`.
- Coerces specific known fields (`verification_value`, script `outputs[].value`) to strings.

There is **no schema validation, size limiting, or content sanitization** of the rest of each ArangoDB document before it is indexed into Elasticsearch — any other field is passed through as-is. This means data quality/shape issues originating in ArangoDB (outside the specific fields above) propagate directly into the Elasticsearch index.

## Authentication / authorization within the service

None. There is no concept of users, sessions, roles, or permissions anywhere in this codebase — it is a single-purpose batch worker operating with whatever privileges its ArangoDB/Elasticsearch credentials grant it.

## Logging and sensitive data

`utils/logger.js` logs structured JSON to stdout. `index.js` logs error objects directly (e.g. `logger.warn('Trial: ... Failed to connect to ArangoDB:', error)`), which could include connection-string or driver-internal details in the error object depending on what `arangojs`/`@elastic/elasticsearch` includes in their thrown errors — the repository does not implement any redaction of error payloads before logging.

## Licensing

The root README, the root `LICENSE` file, and `package.json`'s `"license"` field all identify this project as **Apache License 2.0**.

## Dependency/vulnerability posture

**Not established by this repository as of this writing.** No `npm audit` output, Dependabot/Renovate config, or SBOM is checked into the repository. Dependency versions are pinned in `package.json`/`package-lock.json` (`@elastic/elasticsearch ^8.19.2`, `arangojs ^8.8.1`, `winston ^3.19.0`; `jest ^30.4.2` dev-only) with a `min-document` override, but whether these are currently free of known vulnerabilities is not something this wiki can assert without re-running `npm audit` against the live lockfile.
