import { INVALID_MOVE } from '@boardoor/core';
import type { Game } from '@boardoor/core';

export type LastStoneState = {
  remaining: number;
  lastTake: { player: string; count: 1 | 2 } | null;
};

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
  endIf: ({ G, ctx }) => {
    if (G.remaining === 0) {
      return { winner: ctx.currentPlayer };
    }
  },
};
