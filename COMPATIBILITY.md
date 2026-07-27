# Core and UI compatibility

The following exact public tuple is published and tested:

| Core                           | UI                           | UI supported core range | Evidence required                                               |
| ------------------------------ | ---------------------------- | ----------------------- | --------------------------------------------------------------- |
| `@boardoor/core@0.1.0-alpha.0` | `@boardoor/ui@0.1.0-alpha.0` | `0.1.0-alpha.0`         | registry install, typecheck, game-logic test, production UI build |

Both packages were published on 2026-07-26 with OIDC provenance; verify the release and its
attestation on npm rather than treating this table as the authority.

The private `@boardoor/core-server` consumes the same exact core version and is verified against
it before release, but it is not a public package or source surface. The UI range is not widened
without testing and recording each additional combination.
