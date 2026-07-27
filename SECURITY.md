# Security policy

## Reporting a vulnerability

Use this repository's GitHub **Private vulnerability reporting** form, available from the
repository's **Security** tab. Do not disclose suspected vulnerabilities in a public issue,
discussion, pull request, or commit. There is no separate reporting email address.

## Scope and response

Reports about published SDK packages and documented public source are in scope. Private Boardoor
platform operations, credentials, accounts, and production incidents are not managed through this
public repository.

Support is best effort during alpha; no response-time or remediation SLA is promised. Authorized
maintainers coordinate disclosure and release any fix through the normal provenance,
compatibility, review, and protected-release gates.

GitHub private vulnerability reporting was verified as enabled for this repository on
2026-07-27. The live setting remains the authority; if the private reporting form is not
available, do not substitute a public issue or pull request.

## Repository security controls

Live repository security state verified on 2026-07-27: secret scanning/user alerts enabled; push protection enabled; non-provider patterns disabled; validity checks disabled.
The two disabled controls require GitHub Team with GitHub Secret Protection and are unavailable
under the current repository plan. They remain desired controls if that capability becomes
available.

Dependabot vulnerability alerts are enabled. The manual dependency-security policy was selected on
2026-07-27. Automated Dependabot security-update pull requests remain disabled. Maintainers review
dependency advisories and available security releases, open a signed-off update pull request when
action is needed, and record any deliberate deferral with its risk and next review point.

GitHub Actions selected-actions policy and repository SHA pinning were verified active on
2026-07-27. GitHub-owned actions are allowed, verified Marketplace creators are not allowed as a
blanket class, and the only third-party pattern is `pnpm/action-setup@*`. Workflows continue to pin
every `uses:` entry to a full commit SHA.
