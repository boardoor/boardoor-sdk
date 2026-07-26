import { applyStateMigrations } from '../../core/state-migrations';
import type { Game, LogEntry, Server, State } from '../../types';

const PERSISTED_STATE_KIND = 'boardoor.persisted-state' as const;
const PERSISTED_STATE_ENVELOPE_VERSION = 1 as const;
const ENGINE_STATE_VERSION = 1 as const;
const LOCAL_STATE_PAIR_HEAD_KIND = 'boardoor.local-state-pair-head' as const;
const LOCAL_STATE_PAIR_SNAPSHOT_KIND = 'boardoor.local-state-pairs' as const;
const LOCAL_STATE_PAIR_FORMAT_VERSION = 1 as const;
const MAX_MIGRATED_GAME_DATA_BYTES = 256 * 1024;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface PersistedStateRelease {
  slug: string;
  version: string;
  serverScriptHash?: string;
}

interface PersistedStateEnvelope {
  kind: typeof PERSISTED_STATE_KIND;
  envelopeVersion: typeof PERSISTED_STATE_ENVELOPE_VERSION;
  engineStateVersion: number;
  gameStateVersion: number;
  release?: PersistedStateRelease;
  migratedFrom?: {
    engineStateVersion: number;
    gameStateVersion: number;
    migratedAt: number;
    byRelease?: string;
  };
  state: State;
}

type StoredState = State | PersistedStateEnvelope;

interface StoredStatePair {
  state: StoredState;
  initialState: StoredState;
}

interface StatePair {
  state: State;
  initialState: State;
  gameStateVersion: number;
  release?: PersistedStateRelease;
  enveloped: boolean;
}

interface LocalStatePairHead {
  kind: typeof LOCAL_STATE_PAIR_HEAD_KIND;
  version: typeof LOCAL_STATE_PAIR_FORMAT_VERSION;
  activeSlot: 0 | 1;
  revision: number;
}

interface LocalStatePairSnapshot {
  kind: typeof LOCAL_STATE_PAIR_SNAPSHOT_KIND;
  version: typeof LOCAL_STATE_PAIR_FORMAT_VERSION;
  revision: number;
  entries: [string, StoredStatePair][];
}

interface LocalMatchRecord {
  state?: State;
  initialState?: State;
  log: LogEntry[];
  metadata?: Server.MatchData;
}

class PersistedMap<Value> extends Map<string, Value> {
  private readonly key: string;

  constructor(key: string) {
    const entries = JSON.parse(localStorage.getItem(key) ?? '[]') as [string, Value][];
    super();
    this.key = key;
    for (const [entryKey, value] of entries) {
      super.set(entryKey, value);
    }
  }

  set(key: string, value: Value): this {
    const next = new Map(this);
    next.set(key, value);
    const serialized = JSON.stringify([...next.entries()]);
    localStorage.setItem(this.key, serialized);
    super.set(key, value);
    return this;
  }
}

/**
 * Double-buffered state-pair store.
 *
 * A complete inactive snapshot is written first, then a small head pointer
 * commits it. If the head write fails, readers keep using the prior head (or
 * the legacy separate keys) and the uncommitted snapshot is harmless.
 */
class PersistedStatePairStore {
  private pairs = new Map<string, StoredStatePair>();
  private activeSlot: 0 | 1 | null = null;
  private revision = 0;
  private readonly headKey: string;
  private readonly slotKeys: readonly [string, string];

  constructor(storagePrefix: string) {
    this.headKey = `${storagePrefix}_state_pair_head`;
    this.slotKeys = [`${storagePrefix}_state_pair_0`, `${storagePrefix}_state_pair_1`];
    const serializedHead = localStorage.getItem(this.headKey);
    if (serializedHead === null) return;

    const head = parseStatePairHead(serializedHead);
    const serializedSnapshot = localStorage.getItem(this.slotKeys[head.activeSlot]);
    if (serializedSnapshot === null) {
      throw new Error('Committed local state-pair snapshot is missing.');
    }
    const snapshot = parseStatePairSnapshot(serializedSnapshot, head.revision);
    this.pairs = new Map(snapshot.entries);
    this.activeSlot = head.activeSlot;
    this.revision = head.revision;
  }

  get(matchID: string): StoredStatePair | undefined {
    return this.pairs.get(matchID);
  }

