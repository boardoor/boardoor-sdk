import { Client } from '@boardoor/core';
import { ActionButton } from '@boardoor/ui';
import { useEffect, useMemo, useState } from 'react';

import { LastStone } from './game.ts';

export function App() {
  const client = useMemo(() => {
    const localClient = Client({ game: LastStone, numPlayers: 2 });
    localClient.start();
    return localClient;
  }, []);
  const [state, setState] = useState(() => client.getState());

  useEffect(() => {
    const unsubscribe = client.subscribe(setState);
    return () => {
      unsubscribe();
      client.stop();
    };
  }, [client]);

  if (!state) return <main className="last-stone">Preparing the game…</main>;

  const winner = state.ctx.gameover?.winner as string | undefined;
  return (
    <main className="last-stone">
      <h1>Last Stone</h1>
      <p className="stones" aria-live="polite">
        {state.G.remaining} stones remain
      </p>
      {winner === undefined ? (
        <>
          <p>Player {Number(state.ctx.currentPlayer) + 1} chooses:</p>
          <div className="actions">
            <ActionButton onClick={() => client.moves.take(1)}>Take one</ActionButton>
            <ActionButton disabled={state.G.remaining < 2} onClick={() => client.moves.take(2)}>
              Take two
            </ActionButton>
          </div>
        </>
      ) : (
        <p className="winner">Player {Number(winner) + 1} wins.</p>
      )}
    </main>
  );
}
