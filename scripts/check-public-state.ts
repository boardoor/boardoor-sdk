import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Ruleset = {
  scope: 'repository';
  target: 'branch';
  enforcement: 'active';
  include: ['refs/heads/main'];
  bypass_actors: [];
  pull_request: true;
  approvals: 0;
  code_owner_review: false;
  conversation_resolution: true;
  deletion_blocked: true;
  force_push_blocked: true;
  direct_push_blocked: true;
  routine_bypass_allowed: false;
  strict_required_status_checks_policy: true;
  required_status_checks: ['verify', 'DCO'];
};

type ActionsDefaults = {
  default_token: 'read_only';
  allow_actions_to_create_or_approve_pull_requests: false;
  fork_pull_request_approval: 'all_external_contributors';
  self_hosted_runner_for_fork_code: 'forbidden';
};

type PresentRetiredEnvironment = {
  state: 'present';
  name: 'npm-bootstrap';
  repository_secrets: 0;
  environment_secrets: 0;
  administrator_bypass: false;
  next_action: 'delete_environment';
};

type AbsentRetiredEnvironment = {
  state: 'absent';
  name: 'npm-bootstrap';
};

type RequiredTrustedPublisherBinding = {
  state: 'owner_reverification_required';
  next_action: 'reverify_each_current_npm_trusted_publisher_binding';
  required_evidence: ['exact_core_and_ui_binding_tuple', 'token_based_publishing_disabled'];
};

type VerifiedTrustedPublisherBinding = {
  state: 'verified';
  verified_at: string;
  packages: ['@boardoor/core', '@boardoor/ui'];
  repository: 'boardoor/boardoor-sdk';
  workflow_filename: 'npm-release.yml';
  environment: 'npm-release';
  allowed_action: 'npm_publish_only';
  token_based_publishing: 'disabled';
  evidence_source: 'live_npm_package_settings';
};

type RequiredDependabotDecision = {
  state: 'owner_decision_required';
  options: [
    'enable_automated_security_update_pull_requests',
    'document_manual_security_update_policy',
  ];
  next_action: 'owner_select_dependency_security_update_policy';
};

type AutomatedDependabotPolicy = {
  state: 'automated_security_update_pull_requests_enabled';
  decided_at: string;
};

type ManualDependabotPolicy = {
  state: 'manual_dependency_security_policy_selected';
  decided_at: string;
  policy_document: 'SECURITY.md#repository-security-controls';
};

type DependabotPolicy =
  | RequiredDependabotDecision
  | AutomatedDependabotPolicy
  | ManualDependabotPolicy;

