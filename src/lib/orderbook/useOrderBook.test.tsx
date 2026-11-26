// @vitest-environment jsdom

import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOrderBook, useOrderBookSelector } from '../../hooks/useOrderBook';
import type { BookViewLevel, OrderBookView } from '../../models/market';
import { orderBookRegistry, type OrderBookController } from './controller';
import { createEmptyOrderBookView } from './orderBook';

function liveView(symbol: string): OrderBookView {
  const bid: BookViewLevel = {
    price: '99',
    quantity: '1',
    cumulativeQuantity: '1',
    depthRatio: 1,
  };
  const ask: BookViewLevel = {
    price: '101',
    quantity: '2',
    cumulativeQuantity: '2',
    depthRatio: 1,
  };
  return {
    ...createEmptyOrderBookView(symbol, 'live'),
    bids: [bid],
    asks: [ask],
    spread: '2',
    spreadBps: '200',
    lastUpdateId: 101,
  };
}

function fakeController(symbol: string) {
  let view = liveView(symbol);
  const listeners = new Set<() => void>();
  const controller: OrderBookController = {
    symbol,
    start: vi.fn(),
    stop: vi.fn(() => listeners.clear()),
    getSnapshot: () => view,
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    }),
  };

  return {
    controller,
    emit(next: OrderBookView) {
      view = next;
      for (const listener of Array.from(listeners)) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function mockRegistry() {
  const fakes = new Map<string, ReturnType<typeof fakeController>>();
  const releases = new Map<string, number>();
  const acquire = vi
    .spyOn(orderBookRegistry, 'acquire')
    .mockImplementation((symbol) => {
      let fake = fakes.get(symbol);
      if (!fake) {
        fake = fakeController(symbol);
        fakes.set(symbol, fake);
      }
      fake.controller.start();
      let released = false;
      return {
        controller: fake.controller,
        release() {
          if (released) return;
          released = true;
          releases.set(symbol, (releases.get(symbol) ?? 0) + 1);
          fake.controller.stop();
        },
      };
    });

  return { fakes, releases, acquire };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useOrderBook', () => {
  it('subscribes to the symbol controller and exposes its full stable view', () => {
    const registry = mockRegistry();
    const { result, rerender } = renderHook(() => useOrderBook('BTCUSDT'));

    expect(result.current.state).toBe('live');
    expect(result.current.symbol).toBe('BTCUSDT');
    const view = result.current;
    rerender();
    expect(result.current).toBe(view);
    expect(registry.fakes.get('BTCUSDT')?.listenerCount()).toBe(1);
  });

  it('tears down the old symbol during rapid navigation', () => {
    const registry = mockRegistry();
    const { result, rerender } = renderHook(
      ({ symbol }) => useOrderBook(symbol),
      { initialProps: { symbol: 'BTCUSDT' } },
    );
    const bitcoin = registry.fakes.get('BTCUSDT')!;
    expect(result.current.symbol).toBe('BTCUSDT');

    rerender({ symbol: 'ETHUSDT' });
    expect(result.current.symbol).toBe('ETHUSDT');
    expect(bitcoin.controller.stop).toHaveBeenCalledTimes(1);
    expect(bitcoin.listenerCount()).toBe(0);

    rerender({ symbol: 'SOLUSDT' });
    expect(result.current.symbol).toBe('SOLUSDT');
    expect(registry.fakes.get('ETHUSDT')?.listenerCount()).toBe(0);
    expect(registry.releases.get('BTCUSDT')).toBe(1);
    expect(registry.releases.get('ETHUSDT')).toBe(1);

    act(() => bitcoin.emit({ ...liveView('BTCUSDT'), gapCount: 10 }));
    expect(result.current.symbol).toBe('SOLUSDT');
    expect(result.current.gapCount).toBe(0);
  });

  it('keeps a selected row and cached object selection referentially stable', () => {
    mockRegistry();
    const row = renderHook(() =>
      useOrderBookSelector('BTCUSDT', (view) => view.bids[0]),
    );
    expect(row.result.current.price).toBe('99');
    const stableRow = row.result.current;
    row.rerender();
    expect(row.result.current).toBe(stableRow);

    const selector = vi.fn((view: OrderBookView) => ({
      bestBid: view.bids[0]?.price,
    }));
    const selected = renderHook(() => useOrderBook('BTCUSDT', selector));
    const stableSelection = selected.result.current;
    expect(stableSelection).toEqual({ bestBid: '99' });
    selected.rerender();
    selected.rerender();
    expect(selected.result.current).toBe(stableSelection);
  });

  it('cleans up StrictMode mount, replayed unmount, and final unmount', () => {
    const registry = mockRegistry();
    const { result, unmount } = renderHook(() => useOrderBook('BTCUSDT'), {
      reactStrictMode: true,
    });

    expect(result.current.state).toBe('live');
    expect(registry.acquire).toHaveBeenCalledTimes(2);
    expect(
      registry.fakes.get('BTCUSDT')?.controller.start,
    ).toHaveBeenCalledTimes(2);
    expect(
      registry.fakes.get('BTCUSDT')?.controller.stop,
    ).toHaveBeenCalledTimes(1);
    expect(registry.fakes.get('BTCUSDT')?.listenerCount()).toBe(1);

    unmount();
    expect(
      registry.fakes.get('BTCUSDT')?.controller.stop,
    ).toHaveBeenCalledTimes(2);
    expect(registry.fakes.get('BTCUSDT')?.listenerCount()).toBe(0);
  });

  it('does not acquire a shared controller during an abandoned render', () => {
    const registry = mockRegistry();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    function Abandoned(): never {
      useOrderBook('BTCUSDT');
      throw new Error('abandoned render');
    }

    expect(() => render(createElement(Abandoned))).toThrow('abandoned render');
    expect(registry.acquire).not.toHaveBeenCalled();
  });
});
