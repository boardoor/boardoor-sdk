import { useT } from '../i18n-helper';

export function LoadingScreen() {
  const t = useT();
  return (
    <output
      aria-live="polite"
      className="flex h-full min-h-screen flex-col items-center justify-center gap-3 text-neutral-400"
    >
      <div
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-3 border-neutral-600 border-t-neutral-300"
      />
      <span className="text-sm tracking-wide">{t('ui.loading', 'Loading...')}</span>
    </output>
  );
}
