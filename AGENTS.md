# AGENTS.md

This repository is the public source authority for `@boardoor/core` and
`@boardoor/ui` after the publication authority gate recorded by the Boardoor
maintainers. It must remain usable without the private Boardoor platform.

## Repository boundary

- Run commands from this repository root.
- Do not request, copy, or infer private platform source, private issues,
  credentials, production data, unpublished security details, or private agent
  state.
- Do not resolve dependencies through another repository, a parent workspace,
  local source links, or a shared uncommitted checkout.
- Cross-repository compatibility is established with packed or published SDK
  artifacts and exact commit and digest records, never with workspace links.

## Development

- Use the pinned Node and pnpm versions from `package.json`.
- Install with `pnpm install --frozen-lockfile`.
- Before submitting a change, run `pnpm lint`, `pnpm format:check`,
  `pnpm test:run`, and `pnpm release:check`.
- Treat API reports, package manifests, lockfiles, packed inventories, tests,
  and release checks as authority. CodeGraph is an optional repo-local
  diagnostic; do not require or share a derived index.
- Public API, tutorial, compatibility, stability, release, security, and
  contribution documentation are authoritative in this repository.

## Git and DCO

- Keep changes and commits scoped to this repository.
- Every commit must include a DCO `Signed-off-by` trailer. Create commits with
  `git commit --signoff`; amend an unsigned local commit before sharing it.
- Do not use an agent or editor commit command unless it is known to preserve
  `--signoff`. In particular, replace a plain `git commit` proposed by a generic
  commit command with `git commit --signoff`.
- Never push, publish, change repository settings, or activate release authority
  unless the current task explicitly grants that external authority.

