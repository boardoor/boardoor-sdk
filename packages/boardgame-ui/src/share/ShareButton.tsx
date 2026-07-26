import { useState } from 'react';

import { useT, useLang } from '../i18n-helper';
import { renderShareCard, type ShareCardData } from './render-share-card';

export function ShareButton({ data }: { data: ShareCardData }) {
  const t = useT();
  const lang = useLang();
  const [busy, setBusy] = useState(false);

  async function handleShare() {
    setBusy(true);
    try {
      const blob = await renderShareCard(data, lang);
      const file = new File(
        [blob],
        `${data.gameName.toLowerCase().replace(/\s+/g, '-')}-result.png`,
        {
          type: 'image/png',
        },
      );

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        // Download fallback
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      // User cancelled share or error — ignore AbortError
      if (e instanceof Error && e.name !== 'AbortError') {
        console.error('Share failed:', e);
      }
    }
    setBusy(false);
  }

  return (
    <button
      onClick={handleShare}
      disabled={busy}
      className="cursor-pointer rounded-lg border border-white/20 bg-white/10 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-50"
      type="button"
    >
      {busy ? '...' : t('ui.share', 'Share')}
    </button>
  );
}
