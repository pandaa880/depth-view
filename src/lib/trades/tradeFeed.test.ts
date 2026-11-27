import { describe, expect, it, vi } from 'vitest';

import { createFrameTask, type FrameTaskOptions } from '../frameTask';
import { MAX_TRADE_ROWS, createTradeFeed } from './tradeFeed';

type TradeEventFixture = {
  e: 'trade';
  E: number;
  s: string;
  t: number;
  p: string;
  q: string;
  T: number;
  m: boolean;
};

function tradeEvent(
  id: number,
  overrides: Partial<TradeEventFixture> = {},
): TradeEventFixture {
  return {
    e: 'trade',
    E: 1_700_000_000_000 + id,
    s: 'BTCUSDT',
    t: id,
    p: '100.50000000',
    q: '2.00000000',
    T: 1_700_000_000_000 + id,
    m: false,
    ...overrides,
  };
}

function createStream() {
  let handler: ((data: unknown) => void) | null = null;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((_stream: string, next: (data: unknown) => void) => {
    handler = next;
    return unsubscribe;
  });

  return {
    subscribe,
    unsubscribe,
    emit(data: unknown) {
      handler?.(data);
    },
    hasHandler: () => handler !== null,
  };
}

function createManualFrameTask() {
  let callback: (() => void) | null = null;
  let pending = false;
  const request = vi.fn(() => {
    pending = true;
  });
  const cancel = vi.fn(() => {
    pending = false;
  });

  const factory = (next: () => void) => {
    callback = next;
    return { request, flush: () => {}, cancel };
  };

  return {
    factory,
    request,
    cancel,
    flush() {
      if (!pending) return;
      pending = false;
      callback?.();
    },
  };
}

function createScheduler() {
  let nextHandle = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  const options: FrameTaskOptions = {
    requestAnimationFrame(callback) {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      frames.delete(handle);
    },
    setTimeout(callback) {
      const handle = nextHandle++;
      timers.set(handle, callback);
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
  };

  return {
    options,
    frames,
    timers,
    fireFrame(handle: number) {
      const callback = frames.get(handle);
      if (!callback) throw new Error(`Unknown frame handle: ${handle}`);
      frames.delete(handle);
      callback();
    },
  };
}

describe('createTradeFeed', () => {
  it('subscribes once to the lowercase trade stream and validates symbol', () => {
    const stream = createStream();
    const frame = createManualFrameTask();
    const feed = createTradeFeed('BTCUSDT', {
      subscribe: stream.subscribe,
      frameTaskFactory: frame.factory,
    });
    const listener = vi.fn();
    feed.subscribe(listener);

    feed.start();
    feed.start();
    expect(stream.subscribe).toHaveBeenCalledTimes(1);
    expect(stream.subscribe.mock.calls[0][0]).toBe('btcusdt@trade');

    stream.emit(tradeEvent(1, { s: 'ETHUSDT' }));
    frame.flush();
    expect(feed.getTrades()).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('maps raw values and direction, newest first, capped at 50', () => {
    const stream = createStream();
    const frame = createManualFrameTask();
    const feed = createTradeFeed('BTCUSDT', {
      subscribe: stream.subscribe,
      frameTaskFactory: frame.factory,
    });
    const listener = vi.fn();
    feed.subscribe(listener);
    feed.start();

    for (let id = 1; id <= 55; id += 1) {
      stream.emit(
        tradeEvent(id, {
          m: id % 2 === 0,
          p: `100.${id}`,
          q: `2.${id}`,
        }),
      );
    }

    expect(listener).not.toHaveBeenCalled();
    frame.flush();

    const trades = feed.getTrades();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(trades).toHaveLength(MAX_TRADE_ROWS);
    expect(trades[0].id).toBe(55);
    expect(trades[trades.length - 1].id).toBe(6);
    expect(trades[0].price).toBe('100.55');
    expect(trades[0].quantity).toBe('2.55');
    expect(trades[0].isBuyerMaker).toBe(false);
    expect(trades[1].isBuyerMaker).toBe(true);
    expect(trades[0].time).toBe(1_700_000_000_055);
  });

  it('coalesces messages into one flush notification', () => {
    const stream = createStream();
    const scheduler = createScheduler();
    const feed = createTradeFeed('BTCUSDT', {
      subscribe: stream.subscribe,
      frameTaskFactory: (callback) =>
        createFrameTask(callback, scheduler.options),
    });
    const listener = vi.fn();
    feed.subscribe(listener);
    feed.start();

    stream.emit(tradeEvent(1));
    stream.emit(tradeEvent(2));
    stream.emit(tradeEvent(3));

    expect(scheduler.frames.size).toBe(1);
    expect(listener).not.toHaveBeenCalled();

    scheduler.fireFrame(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(feed.getTrades().map((trade) => trade.id)).toEqual([3, 2, 1]);
  });

  it('ignores malformed events and duplicate trade ids', () => {
    const stream = createStream();
    const frame = createManualFrameTask();
    const feed = createTradeFeed('BTCUSDT', {
      subscribe: stream.subscribe,
      frameTaskFactory: frame.factory,
    });
    const listener = vi.fn();
    feed.subscribe(listener);
    feed.start();

    stream.emit({ e: 'trade' });
    expect(frame.request).not.toHaveBeenCalled();

    stream.emit(tradeEvent(9));
    stream.emit(tradeEvent(9));
    frame.flush();
    expect(feed.getTrades()).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);

    stream.emit(tradeEvent(9));
    frame.flush();
    expect(feed.getTrades()).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects an evicted old trade id without a duplicate publication', () => {
    const stream = createStream();
    const frame = createManualFrameTask();
    const feed = createTradeFeed('BTCUSDT', {
      subscribe: stream.subscribe,
      frameTaskFactory: frame.factory,
    });
    const listener = vi.fn();
    feed.subscribe(listener);
    feed.start();

    for (let id = 1; id <= 51; id += 1) {
      stream.emit(tradeEvent(id));
    }
    frame.flush();
    expect(feed.getTrades()).toHaveLength(50);
    expect(listener).toHaveBeenCalledTimes(1);

    stream.emit(tradeEvent(1));
    frame.flush();

    expect(feed.getTrades()[0].id).toBe(51);
    expect(feed.getTrades()).toHaveLength(50);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tears down its stream and frame work idempotently on stop', () => {
    const stream = createStream();
    const frame = createManualFrameTask();
    const feed = createTradeFeed('BTCUSDT', {
      subscribe: stream.subscribe,
      frameTaskFactory: frame.factory,
    });
    const listener = vi.fn();
    const unsubscribeListener = feed.subscribe(listener);
    feed.start();

    stream.emit(tradeEvent(1));
    frame.flush();
    expect(listener).toHaveBeenCalledTimes(1);

    feed.stop();
    feed.stop();
    expect(stream.unsubscribe).toHaveBeenCalledTimes(1);
    expect(frame.cancel).toHaveBeenCalled();
    expect(feed.getTrades()).toHaveLength(0);

    stream.emit(tradeEvent(2));
    frame.flush();
    expect(feed.getTrades()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribeListener();
    unsubscribeListener();
  });
});
