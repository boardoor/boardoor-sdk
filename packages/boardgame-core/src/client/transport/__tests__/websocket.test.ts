import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { TransportOpts } from '../transport';
import { WebSocketTransport, Remote } from '../websocket';

// --- MockWebSocket ---

const wsInstances: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Set to false to prevent auto-open (for reconnection tests). */
  static autoOpen = true;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  sent: string[] = [];
  closed = false;

  constructor(url: string | URL) {
    this.url = typeof url === 'string' ? url : url.toString();
    wsInstances.push(this);
    // Auto-open on next microtask (unless disabled)
    if (MockWebSocket.autoOpen) {
      queueMicrotask(() => {
        if (this.readyState === MockWebSocket.CONNECTING) {
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.(new Event('open'));
        }
      });
    }
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
  }

  /** Simulate receiving a message from the server. */
  _receive(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  /** Manually trigger onopen (used when autoOpen is false). */
  _open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  /** Simulate a server-initiated close (triggers onclose without going through close()). */
  _serverClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ type: 'close' } as CloseEvent);
  }
}

// --- Test helpers ---

function createTransportOpts(overrides?: Partial<TransportOpts>): TransportOpts {
  return {
    transportDataCallback: vi.fn(),
    gameName: 'hearts',
    gameKey: {} as TransportOpts['gameKey'],
    game: {} as TransportOpts['game'],
    playerID: '0',
    matchID: 'match-1',
    credentials: 'secret',
    numPlayers: 4,
    ...overrides,
  };
}

function createTransport(
  server = 'https://game.example.com',
  overrides?: Partial<TransportOpts>,
  remoteOverrides?: { ticket?: string },
) {
  const opts = createTransportOpts(overrides);
  const transport = new WebSocketTransport({ server, ticket: remoteOverrides?.ticket, ...opts });
  return { transport, opts };
}

function getLastWS(): MockWebSocket {
  return wsInstances[wsInstances.length - 1];
}

