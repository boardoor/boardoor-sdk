import { useTranslation } from 'react-i18next';

/**
 * Safe translation hook that falls back to the key's English default
 * when i18next is not initialized (e.g. in tests or games without i18n).
 */
export function useT(): (key: string, fallback: string) => string {
  try {
    const { t, ready } = useTranslation();
    if (ready) return (key: string, fallback: string) => t(key, fallback);
  } catch {
    // react-i18next not available or i18next not initialized
  }
  return (_key: string, fallback: string) => fallback;
}

/** Safe language detection hook — returns 'en' if i18next is not available. */
export function useLang(): string {
  try {
    const { i18n } = useTranslation();
    return i18n.language;
  } catch {
    return 'en';
  }
}
