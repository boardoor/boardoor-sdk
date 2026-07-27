# Tutorial: Last Stone

Last Stone is a purpose-built, asset-free example for the public SDK. It is not derived from the
Boardoor game catalog, existing game code, branding, or game assets.

Two players alternate taking one or two stones from a pile of five. Taking more stones than remain
is illegal. The player who takes the final stone wins.

The complete standalone project is in
[`examples/sdk-tutorial/`](../../examples/sdk-tutorial/README.md).

## What the example demonstrates

- `setup` creates the initial game state.
- `take` changes state and returns `INVALID_MOVE` for an illegal overshoot.
- The engine advances `ctx.currentPlayer` after a valid move.
- `endIf` records the winner when the pile reaches zero.
- A `Client`-based Vitest test exercises the reducer without a browser.
- A small React view uses `ActionButton` and the compiled
  `@boardoor/ui/styles/ui.css` export.

The example has its own `package.json`, TypeScript config, and Vite config. It does not use
`workspace:`, `catalog:`, root TypeScript config, project references, repository source imports,
platform URLs, or static assets.

## Install and run

Install the exact versions from the registry and run the example's own checks:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:run
pnpm build
```

`@boardoor/core` and `@boardoor/ui` resolve from npm at the exact versions the tutorial manifest
pins. Both were published with OIDC provenance, so `npm audit signatures` binds the release back to
this repository and the workflow that built it.
