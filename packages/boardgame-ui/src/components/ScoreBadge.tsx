import type { ReactNode } from 'react';

export function ScoreBadge({
  isActive,
  children,
  className = '',
  onClick,
}: {
  isActive: boolean;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const styles = `short:text-xs short:px-1 min-w-0 truncate rounded border px-2 py-0.5 text-sm transition-colors ${
    isActive ? 'bg-gold/20 border-gold text-gold' : 'border-transparent bg-white/10'
  } ${onClick ? 'cursor-pointer hover:bg-white/15' : 'cursor-default'} ${className}`;

  if (!onClick) {
    return (
      <span aria-current={isActive ? 'true' : undefined} className={styles}>
        {children}
      </span>
    );
  }

  return (
    <button
      aria-current={isActive ? 'true' : undefined}
      className={styles}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
