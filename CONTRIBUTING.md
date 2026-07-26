# Contributing

This file is a local template for the future public repository. Until that repository exists and
its rules are verified, it does not open a contribution channel.

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
The DCO GitHub App must enforce this on every commit once installed and verified; the checked-in
template cannot install or activate the App.

## Local checks

The exported repository defines its supported commands in `package.json`. Before submitting, run
the same frozen-lockfile lint, format check, tests, and build used by `.github/workflows/ci.yml`.
