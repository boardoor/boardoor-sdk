import { createPatch } from 'rfc6902';

import { PlayerView } from '../plugins/main';
import type { Game, State, LogEntry, PlayerID } from '../types';
import type { IntermediateTransportData, TransportData } from './transport-data';

const applyPlayerView = (game: Game, playerID: string | null, state: State): State => {
  const ctx = game.transportView?.ctx?.({ G: state.G, ctx: state.ctx, playerID }) ?? state.ctx;
  return {
    ...state,
    G: game.playerView({ G: state.G, ctx: state.ctx, playerID }),
    ctx,
    plugins: PlayerView(state, { playerID, game }),
    deltalog: undefined,
    _undo: [],
    _redo: [],
  };
};

const applyLogView = (
  game: Game,
  playerID: PlayerID | null,
  state: State,
  log: LogEntry[] | undefined,
) => {
  const redactedLog = redactLog(log, playerID);
  if (redactedLog === undefined || game.transportView?.log === undefined) return redactedLog;
  return [...game.transportView.log({ G: state.G, ctx: state.ctx, playerID, log: redactedLog })];
};

/** Gets a function that filters the TransportData for a given player and game. */
export const getFilterPlayerView =
  (game: Game) =>
  (playerID: string | null, payload: IntermediateTransportData): TransportData => {
    switch (payload.type) {
      case 'patch': {
        const [matchID, stateID, prevState, state] = payload.args;
        const log = applyLogView(game, playerID, state, state.deltalog);
        const filteredState = applyPlayerView(game, playerID, state);
        const newStateID = state['_stateID'];
        const prevFilteredState = applyPlayerView(game, playerID, prevState);
        const patch = createPatch(prevFilteredState, filteredState);
        return { type: 'patch', args: [matchID, stateID, newStateID, patch, log] };
      }
      case 'update': {
        const [matchID, state] = payload.args;
        const log = applyLogView(game, playerID, state, state.deltalog);
        const filteredState = applyPlayerView(game, playerID, state);
        return { type: 'update', args: [matchID, filteredState, log] };
      }
      case 'sync': {
        const [matchID, syncInfo] = payload.args;
        const filteredState = applyPlayerView(game, playerID, syncInfo.state);
        const filteredInitialState = applyPlayerView(game, playerID, syncInfo.initialState);
        const log = applyLogView(game, playerID, syncInfo.state, syncInfo.log);
        return {
          type: 'sync',
          args: [
            matchID,
            {
              ...syncInfo,
              state: filteredState,
              initialState: filteredInitialState,
              log,
            },
          ],
        };
      }
      default:
        return payload;
    }
  };

/** Redact move arguments from logs not intended for the acting player. */
export function redactLog(log: LogEntry[] | undefined, playerID: PlayerID | null) {
  if (log === undefined) return log;

  return log.map((logEvent) => {
    if (playerID !== null && +playerID === +logEvent.action.payload.playerID) return logEvent;
    if (logEvent.redact !== true) return logEvent;

    const payload = { ...logEvent.action.payload, args: null };
    const filteredEvent = { ...logEvent, action: { ...logEvent.action, payload } };
    const { redact: _redact, ...remaining } = filteredEvent;
    return remaining;
  });
}
