# API surface classification

`boardgame-ui.api.json` tracks the optional `@boardoor/ui` root candidate. Public subpaths and the compiled `./styles/ui.css` artifact remain alpha surfaces until consumer fixtures close the compatibility matrix.

The checked-in JSON report is generated with the repository TypeScript compiler API. It records the root
exports plus a SHA-256 inventory of the clean declaration closure.

Update the report intentionally with `pnpm sdk:api --update`; CI runs `pnpm release:check`, which
fails on drift.
