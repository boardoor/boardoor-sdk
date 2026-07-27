import { stripTransients } from '../../core/action-creators';
import { CreateGameReducer } from '../../core/reducer';
import { applyStateMigrations, StateMigrationError } from '../../core/state-migrations';
import type { GameMigrationMeta, GameStateSchema, State, TransientState } from '../../types';
import type {
  StateMigrationFixture,
  StateMigrationHarnessInput,
  StateMigrationHarnessIssue,
  StateMigrationHarnessResult,
} from './types';

const DEFAULT_MAX_STATE_BYTES = 256 * 1024;
const DEFAULT_MAX_STEP_MS = 50;
const DEFAULT_MAX_CHAIN_MS = 500;
const REJECTED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Check a migration against fixtures without persistence or runtime wiring. */
export function runStateMigrationHarness<G>({
  slug,
  game,
  numPlayers,
  fixtures,
  maxStateBytes = DEFAULT_MAX_STATE_BYTES,
  maxStepMs = DEFAULT_MAX_STEP_MS,
  maxChainMs = DEFAULT_MAX_CHAIN_MS,
}: StateMigrationHarnessInput<G>): StateMigrationHarnessResult {
  const issues: StateMigrationHarnessIssue[] = [];
  const schema = game.stateSchema;
  if (!schema) {
    return {
      slug,
      fixtures: fixtures.length,
      issues: fixtures.map((fixture) => ({
        code: 'SCHEMA_MISSING',
        fixture: fixture.name,
        message: 'Game does not declare stateSchema.',
      })),
    };
  }

  for (const fixture of fixtures) {
    const fixtureIssues = issuesForFixture({
      slug,
      game,
      numPlayers,
      fixture,
      maxStateBytes,
      maxStepMs,
      maxChainMs,
    });
    issues.push(...fixtureIssues);
  }

  return { slug, fixtures: fixtures.length, issues };
}

