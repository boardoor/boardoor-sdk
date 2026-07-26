export interface ScoreEntry {
  id: string;
  label: string;
  score: string | number;
  symbol?: string;
  isActive?: boolean;
  isMe?: boolean;
}

export interface ScorePanelProps {
  entries: readonly ScoreEntry[];
  className?: string;
}

/** Compact, truncation-safe score row for genre scaffold headers. */
export function ScorePanel({ entries, className = '' }: ScorePanelProps) {
  return (
    <div className={`flex min-w-0 gap-2 overflow-hidden ${className}`}>
      {entries.map((entry) => (
        <div
          className={`min-w-0 truncate rounded border px-2 py-0.5 text-sm ${
            entry.isActive
              ? 'border-amber-300 bg-amber-300/20 text-amber-200'
              : 'border-transparent bg-white/10'
          }`}
          key={entry.id}
        >
          {entry.symbol && <span aria-hidden="true">{entry.symbol} </span>}
          {entry.label}: {entry.score}
          {entry.isMe && entry.isActive && ' (you)'}
        </div>
      ))}
    </div>
  );
}
