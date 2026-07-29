# Tutorial: create Last Stone from a standalone template

Last Stone is a purpose-built, asset-free example for the public SDK. It is not derived from the
Boardoor game catalog, existing game code, branding, or game assets. Two players alternate taking
one or two stones from a pile of five; taking more stones than remain is illegal, and the player
who takes the final stone wins.

This tutorial uses the exact published compatibility tuple:

- `@boardoor/core@0.1.0-alpha.0`
- `@boardoor/ui@0.1.0-alpha.0`

Both packages are alpha surfaces. Before relying on another tuple, check
[COMPATIBILITY.md](COMPATIBILITY.md) and verify the package and provenance on npm.

## 1. Copy the template into an empty project

Use Node `>=22.22.0 <23` and pnpm `11.10.0`, as pinned by the template. From the directory where
you keep projects:

```bash
git clone https://github.com/boardoor/boardoor-sdk.git
cd boardoor-sdk
mkdir ../last-stone
cp -R examples/sdk-tutorial/. ../last-stone/
cd ../last-stone
pnpm install --frozen-lockfile
```

Copy the template before installing the SDK repository so `node_modules` and build output are not
copied. The destination is outside the SDK workspace: its lockfile therefore resolves the exact
published packages from the registry, not repository sources or workspace links.

Run the focused checks:

```bash
pnpm typecheck
pnpm test:run
pnpm build
pnpm preview
```

Open the local URL printed by Vite. `pnpm dev` is available while editing; `pnpm preview` serves
the production build locally. Neither command needs a Boardoor platform checkout or service.

## 2. Know the project structure

```text
last-stone/
├── src/
│   ├── game.ts       # state, rules, moves, end condition, and AI contract
│   ├── game.test.ts  # reducer/client and AI tests
│   ├── App.tsx       # React client subscription and controls
│   ├── main.tsx      # browser entry and UI stylesheet
│   └── style.css     # game-owned presentation
├── index.html
├── LICENSE           # MIT terms retained by the copied project
├── NOTICE            # Boardoor attribution and dependency-notice pointer
├── package.json      # exact runtime and tool versions
├── pnpm-lock.yaml    # standalone registry resolution
├── tsconfig.json
└── vite.config.ts
```

Keep game rules in `game.ts`, independent of React. That makes the same `Game` object usable by
tests, local clients, AI, and a browser UI.

## 3. Model state and rules

[`src/game.ts`](examples/sdk-tutorial/src/game.ts) defines the game-owned `G` state:

```ts
type LastStoneState = {
  remaining: number;
  lastTake: { player: string; count: 1 | 2 } | null;
};
```

State should be serializable data rather than component instances, DOM nodes, functions, or
process-local handles. Store facts needed to reconstruct play; derive labels and presentation in
the UI. If a real game has hidden information, add a `playerView` so a client receives only what
that player may see.

The exported `LastStone: Game<LastStoneState>` owns the rules:

- `setup` creates five stones and no previous move.
- `minPlayers` and `maxPlayers` make the two-player contract explicit.
- `turn.minMoves` and `turn.maxMoves` allow exactly one move before advancing the turn.
- `moves.take` mutates the engine-provided draft. It returns `INVALID_MOVE` for a count other than
  one or two, or for an overshoot; invalid moves do not change state or advance the turn.
- `endIf` records the current player as winner when no stones remain.

For a larger game, document setup variants, every legal and illegal action, phase/turn changes,
scoring, ties, and boundary cases before building the UI. Rules text and any adapted mechanics or
assets must have reviewable public provenance and redistribution terms.

## 4. Enumerate AI actions and optionally choose a best move

`Game.ai.enumerate(G, ctx, playerID)` is the baseline AI contract. Return only actions that are
legal for that player in that state:

```ts
[
  { move: 'take', args: [1] },
  { move: 'take', args: [2] },
];
```