  set(matchID: string, pair: StoredStatePair): void {
    const nextPairs = new Map(this.pairs);
    nextPairs.set(matchID, pair);
    const nextSlot = this.activeSlot === 0 ? 1 : 0;
    const nextRevision = this.revision + 1;
    const snapshot: LocalStatePairSnapshot = {
      kind: LOCAL_STATE_PAIR_SNAPSHOT_KIND,
      version: LOCAL_STATE_PAIR_FORMAT_VERSION,
      revision: nextRevision,
      entries: [...nextPairs.entries()],
    };
    const head: LocalStatePairHead = {
      kind: LOCAL_STATE_PAIR_HEAD_KIND,
      version: LOCAL_STATE_PAIR_FORMAT_VERSION,
      activeSlot: nextSlot,
      revision: nextRevision,
    };
    const serializedSnapshot = JSON.stringify(snapshot);
    const serializedHead = JSON.stringify(head);

    localStorage.setItem(this.slotKeys[nextSlot], serializedSnapshot);
    localStorage.setItem(this.headKey, serializedHead);
    this.pairs = nextPairs;
    this.activeSlot = nextSlot;
    this.revision = nextRevision;
  }
}

/** Sync-only match state used by the embedded local transport. */
export class LocalMatchStore {
  private readonly legacyStates: Map<string, StoredState>;
  private readonly legacyInitialStates: Map<string, StoredState>;
  private readonly statePairs?: PersistedStatePairStore;
  private readonly logs: Map<string, LogEntry[]>;
  private readonly metadata: Map<string, Server.MatchData>;
  private readonly persist: boolean;
  private readonly game: Pick<Game, 'stateSchema'>;

  constructor(persist = false, storagePrefix = 'bgio', game: Pick<Game, 'stateSchema'> = {}) {
    this.persist = persist;
    this.game = game;
    if (persist) {
      this.legacyStates = new PersistedMap(`${storagePrefix}_state`);
      this.legacyInitialStates = new PersistedMap(`${storagePrefix}_initial`);
      this.statePairs = new PersistedStatePairStore(storagePrefix);
      this.logs = new PersistedMap(`${storagePrefix}_log`);
      this.metadata = new PersistedMap(`${storagePrefix}_metadata`);
    } else {
      this.legacyStates = new Map();
      this.legacyInitialStates = new Map();
      this.logs = new Map();
      this.metadata = new Map();
    }
  }

  fetch(matchID: string, numPlayers?: number): LocalMatchRecord {
    const committedPair = this.statePairs?.get(matchID);
    const storedState =
      committedPair === undefined ? this.legacyStates.get(matchID) : committedPair.state;
    const storedInitialState =
      committedPair === undefined
        ? this.legacyInitialStates.get(matchID)
        : committedPair.initialState;
    let state = storedState as State | undefined;
    let initialState = storedInitialState as State | undefined;

    if (this.persist && (storedState !== undefined || storedInitialState !== undefined)) {
      const pair = readStatePair(storedState, storedInitialState);
      const playerCount =
        numPlayers ?? (Object.keys(this.metadata.get(matchID)?.players ?? {}).length || 2);
      const stateResult = applyStateMigrations({
        state: structuredClone(pair.state),
        game: this.game,
        fromVersion: pair.gameStateVersion,
        numPlayers: playerCount,
        topLevelSlot: 'state',
      });
      const initialResult = applyStateMigrations({
        state: structuredClone(pair.initialState),
        game: this.game,
        fromVersion: pair.gameStateVersion,
        numPlayers: playerCount,
        topLevelSlot: 'initialState',
      });
      state = stateResult.state as State;
      initialState = initialResult.state as State;
      validateStateStructure(state);
      validateStateStructure(initialState);

      if (!pair.enveloped || stateResult.promoted || initialResult.promoted) {
        validatePersistableGameData(state);
        validatePersistableGameData(initialState);
        const migratedFrom = {
          engineStateVersion: ENGINE_STATE_VERSION,
          gameStateVersion: pair.gameStateVersion,
          migratedAt: Date.now(),
        };
        const stateEnvelope = wrapPersistedState(state, this.game, pair.release, migratedFrom);
        const initialEnvelope = wrapPersistedState(
          initialState,
          this.game,
          pair.release,
          migratedFrom,
        );
        this.statePairs!.set(matchID, {
          state: stateEnvelope,
          initialState: initialEnvelope,
        });
      }
    }

    return {
      state,
      initialState,
      log: this.logs.get(matchID) ?? [],
      metadata: this.metadata.get(matchID),
    };
  }

  createMatch(matchID: string, initialState: State, metadata: Server.MatchData): void {
    if (this.persist) {
      validateStateStructure(initialState);
      validatePersistableGameData(initialState);
      const envelope = wrapPersistedState(initialState, this.game);
      this.statePairs!.set(matchID, { state: envelope, initialState: envelope });
    } else {
      this.legacyInitialStates.set(matchID, initialState);
      this.legacyStates.set(matchID, initialState);
    }
    this.metadata.set(matchID, metadata);
  }

