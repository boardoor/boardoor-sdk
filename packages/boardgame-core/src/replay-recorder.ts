import { extractGameLogDelta, type GameLogLevel, type GameLogStateShape } from './game-log';
import {
  REPLAY_PACKAGE_VERSION,
  validateReplayPackage,
  type ReplayPackage,
  type ReplayParticipant,
  type ReplayReleaseIdentity,
  type ReplayStep,
  type ReplayVisibilityMode,
} from './replay';
import type { LogEntry, State } from './types';

export interface ReplayGameLogDeltaMetadata {
  fromSequenceExclusive: number;
  toSequence: number;
  truncated: boolean;
}

export interface ReplayGameLogTruncationMetadata extends ReplayGameLogDeltaMetadata {
  index: number;
  stateId: number;
}

export interface ReplayRecorderMetadata {
  gameLogDeltaTruncated: boolean;
  truncatedGameLogDeltas: ReplayGameLogTruncationMetadata[];
}

export type ReplayRecordedStep = ReplayStep & {
  gameLogDeltaMeta: ReplayGameLogDeltaMetadata;
};

export type ReplayRecordedPackage = ReplayPackage & {
  recorderMetadata: ReplayRecorderMetadata;
  steps: ReplayRecordedStep[];
};

export interface ReplayRecorderAppendInput<G extends GameLogStateShape = GameLogStateShape> {
  state: State<G>;
  action?: unknown;
  actorPlayerId?: string;
  automatic?: boolean;
  deltalog?: LogEntry[];
  snapshot?: unknown;
  gameStateVersion?: number;
}

export interface ReplayRecorderBuildOptions {
  matchId: string;
  slug: string;
  createdAt: number;
  finishedAt: number;
  participants: ReplayParticipant[];
  resultSummary: unknown;
  engineVersion?: string;
  gameVersion?: string;
  engineStateVersion?: number;
  gameStateVersion?: number;
  release?: ReplayReleaseIdentity;
  logConfig?: { enabled: boolean; level: GameLogLevel };
  numPlayers?: number;
  seed?: string | number;
  visibilityModes?: ReplayVisibilityMode[];
}

export interface ReplayRecorder {
  readonly steps: readonly ReplayRecordedStep[];
  readonly metadata: ReplayRecorderMetadata;
  append<G extends GameLogStateShape>(input: ReplayRecorderAppendInput<G>): ReplayRecordedStep;
  buildPackage(options: ReplayRecorderBuildOptions): ReplayRecordedPackage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function cloneSnapshot<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function stateSnapshot<G>(state: State<G>): unknown {
  const { deltalog: _deltalog, ...snapshot } = state;
  return snapshot;
}

function inferAction(deltalog: LogEntry[]): unknown {
  return deltalog.at(-1)?.action ?? null;
}

function inferActorPlayerId(action: unknown): string | undefined {
  if (!isRecord(action) || !isRecord(action.payload)) return undefined;
  return typeof action.payload.playerID === 'string' ? action.payload.playerID : undefined;
}

function inferAutomatic(deltalog: LogEntry[]): boolean | undefined {
  if (deltalog.some((entry) => entry.automatic === true)) return true;
  return undefined;
}

class LocalReplayRecorder implements ReplayRecorder {
  readonly steps: ReplayRecordedStep[] = [];
  readonly metadata: ReplayRecorderMetadata = {
    gameLogDeltaTruncated: false,
    truncatedGameLogDeltas: [],
  };

  #lastGameLogSequence = 0;
  #lastStateId = -1;
  #lastLogConfig: { enabled: boolean; level: GameLogLevel } | undefined;
  #lastNumPlayers: number | undefined;
  #lastSeed: string | number | undefined;

