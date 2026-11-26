// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SYMBOLS } from '../config/markets';
import { useExchangeInfoStore, useTickerStore } from '../stores/globalStore';
import type { TickerData } from '../models';
import type { SymbolInfo } from '../models/SymbolInfo';
import type { FrameTask } from '../lib/frameTask';
import {
  createMiniTickerFeed,
  createTickerBootstrap,
  useWsConnection,
  type TickerBootstrap,
  type TickerSocket,
} from './useWsConnection';

const BTC_INFO: SymbolInfo = {
  symbol: 'BTCUSDT',
  tickSize: '0.01',
  stepSize: '0.000001',
  baseAssetPrecision: 8,
  quoteAssetPrecision: 8,
};

const ETH_INFO: SymbolInfo = {
  ...BTC_INFO,
  symbol: 'ETHUSDT',
};

function makeRaw(symbol = 'BTCUSDT', close = '101.00', eventTime = 1_000) {
  return {
    e: '24hrMiniTicker',
    E: eventTime,
    s: symbol,
    c: close,
    o: '100.00',
    h: '105.00',
    l: '99.00',
    v: '10',
    q: '1000.00000000',
  };
}

function createControlledFrameTask() {
  let queued = false;
  let callback: (() => void) | null = null;
  let requestCount = 0;
  let cancelCount = 0;

  const factory = (next: () => void): FrameTask => {
    callback = next;
    return {
      request() {
        queued = true;
        requestCount += 1;
      },
      flush() {
        if (!queued || !callback) return;
        queued = false;
        callback();
      },
      cancel() {
        queued = false;
        cancelCount += 1;
      },
    };
  };

  return {
    factory,
    flush() {
      if (!queued || !callback) return;
      queued = false;
      callback();
    },
    get requestCount() {
      return requestCount;
    },
    get cancelCount() {
      return cancelCount;
    },
  };
}

function createFakeSocket() {
  const handlers = new Map<string, (data: unknown) => void>();
  let connectCount = 0;
  let subscribeCount = 0;
  let unsubscribeCount = 0;

  const socket: TickerSocket = {
    connect() {
      connectCount += 1;
    },
    subscribe(stream, handler) {
      subscribeCount += 1;
      handlers.set(stream, handler);
      return () => {
        unsubscribeCount += 1;
        handlers.delete(stream);
      };
    },
  };

  return {
    socket,
    emit(data: unknown) {
      for (const handler of handlers.values()) handler(data);
    },
    get connectCount() {
      return connectCount;
    },
    get subscribeCount() {
      return subscribeCount;
    },
    get unsubscribeCount() {
      return unsubscribeCount;
    },
    get activeSubscriptions() {
      return handlers.size;
    },
  };
}

function createHarness(
  options: {
    symbolInfo?: Record<string, SymbolInfo>;
    tickers?: Record<string, TickerData>;
  } = {},
) {
  let symbolInfo = options.symbolInfo ?? { BTCUSDT: BTC_INFO };
  let tickers = options.tickers ?? {};
  const setTickers = vi.fn((updates: Record<string, TickerData>) => {
    tickers = { ...tickers, ...updates };
  });
  const socket = createFakeSocket();
  const frames = createControlledFrameTask();
  const feed = createMiniTickerFeed({
    socket: socket.socket,
    frameTaskFactory: frames.factory,
    getSymbolInfo: () => symbolInfo,
    getTickers: () => tickers,
    setTickers,
  });

  return {
    feed,
    socket,
    frames,
    setTickers,
    getTickers: () => tickers,
    setSymbolInfo(next: Record<string, SymbolInfo>) {
      symbolInfo = next;
    },
  };
}

beforeEach(() => {
  useExchangeInfoStore.setState({ symbolInfo: {}, isBootstrapped: false });
  useTickerStore.setState({ tickers: {} });
});

afterEach(() => {
  cleanup();
  useExchangeInfoStore.setState({ symbolInfo: {}, isBootstrapped: false });
  useTickerStore.setState({ tickers: {} });
});

