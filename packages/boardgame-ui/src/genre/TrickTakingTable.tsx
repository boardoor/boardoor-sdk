import type { ReactNode } from 'react';

import { computeTablePositions } from '../layout/table-positions';

export type TableSeatPosition = 'bottom' | 'top' | 'left' | 'right';

export interface TrickTakingTableProps {
  numPlayers: number;
  bottomPlayer: number;
  renderSeat: (playerID: string, position: TableSeatPosition) => ReactNode;
  renderCenter: () => ReactNode;
  className?: string;
}

/** Table layout for 2-6 player trick-taking games. */
export function TrickTakingTable({
  numPlayers,
  bottomPlayer,
  renderSeat,
  renderCenter,
  className = '',
}: TrickTakingTableProps) {
  const positions = computeTablePositions(bottomPlayer, numPlayers);
  const centerColumns =
    positions.left && positions.right
      ? 'grid-cols-[auto_minmax(0,1fr)_auto]'
      : positions.left
        ? 'grid-cols-[auto_minmax(0,1fr)]'
        : positions.right
          ? 'grid-cols-[minmax(0,1fr)_auto]'
          : 'grid-cols-1';

  return (
    <div
      className={`grid min-h-0 flex-1 grid-rows-[auto_1fr_auto] gap-2 overflow-hidden ${className}`}
    >
      <div className="flex justify-center gap-3">
        {positions.top.map((playerID) => (
          <div key={playerID}>{renderSeat(playerID, 'top')}</div>
        ))}
      </div>
      <div className={`grid min-h-0 items-center gap-2 ${centerColumns}`}>
        {positions.left && <div>{renderSeat(positions.left, 'left')}</div>}
        <div className="min-h-0 min-w-0">{renderCenter()}</div>
        {positions.right && <div>{renderSeat(positions.right, 'right')}</div>}
      </div>
      <div className="flex justify-center">{renderSeat(positions.bottom, 'bottom')}</div>
    </div>
  );
}
