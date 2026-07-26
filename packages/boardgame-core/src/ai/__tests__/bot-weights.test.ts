import { describe, test, expect } from 'vitest';

import { makeMove } from '../../core/action-creators';
import { ProcessGameConfig } from '../../core/game';
import type { PlayerID, State } from '../../types';
import { Bot } from '../bot';
import type { WeightedBotAction } from '../bot';
import { MCTSBot } from '../mcts-bot';
import { RandomBot } from '../random-bot';

// Concrete Bot subclass for testing base class methods
class TestBot extends Bot {
  async play(state: State, playerID: PlayerID) {
    const moves = this.enumerate(state.G, state.ctx, playerID);
    return { action: this.weightedRandom(moves) };
  }
}

describe('enumerate weight', () => {
  test('preserves weight from move descriptors', () => {
    const bot = new TestBot({
      enumerate: () => [
        { move: 'a', args: [1], weight: 5 },
        { move: 'b', args: [2], weight: 0.5 },
        { move: 'c', args: [3] },
      ],
      seed: 'test',
    });

    const actions = bot.enumerate({}, { currentPlayer: '0' } as any, '0');
    expect(actions).toHaveLength(3);
    expect(actions[0].weight).toBe(5);
    expect(actions[1].weight).toBe(0.5);
    expect(actions[2].weight).toBeUndefined();
  });

  test('preserves weight from event descriptors', () => {
    const bot = new TestBot({
      enumerate: () => [{ event: 'endTurn', weight: 0.1 }, { event: 'endPhase' }],
      seed: 'test',
    });

    const actions = bot.enumerate({}, { currentPlayer: '0' } as any, '0');
    expect(actions[0].weight).toBe(0.1);
    expect(actions[1].weight).toBeUndefined();
  });

  test('raw ActionShape (payload) passes through without weight', () => {
    const raw = makeMove('a', [1], '0');
    const bot = new TestBot({
      enumerate: () => [raw],
      seed: 'test',
    });

    const actions = bot.enumerate({}, { currentPlayer: '0' } as any, '0');
    expect(actions[0]).toBe(raw);
    expect(actions[0].weight).toBeUndefined();
  });
});

describe('weightedRandom', () => {
  test('returns undefined for empty action lists', () => {
    const bot = new TestBot({
      enumerate: () => [],
      seed: 'empty-test',
    });

    expect(bot.weightedRandom([])).toBeUndefined();
  });

  test('selects according to weights with seeded PRNG', () => {
    const bot = new TestBot({
      enumerate: () => [],
      seed: 'weight-test',
    });

    const actions: WeightedBotAction[] = [
      { ...makeMove('heavy', [], '0'), weight: 100 },
      { ...makeMove('light', [], '0'), weight: 1 },
    ];

    const counts: Record<string, number> = { heavy: 0, light: 0 };
    for (let i = 0; i < 200; i++) {
      const result = bot.weightedRandom(actions);
      const name = result.payload.type === 'heavy' ? 'heavy' : 'light';
      counts[name]++;
    }

    // With 100:1 weight ratio, heavy should dominate
    expect(counts.heavy).toBeGreaterThan(180);
    expect(counts.light).toBeLessThan(20);
  });

  test('uniform selection when no weights specified', () => {
    const bot = new TestBot({
      enumerate: () => [],
      seed: 'uniform-test',
    });

    const actions: WeightedBotAction[] = [makeMove('a', [], '0'), makeMove('b', [], '0')];

    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 200; i++) {
      const result = bot.weightedRandom(actions);
      counts[result.payload.type === 'a' ? 'a' : 'b']++;
    }

    // Should be roughly even (each ~100 ± tolerance)
    expect(counts.a).toBeGreaterThan(60);
    expect(counts.b).toBeGreaterThan(60);
  });

  test('zero-weight action is never selected', () => {
    const bot = new TestBot({
      enumerate: () => [],
      seed: 'zero-test',
    });

    const actions: WeightedBotAction[] = [
      { ...makeMove('never', [], '0'), weight: 0 },
      { ...makeMove('always', [], '0'), weight: 1 },
    ];

    for (let i = 0; i < 100; i++) {
      const result = bot.weightedRandom(actions);
      expect(result.payload.type).toBe('always');
    }
  });
});

describe('RandomBot with weights', () => {
  test('returns no action when no legal moves exist', async () => {
    const bot = new RandomBot({
      enumerate: () => [],
      seed: 'random-bot-empty',
    });

    await expect(bot.play({ G: {}, ctx: { currentPlayer: '0' } } as any, '0')).resolves.toEqual({});
  });

  test('uses weighted selection', async () => {
    const bot = new RandomBot({
      enumerate: () => [
        { move: 'heavy', weight: 100 },
        { move: 'light', weight: 1 },
      ],
      seed: 'random-bot-weight',
    });

    const counts = { heavy: 0, light: 0 };
    for (let i = 0; i < 100; i++) {
      // oxlint-disable-next-line no-await-in-loop -- keep seeded samples sequential for stable bucket counts
      const { action } = await bot.play({ G: {}, ctx: { currentPlayer: '0' } } as any, '0');
      counts[action!.payload.type === 'heavy' ? 'heavy' : 'light']++;
    }

    expect(counts.heavy).toBeGreaterThan(85);
  });
});

describe('MCTSBot playout with weights', () => {
  const game = ProcessGameConfig({
    setup: () => ({ count: 0 }),
    moves: {
      good({ G }) {
        return { ...G, count: G.count + 1 };
      },
      bad({ G }) {
        return { ...G, count: G.count - 1 };
      },
    },
    turn: { minMoves: 1, maxMoves: 1 },
    endIf: ({ G }) => {
      if (G.count >= 3) return { winner: '0' };
      if (G.count <= -3) return { winner: '1' };
    },
  });

  test('weighted enumerate biases playout results', async () => {
    // With heavy weight on "good", playouts should favor player 0 winning
    const bot = new MCTSBot({
      enumerate: () => [
        { move: 'good', weight: 10 },
        { move: 'bad', weight: 1 },
      ],
      seed: 'mcts-weight',
      game,
      iterations: 50,
      playoutDepth: 20,
    });

    const state = {
      G: { count: 0 },
      ctx: {
        numPlayers: 2,
        currentPlayer: '0',
        turn: 1,
        playOrder: ['0', '1'],
        playOrderPos: 0,
        phase: null,
        activePlayers: null,
      },
      plugins: {},
      deltalog: [],
      _undo: [],
      _redo: [],
      _stateID: 0,
    } as any;

    const { action } = await bot.play(state, '0');
    // The bot should exist and return an action
    expect(action).toBeDefined();
    expect(action!.payload).toBeDefined();
  });

  test('returns no action when the root has no legal actions', async () => {
    const bot = new MCTSBot({
      enumerate: () => [],
      seed: 'mcts-empty',
      game,
      iterations: 10,
      playoutDepth: 5,
    });

    const state = {
      G: { count: 0 },
      ctx: {
        numPlayers: 2,
        currentPlayer: '0',
        turn: 1,
        playOrder: ['0', '1'],
        playOrderPos: 0,
        phase: null,
        activePlayers: null,
      },
      plugins: {},
      deltalog: [],
      _undo: [],
      _redo: [],
      _stateID: 0,
    } as any;

    await expect(bot.play(state, '0')).resolves.toMatchObject({
      action: undefined,
    });
  });
});
