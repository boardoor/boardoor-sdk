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

## Run the local candidate proof

The SDK packages are not published yet, so the repository-local proof substitutes packed
candidate tarballs for the exact versions in the example:

```bash
pnpm sdk:build
pnpm exec tsx scripts/sdk-clean-room.test.ts
pnpm exec tsx scripts/check-sdk-clean-room.ts
```

The final command copies the tutorial outside the workspace, installs from the checked frozen lock
in offline mode, then runs:

```bash
pnpm typecheck
pnpm test:run
pnpm build
```

The test lock is updated only when the exact dependency or artifact set intentionally changes:

```bash
pnpm exec tsx scripts/check-sdk-clean-room.ts --update-lock
```

After publication is separately authorized, a clean external repository can install the exact
versions in the tutorial manifest from the registry. Publication and that external pilot are
residual gates, not accomplishments claimed by this local tutorial.
