import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BinanceWebSocketManager,
  type BinanceWebSocketOptions,
} from './BinanceWebSocket';

type SocketListener = (event?: { data?: unknown }) => void;

class FakeSocket {
  static instances: FakeSocket[] = [];

  readonly url: string;
  readyState = 0;
  readonly sent: string[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<string, SocketListener[]>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('send while socket is not open');
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }

  message(payload: unknown): void {
    this.emit('message', {
      data: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
  }

  emitClose(): void {
    this.readyState = 3;
    this.emit('close');
  }

  private emit(type: string, event?: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeTimers {
  private nextId = 1;
  private readonly tasks = new Map<
    number,
    { callback: () => void; delay: number }
  >();
  readonly delays: number[] = [];
  readonly cleared: number[] = [];

  setTimeout = (callback: () => void, delay: number): number => {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, { callback, delay });
    this.delays.push(delay);
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    const id = handle as number;
    this.cleared.push(id);
    this.tasks.delete(id);
  };

  get pendingDelays(): number[] {
    return Array.from(this.tasks.values()).map((task) => task.delay);
  }

  get ids(): number[] {
    return Array.from(this.tasks.keys());
  }

  runNext(): void {
    const entry = this.tasks.entries().next();
    if (entry.done) throw new Error('no pending timer');
    const [id, task] = entry.value;
    this.tasks.delete(id);
    task.callback();
  }
}

type Harness = {
  manager: BinanceWebSocketManager;
  timers: FakeTimers;
  publisher: ReturnType<typeof vi.fn>;
  setNow: (value: number) => void;
  advance: (ms: number) => void;
  now: () => number;
  socket: (index?: number) => FakeSocket;
};

function createHarness(
  overrides: Partial<BinanceWebSocketOptions> = {},
): Harness {
  FakeSocket.instances = [];
  const timers = new FakeTimers();
  let currentTime = 0;
  const publisher = vi.fn();

  const manager = new BinanceWebSocketManager({
    socketFactory: (url) => new FakeSocket(url) as unknown as WebSocket,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    now: () => currentTime,
    watchdogMs: 30_000,
    publishHealth: publisher,
    ...overrides,
  });

  return {
    manager,
    timers,
    publisher,
    now: () => currentTime,
    setNow(value) {
      currentTime = value;
    },
    advance(ms) {
      currentTime += ms;
    },
    socket(index = -1) {
      const sockets = FakeSocket.instances;
      const resolved = index < 0 ? sockets.length + index : index;
      const socket = sockets[resolved];
      if (!socket) throw new Error(`missing fake socket at ${index}`);
      return socket;
    },
  };
}

function parseSent(socket: FakeSocket, index = -1): unknown {
  const resolved = index < 0 ? socket.sent.length + index : index;
  return JSON.parse(socket.sent[resolved] as string) as unknown;
}

afterEach(() => {
  FakeSocket.instances = [];
});

describe('connection lifecycle', () => {
  it('prevents duplicate connections', () => {
    const harness = createHarness();

    harness.manager.connect();
    harness.manager.connect();

    expect(FakeSocket.instances).toHaveLength(1);
    expect(harness.manager.getStatus()).toBe('connecting');

    harness.socket().open();
    harness.manager.connect();

    expect(FakeSocket.instances).toHaveLength(1);
    expect(harness.manager.getStatus()).toBe('open');
  });

  it('resubscribes every active stream with one message after reopen', () => {
    const harness = createHarness();
    harness.manager.subscribe('alpha@arr', vi.fn());
    harness.manager.subscribe('beta@depth', vi.fn());

    harness.manager.connect();
    const first = harness.socket();
    first.open();

    expect(first.sent).toHaveLength(1);
    expect(parseSent(first)).toEqual({
      method: 'SUBSCRIBE',
      params: ['alpha@arr', 'beta@depth'],
      id: 1,
    });

    first.emitClose();
    expect(harness.timers.pendingDelays).toEqual([1000]);
    harness.timers.runNext();

    const second = harness.socket();
    second.open();
    expect(second.sent).toHaveLength(1);
    expect(parseSent(second)).toEqual({
      method: 'SUBSCRIBE',
      params: ['alpha@arr', 'beta@depth'],
      id: 2,
    });
  });

  it('cancels a pending reconnect on intentional disconnect with no socket', () => {
    const harness = createHarness();
    harness.manager.connect();
    harness.socket().emitClose();

    expect(harness.timers.pendingDelays).toEqual([1000]);
    expect(harness.manager.getConnectionMetrics().nextReconnectAt).toBe(1000);

    harness.manager.disconnect();

    expect(harness.manager.getStatus()).toBe('closed');
    expect(harness.timers.pendingDelays).toEqual([]);
    expect(harness.manager.getConnectionMetrics()).toMatchObject({
      reconnectAttempt: 1,
      nextReconnectAt: null,
    });

    harness.manager.connect();
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('keeps subscriptions through pause and resumes with one connection', () => {
    const harness = createHarness();
    harness.manager.subscribe('ticks', vi.fn());

    harness.manager.connect();
    const first = harness.socket();
    first.open();
    first.sent.length = 0;

    harness.manager.pause();
    expect(first.closeCalls).toHaveLength(1);
    expect(harness.manager.getStatus()).toBe('closed');
    expect(harness.timers.pendingDelays).toEqual([]);

    harness.manager.resume();
    harness.manager.resume();
    expect(FakeSocket.instances).toHaveLength(2);

    const second = harness.socket();
    second.open();
    expect(second.sent).toHaveLength(1);
    expect(parseSent(second)).toMatchObject({
      method: 'SUBSCRIBE',
      params: ['ticks'],
    });
  });

  it('ignores stale events from a replaced socket', () => {
    const harness = createHarness();
    const handler = vi.fn();
    harness.manager.subscribe('ticks', handler);

    harness.manager.connect();
    const stale = harness.socket();
    stale.open();

    harness.manager.disconnect();
    harness.manager.connect();
    const current = harness.socket();
    current.open();

    stale.emitClose();
    stale.message({ stream: 'ticks', data: { stale: true } });

    expect(harness.manager.getStatus()).toBe('open');
    expect(handler).not.toHaveBeenCalled();
    expect(harness.timers.pendingDelays).toEqual([30_000]);
  });

  it('keeps bounded retry when the socket factory throws', () => {
    let attempts = 0;
    const harness = createHarness({
      socketFactory: (url) => {
        attempts += 1;
        if (attempts === 1) throw new Error('socket unavailable');
        return new FakeSocket(url) as unknown as WebSocket;
      },
    });

    harness.manager.connect();

    expect(FakeSocket.instances).toHaveLength(0);
    expect(harness.manager.getConnectionMetrics()).toMatchObject({
      status: 'reconnecting',
      reconnectAttempt: 1,
      nextReconnectAt: 1000,
    });
    expect(harness.timers.pendingDelays).toEqual([1000]);

    harness.timers.runNext();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(harness.manager.getStatus()).toBe('connecting');
  });

  it('uses capped exponential retry delays and reports the attempt', () => {
    const harness = createHarness();
    harness.manager.connect();

    const expected = [
      [1000, 1],
      [2000, 2],
      [4000, 3],
      [8000, 4],
      [16_000, 5],
      [30_000, 6],
      [30_000, 7],
      [30_000, 8],
    ] as const;

    for (const [delay, attempt] of expected) {
      harness.socket().emitClose();

      expect(harness.timers.pendingDelays).toEqual([delay]);
      expect(harness.manager.getConnectionMetrics()).toMatchObject({
        status: 'reconnecting',
        reconnectAttempt: attempt,
        nextReconnectAt: harness.now() + delay,
      });

      harness.timers.runNext();
    }
  });
});

describe('subscription bookkeeping', () => {
  it('reference counts handlers and unsubscribes once at zero', () => {
    const harness = createHarness();
    harness.manager.connect();
    const socket = harness.socket();
    socket.open();

    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = harness.manager.subscribe('alpha', first);
    const stopSecond = harness.manager.subscribe('alpha', second);
    const stopOther = harness.manager.subscribe('beta', vi.fn());

    expect(socket.sent).toHaveLength(2);
    expect(parseSent(socket, 0)).toMatchObject({
      method: 'SUBSCRIBE',
      params: ['alpha'],
    });

    stopFirst();
    stopFirst();
    expect(socket.sent).toHaveLength(2);

    stopSecond();
    expect(socket.sent).toHaveLength(3);
    expect(parseSent(socket)).toMatchObject({
      method: 'UNSUBSCRIBE',
      params: ['alpha'],
    });

    stopOther();
    expect(socket.sent).toHaveLength(4);
    expect(parseSent(socket)).toMatchObject({
      method: 'UNSUBSCRIBE',
      params: ['beta'],
    });
  });

  it('delivers once per frame when the same callback registers twice', () => {
    const harness = createHarness();
    harness.manager.connect();
    const socket = harness.socket();
    socket.open();

    const handler = vi.fn();
    const stopFirst = harness.manager.subscribe('alpha', handler);
    const stopSecond = harness.manager.subscribe('alpha', handler);

    expect(socket.sent).toHaveLength(1);
    expect(parseSent(socket)).toMatchObject({
      method: 'SUBSCRIBE',
      params: ['alpha'],
    });

    socket.message({ stream: 'alpha', data: { price: '1.00' } });
    expect(handler).toHaveBeenCalledTimes(1);

    // first unsubscribe only drops one registration
    stopFirst();
    stopFirst();
    expect(socket.sent).toHaveLength(1);

    socket.message({ stream: 'alpha', data: { price: '1.01' } });
    expect(handler).toHaveBeenCalledTimes(2);

    stopSecond();
    stopSecond();
    expect(socket.sent).toHaveLength(2);
    expect(parseSent(socket)).toMatchObject({
      method: 'UNSUBSCRIBE',
      params: ['alpha'],
    });

    socket.message({ stream: 'alpha', data: { price: '1.02' } });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('routes envelopes only to the matching stream handlers', () => {
    const harness = createHarness();
    harness.manager.connect();
    const socket = harness.socket();
    socket.open();

    const alpha = vi.fn();
    const beta = vi.fn();
    harness.manager.subscribe('alpha', alpha);
    harness.manager.subscribe('beta', beta);

    socket.message({ stream: 'alpha', data: { price: '1.25' } });
    socket.message({ stream: 'unknown', data: { price: '2.00' } });

    expect(alpha).toHaveBeenCalledTimes(1);
    expect(alpha).toHaveBeenCalledWith({ price: '1.25' });
    expect(beta).not.toHaveBeenCalled();
  });

  it('ignores malformed payloads, acks including id zero, and pings offline', () => {
    const harness = createHarness();
    harness.manager.connect();
    const socket = harness.socket();
    socket.open();

    const handler = vi.fn();
    harness.manager.subscribe('alpha', handler);

    expect(() => socket.message('{not json')).not.toThrow();
    expect(() => socket.message('null')).not.toThrow();
    expect(() => socket.message([1, 2, 3])).not.toThrow();

    socket.message({ result: null, id: 0 });
    socket.message({ result: null, id: 12 });
    socket.message({ code: -1121, msg: 'Invalid symbol', id: 4 });

    expect(handler).not.toHaveBeenCalled();

    socket.message({ ping: 0 });
    expect(parseSent(socket)).toEqual({ pong: 0 });

    const sentBefore = socket.sent.length;
    harness.manager.disconnect();
    socket.message({ ping: 5 });
    expect(socket.sent).toHaveLength(sentBefore);
  });
});

describe('heartbeat watchdog', () => {
  it('restarts the idle window on traffic and reconnects on silence', () => {
    const harness = createHarness();
    harness.manager.connect();
    const socket = harness.socket();
    socket.open();

    expect(harness.timers.pendingDelays).toEqual([30_000]);
    const firstWatchdog = harness.timers.ids[0];

    harness.setNow(20_000);
    socket.message({ stream: 'ticks', data: {} });

    expect(harness.timers.cleared).toContain(firstWatchdog);
    expect(harness.timers.pendingDelays).toEqual([30_000]);
    expect(harness.timers.ids).toHaveLength(1);

    harness.setNow(50_000);
    harness.timers.runNext();

    expect(socket.closeCalls.at(-1)).toEqual({
      code: 4000,
      reason: 'heartbeat timeout',
    });
    expect(harness.timers.pendingDelays).toEqual([1000]);
    expect(harness.manager.getConnectionMetrics()).toMatchObject({
      status: 'reconnecting',
      reconnectAttempt: 1,
      nextReconnectAt: 51_000,
    });

    // the closed socket's late close event must not start a second flow
    socket.emitClose();
    expect(harness.timers.pendingDelays).toEqual([1000]);
    expect(harness.manager.getConnectionMetrics().reconnectAttempt).toBe(1);
  });

  it('recovers a socket that never finishes connecting', () => {
    const harness = createHarness();
    harness.manager.connect();

    const stuck = harness.socket();
    expect(stuck.readyState).toBe(0);
    expect(harness.timers.pendingDelays).toEqual([30_000]);

    harness.setNow(30_000);
    harness.timers.runNext();

    expect(stuck.closeCalls.at(-1)).toEqual({
      code: 4000,
      reason: 'heartbeat timeout',
    });
    expect(harness.timers.pendingDelays).toEqual([1000]);
    expect(harness.manager.getConnectionMetrics()).toMatchObject({
      status: 'reconnecting',
      reconnectAttempt: 1,
      nextReconnectAt: 31_000,
    });

    // the timed-out socket's own close event must not queue a second attempt
    stuck.emitClose();
    expect(harness.timers.pendingDelays).toEqual([1000]);
    expect(harness.manager.getConnectionMetrics().reconnectAttempt).toBe(1);

    harness.timers.runNext();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(harness.timers.pendingDelays).toEqual([30_000]);
  });

  it('publishes low-frequency state and clears stale on open', () => {
    const harness = createHarness();
    harness.manager.connect();

    expect(harness.publisher).toHaveBeenLastCalledWith({
      status: 'connecting',
      reconnectAttempt: 0,
      nextReconnectAt: null,
    });

    harness.socket().open();
    expect(harness.publisher).toHaveBeenLastCalledWith({
      status: 'open',
      reconnectAttempt: 0,
      nextReconnectAt: null,
      isStale: false,
    });

    harness.socket().emitClose();
    const calls = harness.publisher.mock.calls.map(
      (call) => call[0] as { status: string; isStale?: boolean },
    );
    expect(calls.some((call) => call.status === 'disconnected')).toBe(true);
    expect(harness.publisher).toHaveBeenLastCalledWith({
      status: 'reconnecting',
      reconnectAttempt: 1,
      nextReconnectAt: 1000,
    });
  });
});

describe('connection metrics', () => {
  it('samples a bounded rolling message rate from actual frames', () => {
    const harness = createHarness();
    harness.manager.connect();
    const socket = harness.socket();
    socket.open();

    harness.setNow(1100);
    socket.message({ stream: 'ticks', data: {} });
    harness.setNow(1200);
    socket.message({ stream: 'ticks', data: {} });
    harness.setNow(1300);
    socket.message({ stream: 'ticks', data: {} });

    expect(harness.manager.getConnectionMetrics()).toMatchObject({
      status: 'open',
      messagesPerSecond: 3,
      lastMessageAt: 1300,
      reconnectAttempt: 0,
      nextReconnectAt: null,
    });

    harness.setNow(2000);
    expect(harness.manager.getConnectionMetrics().messagesPerSecond).toBe(3);

    harness.setNow(2301);
    expect(harness.manager.getConnectionMetrics()).toMatchObject({
      messagesPerSecond: 0,
      lastMessageAt: 1300,
    });

    harness.socket().emitClose();
    expect(harness.manager.getConnectionMetrics()).toMatchObject({
      reconnectAttempt: 1,
      nextReconnectAt: 3301,
    });
  });
});

describe('visibility handling', () => {
  type Listener = () => void;

  function installDocument() {
    const listeners = new Set<Listener>();
    const fakeDocument = {
      hidden: false,
      addEventListener: vi.fn((type: string, listener: Listener) => {
        if (type === 'visibilitychange') listeners.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: Listener) => {
        if (type === 'visibilitychange') listeners.delete(listener);
      }),
    };
    const host = globalThis as unknown as { document?: unknown };
    host.document = fakeDocument;
    return {
      fakeDocument,
      listenerCount: () => listeners.size,
      dispatch() {
        for (const listener of Array.from(listeners)) listener();
      },
      restore() {
        delete host.document;
      },
      hasDocument: () => host.document !== undefined,
    };
  }

  it('does not reconnect after an intentional disconnect hides and returns', () => {
    const doc = installDocument();
    const harness = createHarness();
    harness.manager.subscribe('ticks', vi.fn());

    try {
      const cleanup = harness.manager.setupVisibilityHandler();

      harness.manager.connect();
      harness.socket().open();
      harness.manager.disconnect();
      expect(FakeSocket.instances).toHaveLength(1);

      doc.fakeDocument.hidden = true;
      doc.dispatch();
      expect(harness.manager.getStatus()).toBe('closed');

      doc.fakeDocument.hidden = false;
      doc.dispatch();
      expect(FakeSocket.instances).toHaveLength(1);
      expect(harness.manager.getStatus()).toBe('closed');
      expect(harness.timers.pendingDelays).toEqual([]);

      cleanup();
    } finally {
      doc.restore();
    }
  });

  it('registers one listener and pauses/resumes with subscriptions', () => {
    const doc = installDocument();
    const harness = createHarness();
    harness.manager.subscribe('ticks', vi.fn());

    try {
      const cleanup = harness.manager.setupVisibilityHandler();
      const secondCleanup = harness.manager.setupVisibilityHandler();

      expect(secondCleanup).toBe(cleanup);
      expect(doc.fakeDocument.addEventListener).toHaveBeenCalledTimes(1);
      expect(doc.listenerCount()).toBe(1);

      doc.fakeDocument.hidden = true;
      doc.dispatch();
      expect(harness.manager.getStatus()).toBe('closed');

      doc.fakeDocument.hidden = false;
      doc.dispatch();
      expect(FakeSocket.instances).toHaveLength(1);
      harness.socket().open();
      expect(harness.manager.getStatus()).toBe('open');

      cleanup();
      expect(doc.fakeDocument.removeEventListener).toHaveBeenCalledTimes(1);
      expect(doc.listenerCount()).toBe(0);

      const nextCleanup = harness.manager.setupVisibilityHandler();
      expect(doc.fakeDocument.addEventListener).toHaveBeenCalledTimes(2);
      expect(doc.listenerCount()).toBe(1);
      nextCleanup();
    } finally {
      doc.restore();
    }
  });
});
