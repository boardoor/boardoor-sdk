import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { validatePublicState } from './check-public-state.ts';

type JsonObject = Record<string, unknown>;

const root = process.cwd();
const presentSettings = readFileSync(join(root, '.github/repository-settings.json'), 'utf8');
const presentRelease = readFileSync(join(root, 'RELEASE.md'), 'utf8');
const security = readFileSync(join(root, 'SECURITY.md'), 'utf8');
const workflow = readFileSync(join(root, '.github/workflows/npm-release.yml'), 'utf8');

function parseSettings(): JsonObject {
  return JSON.parse(presentSettings) as JsonObject;
}

function objectAt(parent: JsonObject, key: string): JsonObject {
  const value = parent[key];
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as JsonObject;
}

function arrayAt(parent: JsonObject, key: string): unknown[] {
  const value = parent[key];
  assert(Array.isArray(value));
  return value;
}

function removeRemediation(settings: JsonObject, action: string): void {
  const remediation = arrayAt(settings, 'remediation');
  const index = remediation.indexOf(action);
  assert(index >= 0);
  remediation.splice(index, 1);
}

function validate(
  settings: string,
  release = presentRelease,
  releaseWorkflow = workflow,
  securityDocument = security,
): string[] {
  return validatePublicState({
    settings,
    release,
    security: securityDocument,
    workflow: releaseWorkflow,
  });
}

assert.deepEqual(
  validate(presentSettings),
  [],
  'present transition should be internally consistent',
);

const absent = parseSettings();
objectAt(absent, 'observed_snapshot').retired_release_environment = {
  state: 'absent',
  name: 'npm-bootstrap',
};
arrayAt(absent, 'remediation').shift();
const absentRelease = presentRelease.replace(
  /The empty `npm-bootstrap`\nenvironment still exists[^.]+\./,
  'The `npm-bootstrap` environment is absent.',
);
assert.deepEqual(
  validate(`${JSON.stringify(absent, null, 2)}\n`, absentRelease),
  [],
  'same-day absent transition should omit deletion fields, action, remediation, and prose',
);

function observedSecurity(settings: JsonObject): JsonObject {
  return objectAt(objectAt(settings, 'observed_snapshot'), 'repository_security');
}

function desiredSecurity(settings: JsonObject): JsonObject {
  return objectAt(objectAt(settings, 'desired_configuration_now'), 'repository_security');
}

const scanningEnabled = parseSettings();
observedSecurity(scanningEnabled).secret_scanning = 'enabled';
observedSecurity(scanningEnabled).secret_scanning_push_protection = 'enabled';
observedSecurity(scanningEnabled).secret_scanning_non_provider_patterns = 'enabled';
observedSecurity(scanningEnabled).secret_scanning_validity_checks = 'enabled';
removeRemediation(
  scanningEnabled,
  'enable_repository_secret_scanning_and_user_alerts',
);
removeRemediation(scanningEnabled, 'enable_secret_scanning_push_protection');
removeRemediation(scanningEnabled, 'enable_secret_scanning_non_provider_patterns');
removeRemediation(scanningEnabled, 'enable_secret_scanning_validity_checks');
const scanningEnabledSecurity = security.replace(
  /As observed on 2026-07-27, repository secret scanning[\s\S]*?enablement remediations\./,
  'Repository secret scanning/user alerts, push protection, non-provider patterns, and ' +
    'validity checks were verified enabled on 2026-07-27.',
);
assert.deepEqual(
  validate(JSON.stringify(scanningEnabled), presentRelease, workflow, scanningEnabledSecurity),
  [],
  'verified secret scanning controls should remove their remediations',
);

const actionsPolicyApplied = parseSettings();
objectAt(actionsPolicyApplied, 'observed_snapshot').actions = {
  enabled: true,
  allowed_actions: 'selected',
  sha_pinning_required: true,
  github_owned_allowed: true,
  verified_allowed: false,
  patterns_allowed: ['pnpm/action-setup@*'],
  default_token: 'read_only',
  allow_actions_to_create_or_approve_pull_requests: false,
  fork_pull_request_approval: 'all_external_contributors',
  self_hosted_runner_for_fork_code: 'forbidden',
};
removeRemediation(actionsPolicyApplied, 'enable_actions_full_sha_pinning');
removeRemediation(
  actionsPolicyApplied,
  'apply_selected_actions_policy_with_github_owned_and_pnpm_action_setup',
);
const actionsPolicyAppliedSecurity = security.replace(
  /GitHub Actions currently permits[\s\S]*?will stop\./,
  'GitHub Actions selected-actions policy and repository SHA pinning were verified active on ' +
    '2026-07-27.',
);
assert.deepEqual(
  validate(
    JSON.stringify(actionsPolicyApplied),
    presentRelease,
    workflow,
    actionsPolicyAppliedSecurity,
  ),
  [],
  'applied selected-actions and SHA-pinning controls should remove their remediations',
);
assert.match(
  validate(JSON.stringify(actionsPolicyApplied)).join('\n'),
  /applied Actions state prohibits stale all\/no-pinning prose/,
  'applied Actions state must reject stale current-state SECURITY prose',
);

