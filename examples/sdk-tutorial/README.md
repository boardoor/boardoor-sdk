# Last Stone SDK tutorial

Last Stone is a deliberately small, asset-free game. Two players alternate taking one or two
stones. The player who takes the final stone wins.

Install the exact dependencies in `package.json`, then run:

```sh
pnpm typecheck
pnpm test:run
pnpm build
```

`src/game.ts` demonstrates setup, move validation with `INVALID_MOVE`, normal turn transitions,
and an `endIf` win condition. The Client-based test verifies the rules without a browser.
`src/App.tsx` is a minimal local React interface that reuses `ActionButton` and the public UI
stylesheet.
