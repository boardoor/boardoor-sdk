/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks ---

// Mock react-dom/client
const mockRender = vi.fn();
const mockUnmount = vi.fn();
const mockCreateRoot = vi.fn(() => ({ render: mockRender, unmount: mockUnmount }));
vi.mock('react-dom/client', () => ({
  createRoot: (...args: any[]) => mockCreateRoot(...args),
}));

const mockI18next = {
  language: 'en',
  isInitialized: false,
  resources: {} as Record<string, Record<string, string>>,
  use: vi.fn(() => mockI18next),
  init: vi.fn(async (options: any) => {
    mockI18next.resources = Object.fromEntries(
      Object.entries(options.resources ?? {}).map(([lng, bundle]) => [
        lng,
        (bundle as { translation?: Record<string, string> }).translation ?? {},
      ]),
    );
    mockI18next.language = options.lng ?? 'en';
    mockI18next.isInitialized = true;
    return mockI18next;
  }),
  addResourceBundle: vi.fn(
    (_lng: string, _ns: string, _resources: Record<string, string>, _deep?: boolean) => {},
  ),
  changeLanguage: vi.fn(async (lng: string) => {
    mockI18next.language = lng;
    return mockI18next;
  }),
  t: vi.fn((key: string, arg?: string | Record<string, unknown>) => {
    const params = typeof arg === 'object' && arg !== null ? arg : {};
    const defaultValue = typeof arg === 'string' ? arg : arg?.defaultValue;
    const template = mockI18next.resources[mockI18next.language]?.[key] ?? defaultValue ?? key;
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(params[name] ?? ''));
  }),
};
mockI18next.addResourceBundle.mockImplementation(
  (lng: string, _ns: string, resources: Record<string, string>) => {
    mockI18next.resources[lng] = {
      ...mockI18next.resources[lng],
      ...resources,
    };
  },
);
vi.mock('i18next', () => ({
  default: mockI18next,
}));
vi.mock('react-i18next', () => ({
  initReactI18next: {},
}));

// Mock Client
const mockStart = vi.fn();
const mockStop = vi.fn();
const mockSubscribe = vi.fn();
const mockClient = vi.fn(() => ({
  start: mockStart,
  stop: mockStop,
  subscribe: mockSubscribe,
  moves: {},
  getState: () => null,
}));
vi.mock('../../client/client', () => ({
  Client: (...args: any[]) => mockClient(...args),
}));

// Mock transports
const mockLocal = vi.fn(() => 'local-transport');
const mockUpdateTicket = vi.fn();
const mockWsTransport = { updateTicket: mockUpdateTicket };
const mockRemoteTransportFactory = vi.fn(() => mockWsTransport);
const mockRemote = vi.fn(() => mockRemoteTransportFactory);
vi.mock('../../client/transport/local', () => ({
  Local: (...args: any[]) => mockLocal(...args),
}));
vi.mock('../../client/transport/websocket', () => ({
  Remote: (...args: any[]) => mockRemote(...args),
}));

// Mock AI
vi.mock('../../ai', () => ({
  RandomBot: class MockRandomBot {},
  MCTSBot: class MockMCTSBot {},
}));

// --- Test helpers ---

const TEST_SHELL_ORIGIN = 'http://test-shell.example.com';

function makeDummyGame(overrides: Record<string, any> = {}) {
  return { name: 'TestGame', ...overrides };
}

function DummyBoard() {
  return null;
}

function setupAppRoot() {
  const el = document.createElement('div');
  el.id = 'app';
  document.body.appendChild(el);
}

function setupCustomRoot(id: string) {
  const el = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
}

// --- Tests ---

