/*
 * Copyright 2018 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import { createStore, applyMiddleware } from 'redux';

import {
  applyAIMoveDelayMultiplier,
  getRemainingAIMoveDelayMs,
  resolveAIMoveDelayMs,
} from '../../ai/move-delay';
import { MAKE_MOVE, REDO, UNDO } from '../../core/action-types';
import { getFilterPlayerView } from '../../core/filter-player-view';
import { IsLongFormMove, ProcessGameConfig } from '../../core/game';
import { InitializeGame } from '../../core/initialize';
import * as logging from '../../core/logger';
import { CreateGameReducer, TransientHandlingMiddleware } from '../../core/reducer';
import type { IntermediateTransportData, TransportData } from '../../core/transport-data';
import type {
  ActionShape,
  ChatMessage,
  CredentialedActionShape,
  FilteredMetadata,
  Game,
  PlayerID,
  State,
  SyncInfo,
} from '../../types';
import { LocalMatchStore } from './local-storage';
import { Transport } from './transport';
import type { TransportOpts } from './transport';

/**
 * Returns null if it is not a bot's turn.
 * Otherwise, returns a playerID of a bot that may play now.
 */
export function GetBotPlayer(state: State, bots: Record<PlayerID, any>) {
  if (state.ctx.gameover !== undefined) {
    return null;
  }

  const canBotPlay = (playerID: PlayerID) => {
    const bot = bots[playerID];
    if (!bot?.enumerate) return true;
    try {
      return bot.enumerate(state.G, state.ctx, playerID).length > 0;
    } catch {
      return true;
    }
  };

  if (state.ctx.activePlayers) {
    for (const key of Object.keys(bots)) {
      if (key in state.ctx.activePlayers && canBotPlay(key)) {
        return key;
      }
    }
  } else if (state.ctx.currentPlayer in bots && canBotPlay(state.ctx.currentPlayer)) {
    return state.ctx.currentPlayer;
  }

  return null;
}

interface LocalOpts {
  bots?: Record<PlayerID, any>;
  persist?: boolean;
  storageKey?: string;
  setupData?: unknown;
  aiDelayMultiplier?: number;
}

type LocalMasterOpts = LocalOpts & {
  game: Game;
};

type LocalMasterCallback = (arg: {
  state: State;
  matchID: string;
  action?: ActionShape.Any | CredentialedActionShape.Any;
}) => void | Promise<void>;

const stripCredentialsFromAction = (action: CredentialedActionShape.Any) => {
  const { credentials: _credentials, ...payload } = action.payload;
  return { ...action, payload };
};

/**
 * Creates a local version of the master that the client
 * can interact with.
 */
export class LocalMaster {
  readonly game: ReturnType<typeof ProcessGameConfig>;
  connect: (playerID: PlayerID, callback: (data: TransportData) => void) => void;
  private readonly storage: LocalMatchStore;
  private readonly send: (playerData: { playerID: PlayerID } & IntermediateTransportData) => void;
  private readonly sendAll: (payload: IntermediateTransportData) => void;
  private readonly setupData?: unknown;
  private subscribeCallback: LocalMasterCallback = () => {};

