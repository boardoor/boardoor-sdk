import type { PlayingCard, StandardSuit } from './types';

export type SortMode = 'suit' | 'rank';

export const SUIT_ORDER: Record<StandardSuit, number> = { k: 0, d: 1, s: 2, h: 3 };

/**
 * Sort a hand of playing cards, preserving original indices for move dispatch.
 * @param aceHigh - if true, Ace (rank 1) sorts as 14 (default true)
 */
export function sortedWithIndices<T extends PlayingCard>(
  hand: (T | null)[],
  mode: SortMode = 'suit',
  aceHigh = true,
): { card: T; originalIdx: number }[] {
  return (hand as (T | null)[])
    .map((card, originalIdx) => ({ card, originalIdx }))
    .filter((v): v is { card: T; originalIdx: number } => v.card != null)
    .toSorted((a, b) => {
      const ra = aceHigh && a.card.rank === 1 ? 14 : a.card.rank;
      const rb = aceHigh && b.card.rank === 1 ? 14 : b.card.rank;
      if (mode === 'rank') {
        if (ra !== rb) return ra - rb;
        return SUIT_ORDER[a.card.suit] - SUIT_ORDER[b.card.suit];
      }
      const sd = SUIT_ORDER[a.card.suit] - SUIT_ORDER[b.card.suit];
      if (sd !== 0) return sd;
      return ra - rb;
    });
}
