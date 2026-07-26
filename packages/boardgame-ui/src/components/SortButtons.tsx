import { useT } from '../i18n-helper';

export type SortMode = 'suit' | 'rank';

export function SortButtons({ mode, setMode }: { mode: SortMode; setMode: (m: SortMode) => void }) {
  const t = useT();
  return (
    <div
      aria-label={t('ui.sort', 'Sort')}
      className="short:gap-1 flex items-center gap-1.5"
      role="toolbar"
    >
      <span className="text-xs opacity-60">{t('ui.sort', 'Sort:')}</span>
      <button
        className={`short:px-1.5 cursor-pointer rounded border px-2.5 py-0.5 text-xs text-white hover:bg-white/15 ${
          mode === 'suit'
            ? 'border-[#2a8a3e] bg-[#2a8a3e]/30 text-green-400'
            : 'border-white/35 bg-black/25'
        }`}
        onClick={() => setMode('suit')}
        type="button"
      >
        {t('ui.suit', 'Suit')}
      </button>
      <button
        className={`short:px-1.5 cursor-pointer rounded border px-2.5 py-0.5 text-xs text-white hover:bg-white/15 ${
          mode === 'rank'
            ? 'border-[#2a8a3e] bg-[#2a8a3e]/30 text-green-400'
            : 'border-white/35 bg-black/25'
        }`}
        onClick={() => setMode('rank')}
        type="button"
      >
        {t('ui.rank', 'Rank')}
      </button>
    </div>
  );
}