Last Stone returns no actions after game over or for a player whose turn it is not, and removes
“take two” when only one stone remains. `RandomBot` and `MCTSBot` can consume this enumerator;
complete legal enumeration matters more than clever scoring.

`Game.ai.bestMove` is optional. It may return a move synchronously or asynchronously, or `null`
when there is no action. The example uses the same `chooseBestMove` helper for the hook and the
blue suggestion button. Its small deterministic policy leaves a multiple of three where possible.
Consumers that call the hook generically should handle both sync and async implementations:

```ts
const suggestion = await game.ai?.bestMove?.(G, ctx, playerID, 'medium');
if (suggestion) client.moves[suggestion.move](...suggestion.args);
```

Treat a suggestion as an untrusted action name and arguments at an application boundary; the move
must still enforce legality. Add tests showing that enumeration never offers an illegal action and
that `bestMove`, when present, returns one of the legal actions.

## 5. Test the reducer through a client

[`src/game.test.ts`](examples/sdk-tutorial/src/game.test.ts) creates an in-memory `Client`, starts
it, sends moves, and reads the resulting reducer state. The tests cover:

- taking one and two stones and advancing the current player
- rejecting an overshoot without changing state or turn
- recording the winner after the final stone
- legal enumeration, direct best-move output, and non-current-player rejection

This style needs no browser and exercises the public client/reducer path. Add cases for every
terminal result and rule boundary in your own game. UI tests should separately assert controls,
labels, disabled states, and announcements that the reducer test cannot observe.

## 6. Render with the optional UI package

[`src/App.tsx`](examples/sdk-tutorial/src/App.tsx) creates a local `Client`, subscribes React state
to it, and dispatches moves from `ActionButton` controls. The client is stopped when the component
unmounts. [`src/main.tsx`](examples/sdk-tutorial/src/main.tsx) imports the compiled public
stylesheet once:

```ts
import '@boardoor/ui/styles/ui.css';
```

`@boardoor/ui` is an opinionated optional alpha companion, not a complete game shell. The game
still owns its rules-specific layout, meaningful accessible labels, disabled-state logic, and
status announcements.

Last Stone keeps its few teaching strings in English. For a reviewed public game, keep
user-visible copy out of `G` and move names, use stable translation keys with English fallbacks,
declare only locales you maintain, and test missing-key and variable-interpolation behavior.
`@boardoor/ui` components can use `react-i18next` and fall back to English when no provider is
initialized, but that fallback does not localize game-specific rules or labels.

## 7. Build and preview each change

Before sharing the project, repeat:

```bash
pnpm typecheck
pnpm test:run
pnpm build
pnpm preview
```

The build must succeed from the copied directory with its frozen lockfile. Do not replace exact SDK
versions with `workspace:`, `catalog:`, local tarballs, source imports, or links into another
checkout when claiming public compatibility.

## Alpha and saved-state limits

The documented core surface and optional UI are alpha: incompatible changes may occur before a
stable release, with release notes and migration guidance. Experimental subpaths have weaker
guarantees; see [STABILITY.md](STABILITY.md).

This tutorial uses only in-memory state and promises no durable-save compatibility. A serialized
engine state is coupled to its exact SDK version, game version, setup contract, and `G` schema.
The public SDK does not promise that a later alpha or a changed game can read an older save. If
your game persists state, record those versions with every save, preserve fixtures, test the
entire undo/redo history, and provide either a reviewed migration path or an explicit clean break.
Do not describe the experimental migration surface as stable support.

## Propose a public game

Keep a game proposal separate from SDK API or release changes and follow the
[public game contribution process](CONTRIBUTING.md#public-game-contributions). That intake requires
public rules, rights and asset provenance, i18n expectations, reducer/client tests, AI legality,
saved-state policy, and a standalone build.

Review or merge in this repository does not imply Boardoor catalog admission, production hosting,
deployment, promotion, release authority, or ongoing production support.
