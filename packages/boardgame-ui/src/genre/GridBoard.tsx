import type { ReactNode } from 'react';

export type GridBoardMode = 'cell' | 'intersection';

export interface GridBoardProps {
  rows: number;
  columns: number;
  mode: GridBoardMode;
  renderCell: (row: number, column: number) => ReactNode;
  onCellClick?: (row: number, column: number) => void;
  isCellDisabled?: (row: number, column: number) => boolean;
  cellLabel?: (row: number, column: number) => string;
  className?: string;
}

const defaultCellDisabled = () => false;
const defaultCellLabel = (row: number, column: number) => `Row ${row + 1}, column ${column + 1}`;

/** A square board that owns its grid geometry and accessible cell interaction. */
export function GridBoard({
  rows,
  columns,
  mode,
  renderCell,
  onCellClick,
  isCellDisabled = defaultCellDisabled,
  cellLabel = defaultCellLabel,
  className = '',
}: GridBoardProps) {
  const trackColumns = mode === 'intersection' ? columns * 2 - 1 : columns;
  const trackRows = mode === 'intersection' ? rows * 2 - 1 : rows;
  const cells = Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const disabled = !onCellClick || isCellDisabled(row, column);
    return (
      <button
        aria-label={cellLabel(row, column)}
        className="relative flex min-h-0 min-w-0 items-center justify-center disabled:cursor-default"
        disabled={disabled}
        key={`${row}-${column}`}
        onClick={() => onCellClick?.(row, column)}
        style={
          mode === 'intersection' ? { gridColumn: column * 2 + 1, gridRow: row * 2 + 1 } : undefined
        }
        type="button"
      >
        {renderCell(row, column)}
      </button>
    );
  });

  return (
    <div
      className={`relative grid aspect-square w-full ${mode === 'cell' ? 'gap-px' : ''} ${className}`}
      data-grid-mode={mode}
      style={{
        gridTemplateColumns: `repeat(${trackColumns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${trackRows}, minmax(0, 1fr))`,
      }}
    >
      {mode === 'intersection' && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
          viewBox={`0 0 ${trackColumns} ${trackRows}`}
        >
          {Array.from({ length: rows }, (_, row) => (
            <line
              key={`row-${row}`}
              stroke="currentColor"
              x1="0.5"
              x2={trackColumns - 0.5}
              y1={row * 2 + 0.5}
              y2={row * 2 + 0.5}
            />
          ))}
          {Array.from({ length: columns }, (_, column) => (
            <line
              key={`column-${column}`}
              stroke="currentColor"
              x1={column * 2 + 0.5}
              x2={column * 2 + 0.5}
              y1="0.5"
              y2={trackRows - 0.5}
            />
          ))}
        </svg>
      )}
      {cells}
    </div>
  );
}
