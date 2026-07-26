import type { ComponentType } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { Client } from '../client/client';
import type { Game, State } from '../types';
import type { GameClient } from './index';

type SmokeApp = ComponentType<{ clients: GameClient[]; onlinePlayerID?: string }>;
type LocalClient = ReturnType<typeof Client>;

export async function renderGameAppSmoke<G = any>({
  App,
  game,
  numPlayers,
}: {
  App: SmokeApp;
  game: Game<G>;
  numPlayers: number;
}): Promise<{ state: State<G>; clients: LocalClient[] }> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const clients = Array.from({ length: numPlayers }, (_, i) =>
    Client({
      game,
      numPlayers,
      playerID: String(i),
    }),
  );
  for (const client of clients) client.start();

  const state = clients[0].getState();
  if (!state) {
    throw new Error(`Failed to initialize ${game.name ?? 'game'} smoke-test state`);
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(<App clients={clients as unknown as GameClient[]} />);
    });
    return { state, clients };
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    for (const client of clients) client.stop();
  }
}
