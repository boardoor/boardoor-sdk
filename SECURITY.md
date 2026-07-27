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

As observed on 2026-07-27, repository secret scanning/user alerts, push protection, non-provider
patterns, and validity checks are disabled and remain exact owner enablement remediations.
Dependabot vulnerability alerts are enabled, while Dependabot security updates are disabled
pending an explicit owner decision between automated security-update pull requests and a documented
manual dependency-security triage policy. The checked-in settings record describes the desired
controls and outstanding decisions; it does not make them active.

GitHub Actions currently permits all actions and does not enforce SHA pinning at the repository
setting, although the checked-in workflows use full commit SHAs. Enabling repository SHA-pinning
enforcement and applying the recorded selected-actions policy are owner remediations. That policy
must permit GitHub-owned actions and `pnpm/action-setup` or the current CI and release workflows
will stop.

If the owner selects manual dependency-security handling, maintainers review dependency advisories
and available security releases, open a signed-off update pull request when action is needed, and
record any deliberate deferral with its risk and next review point.
