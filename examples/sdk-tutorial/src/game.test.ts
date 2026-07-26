import { Client } from '@boardoor/core';
import { describe, expect, it } from 'vitest';

import { LastStone } from './game.ts';

function makeClient() {
  const client = Client({ game: LastStone, numPlayers: 2 });
  client.start();
  return client;
}

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
});