type RepositorySettings = {
  format: 'boardoor-repository-settings-json-v1';
  schema_version: 3;
  repository: 'boardoor-sdk';
  default_branch: 'main';
  observed_at: string;
  authority: {
    live_github_settings_and_apis: 'authoritative';
    live_npm_settings_and_registry: 'authoritative';
    checked_in_snapshot: 'non_applying_record';
  };
  observed_snapshot: {
    ruleset: Ruleset;
    dco: { exact_live_check_name: 'DCO'; live_ruleset_required: true };
    repository_security: {
      private_vulnerability_reporting: 'enabled';
      dependabot_alerts: 'enabled';
      dependabot_security_updates: 'disabled' | 'enabled';
      secret_scanning: 'disabled' | 'enabled';
      secret_scanning_push_protection: 'disabled' | 'enabled';
      secret_scanning_non_provider_patterns: 'disabled' | 'enabled';
      secret_scanning_validity_checks: 'disabled' | 'enabled';
    };
    actions:
      | (ActionsDefaults & {
          enabled: true;
          allowed_actions: 'all';
          sha_pinning_required: boolean;
        })
      | (ActionsDefaults & {
          enabled: true;
          allowed_actions: 'selected';
          sha_pinning_required: boolean;
          github_owned_allowed: true;
          verified_allowed: false;
          patterns_allowed: ['pnpm/action-setup@*'];
        });
    release_environment: {
      name: 'npm-release';
      required_reviewers: 0;
      prevent_self_review: false;
      deployment_branch_policy: 'main_only';
      administrator_bypass: false;
      repository_secrets: 0;
      environment_secrets: 0;
    };
    initial_publication: {
      method: 'github_actions_oidc_trusted_publishing';
      core_and_ui_provenance_observed: true;
    };
    retired_release_environment: PresentRetiredEnvironment | AbsentRetiredEnvironment;
  };
  verification_state: {
    current_trusted_publisher_binding:
      | RequiredTrustedPublisherBinding
      | VerifiedTrustedPublisherBinding;
    dependabot_security_updates_policy: DependabotPolicy;
    required_evidence: string[];
  };
  desired_configuration_now: {
    ruleset: Ruleset;
    dco: {
      app_required: true;
      standard: 'DCO-1.1';
      selected_repository_only: true;
      unsigned_commit_must_fail: true;
      signed_off_commit_must_pass: true;
    };
    repository_security: {
      private_vulnerability_reporting: 'enabled';
      dependabot_alerts: 'enabled';
      dependabot_security_updates: 'owner_decision_required_do_not_apply' | 'enabled' | 'disabled';
      secret_scanning: 'enabled';
      secret_scanning_push_protection: 'enabled';
      secret_scanning_non_provider_patterns:
        | 'enabled'
        | 'enabled_when_github_team_with_secret_protection_available';
      secret_scanning_validity_checks:
        | 'enabled'
        | 'enabled_when_github_team_with_secret_protection_available';
    };
    actions: ActionsDefaults & {
      enabled: true;
      allowed_actions: 'selected';
      sha_pinning_required: true;
      github_owned_allowed: true;
      verified_allowed: false;
      patterns_allowed: ['pnpm/action-setup@*'];
    };
    release_environment: {
      name: 'npm-release';
      live_approval: 'owner_workflow_dispatch';
      required_reviewers: 0;
      prevent_self_review: false;
      deployment_branch_policy: 'main_only';
      administrator_bypass: false;
      repository_secrets: 0;
      environment_secrets: 0;
      reviewed_commit_input: 'full_sha_required';
    };
    trusted_publishing: {
      packages: ['@boardoor/core', '@boardoor/ui'];
      repository: 'boardoor/boardoor-sdk';
      workflow_filename: 'npm-release.yml';
      environment: 'npm-release';
      allowed_action: 'npm_publish_only';
      token_based_publishing: 'disabled';
    };
  };
  future_reviewer_configuration: {
    activation_condition: 'active_reviewer_joined';
    repository_approvals: 1;
    code_owner_review: true;
    npm_release_required_reviewers: 1;
    npm_release_prevent_self_review: true;
    canary_before_claiming_active: true;
  };
  release_script_contract: {
    build_command: 'pnpm exec tsx scripts/release.ts --pack core|ui';
    publish_command: 'npm publish <reviewed-immutable-tarball> --access public --tag next --provenance';
    required_dispatch_inputs: [
      'package',
      'expected_commit',
      'expected_version',
      'expected_tarball_sha256',
    ];
    fixed_initial_dist_tag: 'next';
    unit_of_dispatch: 'one_package';
    existing_version_policy: 'fail_closed_until_pinned_provenance_identity_verifier';
    fail_closed_checks: string[];
  };
  release_prerequisites: [
    'private_candidate_and_packed_artifact_parity_before_dispatch',
    'private_evidence_not_copied_into_public_repository',
  ];
  remediation: string[];
};

type ValidationInput = {
  settings: string;
  release: string;
  security: string;
  workflow: string;
};

const ruleset: Ruleset = {
  scope: 'repository',
  target: 'branch',
  enforcement: 'active',
  include: ['refs/heads/main'],
  bypass_actors: [],
  pull_request: true,
  approvals: 0,
  code_owner_review: false,
  conversation_resolution: true,
  deletion_blocked: true,
  force_push_blocked: true,
  direct_push_blocked: true,
  routine_bypass_allowed: false,
  strict_required_status_checks_policy: true,
  required_status_checks: ['verify', 'DCO'],
};

const actionDefaults: ActionsDefaults = {
  default_token: 'read_only',
  allow_actions_to_create_or_approve_pull_requests: false,
  fork_pull_request_approval: 'all_external_contributors',
  self_hosted_runner_for_fork_code: 'forbidden',
};

