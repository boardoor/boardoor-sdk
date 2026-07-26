import { afterEach, describe, expect, test, vi } from 'vitest';

import * as ActionCreators from '../../../core/action-creators';
import { InitializeGame } from '../../../core/initialize';
import type { Game, State, SyncInfo } from '../../../types';
import { GetBotPlayer, LocalMaster } from '../local';

function createState(ctx: Partial<State['ctx']>): State {
  return {
    G: {},
    ctx: {
      gameover: undefined,
      activePlayers: null,
      currentPlayer: '0',
      ...ctx,
    },
  } as State;
}

describe('GetBotPlayer', () => {
  test('skips active bots that have no legal actions', () => {
    const state = createState({
      activePlayers: { '0': 'decision', '1': 'decision' },
      currentPlayer: '0',
    });
    const bots = {
      '0': { enumerate: () => [] },
      '1': { enumerate: () => [{ move: 'decide' }] },
    };

    expect(GetBotPlayer(state, bots)).toBe('1');
  });

  test('returns null when the current bot has no legal actions', () => {
    const state = createState({ currentPlayer: '0' });
    const bots = {
      '0': { enumerate: () => [] },
    };

    expect(GetBotPlayer(state, bots)).toBeNull();
  });
});

const localGame: Game = {
  setup: () => ({
    count: 0,
    players: { '0': { card: 'A' }, '1': { card: 'B' } },
  }),
  playerView: ({ G, playerID }) => ({
    count: G.count,
    hand: playerID === null ? undefined : G.players[playerID],
  }),
  moves: {
    increment: ({ G }) => {
      G.count++;
    },
  },
};

const migratingGame: Game = {
  ...localGame,
  playerView: ({ G, playerID }) => ({
    count: G.count,
    schemaVersion: G.schemaVersion,
    hand: playerID === null ? undefined : G.players[playerID],
  }),
  stateSchema: {
    version: 1,
    migrations: {
      0: (G) => ({ ...(G as Record<string, unknown>), schemaVersion: 1 }),
    },
  },
};

const stubLocalStorage = (
  values: Map<string, string>,
  { failAt, failFrom }: { failAt?: number; failFrom?: number } = {},
) => {
  let writeCount = 0;
  const setItem = vi.fn((key: string, value: string) => {
    writeCount += 1;
    if (writeCount === failAt || (failFrom !== undefined && writeCount >= failFrom)) {
      throw new DOMException('Storage quota exceeded.', 'QuotaExceededError');
    }
    values.set(key, value);
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem,
  });
  return setItem;
};