  constructor({ game, bots, storageKey, persist, setupData, aiDelayMultiplier }: LocalMasterOpts) {
    this.game = ProcessGameConfig(game);
    this.storage = new LocalMatchStore(persist, storageKey, this.game);
    this.setupData = setupData;

    const clientCallbacks: Record<PlayerID, (data: TransportData) => void> = {};
    const initializedBots = {};

    if (game && game.ai && bots) {
      for (const playerID in bots) {
        const bot = bots[playerID];
        initializedBots[playerID] = new bot({
          game,
          enumerate: game.ai.enumerate,
          seed: game.seed,
        });
      }
    }

    const filterPlayerView = getFilterPlayerView(this.game);
    this.send = ({ playerID, ...data }) => {
      const callback = clientCallbacks[playerID];
      if (callback !== undefined) {
        callback(filterPlayerView(playerID, data));
      }
    };
    this.sendAll = (payload) => {
      for (const playerID in clientCallbacks) {
        this.send({ playerID, ...payload });
      }
    };

    this.connect = (playerID, callback) => {
      clientCallbacks[playerID] = callback;
    };

    this.subscribe(({ state, matchID }) => {
      if (!bots) {
        return;
      }
      const botPlayer = GetBotPlayer(state, initializedBots);
      if (botPlayer !== null) {
        // Defer out of the subscribe callback to avoid blocking Master.onUpdate.
        // Start the move timer before bot.play() so computation runs in parallel.
        setTimeout(() => {
          void (async () => {
            try {
              const startedAt = Date.now();
              const botAction = await initializedBots[botPlayer].play(state, botPlayer);
              if (!botAction?.action?.payload) return; // no valid move found
              const delayMs = applyAIMoveDelayMultiplier(
                resolveAIMoveDelayMs(game, state, botPlayer, botAction.action),
                aiDelayMultiplier,
              );
              const remainingDelay = getRemainingAIMoveDelayMs(delayMs, startedAt);
              if (remainingDelay > 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, remainingDelay));
              }

              const latestState = this.storage.fetch(matchID).state;
              if (!latestState || latestState._stateID !== state._stateID) return;
              if (GetBotPlayer(latestState, initializedBots) !== botPlayer) return;

              await this.onUpdate(
                botAction.action,
                state._stateID,
                matchID,
                botAction.action.payload.playerID,
              );
            } catch {
              // Bot failed — skip turn to prevent permanent freeze
            }
          })();
        }, 0);
      }
    });
  }

  subscribe(fn: LocalMasterCallback): void {
    this.subscribeCallback = fn;
  }

  async onUpdate(
    credAction: CredentialedActionShape.Any,
    stateID: number,
    matchID: string,
    playerID: string,
  ): Promise<void | { error: string }> {
    if (!credAction?.payload) return { error: 'missing action or action payload' };

    const payloadPlayerID = (credAction.payload as { playerID?: unknown }).playerID;
    if (payloadPlayerID != null && payloadPlayerID !== '' && payloadPlayerID !== playerID) {
      logging.error(`unauthorized action - outer=[${playerID}]`);
      return { error: 'unauthorized action' };
    }

    const seatBoundAction =
      payloadPlayerID == null || payloadPlayerID === ''
        ? ({
            ...credAction,
            payload: { ...credAction.payload, playerID },
          } as CredentialedActionShape.Any)
        : credAction;
    const action = stripCredentialsFromAction(seatBoundAction);
    let { state } = this.storage.fetch(matchID);

    if (state === undefined) return { error: 'game not found' };
    if (state.ctx.gameover !== undefined) return;

    if (action.type === UNDO || action.type === REDO) {
      const hasActivePlayers = state.ctx.activePlayers !== null;
      const isCurrentPlayer = state.ctx.currentPlayer === playerID;
      if (
        (!hasActivePlayers && !isCurrentPlayer) ||
        (hasActivePlayers &&
          (state.ctx.activePlayers[playerID] === undefined ||
            Object.keys(state.ctx.activePlayers).length > 1))
      ) {
        return;
      }
    }

    if (!this.game.flow.isPlayerActive(state.G, state.ctx, playerID)) return;

    const move =
      action.type === MAKE_MOVE
        ? this.game.flow.getMove(state.ctx, action.payload.type, playerID)
        : null;
    if (action.type === MAKE_MOVE && !move) return;
    if (state._stateID !== stateID && !(move && IsLongFormMove(move) && move.ignoreStaleStateID)) {
      return;
    }

    const store = createStore(
      CreateGameReducer({ game: this.game }),
      state,
      applyMiddleware(TransientHandlingMiddleware),
    );
    const prevState = store.getState();
    store.dispatch(action);
    state = store.getState();

    const updateCallbackResult = this.subscribeCallback({ state, action, matchID });
    if (
      updateCallbackResult &&
      typeof (updateCallbackResult as Promise<void>).then === 'function'
    ) {
      await updateCallbackResult;
    }

    const { deltalog, ...stateWithoutDeltalog } = state;
    this.storage.setState(matchID, stateWithoutDeltalog, deltalog);

    this.sendAll(
      this.game.deltaState
        ? { type: 'patch', args: [matchID, prevState._stateID, prevState, state] }
        : { type: 'update', args: [matchID, state] },
    );
  }

  async onSync(
    matchID: string,
    playerID: string | null | undefined,
    _credentials?: string,
    numPlayers = 2,
  ): Promise<void | { error: string }> {
    let { state, initialState, log, metadata } = this.storage.fetch(matchID, numPlayers);

    if (state === undefined) {
      const setupDataError =
        this.game.validateSetupData && this.game.validateSetupData(this.setupData, numPlayers);
      if (setupDataError !== undefined) return { error: 'game requires setupData' };

      initialState = state = InitializeGame({
        game: this.game,
        numPlayers,
        setupData: this.setupData,
      });
      const now = Date.now();
      metadata = {
        gameName: this.game.name,
        players: Object.fromEntries(
          Array.from({ length: numPlayers }, (_, playerIndex) => [
            playerIndex,
            { id: playerIndex },
          ]),
        ),
        setupData: this.setupData,
        unlisted: true,
        createdAt: now,
        updatedAt: now,
      };
      const syncCallbackResult = this.subscribeCallback({ state, matchID });
      if (syncCallbackResult && typeof (syncCallbackResult as Promise<void>).then === 'function') {
        await syncCallbackResult;
      }
      this.storage.createMatch(matchID, initialState, metadata);
      log = [];
    }

    const filteredMetadata: FilteredMetadata | undefined = metadata
      ? Object.values(metadata.players).map(({ credentials: _credentials, ...player }) => player)
      : undefined;
    const syncInfo: SyncInfo = { state, log, initialState, filteredMetadata };
    this.send({ playerID, type: 'sync', args: [matchID, syncInfo] });
  }

  async onChatMessage(
    matchID: string,
    chatMessage: ChatMessage,
    _credentials?: string,
  ): Promise<void> {
    this.sendAll({ type: 'chat', args: [matchID, chatMessage] });
  }
}

