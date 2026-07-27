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