describe('createGameApp', () => {
  let originalParent: typeof window.parent;
  let originalLocation: Location;
  const messageListeners: EventListener[] = [];
  const pagehideListeners: EventListener[] = [];
  // error / unhandledrejection listeners come from installClientErrorReporter (F139);
  // track them so iframe-mode tests don't leak a global handler into later tests.
  const globalErrorListeners: Array<[string, EventListener]> = [];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.textContent = '';
    setupAppRoot();
    originalParent = Object.getOwnPropertyDescriptor(window, 'parent')?.value;
    originalLocation = window.location;
    mockI18next.language = 'en';
    mockI18next.isInitialized = false;
    mockI18next.resources = {};
    document.cookie = 'lng=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';

    // Track message and pagehide listeners for cleanup between tests
    const origAddEventListener = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (type: string, listener: any, ...rest: any[]) => {
        if (type === 'message') messageListeners.push(listener);
        if (type === 'pagehide') pagehideListeners.push(listener);
        if (type === 'error' || type === 'unhandledrejection') {
          globalErrorListeners.push([type, listener]);
        }
        return origAddEventListener(type, listener, ...rest);
      },
    );
  });

  afterEach(() => {
    // Remove accumulated listeners
    for (const listener of messageListeners) {
      window.removeEventListener('message', listener);
    }
    messageListeners.length = 0;
    for (const listener of pagehideListeners) {
      window.removeEventListener('pagehide', listener);
    }
    pagehideListeners.length = 0;
    for (const [type, listener] of globalErrorListeners) {
      window.removeEventListener(type, listener);
    }
    globalErrorListeners.length = 0;

    Object.defineProperty(window, 'parent', {
      value: originalParent,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  function setLocation(search: string) {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, search, href: `http://localhost${search}` },
      writable: true,
      configurable: true,
    });
  }

  function setParentSame() {
    Object.defineProperty(window, 'parent', {
      value: window,
      writable: true,
      configurable: true,
    });
  }

  function setParentDifferent() {
    const fakeParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', {
      value: fakeParent,
      writable: true,
      configurable: true,
    });
    return fakeParent;
  }

  describe('mode detection', () => {
    it('enters online mode with URL params', async () => {
      setLocation('?server=http://server.example.com&matchID=m1&playerID=0&ticket=tok');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      expect(mockClient).toHaveBeenCalledTimes(1);
      expect(mockRemote).toHaveBeenCalledWith({
        server: 'http://server.example.com',
        shellOrigin: TEST_SHELL_ORIGIN,
        ticket: 'tok',
      });
      expect(mockClient).toHaveBeenCalledWith(
        expect.objectContaining({
          matchID: 'm1',
          playerID: '0',
          credentials: '',
          debug: false,
        }),
      );
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(mockCreateRoot).toHaveBeenCalledTimes(1);
    });

    it('rejects credentials-only online URLs before starting a doomed transport', async () => {
      setLocation('?server=http://server.example.com&matchID=m1&playerID=0&credentials=cred');
      setParentSame();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      expect(mockClient).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(document.getElementById('app')!.textContent).toContain('ticket');
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('rejects legacy wsToken-only online URLs before starting a doomed transport', async () => {
      setLocation('?server=http://server.example.com&matchID=m1&playerID=0&wsToken=legacy');
      setParentSame();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      expect(mockClient).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
      expect(document.getElementById('app')!.textContent).toContain('ticket');
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('enters iframe mode when parent !== window and no URL params', async () => {
      setLocation('');
      const fakeParent = setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      expect(fakeParent.postMessage).toHaveBeenCalledWith({ type: 'ready' }, TEST_SHELL_ORIGIN);
      expect(mockClient).not.toHaveBeenCalled();
    });

    it('enters local dev mode when not iframe and no URL params', async () => {
      setLocation('');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ minPlayers: 3, maxPlayers: 4 }),
        board: DummyBoard,
      });

      // maxPlayers=4 → 4 player clients + 1 debug client = 5
      expect(mockClient).toHaveBeenCalledTimes(5);
      expect(mockLocal).toHaveBeenCalledTimes(1);
      expect(mockStart).toHaveBeenCalledTimes(5);
      expect(mockCreateRoot).toHaveBeenCalledTimes(1);
      const rendered = mockRender.mock.calls[0][0] as any;
      const boundary = rendered.props.children;
      expect(boundary.type.name).toBe('GameRenderErrorBoundary');
      expect(boundary.props.children.type).toBe(DummyBoard);
    });

    it('uses Remote in local dev mode when serverUrl is provided', async () => {
      setLocation('');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame(),
        board: DummyBoard,
        serverUrl: 'http://localhost:8787',
      });

      expect(mockRemote).toHaveBeenCalledWith({ server: 'http://localhost:8787' });
      expect(mockLocal).not.toHaveBeenCalled();
    });
  });

  describe('client error reporter (F139)', () => {
    function runPagehideCleanup() {
      for (const listener of pagehideListeners) {
        listener(new Event('pagehide'));
      }
    }

    function clientErrorCalls(fakeParent: { postMessage: ReturnType<typeof vi.fn> }) {
      return fakeParent.postMessage.mock.calls.filter(
        ([msg]) => (msg as { type?: string })?.type === 'clientError',
      );
    }

    it('forwards an unhandled iframe error to the shell as clientError', async () => {
      setLocation('');
      const fakeParent = setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      window.dispatchEvent(
        new ErrorEvent('error', { message: 'boom', filename: 'http://game.example.com/app.js' }),
      );

      const calls = clientErrorCalls(fakeParent);
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toMatchObject({
        type: 'clientError',
        message: 'boom',
        source: 'http://game.example.com/app.js',
      });
      expect(calls[0][1]).toBe(TEST_SHELL_ORIGIN);

      runPagehideCleanup();
    });

    it('forwards unhandled promise rejections and dedupes identical errors', async () => {
      setLocation('');
      const fakeParent = setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      window.dispatchEvent(new ErrorEvent('error', { message: 'dup', filename: 'a.js' }));
      window.dispatchEvent(new ErrorEvent('error', { message: 'dup', filename: 'a.js' }));
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: Promise.reject(new Error('nope')).catch(() => undefined) as Promise<never>,
          reason: new Error('nope'),
        }),
      );

      const calls = clientErrorCalls(fakeParent);
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toMatchObject({ type: 'clientError', message: 'dup' });
      expect(calls[1][0]).toMatchObject({
        type: 'clientError',
        message: 'Unhandled rejection: nope',
      });

      runPagehideCleanup();
    });

    it('does not install the reporter outside an iframe', async () => {
      setLocation('');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard });

      const addedErrorListener = (
        window.addEventListener as ReturnType<typeof vi.fn>
      ).mock.calls.some(([type]) => type === 'error');
      expect(addedErrorListener).toBe(false);
    });
  });

  describe('numPlayers resolution', () => {
    it('uses maxPlayers as default when no numPlayers param', async () => {
      setLocation('');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ minPlayers: 3, maxPlayers: 6 }),
        board: DummyBoard,
      });

      // maxPlayers=6 → 6 player clients + 1 debug = 7
      expect(mockClient).toHaveBeenCalledTimes(7);
      expect(mockClient).toHaveBeenCalledWith(expect.objectContaining({ numPlayers: 6 }));
    });

    it('clamps numPlayers from URL param to max', async () => {
      setLocation('?numPlayers=10');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ minPlayers: 3, maxPlayers: 6 }),
        board: DummyBoard,
      });

      expect(mockClient).toHaveBeenCalledWith(expect.objectContaining({ numPlayers: 6 }));
    });

    it('clamps numPlayers below min', async () => {
      setLocation('?numPlayers=1');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ minPlayers: 3, maxPlayers: 6 }),
        board: DummyBoard,
      });

      expect(mockClient).toHaveBeenCalledWith(expect.objectContaining({ numPlayers: 3 }));
    });

    it('uses explicit numPlayers option over URL param', async () => {
      setLocation('?numPlayers=5');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ minPlayers: 3, maxPlayers: 6 }),
        board: DummyBoard,
        numPlayers: 4,
      });

      expect(mockClient).toHaveBeenCalledWith(expect.objectContaining({ numPlayers: 4 }));
    });

    it('defaults to 2 when game has no minPlayers/maxPlayers', async () => {
      setLocation('');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard });

      // min=2, max=2, fallback=2 → 2 player clients + 1 debug = 3
      expect(mockClient).toHaveBeenCalledTimes(3);
    });
  });

  describe('postMessage protocol', () => {
    it('starts online client on init message in iframe mode', async () => {
      setLocation('');
      setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      const initMsg = {
        type: 'init',
        serverUrl: 'http://server.example.com',
        matchID: 'match1',
        playerID: '2',
        ticket: 'signed-ticket',
      };
      expect(initMsg).not.toHaveProperty('credentials');
      window.dispatchEvent(
        new MessageEvent('message', { data: initMsg, origin: TEST_SHELL_ORIGIN }),
      );

      expect(mockClient).toHaveBeenCalledTimes(1);
      expect(mockRemote).toHaveBeenCalledWith({
        server: 'http://server.example.com',
        shellOrigin: TEST_SHELL_ORIGIN,
        ticket: 'signed-ticket',
      });
      expect(mockClient).toHaveBeenCalledWith(
        expect.objectContaining({
          matchID: 'match1',
          playerID: '2',
          credentials: '',
        }),
      );
    });

    it('rejects iframe init messages with an empty ticket', async () => {
      setLocation('');
      const fakeParent = setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'init',
            serverUrl: 'http://server.example.com',
            matchID: 'match1',
            playerID: '2',
            ticket: '',
          },
          origin: TEST_SHELL_ORIGIN,
        }),
      );

      expect(mockClient).not.toHaveBeenCalled();
      expect(mockRemote).not.toHaveBeenCalled();
      expect(document.getElementById('app')!.textContent).toContain('ticket');
      expect(fakeParent.postMessage).toHaveBeenCalledWith(
        { type: 'error', message: 'Invalid init message: ticket is required' },
        TEST_SHELL_ORIGIN,
      );
    });

    it('passes shell ticket refresh messages to the websocket transport', async () => {
      setLocation('');
      setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'init',
            serverUrl: 'http://server.example.com',
            matchID: 'match1',
            playerID: '2',
            ticket: 'ticket-1',
          },
          origin: TEST_SHELL_ORIGIN,
        }),
      );
      const multiplayer = mockClient.mock.calls[0][0].multiplayer;
      multiplayer({ transportDataCallback: vi.fn() });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ticketRefresh', ticket: 'ticket-2' },
          origin: TEST_SHELL_ORIGIN,
        }),
      );

      expect(mockUpdateTicket).toHaveBeenCalledWith('ticket-2');
    });

    it('ignores non-init messages in iframe mode', async () => {
      setLocation('');
      setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'other' }, origin: TEST_SHELL_ORIGIN }),
      );

      expect(mockClient).not.toHaveBeenCalled();
    });

    it('posts gameOver to parent when game ends (after gameOverVisible)', async () => {
      setLocation('?server=http://server.example.com&matchID=m1&playerID=0&ticket=tok');
      const fakeParent = setParentDifferent();

      mockSubscribe.mockImplementation((cb: any) => {
        cb({ ctx: { gameover: { winners: ['0'] } } });
      });

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      // delayGameOver is true by default — gameOver is not posted until GameOverOverlay fires
      expect(fakeParent.postMessage).not.toHaveBeenCalledWith(
        { type: 'gameOver', result: { winners: ['0'] } },
        TEST_SHELL_ORIGIN,
      );

      // Simulate GameOverOverlay becoming visible
      window.dispatchEvent(new Event('gameOverVisible'));

      expect(fakeParent.postMessage).toHaveBeenCalledWith(
        { type: 'gameOver', result: { winners: ['0'] } },
        TEST_SHELL_ORIGIN,
      );
    });

    it('ignores messages from wrong origin in iframe mode', async () => {
      setLocation('');
      setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      const initMsg = {
        type: 'init',
        serverUrl: 'http://attacker.example.com',
        matchID: 'x',
        playerID: '0',
        ticket: 'ticket-1',
      };
      window.dispatchEvent(
        new MessageEvent('message', { data: initMsg, origin: 'http://attacker.example.com' }),
      );

      expect(mockClient).not.toHaveBeenCalled();
    });

    it('processes messages from correct origin in iframe mode', async () => {
      setLocation('');
      setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      const initMsg = {
        type: 'init',
        serverUrl: 'http://server.example.com',
        matchID: 'match1',
        playerID: '0',
        ticket: 'ticket-1',
      };
      window.dispatchEvent(
        new MessageEvent('message', { data: initMsg, origin: TEST_SHELL_ORIGIN }),
      );

      expect(mockClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('debug option', () => {
    it('passes debug object to debug client in local mode', async () => {
      setLocation('');
      setParentSame();

      const debugImpl = { impl: 'MockDebug', collapseOnLoad: true };

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame(),
        board: DummyBoard,
        debug: debugImpl,
      });

      const lastCall = mockClient.mock.calls[mockClient.mock.calls.length - 1];
      expect(lastCall[0].debug).toEqual(debugImpl);
    });

    it('passes collapseOnLoad when debug=true', async () => {
      setLocation('');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame(),
        board: DummyBoard,
        debug: true,
      });

      const lastCall = mockClient.mock.calls[mockClient.mock.calls.length - 1];
      expect(lastCall[0].debug).toEqual({ collapseOnLoad: true });
    });
  });

  describe('rootElement option', () => {
    it('uses custom root element', async () => {
      setLocation('');
      setParentSame();
      document.body.textContent = '';
      setupCustomRoot('custom-root');

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame(),
        board: DummyBoard,
        rootElement: 'custom-root',
      });

      expect(mockCreateRoot).toHaveBeenCalledWith(document.getElementById('custom-root'));
    });
  });

  describe('localInit message', () => {
    it('starts local AI mode on localInit message in iframe mode', async () => {
      setLocation('');
      setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ ai: { enumerate: () => [] } }),
        board: DummyBoard,
        shellOrigin: TEST_SHELL_ORIGIN,
      });

      const localInitMsg = {
        type: 'localInit',
        numPlayers: 4,
        aiStrength: 'weak',
        aiDelayMultiplier: 1.8,
      };
      window.dispatchEvent(
        new MessageEvent('message', { data: localInitMsg, origin: TEST_SHELL_ORIGIN }),
      );

      expect(mockClient).toHaveBeenCalledTimes(1);
      expect(mockLocal).toHaveBeenCalledTimes(1);
      // Should pass bots to Local()
      expect(mockLocal).toHaveBeenCalledWith(
        expect.objectContaining({ bots: expect.any(Object), aiDelayMultiplier: 1.8 }),
      );
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(mockCreateRoot).toHaveBeenCalledTimes(1);
    });

    it('ignores localInit when no ai.enumerate', async () => {
      setLocation('');
      const fakeParent = setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame(), // no ai.enumerate
        board: DummyBoard,
        shellOrigin: TEST_SHELL_ORIGIN,
      });

      const localInitMsg = {
        type: 'localInit',
        numPlayers: 4,
        aiStrength: 'weak',
      };
      window.dispatchEvent(
        new MessageEvent('message', { data: localInitMsg, origin: TEST_SHELL_ORIGIN }),
      );

      expect(mockClient).not.toHaveBeenCalled();
      // Should post error to parent
      expect(fakeParent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
        TEST_SHELL_ORIGIN,
      );
    });

    it('does not react to localInit in online mode', async () => {
      setLocation('?server=http://server.example.com&matchID=m1&playerID=0&ticket=tok');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard });

      // Online mode, so no message listener for localInit
      expect(mockClient).toHaveBeenCalledTimes(1); // online client

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'localInit', numPlayers: 4, aiStrength: 'weak' },
        }),
      );

      // Still just 1 client
      expect(mockClient).toHaveBeenCalledTimes(1);
    });

    it('creates bots for seats 1..N-1 leaving seat 0 for human', async () => {
      setLocation('');
      setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ ai: { enumerate: () => [] } }),
        board: DummyBoard,
        shellOrigin: TEST_SHELL_ORIGIN,
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'localInit', numPlayers: 3, aiStrength: 'medium' },
          origin: TEST_SHELL_ORIGIN,
        }),
      );

      // Client should be created with a valid playerID (randomized seat)
      const clientArgs = mockClient.mock.calls[0][0];
      expect(clientArgs.numPlayers).toBe(3);
      const humanSeat = Number(clientArgs.playerID);
      expect(humanSeat).toBeGreaterThanOrEqual(0);
      expect(humanSeat).toBeLessThan(3);
      // Local should have bots for the other 2 seats
      const localArgs = mockLocal.mock.calls[0][0];
      const botKeys = Object.keys(localArgs.bots);
      expect(botKeys).toHaveLength(2);
      expect(botKeys).not.toContain(clientArgs.playerID);
    });

    it('uses local setup log config when player view omits logConfig', async () => {
      setLocation('');
      const fakeParent = setParentDifferent();

      mockClient.mockImplementationOnce(() => ({
        start: mockStart,
        stop: mockStop,
        subscribe: () => () => {},
        moves: {},
        matchData: [],
        getState: () => ({
          G: {
            gameLog: [
              {
                id: 'log-1',
                sequence: 1,
                turn: 1,
                publicMessageKey: 'log.move',
              },
            ],
            gameLogSequence: 1,
          },
          ctx: {},
        }),
      }));

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ ai: { enumerate: () => [] } }),
        board: DummyBoard,
        shellOrigin: TEST_SHELL_ORIGIN,
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'localInit',
            numPlayers: 2,
            aiStrength: 'weak',
            setupData: {
              _boardoor: {
                log: { enabled: true, level: 'detail' },
              },
            },
          },
          origin: TEST_SHELL_ORIGIN,
        }),
      );

      expect(fakeParent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'gameLogState',
          enabled: true,
          entries: expect.arrayContaining([
            expect.objectContaining({
              id: 'log-1',
              text: 'log.move',
            }),
          ]),
        }),
        TEST_SHELL_ORIGIN,
      );
    });

    it('refreshes i18n resources and language on a later local init', async () => {
      setLocation('');
      const gameWithLocales = makeDummyGame({
        ai: { enumerate: () => [] },
      });
      const locales = {
        en: { 'log.move': 'Move EN' },
        ja: { 'log.move': '移動 JA' },
      };

      mockClient.mockImplementationOnce(() => ({
        start: mockStart,
        stop: mockStop,
        subscribe: () => () => {},
        moves: {},
        matchData: [],
        getState: () => ({
          G: {
            gameLog: [
              {
                id: 'log-1',
                sequence: 1,
                turn: 1,
                publicMessageKey: 'log.move',
              },
            ],
            gameLogSequence: 1,
            logConfig: { enabled: true, level: 'action' },
          },
          ctx: {},
        }),
      }));

      const firstParent = setParentDifferent();
      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: gameWithLocales,
        board: DummyBoard,
        shellOrigin: TEST_SHELL_ORIGIN,
        locales,
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'localInit',
            numPlayers: 2,
            aiStrength: 'weak',
            language: 'en',
            setupData: {
              _boardoor: {
                log: { enabled: true, level: 'action' },
              },
            },
          },
          origin: TEST_SHELL_ORIGIN,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(firstParent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'gameLogState',
          entries: expect.arrayContaining([expect.objectContaining({ text: 'Move EN' })]),
        }),
        TEST_SHELL_ORIGIN,
      );
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));

      document.body.textContent = '';
      setupAppRoot();
      setLocation('');
      const secondParent = setParentDifferent();
      mockClient.mockImplementationOnce(() => ({
        start: mockStart,
        stop: mockStop,
        subscribe: () => () => {},
        moves: {},
        matchData: [],
        getState: () => ({
          G: {
            gameLog: [
              {
                id: 'log-1',
                sequence: 1,
                turn: 1,
                publicMessageKey: 'log.move',
              },
            ],
            gameLogSequence: 1,
            logConfig: { enabled: true, level: 'action' },
          },
          ctx: {},
        }),
      }));

      createGameApp({
        game: gameWithLocales,
        board: DummyBoard,
        shellOrigin: TEST_SHELL_ORIGIN,
        locales,
      });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'localInit',
            numPlayers: 2,
            aiStrength: 'weak',
            language: 'ja',
            setupData: {
              _boardoor: {
                log: { enabled: true, level: 'action' },
              },
            },
          },
          origin: TEST_SHELL_ORIGIN,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockI18next.changeLanguage).toHaveBeenCalledWith('ja');
      expect(secondParent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'gameLogState',
          entries: expect.arrayContaining([expect.objectContaining({ text: '移動 JA' })]),
        }),
        TEST_SHELL_ORIGIN,
      );
    });
  });

  describe('cleanup on pagehide', () => {
    it('removes message listener on pagehide (persisted=false) in iframe mode', async () => {
      setLocation('');
      setParentDifferent();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      // Simulate actual unload (not entering bfcache)
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));

      // After cleanup, init messages should not create clients
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'init',
            serverUrl: 'http://server.example.com',
            matchID: 'm',
            playerID: '0',
            ticket: 'ticket-1',
          },
          origin: TEST_SHELL_ORIGIN,
        }),
      );

      expect(mockClient).not.toHaveBeenCalled();
    });

    it('calls unmount on pagehide (persisted=false) after rendering', async () => {
      setLocation('?server=http://server.example.com&matchID=m1&playerID=0&ticket=tok');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      expect(mockCreateRoot).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));

      expect(mockUnmount).toHaveBeenCalledTimes(1);
    });

    it('skips cleanup on pagehide when persisted=true (entering bfcache)', async () => {
      setLocation('?server=http://server.example.com&matchID=m1&playerID=0&ticket=tok');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({ game: makeDummyGame(), board: DummyBoard, shellOrigin: TEST_SHELL_ORIGIN });

      // Simulate entering bfcache — cleanup must NOT run
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));

      expect(mockUnmount).not.toHaveBeenCalled();
      expect(mockStop).not.toHaveBeenCalled();

      // Simulate actual unload after bfcache restore — cleanup must run
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));

      expect(mockUnmount).toHaveBeenCalledTimes(1);
    });
  });

  describe('standalone preview mode', () => {
    it('local-ai mode starts with matching key', async () => {
      setLocation('?mode=local-ai&key=secret&strength=weak');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ ai: { enumerate: () => [] }, minPlayers: 3, maxPlayers: 4 }),
        board: DummyBoard,
        previewKey: 'secret',
      });

      // Should start local AI mode: 1 human client
      expect(mockClient).toHaveBeenCalledTimes(1);
      expect(mockLocal).toHaveBeenCalledTimes(1);
      expect(mockLocal).toHaveBeenCalledWith(expect.objectContaining({ bots: expect.any(Object) }));
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(mockCreateRoot).toHaveBeenCalledTimes(1);
    });

    it('local-ai mode defaults strength to medium', async () => {
      setLocation('?mode=local-ai&key=secret');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ ai: { enumerate: () => [] } }),
        board: DummyBoard,
        previewKey: 'secret',
      });

      // Should start (medium uses MCTSBot)
      expect(mockClient).toHaveBeenCalledTimes(1);
      expect(mockLocal).toHaveBeenCalledTimes(1);
    });

    it('local-hotseat mode starts with matching key', async () => {
      setLocation('?mode=local-hotseat&key=secret');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ minPlayers: 3, maxPlayers: 4 }),
        board: DummyBoard,
        previewKey: 'secret',
      });

      // maxPlayers=4 → 4 player clients + 1 debug client = 5
      expect(mockClient).toHaveBeenCalledTimes(5);
      expect(mockLocal).toHaveBeenCalledTimes(1);
      // Local() called without bots (hotseat), with optional setupData
      expect(mockLocal).toHaveBeenCalledWith({ setupData: undefined });
      expect(mockStart).toHaveBeenCalledTimes(5);
      expect(mockCreateRoot).toHaveBeenCalledTimes(1);
    });

    it('shows Access denied when key does not match', async () => {
      setLocation('?mode=local-ai&key=wrong');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ ai: { enumerate: () => [] } }),
        board: DummyBoard,
        previewKey: 'secret',
      });

      expect(mockClient).not.toHaveBeenCalled();
      expect(document.getElementById('app')!.textContent).toBe('Access denied');
    });

    it('shows Access denied when key is missing', async () => {
      setLocation('?mode=local-ai');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ ai: { enumerate: () => [] } }),
        board: DummyBoard,
        previewKey: 'secret',
      });

      expect(mockClient).not.toHaveBeenCalled();
      expect(document.getElementById('app')!.textContent).toBe('Access denied');
    });

    it('shows Access denied when previewKey is not configured', async () => {
      setLocation('?mode=local-ai&key=anything');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ ai: { enumerate: () => [] } }),
        board: DummyBoard,
        // no previewKey
      });

      expect(mockClient).not.toHaveBeenCalled();
      expect(document.getElementById('app')!.textContent).toBe('Access denied');
    });

    it('respects numPlayers URL parameter', async () => {
      setLocation('?mode=local-ai&key=secret&numPlayers=3');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame({ ai: { enumerate: () => [] }, minPlayers: 3, maxPlayers: 6 }),
        board: DummyBoard,
        previewKey: 'secret',
      });

      const clientArgs = mockClient.mock.calls[0][0];
      expect(clientArgs.numPlayers).toBe(3);
      // Bots for the other 2 seats (human seat is randomized)
      const localArgs = mockLocal.mock.calls[0][0];
      const botKeys = Object.keys(localArgs.bots);
      expect(botKeys).toHaveLength(2);
      expect(botKeys).not.toContain(clientArgs.playerID);
    });

    it('shows Access denied for unknown mode', async () => {
      setLocation('?mode=unknown&key=secret');
      setParentSame();

      const { createGameApp } = await import('../index.tsx');
      createGameApp({
        game: makeDummyGame(),
        board: DummyBoard,
        previewKey: 'secret',
      });

      expect(mockClient).not.toHaveBeenCalled();
      expect(document.getElementById('app')!.textContent).toBe('Access denied');
    });
  });
});
