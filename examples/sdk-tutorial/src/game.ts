import { INVALID_MOVE } from '@boardoor/core';
import type { Ctx, Game, PlayerID } from '@boardoor/core';

export type LastStoneState = {
  remaining: number;
  lastTake: { player: string; count: 1 | 2 } | null;
};

export type LastStoneMove = {
  move: 'take';
  args: [count: 1 | 2];
};

export function enumerateMoves(G: LastStoneState, ctx: Ctx, playerID: PlayerID): LastStoneMove[] {
  if (ctx.gameover !== undefined || playerID !== ctx.currentPlayer) return [];

  const counts: Array<1 | 2> = G.remaining >= 2 ? [1, 2] : [1];
  return counts.map((count) => ({ move: 'take', args: [count] }));
}

export function chooseBestMove(
  G: LastStoneState,
  ctx: Ctx,
  playerID: PlayerID,
): LastStoneMove | null {
  if (ctx.gameover !== undefined || playerID !== ctx.currentPlayer || G.remaining === 0)
    return null;

  // Leave a multiple of three when possible; otherwise take one.
  const count = (G.remaining % 3 || 1) as 1 | 2;
  return { move: 'take', args: [count] };
}

export const LastStone: Game<LastStoneState> = {
  name: 'last-stone',
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({
    remaining: 5,
    lastTake: null,
  }),
  turn: {
    minMoves: 1,
    maxMoves: 1,
  },
  moves: {
    take: ({ G, ctx }, count: number) => {
      if ((count !== 1 && count !== 2) || count > G.remaining) {
        return INVALID_MOVE;
      }
      G.remaining -= count;
      G.lastTake = {
        player: ctx.currentPlayer,
        count,
      };
    },
  },
  ai: {
    enumerate: enumerateMoves,
    bestMove: chooseBestMove,
  },
  endIf: ({ G, ctx }) => {
    if (G.remaining === 0) {
      return { winner: ctx.currentPlayer };
    }
  },
};
