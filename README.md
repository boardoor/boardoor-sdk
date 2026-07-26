# Boardoor SDK

This repository contains the public source for `@boardoor/core` and `@boardoor/ui`. A tagged source
commit is not by itself evidence that the corresponding npm packages were published; verify the
release and provenance on npm.

## Intended contents

- `@boardoor/core`: alpha-supported game engine and documented public subpaths
- `@boardoor/ui`: opinionated optional alpha companion UI with an independently versioned
  compatibility contract, not a general-purpose design system
- public developer documentation, examples, fixtures, and tests

Private platform services, credentials, deployment configuration, authentication, billing,
storage, and `@boardoor/core-server` are out of scope.

## Core debug panel

`@boardoor/core` includes a small, dependency-free Boardoor Debug panel for local development. It
shows the current client state, switches between registered player clients, and provides
undo/redo/reset controls. The panel preserves the existing `debug` option, `collapseOnLoad`,
`hideToggleButton`, custom `target`, and custom `impl` contract.

The default panel toggles with <kbd>Ctrl</kbd>+<kbd>?</kbd>, except while focus is in an editable
control. A custom `debug.impl` owns its own keyboard interaction and does not receive synthetic
keyboard events from the client manager.

The default panel is not mounted in production unless the application explicitly passes a
`debug` option. It intentionally does not reproduce boardgame.io's legacy Svelte move editor,
MCTS controls, or JSON-tree UI. Applications needing specialized diagnostics should pass their
own `debug.impl`.

## Maintainer release checks

1. Confirm the support, release, stability, and compatibility documents against the reviewed
   candidate.
2. Run the secret, provenance, license, SBOM, URL, build, test, and clean-checkout gates.
3. Apply and independently verify the settings in
   [`.github/repository-settings.yml`](.github/repository-settings.yml). A checked-in file cannot
   activate GitHub settings or install the DCO App.

## Policies

- [Contributing](CONTRIBUTING.md)
- [Governance](GOVERNANCE.md)
- [Security](SECURITY.md)
- [Support](SUPPORT.md)
- [Release policy](RELEASE.md)
- [Surface stability](STABILITY.md)
- [Core/UI compatibility](COMPATIBILITY.md)
- [Last Stone tutorial](TUTORIAL.md)
- [CycloneDX SBOM](sbom.cdx.json)
- [License](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md)