describe('createMiniTickerFeed', () => {
  it('commits only inside the frame callback', () => {
    const harness = createHarness();
    harness.feed.start();

    harness.socket.emit([makeRaw()]);

    expect(harness.frames.requestCount).toBe(1);
    expect(harness.setTickers).not.toHaveBeenCalled();

    harness.frames.flush();

    expect(harness.setTickers).toHaveBeenCalledTimes(1);
    const [updates] = harness.setTickers.mock.calls[0];
    expect(updates.BTCUSDT.lastPrice).toBe('101.00');
  });

  it('keeps only the latest payload per symbol per frame', () => {
    const harness = createHarness();
    harness.feed.start();

    harness.socket.emit([
      makeRaw('BTCUSDT', '101.00', 1_000),
      makeRaw('BTCUSDT', '102.00', 1_001),
    ]);
    harness.frames.flush();

    const [updates] = harness.setTickers.mock.calls[0];
    expect(updates.BTCUSDT.lastPrice).toBe('102.00');
    expect(updates.BTCUSDT.priceHistory).toEqual([102]);
    expect(Object.keys(updates)).toEqual(['BTCUSDT']);
  });

  it('ignores non-array, malformed, and non-default symbols', () => {
    const harness = createHarness();
    harness.feed.start();

    harness.socket.emit({ s: 'BTCUSDT' });
    harness.socket.emit([
      makeRaw('FAKEUSDT'),
      { ...makeRaw(), E: -1 },
      { ...makeRaw(), c: 'abc' },
      makeRaw('ETHUSDT'),
    ]);
    harness.frames.flush();

    expect(harness.setTickers).not.toHaveBeenCalled();
  });

  it('buffers latest values until exchange metadata is available', () => {
    const harness = createHarness({ symbolInfo: {} });
    harness.feed.start();

    harness.socket.emit([makeRaw()]);
    harness.frames.flush();

    expect(harness.setTickers).not.toHaveBeenCalled();

    harness.setSymbolInfo({ BTCUSDT: BTC_INFO });
    harness.feed.requestFlush();
    harness.frames.flush();

    expect(harness.setTickers).toHaveBeenCalledTimes(1);
    const [updates] = harness.setTickers.mock.calls[0];
    expect(updates.BTCUSDT.lastPrice).toBe('101.00');
  });

  it('skips symbols absent from exchange metadata', () => {
    const harness = createHarness({ symbolInfo: { ETHUSDT: ETH_INFO } });
    harness.feed.start();

    harness.socket.emit([makeRaw('BTCUSDT')]);
    harness.frames.flush();

    expect(harness.setTickers).not.toHaveBeenCalled();
  });

  it('shares one subscription between concurrent consumers', () => {
    const harness = createHarness();
    const releaseFirst = harness.feed.start();
    const releaseSecond = harness.feed.start();

    expect(harness.socket.subscribeCount).toBe(1);
    expect(harness.socket.connectCount).toBe(1);

    releaseFirst();
    expect(harness.socket.unsubscribeCount).toBe(0);

    harness.socket.emit([makeRaw()]);
    harness.frames.flush();
    expect(harness.setTickers).toHaveBeenCalledTimes(1);

    releaseSecond();
    expect(harness.socket.unsubscribeCount).toBe(1);
  });

  it('teardown unsubscribes, cancels frame work, and is idempotent', () => {
    const harness = createHarness();
    const release = harness.feed.start();

    harness.socket.emit([makeRaw()]);
    release();
    release();

    expect(harness.socket.unsubscribeCount).toBe(1);
    expect(harness.frames.cancelCount).toBe(1);

    harness.frames.flush();
    harness.socket.emit([makeRaw('BTCUSDT', '103.00', 1_002)]);
    harness.frames.flush();

    expect(harness.setTickers).not.toHaveBeenCalled();
  });

  it('keeps unrelated row identity when only one symbol updates', () => {
    const ethRow: TickerData = {
      symbol: 'ETHUSDT',
      lastPrice: '2.00',
      prevPrice: '1.90',
      priceChangePercent: 1,
      volume24h: '10',
      priceHistory: [2],
      flashDirection: null,
    };
    const btcRow: TickerData = {
      symbol: 'BTCUSDT',
      lastPrice: '100.00',
      prevPrice: '99.00',
      priceChangePercent: 1,
      volume24h: '1000',
      priceHistory: [100],
      flashDirection: null,
    };
    const harness = createHarness({
      symbolInfo: { BTCUSDT: BTC_INFO, ETHUSDT: ETH_INFO },
      tickers: { BTCUSDT: btcRow, ETHUSDT: ethRow },
    });
    harness.feed.start();

    harness.socket.emit([makeRaw()]);
    harness.frames.flush();

    expect(harness.getTickers().ETHUSDT).toBe(ethRow);
    expect(harness.getTickers().BTCUSDT).not.toBe(btcRow);
  });
});

