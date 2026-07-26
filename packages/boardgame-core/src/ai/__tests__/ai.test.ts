/*
 * Copyright 2018 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import { describe, test, expect, vi } from 'vitest';

import { Client } from '../../client/client';
import { makeMove } from '../../core/action-creators';
import { MAKE_MOVE, GAME_EVENT } from '../../core/action-types';
import { ProcessGameConfig } from '../../core/game';
import { InitializeGame } from '../../core/initialize';
import { Stage } from '../../core/turn-order';
import type { AnyFn, Game, Ctx } from '../../types';
import { Step, Simulate } from '../ai';
import { MCTSBot } from '../mcts-bot';
import type { Node } from '../mcts-bot';
import { RandomBot } from '../random-bot';

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

  const isRowComplete = (row: number[]) => {
    const symbols = row.map((i) => cells[i]);
    return symbols.every((i) => i !== null && i === symbols[0]);
  };

  return positions.map((row) => isRowComplete(row)).includes(true);
}

const TicTacToe = ProcessGameConfig({
  setup: () => ({
    cells: Array.from({ length: 9 }).fill(null) as (string | null)[],
  }),

  moves: {
    clickCell({ G, ctx }, id: number) {
      const cells = [...G.cells];
      if (cells[id] === null) {
        cells[id] = ctx.currentPlayer;
      }
      return { ...G, cells };
    },
  },

  turn: { minMoves: 1, maxMoves: 1 },

  endIf: ({ G, ctx }) => {
    if (IsVictory(G.cells)) {
      return { winner: ctx.currentPlayer };
    }

    if (G.cells.filter((t: string | null) => t == null).length === 0) {
      return { draw: true };
    }
  },
});

const enumerate = (G: any, ctx: Ctx, playerID: string) => {
  const r: ReturnType<typeof makeMove>[] = [];
  for (let i = 0; i < 9; i++) {
    if (G.cells[i] === null) {
      r.push(makeMove('clickCell', [i], playerID));
    }
  }
  return r;
};

describe('Step', () => {
  test('advances game state', async () => {
    const client = Client<{ moved: boolean }>({
      game: {
        setup: () => ({ moved: false }),

        moves: {
          clickCell({ G }) {
            return { moved: !G.moved };
          },
        },

        endIf({ G }) {
          if (G.moved) return true;
        },

        ai: {
          enumerate: () => [{ move: 'clickCell' }],
        },
      },
    });

    const bot = new RandomBot({ enumerate: client.game.ai.enumerate });
    expect(client.getState().G).toEqual({ moved: false });
    await Step(client, bot);
    expect(client.getState().G).toEqual({ moved: true });
  });

  test('does not crash on empty action', async () => {
    const client = Client({
      game: {
        ai: {
          enumerate: () => [],
        },
      },
    });
    const bot = new RandomBot({ enumerate: client.game.ai.enumerate });
    await expect(Step(client, bot)).resolves.toBeUndefined();
  });

  test('works with stages', async () => {
    const client = Client({
      game: {
        moves: {
          A: ({ G }) => {
            G.moved = true;
          },
        },

        turn: {
          activePlayers: { currentPlayer: 'stage' },
        },

        ai: {
          enumerate: () => [{ move: 'A' }],
        },
      },
    });

    const bot = new RandomBot({ enumerate: client.game.ai.enumerate });
    expect(client.getState().G).not.toEqual({ moved: true });
    await Step(client, bot);
    expect(client.getState().G).toEqual({ moved: true });
  });
});

describe('Simulate', () => {
  const bots = {
    '0': new RandomBot({ seed: 'test', enumerate }),
    '1': new RandomBot({ seed: 'test', enumerate }),
  };

  test('multiple bots', async () => {
    const state = InitializeGame({ game: TicTacToe });
    const { state: endState } = await Simulate({
      game: TicTacToe,
      bots,
      state,
    });
    expect(endState.ctx.gameover).not.toBe(undefined);
  });

  test('single bot', async () => {
    const bot = new RandomBot({ seed: 'test', enumerate });
    const state = InitializeGame({ game: TicTacToe });
    const { state: endState } = await Simulate({
      game: TicTacToe,
      bots: bot,
      state,
      depth: 10,
    });
    expect(endState.ctx.gameover).not.toBe(undefined);
  });

  test('with activePlayers', async () => {
    const game = ProcessGameConfig({
      moves: {
        A: ({ G }) => {
          G.moved = true;
        },
      },
      turn: {
        activePlayers: { currentPlayer: Stage.NULL },
      },
      endIf: ({ G }) => G.moved,
    });

    const bot = new RandomBot({
      seed: 'test',
      enumerate: () => [makeMove('A')],
    });

    const state = InitializeGame({ game });
    const { state: endState } = await Simulate({
      game,
      bots: bot,
      state,
      depth: 1,
    });
    expect(endState.ctx.gameover).not.toBe(undefined);
  });
});

describe('Bot', () => {
  test('random', () => {
    const b = new RandomBot({ enumerate: () => [] });
    expect(b.random()).toBeGreaterThanOrEqual(0);
    expect(b.random()).toBeLessThan(1);
  });

  test('enumerate - makeMove', () => {
    const enumerate = () => [makeMove('move')];
    const b = new RandomBot({ enumerate });
    expect(b.enumerate(undefined, undefined, undefined)[0].type).toBe(MAKE_MOVE);
  });

  test('enumerate - translate to makeMove', () => {
    const enumerate = () => [{ move: 'move' }];
    const b = new RandomBot({ enumerate });
    expect(b.enumerate(undefined, undefined, undefined)[0].type).toBe(MAKE_MOVE);
  });

  test('enumerate - translate to gameEvent', () => {
    const enumerate = () => [{ event: 'endTurn' }];
    const b = new RandomBot({ enumerate });
    expect(b.enumerate(undefined, undefined, undefined)[0].type).toBe(GAME_EVENT);
  });

  test('enumerate - unrecognized', () => {
    const enumerate = (() => [{ unknown: true }] as unknown) as Game['ai']['enumerate'];
    const b = new RandomBot({ enumerate });
    expect(b.enumerate(undefined, undefined, undefined)).toEqual([undefined]);
  });
});

describe('MCTSBot', () => {
  test('game that never ends', async () => {
    const game: Game = {};
    const state = InitializeGame({ game });
    const bot = new MCTSBot({ seed: 'test', game, enumerate: () => [] });
    const { state: endState } = await Simulate({ game, bots: bot, state });
    expect(endState.ctx.turn).toBe(1);
  });

  test('RandomBot vs. MCTSBot', async () => {
    const bots = {
      '0': new RandomBot({ seed: 'test', enumerate }),
      '1': new MCTSBot({
        iterations: 200,
        seed: 'test',
        game: TicTacToe,
        enumerate,
      }),
    };

    const initialState = InitializeGame({ game: TicTacToe });

    for (let i = 0; i < 5; i++) {
      const state = initialState;
      // oxlint-disable-next-line no-await-in-loop -- each seeded simulation is asserted independently
      const { state: endState } = await Simulate({
        game: TicTacToe,
        bots,
        state,
      });
      expect(endState.ctx.gameover).not.toEqual({ winner: '0' });
    }
  });

  test('MCTSBot vs. MCTSBot', { timeout: 30000 }, async () => {
    const initialState = InitializeGame({ game: TicTacToe });
    const iterations = 400;

    for (let i = 0; i < 5; i++) {
      const bots = {
        '0': new MCTSBot({
          seed: i,
          game: TicTacToe,
          enumerate,
          iterations,
          playoutDepth: 50,
        }),
        '1': new MCTSBot({
          seed: i,
          game: TicTacToe,
          enumerate,
          iterations,
        }),
      };
      const state = initialState;
      // oxlint-disable-next-line no-await-in-loop -- each seeded simulation is asserted independently
      const { state: endState } = await Simulate({
        game: TicTacToe,
        bots,
        state,
      });
      expect(endState.ctx.gameover).toEqual({ draw: true });
    }
  });

  test('with activePlayers', async () => {
    const game = ProcessGameConfig({
      setup: () => ({ moves: 0 }),
      moves: {
        A: ({ G }) => {
          G.moves++;
        },
      },
      turn: {
        activePlayers: { currentPlayer: Stage.NULL },
      },
      endIf: ({ G }) => G.moves > 5,
    });

    const bot = new MCTSBot({
      seed: 'test',
      game,
      enumerate: () => [makeMove('A')],
    });

    const state = InitializeGame({ game });
    const { state: endState } = await Simulate({
      game,
      bots: bot,
      state,
      depth: 10,
    });
    expect(endState.ctx.gameover).not.toBe(undefined);
  });

  test('objectives', async () => {
    // Player-specific objective: reward having OWN piece on square 0.
    // The objectives function receives playerID, so the checker uses closure.
    const objectives = (_G: any, _ctx: Ctx, playerID?: string) => ({
      'own-piece-on-square-0': {
        checker: (G: any) => G.cells[0] === playerID,
        weight: 10,
      },
    });

    const state = InitializeGame({ game: TicTacToe });

    for (let i = 0; i < 10; i++) {
      const bot = new MCTSBot({
        iterations: 200,
        seed: i,
        game: TicTacToe,
        enumerate,
        objectives,
      });

      // oxlint-disable-next-line no-await-in-loop -- exercise seeded objective selection one rollout at a time
      const { action } = await bot.play(state, '0');
      expect(action!.payload.args).toEqual([0]);
    }
  });

  test('objectives only credit the player who achieved them', async () => {
    // Objective: player's own piece on square 4 (center) is good.
    // Without scoringPlayerID fix, the bot would also reward paths where
    // the OPPONENT plays on square 4, making it confused.
    const objectives = (_G: any, _ctx: Ctx, playerID?: string) => ({
      'own-center': {
        checker: (G: any) => G.cells[4] === playerID,
        weight: 10,
      },
    });

    const state = InitializeGame({ game: TicTacToe });

    // Player '0' should try to take center, not leave it for '1'
    const bot = new MCTSBot({
      iterations: 200,
      seed: 'adversarial-obj',
      game: TicTacToe,
      enumerate,
      objectives,
    });

    const { action } = await bot.play(state, '0');
    // The bot should play on center (4) since its own objective rewards that
    expect(action!.payload.args).toEqual([4]);
  });

  describe('iterations & playout depth', () => {
    test('set opts', () => {
      const bot = new MCTSBot({ game: TicTacToe, enumerate: vi.fn() });
      bot.setOpt('iterations', 1);
      expect(bot.opts()['iterations'].value).toBe(1);
    });

    test('setOpt works on invalid key', () => {
      const bot = new RandomBot({ enumerate: vi.fn() });
      const setInvalidKey = () => bot.setOpt('unknown', 1);
      const getInvalidKey = () => bot.getOpt('unknown');
      expect(setInvalidKey).not.toThrow();
      expect(getInvalidKey).toThrow();
    });

    test('functions', () => {
      const state = InitializeGame({ game: TicTacToe });

      // jump ahead in the game because the example iterations
      // and playoutDepth functions are based on the turn
      state.ctx.turn = 8;

      const { turn, currentPlayer } = state.ctx;

      const enumerateSpy = vi.fn(enumerate);

      const bot = new MCTSBot({
        game: TicTacToe,
        enumerate: enumerateSpy,
        iterations: (_G, ctx) => ctx.turn * 100,
        playoutDepth: (_G, ctx) => ctx.turn * 10,
      });

      expect((bot.iterations as AnyFn)(null, { turn } as Ctx, currentPlayer)).toBe(turn * 100);
      expect((bot.playoutDepth as AnyFn)(null, { turn } as Ctx, currentPlayer)).toBe(turn * 10);

      // try the playout() function which requests the playoutDepth value
      bot.playout({ state } as Node);

      expect(enumerateSpy).toHaveBeenCalledWith(state.G, state.ctx, currentPlayer);

      // then try the play() function which requests the iterations value
      enumerateSpy.mockClear();

      bot.play(state, currentPlayer);

      expect(enumerateSpy).toHaveBeenCalledWith(state.G, state.ctx, currentPlayer);
    });
  });
});
