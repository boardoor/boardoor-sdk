import type { ComponentType } from 'react';

import type { Game, Ctx } from '../types';

// --- Public types for game apps ---

export interface GameClient {
  moves: Record<string, (...args: any[]) => void>;
  undo: () => void;
  redo: () => void;
  subscribe: (cb: () => void) => () => void;
  getState: () => GameClientState | null;
  matchData?: Array<{ id: number; name?: string; isConnected?: boolean }>;
}

export type GameClientState = {
  G: any;
  ctx: Ctx;
  isConnected?: boolean;
};

export type DebugOption = boolean | { impl: unknown; collapseOnLoad?: boolean };

export interface CreateGameAppOptions {
  game: Game;
  board: ComponentType<{ clients: GameClient[]; onlinePlayerID?: string }>;
  numPlayers?: number;
  debug?: DebugOption;
  rootElement?: string;
  /** Server URL for local dev multiplayer (passed from import.meta.env.VITE_SERVER_URL) */
  serverUrl?: string;
  /** Preview key for standalone mode authentication (set via VITE_PREVIEW_KEY at build time) */
  previewKey?: string;
  /** Origin of the shell app for postMessage validation (default: 'https://boardoor.com') */
  shellOrigin?: string;
  /** When true, delay gameOver postMessage until the board calls postGameOver() on window */
  delayGameOver?: boolean;
  /** Game-specific translation resources. Keys: language codes (e.g. "en", "ja"). Values: flat key-value pairs. */
  locales?: Record<string, Record<string, string>>;
}

// --- Audio settings ---

export interface AudioSettings {
  master: { muted: boolean; volume: number };
  notification: { muted: boolean; volume: number };
  se: { muted: boolean; volume: number };
}

// --- Internal postMessage protocol types ---

export interface InitMessage {
  type: 'init';
  serverUrl: string;
  matchID: string;
  playerID: string;
  ticket: string;
  language?: string;
  audioSettings?: AudioSettings;
}

export interface LocalInitMessage {
  type: 'localInit';
  numPlayers: number;
  aiStrength: 'weak' | 'medium' | 'strong';
  setupData?: unknown;
  language?: string;
  audioSettings?: AudioSettings;
  aiDelayMultiplier?: number;
  /** @deprecated Use audioSettings instead */
  turnSound?: { muted: boolean; volume: number };
}

export interface GameLogStateMessage {
  type: 'gameLogState';
  enabled: boolean;
  entries: Array<{
    id: string;
    sequence: number;
    turn: number;
    playerId?: string;
    text: string;
  }>;
}