const requiredEvidence = [
  'confirm_ruleset_effective_via_api_or_settings_snapshot',
  'confirm_codeowners_team_exists_and_is_accessible',
  'confirm_dco_app_publisher_permissions_selection_and_installer',
  'prove_unsigned_commit_fails_and_signed_off_commit_passes',
  'prove_self_authored_pr_mergeable_only_after_ci_dco_and_conversation_resolution',
  'record_external_pr_owner_review_operating_evidence',
  'confirm_private_vulnerability_reporting_is_reachable',
  'confirm_no_repository_or_environment_secret_reaches_fork_ci',
  'confirm_workflow_dispatch_actor_is_the_authorized_owner',
  'prove_bootstrap_core_and_ui_registry_tarballs_match_reviewed_sha256',
];

const failClosedChecks = [
  'exact_main_sha_checked_before_dependency_install',
  'package_versions_match_reviewed_candidate',
  'fixed_next_dist_tag',
  'package_projection_and_release_checks_run_without_id_token',
  'build_pack_uses_lock_integrity_pinned_npm_11_5_1',
  'build_and_pack_job_has_no_id_token',
  'publish_job_has_no_checkout_or_dependency_install',
  'publish_job_uses_node_24_6_0_bundled_npm_11_5_1',
  'publish_job_only_receives_reviewed_immutable_tarball',
  'steady_publish_rejects_npm_tokens',
  'new_version_publish_uses_trusted_publishing',
  'registry_tarball_sha256_matches_reviewed_candidate',
  'preexisting_version_blocks_automatic_resume',
];

type DynamicState = {
  bootstrap: 'present' | 'absent';
  binding: 'owner_reverification_required' | 'verified';
  observedAt: string;
  verifiedAt?: string;
  dependabotUpdates: 'disabled' | 'enabled';
  dependabotPolicy:
    | 'owner_decision_required'
    | 'automated_security_update_pull_requests_enabled'
    | 'manual_dependency_security_policy_selected';
  dependabotDecidedAt?: string;
  secretScanning: 'disabled' | 'enabled';
  pushProtection: 'disabled' | 'enabled';
  nonProviderPatterns: 'disabled' | 'enabled';
  validityChecks: 'disabled' | 'enabled';
  actionsAllowed: 'all' | 'selected';
  actionsShaPinning: boolean;
};

