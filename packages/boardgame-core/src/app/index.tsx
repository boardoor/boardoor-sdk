import { Component, StrictMode, useState, useEffect } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { RandomBot, MCTSBot, DeterminizedBot } from '../ai';
import { Client } from '../client/client';
import { Local } from '../client/transport/local';
import { Remote, WebSocketTransport } from '../client/transport/websocket';
import { makeMove } from '../core/action-creators';
import { resolveGameLogs } from '../game-log';
import type {
  CreateGameAppOptions,
  GameClient,
  GameClientState,
  GameLogStateMessage,
  InitMessage,
  LocalInitMessage,
} from './types';

export type {
  AudioSettings,
  GameClient,
  GameClientState,
  GameLogStateMessage,
  CreateGameAppOptions,
  DebugOption,
  LocalInitMessage,
} from './types';

/**
 * Merge multiple locale sources into a single locales object.
 * Each source is a Record<languageCode, Record<key, value>>.
 * Later sources override earlier ones for the same key.
 */
export function mergeLocales(
  ...sources: Record<string, Record<string, string>>[]
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const source of sources) {
    for (const [lng, translations] of Object.entries(source)) {
      result[lng] = { ...result[lng], ...translations };
    }
  }
  return result;
}

// i18n — optional, only initialized when locales are provided
let i18nReady = false;
type I18nInstanceLike = {
  t: (key: string, defaultValue: string) => string;
  language?: string;
  isInitialized?: boolean;
  use?: (plugin: unknown) => I18nInstanceLike;
  init?: (options: Record<string, unknown>) => Promise<unknown>;
  addResourceBundle?: (
    lng: string,
    ns: string,
    resources: Record<string, string>,
    deep?: boolean,
    overwrite?: boolean,
  ) => void;
  changeLanguage?: (lng: string) => Promise<unknown>;
};
let i18nInstance: I18nInstanceLike | null = null;
let deferredGameOver: (() => void) | undefined;
const AUDIO_SETTINGS_EVENT = 'boardoor:audio-settings';

function dispatchAudioSettings(settings: unknown): void {
  window.dispatchEvent(new CustomEvent(AUDIO_SETTINGS_EVENT, { detail: settings }));
}
type I18nDeps = {
  i18next: I18nInstanceLike;
  initReactI18next: unknown;
};

function loadI18nDeps(): Promise<I18nDeps | null> {
  return Promise.all([import('i18next'), import('react-i18next')]).then(
    ([i18nextModule, reactI18nextModule]) => ({
      i18next: i18nextModule.default as I18nInstanceLike,
      initReactI18next: reactI18nextModule.initReactI18next,
    }),
    () => null,
  );
}