  append<G extends GameLogStateShape>(input: ReplayRecorderAppendInput<G>): ReplayRecordedStep {
    const stateId = input.state._stateID;
    assertNonNegativeInteger(stateId, 'state._stateID');
    if (stateId <= this.#lastStateId) {
      throw new Error(
        `replay steps must be appended in increasing stateId order: got ${stateId} after ${this.#lastStateId}`,
      );
    }

    const index = this.steps.length;
    const deltalog = cloneSnapshot(input.deltalog ?? input.state.deltalog ?? []);
    const action = input.action ?? inferAction(deltalog);
    const gameLogDelta = extractGameLogDelta(input.state.G, this.#lastGameLogSequence);
    const gameLogDeltaMeta: ReplayGameLogDeltaMetadata = {
      fromSequenceExclusive: gameLogDelta.fromSequenceExclusive,
      toSequence: gameLogDelta.toSequence,
      truncated: gameLogDelta.truncated,
    };
    const actorPlayerId = input.actorPlayerId ?? inferActorPlayerId(action);
    const automatic = input.automatic ?? inferAutomatic(deltalog);

    const step: ReplayRecordedStep = {
      index,
      stateId,
      turn: input.state.ctx.turn,
      phase: input.state.ctx.phase,
      ...(actorPlayerId !== undefined ? { actorPlayerId } : {}),
      ...(automatic !== undefined ? { automatic } : {}),
      action: cloneSnapshot(action),
      deltalog,
      gameLogDelta: cloneSnapshot(gameLogDelta.entries),
      gameLogDeltaMeta,
      ...(input.gameStateVersion !== undefined ? { gameStateVersion: input.gameStateVersion } : {}),
      state: cloneSnapshot(input.snapshot ?? stateSnapshot(input.state)),
    };

    this.steps.push(step);
    this.#lastStateId = stateId;
    this.#lastGameLogSequence = gameLogDelta.toSequence;
    this.#lastLogConfig = input.state.G.logConfig;
    this.#lastNumPlayers = input.state.ctx.numPlayers;
    this.#lastSeed = input.state.ctx._random?.seed;

    if (gameLogDelta.truncated) {
      const truncation: ReplayGameLogTruncationMetadata = {
        index,
        stateId,
        ...gameLogDeltaMeta,
      };
      this.metadata.gameLogDeltaTruncated = true;
      this.metadata.truncatedGameLogDeltas.push(truncation);
    }

    return step;
  }

  buildPackage(options: ReplayRecorderBuildOptions): ReplayRecordedPackage {
    const numPlayers = options.numPlayers ?? this.#lastNumPlayers ?? options.participants.length;
    const pkg: ReplayRecordedPackage = {
      manifest: {
        version: REPLAY_PACKAGE_VERSION,
        matchId: options.matchId,
        slug: options.slug,
        status: 'finished',
        createdAt: options.createdAt,
        finishedAt: options.finishedAt,
        numPlayers,
        participants: cloneSnapshot(options.participants),
        resultSummary: cloneSnapshot(options.resultSummary),
        logConfig: options.logConfig ?? this.#lastLogConfig ?? { enabled: false, level: 'action' },
        seed: options.seed ?? this.#lastSeed,
        ...(options.engineVersion !== undefined ? { engineVersion: options.engineVersion } : {}),
        ...(options.gameVersion !== undefined ? { gameVersion: options.gameVersion } : {}),
        ...(options.engineStateVersion !== undefined
          ? { engineStateVersion: options.engineStateVersion }
          : {}),
        ...(options.gameStateVersion !== undefined
          ? { gameStateVersion: options.gameStateVersion }
          : {}),
        ...(options.release !== undefined ? { release: cloneSnapshot(options.release) } : {}),
        recordingMode: 'snapshot',
        stepCount: this.steps.length,
        visibilityModes: options.visibilityModes ?? ['full-reveal'],
        accessPolicy: 'participant-pro',
      },
      recorderMetadata: cloneSnapshot(this.metadata),
      steps: cloneSnapshot(this.steps),
    };

    const result = validateReplayPackage(pkg);
    if (!result.ok) {
      throw new Error(`Invalid replay package: ${result.errors.join('; ')}`);
    }

    return pkg;
  }
}

export function createReplayRecorder(): ReplayRecorder {
  return new LocalReplayRecorder();
}

export function buildReplayPackage(
  steps: Iterable<ReplayRecorderAppendInput>,
  options: ReplayRecorderBuildOptions,
): ReplayRecordedPackage {
  const recorder = createReplayRecorder();
  for (const step of steps) recorder.append(step);
  return recorder.buildPackage(options);
}