const createLocalStorage = (
  initial: Record<string, unknown> = {},
  fault?: { failAt?: number; failFrom?: number },
) => {
  const values = new Map(
    Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  return { values, setItem: stubLocalStorage(values, fault) };
};

const stateEntries = (matchID: string, state: unknown) => [[matchID, state]];

interface TestRelease {
  slug: string;
  version: string;
  serverScriptHash?: string;
}

const envelope = (
  state: State,
  gameStateVersion: number,
  release?: TestRelease,
  engineStateVersion = 1,
) => ({
  kind: 'boardoor.persisted-state',
  envelopeVersion: 1,
  engineStateVersion,
  gameStateVersion,
  ...(release ? { release } : {}),
  state,
});

const committedStatePair = (values: Map<string, string>, prefix: string, matchID: string) => {
  const head = JSON.parse(values.get(`${prefix}_state_pair_head`)!) as {
    activeSlot: 0 | 1;
  };
  const snapshot = JSON.parse(values.get(`${prefix}_state_pair_${head.activeSlot}`)!) as {
    entries: [string, { state: unknown; initialState: unknown }][];
  };
  return new Map(snapshot.entries).get(matchID)!;
};

const localStatePair = () => {
  const initialState = InitializeGame({ game: localGame, numPlayers: 2 });
  const state = structuredClone(initialState);
  state.G = { ...state.G, count: 3 };
  state._stateID = 3;
  return { state, initialState };
};

describe('LocalMaster', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('runs sync → move → player-filtered update without a server master', async () => {
    const received: any[] = [];
    const master = new LocalMaster({ game: localGame });
    master.connect('0', (data) => received.push(data));

    await master.onSync('local-match', '0', undefined, 2);

    expect(received[0].type).toBe('sync');
    expect((received[0].args[1] as SyncInfo).state.G).toEqual({
      count: 0,
      hand: { card: 'A' },
    });
    expect((received[0].args[1] as SyncInfo).filteredMetadata).toEqual([{ id: 0 }, { id: 1 }]);

    await master.onUpdate(
      ActionCreators.makeMove('increment', undefined, '0'),
      0,
      'local-match',
      '0',
    );

    expect(received[1].type).toBe('update');
    expect(received[1].args[1]).toMatchObject({
      G: { count: 1, hand: { card: 'A' } },
      _stateID: 1,
    });
  });

  test('selects persistent storage only when requested and restores its state', async () => {
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => values.set(key, value));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem,
    });

    const persisted = new LocalMaster({
      game: localGame,
      persist: true,
      storageKey: 'local-test',
    });
    persisted.connect('0', () => {});
    await persisted.onSync('persisted-match', '0');
    await persisted.onUpdate(
      ActionCreators.makeMove('increment', undefined, '0'),
      0,
      'persisted-match',
      '0',
    );

    expect(setItem).toHaveBeenCalled();
    expect(values.has('local-test_state_pair_head')).toBe(true);
    expect(values.has('local-test_metadata')).toBe(true);
    expect(committedStatePair(values, 'local-test', 'persisted-match')).toMatchObject({
      state: { gameStateVersion: 0, state: { G: { count: 1 } } },
      initialState: { gameStateVersion: 0, state: { G: { count: 0 } } },
    });

    const restored: any[] = [];
    const reloaded = new LocalMaster({ game: localGame, persist: true, storageKey: 'local-test' });
    reloaded.connect('0', (data) => restored.push(data));
    await reloaded.onSync('persisted-match', '0');
    expect((restored[0].args[1] as SyncInfo).state.G).toMatchObject({ count: 1 });
    expect((restored[0].args[1] as SyncInfo).filteredMetadata).toEqual([{ id: 0 }, { id: 1 }]);

    setItem.mockClear();
    const volatile = new LocalMaster({ game: localGame, persist: false });
    volatile.connect('0', () => {});
    await volatile.onSync('volatile-match', '0');
    expect(setItem).not.toHaveBeenCalled();
  });

  test('migrates raw legacy state and initialState into canonical envelopes', async () => {
    const { state, initialState } = localStatePair();
    const { values } = createLocalStorage({
      'migration-test_state': stateEntries('legacy-match', state),
      'migration-test_initial': stateEntries('legacy-match', initialState),
    });

    const received: any[] = [];
    const master = new LocalMaster({
      game: migratingGame,
      persist: true,
      storageKey: 'migration-test',
    });
    master.connect('0', (data) => received.push(data));
    await master.onSync('legacy-match', '0', undefined, 2);

    expect((received[0].args[1] as SyncInfo).state.G).toMatchObject({
      count: 3,
      schemaVersion: 1,
    });
    const storedPair = committedStatePair(values, 'migration-test', 'legacy-match');
    expect(storedPair.state).toMatchObject({
      kind: 'boardoor.persisted-state',
      envelopeVersion: 1,
      engineStateVersion: 1,
      gameStateVersion: 1,
      state: { G: { count: 3, schemaVersion: 1 } },
    });
    expect(storedPair.initialState).toMatchObject({
      kind: 'boardoor.persisted-state',
      gameStateVersion: 1,
      state: { G: { count: 0, schemaVersion: 1 } },
    });
  });

  test('round-trips current envelopes without rewriting localStorage', async () => {
    const { state, initialState } = localStatePair();
    const { setItem } = createLocalStorage({
      'envelope-test_state': stateEntries('current-match', envelope(state, 1)),
      'envelope-test_initial': stateEntries('current-match', envelope(initialState, 1)),
    });

    const received: any[] = [];
    const master = new LocalMaster({
      game: migratingGame,
      persist: true,
      storageKey: 'envelope-test',
    });
    master.connect('0', (data) => received.push(data));
    await master.onSync('current-match', '0', undefined, 2);

    expect((received[0].args[1] as SyncInfo).state.G).toMatchObject({ count: 3 });
    expect(setItem).not.toHaveBeenCalled();
  });

  test('persists a raw migration once and reuses it after storage reload', async () => {
    const { state, initialState } = localStatePair();
    const migration = vi.fn((G: unknown) => ({
      ...(G as Record<string, unknown>),
      schemaVersion: 1,
    }));
    const game: Game = {
      ...migratingGame,
      stateSchema: { version: 1, migrations: { 0: migration } },
    };
    const { setItem } = createLocalStorage({
      'reload-test_state': stateEntries('reload-match', state),
      'reload-test_initial': stateEntries('reload-match', initialState),
    });

    const first = new LocalMaster({ game, persist: true, storageKey: 'reload-test' });
    first.connect('0', () => {});
    await first.onSync('reload-match', '0', undefined, 2);
    const callsAfterPromotion = migration.mock.calls.length;
    const writesAfterPromotion = setItem.mock.calls.length;

    await first.onSync('reload-match', '0', undefined, 2);
    const restored: any[] = [];
    const reloaded = new LocalMaster({ game, persist: true, storageKey: 'reload-test' });
    reloaded.connect('0', (data) => restored.push(data));
    await reloaded.onSync('reload-match', '0', undefined, 2);

    expect(migration).toHaveBeenCalled();
    expect(migration).toHaveBeenCalledTimes(callsAfterPromotion);
    expect(setItem).toHaveBeenCalledTimes(writesAfterPromotion);
    expect((restored[0].args[1] as SyncInfo).state.G).toMatchObject({
      count: 3,
      schemaVersion: 1,
    });
  });

  test('fails closed on state and initialState version mismatch without rewriting storage', async () => {
    const { state, initialState } = localStatePair();
    const { values, setItem } = createLocalStorage({
      'mismatch-test_state': stateEntries('mismatch-match', envelope(state, 0)),
      'mismatch-test_initial': stateEntries('mismatch-match', envelope(initialState, 1)),
    });
    const before = new Map(values);
    const master = new LocalMaster({
      game: migratingGame,
      persist: true,
      storageKey: 'mismatch-test',
    });

    await expect(master.onSync('mismatch-match', '0', undefined, 2)).rejects.toThrow(
      /state.*initialState|pair|mismatch/i,
    );
    expect(setItem).not.toHaveBeenCalled();
    expect(values).toEqual(before);
  });

  test('fails closed on version-ahead envelopes without rewriting storage', async () => {
    const { state, initialState } = localStatePair();
    const { values, setItem } = createLocalStorage({
      'ahead-test_state': stateEntries('ahead-match', envelope(state, 2)),
      'ahead-test_initial': stateEntries('ahead-match', envelope(initialState, 2)),
    });
    const before = new Map(values);
    const master = new LocalMaster({
      game: migratingGame,
      persist: true,
      storageKey: 'ahead-test',
    });

    await expect(master.onSync('ahead-match', '0', undefined, 2)).rejects.toThrow(/ahead/i);
    expect(setItem).not.toHaveBeenCalled();
    expect(values).toEqual(before);
  });

  test('fails closed on malformed envelopes without rewriting storage', async () => {
    const { state } = localStatePair();
    const malformed = { ...envelope(state, 0), state: { G: {} } };
    const { values, setItem } = createLocalStorage({
      'malformed-test_state': stateEntries('malformed-match', malformed),
      'malformed-test_initial': stateEntries('malformed-match', malformed),
    });
    const before = new Map(values);
    const master = new LocalMaster({
      game: migratingGame,
      persist: true,
      storageKey: 'malformed-test',
    });

    await expect(master.onSync('malformed-match', '0', undefined, 2)).rejects.toThrow(/invalid/i);
    expect(setItem).not.toHaveBeenCalled();
    expect(values).toEqual(before);
  });

  test.each(['null pair', 'missing member', 'malformed envelope'] as const)(
    'rejects a committed snapshot with %s without rewriting its head',
    (malformation) => {
      const { state, initialState } = localStatePair();
      const storageKey = `committed-malformed-${malformation.replace(' ', '-')}`;
      let pair: unknown;
      if (malformation === 'null pair') {
        pair = { state: null, initialState: null };
      } else if (malformation === 'missing member') {
        pair = { state: envelope(state, 1) };
      } else {
        pair = {
          state: { ...envelope(state, 1), envelopeVersion: 2 },
          initialState: envelope(initialState, 1),
        };
      }
      const { values, setItem } = createLocalStorage({
        [`${storageKey}_state_pair_head`]: {
          kind: 'boardoor.local-state-pair-head',
          version: 1,
          activeSlot: 0,
          revision: 1,
        },
        [`${storageKey}_state_pair_0`]: {
          kind: 'boardoor.local-state-pairs',
          version: 1,
          revision: 1,
          entries: [['committed-malformed-match', pair]],
        },
      });
      const before = new Map(values);
      const headBefore = values.get(`${storageKey}_state_pair_head`);

      expect(() => new LocalMaster({ game: migratingGame, persist: true, storageKey })).toThrow(
        /invalid/i,
      );
      expect(setItem).not.toHaveBeenCalled();
      expect(values.get(`${storageKey}_state_pair_head`)).toBe(headBefore);
      expect(values).toEqual(before);
    },
  );

  test('keeps raw data intact when a migration throws', async () => {
    const { state, initialState } = localStatePair();
    const { values, setItem } = createLocalStorage({
      'failure-test_state': stateEntries('failure-match', state),
      'failure-test_initial': stateEntries('failure-match', initialState),
    });
    const before = new Map(values);
    const game: Game = {
      ...localGame,
      stateSchema: {
        version: 1,
        migrations: {
          0: () => {
            throw new Error('migration failed');
          },
        },
      },
    };
    const master = new LocalMaster({ game, persist: true, storageKey: 'failure-test' });

    await expect(master.onSync('failure-match', '0', undefined, 2)).rejects.toThrow(
      /migration.*threw/i,
    );
    expect(setItem).not.toHaveBeenCalled();
    expect(values).toEqual(before);
  });

  test('keeps the legacy pair authoritative when the atomic pair commit write fails', async () => {
    const { state, initialState } = localStatePair();
    const migration = vi.fn((G: unknown) => ({
      ...(G as Record<string, unknown>),
      schemaVersion: 1,
    }));
    const game: Game = {
      ...migratingGame,
      stateSchema: { version: 1, migrations: { 0: migration } },
    };
    const originalState = JSON.stringify(stateEntries('atomic-match', state));
    const originalInitial = JSON.stringify(stateEntries('atomic-match', initialState));
    const { values } = createLocalStorage(
      {
        'atomic-test_state': stateEntries('atomic-match', state),
        'atomic-test_initial': stateEntries('atomic-match', initialState),
      },
      { failFrom: 2 },
    );
    const master = new LocalMaster({ game, persist: true, storageKey: 'atomic-test' });

    await expect(master.onSync('atomic-match', '0', undefined, 2)).rejects.toThrow(/quota/i);
    const callsAfterFailure = migration.mock.calls.length;
    expect(values.get('atomic-test_state')).toBe(originalState);
    expect(values.get('atomic-test_initial')).toBe(originalInitial);
    expect(values.has('atomic-test_state_pair_0')).toBe(true);
    expect(values.has('atomic-test_state_pair_head')).toBe(false);

    await expect(master.onSync('atomic-match', '0', undefined, 2)).rejects.toThrow(/quota/i);
    expect(migration.mock.calls.length).toBeGreaterThan(callsAfterFailure);
    expect(values.get('atomic-test_state')).toBe(originalState);
    expect(values.get('atomic-test_initial')).toBe(originalInitial);

    stubLocalStorage(values);
    const restored: any[] = [];
    const reloaded = new LocalMaster({ game, persist: true, storageKey: 'atomic-test' });
    reloaded.connect('0', (data) => restored.push(data));
    await reloaded.onSync('atomic-match', '0', undefined, 2);

    expect((restored[0].args[1] as SyncInfo).state.G).toMatchObject({
      count: 3,
      schemaVersion: 1,
    });
    expect(committedStatePair(values, 'atomic-test', 'atomic-match')).toMatchObject({
      state: { gameStateVersion: 1, state: { G: { count: 3, schemaVersion: 1 } } },
      initialState: { gameStateVersion: 1, state: { G: { count: 0, schemaVersion: 1 } } },
    });
    expect(values.get('atomic-test_state')).toBe(originalState);
    expect(values.get('atomic-test_initial')).toBe(originalInitial);
  });

  test('keeps the prior committed pair authoritative when a later head write fails', async () => {
    const { values } = createLocalStorage();
    const original = new LocalMaster({
      game: localGame,
      persist: true,
      storageKey: 'prior-head-test',
    });
    original.connect('0', () => {});
    await original.onSync('prior-head-match', '0', undefined, 2);
    const headBefore = values.get('prior-head-test_state_pair_head');
    expect(committedStatePair(values, 'prior-head-test', 'prior-head-match')).toMatchObject({
      state: { gameStateVersion: 0, state: { G: { count: 0 } } },
      initialState: { gameStateVersion: 0, state: { G: { count: 0 } } },
    });

    stubLocalStorage(values, { failFrom: 2 });
    const upgrading = new LocalMaster({
      game: migratingGame,
      persist: true,
      storageKey: 'prior-head-test',
    });
    await expect(upgrading.onSync('prior-head-match', '0', undefined, 2)).rejects.toThrow(/quota/i);

    expect(values.get('prior-head-test_state_pair_head')).toBe(headBefore);
    expect(committedStatePair(values, 'prior-head-test', 'prior-head-match')).toMatchObject({
      state: { gameStateVersion: 0, state: { G: { count: 0 } } },
      initialState: { gameStateVersion: 0, state: { G: { count: 0 } } },
    });

    stubLocalStorage(values);
    const restored: any[] = [];
    const reloaded = new LocalMaster({
      game: migratingGame,
      persist: true,
      storageKey: 'prior-head-test',
    });
    reloaded.connect('0', (data) => restored.push(data));
    await reloaded.onSync('prior-head-match', '0', undefined, 2);
    expect((restored[0].args[1] as SyncInfo).state.G).toMatchObject({
      count: 0,
      schemaVersion: 1,
    });
  });

  test('creates a new state pair atomically when the commit write fails', async () => {
    const { values } = createLocalStorage({}, { failFrom: 2 });
    const master = new LocalMaster({
      game: localGame,
      persist: true,
      storageKey: 'create-atomic-test',
    });

    await expect(master.onSync('new-match', '0', undefined, 2)).rejects.toThrow(/quota/i);
    expect(values.has('create-atomic-test_state')).toBe(false);
    expect(values.has('create-atomic-test_initial')).toBe(false);
    expect(values.has('create-atomic-test_state_pair_0')).toBe(true);
    expect(values.has('create-atomic-test_state_pair_head')).toBe(false);
    await expect(master.onSync('new-match', '0', undefined, 2)).rejects.toThrow(/quota/i);

    stubLocalStorage(values);
    const restored: any[] = [];
    const reloaded = new LocalMaster({
      game: localGame,
      persist: true,
      storageKey: 'create-atomic-test',
    });
    reloaded.connect('0', (data) => restored.push(data));
    await reloaded.onSync('new-match', '0', undefined, 2);

    expect((restored[0].args[1] as SyncInfo).state.G).toMatchObject({ count: 0 });
    expect(committedStatePair(values, 'create-atomic-test', 'new-match')).toMatchObject({
      state: { gameStateVersion: 0 },
      initialState: { gameStateVersion: 0 },
    });
    expect(values.has('create-atomic-test_state')).toBe(false);
    expect(values.has('create-atomic-test_initial')).toBe(false);
  });

  test.each([
    ['undefined', undefined],
    ['function', () => 'lost'],
    ['Symbol', Symbol('lost')],
    ['NaN', Number.NaN],
    ['negative zero', -0],
    ['non-JSON object', new Date('2026-07-15T00:00:00Z')],
    ['null-prototype object', Object.assign(Object.create(null), { value: 'lost' })],
  ])('rejects JSON-lossy %s migration output before any canonical write', async (label, lossy) => {
    const { state, initialState } = localStatePair();
    const storageKey = `lossy-${label}`;
    const { values, setItem } = createLocalStorage({
      [`${storageKey}_state`]: stateEntries('lossy-match', state),
      [`${storageKey}_initial`]: stateEntries('lossy-match', initialState),
    });
    const before = new Map(values);
    const game: Game = {
      ...localGame,
      stateSchema: {
        version: 1,
        migrations: {
          0: (G) => ({ ...(G as Record<string, unknown>), lossy }),
        },
      },
    };
    const master = new LocalMaster({ game, persist: true, storageKey });

    await expect(master.onSync('lossy-match', '0', undefined, 2)).rejects.toThrow(/JSON/i);
    expect(setItem).not.toHaveBeenCalled();
    expect(values).toEqual(before);
  });

  test('fails closed on engine-version mismatch without rewriting storage', async () => {
    const { state, initialState } = localStatePair();
    const { values, setItem } = createLocalStorage({
      'engine-test_state': stateEntries('engine-match', envelope(state, 1, undefined, 2)),
      'engine-test_initial': stateEntries('engine-match', envelope(initialState, 1, undefined, 2)),
    });
    const before = new Map(values);
    const master = new LocalMaster({
      game: migratingGame,
      persist: true,
      storageKey: 'engine-test',
    });

    await expect(master.onSync('engine-match', '0', undefined, 2)).rejects.toThrow(
      /engine.*ahead/i,
    );
    expect(setItem).not.toHaveBeenCalled();
    expect(values).toEqual(before);
  });

  test.each([
    ['slug', { slug: 'other-game', version: '1.2.3', serverScriptHash: 'hash-a' }],
    ['version', { slug: 'local-game', version: '2.0.0', serverScriptHash: 'hash-a' }],
    ['serverScriptHash', { slug: 'local-game', version: '1.2.3', serverScriptHash: 'hash-b' }],
  ])(
    'fails closed on release %s mismatch without rewriting storage',
    async (_field, otherRelease) => {
      const { state, initialState } = localStatePair();
      const release = { slug: 'local-game', version: '1.2.3', serverScriptHash: 'hash-a' };
      const { values, setItem } = createLocalStorage({
        'release-mismatch-test_state': stateEntries(
          'release-mismatch-match',
          envelope(state, 1, release),
        ),
        'release-mismatch-test_initial': stateEntries(
          'release-mismatch-match',
          envelope(initialState, 1, otherRelease),
        ),
      });
      const before = new Map(values);
      const master = new LocalMaster({
        game: migratingGame,
        persist: true,
        storageKey: 'release-mismatch-test',
      });

      await expect(master.onSync('release-mismatch-match', '0', undefined, 2)).rejects.toThrow(
        /release.*mismatch/i,
      );
      expect(setItem).not.toHaveBeenCalled();
      expect(values).toEqual(before);
    },
  );

  test('preserves release identity while migrating and updating an atomic pair', async () => {
    const { state, initialState } = localStatePair();
    const release = { slug: 'local-game', version: '1.2.3', serverScriptHash: 'hash-a' };
    const { values } = createLocalStorage({
      'release-test_state': stateEntries('release-match', envelope(state, 0, release)),
      'release-test_initial': stateEntries('release-match', envelope(initialState, 0, release)),
    });
    const master = new LocalMaster({
      game: migratingGame,
      persist: true,
      storageKey: 'release-test',
    });
    master.connect('0', () => {});
    await master.onSync('release-match', '0', undefined, 2);
    await master.onUpdate(
      ActionCreators.makeMove('increment', undefined, '0'),
      3,
      'release-match',
      '0',
    );

    expect(committedStatePair(values, 'release-test', 'release-match')).toMatchObject({
      state: { release, state: { G: { count: 4, schemaVersion: 1 } } },
      initialState: { release, state: { G: { count: 0, schemaVersion: 1 } } },
    });
  });
});
