import type { Game, GameMigrationMeta, GameStateSchema, State, Undo } from '../types';

export type StateMigrationErrorCode =
  | 'invalid_schema'
  | 'version_ahead'
  | 'missing_migration'
  | 'migration_threw';

export class StateMigrationError extends Error {
  readonly code: StateMigrationErrorCode;
  readonly fromVersion: number;
  readonly targetVersion: number;
  readonly slot?: GameMigrationMeta['slot'];

  constructor({
    code,
    message,
    fromVersion,
    targetVersion,
    slot,
    cause,
  }: {
    code: StateMigrationErrorCode;
    message: string;
    fromVersion: number;
    targetVersion: number;
    slot?: GameMigrationMeta['slot'];
    cause?: unknown;
  }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'StateMigrationError';
    this.code = code;
    this.fromVersion = fromVersion;
    this.targetVersion = targetVersion;
    this.slot = slot;
  }
}

export interface ApplyStateMigrationsOptions<G = unknown> {
  state: State<G>;
  game: Pick<Game<G>, 'stateSchema'>;
  fromVersion: number;
  numPlayers: number;
  topLevelSlot?: Extract<GameMigrationMeta['slot'], 'state' | 'initialState'>;
  /** Internal observability hook used by the migration harness. */
  onStep?: (sample: {
    fromVersion: number;
    toVersion: number;
    slot: GameMigrationMeta['slot'];
    elapsedMs: number;
  }) => void;
}

export interface ApplyStateMigrationsResult {
  state: State<unknown>;
  promoted: boolean;
}

/**
 * Apply a linear game-owned migration chain to State.G and every undo / redo G.
 *
 * The input State is never assigned to. A failed or incomplete chain throws a
 * typed error and returns no partial result, leaving persistence callers able
 * to fail closed.
 */
export function applyStateMigrations<G = unknown>({
  state,
  game,
  fromVersion,
  numPlayers,
  topLevelSlot = 'state',
  onStep,
}: ApplyStateMigrationsOptions<G>): ApplyStateMigrationsResult {
  const targetVersion = game.stateSchema?.version ?? 0;
  validateVersions(fromVersion, targetVersion);
  if (fromVersion === targetVersion) return { state, promoted: false };
  const schema = game.stateSchema!;

  let migrated: State<unknown> = state;
  for (let version = fromVersion; version < schema.version; version += 1) {
    const migration = schema.migrations[version];
    if (typeof migration !== 'function') {
      throw new StateMigrationError({
        code: 'missing_migration',
        message: `Missing game-state migration ${version} -> ${version + 1}.`,
        fromVersion: version,
        targetVersion: schema.version,
      });
    }

    const G = runMigration(
      migration,
      migrated.G,
      {
        fromVersion: version,
        toVersion: version + 1,
        numPlayers,
        slot: topLevelSlot,
      },
      schema.version,
      onStep,
    );
    const undo = migrateHistory(
      migrated._undo,
      migration,
      version,
      schema.version,
      numPlayers,
      'undo',
      onStep,
    );
    const redo = migrateHistory(
      migrated._redo,
      migration,
      version,
      schema.version,
      numPlayers,
      'redo',
      onStep,
    );

    migrated = { ...migrated, G, _undo: undo, _redo: redo };
  }

  return { state: migrated, promoted: true };
}

function validateVersions(fromVersion: number, targetVersion: number) {
  if (
    !Number.isSafeInteger(fromVersion) ||
    fromVersion < 0 ||
    !Number.isSafeInteger(targetVersion) ||
    targetVersion < 0
  ) {
    throw new StateMigrationError({
      code: 'invalid_schema',
      message: 'Game-state versions must be non-negative safe integers.',
      fromVersion,
      targetVersion,
    });
  }
  if (fromVersion > targetVersion) {
    throw new StateMigrationError({
      code: 'version_ahead',
      message: `Persisted game-state version ${fromVersion} is ahead of code version ${targetVersion}.`,
      fromVersion,
      targetVersion,
    });
  }
}

function migrateHistory(
  history: Array<Undo<unknown>>,
  migration: GameStateSchema['migrations'][number],
  fromVersion: number,
  targetVersion: number,
  numPlayers: number,
  slot: 'undo' | 'redo',
  onStep: ApplyStateMigrationsOptions['onStep'],
): Array<Undo<unknown>> {
  return history.map((entry) => ({
    ...entry,
    G: runMigration(
      migration,
      entry.G,
      { fromVersion, toVersion: fromVersion + 1, numPlayers, slot },
      targetVersion,
      onStep,
    ),
  }));
}

function runMigration(
  migration: GameStateSchema['migrations'][number],
  G: unknown,
  meta: GameMigrationMeta,
  targetVersion: number,
  onStep: ApplyStateMigrationsOptions['onStep'],
): unknown {
  // Deployed Workers do not advance performance.now() during synchronous JS.
  // Only sample when a caller such as the Node-based harness explicitly requests it.
  const startedAt = onStep ? performance.now() : undefined;
  try {
    return migration(G, meta);
  } catch (cause) {
    throw new StateMigrationError({
      code: 'migration_threw',
      message: `Game-state migration ${meta.fromVersion} -> ${meta.toVersion} threw for ${meta.slot}.`,
      fromVersion: meta.fromVersion,
      targetVersion,
      slot: meta.slot,
      cause,
    });
  } finally {
    if (onStep && startedAt !== undefined) {
      onStep({ ...meta, elapsedMs: performance.now() - startedAt });
    }
  }
}
