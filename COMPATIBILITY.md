# Core and UI compatibility

The initial candidate intends to test the following exact public tuple:

| Core                           | UI                           | UI supported core range | Evidence required                                               |
| ------------------------------ | ---------------------------- | ----------------------- | --------------------------------------------------------------- |
| `@boardoor/core@0.1.0-alpha.0` | `@boardoor/ui@0.1.0-alpha.0` | `0.1.0-alpha.0`         | packed install, typecheck, game-logic test, production UI build |

This is a local candidate pointer, not a publication record. Before repository creation or
release, replace it with a generated compatibility matrix tied to the exported commit, exact
artifact digests, and completed verification.

The private `@boardoor/core-server` must consume the exact core candidate and pass reducer-parity
verification, but it is not a public package or source surface. The UI range must not be widened
without testing and recording each additional combination.
