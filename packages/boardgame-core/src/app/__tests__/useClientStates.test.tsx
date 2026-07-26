import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

import { useClientStates } from '../index.tsx';
import type { GameClient, GameClientState } from '../types';

function makeClient(): GameClient & { _fire: () => void; _state: GameClientState | null } {
  const listeners = new Set<() => void>();
  const client = {
    _state: null as GameClientState | null,
    moves: {},
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getState: () => client._state,
    _fire: () => listeners.forEach((cb) => cb()),
  };
  return client;
}

// Simple test harness that captures hook output
function createHarness(clients: GameClient[]) {
  let result: (GameClientState | null)[] = [];
  let unmountFn: () => void;

  function TestComponent() {
    result = useClientStates(clients);
    return null;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(React.createElement(TestComponent));
  });

  unmountFn = () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };

  return {
    getResult: () => result,
    unmount: unmountFn,
  };
}

describe('useClientStates', () => {
  it('returns null for each client initially', () => {
    const c1 = makeClient();
    const c2 = makeClient();
    const { getResult, unmount } = createHarness([c1, c2]);
    expect(getResult()).toEqual([null, null]);
    unmount();
  });

  it('updates when a client fires', () => {
    const c1 = makeClient();
    const { getResult, unmount } = createHarness([c1]);

    act(() => {
      c1._state = { G: { x: 1 }, ctx: { currentPlayer: '0' } as any };
      c1._fire();
    });

    expect(getResult()[0]).toEqual({ G: { x: 1 }, ctx: { currentPlayer: '0' } });
    unmount();
  });

  it('updates only the changed client index', () => {
    const c1 = makeClient();
    const c2 = makeClient();
    const { getResult, unmount } = createHarness([c1, c2]);

    act(() => {
      c1._state = { G: { a: 1 }, ctx: {} as any };
      c1._fire();
    });

    expect(getResult()[0]).toEqual({ G: { a: 1 }, ctx: {} });
    expect(getResult()[1]).toBeNull();

    act(() => {
      c2._state = { G: { b: 2 }, ctx: {} as any };
      c2._fire();
    });

    expect(getResult()[1]).toEqual({ G: { b: 2 }, ctx: {} });
    unmount();
  });

  it('unsubscribes on unmount', () => {
    const c1 = makeClient();
    const unsubSpy = vi.fn();
    const origSubscribe = c1.subscribe.bind(c1);
    c1.subscribe = (cb: () => void) => {
      const unsub = origSubscribe(cb);
      return () => {
        unsubSpy();
        unsub();
      };
    };

    const { unmount } = createHarness([c1]);
    expect(unsubSpy).not.toHaveBeenCalled();
    unmount();
    expect(unsubSpy).toHaveBeenCalledTimes(1);
  });
});
