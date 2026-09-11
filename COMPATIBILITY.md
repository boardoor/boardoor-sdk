# Core and UI compatibility

The historical initial public tuple is published and tested:

| Core                           | UI                           | UI supported core range | Evidence required                                               |
| ------------------------------ | ---------------------------- | ----------------------- | --------------------------------------------------------------- |
| `@boardoor/core@0.1.0-alpha.0` | `@boardoor/ui@0.1.0-alpha.0` | `0.1.0-alpha.0`         | registry install, typecheck, game-logic test, production UI build |

Both packages were published on 2026-07-26 with OIDC provenance; verify the release and its
attestation on npm rather than treating this table as the authority.

The private `@boardoor/core-server` consumes the same exact core version and is verified against
it before release, but it is not a public package or source surface. The UI range is not widened
without testing and recording each additional combination.

The current prerelease tuple is `@boardoor/core@0.1.0-alpha.1` with
`@boardoor/ui@0.1.0-alpha.1`; UI supports exactly `0.1.0-alpha.1`.
Both were published through the protected workflow from merged commit
`84928505d97963a1f712c01deba28020a60e74f0`, core first and then UI:
[core release](https://github.com/boardoor/boardoor-sdk/actions/runs/34566564386),
[UI release](https://github.com/boardoor/boardoor-sdk/actions/runs/34566827259).
Both runs passed the full artifact checks and registry digest gate. Independent
registry downloads match the reviewed SHA-256 digests:

- core: `13a58def9bc0b19bbb8bcbc4534e244a055743b519ef6c51d4c9b365bbe2e42d`
- UI: `5c8cc68ae9e25d7efe1db10d5fa99649fd43e6dc8daea3c627a105340a43ea77`

`next` points to alpha.1 for both packages; `latest` remains alpha.0.
Packed consumer checks passed before dispatch. Registry metadata and digest
observations do not replace cryptographic provenance identity verification for
an already-published-version resume; the fail-closed release policy still applies.
