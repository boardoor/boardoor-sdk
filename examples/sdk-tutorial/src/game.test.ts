import { Client } from '@boardoor/core';
import { describe, expect, it } from 'vitest';

import { LastStone } from './game.ts';

type TakeCount = 1 | 2;

function makeClient(moves: ReadonlyArray<TakeCount> = []) {
  const client = Client({ game: LastStone, numPlayers: 2 });
  client.start();
  for (const count of moves) client.moves.take(count);
  return client;
}

function reachableHistories(
  remaining = 5,
  moves: ReadonlyArray<TakeCount> = [],
): Array<ReadonlyArray<TakeCount>> {
  const histories = [moves];
  for (const count of [1, 2] as const) {
    if (count <= remaining) {
      histories.push(...reachableHistories(remaining - count, [...moves, count]));
    }
  }
  return histories;
}

const reachableStates = reachableHistories().map((moves) => ({
  label: moves.length === 0 ? 'initial state' : `moves ${moves.join(', ')}`,
  moves,
}));

describe('Last Stone', () => {
  it('accepts take-1 and take-2 moves and advances the turn', () => {
    const client = makeClient();

    client.moves.take(1);
    expect(client.getState()!.G.remaining).toBe(4);
    expect(client.getState()!.ctx.currentPlayer).toBe('1');

    client.moves.take(2);
    expect(client.getState()!.G.remaining).toBe(2);
    expect(client.getState()!.ctx.currentPlayer).toBe('0');
  });

  it('rejects an overshoot with INVALID_MOVE semantics', () => {
    const client = makeClient();
    client.moves.take(2);
    client.moves.take(2);
    const before = client.getState()!;

    client.moves.take(2);
    const after = client.getState()!;

    expect(after.G.remaining).toBe(1);
    expect(after.ctx.currentPlayer).toBe(before.ctx.currentPlayer);
    expect(after.G.lastTake).toEqual(before.G.lastTake);
  });

  it('ends the game when a player takes exactly the final stone', () => {
    const client = makeClient();
    client.moves.take(1);
    client.moves.take(2);
    client.moves.take(2);

    expect(client.getState()!.G.remaining).toBe(0);
    expect(client.getState()!.ctx.gameover).toEqual({ winner: '0' });
  });

  it.each(reachableStates)('keeps the AI contract legal for $label', async ({ moves }) => {
    const client = makeClient(moves);
    const state = client.getState()!;
    const currentPlayer = state.ctx.currentPlayer;
    const offTurnPlayer = currentPlayer === '0' ? '1' : '0';
    const enumerated = LastStone.ai!.enumerate(state.G, state.ctx, currentPlayer);

    for (const action of enumerated) {
      expect(action).toMatchObject({ move: 'take' });
      if (!('move' in action)) throw new Error('AI enumeration returned a non-move action');
      const count = action.args?.[0] as TakeCount;
      expect([1, 2]).toContain(count);
      expect(count).toBeLessThanOrEqual(state.G.remaining);

      const branch = makeClient(moves);
      branch.moves.take(count);
      expect(branch.getState()!.G.remaining).toBe(state.G.remaining - count);
    }

    const bestMove = await LastStone.ai!.bestMove!(state.G, state.ctx, currentPlayer, 'medium');
    if (bestMove !== null) expect(enumerated).toContainEqual(bestMove);

    expect(LastStone.ai!.enumerate(state.G, state.ctx, offTurnPlayer)).toEqual([]);
    const offTurnBestMove = await LastStone.ai!.bestMove!(
      state.G,
      state.ctx,
      offTurnPlayer,
      'strong',
    );
    expect(offTurnBestMove).toBeNull();

    if (state.ctx.gameover !== undefined) {
      expect(enumerated).toEqual([]);
      expect(bestMove).toBeNull();
    } else {
      expect(enumerated.length).toBeGreaterThan(0);
      expect(bestMove).not.toBeNull();
    }
  });
});
