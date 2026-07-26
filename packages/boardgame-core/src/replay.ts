import type { GameLogEntry } from './game-log';

export const REPLAY_PACKAGE_VERSION = 1;
export const CURRENT_REPLAY_ENGINE_STATE_VERSION = 1;

export type ReplayVisibilityMode = 'full-reveal';
export type ReplayRecordingMode = 'snapshot';
export type ReplayAccessPolicy = 'participant-pro';
export const REPLAY_INDEX_STATUSES = ['pending', 'available', 'failed'] as const;
export type ReplayIndexStatus = (typeof REPLAY_INDEX_STATUSES)[number];

export interface ReplayParticipant {
  playerId: string;
  userId?: string;
  isAi: boolean;
}

export interface ReplayReleaseIdentity {
  slug: string;
  version: string;
  /** Existing third-party / legacy release provenance. */
  sourceSHA?: string;
  serverScriptHash?: string;
  clientBundleHash?: string;
  /** First-party build-input authority; these fields are present as one complete group. */
  authorityKind?: 'first-party-build-inputs-v1';
  appSourceTreeSHA256?: string;
  serverAuthoritySHA256?: string;
  clientBundleSHA256?: string;
  deliveryConfigSHA256?: string;
}

export interface ReplayManifest {
  version: typeof REPLAY_PACKAGE_VERSION;
  matchId: string;
  slug: string;
  status: 'finished';
  createdAt: number;
  finishedAt: number;
  numPlayers: number;
  participants: ReplayParticipant[];
  resultSummary: unknown;
  logConfig: { enabled: boolean; level: 'action' | 'detail' };
  seed?: string | number;
  /** Legacy display-only fields. Missing state versions mean unknown/v0. */
  engineVersion?: string;
  gameVersion?: string;
  engineStateVersion?: number;
  gameStateVersion?: number;
  release?: ReplayReleaseIdentity;
  recordingMode: ReplayRecordingMode;
  stepCount: number;
  visibilityModes: ReplayVisibilityMode[];
  accessPolicy: ReplayAccessPolicy;
}

export interface ReplayStep {
  index: number;
  stateId: number;
  turn: number;
  phase: string | null;
  actorPlayerId?: string;
  automatic?: boolean;
  action: unknown;
  deltalog: unknown[];
  gameLogDelta: GameLogEntry[];
  gameStateVersion?: number;
  state: unknown;
}

export interface ReplayPackage {
  manifest: ReplayManifest;
  steps: ReplayStep[];
}

export interface ReplayIndexRecord {
  match_id: string;
  game: string;
  status: ReplayIndexStatus;
  recording_mode: ReplayRecordingMode;
  access_policy: ReplayAccessPolicy;
  visibility_policy: 'participants';
  object_key: string | null;
  object_size_bytes: number | null;
  object_sha256: string | null;
  failure_code: string | null;
  created_at: number; // epoch ms
  updated_at: number; // epoch ms
  captured_at: number | null; // epoch ms
  available_at: number | null; // epoch ms
  failed_at: number | null; // epoch ms
  expires_at: number | null; // epoch ms
}

export interface ReplayValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSHA256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function hasValidVisibilityModes(value: unknown): value is ReplayVisibilityMode[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return false;
  return value.every((mode) => mode === 'full-reveal');
}

function validateParticipant(
  value: unknown,
  index: number,
  errors: string[],
): value is ReplayParticipant {
  if (!isRecord(value)) {
    errors.push(`manifest.participants[${index}] must be an object`);
    return false;
  }
  if (!isNonEmptyString(value.playerId)) {
    errors.push(`manifest.participants[${index}].playerId must be a non-empty string`);
  }
  if (value.userId !== undefined && !isNonEmptyString(value.userId)) {
    errors.push(`manifest.participants[${index}].userId must be a non-empty string when present`);
  }
  if (typeof value.isAi !== 'boolean') {
    errors.push(`manifest.participants[${index}].isAi must be a boolean`);
  }
  return errors.length === 0;
}