type LocalTransportOpts = TransportOpts & {
  master?: LocalMaster;
};

/**
 * Local
 *
 * Transport interface that embeds a GameMaster within it
 * that you can connect multiple clients to.
 */
export class LocalTransport extends Transport {
  master: LocalMaster;

  /**
   * Creates a new Mutiplayer instance.
   * @param {string} matchID - The game ID to connect to.
   * @param {string} playerID - The player ID associated with this client.
   * @param {string} gameName - The game type (the `name` field in `Game`).
   * @param {string} numPlayers - The number of players.
   */
  constructor({ master, ...opts }: LocalTransportOpts) {
    super(opts);
    this.master = master;
  }

  sendChatMessage(matchID: string, chatMessage: ChatMessage): void {
    this.master.onChatMessage(matchID, chatMessage, this.credentials);
  }

  sendAction(state: State, action: CredentialedActionShape.Any): void {
    this.master.onUpdate(action, state._stateID, this.matchID, this.playerID);
  }

  requestSync(): void {
    this.master.onSync(this.matchID, this.playerID, this.credentials, this.numPlayers);
  }

  connect(): void {
    this.setConnectionStatus(true);
    this.master.connect(this.playerID, (data) => this.notifyClient(data));
    this.requestSync();
  }

  disconnect(): void {
    this.setConnectionStatus(false);
  }

  updateMatchID(id: string): void {
    this.matchID = id;
    this.connect();
  }

  updatePlayerID(id: PlayerID): void {
    this.playerID = id;
    this.connect();
  }

  updateCredentials(credentials?: string): void {
    this.credentials = credentials;
    this.connect();
  }
}

/**
 * Global map storing local master instances.
 */
const localMasters: Map<Game, { master: LocalMaster } & LocalOpts> = new Map();

/**
 * Create a local transport.
 */
export function Local({ bots, persist, storageKey, setupData, aiDelayMultiplier }: LocalOpts = {}) {
  return (transportOpts: TransportOpts) => {
    const { gameKey, game } = transportOpts;
    let master: LocalMaster;

    const instance = localMasters.get(gameKey);
    if (
      instance &&
      instance.bots === bots &&
      instance.storageKey === storageKey &&
      instance.persist === persist &&
      instance.aiDelayMultiplier === aiDelayMultiplier
    ) {
      master = instance.master;
    }

    if (!master) {
      master = new LocalMaster({ game, bots, persist, storageKey, setupData, aiDelayMultiplier });
      localMasters.set(gameKey, { master, bots, persist, storageKey, aiDelayMultiplier });
    }

    return new LocalTransport({ master, ...transportOpts });
  };
}
