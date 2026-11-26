// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConnectionStatus } from '../binance/BinanceWebSocket';
import { CONNECTION_STATUS } from '../binance/BinanceWebSocket';
import type { DepthSnapshotResponse, DepthUpdateEvent } from '../binance/types';
import type { FrameTask } from '../frameTask';
import {
  createOrderBookController,
  createOrderBookRegistry,
  type DepthSnapshotClient,
  type OrderBookController,
  type OrderBookControllerOptions,
  type OrderBookScheduler,
  type OrderBookSocket,
} from './controller';
import { createEmptyOrderBookView } from './orderBook';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function snapshot(
  lastUpdateId: number,
  bids: [string, string][] = [['99', '1']],
  asks: [string, string][] = [['101', '1']],
): DepthSnapshotResponse {
  return { lastUpdateId, bids, asks };
}

function update(
  U: number,
  u: number,
  bids: [string, string][] = [],
  asks: [string, string][] = [],
): DepthUpdateEvent {
  return {
    e: 'depthUpdate',
    E: 5000 + u,
    s: 'BTCUSDT',
    U,
    u,
    b: bids,
    a: asks,
  };
}

function createHarness(options: Partial<OrderBookControllerOptions> = {}) {
  const requests: (Deferred<DepthSnapshotResponse> & {
    signal?: AbortSignal;
  })[] = [];
  const rest: DepthSnapshotClient = {
    getDepthSnapshot: vi.fn(
      (_symbol: string, _limit: number, signal?: AbortSignal) => {
        const request = { ...deferred<DepthSnapshotResponse>(), signal };
        requests.push(request);
        return request.promise;
      },
    ),
  };

  const depthHandlers = new Set<(data: unknown) => void>();
  const statusHandlers = new Set<(status: ConnectionStatus) => void>();
  const unsubscribeDepth = vi.fn();
  const unsubscribeStatus = vi.fn();
  let status: ConnectionStatus = CONNECTION_STATUS.Uninstantiated;
  const socket: OrderBookSocket = {
    connect: vi.fn(),
    subscribe: vi.fn((_stream, handler) => {
      depthHandlers.add(handler);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        depthHandlers.delete(handler);
        unsubscribeDepth();
      };
    }),
    onStatusChange: vi.fn((handler) => {
      statusHandlers.add(handler);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        statusHandlers.delete(handler);
        unsubscribeStatus();
      };
    }),
    getStatus: () => status,
  };

  let nextTimer = 1;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const scheduler: OrderBookScheduler = {
    setTimeout(callback, delay) {
      const handle = nextTimer++;
      timers.set(handle, { callback, delay });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
  };

  let frameCallback: () => void = () => {};
  let framePending = false;
  const frameTask: FrameTask = {
    request() {
      framePending = true;
    },
    flush() {
      if (!framePending) return;
      framePending = false;
      frameCallback();
    },
    cancel() {
      framePending = false;
    },
  };

  const health = { noteBookGap: vi.fn(), updateBook: vi.fn() };
  const controller = createOrderBookController('BTCUSDT', {
    socket,
    rest,
    health,
    scheduler,
    frameTaskFactory: (callback) => {
      frameCallback = callback;
      return frameTask;
    },
    ...options,
  });

  return {
    controller,
    requests,
    rest,
    socket,
    health,
    timers,
    unsubscribeDepth,
    unsubscribeStatus,
    flush: frameTask.flush,
    emit(data: unknown) {
      for (const handler of Array.from(depthHandlers)) handler(data);
    },
    setStatus(next: ConnectionStatus) {
      status = next;
      for (const handler of Array.from(statusHandlers)) handler(next);
    },
    fireTimer(delay: number) {
      const entry = Array.from(timers.entries()).find(
        ([, timer]) => timer.delay === delay,
      );
      if (!entry) throw new Error(`No pending timer with delay ${delay}`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
    async resolveRequest(index: number, value: DepthSnapshotResponse) {
      requests[index].resolve(value);
      await Promise.resolve();
      await Promise.resolve();
    },
    async rejectRequest(index: number) {
      requests[index].reject(new Error('rejected'));
      await Promise.resolve();
      await Promise.resolve();
    },
    get framePending() {
      return framePending;
    },
  };
}

const liveControllers = new Set<OrderBookController>();

function harness(options: Partial<OrderBookControllerOptions> = {}) {
  const value = createHarness(options);
  liveControllers.add(value.controller);
  return value;
}

async function makeLive(value: ReturnType<typeof createHarness>) {
  value.controller.start();
  value.emit(update(101, 101));
  await value.resolveRequest(0, snapshot(100));
  value.flush();
  expect(value.controller.getSnapshot().state).toBe('live');
}

afterEach(() => {
  for (const controller of liveControllers) controller.stop();
  liveControllers.clear();
  vi.restoreAllMocks();
});

describe('order-book coordinator', () => {
  it('shows connecting then syncing and publishes WS changes only on flush', async () => {
    const value = harness();
    const listener = vi.fn();
    value.controller.subscribe(listener);

    expect(value.controller.getSnapshot().state).toBe('connecting');
    value.controller.start();
    expect(value.socket.subscribe).toHaveBeenCalledWith(
      'btcusdt@depth@100ms',
      expect.any(Function),
    );
    expect(value.rest.getDepthSnapshot).toHaveBeenCalledWith(
      'BTCUSDT',
      1000,
      expect.any(AbortSignal),
    );
    value.flush();
    expect(value.controller.getSnapshot().state).toBe('syncing');
    expect(listener).toHaveBeenCalledTimes(1);

    value.emit(update(101, 101));
    await value.resolveRequest(0, snapshot(100));
    expect(value.controller.getSnapshot().state).toBe('syncing');
    expect(listener).toHaveBeenCalledTimes(1);
    value.flush();
    expect(value.controller.getSnapshot().state).toBe('live');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('buffers, drops stale events, applies the bridge and second diff in order', async () => {
    const value = harness();
    value.controller.start();
    value.emit(update(99, 100, [['88', '8']]));
    value.emit(update(100, 101, [['99', '0.1']]));
    value.emit(update(102, 102, [['99', '0']], [['100', '2']]));

    await value.resolveRequest(0, snapshot(100));
    value.flush();
    const view = value.controller.getSnapshot();

    expect(view.state).toBe('live');
    expect(view.lastUpdateId).toBe(102);
    expect(view.bids).toEqual([]);
    expect(view.asks.map((row) => row.price)).toEqual(['100', '101']);
    expect(view.bids.some((row) => row.price === '88')).toBe(false);
  });

  it('removes a live level when its normalized quantity is zero', async () => {
    const value = harness();
    await makeLive(value);
    value.emit(update(102, 102, [['99.000', '-0.000']]));
    value.flush();

    expect(value.controller.getSnapshot().bids).toEqual([]);
    expect(value.controller.getSnapshot().asks[0].price).toBe('101');
  });

  it('counts one second-diff gap, discards its partial state, and recovers', async () => {
    const value = harness();
    value.controller.start();
    value.emit(update(101, 101, [['99', '5']]));
    value.emit(update(103, 103, [['98', '5']]));
    await value.resolveRequest(0, snapshot(100));

    expect(value.requests).toHaveLength(2);
    value.flush();
    expect(value.controller.getSnapshot().gapCount).toBe(1);
    expect(value.health.noteBookGap).toHaveBeenCalledTimes(1);

    value.emit(update(5, 6, [['1', '100']]));
    value.emit(update(201, 201, [['200', '2']]));
    await value.resolveRequest(
      1,
      snapshot(200, [['199', '1']], [['201', '1']]),
    );
    value.flush();

    const recovered = value.controller.getSnapshot();
    expect(recovered.state).toBe('live');
    expect(recovered.gapCount).toBe(1);
    expect(recovered.bids.map((row) => row.price)).toEqual(['200', '199']);
    expect(recovered.bids.some((row) => row.price === '98')).toBe(false);
    expect(recovered.bids.some((row) => row.price === '1')).toBe(false);
  });

  it('keeps the last good rows visible and stale throughout repair', async () => {
    const value = harness();
    await makeLive(value);
    const good = value.controller.getSnapshot();
    value.health.updateBook.mockClear();

    value.emit(update(105, 105, [['999', '1']]));
    expect(value.controller.getSnapshot()).toBe(good);
    expect(value.health.noteBookGap).not.toHaveBeenCalled();
    expect(value.health.updateBook).not.toHaveBeenCalled();

    value.flush();
    const stale = value.controller.getSnapshot();
    expect(stale.state).toBe('stale');
    expect(stale.bids).toBe(good.bids);
    expect(stale.asks).toBe(good.asks);
    expect(stale.spread).toBe(good.spread);
    expect(stale.lastUpdateId).toBe(good.lastUpdateId);
    expect(stale.gapCount).toBe(1);
    expect(value.health.noteBookGap).toHaveBeenCalledTimes(1);
    expect(value.health.updateBook).toHaveBeenCalledWith(
      expect.objectContaining({ isStale: true }),
    );

    value.emit(update(201, 201, [['200', '3']]));
    await value.resolveRequest(1, snapshot(200));
    value.flush();
    expect(value.controller.getSnapshot().state).toBe('live');
    expect(value.controller.getSnapshot().bids[0].price).toBe('200');
  });

  it('ignores malformed envelopes without disturbing the live book', async () => {
    const value = harness();
    await makeLive(value);

    expect(() => {
      value.emit(null);
      value.emit({ e: 'trade' });
      value.emit({ ...update(102, 102), U: '102' });
    }).not.toThrow();
    expect(value.requests).toHaveLength(1);
    const intact = value.controller.getSnapshot();

    expect(() =>
      value.emit(update(102, 102, [['not-a-price', '1']])),
    ).not.toThrow();
    expect(value.requests).toHaveLength(1);
    value.flush();
    expect(value.controller.getSnapshot()).toBe(intact);
    expect(value.controller.getSnapshot().gapCount).toBe(0);
  });

  it('retries a rejected REST request with bounded backoff', async () => {
    const value = harness();
    value.controller.start();
    value.flush();
    await value.rejectRequest(0);
    value.flush();

    expect(value.controller.getSnapshot().state).toBe('error');
    expect(value.controller.getSnapshot().gapCount).toBe(0);
    expect(
      Array.from(value.timers.values()).map((timer) => timer.delay),
    ).toEqual([250]);

    value.fireTimer(250);
    expect(value.requests).toHaveLength(2);
    await value.rejectRequest(1);
    expect(
      Array.from(value.timers.values()).map((timer) => timer.delay),
    ).toEqual([500]);
    value.fireTimer(500);
    expect(value.requests).toHaveLength(3);
  });

  it('times out an unresolved snapshot and rejects its obsolete result', async () => {
    const value = harness();
    value.controller.start();
    value.fireTimer(10_000);
    expect(value.requests[0].signal?.aborted).toBe(true);
    value.flush();
    expect(value.controller.getSnapshot().state).toBe('error');

    value.fireTimer(250);
    expect(value.requests).toHaveLength(2);
    value.emit(update(101, 101));
    await value.resolveRequest(0, snapshot(999));
    await value.resolveRequest(1, snapshot(100));
    value.flush();

    expect(value.controller.getSnapshot().state).toBe('live');
    expect(value.controller.getSnapshot().lastUpdateId).toBe(101);
  });

  it('bounds the pre-snapshot buffer and starts a fresh sync on overflow', async () => {
    const value = harness({ maxBufferedEvents: 2 });
    value.controller.start();
    value.emit(update(101, 101));
    value.emit(update(102, 102));
    value.emit(update(103, 103));

    expect(value.requests).toHaveLength(2);
    expect(value.requests[0].signal?.aborted).toBe(true);
    value.flush();
    expect(value.controller.getSnapshot().gapCount).toBe(1);
  });

  it('resyncs exactly once after a reconnect sequence', async () => {
    const value = harness();
    await makeLive(value);
    const good = value.controller.getSnapshot();

    value.setStatus(CONNECTION_STATUS.Disconnected);
    value.setStatus(CONNECTION_STATUS.Closed);
    value.setStatus(CONNECTION_STATUS.Reconnecting);
    value.setStatus(CONNECTION_STATUS.Connecting);
    expect(value.requests).toHaveLength(1);
    expect(value.controller.getSnapshot()).toBe(good);
    value.flush();
    expect(value.controller.getSnapshot().state).toBe('stale');
    expect(value.controller.getSnapshot().bids).toBe(good.bids);

    value.setStatus(CONNECTION_STATUS.Open);
    value.setStatus(CONNECTION_STATUS.Open);
    expect(value.requests).toHaveLength(2);
    value.emit(update(201, 201));
    await value.resolveRequest(1, snapshot(200));
    value.flush();

    expect(value.controller.getSnapshot().state).toBe('live');
    expect(value.controller.getSnapshot().gapCount).toBe(1);
    expect(value.health.noteBookGap).toHaveBeenCalledTimes(1);
  });

  it('stops completely and ignores late results; teardown is idempotent', async () => {
    const value = harness();
    const listener = vi.fn();
    const unsubscribeListener = value.controller.subscribe(listener);
    value.controller.start();
    const activeSignal = value.requests[0].signal;

    value.controller.stop();
    value.controller.stop();
    unsubscribeListener();
    unsubscribeListener();
    expect(value.unsubscribeDepth).toHaveBeenCalledTimes(1);
    expect(value.unsubscribeStatus).toHaveBeenCalledTimes(1);
    expect(activeSignal?.aborted).toBe(true);
    expect(value.timers.size).toBe(0);
    expect(value.framePending).toBe(false);

    await value.resolveRequest(0, snapshot(100));
    value.setStatus(CONNECTION_STATUS.Open);
    value.emit(update(101, 101));
    expect(value.requests).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not recreate a live view for a health-only publication', async () => {
    const value = harness();
    await makeLive(value);
    const listener = vi.fn();
    value.controller.subscribe(listener);
    const view = value.controller.getSnapshot();

    value.setStatus(CONNECTION_STATUS.Open);
    value.flush();

    expect(value.controller.getSnapshot()).toBe(view);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('order-book controller registry', () => {
  it('shares by symbol and disposes after the final idempotent release', () => {
    const first = {
      symbol: 'BTCUSDT',
      start: vi.fn(),
      stop: vi.fn(),
      getSnapshot: () => createEmptyOrderBookView('BTCUSDT'),
      subscribe: vi.fn(() => () => {}),
    };
    const second = { ...first, start: vi.fn(), stop: vi.fn() };
    const factory = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const registry = createOrderBookRegistry(factory);

    const one = registry.acquire('BTCUSDT');
    const two = registry.acquire('BTCUSDT');
    expect(one.controller).toBe(first);
    expect(two.controller).toBe(first);
    expect(first.start).toHaveBeenCalledTimes(1);

    one.release();
    one.release();
    expect(first.stop).not.toHaveBeenCalled();
    two.release();
    two.release();
    expect(first.stop).toHaveBeenCalledTimes(1);

    const replacement = registry.acquire('BTCUSDT');
    expect(replacement.controller).toBe(second);
    expect(second.start).toHaveBeenCalledTimes(1);
    replacement.release();
    expect(second.stop).toHaveBeenCalledTimes(1);
  });
});