function validateManifest(value: unknown, errors: string[]): value is ReplayManifest {
  if (!isRecord(value)) {
    errors.push('manifest must be an object');
    return false;
  }

  if (value.version !== REPLAY_PACKAGE_VERSION) errors.push('manifest.version must be 1');
  if (!isNonEmptyString(value.matchId)) errors.push('manifest.matchId must be a non-empty string');
  if (!isNonEmptyString(value.slug)) errors.push('manifest.slug must be a non-empty string');
  if (value.status !== 'finished') errors.push('manifest.status must be finished');
  if (!isNonNegativeInteger(value.createdAt)) errors.push('manifest.createdAt must be an integer');
  if (!isNonNegativeInteger(value.finishedAt))
    errors.push('manifest.finishedAt must be an integer');
  if (!isNonNegativeInteger(value.numPlayers))
    errors.push('manifest.numPlayers must be an integer');
  if (!Array.isArray(value.participants)) {
    errors.push('manifest.participants must be an array');
  } else {
    value.participants.forEach((participant, index) =>
      validateParticipant(participant, index, errors),
    );
  }

  if (!isRecord(value.logConfig)) {
    errors.push('manifest.logConfig must be an object');
  } else {
    if (typeof value.logConfig.enabled !== 'boolean') {
      errors.push('manifest.logConfig.enabled must be a boolean');
    }
    if (value.logConfig.level !== 'action' && value.logConfig.level !== 'detail') {
      errors.push('manifest.logConfig.level must be action or detail');
    }
  }

  if (
    value.seed !== undefined &&
    typeof value.seed !== 'string' &&
    typeof value.seed !== 'number'
  ) {
    errors.push('manifest.seed must be a string or number when present');
  }
  if (value.engineVersion !== undefined && !isNonEmptyString(value.engineVersion)) {
    errors.push('manifest.engineVersion must be a non-empty string when present');
  }
  if (value.gameVersion !== undefined && !isNonEmptyString(value.gameVersion)) {
    errors.push('manifest.gameVersion must be a non-empty string when present');
  }
  if (value.engineStateVersion !== undefined && !isNonNegativeInteger(value.engineStateVersion)) {
    errors.push('manifest.engineStateVersion must be an integer when present');
  }
  if (value.gameStateVersion !== undefined && !isNonNegativeInteger(value.gameStateVersion)) {
    errors.push('manifest.gameStateVersion must be an integer when present');
  }
  if ((value.engineStateVersion === undefined) !== (value.gameStateVersion === undefined)) {
    errors.push('manifest engineStateVersion and gameStateVersion must be present together');
  }
  if (value.release !== undefined) {
    if (!isRecord(value.release)) {
      errors.push('manifest.release must be an object when present');
    } else {
      const release = value.release;
      if (!isNonEmptyString(release.slug)) {
        errors.push('manifest.release.slug must be a non-empty string');
      } else if (release.slug !== value.slug) {
        errors.push('manifest.release.slug must match manifest.slug');
      }
      if (!isNonEmptyString(release.version)) {
        errors.push('manifest.release.version must be a non-empty string');
      }
      for (const field of ['sourceSHA', 'serverScriptHash', 'clientBundleHash'] as const) {
        if (release[field] !== undefined && !isNonEmptyString(release[field])) {
          errors.push(`manifest.release.${field} must be a non-empty string when present`);
        }
      }
      const firstPartyFields = [
        'appSourceTreeSHA256',
        'serverAuthoritySHA256',
        'clientBundleSHA256',
        'deliveryConfigSHA256',
      ] as const;
      const hasFirstPartyField = firstPartyFields.some((field) => release[field] !== undefined);
      if (
        release.authorityKind !== undefined &&
        release.authorityKind !== 'first-party-build-inputs-v1'
      ) {
        errors.push('manifest.release.authorityKind is unsupported');
      }
      if (hasFirstPartyField || release.authorityKind !== undefined) {
        if (release.authorityKind !== 'first-party-build-inputs-v1') {
          errors.push('manifest.release first-party authorityKind is required');
        }
        if (!isSHA256(release.version)) {
          errors.push('manifest.release.version must be a SHA-256 first-party release ID');
        }
        for (const field of firstPartyFields) {
          if (!isSHA256(release[field])) {
            errors.push(`manifest.release.${field} is required for first-party authority`);
          }
        }
        for (const field of ['sourceSHA', 'serverScriptHash', 'clientBundleHash'] as const) {
          if (release[field] !== undefined) {
            errors.push(`manifest.release.${field} must be absent for first-party authority`);
          }
        }
      }
    }
    if (value.engineStateVersion === undefined || value.gameStateVersion === undefined) {
      errors.push('manifest.release requires numeric state versions');
    }
  }
  if (value.recordingMode !== 'snapshot') {
    errors.push('manifest.recordingMode must be snapshot');
  }
  if (!isNonNegativeInteger(value.stepCount)) errors.push('manifest.stepCount must be an integer');
  if (!hasValidVisibilityModes(value.visibilityModes)) {
    errors.push('manifest.visibilityModes must contain replay visibility modes');
  }
  if (value.accessPolicy !== 'participant-pro') {
    errors.push('manifest.accessPolicy must be participant-pro');
  }

  return errors.length === 0;
}