function getCookieValue(name: string): string | undefined {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

function detectLanguage(): string {
  return getCookieValue('lng') || navigator.language?.split('-')[0] || 'en';
}

async function initGameI18n(
  language: string,
  locales: Record<string, Record<string, string>>,
): Promise<void> {
  const deps = await loadI18nDeps();
  if (!deps) return;
  const { i18next, initReactI18next } = deps;

  const resources: Record<string, { translation: Record<string, string> }> = {};
  for (const lng of Object.keys(locales)) {
    resources[lng] = { translation: { ...locales[lng] } };
  }

  if (!i18nReady || !i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
  } else {
    for (const [lng, bundle] of Object.entries(resources)) {
      i18next.addResourceBundle?.(lng, 'translation', bundle.translation, true, true);
    }
    if (i18next.language !== language) {
      await i18next.changeLanguage?.(language);
    }
  }
  i18nInstance = i18next;
  i18nReady = true;
}

/**
 * Trigger the deferred gameOver postMessage to the shell.
 * Only needed when `delayGameOver: true` is set in createGameApp.
 */
export function postGameOver(): void {
  deferredGameOver?.();
}

export { playerLabel } from '../player-label';

/**
 * React hook that tracks a client's matchData as state,
 * ensuring re-renders when player metadata (names, connection status) changes.
 */
export function useMatchData(client: GameClient | undefined): GameClient['matchData'] {
  const [matchData, setMatchData] = useState<GameClient['matchData']>(client?.matchData);
  useEffect(() => {
    if (!client) return;
    setMatchData(client.matchData);
    return client.subscribe(() => {
      setMatchData(client.matchData);
    });
  }, [client]);
  return matchData;
}

/**
 * React hook that subscribes to multiple clients and returns their states.
 * Re-renders whenever any client's state changes.
 */
export function useClientStates(clients: GameClient[]): (GameClientState | null)[] {
  const [states, setStates] = useState<(GameClientState | null)[]>(clients.map(() => null));

  useEffect(() => {
    setStates(clients.map(() => null));

    const unsubs = clients.map((c, idx) =>
      c.subscribe(() =>
        setStates((prev) => {
          const next = [...prev];
          next[idx] = c.getState();
          return next;
        }),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [clients]);

  return states;
}

function isInitMessage(data: unknown): data is InitMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  return (
    msg.type === 'init' &&
    typeof msg.serverUrl === 'string' &&
    typeof msg.matchID === 'string' &&
    typeof msg.playerID === 'string' &&
    typeof msg.ticket === 'string' &&
    msg.ticket.length > 0 &&
    !('credentials' in msg)
  );
}

function isLocalInitMessage(data: unknown): data is LocalInitMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  return (
    msg.type === 'localInit' &&
    typeof msg.numPlayers === 'number' &&
    typeof msg.aiStrength === 'string' &&
    (msg.aiDelayMultiplier === undefined || typeof msg.aiDelayMultiplier === 'number')
  );
}

const DEFAULT_SHELL_ORIGIN = 'https://boardoor.com';
const RECONNECT_FAILED_EVENT = 'boardoor:reconnectFailed';
const RECONNECT_RESET_EVENT = 'boardoor:reconnectReset';

/** Get a translation from i18next if initialized, otherwise return fallback. */
function getTranslation(key: string, fallback: string): string {
  if (i18nInstance) return i18nInstance.t(key, fallback);
  return fallback;
}

function postToShell(msg: Record<string, unknown>, targetOrigin: string) {
  if (window.parent !== window) {
    window.parent.postMessage(msg, targetOrigin);
  }
}

const MAX_CLIENT_ERROR_REPORTS = 10;

class GameRenderErrorBoundary extends Component<
  { children: ReactNode; shellOrigin: string },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    postToShell(
      {
        type: 'clientError',
        message: error.message || 'Game render error',
        source: 'game-render',
        stack: error.stack ?? info.componentStack,
        url: window.location.href,
      },
      this.props.shellOrigin,
    );
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          minHeight: '100vh',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          background: '#0f172a',
          color: '#f8fafc',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>Game view failed to render</div>
        <div style={{ maxWidth: 520, color: '#cbd5e1', fontSize: 14 }}>
          Reload the game view to reconnect. The error has been reported to Boardoor.
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            border: 0,
            borderRadius: 6,
            padding: '10px 14px',
            background: '#38bdf8',
            color: '#082f49',
            cursor: 'pointer',
            fontWeight: 700,
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}

/**
 * Forward unhandled errors and promise rejections in the game iframe to the shell
 * (which POSTs them to /api/client-error → Sentry). Game SPAs have no error
 * reporting of their own; this gives one shared path for all of them. F139.
 *
 * No-ops outside an iframe (local dev), dedupes identical errors, and caps the
 * number of reports per session to avoid flooding the endpoint from a render loop.
 */
function installClientErrorReporter(shellOrigin: string, cleanups: Array<() => void>): void {
  if (window.parent === window) return;
  let reported = 0;
  const seen = new Set<string>();
  const report = (message: string, source?: string, stack?: string) => {
    if (reported >= MAX_CLIENT_ERROR_REPORTS) return;
    const key = `${message}@@${source ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    reported += 1;
    postToShell(
      { type: 'clientError', message, source, stack, url: window.location.href },
      shellOrigin,
    );
  };
  const onError = (event: ErrorEvent) => {
    report(event.message || 'Unknown error', event.filename || undefined, event.error?.stack);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    report(`Unhandled rejection: ${message}`, undefined, stack);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  cleanups.push(() => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  });
}

function getFallbackLogConfig(
  setupData: unknown,
): { enabled: boolean; level: import('../game-log').GameLogLevel } | undefined {
  const log = (
    setupData as {
      _boardoor?: { log?: { enabled?: unknown; level?: unknown } };
    }
  )?._boardoor?.log;
  if (typeof log?.enabled === 'boolean' && (log.level === 'action' || log.level === 'detail')) {
    return {
      enabled: log.enabled,
      level: log.level,
    };
  }
  return undefined;
}

function translateLogMessage(key: string, params?: Record<string, unknown>): string {
  if (i18nInstance) {
    return (i18nInstance.t as any)(key, { defaultValue: key, ...params }) as string;
  }
  return key;
}

function emitResolvedGameLogs(
  state: GameClientState | null,
  playerID: string | undefined,
  matchData: GameClient['matchData'] | undefined,
  targetOrigin: string,
  prevSignatureRef: { current: string },
  fallbackLogConfig?: { enabled: boolean; level: import('../game-log').GameLogLevel },
) {
  if (!state) return;
  if (!state.G || typeof state.G !== 'object') return;
  const G = state.G as {
    gameLog?: import('../game-log').GameLogEntry[];
    logConfig?: { enabled: boolean; level: import('../game-log').GameLogLevel };
  };
  const logConfig = G.logConfig ?? fallbackLogConfig;
  const enabled = logConfig?.enabled ?? false;
  const level = logConfig?.level ?? 'action';
  const entries = enabled
    ? resolveGameLogs(G.gameLog, playerID, level, translateLogMessage, matchData)
    : [];
  const signature = JSON.stringify({
    enabled,
    entries: entries.map((entry) => ({ id: entry.id, text: entry.text })),
  });
  if (signature === prevSignatureRef.current) return;
  prevSignatureRef.current = signature;
  const message: GameLogStateMessage = { type: 'gameLogState', enabled, entries };
  postToShell(message as unknown as Record<string, unknown>, targetOrigin);
}

function setReconnectFailed(failed: boolean) {
  (window as any).__boardoor_reconnectFailed = failed;
  window.dispatchEvent(new Event(failed ? RECONNECT_FAILED_EVENT : RECONNECT_RESET_EVENT));
}

function resolveNumPlayers(game: CreateGameAppOptions['game']): number {
  const params = new URLSearchParams(window.location.search);
  const param = params.get('numPlayers');
  const min = game.minPlayers ?? 2;
  const max = game.maxPlayers ?? min;
  const fallback = max;
  const parsed = param ? parseInt(param, 10) : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function renderAccessDenied(rootEl: string) {
  const el = document.getElementById(rootEl);
  if (el) {
    el.textContent = 'Access denied';
    el.style.cssText =
      'display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#666';
  }
}

function renderTicketRequired(rootEl: string) {
  const el = document.getElementById(rootEl);
  if (el) {
    el.textContent = 'Connection rejected: a ticket URL param is required for online mode';
    el.style.cssText =
      'display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#666;padding:24px;text-align:center';
  }
}

export function createGameApp(opts: CreateGameAppOptions): void {
  const {
    game,
    board: Board,
    debug = false,
    rootElement = 'app',
    serverUrl: devServerUrl,
    delayGameOver = true,
    locales: gameLocales,
  } = opts;
  const shellOrigin = opts.shellOrigin ?? DEFAULT_SHELL_ORIGIN;
  const numPlayers = opts.numPlayers ?? resolveNumPlayers(game);

  // Content protection — disable right-click context menu
  const rootEl = document.getElementById(rootElement);
  if (rootEl) {
    rootEl.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Show inline loading indicator immediately (before React/CSS are ready).
  // Uses DOM API (no innerHTML) to avoid any injection risk.
  if (rootEl && !rootEl.hasChildNodes()) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      'display:flex;align-items:center;justify-content:center;height:100vh;gap:12px;color:#a3a3a3;font-family:system-ui,sans-serif';
    const spinner = document.createElement('div');
    spinner.style.cssText =
      'width:32px;height:32px;border:3px solid #525252;border-top-color:#d4d4d4;border-radius:50%;animation:_spin .8s linear infinite';
    const label = document.createElement('span');
    label.style.cssText = 'font-size:14px;letter-spacing:.05em';
    label.textContent = 'Loading\u2026';
    wrapper.appendChild(spinner);
    wrapper.appendChild(label);
    const style = document.createElement('style');
    style.textContent = '@keyframes _spin{to{transform:rotate(360deg)}}';
    rootEl.appendChild(wrapper);
    rootEl.appendChild(style);
  }

  let reactRoot: ReturnType<typeof createRoot> | null = null;
  let stampSender: ((stampId: string) => void) | undefined;

  const cleanups: Array<() => void> = [];
  // Use `pagehide` instead of `beforeunload`: pagehide is not cancelable, so
  // teardown only runs when the page is definitively leaving the screen.
  // `beforeunload` can be canceled (e.g. "stay on page" prompt), which would
  // leave the game disconnected after cleanup already ran.
  //
  // Skip teardown when `event.persisted` is true — the page is entering the
  // back/forward cache and may be restored without a reload. Do not use
  // `{ once: true }` so the handler stays active for the eventual real unload
  // after bfcache restores.
  window.addEventListener('pagehide', (event: PageTransitionEvent) => {
    if (event.persisted) return;
    cleanups.forEach((fn) => fn());
    reactRoot?.unmount();
  });

  // Forward unhandled iframe errors to the shell for centralized reporting (F139).
  installClientErrorReporter(shellOrigin, cleanups);

  function trackUnsub(unsub: unknown) {
    if (typeof unsub === 'function') cleanups.push(unsub as () => void);
  }

  function render(clients: GameClient[], onlinePlayerID?: string) {
    if (!reactRoot) {
      reactRoot = createRoot(document.getElementById(rootElement)!);
    }
    reactRoot.render(
      <StrictMode>
        <GameRenderErrorBoundary shellOrigin={shellOrigin}>
          <Board clients={clients} onlinePlayerID={onlinePlayerID} />
        </GameRenderErrorBoundary>
      </StrictMode>,
    );
  }

  async function initI18nAndRender(
    language: string,
    clients: GameClient[],
    onlinePlayerID?: string,
  ) {
    if (gameLocales) {
      await initGameI18n(language, gameLocales);
    }
    render(clients, onlinePlayerID);
  }

  function subscribeGameOver(
    client: { subscribe: (cb: (state: any) => void) => unknown },
    playerID?: string,
  ) {
    if (delayGameOver) {
      let pendingResult: unknown = null;
      let pendingShareResult: import('../types').ShareResult | undefined;
      let posted = false;
      const post = () => {
        if (pendingResult != null && !posted) {
          posted = true;
          postToShell(
            { type: 'gameOver', result: pendingResult, shareResult: pendingShareResult },
            shellOrigin,
          );
        }
      };
      trackUnsub(
        client.subscribe((state) => {
          if (state?.ctx.gameover != null) {
            pendingResult = state.ctx.gameover;
            if (game.computeShareResult && playerID) {
              pendingShareResult = game.computeShareResult({
                G: state.G,
                ctx: state.ctx,
                playerID,
              });
            }
          }
        }),
      );
      // Manual trigger (existing API)
      deferredGameOver = post;
      cleanups.push(() => {
        if (deferredGameOver === post) deferredGameOver = undefined;
      });
      // Automatic trigger from GameOverOverlay
      window.addEventListener('gameOverVisible', post, { once: true });
    } else {
      trackUnsub(
        client.subscribe((state) => {
          if (state?.ctx.gameover != null) {
            let shareResult: import('../types').ShareResult | undefined;
            if (game.computeShareResult && playerID) {
              shareResult = game.computeShareResult({ G: state.G, ctx: state.ctx, playerID });
            }
            postToShell({ type: 'gameOver', result: state.ctx.gameover, shareResult }, shellOrigin);
          }
        }),
      );
    }
  }

  // Reference to WebSocketTransport for stamp sending
  let wsTransportRef: WebSocketTransport | null = null;

  function startOnlineClient(
    serverUrl: string,
    matchID: string,
    playerID: string,
    ticket: string,
    language?: string,
  ) {
    setReconnectFailed(false);
    const gameLogSignatureRef = { current: '' };
    const transportFactory = Remote({ server: serverUrl, shellOrigin, ticket });
    // Wrap factory to capture the transport instance
    const wrappedFactory = (opts: Parameters<typeof transportFactory>[0]) => {
      const transportDataCallback = opts.transportDataCallback;
      const t = transportFactory(opts);
      (t as any).transportDataCallback = (data: any) => {
        if (data?.type === 'reconnectFailed') {
          setReconnectFailed(true);
          return;
        }
        if (data?.type === 'reconnectRestored') {
          // A late ticket refresh revived the connection after we had given up.
          setReconnectFailed(false);
          return;
        }
        transportDataCallback(data);
      };
      wsTransportRef = t;
      return t;
    };
    const client = Client({
      game,
      numPlayers,
      playerID,
      matchID,
      credentials: '',
      multiplayer: wrappedFactory,
      debug: false,
    });
    client.start();
    cleanups.push(() => client.stop());

    // Bridge shell → iframe stamp messages to the active WebSocket without a window global.
    stampSender = (stampId: string) => {
      if (wsTransportRef) {
        (wsTransportRef as any).send({
          type: 'stamp',
          matchID,
          playerID,
          stampId,
        });
      }
    };
    cleanups.push(() => {
      stampSender = undefined;
    });

    subscribeGameOver(client, playerID);
    trackUnsub(
      client.subscribe((state) => {
        emitResolvedGameLogs(
          state as GameClientState,
          playerID,
          client.matchData,
          shellOrigin,
          gameLogSignatureRef,
        );
      }),
    );

    void initI18nAndRender(
      language ?? detectLanguage(),
      [client as unknown as GameClient],
      playerID,
    ).then(() => {
      gameLogSignatureRef.current = '';
      emitResolvedGameLogs(
        client.getState(),
        playerID,
        client.matchData,
        shellOrigin,
        gameLogSignatureRef,
      );
    });
  }

  function startLocalAIMode(
    localNumPlayers: number,
    aiStrength: 'weak' | 'medium' | 'strong',
    setupData?: unknown,
    language?: string,
    audioSettings?: import('./types').AudioSettings,
    aiDelayMultiplier?: number,
  ) {
    if (!game.ai?.enumerate) {
      postToShell(
        { type: 'error', message: 'Game does not support AI (no ai.enumerate)' },
        shellOrigin,
      );
      return;
    }

    // Lazy-initialize AI resources (e.g. load NN weights)
    if (game.ai.init) game.ai.init().catch(() => {});

    // Build bot class based on strength
    const enumerate = game.ai.enumerate;
    const objectives = game.ai.objectives;
    const sampleHiddenState = game.ai.sampleHiddenState;
    const bestMoveFn = game.ai.bestMove;
    function makeBotClass(strength: 'weak' | 'medium' | 'strong') {
      // Base bot class (MCTS or Determinized)
      function makeBaseClass(iters: number) {
        if (sampleHiddenState) {
          return class extends DeterminizedBot {
            constructor(opts: ConstructorParameters<typeof DeterminizedBot>[0]) {
              super({
                ...opts,
                game,
                enumerate,
                sampleHiddenState,
                objectives,
                iterations: iters,
                playoutDepth: 50,
                samples: 5,
              });
            }
          };
        }
        return class extends MCTSBot {
          constructor(opts: ConstructorParameters<typeof MCTSBot>[0]) {
            super({ ...opts, game, enumerate, objectives, iterations: iters, playoutDepth: 50 });
          }
        };
      }

      // Wrap base class to try bestMove first (medium/strong only)
      function wrapWithBestMove(
        s: 'medium' | 'strong',
        BaseClass: ReturnType<typeof makeBaseClass>,
      ) {
        if (!bestMoveFn) return BaseClass;
        return class extends BaseClass {
          async play(
            state: Parameters<InstanceType<typeof BaseClass>['play']>[0],
            playerID: string,
          ) {
            const best = await bestMoveFn(state.G, state.ctx, playerID, s);
            if (best) {
              return { action: makeMove(best.move, best.args, playerID) };
            }
            return super.play(state, playerID);
          }
        };
      }

      switch (strength) {
        case 'weak':
          // If game provides bestMove, wrap RandomBot to try it first
          if (bestMoveFn) {
            return class extends RandomBot {
              async play(
                state: Parameters<InstanceType<typeof RandomBot>['play']>[0],
                playerID: string,
              ) {
                const best = await bestMoveFn(state.G, state.ctx, playerID, undefined);
                if (best) {
                  return { action: makeMove(best.move, best.args, playerID) };
                }
                return super.play(state, playerID);
              }
            };
          }
          return RandomBot;
        case 'medium':
          return wrapWithBestMove('medium', makeBaseClass(200));
        case 'strong':
          return wrapWithBestMove('strong', makeBaseClass(800));
      }
    }

    const BotClass = makeBotClass(aiStrength);
    const humanSeat = Math.floor(Math.random() * localNumPlayers);
    const bots: Record<string, typeof BotClass> = {};
    for (let i = 0; i < localNumPlayers; i++) {
      if (i === humanSeat) continue;
      bots[String(i)] = BotClass;
    }

    const multiplayer = Local({ bots, setupData, aiDelayMultiplier });
    const fallbackLogConfig = getFallbackLogConfig(setupData);

    const humanPlayerID = String(humanSeat);
    const humanClient = Client({
      game,
      numPlayers: localNumPlayers,
      playerID: humanPlayerID,
      multiplayer,
      debug: false,
    });
    humanClient.start();
    cleanups.push(() => humanClient.stop());
    const gameLogSignatureRef = { current: '' };

    subscribeGameOver(humanClient, humanPlayerID);
    trackUnsub(
      humanClient.subscribe((state) => {
        emitResolvedGameLogs(
          state as GameClientState,
          humanPlayerID,
          humanClient.matchData,
          shellOrigin,
          gameLogSignatureRef,
          fallbackLogConfig,
        );
      }),
    );

    if (audioSettings) {
      setTimeout(() => dispatchAudioSettings(audioSettings), 0);
    }

    // Notify shell when it's the human player's turn (for turn sound).
    // Only fire once per turn transition (track previous turn/phase to avoid
    // repeated notifications during simultaneous stages like card passing).
    // The shell handles beep playback — no need to play here (would cause double beep).
    let prevTurnKey = '';
    trackUnsub(
      humanClient.subscribe((state) => {
        if (!state || state.ctx.gameover != null) return;
        const isMyTurn = state.ctx.activePlayers
          ? humanPlayerID in state.ctx.activePlayers
          : state.ctx.currentPlayer === humanPlayerID;
        if (!isMyTurn) {
          prevTurnKey = '';
          return;
        }
        const turnKey = `${state.ctx.turn}:${state.ctx.phase ?? ''}`;
        if (turnKey === prevTurnKey) return;
        prevTurnKey = turnKey;
        postToShell({ type: 'turnChange', currentPlayer: humanPlayerID }, shellOrigin);
      }),
    );

    const lang = language ?? detectLanguage();

    const buildMatchData = () => {
      const youLabel = getTranslation('you', 'You');
      const cpuLabel = getTranslation('cpu', 'CPU');
      let cpuNum = 1;
      humanClient.matchData = Array.from({ length: localNumPlayers }, (_, i) => ({
        id: i,
        name: i === humanSeat ? youLabel : `${cpuLabel} ${cpuNum++}`,
        isConnected: true,
      }));
    };

    // Initialize i18n before rendering so translated labels are available
    if (gameLocales) {
      initGameI18n(lang, gameLocales).then(() => {
        buildMatchData();
        render([humanClient as unknown as GameClient], humanPlayerID);
        gameLogSignatureRef.current = '';
        emitResolvedGameLogs(
          humanClient.getState(),
          humanPlayerID,
          humanClient.matchData,
          shellOrigin,
          gameLogSignatureRef,
          fallbackLogConfig,
        );
      });
    } else {
      buildMatchData();
      render([humanClient as unknown as GameClient], humanPlayerID);
      gameLogSignatureRef.current = '';
      emitResolvedGameLogs(
        humanClient.getState(),
        humanPlayerID,
        humanClient.matchData,
        shellOrigin,
        gameLogSignatureRef,
        fallbackLogConfig,
      );
    }
  }

  function startLocalHotseatMode(localNumPlayers: number, setupData?: unknown, language?: string) {
    const multiplayer = Local({ setupData });
    const playerClients = Array.from({ length: localNumPlayers }, (_, i) =>
      Client({
        game,
        numPlayers: localNumPlayers,
        playerID: String(i),
        multiplayer,
        debug: false,
      }),
    );

    // Debug panel open by default for player switching
    const hotseatDebug =
      typeof debug === 'object' && debug
        ? { ...debug, collapseOnLoad: false }
        : debug === true
          ? { collapseOnLoad: false }
          : false;

    const debugClient = Client({
      game,
      numPlayers: localNumPlayers,
      multiplayer,
      debug: hotseatDebug,
    });

    [...playerClients, debugClient].forEach((c) => c.start());
    initI18nAndRender(language ?? detectLanguage(), playerClients as unknown as GameClient[]);
  }

  // --- Fullscreen toggle for standalone mode ---
  function injectFullscreenButton() {
    if (typeof document === 'undefined' || !document.fullscreenEnabled) return;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    function createSvgIcon(pathD: string): SVGSVGElement {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('width', '20');
      svg.setAttribute('height', '20');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', pathD);
      svg.appendChild(path);
      return svg;
    }

    const expandPath =
      'M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3';
    const compressPath = 'M4 14h6v6m10-10h-6V4m0 6l7-7M3 21l7-7';

    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Toggle fullscreen');
    btn.style.cssText = [
      'position:fixed',
      'bottom:12px',
      'right:12px',
      'z-index:9999',
      'width:40px',
      'height:40px',
      'border-radius:50%',
      'background:rgba(0,0,0,0.5)',
      'border:none',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'color:#fff',
      'opacity:0.6',
      'transition:opacity 0.2s',
    ].join(';');
    btn.addEventListener('mouseenter', () => {
      btn.style.opacity = '1';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.opacity = '0.6';
    });
    btn.appendChild(createSvgIcon(expandPath));

    btn.addEventListener('click', async () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
        try {
          (screen.orientation as any).unlock();
        } catch {
          /* unsupported */
        }
      } else {
        await document.documentElement.requestFullscreen({
          navigationUI: 'hide',
        } as FullscreenOptions);
        try {
          await (screen.orientation as any).lock('landscape');
        } catch {
          /* unsupported */
        }
      }
    });

    document.addEventListener('fullscreenchange', () => {
      btn.replaceChildren(createSvgIcon(document.fullscreenElement ? compressPath : expandPath));
    });

    document.body.appendChild(btn);
  }

  // --- Mode detection ---
  const params = new URLSearchParams(window.location.search);
  const modeParam = params.get('mode');

  // === Standalone preview mode ===
  if (modeParam) {
    const keyParam = params.get('key');
    const previewKey = opts.previewKey;

    // previewKey must be configured AND match
    if (!previewKey || keyParam !== previewKey) {
      renderAccessDenied(rootElement);
      return;
    }

    injectFullscreenButton();

    if (modeParam === 'local-ai') {
      const strength = (params.get('strength') ?? 'medium') as 'weak' | 'medium' | 'strong';
      const standaloneNumPlayers = resolveNumPlayers(game);
      startLocalAIMode(standaloneNumPlayers, strength);
      return;
    }

    if (modeParam === 'local-hotseat') {
      const standaloneNumPlayers = resolveNumPlayers(game);
      startLocalHotseatMode(standaloneNumPlayers);
      return;
    }

    // Unknown mode
    renderAccessDenied(rootElement);
    return;
  }

  // === Existing modes ===
  const serverParam = params.get('server');
  const matchIDParam = params.get('matchID');
  const playerIDParam = params.get('playerID');
  const ticketParam = params.get('ticket');
  const isOnlineMode = !!(serverParam && matchIDParam && playerIDParam);
  const isIframeMode = !isOnlineMode && window.parent !== window;

  if (isOnlineMode) {
    // Ticket-less connections are rejected server-side since DO/D1 slice 1, and the
    // transport no longer falls back to a credentials query param. Fail fast with a
    // visible error instead of starting a client that silently retries 403s forever.
    if (!ticketParam) {
      console.error(
        'createGameApp: online mode requires a ticket URL param; ' +
          'credentials-only direct connections are no longer supported (DO/D1 slice 1)',
      );
      renderTicketRequired(rootElement);
      return;
    }
    startOnlineClient(serverParam, matchIDParam, playerIDParam, ticketParam);
  } else if (isIframeMode) {
    postToShell({ type: 'ready' }, shellOrigin);
    let initialized = false;
    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== shellOrigin) return;
      if (isInitMessage(event.data)) {
        if (initialized) return;
        initialized = true;
        try {
          const { serverUrl, matchID, playerID, ticket, language, audioSettings } = event.data;
          if (audioSettings) {
            setTimeout(() => dispatchAudioSettings(audioSettings), 0);
          }
          startOnlineClient(serverUrl, matchID, playerID, ticket, language);
        } catch (err) {
          postToShell({ type: 'error', message: String(err) }, shellOrigin);
        }
      } else if (isLocalInitMessage(event.data)) {
        if (initialized) return;
        initialized = true;
        try {
          startLocalAIMode(
            event.data.numPlayers,
            event.data.aiStrength,
            event.data.setupData,
            event.data.language,
            event.data.audioSettings,
            event.data.aiDelayMultiplier,
          );
        } catch (err) {
          postToShell({ type: 'error', message: String(err) }, shellOrigin);
        }
      } else if (
        event.data &&
        typeof event.data === 'object' &&
        (event.data as { type?: unknown }).type === 'init'
      ) {
        if (initialized) return;
        renderTicketRequired(rootElement);
        postToShell(
          { type: 'error', message: 'Invalid init message: ticket is required' },
          shellOrigin,
        );
      } else if (event.data?.type === 'ticketRefresh' && typeof event.data.ticket === 'string') {
        // Fresh connection ticket from the shell (response to ticketRefreshRequest).
        wsTransportRef?.updateTicket(event.data.ticket);
      } else if (event.data?.type === 'audioSettingsUpdate' && event.data.audioSettings) {
        // Update audio settings at runtime (from shell volume controls)
        dispatchAudioSettings(event.data.audioSettings);
      } else if (event.data?.type === 'sendStamp' && typeof event.data.stampId === 'string') {
        // Forward stamp from shell to server via WebSocket
        stampSender?.(event.data.stampId);
      }
    };
    window.addEventListener('message', messageHandler);
    cleanups.push(() => window.removeEventListener('message', messageHandler));
  } else {
    // Local dev mode
    const multiplayer = devServerUrl ? Remote({ server: devServerUrl }) : Local();

    const playerClients = Array.from({ length: numPlayers }, (_, i) =>
      Client({
        game,
        numPlayers,
        playerID: String(i),
        multiplayer,
        debug: false,
      }),
    );

    const debugClient = Client({
      game,
      numPlayers,
      multiplayer,
      debug: debug === true ? { collapseOnLoad: true } : debug || false,
    });

    [...playerClients, debugClient].forEach((c) => c.start());

    initI18nAndRender(detectLanguage(), playerClients as unknown as GameClient[]);
  }
}