/** Flush microtask queue so MockWebSocket onopen fires. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// --- Tests ---

describe('WebSocketTransport', () => {
  let originalWebSocket: typeof globalThis.WebSocket;
  let originalWindow: unknown;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    originalWindow = (globalThis as unknown as { window?: unknown }).window;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    wsInstances.length = 0;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  // Test 1: URL construction
  describe('URL construction', () => {
    it('converts https to wss', () => {
      const { transport } = createTransport('https://game.example.com');
      transport.connect();

      const ws = getLastWS();
      expect(ws.url).toBe('wss://game.example.com/ws/hearts/match-1?playerID=0');
      transport.disconnect();
    });

    it('converts http to ws', () => {
      const { transport } = createTransport('http://localhost:8787');
      transport.connect();

      const ws = getLastWS();
      expect(ws.url).toBe('ws://localhost:8787/ws/hearts/match-1?playerID=0');
      transport.disconnect();
    });

    it('preserves ws:// and wss:// protocols', () => {
      const { transport } = createTransport('wss://game.example.com');
      transport.connect();

      const ws = getLastWS();
      expect(ws.url).toBe('wss://game.example.com/ws/hearts/match-1?playerID=0');
      transport.disconnect();
    });

    it('defaults to wss:// for bare hostnames', () => {
      const { transport } = createTransport('game.example.com');
      transport.connect();

      const ws = getLastWS();
      expect(ws.url).toBe('wss://game.example.com/ws/hearts/match-1?playerID=0');
      transport.disconnect();
    });

    it('strips trailing slash from server URL', () => {
      const { transport } = createTransport('https://game.example.com/');
      transport.connect();

      const ws = getLastWS();
      expect(ws.url).toBe('wss://game.example.com/ws/hearts/match-1?playerID=0');
      transport.disconnect();
    });

    it('never puts raw credentials in the URL (ticket is the only connection proof)', () => {
      const { transport } = createTransport('https://game.example.com');
      transport.connect();

      const ws = getLastWS();
      expect(ws.url).not.toContain('credentials');
      transport.disconnect();
    });

    it('puts the ticket in the URL', () => {
      const { transport } = createTransport('https://game.example.com', undefined, {
        ticket: 'signed-token',
      });
      transport.connect();

      const ws = getLastWS();
      expect(ws.url).toBe(
        'wss://game.example.com/ws/hearts/match-1?playerID=0&ticket=signed-token',
      );
      expect(ws.url).not.toContain('credentials=secret');
      transport.disconnect();
    });

    it('omits credentials from URL when none are set', () => {
      const { transport } = createTransport('https://game.example.com', { credentials: undefined });
      transport.connect();

      const ws = getLastWS();
      expect(ws.url).toBe('wss://game.example.com/ws/hearts/match-1?playerID=0');
      transport.disconnect();
    });
  });

  it('does not forward match-room chat messages to the shell window', async () => {
    const postMessage = vi.fn();
    const parent = { postMessage };
    (globalThis as unknown as { window: unknown }).window = { parent };
    const { transport } = createTransport('https://game.example.com', undefined, {
      ticket: 'signed-token',
    });
    transport.connect();
    await flush();
    const message = {
      type: 'matchRoomChatMessage',
      threadId: 'thread-1',
      messageId: 'message-1',
      senderUserId: 'user-2',
      senderName: 'Alice',
      preview: 'hello',
      createdAt: 123,
    };

    getLastWS()._receive(JSON.stringify(message));

    expect(postMessage).not.toHaveBeenCalled();
    transport.disconnect();
  });

  // Test 2: Connection lifecycle
  it('sets connection status to true on open', async () => {
    const { transport } = createTransport();
    const statusCallback = vi.fn();
    transport.subscribeToConnectionStatus(statusCallback);

    transport.connect();
    await flush();

    expect(transport.isConnected).toBe(true);
    expect(statusCallback).toHaveBeenCalled();
    transport.disconnect();
  });

  // Test 3: Disconnect lifecycle
  it('sets connection status to false on disconnect', async () => {
    const { transport } = createTransport();
    transport.connect();
    await flush();
    expect(transport.isConnected).toBe(true);

    transport.disconnect();
    expect(transport.isConnected).toBe(false);
  });

  // Test 4: Initial sync on connect
  it('sends sync message on connect', async () => {
    const { transport } = createTransport();
    transport.connect();
    const ws = getLastWS();
    await flush();

    const syncMsg = ws.sent.find((s) => {
      const parsed = JSON.parse(s);
      return parsed.type === 'sync';
    });
    expect(syncMsg).toBeDefined();
    expect(JSON.parse(syncMsg!)).toEqual({
      type: 'sync',
      matchID: 'match-1',
      playerID: '0',
      credentials: 'secret',
      numPlayers: 4,
    });
    transport.disconnect();
  });

  // Test 5: sendAction serialization
  it('sends action in correct format', async () => {
    const { transport } = createTransport();
    transport.connect();
    const ws = getLastWS();
    await flush();

    const action = { type: 'MAKE_MOVE', payload: { type: 'playCard' } };
    const state = { _stateID: 3 } as any;
    transport.sendAction(state, action as any);

    const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(msg).toEqual({
      type: 'update',
      matchID: 'match-1',
      playerID: '0',
      action,
      stateID: 3,
    });
    transport.disconnect();
  });

  // Test 6: sendChatMessage serialization
  it('sends chat message in correct format', async () => {
    const { transport } = createTransport();
    transport.connect();
    const ws = getLastWS();
    await flush();

    const chatMessage = { id: '1', sender: '0', payload: 'hello' };
    transport.sendChatMessage('match-1', chatMessage as any);

    const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(msg).toEqual({
      type: 'chat',
      matchID: 'match-1',
      playerID: '0',
      chatMessage,
    });
    transport.disconnect();
  });

  // Tests 7-11: Receive various TransportData types
  describe('receiving messages', () => {
    it('handles update type', async () => {
      const callback = vi.fn();
      const { transport } = createTransport(undefined, {
        transportDataCallback: callback,
      });
      transport.connect();
      const ws = getLastWS();
      await flush();

      const data = { type: 'update', args: ['match-1', {}, []] };
      ws._receive(JSON.stringify(data));

      expect(callback).toHaveBeenCalledWith(data);
      transport.disconnect();
    });

    it('handles sync type', async () => {
      const callback = vi.fn();
      const { transport } = createTransport(undefined, {
        transportDataCallback: callback,
      });
      transport.connect();
      const ws = getLastWS();
      await flush();

      const data = { type: 'sync', args: ['match-1', {}] };
      ws._receive(JSON.stringify(data));

      expect(callback).toHaveBeenCalledWith(data);
      transport.disconnect();
    });

    it('handles patch type', async () => {
      const callback = vi.fn();
      const { transport } = createTransport(undefined, {
        transportDataCallback: callback,
      });
      transport.connect();
      const ws = getLastWS();
      await flush();

      const data = { type: 'patch', args: ['match-1', 0, 1, [], []] };
      ws._receive(JSON.stringify(data));

      expect(callback).toHaveBeenCalledWith(data);
      transport.disconnect();
    });

    it('handles matchData type', async () => {
      const callback = vi.fn();
      const { transport } = createTransport(undefined, {
        transportDataCallback: callback,
      });
      transport.connect();
      const ws = getLastWS();
      await flush();

      const data = { type: 'matchData', args: ['match-1', []] };
      ws._receive(JSON.stringify(data));

      expect(callback).toHaveBeenCalledWith(data);
      transport.disconnect();
    });

    it('handles chat type', async () => {
      const callback = vi.fn();
      const { transport } = createTransport(undefined, {
        transportDataCallback: callback,
      });
      transport.connect();
      const ws = getLastWS();
      await flush();

      const data = {
        type: 'chat',
        args: ['match-1', { id: '1', sender: '0', payload: 'hi' }],
      };
      ws._receive(JSON.stringify(data));

      expect(callback).toHaveBeenCalledWith(data);
      transport.disconnect();
    });
  });

  // Test 12: Error response ignored
  it('ignores error responses from server', async () => {
    const callback = vi.fn();
    const { transport } = createTransport(undefined, {
      transportDataCallback: callback,
    });
    transport.connect();
    const ws = getLastWS();
    await flush();

    ws._receive(JSON.stringify({ error: 'room not initialized' }));

    expect(callback).not.toHaveBeenCalled();
    transport.disconnect();
  });

  // Test 13: Invalid JSON ignored
  it('ignores non-JSON messages without throwing', async () => {
    const callback = vi.fn();
    const { transport } = createTransport(undefined, {
      transportDataCallback: callback,
    });
    transport.connect();
    const ws = getLastWS();
    await flush();

    expect(() => ws._receive('not-json{{')).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
    transport.disconnect();
  });

  // Test 14: Send when not connected
  it('does not throw when sending without a connection', () => {
    const { transport } = createTransport();
    // Not connected, ws is null
    expect(() => transport.sendAction({ _stateID: 0 } as any, {} as any)).not.toThrow();
    expect(() => transport.sendChatMessage('match-1', {} as any)).not.toThrow();
    expect(() => transport.requestSync()).not.toThrow();
  });

  // Test 15: updateMatchID reconnects with new URL
  it('reconnects with new URL on updateMatchID', async () => {
    const { transport } = createTransport();
    transport.connect();
    const ws1 = getLastWS();
    await flush();

    expect(ws1.url).toContain('match-1');

    transport.updateMatchID('match-2');
    const ws2 = getLastWS();

    expect(ws1.closed).toBe(true);
    expect(ws2.url).toContain('match-2');
    expect(ws2).not.toBe(ws1);
    transport.disconnect();
  });

  // Test 16: updateCredentials does not reconnect
  it('does not reconnect on updateCredentials, only sends sync', async () => {
    const { transport } = createTransport();
    transport.connect();
    const ws = getLastWS();
    await flush();

    const sentBefore = ws.sent.length;
    transport.updateCredentials('new-cred');

    // Same WS instance (not reconnected)
    expect(wsInstances).toHaveLength(1);
    expect(ws.closed).toBe(false);

    // A sync was sent
    const newMessages = ws.sent.slice(sentBefore);
    expect(newMessages).toHaveLength(1);
    expect(JSON.parse(newMessages[0]).type).toBe('sync');
    transport.disconnect();
  });

  // Auto-reconnection
  describe('auto-reconnection', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      MockWebSocket.autoOpen = false;
    });

    afterEach(() => {
      MockWebSocket.autoOpen = true;
      vi.useRealTimers();
    });

    it('schedules reconnection after unexpected close', () => {
      const { transport } = createTransport();
      transport.connect();
      const ws1 = getLastWS();
      ws1._open();

      expect(transport.isConnected).toBe(true);

      // Simulate server-initiated close
      ws1._serverClose();
      expect(transport.isConnected).toBe(false);

      // No new WS yet
      expect(wsInstances).toHaveLength(1);

      // After 1s, a new WS should be created
      vi.advanceTimersByTime(1000);
      expect(wsInstances).toHaveLength(2);

      const ws2 = getLastWS();
      ws2._open();
      expect(transport.isConnected).toBe(true);
      transport.disconnect();
    });

    it('resets backoff on successful reconnection', () => {
      const { transport } = createTransport();
      transport.connect();
      const ws1 = getLastWS();
      ws1._open();

      // First disconnect
      ws1._serverClose();
      vi.advanceTimersByTime(1000);
      const ws2 = getLastWS();
      ws2._open(); // successful reconnect → backoff resets

      // Second disconnect
      ws2._serverClose();
      // Should schedule at 1s (not 2s) because backoff was reset
      vi.advanceTimersByTime(999);
      expect(wsInstances).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(wsInstances).toHaveLength(3);

      getLastWS()._open();
      transport.disconnect();
    });

    it('does not reconnect after intentional disconnect()', () => {
      const { transport } = createTransport();
      transport.connect();
      const ws1 = getLastWS();
      ws1._open();

      transport.disconnect();
      expect(transport.isConnected).toBe(false);

      // Advance well past any reconnection delay
      vi.advanceTimersByTime(60000);
      expect(wsInstances).toHaveLength(1);
    });

    it('does not reconnect after receiving replaced terminal state', () => {
      const { transport } = createTransport();
      transport.connect();
      const ws1 = getLastWS();
      ws1._open();

      ws1._receive(JSON.stringify({ type: 'replaced' }));
      ws1._serverClose();

      expect(transport.isConnected).toBe(false);
      vi.advanceTimersByTime(60000);
      expect(wsInstances).toHaveLength(1);
    });

    it('does not reconnect or request a ticket refresh after being kicked', () => {
      const postMessage = vi.fn();
      (globalThis as unknown as { window: unknown }).window = { parent: { postMessage } };
      const { transport } = createTransport('https://game.example.com', undefined, {
        ticket: 'signed-token',
      });
      transport.connect();
      const ws1 = getLastWS();
      ws1._open();

      ws1._receive(JSON.stringify({ type: 'kicked' }));
      ws1._serverClose();

      expect(transport.isConnected).toBe(false);
      vi.advanceTimersByTime(60000);
      expect(wsInstances).toHaveLength(1);
      expect(postMessage).not.toHaveBeenCalledWith(
        { type: 'ticketRefreshRequest' },
        expect.anything(),
      );
    });

    it('forwards maintenance unavailability and does not reconnect after the server closes', () => {
      const postMessage = vi.fn();
      (globalThis as unknown as { window: unknown }).window = { parent: { postMessage } };
      const callback = vi.fn();
      const { transport } = createTransport(
        'https://game.example.com',
        { transportDataCallback: callback },
        { ticket: 'signed-token' },
      );
      transport.connect();
      const ws1 = getLastWS();
      ws1._open();
      const message = { type: 'matchUnavailable', reason: 'maintenance' };

      ws1._receive(JSON.stringify(message));
      ws1._serverClose();

      expect(postMessage).toHaveBeenCalledWith(message, 'https://boardoor.com');
      expect(callback).toHaveBeenCalledWith(message);
      vi.advanceTimersByTime(60000);
      expect(wsInstances).toHaveLength(1);
      expect(postMessage).not.toHaveBeenCalledWith(
        { type: 'ticketRefreshRequest' },
        expect.anything(),
      );
    });

    it('does not suppress recovery for an unrecognized unavailable reason', () => {
      const postMessage = vi.fn();
      (globalThis as unknown as { window: unknown }).window = { parent: { postMessage } };
      const { transport } = createTransport('https://game.example.com', undefined, {
        ticket: 'signed-token',
      });
      transport.connect();
      const ws1 = getLastWS();
      ws1._open();

      ws1._receive(JSON.stringify({ type: 'matchUnavailable', reason: 'future-reason' }));
      ws1._serverClose();

      expect(postMessage).toHaveBeenCalledWith(
        { type: 'ticketRefreshRequest' },
        'https://boardoor.com',
      );
      vi.advanceTimersByTime(1000);
      expect(wsInstances).toHaveLength(2);
      transport.disconnect();
    });

    it('cancels pending reconnect timer on disconnect()', () => {
      const { transport } = createTransport();
      transport.connect();
      const ws1 = getLastWS();
      ws1._open();

      // Trigger reconnect schedule
      ws1._serverClose();
      // Timer is now pending (1s)

      // Disconnect before timer fires
      transport.disconnect();

      // Advance past the scheduled time
      vi.advanceTimersByTime(2000);
      // No new WS should have been created
      expect(wsInstances).toHaveLength(1);
    });

    it('applies exponential backoff with max cap', () => {
      const { transport } = createTransport();
      transport.connect();
      let ws = getLastWS();
      ws._open();

      const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];

      for (const delay of expectedDelays) {
        ws._serverClose();
        const countBefore = wsInstances.length;
        vi.advanceTimersByTime(delay - 1);
        expect(wsInstances).toHaveLength(countBefore);
        vi.advanceTimersByTime(1);
        expect(wsInstances).toHaveLength(countBefore + 1);

        ws = getLastWS();
        // Don't open → next iteration will still use growing backoff
      }

      transport.disconnect();
    });

    it('prevents double scheduling when onclose fires twice', () => {
      const { transport } = createTransport();
      transport.connect();
      const ws1 = getLastWS();
      ws1._open();

      // Fire onclose twice
      ws1._serverClose();
      ws1.onclose?.({ type: 'close' } as CloseEvent);

      // Only one reconnect should happen
      vi.advanceTimersByTime(1000);
      expect(wsInstances).toHaveLength(2);

      // No extra WS after more time
      vi.advanceTimersByTime(5000);
      expect(wsInstances).toHaveLength(2);

      transport.disconnect();
    });
  });

  // Remote() factory
  describe('ticket refresh', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      MockWebSocket.autoOpen = false;
    });

    afterEach(() => {
      MockWebSocket.autoOpen = true;
      vi.useRealTimers();
    });

    function withParentWindow() {
      const postMessage = vi.fn();
      (globalThis as unknown as { window: unknown }).window = { parent: { postMessage } };
      return postMessage;
    }

    it('requests a ticket refresh from the shell on unexpected close', () => {
      const postMessage = withParentWindow();
      const { transport } = createTransport('https://game.example.com', undefined, {
        ticket: 'signed-token',
      });
      transport.connect();
      getLastWS()._open();

      getLastWS()._serverClose();

      expect(postMessage).toHaveBeenCalledWith(
        { type: 'ticketRefreshRequest' },
        'https://boardoor.com',
      );
      transport.disconnect();
    });

    it('does not request a refresh without a ticket or on intentional disconnect', () => {
      const postMessage = withParentWindow();

      const withoutTicket = createTransport('https://game.example.com').transport;
      withoutTicket.connect();
      getLastWS()._open();
      getLastWS()._serverClose();
      withoutTicket.disconnect();

      const intentional = createTransport('https://game.example.com', undefined, {
        ticket: 'signed-token',
      }).transport;
      intentional.connect();
      getLastWS()._open();
      intentional.disconnect();

      expect(postMessage).not.toHaveBeenCalledWith(
        { type: 'ticketRefreshRequest' },
        expect.anything(),
      );
    });

    it('reconnects with the fresh ticket after updateTicket', () => {
      withParentWindow();
      const { transport } = createTransport('https://game.example.com', undefined, {
        ticket: 'old-token',
      });
      transport.connect();
      getLastWS()._open();
      getLastWS()._serverClose();

      // A reconnect is already scheduled: updateTicket must stay passive and let
      // the pending backoff attempt pick the ticket up (no immediate extra socket).
      const socketsBeforeUpdate = wsInstances.length;
      transport.updateTicket('new-token');
      expect(wsInstances).toHaveLength(socketsBeforeUpdate);

      vi.advanceTimersByTime(1000);
      expect(getLastWS().url).toContain('ticket=new-token');
      transport.disconnect();
    });

    function exhaustReconnectAttempts(dataCallback: ReturnType<typeof vi.fn>) {
      while (!dataCallback.mock.calls.some(([data]) => data?.type === 'reconnectFailed')) {
        vi.advanceTimersByTime(30000);
        getLastWS()._serverClose();
      }
    }

    it('self-reconnects when a fresh ticket arrives after giving up, and withdraws the failure', () => {
      withParentWindow();
      const { transport, opts } = createTransport('https://game.example.com', undefined, {
        ticket: 'old-token',
      });
      const dataCallback = opts.transportDataCallback as ReturnType<typeof vi.fn>;
      transport.connect();
      getLastWS()._open();
      getLastWS()._serverClose();
      exhaustReconnectAttempts(dataCallback);

      // Transport has given up: no timer pending, no socket activity on its own.
      const socketsAfterGivingUp = wsInstances.length;
      vi.advanceTimersByTime(60000);
      expect(wsInstances).toHaveLength(socketsAfterGivingUp);

      // A late ticketRefresh must restart the connection with the fresh ticket...
      transport.updateTicket('fresh-token');
      expect(wsInstances).toHaveLength(socketsAfterGivingUp + 1);
      expect(getLastWS().url).toContain('ticket=fresh-token');

      // ...and a successful open withdraws the reconnectFailed state (banner reset).
      getLastWS()._open();
      expect(dataCallback.mock.calls.some(([data]) => data?.type === 'reconnectRestored')).toBe(
        true,
      );
      transport.disconnect();
    });

    it('does not self-reconnect on updateTicket after an intentional disconnect', () => {
      withParentWindow();
      const { transport } = createTransport('https://game.example.com', undefined, {
        ticket: 'old-token',
      });
      transport.connect();
      getLastWS()._open();
      transport.disconnect();

      const socketsAfterDisconnect = wsInstances.length;
      transport.updateTicket('fresh-token');
      expect(wsInstances).toHaveLength(socketsAfterDisconnect);
    });
  });

  describe('Remote() factory', () => {
    it('returns a factory function that creates WebSocketTransport', () => {
      const factory = Remote({ server: 'https://game.example.com' });
      const opts = createTransportOpts();
      const transport = factory(opts);
      expect(transport).toBeInstanceOf(WebSocketTransport);
    });
  });
});
