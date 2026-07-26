# `@boardoor/ui`

`@boardoor/ui` is an opinionated alpha companion to `@boardoor/core`. It contains the reusable
interaction and layout primitives used by Boardoor games; it is not a general-purpose design
system. Before the stable release, component names, visual tokens, and markup may change with
release notes and migration guidance.

## Installation and styles

Install the exact core/UI pair from the repository compatibility matrix, then import the compiled
stylesheet once in the application entry point:

```tsx
import { ActionButton, GameOverOverlay } from '@boardoor/ui';
import '@boardoor/ui/styles/ui.css';
```

The package expects a React application and an optional `react-i18next` provider. Components use
English fallbacks when no i18n provider is installed.

## Public subpaths

- `@boardoor/ui`: components, hooks, and share-card helpers
- `@boardoor/ui/playing-cards`: card sorting and display types
- `@boardoor/ui/layout`: table-position calculations
- `@boardoor/ui/genre`: grid, hand, score, and trick-taking layout primitives
- `@boardoor/ui/locales`: Boardoor UI locale resources
- `@boardoor/ui/audio`: synthesized game-sound helpers
- `@boardoor/ui/styles/ui.css`: required compiled component styles

## Accessibility contract

Interactive primitives use native buttons and do not submit surrounding forms unless a consumer
explicitly passes `type="submit"`. Consumers remain responsible for meaningful board/card labels,
disabled-state rules, color contrast after overriding classes, and an application-level path out
of a game-over dialog.

`GameOverOverlay` moves focus into its alert dialog when shown and restores the previously focused
element when removed. `ReconnectBanner` and `LoadingScreen` expose status updates to assistive
technology.

See the repository-root
[`STABILITY.md`](https://github.com/boardoor/boardoor-sdk/blob/main/STABILITY.md) and
[`COMPATIBILITY.md`](https://github.com/boardoor/boardoor-sdk/blob/main/COMPATIBILITY.md) for the
alpha support and exact core/UI version contract.
