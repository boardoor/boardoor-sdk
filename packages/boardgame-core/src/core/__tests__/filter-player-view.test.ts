import { applyPatch } from 'rfc6902';
import { describe, expect, test } from 'vitest';

import type { Ctx, Game, LogEntry, State, SyncInfo } from '../../types';
import { getFilterPlayerView } from '../filter-player-view';

type TestG = { secret: string; public: string };

function makeCtx(activePlayers: Ctx['activePlayers']): Ctx {
  return {
    numPlayers: 3,
    playOrder: ['0', '1', '2'],
    playOrderPos: 0,
    activePlayers,
    currentPlayer: '0',
    turn: 1,
    phase: 'play',
    _activePlayersNumMoves: activePlayers
      ? Object.fromEntries(Object.keys(activePlayers).map((id) => [id, 0]))
      : undefined,
  };
}

function makeLog(playerID: string, type = 'respondToCall', redact = false): LogEntry {
  return {
    action: {
      type: 'MAKE_MOVE',
      payload: { type, args: [{ type: 'ron', tiles: [1, 2] }], playerID },
    },
    _stateID: 0,
    turn: 1,
    phase: 'play',
    ...(redact ? { redact: true } : {}),
  };
}

function makeState(
  stateID: number,
  activePlayers: Ctx['activePlayers'],
  deltalog: LogEntry[] = [],
): State<TestG> {
  return {
    G: { secret: 'server-only', public: `state-${stateID}` },
    ctx: makeCtx(activePlayers),
    plugins: {},
    deltalog,
    _undo: [],
    _redo: [],
    _stateID: stateID,
  };
}

const playerView = ({ G }: { G: TestG }) => ({ public: G.public });

const privateTransportGame: Game<TestG> = {
  playerView,
  plugins: [],
  transportView: {
    ctx: ({ ctx, playerID }) => {
      const ownStage = playerID === null ? undefined : ctx.activePlayers?.[playerID];
      const ownMoves = playerID === null ? undefined : ctx['_activePlayersNumMoves']?.[playerID];
      return {
        ...ctx,
        activePlayers: ownStage === undefined ? null : { [playerID!]: ownStage },
        _activePlayersNumMoves: ownMoves === undefined ? undefined : { [playerID!]: ownMoves },
      };
    },
    log: ({ log, playerID }) =>
      log.filter(
        (entry) =>
          entry.action.payload.type !== 'respondToCall' ||
          entry.action.payload.playerID === playerID,
      ),
  },
};

function syncInfo(state: State<TestG>, initialState = state): SyncInfo {
  return {
    state,
    initialState,
    filteredMetadata: [{ id: 0 }, { id: 1 }, { id: 2 }],
    log: state.deltalog ?? [],
  };
}

describe('getFilterPlayerView transportView', () => {
  test('preserves ctx and the existing log-redaction behavior by default', () => {
    const secretLog = makeLog('1', 'secretMove', true);
    const state = makeState(1, { '1': 'respond', '2': 'respond' }, [secretLog]);
    const before = structuredClone(state);
    const filter = getFilterPlayerView({ playerView, plugins: [] });

    const result = filter('0', { type: 'update', args: ['match', state] });

    expect(result.type).toBe('update');
    if (result.type !== 'update') throw new Error('expected update');
    expect(result.args[1].ctx).toEqual(state.ctx);
    expect(result.args[2][0]!.action.payload.args).toBeNull();
    expect(result.args[2][0]).not.toHaveProperty('redact');
    expect(state).toEqual(before);
  });

  test('projects ctx and unresolved logs independently for players and spectators', () => {
    const response = makeLog('1');
    const publicMove = makeLog('0', 'discard');
    const state = makeState(1, { '1': 'respond', '2': 'respond' }, [response, publicMove]);
    const before = structuredClone(state);
    const filter = getFilterPlayerView(privateTransportGame);

    const actor = filter('1', { type: 'update', args: ['match', state] });
    const opponent = filter('0', { type: 'update', args: ['match', state] });
    const spectator = filter(null, { type: 'update', args: ['match', state] });

    if (actor.type !== 'update' || opponent.type !== 'update' || spectator.type !== 'update') {
      throw new Error('expected update payloads');
    }
    expect(actor.args[1].ctx.activePlayers).toEqual({ '1': 'respond' });
    expect(actor.args[2].map((entry) => entry.action.payload.type)).toEqual([
      'respondToCall',
      'discard',
    ]);
    expect(opponent.args[1].ctx.activePlayers).toBeNull();
    expect(opponent.args[2].map((entry) => entry.action.payload.type)).toEqual(['discard']);
    expect(spectator.args[1].ctx.activePlayers).toBeNull();
    expect(spectator.args[2].map((entry) => entry.action.payload.type)).toEqual(['discard']);
    expect(state).toEqual(before);
  });

  test('keeps sync, update, and patch state projections equivalent', () => {
    const prevState = makeState(0, { '1': 'respond', '2': 'respond' });
    const state = makeState(1, { '2': 'respond' }, [makeLog('1')]);
    const prevBefore = structuredClone(prevState);
    const stateBefore = structuredClone(state);
    const filter = getFilterPlayerView(privateTransportGame);

    const previousSync = filter('2', {
      type: 'sync',
      args: ['match', syncInfo(prevState)],
    });
    const currentSync = filter('2', {
      type: 'sync',
      args: ['match', syncInfo(state, prevState)],
    });
    const update = filter('2', { type: 'update', args: ['match', state] });
    const patch = filter('2', {
      type: 'patch',
      args: ['match', prevState['_stateID'], prevState, state],
    });

    if (
      previousSync.type !== 'sync' ||
      currentSync.type !== 'sync' ||
      update.type !== 'update' ||
      patch.type !== 'patch'
    ) {
      throw new Error('unexpected transport payload');
    }

    const patchedState = structuredClone(previousSync.args[1].state);
    expect(applyPatch(patchedState, patch.args[3])).toEqual(patch.args[3].map(() => null));
    expect(patchedState).toEqual(currentSync.args[1].state);
    expect(update.args[1]).toEqual(currentSync.args[1].state);
    expect(currentSync.args[1].log).toEqual([]);
    expect(update.args[2]).toEqual([]);
    expect(patch.args[4]).toEqual([]);
    expect(currentSync.args[1].initialState.ctx.activePlayers).toEqual({ '2': 'respond' });
    expect(prevState).toEqual(prevBefore);
    expect(state).toEqual(stateBefore);
  });

  test('applies standard redaction before the game log projection', () => {
    const state = makeState(1, { '2': 'respond' }, [makeLog('2', 'respondToCall', true)]);
    const seenArgs: unknown[] = [];
    const game: Game<TestG> = {
      playerView,
      plugins: [],
      transportView: {
        log: ({ log }) => {
          seenArgs.push(log[0]!.action.payload.args);
          return [];
        },
      },
    };

    const result = getFilterPlayerView(game)(null, {
      type: 'sync',
      args: ['match', syncInfo(state)],
    });

    expect(result.type).toBe('sync');
    expect(seenArgs).toEqual([null]);
    if (result.type === 'sync') expect(result.args[1].log).toEqual([]);
  });
});
