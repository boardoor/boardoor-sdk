import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { useT } from '../i18n-helper';
import type { ShareCardData } from '../share/render-share-card'; // re-exported from index.ts
import { ShareButton } from '../share/ShareButton';

export function GameOverOverlay({
  confirmFirst = false,
  titleClassName = '',
  panelClassName = '',
  winnerText,
  onConfirm,
  shareData,
  children,
}: {
  confirmFirst?: boolean;
  titleClassName?: string;
  panelClassName?: string;
  winnerText: string;
  /** Called when user clicks "Show Results" (only relevant with confirmFirst) */
  onConfirm?: () => void;
  shareData?: ShareCardData;
  children?: ReactNode;
}) {
  const t = useT();
  const [confirmed, setConfirmed] = useState(!confirmFirst);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const winnerId = useId();

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, []);

  useEffect(() => {
    if (confirmed) {
      const id = requestAnimationFrame(() => {
        panelRef.current?.focus();
        window.dispatchEvent(new Event('gameOverVisible'));
      });
      return () => cancelAnimationFrame(id);
    }
  }, [confirmed]);

  if (!confirmed) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-8 z-[100] flex justify-center">
        <button
          onClick={() => {
            setConfirmed(true);
            onConfirm?.();
          }}
          className="pointer-events-auto rounded-lg bg-amber-400 px-6 py-3 text-lg font-bold text-gray-900 shadow-lg hover:bg-amber-300"
          type="button"
        >
          {t('ui.showResults', 'Show Results')}
        </button>
      </div>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-describedby={winnerId}
      aria-labelledby={titleId}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/75"
    >
      <div
        ref={panelRef}
        className={`my-auto flex flex-col gap-4 rounded-xl bg-[#1e1e2e] px-12 py-8 text-center ${panelClassName}`}
        tabIndex={-1}
      >
        <h2 id={titleId} className={`text-3xl ${titleClassName}`}>
          {t('ui.gameOver', 'Game Over!')}
        </h2>
        <p id={winnerId} className="text-xl text-amber-300">
          {winnerText}
        </p>
        {children}
        {shareData && <ShareButton data={shareData} />}
      </div>
    </div>
  );
}