  setState(matchID: string, state: State, deltalog?: LogEntry[]): void {
    if (deltalog && deltalog.length > 0) {
      this.logs.set(matchID, [...(this.logs.get(matchID) ?? []), ...deltalog]);
    }
    if (!this.persist) {
      this.legacyStates.set(matchID, state);
      return;
    }

    const committedPair = this.statePairs!.get(matchID);
    const pair = readStatePair(
      committedPair === undefined ? this.legacyStates.get(matchID) : committedPair.state,
      committedPair === undefined
        ? this.legacyInitialStates.get(matchID)
        : committedPair.initialState,
    );
    const targetVersion = this.game.stateSchema?.version ?? 0;
    if (pair.gameStateVersion !== targetVersion) {
      throw new Error('Persisted state pair must be migrated before setState.');
    }
    validateStateStructure(state);
    validatePersistableGameData(state);
    validatePersistableGameData(pair.initialState);
    this.statePairs!.set(matchID, {
      state: wrapPersistedState(state, this.game, pair.release),
      initialState: wrapPersistedState(pair.initialState, this.game, pair.release),
    });
  }
}

function readStatePair(
  storedState: StoredState | undefined,
  storedInitialState: StoredState | undefined,
): StatePair {
  if (storedState === undefined || storedInitialState === undefined) {
    throw new Error('Persisted state and initialState pair is incomplete.');
  }

  const stateIsEnvelope = isPersistedStateEnvelope(storedState);
  const initialIsEnvelope = isPersistedStateEnvelope(storedInitialState);
  if (stateIsEnvelope !== initialIsEnvelope) {
    throw new Error('Persisted state and initialState envelope mismatch.');
  }

  if (!stateIsEnvelope || !initialIsEnvelope) {
    validateStateStructure(storedState);
    validateStateStructure(storedInitialState);
    return {
      state: storedState,
      initialState: storedInitialState,
      gameStateVersion: 0,
      enveloped: false,
    };
  }

  validateEnvelope(storedState);
  validateEnvelope(storedInitialState);
  if (
    storedState.engineStateVersion !== storedInitialState.engineStateVersion ||
    storedState.gameStateVersion !== storedInitialState.gameStateVersion ||
    !releasesEqual(storedState.release, storedInitialState.release)
  ) {
    throw new Error('Persisted state and initialState version or release mismatch.');
  }
  if (storedState.engineStateVersion > ENGINE_STATE_VERSION) {
    throw new Error(
      `Persisted engine state version ${storedState.engineStateVersion} is ahead of code version ${ENGINE_STATE_VERSION}.`,
    );
  }
  if (storedState.engineStateVersion < ENGINE_STATE_VERSION) {
    throw new Error(
      `Persisted engine state version ${storedState.engineStateVersion} has no local migration.`,
    );
  }

  return {
    state: storedState.state,
    initialState: storedInitialState.state,
    gameStateVersion: storedState.gameStateVersion,
    ...(storedState.release ? { release: storedState.release } : {}),
    enveloped: true,
  };
}

function parseStatePairHead(serialized: string): LocalStatePairHead {
  const value = JSON.parse(serialized) as unknown;
  if (
    !isRecord(value) ||
    value.kind !== LOCAL_STATE_PAIR_HEAD_KIND ||
    value.version !== LOCAL_STATE_PAIR_FORMAT_VERSION ||
    (value.activeSlot !== 0 && value.activeSlot !== 1) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  ) {
    throw new Error('Invalid local state-pair head.');
  }
  return value as unknown as LocalStatePairHead;
}

function parseStatePairSnapshot(serialized: string, revision: number): LocalStatePairSnapshot {
  const value = JSON.parse(serialized) as unknown;
  if (
    !isRecord(value) ||
    value.kind !== LOCAL_STATE_PAIR_SNAPSHOT_KIND ||
    value.version !== LOCAL_STATE_PAIR_FORMAT_VERSION ||
    value.revision !== revision ||
    !Array.isArray(value.entries) ||
    !value.entries.every(isStoredStatePairEntry)
  ) {
    throw new Error('Invalid local state-pair snapshot.');
  }
  const snapshot = value as unknown as LocalStatePairSnapshot;
  if (new Set(snapshot.entries.map(([matchID]) => matchID)).size !== snapshot.entries.length) {
    throw new Error('Invalid duplicate local state-pair entry.');
  }
  return snapshot;
}

