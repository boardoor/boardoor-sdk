# `@boardoor/core`

`@boardoor/core` is the alpha game engine and client runtime behind Boardoor games. It provides the
turn/phase/move state machine, the local and WebSocket client transports, the bot implementations,
a React application entry point, and a testing harness for game logic. Before the stable release,
exported names and behaviour may change with release notes and migration guidance.

The engine is modified boardgame.io v0.50.2 source rather than a dependency on that package; the
exact upstream commit and the modification statement are recorded in
[`EMBEDDED_COMPONENTS.json`](https://github.com/boardoor/boardoor-sdk/blob/main/packages/boardgame-core/EMBEDDED_COMPONENTS.json)
and in the repository's third-party notices. Upstream is MIT licensed and its notice travels with
this package.

## Installation

Install the exact core/UI pair from the repository compatibility matrix:

```bash
npm install @boardoor/core@0.1.0-alpha.0
```

All peer dependencies are optional. `react` and `react-dom` (>=18) are needed only for the React
entry point; `i18next` (>=23) and `react-i18next` (>=14) only when you want localized strings, and
components fall back to English without them. The engine itself has no React dependency.

## Public subpaths

- `@boardoor/core`: game definition types, the reducer and turn-order primitives, `Client`, the
  `Local` and `Remote` transports, and the `RandomBot` / `MCTSBot` / `DeterminizedBot` bots
- `@boardoor/core/app`: `createGameApp()` and the React hooks a game application uses to render a
  client, including the built-in debug panel
- `@boardoor/core/app/test-utils`: helpers for testing an application built with `createGameApp()`
- `@boardoor/core/testing/game-harness`: a harness for driving a game definition in tests without a
  UI

## Minimal game

```ts
import { INVALID_MOVE, type Game } from '@boardoor/core';

const TicTacToe: Game = {
  setup: () => ({ cells: Array(9).fill(null) }),
  moves: {
    click({ G, playerID }, id: number) {
      if (G.cells[id] !== null) return INVALID_MOVE;
      G.cells[id] = playerID;
    },
  },
};
```

Moves mutate a draft of `G`, so they read as direct assignment and still produce immutable state.
Nothing above imports React, so game logic is testable on its own — see the harness subpath.

To render it, `createGameApp` mounts the client and passes the live clients to a board component:

```tsx
import { createGameApp } from '@boardoor/core/app';

createGameApp({
  game: TicTacToe,
  board: ({ clients }) => <Board client={clients[0]} />,
});
```

## Debug panel

The React entry point ships a small dependency-free debug panel for local development: current
client state, player-client switching, and undo/redo/reset. It toggles with
<kbd>Ctrl</kbd>+<kbd>?</kbd> and is not mounted unless the application passes a `debug` option. It
does not reproduce boardgame.io's legacy Svelte move editor, MCTS controls, or JSON-tree UI; pass
your own `debug.impl` for specialised diagnostics.

## Support

See the repository-root
[`STABILITY.md`](https://github.com/boardoor/boardoor-sdk/blob/main/STABILITY.md),
[`COMPATIBILITY.md`](https://github.com/boardoor/boardoor-sdk/blob/main/COMPATIBILITY.md), and
[`SUPPORT.md`](https://github.com/boardoor/boardoor-sdk/blob/main/SUPPORT.md) for the alpha support
window and the exact core/UI version contract.
