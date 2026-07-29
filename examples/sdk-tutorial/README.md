# Last Stone SDK tutorial

Last Stone is a deliberately small, asset-free game. Two players alternate taking one or two
stones. The player who takes the final stone wins.

This directory is a copyable standalone template. Its manifest and lockfile pin the published
`@boardoor/core@0.1.0-alpha.0` and `@boardoor/ui@0.1.0-alpha.0` tuple; it has no private platform or
repository-source dependency.

For the canonical copy-from-an-empty-directory journey, start with the
[public repository tutorial](https://github.com/boardoor/boardoor-sdk/blob/main/TUTORIAL.md). Once
copied outside the SDK workspace, install and check the template:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:run
pnpm build
pnpm preview
```

`src/game.ts` demonstrates setup, move validation with `INVALID_MOVE`, normal turn transitions,
an `endIf` win condition, legal-move enumeration, and the optional direct `bestMove` hook. The
Client-based test verifies reducer behavior without a browser. `src/App.tsx` is a minimal local
React interface that reuses `ActionButton` and the public UI stylesheet.

The source is intentionally small:

- `src/game.ts`: serializable game-owned state, moves, end condition, and AI hooks
- `src/game.test.ts`: reducer/client and AI-contract tests
- `src/App.tsx`: React subscription and move controls
- `src/main.tsx`: browser entry point and the required UI stylesheet import
- `src/style.css`: game-owned presentation
- `vite.config.ts` and `tsconfig.json`: standalone build and typecheck configuration
- `LICENSE` and `NOTICE`: terms and attribution that remain with a copied project

The UI text is English-only for this teaching example. A reviewed public game should keep
user-visible copy out of state and moves, use stable translation keys with an English fallback,
and document which locales it actually maintains. See the
[public game contribution intake](https://github.com/boardoor/boardoor-sdk/blob/main/CONTRIBUTING.md#public-game-contributions).
