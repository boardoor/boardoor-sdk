import { useEffect, useState } from 'react';

import { useT } from '../i18n-helper';

const RECONNECT_FAILED_EVENT = 'boardoor:reconnectFailed';
const RECONNECT_RESET_EVENT = 'boardoor:reconnectReset';

export function ReconnectBanner({ show, failed }: { show: boolean; failed?: boolean }) {
  const t = useT();
  const [eventFailed, setEventFailed] = useState(
    () => typeof window !== 'undefined' && (window as any).__boardoor_reconnectFailed === true,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleFailed = () => setEventFailed(true);
    const handleReset = () => setEventFailed(false);
    window.addEventListener(RECONNECT_FAILED_EVENT, handleFailed);
    window.addEventListener(RECONNECT_RESET_EVENT, handleReset);
    return () => {
      window.removeEventListener(RECONNECT_FAILED_EVENT, handleFailed);
      window.removeEventListener(RECONNECT_RESET_EVENT, handleReset);
    };
  }, []);

  if (!show && !failed && !eventFailed) return null;
  if (failed || eventFailed) {
    return (
      <div
        aria-live="assertive"
        className="fixed inset-x-0 top-0 z-[200] bg-red-600/90 px-4 py-1.5 text-center text-sm font-semibold text-white"
        role="alert"
      >
        {t('ui.connectionLost', 'Connection lost. Please refresh the page.')}
      </div>
    );
  }
  return (
    <output
      aria-live="polite"
      className="animate-reconnect-pulse fixed inset-x-0 top-0 z-[200] bg-amber-500/90 px-4 py-1.5 text-center text-sm font-semibold text-black"
    >
      {t('ui.reconnecting', 'Reconnecting...')}
    </output>
  );
}
