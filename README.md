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
3. Apply only `desired_configuration_now` and the applicable `remediation` entries from
   [`.github/repository-settings.json`](.github/repository-settings.json), then independently
   verify them against the authoritative live GitHub and npm settings and APIs. The dated
   `observed_snapshot` is evidence to review, not configuration to apply. Apply
   `future_reviewer_configuration` only after an active reviewer joins and its canary succeeds. A
   checked-in file cannot activate settings or install the DCO App.

Repository security-control state, owner decisions, and transition remediations are maintained in
the exact settings record and the state-dependent [security policy](SECURITY.md), not in this
overview. Do not infer that a mutable live control is active or pending from README prose.

`PUBLICATION_MANIFEST.json` is immutable evidence for the initial public export at its recorded
commit and path set. It is not an inventory of the current tree and must not be regenerated during
later public maintenance.

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
