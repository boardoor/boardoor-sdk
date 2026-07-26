import { describe, expect, it, vi } from 'vitest';

import type { Game, State } from '../../types';
import {
  applyAIMoveDelayMultiplier,
  DEFAULT_AI_MOVE_DELAY_MS,
  getRemainingAIMoveDelayMs,
  resolveAIMoveDelayMs,
} from '../move-delay';

const state = {
  G: { value: 1 },
  ctx: { currentPlayer: '0' },
} as State;

const action = {
  type: 'MAKE_MOVE',
  payload: { type: 'play', args: [], playerID: '0' },
} as const;

describe('AI move delay', () => {
  it('uses the default delay when no game hook is provided', () => {
    expect(resolveAIMoveDelayMs({ ai: { enumerate: () => [] } } as Game, state, '0', action)).toBe(
      DEFAULT_AI_MOVE_DELAY_MS,
    );
  });

  it('does not delay CPU round-end confirmation moves', () => {
    expect(
      resolveAIMoveDelayMs({ ai: { enumerate: () => [] } } as Game, state, '0', {
        type: 'MAKE_MOVE',
        payload: { type: 'nextRound', args: [], playerID: '0' },
      }),
    ).toBe(0);
  });

  it('does not delay the move that completes a trick', () => {
    const trickState = {
      G: {
        players: {
          '0': ['card'],
          '1': ['card'],
          '2': ['card'],
          '3': ['card'],
        },
        currentTrick: [
          { playerID: '1', card: 'card' },
          { playerID: '2', card: 'card' },
          { playerID: '3', card: 'card' },
        ],
      },
      ctx: { currentPlayer: '0', numPlayers: 4 },
    } as unknown as State;
    const game = {
      ai: {
        enumerate: () => [],
        getMoveDelayMs: vi.fn(() => 500),
      },
    } as unknown as Game;

    expect(
      resolveAIMoveDelayMs(game, trickState, '0', {
        type: 'MAKE_MOVE',
        payload: { type: 'playCard', args: [0], playerID: '0' },
      }),
    ).toBe(0);
    expect(game.ai?.getMoveDelayMs).not.toHaveBeenCalled();
  });

  it('keeps the normal delay for non-completing trick moves', () => {
    const trickState = {
      G: {
        players: {
          '0': ['card'],
          '1': ['card'],
          '2': ['card'],
          '3': ['card'],
        },
        currentTrick: [{ playerID: '1', card: 'card' }],
      },
      ctx: { currentPlayer: '0', numPlayers: 4 },
    } as unknown as State;

    expect(
      resolveAIMoveDelayMs({ ai: { enumerate: () => [] } } as Game, trickState, '0', {
        type: 'MAKE_MOVE',
        payload: { type: 'playCard', args: [0], playerID: '0' },
      }),
    ).toBe(DEFAULT_AI_MOVE_DELAY_MS);
  });

  it('passes game state, context, player, and action to the game hook', () => {
    const game = {
      ai: {
        enumerate: () => [],
        getMoveDelayMs: vi.fn(({ G, ctx, playerID, action: nextAction }) => {
          expect(G).toBe(state.G);
          expect(ctx).toBe(state.ctx);
          expect(playerID).toBe('0');
          expect(nextAction).toBe(action);
          return nextAction.payload.type === 'play' ? 125 : 500;
        }),
      },
    } as Game;

    expect(resolveAIMoveDelayMs(game, state, '0', action)).toBe(125);
    expect(game.ai?.getMoveDelayMs).toHaveBeenCalledOnce();
  });

  it('clamps negative overrides and ignores non-finite overrides', () => {
    const negativeGame = {
      ai: { enumerate: () => [], getMoveDelayMs: () => -10 },
    } as Game;
    const infiniteGame = {
      ai: { enumerate: () => [], getMoveDelayMs: () => Infinity },
    } as Game;

    expect(resolveAIMoveDelayMs(negativeGame, state, '0', action)).toBe(0);
    expect(resolveAIMoveDelayMs(infiniteGame, state, '0', action)).toBe(DEFAULT_AI_MOVE_DELAY_MS);
  });

  it('subtracts elapsed thinking time from the requested delay', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    expect(getRemainingAIMoveDelayMs(600, 750)).toBe(350);
    expect(getRemainingAIMoveDelayMs(200, 750)).toBe(0);
    vi.useRealTimers();
  });

  it('applies optional local AI tempo multipliers without delaying zero-delay actions', () => {
    expect(applyAIMoveDelayMultiplier(600, 1.8)).toBe(1080);
    expect(applyAIMoveDelayMultiplier(0, 1.8)).toBe(0);
    expect(applyAIMoveDelayMultiplier(600, undefined)).toBe(600);
    expect(applyAIMoveDelayMultiplier(600, Infinity)).toBe(600);
    expect(applyAIMoveDelayMultiplier(600, -1)).toBe(600);
  });
});
