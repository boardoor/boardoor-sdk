# Release policy

- Public packages use SemVer and begin with prereleases. `@boardoor/core@0.1.0-alpha.0` and
  `@boardoor/ui@0.1.0-alpha.0` were published on 2026-07-26 with OIDC provenance. Both carry the
  `next` tag; `latest` also points at them only because no other version exists yet, and it moves
  to the first stable release.
- Alpha releases may contain breaking changes. Each breaking change requires a changelog entry
  and migration note.
- `@boardoor/core` and the private `@boardoor/core-server` share an exact tested identity; the
  private server is not published from this repository and is not a public surface.
- `@boardoor/ui` versions independently and must declare a supported core range plus an exact
  tested tuple in [COMPATIBILITY.md](COMPATIBILITY.md).
- Security fixes use the same artifact, provenance, compatibility, review, and protected-release
  gates as other releases.
- Stable promotion requires a successful external clean-room pilot, published-artifact install,
  typecheck/test/build evidence, an alpha upgrade exercise, a demonstrated migration procedure,
  and a finalized supported surface and known-limitations record.

## How the first version was published

npm configures Trusted Publishing from an existing package's settings, so it cannot authorize the
very first version of a new package. Rather than create a publishing token for that one operation,
the first versions were published by registering the package with a throwaway `0.0.0`, configuring
the Trusted Publisher on the now-existing package, publishing the real version over OIDC through
`npm-release.yml`, and unpublishing the placeholder. **No bypass token was ever issued**, and the
`npm-bootstrap.yml` workflow it would have used has been removed along with its environment.

Both packages then had Trusted Publishing bound to this repository and `npm-release.yml`, with the
`npm publish` action only, and token-based publishing disallowed. Every later release uses the
steady workflow below.

## Steady releases

The steady npm workflow is manual, GitHub-hosted, secretless, OIDC-based, and bound to the protected
`npm-release` environment. Each package's Trusted Publisher allows only the `npm publish` action
and binds the exact `npm-release.yml` workflow. It operates on one package per dispatch and requires the package,
full reviewed commit SHA, exact version, and exact tarball SHA-256. The build job checks that the
requested commit is the checked-out `main` tip before dependency installation, has no `id-token`
permission, runs the full release checks, and uploads one immutable package tarball. The publish
job has `id-token: write` but no source checkout, dependency installation, cache, or npm token; it
downloads and validates only the reviewed artifact and publishes it with provenance to `next`.
It then verifies that the registry tarball has the reviewed SHA-256.

`@boardoor/core` and `@boardoor/ui` are independent resume units. A completed package is never
republished because the other package failed. Verification against private consumers happens
before a release is dispatched and is not reproduced from private evidence in this repository.

Initial operation is explicitly single-operator: the authorized owner's manual workflow dispatch
is the live publication approval, both environments have zero required reviewers, and
`prevent_self_review` is off. This avoids making owner-authored maintenance impossible while no
active reviewer exists. The compensating controls are exact reviewed inputs, protected `main`,
required CI and DCO, conversation resolution, direct-push/force-push/deletion protection, immutable
artifact verification, and no routine bypass. CODEOWNERS remains routing and ownership metadata.

When a reviewer who will actively review routine changes joins, strengthen the repository to one
required approval plus required CODEOWNER review and both environments to one required reviewer
with `prevent_self_review` enabled. Canary and record those effective settings before describing the
stronger gate as active.

`pnpm sbom:check` binds the checked-in CycloneDX inventory to both publish manifests and rejects
private verifier metadata. When dependencies change after authority promotion, regenerate the
resolved SBOM from the public frozen lock with the project-approved pinned CycloneDX tool, review
license changes, and commit it with the lock/package change before `release:check` can pass.
