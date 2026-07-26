import { useEffect, useRef, useState } from 'react';

const DEFAULT_HOLD_MS = 1500;

/**
 * Hold the last-trick display for a minimum duration after a trick completes,
 * even if the next trick has already started (currentTrick has new cards).
 *
 * Returns `true` when the UI should display `lastTrick` instead of `currentTrick`.
 */
export function useTrickResultHold(
  currentTrickLength: number,
  hasLastTrick: boolean,
  holdMs: number = DEFAULT_HOLD_MS,
): boolean {
  const [isHolding, setIsHolding] = useState(false);
  const prevCurrentLenRef = useRef(currentTrickLength);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prevLen = prevCurrentLenRef.current;
    prevCurrentLenRef.current = currentTrickLength;

    // Trick just completed: was non-empty, now empty, and lastTrick exists
    if (prevLen > 0 && currentTrickLength === 0 && hasLastTrick) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setIsHolding(true);
      timerRef.current = setTimeout(() => {
        setIsHolding(false);
        timerRef.current = null;
      }, holdMs);
    }
  }, [currentTrickLength, hasLastTrick, holdMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Show last trick naturally (empty trick + lastTrick exists) OR during hold period
  return (currentTrickLength === 0 && hasLastTrick) || isHolding;
}
