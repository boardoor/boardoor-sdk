/*
 * Copyright 2025 The boardoor Authors
 *
 * WebSocket-based transport for connecting to a Durable Objects game server.
 */

import type { CredentialedActionShape, PlayerID, State, ChatMessage } from '../../types';
import { Transport } from './transport';
import type { TransportOpts } from './transport';

interface RemoteOpts {
  server: string;
  shellOrigin?: string;
  ticket?: string;
}

type WebSocketTransportOpts = TransportOpts & RemoteOpts;

/**
 * WebSocketTransport
 *
 * Transport interface that connects to a GameRoom Durable Object via WebSocket.
 */
export class WebSocketTransport extends Transport {
  private server: string;
  private shellOrigin: string;
  private ticket?: string;
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;
  /** Set when reconnect attempts were exhausted and reconnectFailed was emitted. */
  private reconnectFailedNotified = false;

  private static readonly INITIAL_DELAY = 1000;
  private static readonly MAX_DELAY = 30000;
  private static readonly BACKOFF_FACTOR = 2;
  private static readonly MAX_RECONNECT_ATTEMPTS = 15;

  constructor({ server, shellOrigin, ticket, ...opts }: WebSocketTransportOpts) {
    super(opts);
    this.server = server;
    this.shellOrigin = shellOrigin ?? 'https://boardoor.com';
    this.ticket = ticket;
  }

  /**
   * Build the WebSocket URL from the server address.
   * Converts http(s) to ws(s) and appends the game path.
   */
  private buildURL(): string {
    let url = this.server;
    // Convert protocol
    if (url.startsWith('https://')) {
      url = 'wss://' + url.slice('https://'.length);
    } else if (url.startsWith('http://')) {
      url = 'ws://' + url.slice('http://'.length);
    } else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = 'wss://' + url;
    }
    // Remove trailing slash
    if (url.endsWith('/')) {
      url = url.slice(0, -1);
    }
    const params = new URLSearchParams({
      playerID: String(this.playerID),
    });
    // ticket is the only connection proof. The raw-credentials query fallback was
    // removed in DO/D1 slice 1 (the server rejects token-less connections, and a
    // long-lived seat secret must never appear in a URL).
    if (this.ticket) {
      params.set('ticket', this.ticket);
    }
    return `${url}/ws/${encodeURIComponent(this.gameName)}/${encodeURIComponent(this.matchID)}?${params.toString()}`;
  }

  /**
   * Send data over WebSocket with readyState guard.
   */
  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private setupWebSocket(): void {
    const url = this.buildURL();
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      if (this.reconnectFailedNotified) {
        // We previously gave up and told the client (ReconnectBanner); a late ticket
        // refresh revived the connection, so withdraw the failure state.
        this.reconnectFailedNotified = false;
        this.notifyClient({ type: 'reconnectRestored' } as any);
      }
      this.setConnectionStatus(true);
      this.requestSync();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        // Ignore error responses from server (no `type` field)
        if (data && data.type) {
          // Platform messages: forward to shell via postMessage
          if (
            (data.type === 'turnDeadline' ||
              data.type === 'matchAbandoned' ||
              data.type === 'matchAborted' ||
              data.type === 'matchExpired' ||
              data.type === 'matchUnavailable' ||
              data.type === 'matchData' ||
              data.type === 'readyState' ||
              data.type === 'hostChanged' ||
              data.type === 'matchResumed' ||
              data.type === 'playerLeft' ||
              data.type === 'playerJoined' ||
              data.type === 'kicked' ||
              data.type === 'playerReplaced' ||
              data.type === 'playerRejoined' ||
              data.type === 'replaced' ||
              data.type === 'settingsChanged' ||
              data.type === 'botSeats' ||
              data.type === 'stamp') &&
            typeof window !== 'undefined' &&
            window.parent !== window
          ) {
            window.parent.postMessage(data, this.shellOrigin);
          }
          // Stop reconnecting for terminal or explicitly unavailable states: the DO
          // closes the socket right after these, and retrying cannot recover this
          // client (kicked seats also fail /ws-auth re-issue).
          if (
            data.type === 'matchExpired' ||
            (data.type === 'matchUnavailable' && data.reason === 'maintenance') ||
            data.type === 'replaced' ||
            data.type === 'kicked'
          ) {
            this.intentionalDisconnect = true;
          }
          this.notifyClient(data);
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    this.ws.onclose = () => {
      this.setConnectionStatus(false);
      if (!this.intentionalDisconnect) {
        // Tickets are short-lived connection proofs; by the time an unexpected close
        // happens the current one has usually expired. Ask the shell for a fresh ticket
        // so the next backoff attempt can reconnect instead of burning all attempts.
        this.requestTicketRefresh();
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (e) => {
      console.error('WebSocket error:', e);
    };
  }

  private requestTicketRefresh(): void {
    if (!this.ticket) return;
    if (typeof window === 'undefined' || window.parent === window) return;
    window.parent.postMessage({ type: 'ticketRefreshRequest' }, this.shellOrigin);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    if (this.reconnectAttempt >= WebSocketTransport.MAX_RECONNECT_ATTEMPTS) {
      this.reconnectFailedNotified = true;
      if (typeof window !== 'undefined' && window.parent !== window) {
        window.parent.postMessage({ type: 'reconnectFailed' }, this.shellOrigin);
      }
      this.notifyClient({ type: 'reconnectFailed' } as any);
      return;
    }
    const delay = Math.min(
      WebSocketTransport.INITIAL_DELAY *
        Math.pow(WebSocketTransport.BACKOFF_FACTOR, this.reconnectAttempt),
      WebSocketTransport.MAX_DELAY,
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.ws) {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
        this.ws = null;
      }
      this.setupWebSocket();
    }, delay);
  }

  connect(): void {
    this.disconnect();
    this.intentionalDisconnect = false;
    this.setupWebSocket();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionStatus(false);
  }

  sendAction(state: State, action: CredentialedActionShape.Any): void {
    this.send({
      type: 'update',
      matchID: this.matchID,
      playerID: this.playerID,
      action,
      stateID: state._stateID,
    });
  }

  sendChatMessage(matchID: string, chatMessage: ChatMessage): void {
    this.send({
      type: 'chat',
      matchID,
      playerID: this.playerID,
      chatMessage,
    });
  }

  requestSync(): void {
    this.send({
      type: 'sync',
      matchID: this.matchID,
      playerID: this.playerID,
      credentials: this.credentials,
      numPlayers: this.numPlayers,
    });
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
    this.requestSync();
  }

  /**
   * Swap in a freshly issued ticket (shell → iframe `ticketRefresh` message).
   * If a reconnect is already scheduled or a socket is live, the next attempt picks
   * the ticket up via buildURL. If the transport had given up (attempts exhausted —
   * e.g. the shell's /ws-auth call was slow to settle), the fresh ticket is the
   * signal to start over; otherwise a late ticket would never reconnect.
   */
  updateTicket(ticket: string): void {
    this.ticket = ticket;
    const socketActive =
      this.ws !== null &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING);
    if (!this.intentionalDisconnect && !socketActive && this.reconnectTimer === null) {
      this.connect();
    }
  }
}

/**
 * Create a remote WebSocket transport.
 * Usage: Client({ ..., multiplayer: Remote({ server: 'https://example.com' }) })
 */
export function Remote({ server, shellOrigin, ticket }: RemoteOpts) {
  return (transportOpts: TransportOpts) =>
    new WebSocketTransport({ server, shellOrigin, ticket, ...transportOpts });
}
