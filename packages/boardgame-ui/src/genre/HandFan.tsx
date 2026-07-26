import type { ReactNode } from 'react';

export interface HandFanProps<T> {
  cards: readonly T[];
  getCardKey: (card: T, index: number) => string;
  renderCard: (card: T, index: number) => ReactNode;
  onCardClick?: (card: T, index: number) => void;
  isCardDisabled?: (card: T, index: number) => boolean;
  cardLabel?: (card: T, index: number) => string;
  selectedIndices?: ReadonlySet<number>;
  className?: string;
}

const defaultCardDisabled = () => false;
const defaultCardLabel = <T,>(_card: T, index: number) => `Card ${index + 1}`;

/** Overlapping hand layout with consistent keyboard and pointer interaction. */
export function HandFan<T>({
  cards,
  getCardKey,
  renderCard,
  onCardClick,
  isCardDisabled = defaultCardDisabled,
  cardLabel = defaultCardLabel,
  selectedIndices,
  className = '',
}: HandFanProps<T>) {
  return (
    <div className={`flex min-w-0 justify-center px-5 py-1 ${className}`}>
      {cards.map((card, index) => {
        const disabled = !onCardClick || isCardDisabled(card, index);
        const selected = selectedIndices?.has(index) ?? false;
        const rotation =
          cards.length > 1 ? ((index / (cards.length - 1)) * 10 - 5).toFixed(2) : '0';
        return (
          <button
            aria-label={cardLabel(card, index)}
            aria-pressed={selected || undefined}
            className={`relative shrink-0 transition-transform hover:z-10 hover:-translate-y-2 focus:z-10 focus:-translate-y-2 disabled:cursor-default ${
              selected ? 'z-20 -translate-y-3' : ''
            }`}
            disabled={disabled}
            key={getCardKey(card, index)}
            onClick={() => onCardClick?.(card, index)}
            style={{
              marginLeft: index === 0 ? 0 : '-1.75rem',
              transform: `rotate(${rotation}deg)`,
            }}
            type="button"
          >
            {renderCard(card, index)}
          </button>
        );
      })}
    </div>
  );
}
