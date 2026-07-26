import type { PlayingCard, StandardSuit } from './types';

export function cardImageUrl(card: PlayingCard, base: string): string {
  return `${base}assets/${card.suit}${String(card.rank).padStart(2, '0')}.webp`;
}

export function rankLabel(card: PlayingCard): string {
  const ranks: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  return ranks[card.rank] ?? String(card.rank);
}

export function suitLabel(suit: StandardSuit): string {
  return { d: '\u2666', h: '\u2665', s: '\u2660', k: '\u2663' }[suit];
}

export function cardAlt(card: PlayingCard): string {
  return `${rankLabel(card)}${suitLabel(card.suit)}`;
}

const CARD_SIZE =
  'short:w-[36px] short:h-[50px] w-[48px] h-[67px] sm:w-[60px] sm:h-[83px] lg:w-[72px] lg:h-[100px]';
export const CARD_BASE_CLASSES = `${CARD_SIZE} rounded-md border border-white/20 object-cover block transition-transform cursor-default select-none`;
