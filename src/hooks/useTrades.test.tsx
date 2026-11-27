// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradeView } from '../models/market';
import type { TradeFeed } from '../lib/trades/tradeFeed';
import { createTradeFeed } from '../lib/trades/tradeFeed';
import { useTrades } from './useTrades';

vi.mock('../lib/trades/tradeFeed', () => ({
  createTradeFeed: vi.fn(),
}));

type FakeFeed = {
  symbol: string;
  getTrades: () => readonly TradeView[];
  subscribe: (listener: () => void) => () => void;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  emit: (next: readonly TradeView[]) => void;
  listenerCount: () => number;
};

const createFeedMock = vi.mocked(createTradeFeed);
const created: FakeFeed[] = [];

function makeFakeFeed(symbol: string): FakeFeed {
  let trades: readonly TradeView[] = [];
  const listeners = new Set<() => void>();

  return {
    symbol,
    getTrades: () => trades,
    subscribe(listener) {
      listeners.add(listener);
      let active = true;

      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
    start: vi.fn(),
    stop: vi.fn(() => {
      listeners.clear();
    }),
    emit(next) {
      trades = next;
      for (const listener of Array.from(listeners)) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function activeFeed(symbol: string): FakeFeed {
  const feed = created.find(
    (candidate) =>
      candidate.symbol === symbol && candidate.start.mock.calls.length > 0,
  );
  if (!feed) throw new Error(`No active feed for ${symbol}`);
  return feed;
}

const trade = (id: number): TradeView => ({
  id,
  time: 1_700_000_000_000 + id,
  price: '100.50',
  quantity: '2.00',
  isBuyerMaker: false,
});

beforeEach(() => {
  created.length = 0;
  createFeedMock.mockReset();
  createFeedMock.mockImplementation((symbol: string) => {
    const feed = makeFakeFeed(symbol);
    created.push(feed);
    return feed as unknown as TradeFeed;
  });
});

afterEach(cleanup);

describe('useTrades', () => {
  it('starts the symbol feed and exposes its newest-first snapshot', () => {
    const { result } = renderHook(() => useTrades('BTCUSDT'));
    const feed = activeFeed('BTCUSDT');

    expect(createFeedMock).toHaveBeenCalledWith('BTCUSDT');
    expect(feed.start).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([]);

    act(() => feed.emit([trade(2), trade(1)]));
    expect(result.current.map((item) => item.id)).toEqual([2, 1]);
  });

  it('tears down the old feed during rapid symbol navigation', () => {
    const { result, rerender } = renderHook(({ symbol }) => useTrades(symbol), {
      initialProps: { symbol: 'BTCUSDT' },
    });
    const bitcoin = activeFeed('BTCUSDT');

    act(() => bitcoin.emit([trade(1)]));
    expect(result.current).toHaveLength(1);

    rerender({ symbol: 'ETHUSDT' });
    expect(bitcoin.stop).toHaveBeenCalledTimes(1);
    expect(bitcoin.listenerCount()).toBe(0);
    expect(activeFeed('ETHUSDT').start).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([]);

    rerender({ symbol: 'SOLUSDT' });
    expect(activeFeed('ETHUSDT').stop).toHaveBeenCalledTimes(1);
    expect(activeFeed('SOLUSDT').start).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([]);
  });

  it('survives StrictMode subscription replay', () => {
    const { unmount } = renderHook(() => useTrades('BTCUSDT'), {
      reactStrictMode: true,
    });
    const feed = activeFeed('BTCUSDT');

    expect(feed.start).toHaveBeenCalledTimes(2);
    expect(feed.stop).toHaveBeenCalledTimes(1);
    expect(feed.listenerCount()).toBe(1);

    unmount();
    expect(feed.stop).toHaveBeenCalledTimes(2);
    expect(feed.listenerCount()).toBe(0);
  });
});
