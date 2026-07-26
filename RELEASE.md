# Release policy

> This is a local preparation document. No release, package publication, source-authority
> promotion, or protected environment is implied.

- Public packages use SemVer and begin with prereleases such as `0.1.0-alpha.0` on the `next`
  dist-tag only after publication is authorized.
- Alpha releases may contain breaking changes. Each breaking change requires a changelog entry
  and migration note.
- `@boardoor/core` and private `@boardoor/core-server` share an exact tested candidate identity;
  the private server is not published from this repository.
- `@boardoor/ui` versions independently and must declare a supported core range plus an exact
  tested tuple in [COMPATIBILITY.md](COMPATIBILITY.md).
- Security fixes use the same artifact, provenance, compatibility, review, and protected-release
  gates as other releases.
- Stable promotion requires a successful external clean-room pilot, published-artifact install,
  typecheck/test/build evidence, an alpha upgrade exercise, a demonstrated migration procedure,
  and a finalized supported surface and known-limitations record.

## First publication bootstrap

npm Trusted Publishing is configured from an existing package's settings, so it cannot authorize
the first version of a new package. The first `@boardoor/core` and `@boardoor/ui` versions therefore
use the separate, manual `npm-bootstrap.yml` workflow only after the owner records the source
authority promotion and explicitly approves this bounded exception.

The default bootstrap method is a short-lived npm granular access token stored only as the
`NPM_BOOTSTRAP_TOKEN` secret of the protected `npm-bootstrap` environment. Grant it Boardoor
organization access and explicit read/write access to the `@boardoor` package scope (organization
access alone does not grant package publishing), enable automation 2FA bypass only for this use,
and choose the shortest practical expiry. The build job has no npm token or OIDC permission. It checks the
full reviewed `main` SHA before installing dependencies, runs all release checks, packs only the
selected package, and uploads that immutable tarball. The publish job receives only that artifact
and the environment secret; it neither checks out source nor installs repository dependencies.
The published registry tarball must match the reviewed SHA-256.

Build and pack use the exact `npm@11.5.1` development dependency resolved by the frozen public
lockfile; `scripts/release.ts` rejects any other npm CLI. This keeps owner-reviewed local and CI
tarball bytes from drifting with a runner's bundled npm patch. The publish-only job performs no
package installation: it uses Node 24.6.0's bundled npm 11.5.1 and fails if that exact version is
not present. Both publish paths use `--ignore-scripts`.

Bootstrap is resumed per package. Publish `core`, verify its registry tarball, then publish `ui`.
If `core` succeeds and `ui` fails, do not bump or republish `core`; correct the cause and dispatch
only `ui` with the same reviewed commit, version, and tarball digest. If a registry version already
exists, the workflow succeeds only when its tarball has the exact expected SHA-256.
The UI bootstrap also requires the reviewed `core` tarball SHA-256. Its build job downloads the
exact registry tarball without credentials and rejects the UI publish when that digest differs,
rather than accepting version existence alone.

After both packages exist:

1. configure the `npm-release.yml` Trusted Publishing relationship separately in each package;
2. delete `NPM_BOOTSTRAP_TOKEN` from GitHub;
3. revoke the npm granular access token; and
4. configure the packages to disallow token-based publishing.

Keep screenshots/API receipts for all four actions. Do not use `npm-bootstrap.yml` again. The owner
may choose a different first-publish method, but that remains a recorded decision gate and must
preserve protected approval, exact reviewed tarball identity, provenance, and immediate credential
revocation evidence.

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
republished because the other package failed. Exact private consumer/artifact parity is the
preceding activation-runbook gate and is not re-created from private evidence in this public
repository.

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
