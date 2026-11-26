// @vitest-environment jsdom

import { StrictMode, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FrameTask } from '../lib/frameTask';
import { useKlines } from './useKlines';

const START_TIME = 1_700_000_000;

function restRow(timeSeconds: number, close: string): unknown[] {
  return [
    timeSeconds * 1000,
    close,
    close,
    close,
    close,
    '0',
    timeSeconds * 1000 + 59_999,
    '0',
    0,
    '0',
    '0',
    '0',
  ];
}

function payloadFor(
  closes: string[],
  startTime = START_TIME,
  intervalSeconds = 60,
): unknown[] {
  return closes.map((close, index) =>
    restRow(startTime + index * intervalSeconds, close),
  );
}

function klineEvent(
  symbol: string,
  interval: string,
  timeSeconds: number,
  close: string,
): unknown {
  return {
    e: 'kline',
    E: timeSeconds * 1000 + 1,
    s: symbol,
    k: {
      t: timeSeconds * 1000,
      T: timeSeconds * 1000 + 59_999,
      s: symbol,
      i: interval,
      o: close,
      c: close,
      h: close,
      l: close,
      v: '1',
      n: 1,
      x: false,
      q: '1',
      V: '1',
      Q: '1',
      B: '0',
    },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function frameTaskDouble(): FrameTask {
  return {
    request: vi.fn(),
    flush: vi.fn(),
    cancel: vi.fn(),
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useKlines', () => {
  it('loads exact-decimal candles and aligns the EMA series', async () => {
    const payload = payloadFor(Array.from({ length: 25 }, () => '100'));
    const fetchKlines = vi.fn().mockResolvedValue(payload);
    const subscribe = vi.fn(() => vi.fn());
    const createFrameTask = vi.fn(() => frameTaskDouble());

    const { result } = renderHook(() =>
      useKlines('btcusdt', '1m', {
        fetchKlines,
        subscribe,
        createFrameTask,
      }),
    );

    await settle();

    expect(fetchKlines).toHaveBeenCalledWith(
      'BTCUSDT',
      '1m',
      500,
      expect.any(AbortSignal),
    );
    expect(subscribe).toHaveBeenCalledWith(
      'btcusdt@kline_1m',
      expect.any(Function),
    );
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
    expect(result.current.candles).toHaveLength(25);
    expect(result.current.candles[0]).toEqual({
      time: START_TIME,
      open: '100',
      high: '100',
      low: '100',
      close: '100',
    });
    expect(result.current.ema).toHaveLength(6);
    expect(result.current.ema[0]).toEqual({
      time: START_TIME + 19 * 60,
      value: '100',
    });
  });

  it('never lets an older symbol response replace the current symbol', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const fetchKlines = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const subscribe = vi.fn(() => vi.fn());
    const createFrameTask = vi.fn(() => frameTaskDouble());

    const { result, rerender } = renderHook(
      ({ symbol }: { symbol: string }) =>
        useKlines(symbol, '1m', {
          fetchKlines,
          subscribe,
          createFrameTask,
        }),
      { initialProps: { symbol: 'AAAUSDT' } },
    );

    rerender({ symbol: 'BBBUSDT' });

    const firstSignal = fetchKlines.mock.calls[0][3] as AbortSignal;
    expect(firstSignal.aborted).toBe(true);

    await act(async () => {
      second.resolve(payloadFor(Array.from({ length: 22 }, () => '200')));
      await Promise.resolve();
    });

    expect(result.current.candles[0].close).toBe('200');
    expect(result.current.status).toBe('ready');

    await act(async () => {
      first.resolve(payloadFor(Array.from({ length: 22 }, () => '100')));
      await Promise.resolve();
    });

    expect(result.current.candles[0].close).toBe('200');
    expect(result.current.candles).toHaveLength(22);
  });

  it('coalesces websocket updates until a frame flush and keeps the latest bar', async () => {
    const payload = payloadFor(Array.from({ length: 25 }, () => '100'));
    const fetchKlines = vi.fn().mockResolvedValue(payload);
    const unsubscribe = vi.fn();
    let handler: ((payload: unknown) => void) | null = null;
    const subscribe = vi.fn(
      (_stream: string, next: (payload: unknown) => void) => {
        handler = next;
        return unsubscribe;
      },
    );

    let flushFrame: (() => void) | null = null;
    const task = frameTaskDouble();
    const createFrameTask = vi.fn((callback: () => void) => {
      flushFrame = callback;
      return task;
    });

    const { result } = renderHook(() =>
      useKlines('BTCUSDT', '1m', {
        fetchKlines,
        subscribe,
        createFrameTask,
      }),
    );

    await settle();

    const liveTime = START_TIME + 24 * 60;
    expect(handler).toBeTypeOf('function');
    act(() => {
      handler?.(klineEvent('BTCUSDT', '1m', liveTime, '101'));
      handler?.(klineEvent('BTCUSDT', '1m', liveTime, '103'));
    });

    expect(task.request).toHaveBeenCalledTimes(2);
    expect(result.current.candles[24].close).toBe('100');
    expect(result.current.ema[5].value).toBe('100');

    act(() => {
      flushFrame?.();
    });

    expect(result.current.candles[24].close).toBe('103');
    expect(result.current.candles).toHaveLength(25);
    expect(result.current.updateKind).toBe('update');
    expect(result.current.ema[5]).toEqual({
      time: liveTime,
      value: '100.285714285714',
    });
  });

  it('resyncs instead of fabricating a bar when the stream skips an interval', async () => {
    const initial = payloadFor(Array.from({ length: 25 }, () => '100'));
    const backfill = [
      ...initial,
      restRow(START_TIME + 25 * 60, '101'),
      restRow(START_TIME + 26 * 60, '102'),
    ];
    const fetchKlines = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(backfill);
    let handler: ((payload: unknown) => void) | null = null;
    const subscribe = vi.fn(
      (_stream: string, next: (payload: unknown) => void) => {
        handler = next;
        return vi.fn();
      },
    );
    let flushFrame: (() => void) | null = null;
    const createFrameTask = vi.fn((callback: () => void) => {
      flushFrame = callback;
      return frameTaskDouble();
    });

    const { result } = renderHook(() =>
      useKlines('BTCUSDT', '1m', {
        fetchKlines,
        subscribe,
        createFrameTask,
      }),
    );

    await settle();
    expect(result.current.status).toBe('ready');

    act(() => {
      handler?.(klineEvent('BTCUSDT', '1m', START_TIME + 26 * 60, '102'));
      flushFrame?.();
    });

    expect(fetchKlines).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('resyncing');
    expect(result.current.candles).toHaveLength(25);
    expect(
      result.current.candles.some(
        (candle) => candle.time === START_TIME + 25 * 60,
      ),
    ).toBe(false);

    await settle();

    expect(result.current.status).toBe('ready');
    expect(result.current.candles).toHaveLength(27);
    expect(result.current.candles.map((candle) => candle.time)).toEqual(
      Array.from({ length: 27 }, (_, index) => START_TIME + index * 60),
    );
  });

  it('backfills on the next open after a disconnect and keeps stale candles visible', async () => {
    const initial = payloadFor(Array.from({ length: 25 }, () => '100'));
    const backfill = payloadFor(Array.from({ length: 30 }, () => '110'));
    const fetchKlines = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(backfill);
    let statusHandler: ((status: string) => void) | null = null;
    const subscribeStatus = vi.fn((next: (status: string) => void) => {
      statusHandler = next;
      return vi.fn();
    });
    const createFrameTask = vi.fn(() => frameTaskDouble());

    const { result } = renderHook(() =>
      useKlines('BTCUSDT', '1m', {
        fetchKlines,
        subscribe: vi.fn(() => vi.fn()),
        subscribeStatus,
        getStatus: () => 'open',
        createFrameTask,
      }),
    );

    await settle();
    expect(result.current.status).toBe('ready');

    act(() => {
      statusHandler?.('closed');
    });

    expect(result.current.status).toBe('resyncing');
    expect(result.current.candles).toHaveLength(25);
    expect(result.current.candles[0].close).toBe('100');
    expect(fetchKlines).toHaveBeenCalledTimes(1);

    act(() => {
      statusHandler?.('reconnecting');
    });
    expect(result.current.status).toBe('resyncing');

    act(() => {
      statusHandler?.('open');
    });

    expect(fetchKlines).toHaveBeenCalledTimes(2);
    expect(fetchKlines).toHaveBeenLastCalledWith(
      'BTCUSDT',
      '1m',
      500,
      expect.any(AbortSignal),
    );

    await settle();

    expect(result.current.status).toBe('ready');
    expect(result.current.candles).toHaveLength(30);
    expect(result.current.candles[0].close).toBe('110');

    act(() => {
      statusHandler?.('open');
    });
    expect(fetchKlines).toHaveBeenCalledTimes(2);
  });

  it('never lets an older fetch override a newer reconnect backfill', async () => {
    const initial = deferred<unknown>();
    const backfill = deferred<unknown>();
    const fetchKlines = vi
      .fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(backfill.promise);
    let statusHandler: ((status: string) => void) | null = null;
    const subscribeStatus = vi.fn((next: (status: string) => void) => {
      statusHandler = next;
      return vi.fn();
    });
    const createFrameTask = vi.fn(() => frameTaskDouble());

    const { result } = renderHook(() =>
      useKlines('BTCUSDT', '1m', {
        fetchKlines,
        subscribe: vi.fn(() => vi.fn()),
        subscribeStatus,
        getStatus: () => 'open',
        createFrameTask,
      }),
    );

    act(() => {
      statusHandler?.('closed');
      statusHandler?.('open');
    });

    await act(async () => {
      backfill.resolve(payloadFor(Array.from({ length: 22 }, () => '200')));
      await Promise.resolve();
    });

    expect(result.current.candles[0].close).toBe('200');
    expect(result.current.status).toBe('ready');

    await act(async () => {
      initial.resolve(payloadFor(Array.from({ length: 22 }, () => '100')));
      await Promise.resolve();
    });

    expect(result.current.candles[0].close).toBe('200');
    expect(result.current.candles).toHaveLength(22);
  });

  it('retains only the most recent 500 candles as live bars arrive', async () => {
    const initial = payloadFor(Array.from({ length: 500 }, () => '100'));
    const fetchKlines = vi.fn().mockResolvedValue(initial);
    let handler: ((payload: unknown) => void) | null = null;
    const subscribe = vi.fn(
      (_stream: string, next: (payload: unknown) => void) => {
        handler = next;
        return vi.fn();
      },
    );
    let flushFrame: (() => void) | null = null;
    const createFrameTask = vi.fn((callback: () => void) => {
      flushFrame = callback;
      return frameTaskDouble();
    });

    const { result } = renderHook(() =>
      useKlines('BTCUSDT', '1m', {
        fetchKlines,
        subscribe,
        createFrameTask,
      }),
    );

    await settle();
    expect(result.current.candles).toHaveLength(500);

    const nextTime = START_TIME + 500 * 60;
    act(() => {
      handler?.(klineEvent('BTCUSDT', '1m', nextTime, '101'));
      flushFrame?.();
    });

    expect(result.current.candles).toHaveLength(500);
    expect(result.current.candles[0].time).toBe(START_TIME + 60);
    expect(result.current.candles[499].time).toBe(nextTime);
  });

  it('exposes an error and retry when a resync is still discontinuous', async () => {
    const initial = payloadFor(Array.from({ length: 25 }, () => '100'));
    const discontinuous = [...initial, restRow(START_TIME + 27 * 60, '102')];
    const fetchKlines = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(discontinuous);
    let handler: ((payload: unknown) => void) | null = null;
    const subscribe = vi.fn(
      (_stream: string, next: (payload: unknown) => void) => {
        handler = next;
        return vi.fn();
      },
    );
    let flushFrame: (() => void) | null = null;
    const createFrameTask = vi.fn((callback: () => void) => {
      flushFrame = callback;
      return frameTaskDouble();
    });

    const { result } = renderHook(() =>
      useKlines('BTCUSDT', '1m', {
        fetchKlines,
        subscribe,
        createFrameTask,
      }),
    );

    await settle();

    act(() => {
      handler?.(klineEvent('BTCUSDT', '1m', START_TIME + 26 * 60, '101'));
      flushFrame?.();
    });

    await settle();

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBeTypeOf('string');
    expect(result.current.retry).toBeTypeOf('function');
  });

  it('tears down the fetch, socket and frame task on unmount', async () => {
    const payload = payloadFor(
      Array.from({ length: 21 }, () => '50'),
      START_TIME,
      300,
    );
    const fetchKlines = vi.fn().mockResolvedValue(payload);
    const unsubscribe = vi.fn();
    let handler: ((payload: unknown) => void) | null = null;
    const subscribe = vi.fn(
      (_stream: string, next: (payload: unknown) => void) => {
        handler = next;
        return unsubscribe;
      },
    );
    const task = frameTaskDouble();
    const createFrameTask = vi.fn(() => task);

    const { result, unmount } = renderHook(() =>
      useKlines('ETHUSDT', '5m', {
        fetchKlines,
        subscribe,
        createFrameTask,
      }),
    );

    await settle();
    expect(result.current.status).toBe('ready');

    const signal = fetchKlines.mock.calls[0][3] as AbortSignal;
    const requestsBeforeUnmount = vi.mocked(task.request).mock.calls.length;

    unmount();

    expect(signal.aborted).toBe(true);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(task.cancel).toHaveBeenCalledTimes(1);

    act(() => {
      handler?.(klineEvent('ETHUSDT', '5m', START_TIME, '60'));
    });
    expect(vi.mocked(task.request).mock.calls.length).toBe(
      requestsBeforeUnmount,
    );
  });

  it('leaves exactly one subscription after a StrictMode effect replay', async () => {
    const payload = payloadFor(
      Array.from({ length: 20 }, () => '10'),
      START_TIME,
      900,
    );
    const fetchKlines = vi.fn().mockResolvedValue(payload);
    const activeHandlers = new Set<(payload: unknown) => void>();
    const subscribe = vi.fn(
      (_stream: string, handler: (payload: unknown) => void) => {
        activeHandlers.add(handler);
        return () => activeHandlers.delete(handler);
      },
    );
    const createFrameTask = vi.fn(() => frameTaskDouble());

    function Wrapper({ children }: { children: ReactNode }) {
      return <StrictMode>{children}</StrictMode>;
    }

    const { result, unmount } = renderHook(
      () =>
        useKlines('SOLUSDT', '15m', {
          fetchKlines,
          subscribe,
          createFrameTask,
        }),
      { wrapper: Wrapper },
    );

    await settle();

    expect(result.current.status).toBe('ready');
    expect(activeHandlers.size).toBe(1);

    unmount();
    expect(activeHandlers.size).toBe(0);
  });
});