function isStoredStatePairEntry(value: unknown): value is [string, StoredStatePair] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    !isRecord(value[1]) ||
    !Object.hasOwn(value[1], 'state') ||
    !Object.hasOwn(value[1], 'initialState')
  ) {
    return false;
  }
  try {
    readStatePair(
      value[1].state as StoredState | undefined,
      value[1].initialState as StoredState | undefined,
    );
    return true;
  } catch {
    return false;
  }
}

function isPersistedStateEnvelope(value: unknown): value is PersistedStateEnvelope {
  return isRecord(value) && value.kind === PERSISTED_STATE_KIND;
}

function validateEnvelope(value: PersistedStateEnvelope): void {
  if (
    value.envelopeVersion !== PERSISTED_STATE_ENVELOPE_VERSION ||
    !Number.isSafeInteger(value.engineStateVersion) ||
    value.engineStateVersion < 0 ||
    !Number.isSafeInteger(value.gameStateVersion) ||
    value.gameStateVersion < 0 ||
    (value.release !== undefined && !isPersistedStateRelease(value.release))
  ) {
    throw new Error('Invalid persisted state envelope.');
  }
  validateStateStructure(value.state);
}

function validateStateStructure(value: unknown): asserts value is State {
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, 'G') ||
    !isRecord(value.ctx) ||
    !isRecord(value.plugins) ||
    !Array.isArray(value._undo) ||
    !Array.isArray(value._redo) ||
    !Number.isSafeInteger(value._stateID) ||
    value._stateID < 0 ||
    !value._undo.every(isHistoryEntry) ||
    !value._redo.every(isHistoryEntry)
  ) {
    throw new Error('Invalid persisted state envelope state.');
  }
}

function isHistoryEntry(value: unknown): boolean {
  return isRecord(value) && Object.hasOwn(value, 'G') && isRecord(value.ctx);
}

function validatePersistableGameData(state: State): void {
  const gameData = {
    G: state.G,
    undo: state._undo.map((entry) => entry.G),
    redo: state._redo.map((entry) => entry.G),
  };
  assertJsonSafe(gameData, new WeakSet<object>());
  let serialized: string;
  try {
    serialized = JSON.stringify(gameData);
  } catch {
    throw new Error('Persisted game data must be JSON-safe.');
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_MIGRATED_GAME_DATA_BYTES) {
    throw new Error('Persisted game data exceeds the local migration size limit.');
  }
}

function assertJsonSafe(value: unknown, seen: WeakSet<object>): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0))
  ) {
    return;
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw new Error('Persisted game data must be JSON-safe.');
  }
  seen.add(value);

  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (
      prototype !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length > 0 ||
      Object.getOwnPropertyNames(value).length !== value.length + 1 ||
      Object.keys(value).length !== value.length
    ) {
      throw new Error('Persisted game data must be JSON-safe.');
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new Error('Persisted game data must be JSON-safe.');
      }
      assertJsonSafe(descriptor.value, seen);
    }
  } else {
    const keys = Object.keys(value);
    if (
      prototype !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length > 0 ||
      Object.getOwnPropertyNames(value).length !== keys.length
    ) {
      throw new Error('Persisted game data must be JSON-safe.');
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (DANGEROUS_KEYS.has(key) || !descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new Error('Persisted game data must be JSON-safe.');
      }
      assertJsonSafe(descriptor.value, seen);
    }
  }
  seen.delete(value);
}

function isPersistedStateRelease(value: unknown): value is PersistedStateRelease {
  return (
    isRecord(value) &&
    typeof value.slug === 'string' &&
    typeof value.version === 'string' &&
    (value.serverScriptHash === undefined || typeof value.serverScriptHash === 'string')
  );
}

function releasesEqual(
  left: PersistedStateRelease | undefined,
  right: PersistedStateRelease | undefined,
): boolean {
  return (
    left?.slug === right?.slug &&
    left?.version === right?.version &&
    left?.serverScriptHash === right?.serverScriptHash
  );
}

function wrapPersistedState(
  state: State,
  game: Pick<Game, 'stateSchema'>,
  release?: PersistedStateRelease,
  migratedFrom?: PersistedStateEnvelope['migratedFrom'],
): PersistedStateEnvelope {
  return {
    kind: PERSISTED_STATE_KIND,
    envelopeVersion: PERSISTED_STATE_ENVELOPE_VERSION,
    engineStateVersion: ENGINE_STATE_VERSION,
    gameStateVersion: game.stateSchema?.version ?? 0,
    ...(release ? { release } : {}),
    ...(migratedFrom ? { migratedFrom } : {}),
    state,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
