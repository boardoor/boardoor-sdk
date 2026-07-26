import { afterEach, describe, expect, test, vi } from 'vitest';

import { makeMove } from '../../core/action-creators';
import { ProcessGameConfig } from '../../core/game';
import { InitializeGame } from '../../core/initialize';
import type { Ctx, Game } from '../../types';
import { DeterminizedBot } from '../determinized-bot';
import { MCTSBot } from '../mcts-bot';

const ChoiceGame: Game = {
  setup: () => ({ picks: [] as number[] }),
  moves: {
    pick: ({ G }: { G: { picks: number[] } }, value: number) => ({
      picks: [...G.picks, value],
    }),
  },
  turn: { minMoves: 1, maxMoves: 1 },
};

const enumerate = (_G: unknown, _ctx: Ctx, playerID: string) => [
  makeMove('pick', [0], playerID),
  makeMove('pick', [1], playerID),
];

function initialState() {
  const game = ProcessGameConfig(ChoiceGame);
  return { game, state: InitializeGame({ game, numPlayers: 2 }) };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MCTSBot wall-clock budget', () => {
  test('yields between chunks and returns best-so-far when the budget expires', async () => {
    const { game, state } = initialState();
    let now = 1_000;
    const completedChunks: number[] = [];
    const yieldSpy = vi.fn(async () => {
      now += 1;
    });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('scheduler', { yield: yieldSpy });

    const bot = new MCTSBot({
      game,
      enumerate,
      seed: 'budget',
      iterations: 1_000,
      timeBudgetMs: 5,
      playoutDepth: 2,
      iterationCallback: ({ iterationCounter }) => {
        completedChunks.push(iterationCounter);
        now += 3;
      },
    });

    const result = await bot.play(state, '0');

    expect(result.action?.payload.type).toBe('pick');
    expect(completedChunks.at(-1)).toBeLessThan(1_000);
    expect(yieldSpy).toHaveBeenCalled();
  });
});

describe('DeterminizedBot wall-clock budget', () => {
  test('stops sampling when the shared budget expires and aggregates completed samples', async () => {
    const { game, state } = initialState();
    let now = 2_000;
    const sampleHiddenState = vi.fn((G: unknown) => {
      now += 2;
      return G;
    });
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const bot = new DeterminizedBot({
      game,
      enumerate,
      seed: 'det-budget',
      sampleHiddenState,
      iterations: 200,
      samples: 5,
      playoutDepth: 2,
      timeBudgetMs: 5,
    });

    const result = await bot.play(state, '0');

    expect(result.action?.payload.type).toBe('pick');
    expect(sampleHiddenState).toHaveBeenCalled();
    expect(sampleHiddenState.mock.calls.length).toBeLessThan(5);
    // Sampling can consume the remaining budget, in which case the last sample
    // is drawn but no MCTS run starts for it — so completed <= sampled.
    expect(result.metadata.completedSamples).toBeGreaterThanOrEqual(1);
    expect(result.metadata.completedSamples).toBeLessThanOrEqual(
      sampleHiddenState.mock.calls.length,
    );
    expect(result.metadata.budgetExpired).toBe(true);
  });
});