const missingStrictPolicy = parseSettings();
delete objectAt(objectAt(missingStrictPolicy, 'observed_snapshot'), 'ruleset')
  .strict_required_status_checks_policy;
assert.match(
  validate(JSON.stringify(missingStrictPolicy)).join('\n'),
  /strict_required_status_checks_policy: missing key/,
  'strict required-status policy must not disappear from the observed snapshot',
);

const automatedDependabot = parseSettings();
observedSecurity(automatedDependabot).dependabot_security_updates = 'enabled';
desiredSecurity(automatedDependabot).dependabot_security_updates = 'enabled';
objectAt(automatedDependabot, 'verification_state').dependabot_security_updates_policy = {
  state: 'automated_security_update_pull_requests_enabled',
  decided_at: '2026-07-27',
};
removeRemediation(automatedDependabot, 'owner_decide_dependabot_security_updates_policy');
const automatedDependabotSecurity = security.replace(
  /Dependabot vulnerability alerts are enabled,[\s\S]*?triage policy\./,
  'Dependabot vulnerability alerts are enabled. ' +
    'Dependabot automated security-update pull requests were selected on 2026-07-27.',
);
assert.deepEqual(
  validate(
    JSON.stringify(automatedDependabot),
    presentRelease,
    workflow,
    automatedDependabotSecurity,
  ),
  [],
  'owner-selected automated Dependabot updates should record enabled live state',
);

const manualDependabot = parseSettings();
desiredSecurity(manualDependabot).dependabot_security_updates = 'disabled';
objectAt(manualDependabot, 'verification_state').dependabot_security_updates_policy = {
  state: 'manual_dependency_security_policy_selected',
  decided_at: '2026-07-27',
  policy_document: 'SECURITY.md#repository-security-controls',
};
removeRemediation(manualDependabot, 'owner_decide_dependabot_security_updates_policy');
const manualDependabotSecurity = security.replace(
  /Dependabot vulnerability alerts are enabled,[\s\S]*?triage policy\./,
  'Dependabot vulnerability alerts are enabled. ' +
    'The manual dependency-security policy was selected on 2026-07-27.',
);
assert.deepEqual(
  validate(JSON.stringify(manualDependabot), presentRelease, workflow, manualDependabotSecurity),
  [],
  'owner-selected manual dependency security policy should keep automation disabled',
);

const omittedSecurityState = parseSettings();
delete observedSecurity(omittedSecurityState).secret_scanning;
assert.match(
  validate(JSON.stringify(omittedSecurityState)).join('\n'),
  /secret_scanning must be disabled or enabled/,
  'omitted observed security controls must fail closed',
);

const unknownSecurityState = parseSettings();
observedSecurity(unknownSecurityState).secret_scanning_push_protection = 'unknown';
assert.match(
  validate(JSON.stringify(unknownSecurityState)).join('\n'),
  /secret_scanning_push_protection must be disabled or enabled/,
  'unknown observed security states must fail closed',
);

const omittedExtendedScanningState = parseSettings();
delete observedSecurity(omittedExtendedScanningState).secret_scanning_non_provider_patterns;
assert.match(
  validate(JSON.stringify(omittedExtendedScanningState)).join('\n'),
  /secret_scanning_non_provider_patterns must be disabled or enabled/,
  'extended secret-scanning observations must not be omitted',
);

function markTrustedPublisherVerified(settings: JsonObject): void {
  objectAt(settings, 'verification_state').current_trusted_publisher_binding = {
    state: 'verified',
    verified_at: '2026-07-27T09:30:00Z',
    packages: ['@boardoor/core', '@boardoor/ui'],
    repository: 'boardoor/boardoor-sdk',
    workflow_filename: 'npm-release.yml',
    environment: 'npm-release',
    allowed_action: 'npm_publish_only',
    token_based_publishing: 'disabled',
    evidence_source: 'live_npm_package_settings',
  };
}

