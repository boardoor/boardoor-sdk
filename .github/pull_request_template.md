## Summary

Describe the change and the public behavior or maintenance goal it addresses.

## Public contract and compatibility

- [ ] I identified every affected package, export subpath, API, stability, compatibility, or release
      surface, or explained why none are affected.
- [ ] I added or updated tests and public documentation for behavior changes.
- [ ] I checked the packed artifact identity and inventory through `pnpm release:check`.
- [ ] I documented any breaking change and its migration or recovery path, or confirmed that the
      change is backward compatible.

## Rights, provenance, and disclosure

- [ ] New or changed source, generated content, datasets, fonts, images, audio, models, and other
      assets have documented origin, redistribution terms, and required notices.
- [ ] The change contains no private source, issue content, credentials, production data, private
      URLs, or confidential operational details.
- [ ] Generated or AI-assisted content is identified when its provenance or licensing requires
      review.

## Verification

- [ ] `pnpm lint`
- [ ] `pnpm format:check`
- [ ] `pnpm test:run`
- [ ] `pnpm release:check`

Explain any item that is not applicable. An unchecked box without an explanation is not a review
outcome.