describe('createTickerBootstrap', () => {
  it('performs one shared snapshot request per instance', async () => {
    const get24hrTickers = vi.fn().mockResolvedValue([
      {
        symbol: 'BTCUSDT',
        lastPrice: '101.00',
        priceChangePercent: '1.23000000',
        highPrice: '105.00',
        lowPrice: '99.00',
        quoteVolume: '1000.00000000',
        closeTime: 2_000,
      },
      {
        symbol: 'NOTSELECTED',
        lastPrice: '1',
        priceChangePercent: '1',
        highPrice: '1',
        lowPrice: '1',
        quoteVolume: '1',
        closeTime: 2_000,
      },
    ]);
    const setTickers = vi.fn();
    const bootstrap = createTickerBootstrap({
      rest: { get24hrTickers },
      getTickers: () => ({}),
      setTickers,
    });

    await Promise.all([bootstrap.run(), bootstrap.run()]);
    await bootstrap.run();

    expect(get24hrTickers).toHaveBeenCalledTimes(1);
    expect(get24hrTickers.mock.calls[0][0]).toEqual([...DEFAULT_SYMBOLS]);
    expect(setTickers).toHaveBeenCalledTimes(1);

    const [updates] = setTickers.mock.calls[0];
    expect(Object.keys(updates)).toEqual(['BTCUSDT']);
    expect(updates.BTCUSDT).toMatchObject({
      lastPrice: '101.00',
      priceChangePercent: 1.23,
      highPrice: '105.00',
      lowPrice: '99.00',
      volume24h: '1000',
      flashDirection: null,
      priceHistory: [],
    });
  });

  it('never lets an older snapshot replace fresher stream data', async () => {
    const live: TickerData = {
      symbol: 'BTCUSDT',
      lastPrice: '200.00',
      prevPrice: '199.00',
      priceChangePercent: 5,
      volume24h: '5000',
      priceHistory: [199, 200],
      flashDirection: 'up',
      lastEventTime: 3_000,
    };
    const setTickers = vi.fn();
    const bootstrap = createTickerBootstrap({
      rest: {
        get24hrTickers: vi.fn().mockResolvedValue([
          {
            symbol: 'BTCUSDT',
            lastPrice: '101.00',
            priceChangePercent: '1.23',
            highPrice: '105.00',
            lowPrice: '99.00',
            quoteVolume: '1000',
            closeTime: 2_000,
          },
        ]),
      },
      getTickers: () => ({ BTCUSDT: live }),
      setTickers,
    });

    await bootstrap.run();

    expect(setTickers).not.toHaveBeenCalled();
  });

  it('keeps the live feed usable when the snapshot fails', async () => {
    const get24hrTickers = vi.fn().mockRejectedValue(new Error('offline'));
    const setTickers = vi.fn();
    const bootstrap = createTickerBootstrap({
      rest: { get24hrTickers },
      getTickers: () => ({}),
      setTickers,
    });

    await expect(bootstrap.run()).resolves.toBeUndefined();
    await bootstrap.run();

    expect(get24hrTickers).toHaveBeenCalledTimes(1);
    expect(setTickers).not.toHaveBeenCalled();
  });

  it('ignores malformed snapshot rows without producing zero data', async () => {
    const setTickers = vi.fn();
    const bootstrap = createTickerBootstrap({
      rest: {
        get24hrTickers: vi.fn().mockResolvedValue([
          {
            symbol: 'BTCUSDT',
            lastPrice: '',
            priceChangePercent: 'oops',
            highPrice: '105.00',
            lowPrice: '99.00',
            quoteVolume: '1000',
            closeTime: 2_000,
          },
        ]),
      },
      getTickers: () => ({}),
      setTickers,
    });

    await bootstrap.run();

    expect(setTickers).not.toHaveBeenCalled();
  });
});

describe('useWsConnection', () => {
  it('subscribes once under StrictMode and bootstraps after metadata', () => {
    const fakeSocket = createFakeSocket();
    const feed = createMiniTickerFeed({
      socket: fakeSocket.socket,
      getSymbolInfo: () => useExchangeInfoStore.getState().symbolInfo,
      getTickers: () => useTickerStore.getState().tickers,
      setTickers: (updates) => useTickerStore.getState().setTickers(updates),
      frameTaskFactory: (callback) => ({
        request: () => callback(),
        flush: () => {},
        cancel: () => {},
      }),
    });
    const run = vi.fn().mockResolvedValue(undefined);
    const bootstrap: TickerBootstrap = { run };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );

    const { unmount } = renderHook(() => useWsConnection({ feed, bootstrap }), {
      wrapper,
    });

    expect(fakeSocket.activeSubscriptions).toBe(1);
    expect(run).not.toHaveBeenCalled();

    act(() => {
      useExchangeInfoStore.getState().setSymbolInfo({ BTCUSDT: BTC_INFO });
    });

    expect(run).toHaveBeenCalledTimes(1);

    unmount();
    expect(fakeSocket.activeSubscriptions).toBe(0);
    expect(fakeSocket.unsubscribeCount).toBeGreaterThanOrEqual(1);
  });
});