const verifiedBinding = parseSettings();
markTrustedPublisherVerified(verifiedBinding);
removeRemediation(
  verifiedBinding,
  'reverify_each_current_npm_trusted_publisher_binding',
);
const verifiedRelease = presentRelease.replace(
  /The owner must reverify each live\s+npm binding before the next release\./,
  'The live npm Trusted Publisher bindings were verified on 2026-07-27.',
);
assert.deepEqual(
  validate(JSON.stringify(verifiedBinding), verifiedRelease),
  [],
  'verified binding should require an exact evidence tuple and remove reverification remediation',
);

const verifiedWithStaleRemediation = parseSettings();
markTrustedPublisherVerified(verifiedWithStaleRemediation);
assert.match(
  validate(JSON.stringify(verifiedWithStaleRemediation), verifiedRelease).join('\n'),
  /\$\.remediation: expected 9 items|\$\.remediation\[[1-9]\]/,
  'verified binding must reject stale reverification remediation',
);

const verifiedWithMismatchedEvidence = structuredClone(verifiedBinding);
objectAt(
  objectAt(verifiedWithMismatchedEvidence, 'verification_state'),
  'current_trusted_publisher_binding',
).allowed_action = 'unrestricted';
assert.match(
  validate(JSON.stringify(verifiedWithMismatchedEvidence), verifiedRelease).join('\n'),
  /allowed_action: expected "npm_publish_only", found "unrestricted"/,
  'verified binding must reject evidence that differs from the exact binding tuple',
);

const verifiedWithInvalidDate = structuredClone(verifiedBinding);
objectAt(
  objectAt(verifiedWithInvalidDate, 'verification_state'),
  'current_trusted_publisher_binding',
).verified_at = '2026-02-30T09:30:00Z';
assert.match(
  validate(JSON.stringify(verifiedWithInvalidDate), verifiedRelease).join('\n'),
  /expected a real ISO date or UTC timestamp/,
  'verified binding must reject a nonexistent verification date',
);

assert.match(
  validate(JSON.stringify(verifiedBinding), presentRelease).join('\n'),
  /verified binding state prohibits stale reverification prose/,
  'verified binding must replace required-state prose with dated verification prose',
);

const unknownNested = parseSettings();
objectAt(objectAt(unknownNested, 'desired_configuration_now'), 'actions').unexpected = true;
assert.match(
  validate(JSON.stringify(unknownNested)).join('\n'),
  /\$\.desired_configuration_now\.actions\.unexpected: unknown key/,
  'unknown nested keys must fail closed',
);

const extraRemediation = parseSettings();
arrayAt(extraRemediation, 'remediation').push('unreviewed_extra_action');
assert.match(
  validate(JSON.stringify(extraRemediation)).join('\n'),
  /\$\.remediation: expected 10 items|\$\.remediation\[10\]/,
  'extra remediation entries must fail closed',
);

assert.match(
  validate('{"format":"boardoor-repository-settings-json-v1"').join('\n'),
  /repository settings JSON is invalid/,
  'invalid or unclosed JSON must fail closed',
);

const leakedFuture = parseSettings();
objectAt(leakedFuture, 'desired_configuration_now').future_reviewer_configuration =
  objectAt(leakedFuture, 'future_reviewer_configuration');
assert.match(
  validate(JSON.stringify(leakedFuture)).join('\n'),
  /\$\.desired_configuration_now\.future_reviewer_configuration: unknown key/,
  'future reviewer settings must not leak into the current desired configuration',
);

assert.match(
  validate(presentSettings.replace('2026-07-27', '2026-02-30')).join('\n'),
  /real calendar date/,
  'observed_at must reject a normalized but nonexistent calendar date',
);

const existingVersionMessage = workflow.indexOf('Automatic resume is blocked');
const exitMarker = '            exit 1\n';
const existingVersionExit = workflow.indexOf(exitMarker, existingVersionMessage);
assert(existingVersionMessage >= 0 && existingVersionExit >= 0);
const weakenedWorkflow =
  workflow.slice(0, existingVersionExit) +
  "            echo 'Automatic resume is not verified.' >&2\n" +
  workflow.slice(existingVersionExit + exitMarker.length);
assert.match(
  validate(presentSettings, presentRelease, weakenedWorkflow).join('\n'),
  /release workflow must fail closed/,
  'existing-version workflow path must retain its explicit failure',
);

console.log('public state exact-schema and transition tests passed');
