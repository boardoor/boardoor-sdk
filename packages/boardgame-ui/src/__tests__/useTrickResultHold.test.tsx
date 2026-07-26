import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useTrickResultHold } from '../hooks/useTrickResultHold';

let container: HTMLDivElement;
let root: Root;

function HoldTest({
  currentLen,
  hasLast,
  holdMs,
}: {
  currentLen: number;
  hasLast: boolean;
  holdMs?: number;
}) {
  const show = useTrickResultHold(currentLen, hasLast, holdMs);
  return <div data-show={show ? 'true' : 'false'}>{show ? 'SHOW' : 'HIDE'}</div>;
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

function getShow(): boolean {
  return container.querySelector('div')!.getAttribute('data-show') === 'true';
}

describe('useTrickResultHold', () => {
  it('returns true when currentTrick is empty and lastTrick exists', () => {
    act(() => {
      root.render(<HoldTest currentLen={0} hasLast={true} />);
    });
    expect(getShow()).toBe(true);
  });

  it('returns false when no lastTrick', () => {
    act(() => {
      root.render(<HoldTest currentLen={0} hasLast={false} />);
    });
    expect(getShow()).toBe(false);
  });

  it('returns false when currentTrick has cards and no hold', () => {
    act(() => {
      root.render(<HoldTest currentLen={2} hasLast={false} />);
    });
    expect(getShow()).toBe(false);
  });

  it('holds display after trick completion even when next trick starts', () => {
    // Start with cards in current trick
    act(() => {
      root.render(<HoldTest currentLen={3} hasLast={false} />);
    });
    expect(getShow()).toBe(false);

    // Trick completes: currentTrick empties, lastTrick appears
    act(() => {
      root.render(<HoldTest currentLen={0} hasLast={true} />);
    });
    expect(getShow()).toBe(true);

    // Next trick starts: currentTrick gets a card — should still show lastTrick (hold)
    act(() => {
      root.render(<HoldTest currentLen={1} hasLast={true} />);
    });
    expect(getShow()).toBe(true); // HELD!

    // After hold expires, should stop showing
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(getShow()).toBe(false);
  });

  it('respects custom holdMs', () => {
    act(() => {
      root.render(<HoldTest currentLen={3} hasLast={false} holdMs={3000} />);
    });
    act(() => {
      root.render(<HoldTest currentLen={0} hasLast={true} holdMs={3000} />);
    });
    act(() => {
      root.render(<HoldTest currentLen={1} hasLast={true} holdMs={3000} />);
    });
    expect(getShow()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(getShow()).toBe(true); // still held at 1.5s

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(getShow()).toBe(false); // released at 3s
  });

  it('resets hold on consecutive trick completions', () => {
    // First trick
    act(() => {
      root.render(<HoldTest currentLen={4} hasLast={false} />);
    });
    act(() => {
      root.render(<HoldTest currentLen={0} hasLast={true} />);
    });
    expect(getShow()).toBe(true);

    // Hold expires, next trick plays out
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => {
      root.render(<HoldTest currentLen={1} hasLast={true} />);
    });
    act(() => {
      root.render(<HoldTest currentLen={2} hasLast={true} />);
    });
    act(() => {
      root.render(<HoldTest currentLen={3} hasLast={true} />);
    });
    act(() => {
      root.render(<HoldTest currentLen={4} hasLast={true} />);
    });
    expect(getShow()).toBe(false);

    // Second trick completes
    act(() => {
      root.render(<HoldTest currentLen={0} hasLast={true} />);
    });
    expect(getShow()).toBe(true);

    // Next trick starts again
    act(() => {
      root.render(<HoldTest currentLen={1} hasLast={true} />);
    });
    expect(getShow()).toBe(true); // still held
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(getShow()).toBe(false);
  });
});
