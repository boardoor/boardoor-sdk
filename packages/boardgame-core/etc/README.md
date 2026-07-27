# API surface classification

- `boardgame-core.api.json` tracks the public root API surface.
- `boardgame-core-app.api.json` tracks the public React application surface.
- Engine, protocol, and migration symbols consumed by the private, exact-version `@boardoor/core-server` package are owned by the root surface; there is no catch-all internal subpath.
- `./app/test-utils` and `./testing/game-harness` remain packable experimental tooling. They are not stable API and do not share either public report.

The checked-in JSON reports are generated with the repository TypeScript compiler API. Each report records
the entry-point exports plus a SHA-256 inventory of the clean declaration closure.

Update reports intentionally with `pnpm sdk:api --update`; CI runs `pnpm release:check`, which
fails on drift.
