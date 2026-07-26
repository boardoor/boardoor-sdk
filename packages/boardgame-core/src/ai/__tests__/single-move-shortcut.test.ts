import { describe, test, expect } from 'vitest';

import { makeMove } from '../../core/action-creators';
import { ProcessGameConfig } from '../../core/game';
import { InitializeGame } from '../../core/initialize';
import type { Ctx, Game } from '../../types';
import { DeterminizedBot } from '../determinized-bot';
import { MCTSBot } from '../mcts-bot';

// A game where the only legal move (`finish`) ends the game. Each call to the
// `finish` reducer increments a shared counter, so any playout the bot runs is
// observable: with the single-move shortcut the bot must not run playouts.
function makeForcedMoveGame(counter: { calls: number }): Game {
  return {
    setup: () => ({ done: false }),
    moves: {
      finish: ({ G }: { G: any }) => {
        counter.calls++;
        return { ...G, done: true };
      },
    },
    endIf: ({ G }: { G: any }) => (G.done ? { winner: '0' } : undefined),
  };
}

const enumerate = (G: any, _ctx: Ctx, playerID: string) =>
  G.done ? [] : [makeMove('finish', [], playerID)];

function initialState(game: Game) {
  return InitializeGame({ game: ProcessGameConfig(game), numPlayers: 1 });
}

describe('single-move shortcut', () => {
  test('MCTSBot returns the only legal action without running playouts', async () => {
    const counter = { calls: 0 };
    const game = makeForcedMoveGame(counter);
    const state = initialState(game);

    const bot = new MCTSBot({
      game: ProcessGameConfig(game),
      enumerate,
      iterations: 1000,
      playoutDepth: 50,
      seed: 'test',
    });

    const { action } = await bot.play(state, state.ctx.currentPlayer);

    expect(action?.payload.type).toBe('finish');
    expect(counter.calls).toBe(0);
  });

  test('DeterminizedBot returns the only legal action without running playouts', async () => {
    const counter = { calls: 0 };
    const game = makeForcedMoveGame(counter);
    const state = initialState(game);

    const bot = new DeterminizedBot({
      game: ProcessGameConfig(game),
      enumerate,
      sampleHiddenState: (G) => G,
      iterations: 1000,
      playoutDepth: 50,
      samples: 5,
      seed: 'test',
    });

    const { action } = await bot.play(state, state.ctx.currentPlayer);

    expect(action?.payload.type).toBe('finish');
    expect(counter.calls).toBe(0);
  });

  test('MCTSBot still searches when multiple actions are legal', async () => {
    const counter = { calls: 0 };
    const multiGame: Game = {
      setup: () => ({ done: false }),
      moves: {
        pick: ({ G }: { G: any }) => {
          counter.calls++;
          return { ...G, done: true };
        },
      },
      endIf: ({ G }: { G: any }) => (G.done ? { winner: '0' } : undefined),
    };
    const multiEnumerate = (G: any, _ctx: Ctx, playerID: string) =>
      G.done ? [] : [makeMove('pick', [0], playerID), makeMove('pick', [1], playerID)];
    const state = initialState(multiGame);

    const bot = new MCTSBot({
      game: ProcessGameConfig(multiGame),
      enumerate: multiEnumerate,
      iterations: 10,
      playoutDepth: 50,
      seed: 'test',
    });

    const { action } = await bot.play(state, state.ctx.currentPlayer);

    expect(action?.payload.type).toBe('pick');
    expect(counter.calls).toBeGreaterThan(0);
  });
});
