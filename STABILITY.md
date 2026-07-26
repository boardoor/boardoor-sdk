# Surface stability

| Surface                                | Initial classification                |
| -------------------------------------- | ------------------------------------- |
| `@boardoor/core`                       | alpha supported                       |
| `@boardoor/core/app`                   | alpha supported                       |
| `@boardoor/core/app/test-utils`        | experimental                          |
| `@boardoor/core/testing/game-harness`  | experimental                          |
| `@boardoor/ui` and documented subpaths | optional alpha surface                |
| `@boardoor/core-server`                | private, version-coupled, unpublished |

No `@boardoor/core/internal` or replacement catch-all subpath is part of the public contract.
Alpha-supported surfaces can still change incompatibly before stable release; breaking changes
require release notes and migration guidance. Experimental surfaces have weaker compatibility
expectations and may change or be removed in alpha releases.

This table must be checked against the exact reviewed export and API report before publication.
See [RELEASE.md](RELEASE.md) and [COMPATIBILITY.md](COMPATIBILITY.md).
