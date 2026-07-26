# API surface classification

- `boardgame-core.api.json` tracks the public root candidate.
- `boardgame-core-app.api.json` tracks the public React application candidate.
- Engine, protocol, and migration symbols consumed by the private, exact-version `@boardoor/core-server` package are owned by the root candidate; there is no catch-all internal subpath.
- `./app/test-utils` and `./testing/game-harness` remain packable experimental tooling. They are not stable API and do not share either public report in this slice.
- `archive/d017-gate2-internal-seam/` retains the immutable pre-removal internal seam report, candidate record, and attestation required by ADR-003. It is historical evidence, not a live publication contract.

The checked-in JSON reports are generated with the repository TypeScript compiler API. Each report records
the entry-point exports plus a SHA-256 inventory of the clean declaration closure.

Update reports intentionally with `pnpm sdk:api:update`; CI uses `pnpm sdk:artifacts` and fails on drift.