function issuesForFixture<G>({
  slug,
  game,
  numPlayers,
  fixture,
  maxStateBytes,
  maxStepMs,
  maxChainMs,
}: Omit<StateMigrationHarnessInput<G>, 'fixtures'> & {
  fixture: StateMigrationFixture<G>;
  maxStateBytes: number;
  maxStepMs: number;
  maxChainMs: number;
}): StateMigrationHarnessIssue[] {
  const issues: StateMigrationHarnessIssue[] = [];
  const schema = game.stateSchema!;
  const original = clone(fixture.state);
  const firstInput = deepFreeze(clone(fixture.state));
  const samples: StateMigrationStepSample[] = [];
  const chainStartedAt = performance.now();
  let migrated: State<unknown>;

  try {
    migrated = applyStateMigrations({
      state: firstInput,
      game: { stateSchema: instrumentSchema(schema, samples) },
      fromVersion: fixture.fromVersion,
      numPlayers,
    }).state;
  } catch (error) {
    const mutationError = looksLikeMutationError(
      error instanceof StateMigrationError ? error.cause : error,
    );
    issues.push({
      code: mutationError ? 'MIGRATION_MUTATED_INPUT' : 'CHAIN_FAILED',
      fixture: fixture.name,
      message: `${error instanceof Error ? error.message : String(error)}`,
      data:
        error instanceof StateMigrationError
          ? { errorCode: error.code, slot: error.slot }
          : undefined,
    });
    return issues;
  }
  const chainElapsedMs = performance.now() - chainStartedAt;

  if (!jsonEqual(fixture.state, original)) {
    issues.push(issue(fixture, 'MIGRATION_MUTATED_INPUT', 'Migration changed its input state.'));
  }

  try {
    const retrySamples: StateMigrationStepSample[] = [];
    const retry = applyStateMigrations({
      state: deepFreeze(clone(fixture.state)),
      game: { stateSchema: instrumentSchema(schema, retrySamples) },
      fromVersion: fixture.fromVersion,
      numPlayers,
    }).state;
    if (!jsonEqual(migrated, retry) || !stepSamplesEqual(samples, retrySamples)) {
      issues.push(
        issue(fixture, 'NON_DETERMINISTIC_MIGRATION', 'Same input produced different output.'),
      );
    }
  } catch (error) {
    issues.push(
      issue(
        fixture,
        'NON_DETERMINISTIC_MIGRATION',
        `Determinism retry failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  for (const sample of samples) {
    inspectMigrationOutput(fixture, sample, maxStateBytes, issues);
    if (sample.elapsedMs > maxStepMs) {
      issues.push(
        issue(
          fixture,
          'STEP_TIMEOUT',
          `Migration ${sample.meta.fromVersion} -> ${sample.meta.toVersion} (${sample.meta.slot}) took ${sample.elapsedMs.toFixed(2)}ms (limit ${maxStepMs}ms).`,
        ),
      );
    }
  }
  if (chainElapsedMs > maxChainMs) {
    issues.push(
      issue(
        fixture,
        'CHAIN_TIMEOUT',
        `Migration chain took ${chainElapsedMs.toFixed(2)}ms (limit ${maxChainMs}ms).`,
      ),
    );
  }

  if (!jsonEqual(migrated, fixture.expectedState)) {
    issues.push(
      issue(fixture, 'FIXTURE_MISMATCH', 'Migrated state differs from expected fixture.'),
    );
  }

  if (fixture.currentShapeNoOp && !jsonEqual(migrated, fixture.state)) {
    issues.push(
      issue(
        fixture,
        'CURRENT_SHAPE_NOT_NOOP',
        'Opted-in 0 -> 1 current-shape fixture was not a no-op.',
      ),
    );
  }

  issues.push(...probeCurrentGame(slug, game, numPlayers, fixture, migrated));
  return issues;
}

interface StateMigrationStepSample {
  elapsedMs: number;
  meta: GameMigrationMeta;
  output: unknown;
}

function instrumentSchema(
  schema: GameStateSchema,
  samples: StateMigrationStepSample[],
): GameStateSchema {
  const migrations = Object.fromEntries(
    Object.entries(schema.migrations).map(([version, migration]) => [
      version,
      (G: unknown, meta: GameMigrationMeta) => {
        // Every step gets its own frozen clone. This prevents a later step from
        // mutating an earlier step's output and hiding the contract violation.
        const input = deepFreeze(clone(G));
        const startedAt = performance.now();
        const output = migration(input, meta);
        samples.push({ elapsedMs: performance.now() - startedAt, meta, output });
        return output;
      },
    ]),
  );
  return { version: schema.version, migrations };
}

function stepSamplesEqual(
  left: StateMigrationStepSample[],
  right: StateMigrationStepSample[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (sample, index) =>
        jsonEqual(sample.meta, right[index]?.meta) &&
        jsonEqual(sample.output, right[index]?.output),
    )
  );
}

function inspectMigrationOutput(
  fixture: StateMigrationFixture,
  sample: StateMigrationStepSample,
  maxStateBytes: number,
  issues: StateMigrationHarnessIssue[],
) {
  const label = `${sample.meta.fromVersion} -> ${sample.meta.toVersion} (${sample.meta.slot})`;
  const rejectedPath = findRejectedKey(sample.output);
  if (rejectedPath) {
    issues.push(
      issue(
        fixture,
        'PROTOTYPE_KEY_REJECTED',
        `Migration ${label} output contains ${rejectedPath}.`,
      ),
    );
  }

  const serialized = serializeExactly(sample.output);
  if (serialized.ok === false) {
    issues.push(
      issue(fixture, 'JSON_ROUND_TRIP_FAILED', `Migration ${label}: ${serialized.message}`),
    );
  } else if (!jsonEqual(sample.output, serialized.value)) {
    issues.push(
      issue(
        fixture,
        'JSON_ROUND_TRIP_FAILED',
        `Migration ${label} output changed during JSON round-trip.`,
      ),
    );
  }

  if (serialized.ok) {
    const outputBytes = jsonByteLength(sample.output);
    if (outputBytes !== null && outputBytes > maxStateBytes) {
      issues.push(
        issue(
          fixture,
          'STATE_TOO_LARGE',
          `Migration ${label} output is ${outputBytes} bytes (limit ${maxStateBytes}).`,
        ),
      );
    }
  }
}

function probeCurrentGame<G>(
  slug: string,
  game: StateMigrationHarnessInput<G>['game'],
  numPlayers: number,
  fixture: StateMigrationFixture<G>,
  migrated: State<unknown>,
): StateMigrationHarnessIssue[] {
  const issues: StateMigrationHarnessIssue[] = [];
  const state = migrated as State<G>;
  const playerIDs = Array.from({ length: numPlayers }, (_, index) => String(index));

  if (game.playerView) {
    for (const playerID of [...playerIDs, null]) {
      try {
        game.playerView({ G: clone(state.G), ctx: clone(state.ctx), playerID });
      } catch (error) {
        issues.push(
          issue(
            fixture,
            'PLAYER_VIEW_FAILED',
            `playerView failed for ${playerID ?? 'spectator'}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }
  }

  if (game.ai?.enumerate) {
    for (const playerID of playerIDs) {
      try {
        const actions = game.ai.enumerate(clone(state.G), clone(state.ctx), playerID);
        if (!Array.isArray(actions)) throw new Error('enumerate did not return an array');
      } catch (error) {
        issues.push(
          issue(
            fixture,
            'ENUMERATE_FAILED',
            `ai.enumerate failed for ${playerID}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }
  }

  const invariant = game.ai?.domainInvariants;
  if (invariant) {
    try {
      const violations = invariant(clone(state.G), clone(state.ctx), {
        slug,
        seed: `migration:${fixture.name}`,
        numPlayers,
        setupVariant: fixture.name,
        mode: 'state-migration',
        maxSteps: fixture.scriptedActions?.length ?? 0,
        step: 0,
      });
      for (const violation of violations) {
        issues.push(issue(fixture, 'DOMAIN_INVARIANT_FAILED', violation.message, violation));
      }
    } catch (error) {
      issues.push(
        issue(
          fixture,
          'DOMAIN_INVARIANT_FAILED',
          `domainInvariants threw: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  if (fixture.scriptedActions?.length) {
    const reducer = CreateGameReducer({ game });
    let actionState = clone(state) as TransientState<G>;
    fixture.scriptedActions.forEach((action, index) => {
      try {
        const next = reducer(actionState, action) as TransientState<G>;
        if (next.transients?.error) {
          issues.push(
            issue(
              fixture,
              'SCRIPTED_ACTION_REJECTED',
              `Scripted action ${index} was rejected: ${next.transients.error.type}.`,
            ),
          );
        }
        actionState = reducer(next, stripTransients()) as TransientState<G>;
      } catch (error) {
        issues.push(
          issue(
            fixture,
            'SCRIPTED_ACTION_REJECTED',
            `Scripted action ${index} threw: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  }

  return issues;
}

function issue(
  fixture: StateMigrationFixture,
  code: StateMigrationHarnessIssue['code'],
  message: string,
  data?: unknown,
): StateMigrationHarnessIssue {
  return { code, fixture: fixture.name, message, data };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

function findRejectedKey(value: unknown, path = '$', seen = new WeakSet<object>()): string | null {
  if (value === null || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const name = String(key);
    if (REJECTED_KEYS.has(name)) return `${path}.${name}`;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) continue;
    const nested = findRejectedKey(
      descriptor.value,
      Array.isArray(value) ? `${path}[${name}]` : `${path}.${name}`,
      seen,
    );
    if (nested) return nested;
  }
  return null;
}

function serializeExactly(
  value: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    const unsupported = findUnsupportedJsonValue(value);
    if (unsupported) return { ok: false, message: unsupported };
    const json = JSON.stringify(value);
    if (json === undefined) return { ok: false, message: 'JSON.stringify returned undefined.' };
    return { ok: true, value: JSON.parse(json) };
  } catch (error) {
    return {
      ok: false,
      message: `JSON round-trip threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function jsonByteLength(value: unknown): number | null {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? null : new TextEncoder().encode(json).byteLength;
  } catch {
    return null;
  }
}

function findUnsupportedJsonValue(
  value: unknown,
  path = '$',
  seen = new WeakSet<object>(),
): string | null {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return `${path} is not preserved by JSON serialization.`;
  }
  if (typeof value === 'bigint') return `${path} cannot be JSON serialized.`;
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return `${path} is changed by JSON serialization.`;
  }
  if (value === null || typeof value !== 'object') return null;
  if (seen.has(value)) return `${path} contains a circular reference.`;
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    return `${path} is not a plain JSON object.`;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') return `${path} has a symbol key.`;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (!('value' in descriptor)) return `${path}.${key} is an accessor property.`;
    const nested = findUnsupportedJsonValue(
      descriptor.value,
      Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`,
      seen,
    );
    if (nested) return nested;
  }
  seen.delete(value);
  return null;
}

function looksLikeMutationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('read only') ||
    message.includes('not extensible') ||
    message.includes('Cannot assign') ||
    message.includes('Cannot add') ||
    message.includes('Cannot delete')
  );
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    if (findUnsupportedJsonValue(left) || findUnsupportedJsonValue(right)) return false;
    return structurallyEqual(left, right);
  } catch {
    // Invalid JSON-shaped output is reported by serializeExactly. Equality
    // probes must not make the harness itself throw before that issue exists.
    return false;
  }
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;

  const leftKeys = Reflect.ownKeys(left).toSorted(comparePropertyKeys);
  const rightKeys = Reflect.ownKeys(right).toSorted(comparePropertyKeys);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key, index) => {
    if (key !== rightKeys[index]) return false;
    const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
    const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
    if (!leftDescriptor || !rightDescriptor) return false;
    if (!('value' in leftDescriptor) || !('value' in rightDescriptor)) return false;
    return structurallyEqual(leftDescriptor.value, rightDescriptor.value);
  });
}

function comparePropertyKeys(left: PropertyKey, right: PropertyKey): number {
  return String(left).localeCompare(String(right));
}