function validateGameLogEntry(
  value: unknown,
  path: string,
  errors: string[],
): value is GameLogEntry {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  if (!isNonEmptyString(value.id)) errors.push(`${path}.id must be a non-empty string`);
  if (!isNonNegativeInteger(value.sequence)) errors.push(`${path}.sequence must be an integer`);
  if (!isNonNegativeInteger(value.turn)) errors.push(`${path}.turn must be an integer`);
  if (value.playerId !== undefined && !isNonEmptyString(value.playerId)) {
    errors.push(`${path}.playerId must be a non-empty string when present`);
  }
  if (!isNonEmptyString(value.publicMessageKey)) {
    errors.push(`${path}.publicMessageKey must be a non-empty string`);
  }
  return errors.length === 0;
}

function validateStep(value: unknown, index: number, errors: string[]): value is ReplayStep {
  if (!isRecord(value)) {
    errors.push(`steps[${index}] must be an object`);
    return false;
  }

  if (value.index !== index) errors.push(`steps[${index}].index must match its position`);
  if (!isNonNegativeInteger(value.stateId))
    errors.push(`steps[${index}].stateId must be an integer`);
  if (!isNonNegativeInteger(value.turn)) errors.push(`steps[${index}].turn must be an integer`);
  if (value.phase !== null && typeof value.phase !== 'string') {
    errors.push(`steps[${index}].phase must be a string or null`);
  }
  if (value.actorPlayerId !== undefined && !isNonEmptyString(value.actorPlayerId)) {
    errors.push(`steps[${index}].actorPlayerId must be a non-empty string when present`);
  }
  if (value.automatic !== undefined && typeof value.automatic !== 'boolean') {
    errors.push(`steps[${index}].automatic must be a boolean when present`);
  }
  if (!Array.isArray(value.deltalog)) errors.push(`steps[${index}].deltalog must be an array`);
  if (!Array.isArray(value.gameLogDelta)) {
    errors.push(`steps[${index}].gameLogDelta must be an array`);
  } else {
    value.gameLogDelta.forEach((entry, entryIndex) =>
      validateGameLogEntry(entry, `steps[${index}].gameLogDelta[${entryIndex}]`, errors),
    );
  }
  if (value.gameStateVersion !== undefined && !isNonNegativeInteger(value.gameStateVersion)) {
    errors.push(`steps[${index}].gameStateVersion must be an integer when present`);
  }
  if (!('state' in value)) errors.push(`steps[${index}].state is required`);
  return errors.length === 0;
}

export function validateReplayPackage(value: unknown): ReplayValidationResult<ReplayPackage> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ['package must be an object'] };
  }

  const manifest = value.manifest;
  const manifestOk = validateManifest(manifest, errors);
  if (!Array.isArray(value.steps)) {
    errors.push('steps must be an array');
  } else {
    value.steps.forEach((step, index) => validateStep(step, index, errors));
  }

  if (manifestOk && Array.isArray(value.steps) && manifest.stepCount !== value.steps.length) {
    errors.push('manifest.stepCount must match steps length');
  }
  if (manifestOk && Array.isArray(value.steps) && manifest.gameStateVersion !== undefined) {
    let previousVersion = manifest.gameStateVersion;
    value.steps.forEach((step, index) => {
      if (!isRecord(step) || step.gameStateVersion === undefined) {
        errors.push(
          `steps[${index}].gameStateVersion is required when manifest.gameStateVersion is present`,
        );
        return;
      }
      if (!isNonNegativeInteger(step.gameStateVersion)) return;
      if (index === 0 && step.gameStateVersion !== manifest.gameStateVersion) {
        errors.push('steps[0].gameStateVersion must match manifest.gameStateVersion');
      }
      if (step.gameStateVersion < previousVersion) {
        errors.push(`steps[${index}].gameStateVersion must not decrease`);
      }
      previousVersion = step.gameStateVersion;
    });
  }
  if (
    manifestOk &&
    Array.isArray(value.steps) &&
    manifest.gameStateVersion === undefined &&
    value.steps.some((step) => isRecord(step) && step.gameStateVersion !== undefined)
  ) {
    errors.push('per-step gameStateVersion requires manifest.gameStateVersion');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: value as unknown as ReplayPackage, errors: [] };
}

export function serializeReplayPackage(pkg: ReplayPackage): string {
  const result = validateReplayPackage(pkg);
  if (!result.ok) throw new Error(`Invalid replay package: ${result.errors.join('; ')}`);
  return JSON.stringify(pkg);
}

export function parseReplayPackage(json: string): ReplayPackage {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('Invalid replay package JSON');
  }

  const result = validateReplayPackage(value);
  if (!result.ok || !result.value) {
    throw new Error(`Invalid replay package: ${result.errors.join('; ')}`);
  }
  return result.value;
}