function expectedSettings(dynamic: DynamicState): RepositorySettings {
  const retiredReleaseEnvironment: PresentRetiredEnvironment | AbsentRetiredEnvironment =
    dynamic.bootstrap === 'present'
      ? {
          state: 'present',
          name: 'npm-bootstrap',
          repository_secrets: 0,
          environment_secrets: 0,
          administrator_bypass: false,
          next_action: 'delete_environment',
        }
      : { state: 'absent', name: 'npm-bootstrap' };
  const currentTrustedPublisherBinding:
    | RequiredTrustedPublisherBinding
    | VerifiedTrustedPublisherBinding =
    dynamic.binding === 'owner_reverification_required'
      ? {
          state: 'owner_reverification_required',
          next_action: 'reverify_each_current_npm_trusted_publisher_binding',
          required_evidence: ['exact_core_and_ui_binding_tuple', 'token_based_publishing_disabled'],
        }
      : {
          state: 'verified',
          verified_at: dynamic.verifiedAt ?? '',
          packages: ['@boardoor/core', '@boardoor/ui'],
          repository: 'boardoor/boardoor-sdk',
          workflow_filename: 'npm-release.yml',
          environment: 'npm-release',
          allowed_action: 'npm_publish_only',
          token_based_publishing: 'disabled',
          evidence_source: 'live_npm_package_settings',
        };
  const dependabotPolicy: DependabotPolicy =
    dynamic.dependabotPolicy === 'owner_decision_required'
      ? {
          state: 'owner_decision_required',
          options: [
            'enable_automated_security_update_pull_requests',
            'document_manual_security_update_policy',
          ],
          next_action: 'owner_select_dependency_security_update_policy',
        }
      : dynamic.dependabotPolicy === 'automated_security_update_pull_requests_enabled'
        ? {
            state: 'automated_security_update_pull_requests_enabled',
            decided_at: dynamic.dependabotDecidedAt ?? '',
          }
        : {
            state: 'manual_dependency_security_policy_selected',
            decided_at: dynamic.dependabotDecidedAt ?? '',
            policy_document: 'SECURITY.md#repository-security-controls',
          };
  const remediation = [
    ...(dynamic.bootstrap === 'present' ? ['delete_the_empty_npm_bootstrap_environment'] : []),
    ...(dynamic.binding === 'owner_reverification_required'
      ? ['reverify_each_current_npm_trusted_publisher_binding']
      : []),
    ...(dynamic.secretScanning === 'disabled'
      ? ['enable_repository_secret_scanning_and_user_alerts']
      : []),
    ...(dynamic.pushProtection === 'disabled' ? ['enable_secret_scanning_push_protection'] : []),
    ...(dynamic.dependabotPolicy === 'owner_decision_required'
      ? ['owner_decide_dependabot_security_updates_policy']
      : []),
    ...(!dynamic.actionsShaPinning ? ['enable_actions_full_sha_pinning'] : []),
    ...(dynamic.actionsAllowed === 'all'
      ? ['apply_selected_actions_policy_with_github_owned_and_pnpm_action_setup']
      : []),
    'select_and_pin_a_cryptographic_provenance_identity_policy_verifier',
  ];

  return {
    format: 'boardoor-repository-settings-json-v1',
    schema_version: 3,
    repository: 'boardoor-sdk',
    default_branch: 'main',
    observed_at: dynamic.observedAt,
    authority: {
      live_github_settings_and_apis: 'authoritative',
      live_npm_settings_and_registry: 'authoritative',
      checked_in_snapshot: 'non_applying_record',
    },
    observed_snapshot: {
      ruleset,
      dco: { exact_live_check_name: 'DCO', live_ruleset_required: true },
      repository_security: {
        private_vulnerability_reporting: 'enabled',
        dependabot_alerts: 'enabled',
        dependabot_security_updates: dynamic.dependabotUpdates,
        secret_scanning: dynamic.secretScanning,
        secret_scanning_push_protection: dynamic.pushProtection,
        secret_scanning_non_provider_patterns: dynamic.nonProviderPatterns,
        secret_scanning_validity_checks: dynamic.validityChecks,
      },
      actions:
        dynamic.actionsAllowed === 'all'
          ? {
              ...actionDefaults,
              enabled: true,
              allowed_actions: 'all',
              sha_pinning_required: dynamic.actionsShaPinning,
            }
          : {
              ...actionDefaults,
              enabled: true,
              allowed_actions: 'selected',
              sha_pinning_required: dynamic.actionsShaPinning,
              github_owned_allowed: true,
              verified_allowed: false,
              patterns_allowed: ['pnpm/action-setup@*'],
            },
      release_environment: {
        name: 'npm-release',
        required_reviewers: 0,
        prevent_self_review: false,
        deployment_branch_policy: 'main_only',
        administrator_bypass: false,
        repository_secrets: 0,
        environment_secrets: 0,
      },
      initial_publication: {
        method: 'github_actions_oidc_trusted_publishing',
        core_and_ui_provenance_observed: true,
      },
      retired_release_environment: retiredReleaseEnvironment,
    },
    verification_state: {
      current_trusted_publisher_binding: currentTrustedPublisherBinding,
      dependabot_security_updates_policy: dependabotPolicy,
      required_evidence: requiredEvidence,
    },
    desired_configuration_now: {
      ruleset,
      dco: {
        app_required: true,
        standard: 'DCO-1.1',
        selected_repository_only: true,
        unsigned_commit_must_fail: true,
        signed_off_commit_must_pass: true,
      },
      repository_security: {
        private_vulnerability_reporting: 'enabled',
        dependabot_alerts: 'enabled',
        dependabot_security_updates:
          dynamic.dependabotPolicy === 'owner_decision_required'
            ? 'owner_decision_required_do_not_apply'
            : dynamic.dependabotPolicy === 'automated_security_update_pull_requests_enabled'
              ? 'enabled'
              : 'disabled',
        secret_scanning: 'enabled',
        secret_scanning_push_protection: 'enabled',
        secret_scanning_non_provider_patterns:
          dynamic.nonProviderPatterns === 'enabled'
            ? 'enabled'
            : 'enabled_when_github_team_with_secret_protection_available',
        secret_scanning_validity_checks:
          dynamic.validityChecks === 'enabled'
            ? 'enabled'
            : 'enabled_when_github_team_with_secret_protection_available',
      },
      actions: {
        ...actionDefaults,
        enabled: true,
        allowed_actions: 'selected',
        sha_pinning_required: true,
        github_owned_allowed: true,
        verified_allowed: false,
        patterns_allowed: ['pnpm/action-setup@*'],
      },
      release_environment: {
        name: 'npm-release',
        live_approval: 'owner_workflow_dispatch',
        required_reviewers: 0,
        prevent_self_review: false,
        deployment_branch_policy: 'main_only',
        administrator_bypass: false,
        repository_secrets: 0,
        environment_secrets: 0,
        reviewed_commit_input: 'full_sha_required',
      },
      trusted_publishing: {
        packages: ['@boardoor/core', '@boardoor/ui'],
        repository: 'boardoor/boardoor-sdk',
        workflow_filename: 'npm-release.yml',
        environment: 'npm-release',
        allowed_action: 'npm_publish_only',
        token_based_publishing: 'disabled',
      },
    },
    future_reviewer_configuration: {
      activation_condition: 'active_reviewer_joined',
      repository_approvals: 1,
      code_owner_review: true,
      npm_release_required_reviewers: 1,
      npm_release_prevent_self_review: true,
      canary_before_claiming_active: true,
    },
    release_script_contract: {
      build_command: 'pnpm exec tsx scripts/release.ts --pack core|ui',
      publish_command:
        'npm publish <reviewed-immutable-tarball> --access public --tag next --provenance',
      required_dispatch_inputs: [
        'package',
        'expected_commit',
        'expected_version',
        'expected_tarball_sha256',
      ],
      fixed_initial_dist_tag: 'next',
      unit_of_dispatch: 'one_package',
      existing_version_policy: 'fail_closed_until_pinned_provenance_identity_verifier',
      fail_closed_checks: failClosedChecks,
    },
    release_prerequisites: [
      'private_candidate_and_packed_artifact_parity_before_dispatch',
      'private_evidence_not_copied_into_public_repository',
    ],
    remediation,
  };
}

