# data_sync_service — Developer Wiki

This is the **DeepWiki** for `data_sync_service`: a technical knowledge base for developers who need to understand, operate, debug, or extend the service. It complements — and intentionally does not duplicate — the project [`README.md`](../README.md), which is the public-facing "should I use this / how do I start it" document.

| Document | Answers |
| --- | --- |
| [`README.md`](../README.md) | "What is this, and how do I run it?" |
| **This wiki** | "How does it actually work, and how do I change it?" |

## Contents

1. [Repository Structure](./Repository-Structure.md) — what each directory/file is responsible for and how they relate.
2. [Architecture](./Architecture.md) — components, dependencies between them, and system/sequence diagrams.
3. [Core Components](./Core-Components.md) — a module-by-module deep dive (`config`, `db`, `document`, `utils`, `index.js`).
4. [API Reference](./API-Reference.md) — every exported function, its signature, and when to use it.
5. [Data Flow](./Data-Flow.md) — the startup sequence and the initial/incremental sync pipelines, end to end.
6. [Configuration](./Configuration.md) — every environment variable, default, and a documented config quirk.
7. [Development](./Development.md) — local setup, running, and the (lack of) lint/format/type-check tooling.
8. [Testing](./Testing.md) — Jest setup, coverage enforcement, mocking patterns.
9. [CI/CD](./CI-CD.md) — the GitHub Actions workflow.
10. [Security](./Security.md) — credentials, transport, and input-handling facts (not a security audit/guarantee).
11. [Error Handling](./Error-Handling.md) — retry logic, try/catch boundaries, and a traced failure path.
12. [Contributing & Extending](./Contributing-Extending.md) — how to safely add a synced collection or a test.
13. [Troubleshooting](./Troubleshooting.md) — problems that can be established from the code/logs/config.

## What this service is (one paragraph)

`data_sync_service` is a single long-running Node.js process (entry point `index.js`) with no HTTP server, CLI surface, or public API. On startup, it connects to an ArangoDB database and an Elasticsearch cluster, then repeatedly queries ArangoDB for `element` and `procedureElement` documents that changed since a checkpoint (using ArangoDB's internal revision timestamp, `DECODE_REV(doc._rev).date`), denormalizes each document with related collections, sanitizes it, and indexes it into Elasticsearch. The checkpoint itself is persisted back into Elasticsearch (`syncdata` index) so a restart resumes rather than reprocessing everything. See [Data Flow](./Data-Flow.md) for the full walkthrough.

## Documentation conventions used in this wiki

- **Observed implementation** — directly traceable to source code or tests in this repository.
- **Strong inference** — not stated outright, but a necessary consequence of the code (e.g. JS execution semantics).
- **Unknown / not documented** — the repository does not establish this; it is called out explicitly rather than guessed at.

