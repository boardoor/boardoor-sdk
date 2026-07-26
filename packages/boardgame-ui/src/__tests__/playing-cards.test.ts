import { describe, it, expect } from 'vitest';

import {
  cardImageUrl,
  rankLabel,
  suitLabel,
  cardAlt,
  CARD_BASE_CLASSES,
} from '../playing-cards/helpers';
import { sortedWithIndices, SUIT_ORDER } from '../playing-cards/sort';
import type { PlayingCard } from '../playing-cards/types';

describe('cardImageUrl', () => {
  it('generates correct URL for numbered card', () => {
    expect(cardImageUrl({ suit: 'h', rank: 7 }, '/base/')).toBe('/base/assets/h07.webp');
  });

  it('pads single-digit ranks', () => {
    expect(cardImageUrl({ suit: 's', rank: 2 }, '/')).toBe('/assets/s02.webp');
  });

  it('handles Ace', () => {
    expect(cardImageUrl({ suit: 'd', rank: 1 }, '/')).toBe('/assets/d01.webp');
  });

  it('handles King', () => {
    expect(cardImageUrl({ suit: 'k', rank: 13 }, '/')).toBe('/assets/k13.webp');
  });
});

describe('rankLabel', () => {
  it('returns A for rank 1', () => expect(rankLabel({ suit: 'h', rank: 1 })).toBe('A'));
  it('returns J for rank 11', () => expect(rankLabel({ suit: 'h', rank: 11 })).toBe('J'));
  it('returns Q for rank 12', () => expect(rankLabel({ suit: 'h', rank: 12 })).toBe('Q'));
  it('returns K for rank 13', () => expect(rankLabel({ suit: 'h', rank: 13 })).toBe('K'));
  it('returns number string for other ranks', () =>
    expect(rankLabel({ suit: 'h', rank: 7 })).toBe('7'));
});

describe('suitLabel', () => {
  it('returns correct symbols', () => {
    expect(suitLabel('h')).toBe('\u2665');
    expect(suitLabel('d')).toBe('\u2666');
    expect(suitLabel('s')).toBe('\u2660');
    expect(suitLabel('k')).toBe('\u2663');
  });
});

describe('cardAlt', () => {
  it('combines rank and suit', () => {
    expect(cardAlt({ suit: 'h', rank: 1 })).toBe('A\u2665');
    expect(cardAlt({ suit: 's', rank: 12 })).toBe('Q\u2660');
  });
});

describe('CARD_BASE_CLASSES', () => {
  it('contains expected class fragments', () => {
    expect(CARD_BASE_CLASSES).toContain('rounded-md');
    expect(CARD_BASE_CLASSES).toContain('object-cover');
  });
});

describe('SUIT_ORDER', () => {
  it('orders clubs < diamonds < spades < hearts', () => {
    expect(SUIT_ORDER.k).toBeLessThan(SUIT_ORDER.d);
    expect(SUIT_ORDER.d).toBeLessThan(SUIT_ORDER.s);
    expect(SUIT_ORDER.s).toBeLessThan(SUIT_ORDER.h);
  });
});

describe('sortedWithIndices', () => {
  const hand: PlayingCard[] = [
    { suit: 'h', rank: 7 },
    { suit: 's', rank: 1 },
    { suit: 'k', rank: 10 },
    { suit: 'd', rank: 3 },
  ];

  it('sorts by suit then rank (default)', () => {
    const result = sortedWithIndices(hand, 'suit');
    expect(result.map((r) => r.card.suit)).toEqual(['k', 'd', 's', 'h']);
  });

  it('sorts by rank then suit', () => {
    const result = sortedWithIndices(hand, 'rank');
    expect(result.map((r) => r.card.rank)).toEqual([3, 7, 10, 1]); // Ace high = 14
  });

  it('preserves original indices', () => {
    const result = sortedWithIndices(hand, 'suit');
    expect(result.map((r) => r.originalIdx)).toEqual([2, 3, 1, 0]);
  });

  it('filters null entries', () => {
    const handWithNull: (PlayingCard | null)[] = [
      { suit: 'h', rank: 5 },
      null,
      { suit: 's', rank: 3 },
    ];
    const result = sortedWithIndices(handWithNull, 'suit');
    expect(result.length).toBe(2);
    expect(result.map((r) => r.originalIdx)).toEqual([2, 0]);
  });

  it('respects aceHigh=false', () => {
    const result = sortedWithIndices(hand, 'rank', false);
    expect(result.map((r) => r.card.rank)).toEqual([1, 3, 7, 10]);
  });
});
