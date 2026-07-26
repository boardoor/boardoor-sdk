import { describe, test, expect, vi } from 'vitest';

import { Client } from '../../client/client';
import { makeMove } from '../../core/action-creators';
import { ProcessGameConfig } from '../../core/game';
import type { Ctx, Game } from '../../types';
import { DeterminizedBot } from '../determinized-bot';

function IsVictory(cells: (string | null)[]) {
  const positions = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  return positions.some((row) => row.every((i) => cells[i] !== null && cells[i] === cells[row[0]]));
}

const TicTacToe: Game = {
  setup: () => ({
    cells: Array.from({ length: 9 }).fill(null) as (string | null)[],
  }),
  moves: {
    clickCell({ G, ctx }, id: number) {
      const cells = [...G.cells];
      if (cells[id] === null) cells[id] = ctx.currentPlayer;
      return { ...G, cells };
    },
  },
  turn: { minMoves: 1, maxMoves: 1 },
  endIf: ({ G, ctx }) => {
    if (IsVictory(G.cells)) return { winner: ctx.currentPlayer };
    if (G.cells.filter((t: string | null) => t == null).length === 0) return { draw: true };
  },
};

const enumerate = (G: any, _ctx: Ctx, playerID: string) => {
  const r: ReturnType<typeof makeMove>[] = [];
  for (let i = 0; i < 9; i++) {
    if (G.cells[i] === null) r.push(makeMove('clickCell', [i], playerID));
  }
  return r;
};

describe('DeterminizedBot', () => {
  test('plays a valid move with identity sampleHiddenState', async () => {
    const client = Client({ game: TicTacToe, numPlayers: 2 });
    client.start();
    const state = client.getState()!;

    const bot = new DeterminizedBot({
      game: ProcessGameConfig(TicTacToe),
      enumerate,
      seed: 'test',
      sampleHiddenState: (G) => G,
      iterations: 50,
      playoutDepth: 20,
      samples: 3,
    });

    const result = await bot.play(state, '0');
    expect(result.action).toBeDefined();
    expect(result.action!.payload.type).toBe('clickCell');
    expect(result.action!.payload.args).toHaveLength(1);
    const cellId = result.action!.payload.args[0] as number;
    expect(cellId).toBeGreaterThanOrEqual(0);
    expect(cellId).toBeLessThan(9);
  });

  test('calls sampleHiddenState N times (= samples)', async () => {
    const client = Client({ game: TicTacToe, numPlayers: 2 });
    client.start();
    const state = client.getState()!;

    const sampleFn = vi.fn((G: any) => G);
    const bot = new DeterminizedBot({
      game: ProcessGameConfig(TicTacToe),
      enumerate,
      seed: 'test',
      sampleHiddenState: sampleFn,
      iterations: 30,
      playoutDepth: 10,
      samples: 4,
    });

    await bot.play(state, '0');
    expect(sampleFn).toHaveBeenCalledTimes(4);
    expect(sampleFn).toHaveBeenCalledWith(state.G, '0');
  });

  test('falls back to MCTSBot when no sampleHiddenState', async () => {
    const client = Client({ game: TicTacToe, numPlayers: 2 });
    client.start();
    const state = client.getState()!;

    const bot = new DeterminizedBot({
      game: ProcessGameConfig(TicTacToe),
      enumerate,
      seed: 'test',
      iterations: 50,
      playoutDepth: 20,
      samples: 3,
    });

    const result = await bot.play(state, '0');
    expect(result.action).toBeDefined();
    expect(result.action!.payload.type).toBe('clickCell');
  });

  test('uses objectives when provided', async () => {
    const client = Client({ game: TicTacToe, numPlayers: 2 });
    client.start();
    const state = client.getState()!;

    const objectives = (_G: any, _ctx: Ctx, _playerID?: string) => ({
      center: {
        checker: (G: any) => G.cells[4] !== null,
        weight: 10,
      },
    });

    const bot = new DeterminizedBot({
      game: ProcessGameConfig(TicTacToe),
      enumerate,
      seed: 'test',
      sampleHiddenState: (G) => G,
      objectives,
      iterations: 100,
      playoutDepth: 20,
      samples: 3,
    });

    const result = await bot.play(state, '0');
    expect(result.action).toBeDefined();
  });

  test('votes across samples and picks most frequent action', async () => {
    const client = Client({ game: TicTacToe, numPlayers: 2 });
    client.start();
    const state = client.getState()!;

    const bot = new DeterminizedBot({
      game: ProcessGameConfig(TicTacToe),
      enumerate,
      seed: 'deterministic-vote',
      sampleHiddenState: (G) => G,
      iterations: 100,
      playoutDepth: 20,
      samples: 5,
    });

    const result = await bot.play(state, '0');
    expect(result.action).toBeDefined();
    expect(result.metadata.samples).toBe(5);
    expect(result.metadata.votes).toBeGreaterThan(0);
  });
});
