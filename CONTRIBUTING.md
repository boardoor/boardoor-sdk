# Contributing

Contributions are welcome through pull requests. Using or contributing to these packages does not
grant release or npm authority.

## Pull requests

- Work from a fork and submit a focused pull request.
- Complete the pull request template. Explain why each public-contract, rights, provenance, and
  verification item applies or is not applicable; an unchecked box without an explanation is not a
  review outcome.
- Add or update tests and public documentation for behavior changes.
- Do not include secrets, credentials, private source, private issue content, private URLs, or
  confidential operational details.
- Do not add source, generated content, datasets, fonts, images, audio, models, or other assets
  without documented provenance, redistribution terms, and any required notices.
- Clearly identify generated or AI-assisted content when its provenance or licensing requires
  review. DCO sign-off does not replace provenance and asset clearance.
- Keep package, API, compatibility, stability, and release-surface changes explicit for
  CODEOWNERS review.

## Developer Certificate of Origin

Every commit must certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/)
with a `Signed-off-by` trailer whose name and email match the commit author:

```text
Signed-off-by: Contributor Name <contributor@example.com>
```

Use `git commit --signoff`. By adding the trailer, you certify the DCO 1.1 for that contribution.
The DCO check is required on every pull request; a commit without a matching trailer fails it.

## Local checks

The exported repository defines its supported commands in `package.json`. Before submitting, run
the same frozen-lockfile lint, format check, tests, and build used by `.github/workflows/ci.yml`.

## Public game contributions

A game proposal is reviewed separately from SDK changes. Start from the standalone
[`examples/sdk-tutorial`](examples/sdk-tutorial/README.md) contract, place the proposed game under
a public `examples/` path, and submit it as a focused pull request. Do not combine a game intake
with a package API, version, release, or compatibility change.

The pull request must make the following reviewable from public material:

- the rules, supported player counts, setup choices, legal and illegal moves, turn/phase
  transitions, end conditions, scoring, and edge cases
- serializable game-owned state; deterministic state transitions; and a `playerView` when players
  must not receive hidden information
- legal actions from `ai.enumerate`, plus tests for `bestMove` when the optional direct evaluator is
  supplied
- reducer/client tests covering the main path, illegal moves, terminal states, and important
  boundaries
- a standalone install using exact published core/UI versions, followed by typecheck, tests,
  production build, and local preview without repository source links or a private platform
- stable translation keys and English fallbacks for user-visible copy, an explicit list of
  maintained locales, and accessible names and status messages
- the origin, rights, license, and redistribution terms for rules text, code, generated material,
  data, fonts, images, audio, models, and other assets
- saved-state expectations, including the exact game and SDK versions that can read a save and a
  migration or clean-break plan when state shape changes

Use the standard pull request template and explain each public-contract, verification, and
provenance item. Passing intake review means only that the pull request may be considered for this
public repository. It does not promise merge, catalog admission, production hosting, deployment,
promotion, release authority, or ongoing production support. Those services and decisions are
outside this repository.