function compareExact(
  actual: unknown,
  expected: unknown,
  path: string,
  violations: string[],
): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      violations.push(`${path}: expected an array`);
      return;
    }
    if (actual.length !== expected.length) {
      violations.push(`${path}: expected ${expected.length} items, found ${actual.length}`);
    }
    const length = Math.max(actual.length, expected.length);
    for (let index = 0; index < length; index += 1) {
      compareExact(actual[index], expected[index], `${path}[${index}]`, violations);
    }
    return;
  }

  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      violations.push(`${path}: expected an object`);
      return;
    }
    const actualRecord = actual as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    const actualKeys = Object.keys(actualRecord);
    const expectedKeys = Object.keys(expectedRecord);
    for (const unknownKey of actualKeys.filter((key) => !expectedKeys.includes(key))) {
      violations.push(`${path}.${unknownKey}: unknown key`);
    }
    for (const missingKey of expectedKeys.filter((key) => !actualKeys.includes(key))) {
      violations.push(`${path}.${missingKey}: missing key`);
    }
    for (const key of expectedKeys) {
      if (key in actualRecord) {
        compareExact(actualRecord[key], expectedRecord[key], `${path}.${key}`, violations);
      }
    }
    return;
  }

  if (!Object.is(actual, expected)) {
    violations.push(
      `${path}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
    );
  }
}

function realCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function realVerificationDate(value: unknown): value is string {
  if (realCalendarDate(value)) return true;
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, fraction = '0'] = match;
  const milliseconds = Number(fraction.padEnd(3, '0'));
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      milliseconds,
    ),
  );
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute) &&
    date.getUTCSeconds() === Number(second) &&
    date.getUTCMilliseconds() === milliseconds
  );
}

function includesNormalizedProse(document: string, expected: string): boolean {
  return document.replace(/\s+/g, ' ').includes(expected.replace(/\s+/g, ' '));
}

export function validatePublicState(input: ValidationInput): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.settings);
  } catch (error) {
    return [`repository settings JSON is invalid: ${(error as Error).message}`];
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return ['repository settings root must be an object'];
  }

  const record = parsed as Record<string, unknown>;
  const observedAt = record.observed_at;
  const retired = (record.observed_snapshot as Record<string, unknown> | undefined)
    ?.retired_release_environment as Record<string, unknown> | undefined;
  const state = retired?.state;
  if (state !== 'present' && state !== 'absent') {
    return [
      'repository settings observed_snapshot.retired_release_environment.state ' +
        'must be present or absent',
    ];
  }
  const verificationState = record.verification_state as Record<string, unknown> | undefined;
  const binding = verificationState?.current_trusted_publisher_binding as
    | Record<string, unknown>
    | undefined;
  const bindingState = binding?.state;
  if (bindingState !== 'owner_reverification_required' && bindingState !== 'verified') {
    return [
      'repository settings verification_state.current_trusted_publisher_binding.state ' +
        'must be owner_reverification_required or verified',
    ];
  }
  const observedSnapshot = record.observed_snapshot as Record<string, unknown> | undefined;
  const repositorySecurity = observedSnapshot?.repository_security as
    | Record<string, unknown>
    | undefined;
  const dependabotUpdates = repositorySecurity?.dependabot_security_updates;
  const secretScanning = repositorySecurity?.secret_scanning;
  const pushProtection = repositorySecurity?.secret_scanning_push_protection;
  const nonProviderPatterns = repositorySecurity?.secret_scanning_non_provider_patterns;
  const validityChecks = repositorySecurity?.secret_scanning_validity_checks;
  if (dependabotUpdates !== 'disabled' && dependabotUpdates !== 'enabled') {
    return [
      'repository settings observed_snapshot.repository_security.' +
        'dependabot_security_updates must be disabled or enabled',
    ];
  }
  if (secretScanning !== 'disabled' && secretScanning !== 'enabled') {
    return [
      'repository settings observed_snapshot.repository_security.secret_scanning ' +
        'must be disabled or enabled',
    ];
  }
  if (pushProtection !== 'disabled' && pushProtection !== 'enabled') {
    return [
      'repository settings observed_snapshot.repository_security.' +
        'secret_scanning_push_protection must be disabled or enabled',
    ];
  }
  if (nonProviderPatterns !== 'disabled' && nonProviderPatterns !== 'enabled') {
    return [
      'repository settings observed_snapshot.repository_security.' +
        'secret_scanning_non_provider_patterns must be disabled or enabled',
    ];
  }
  if (validityChecks !== 'disabled' && validityChecks !== 'enabled') {
    return [
      'repository settings observed_snapshot.repository_security.' +
        'secret_scanning_validity_checks must be disabled or enabled',
    ];
  }
  const observedActions = observedSnapshot?.actions as Record<string, unknown> | undefined;
  const actionsAllowed = observedActions?.allowed_actions;
  const actionsShaPinning = observedActions?.sha_pinning_required;
  if (actionsAllowed !== 'all' && actionsAllowed !== 'selected') {
    return [
      'repository settings observed_snapshot.actions.allowed_actions must be all or selected',
    ];
  }
  if (typeof actionsShaPinning !== 'boolean') {
    return ['repository settings observed_snapshot.actions.sha_pinning_required must be boolean'];
  }
  const dependabotPolicy = verificationState?.dependabot_security_updates_policy as
    | Record<string, unknown>
    | undefined;
  const dependabotPolicyState = dependabotPolicy?.state;
  if (
    dependabotPolicyState !== 'owner_decision_required' &&
    dependabotPolicyState !== 'automated_security_update_pull_requests_enabled' &&
    dependabotPolicyState !== 'manual_dependency_security_policy_selected'
  ) {
    return [
      'repository settings verification_state.dependabot_security_updates_policy.state ' +
        'is invalid',
    ];
  }

  const violations: string[] = [];
  if (!realCalendarDate(observedAt)) {
    violations.push('$.observed_at: expected a real calendar date in YYYY-MM-DD form');
  }
  const verifiedAt = binding?.verified_at;
  if (bindingState === 'verified' && !realVerificationDate(verifiedAt)) {
    violations.push(
      '$.verification_state.current_trusted_publisher_binding.verified_at: ' +
        'expected a real ISO date or UTC timestamp',
    );
  }
  const dependabotDecidedAt = dependabotPolicy?.decided_at;
  if (
    dependabotPolicyState !== 'owner_decision_required' &&
    !realVerificationDate(dependabotDecidedAt)
  ) {
    violations.push(
      '$.verification_state.dependabot_security_updates_policy.decided_at: ' +
        'expected a real ISO date or UTC timestamp',
    );
  }
  if (
    dependabotPolicyState === 'automated_security_update_pull_requests_enabled' &&
    dependabotUpdates !== 'enabled'
  ) {
    violations.push('automated Dependabot policy requires observed security updates enabled');
  }
  if (
    dependabotPolicyState !== 'automated_security_update_pull_requests_enabled' &&
    dependabotUpdates !== 'disabled'
  ) {
    violations.push('non-automated Dependabot policy requires observed security updates disabled');
  }
  compareExact(
    parsed,
    expectedSettings({
      bootstrap: state,
      binding: bindingState,
      observedAt: String(observedAt),
      verifiedAt: String(verifiedAt ?? ''),
      dependabotUpdates,
      dependabotPolicy: dependabotPolicyState,
      dependabotDecidedAt: String(dependabotDecidedAt ?? ''),
      secretScanning,
      pushProtection,
      nonProviderPatterns,
      validityChecks,
      actionsAllowed,
      actionsShaPinning,
    }),
    '$',
    violations,
  );

  const scanningStates = [secretScanning, pushProtection, nonProviderPatterns, validityChecks];
  const disabledScanningProse =
    /repository secret scanning\/user alerts, push protection, non-provider\s+patterns, and /i;
  const disabledValidityProse = /validity checks are disabled/i;
  const enabledScanningProse =
    `Repository secret scanning/user alerts, push protection, non-provider patterns, and ` +
    `validity checks were verified enabled on ${String(observedAt)}.`;
  if (scanningStates.every((value) => value === 'disabled')) {
    if (
      !disabledScanningProse.test(input.security) ||
      !disabledValidityProse.test(input.security)
    ) {
      violations.push(
        'SECURITY.md: disabled secret-scanning controls require disabled-state prose',
      );
    }
  } else if (scanningStates.every((value) => value === 'enabled')) {
    if (!includesNormalizedProse(input.security, enabledScanningProse)) {
      violations.push('SECURITY.md: enabled secret-scanning controls require dated verification');
    }
  } else {
    const partialScanningProse =
      `Live repository security state verified on ${String(observedAt)}: ` +
      `secret scanning/user alerts ${String(secretScanning)}; ` +
      `push protection ${String(pushProtection)}; ` +
      `non-provider patterns ${String(nonProviderPatterns)}; ` +
      `validity checks ${String(validityChecks)}.`;
    if (!includesNormalizedProse(input.security, partialScanningProse)) {
      violations.push(
        'SECURITY.md: partial secret-scanning state requires exact dated live-state prose',
      );
    }
  }

  const pendingDependabotProse =
    /Dependabot security updates are (?:also )?disabled\s+pending an explicit owner decision/i;
  if (dependabotPolicyState === 'owner_decision_required') {
    if (!pendingDependabotProse.test(input.security)) {
      violations.push('SECURITY.md: pending Dependabot decision requires pending-state prose');
    }
  } else {
    if (pendingDependabotProse.test(input.security)) {
      violations.push('SECURITY.md: decided Dependabot policy prohibits stale pending prose');
    }
    const decisionDate = String(dependabotDecidedAt).slice(0, 10);
    const requiredDecisionProse =
      dependabotPolicyState === 'automated_security_update_pull_requests_enabled'
        ? `Dependabot automated security-update pull requests were selected on ${decisionDate}.`
        : `The manual dependency-security policy was selected on ${decisionDate}.`;
    if (!includesNormalizedProse(input.security, requiredDecisionProse)) {
      violations.push('SECURITY.md: decided Dependabot policy requires dated decision prose');
    }
  }

  const currentActionsProse =
    /GitHub Actions currently permits all actions and does not enforce SHA pinning/i;
  const appliedActionsProse =
    `GitHub Actions selected-actions policy and repository SHA pinning were verified active on ` +
    `${String(observedAt)}.`;
  if (actionsAllowed === 'all' && actionsShaPinning === false) {
    if (!currentActionsProse.test(input.security)) {
      violations.push('SECURITY.md: current Actions state requires all/no-pinning prose');
    }
  } else if (actionsAllowed === 'selected' && actionsShaPinning === true) {
    if (currentActionsProse.test(input.security)) {
      violations.push('SECURITY.md: applied Actions state prohibits stale all/no-pinning prose');
    }
    if (!includesNormalizedProse(input.security, appliedActionsProse)) {
      violations.push('SECURITY.md: applied Actions state requires dated verification prose');
    }
  } else {
    violations.push('SECURITY.md: partial Actions transition requires an explicit schema');
  }

  const reverifyBindingProse = /owner must reverify each live\s+npm binding/i;
  if (bindingState === 'owner_reverification_required') {
    if (!reverifyBindingProse.test(input.release)) {
      violations.push('RELEASE.md: required binding state must retain owner reverification prose');
    }
  } else {
    if (reverifyBindingProse.test(input.release)) {
      violations.push('RELEASE.md: verified binding state prohibits stale reverification prose');
    }
    const verifiedDate = String(verifiedAt).slice(0, 10);
    if (
      !includesNormalizedProse(
        input.release,
        `The live npm Trusted Publisher bindings were verified on ${verifiedDate}.`,
      )
    ) {
      violations.push(
        'RELEASE.md: verified binding state requires dated live binding verification prose',
      );
    }
  }

  const deletionProse =
    /npm-bootstrap[\s\S]{0,240}(?:still exists|still present|requires owner deletion)/i;
  if (state === 'present' && !deletionProse.test(input.release)) {
    violations.push('RELEASE.md: present npm-bootstrap state requires deletion prose');
  }
  if (state === 'absent' && deletionProse.test(input.release)) {
    violations.push('RELEASE.md: absent npm-bootstrap state prohibits stale deletion prose');
  }
  if (
    !/live GitHub and npm settings and APIs/i.test(input.release) ||
    !/remain authoritative/i.test(input.release) ||
    !/live setting remains the authority/i.test(input.security)
  ) {
    violations.push('public docs must state that live APIs and settings remain authoritative');
  }
  if (
    !/fails closed/i.test(input.release) ||
    !/requested package version already exists/i.test(input.release)
  ) {
    violations.push('RELEASE.md must describe the existing-version fail-closed policy');
  }

  const existingVersionBlock =
    /if published_url=[\s\S]*?; then([\s\S]*?)^\s*fi$/m.exec(input.workflow)?.[1] ?? '';
  if (!existingVersionBlock.includes('sha256sum --check --strict')) {
    violations.push('release workflow must diagnose an existing version with the reviewed digest');
  }
  if (!existingVersionBlock.includes('exit 1')) {
    violations.push('release workflow must fail closed when the requested version exists');
  }
  if (input.workflow.includes('already_published=true')) {
    violations.push('release workflow must not auto-green an already-published version');
  }

  return violations;
}

function main(): void {
  const root = process.cwd();
  const violations = validatePublicState({
    settings: readFileSync(join(root, '.github/repository-settings.json'), 'utf8'),
    release: readFileSync(join(root, 'RELEASE.md'), 'utf8'),
    security: readFileSync(join(root, 'SECURITY.md'), 'utf8'),
    workflow: readFileSync(join(root, '.github/workflows/npm-release.yml'), 'utf8'),
  });
  if (violations.length > 0) throw new Error(violations.join('\n'));
  console.log('public state snapshot and release policy are internally consistent');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
