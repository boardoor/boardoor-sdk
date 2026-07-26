// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Client, type _ClientImpl } from '../client';
import { ClientManager } from '../manager';

function client(
  playerID: string | null,
  debugOpt: _ClientImpl['debugOpt'],
  multiplayer: unknown = undefined,
) {
  return {
    debugOpt,
    multiplayer,
    playerID,
    updatePlayerID: vi.fn(),
  } as unknown as _ClientImpl;
}

describe('ClientManager vendored Debug contract', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('preserves the production default and supports normalized production opt-ins', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const mounted: Array<_ClientImpl['debugOpt']> = [];
    class DebugPanel {
      constructor({ props }: { props: { clientManager: ClientManager } }) {
        const unsubscribe = props.clientManager.subscribe(({ client }) => {
          mounted.push(client.debugOpt);
        });
        unsubscribe();
      }
      $destroy() {}
    }
    const manager = new ClientManager(DebugPanel);
    const defaultClient = client(null, undefined);
    manager.register(defaultClient);
    expect(mounted).toEqual([]);
    manager.unregister(defaultClient);

    for (const debugOpt of [{ collapseOnLoad: true }, { collapseOnLoad: false }]) {
      const explicitClient = client(null, debugOpt);
      manager.register(explicitClient);
      expect(mounted.at(-1)).toEqual(debugOpt);
      manager.unregister(explicitClient);
    }
  });

  it('mounts and toggles the dependency-free panel with real client state', async () => {
    const debugClient = Client({
      game: {
        setup: () => ({ count: 0 }),
        moves: { increment: ({ G }) => ({ count: G.count + 1 }) },
      },
      debug: { collapseOnLoad: true },
    });

    debugClient.start();
    expect(document.querySelector('[aria-label="Boardoor Debug Panel"]')).not.toBeNull();
    expect(document.querySelector('[title="Show Debug Panel"]')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '.' }));
    expect(document.querySelector('[title="Show Debug Panel"]')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: '.' }));
    expect(document.querySelector('[title="Show Debug Panel"]')).not.toBeNull();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: '?' }));
    expect(document.querySelector('[title="Show Debug Panel"]')).not.toBeNull();
    input.remove();

    window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: '?' }));
    await vi.waitFor(() => {
      expect(document.querySelector('[title="Hide Debug Panel"]')).not.toBeNull();
      expect(document.querySelector('#debug-controls')).not.toBeNull();
      expect(document.querySelector('[aria-label="Current game state"]')?.textContent).toContain(
        '"count": 0',
      );
    });

    const increment = debugClient.moves.increment;
    increment();
    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="Current game state"]')?.textContent).toContain(
        '"count": 1',
      );
    });
    const undoButton = [
      ...document.querySelectorAll<HTMLButtonElement>('#debug-controls button'),
    ].find((candidate) => candidate.textContent === 'Undo');
    undoButton?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="Current game state"]')?.textContent).toContain(
        '"count": 0',
      );
    });

    debugClient.stop();
    expect(document.querySelector('[aria-label="Boardoor Debug Panel"]')).toBeNull();

    const hotseatClient = Client({
      game: { setup: () => ({}), moves: {} },
      debug: { collapseOnLoad: false },
    });
    hotseatClient.start();
    expect(document.querySelector('[title="Hide Debug Panel"]')).not.toBeNull();
    hotseatClient.stop();
  });

  it.each([
    ['local development collapsed', { collapseOnLoad: true }, true],
    ['hotseat expanded', { collapseOnLoad: false }, false],
  ])('mounts %s', (_label, debugOpt, collapseOnLoad) => {
    const mounted: Array<{ collapseOnLoad?: boolean }> = [];
    class DebugPanel {
      constructor({ props }: { props: { clientManager: ClientManager } }) {
        const unsubscribe = props.clientManager.subscribe(({ client }) => {
          mounted.push(client.debugOpt as { collapseOnLoad?: boolean });
        });
        unsubscribe();
      }
      $destroy() {}
    }
    const manager = new ClientManager(DebugPanel);
    const debugClient = client(null, debugOpt);
    manager.register(debugClient);
    expect(mounted.at(-1)?.collapseOnLoad).toBe(collapseOnLoad);
    manager.unregister(debugClient);
  });

  it('honours custom targets and hidden toggle buttons', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const debugClient = Client({
      game: { setup: () => ({}), moves: {} },
      debug: { collapseOnLoad: false, hideToggleButton: true, target },
    });

    debugClient.start();
    expect(target.querySelector('[aria-label="Boardoor Debug Panel"]')).not.toBeNull();
    expect(target.querySelector<HTMLButtonElement>('[title="Hide Debug Panel"]')?.hidden).toBe(
      true,
    );
    debugClient.stop();
    target.remove();
  });

  it('leaves shortcut handling to a custom debug implementation and destroys it', () => {
    const destroy = vi.fn();
    class DebugPanel {
      $destroy = destroy;
    }
    const manager = new ClientManager(DebugPanel);
    const debugClient = client(null, true);
    const keypress = vi.fn();
    window.addEventListener('keypress', keypress);
    manager.register(debugClient);
    window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: '?' }));
    expect(keypress).not.toHaveBeenCalled();
    manager.unregister(debugClient);
    expect(destroy).toHaveBeenCalledTimes(1);
    window.removeEventListener('keypress', keypress);
  });

  it('switches player clients and destroys every mounted panel', () => {
    const destroyed: string[] = [];
    class DebugPanel {
      private playerID: string | null;
      constructor({ props }: { props: { clientManager: ClientManager } }) {
        let playerID: string | null = null;
        const unsubscribe = props.clientManager.subscribe(({ client }) => {
          playerID = client.playerID;
        });
        unsubscribe();
        this.playerID = playerID;
      }
      $destroy() {
        destroyed.push(this.playerID ?? 'debug');
      }
    }
    const multiplayer = {};
    const manager = new ClientManager(DebugPanel);
    const player0 = client('0', true, multiplayer);
    const player1 = client('1', true, multiplayer);
    manager.register(player0);
    manager.register(player1);
    manager.switchPlayerID('1');
    manager.unregister(player1);
    manager.unregister(player0);
    expect(destroyed).toEqual(['0', '1', '0']);
  });
});
