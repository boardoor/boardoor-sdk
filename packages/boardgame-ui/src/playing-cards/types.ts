export type StandardSuit = 'h' | 'd' | 's' | 'k';

export interface PlayingCard {
  suit: StandardSuit;
  rank: number;
}
