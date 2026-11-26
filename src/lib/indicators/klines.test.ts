import { describe, expect, it } from 'vitest';

import {
  buildKlineSeries,
  klineStreamName,
  KlineParseError,
  mergeCandleUpdate,
  mergeCandleUpdates,
  parseKlineEvent,
  parseRestKlines,
  type Candle,
} from './klines';

function restRow(
  timeSeconds: number,
  open: string,
  high: string,
  low: string,
  close: string,
): unknown[] {
  return [
    timeSeconds * 1000,
    open,
    high,
    low,
    close,
    '12.5',
    timeSeconds * 1000 + 59_999,
    '1250',
    4,
    '6',
    '600',
    '0',
  ];
}

function candle(time: number, close: string): Candle {
  return { time, open: close, high: close, low: close, close };
}

function klineEvent(
  symbol: string,
  interval: string,
  value: Candle,
  closed = false,
): unknown {
  return {
    e: 'kline',
    E: value.time * 1000 + 1,
    s: symbol,
    k: {
      t: value.time * 1000,
      T: value.time * 1000 + 59_999,
      s: symbol,
      i: interval,
      f: 1,
      L: 2,
      o: value.open,
      c: value.close,
      h: value.high,
      l: value.low,
      v: '1',
      n: 2,
      x: closed,
      q: '1',
      V: '1',
      Q: '1',
      B: '0',
    },
  };
}

describe('parseRestKlines', () => {
  it('parses tuples into exact-decimal candles sorted by time', () => {
    const payload = [
      restRow(120, '2.00000001', '2.5', '1.9', '2.4'),
      restRow(60, '1.00000001', '1.5', '0.9', '1.4'),
    ];

    expect(parseRestKlines(payload)).toEqual([
      {
        time: 60,
        open: '1.00000001',
        high: '1.5',
        low: '0.9',
        close: '1.4',
      },
      {
        time: 120,
        open: '2.00000001',
        high: '2.5',
        low: '1.9',
        close: '2.4',
      },
    ]);
  });

  it('keeps the latest row when open times repeat', () => {
    const payload = [
      restRow(60, '1', '2', '1', '1.5'),
      restRow(60, '1', '3', '1', '2.5'),
    ];

    expect(parseRestKlines(payload)).toEqual([
      { time: 60, open: '1', high: '3', low: '1', close: '2.5' },
    ]);
  });

  it('returns an empty series for an empty response', () => {
    expect(parseRestKlines([])).toEqual([]);
  });

  it('rejects malformed payloads instead of passing them to the chart', () => {
    const invalidPayloads: unknown[] = [
      null,
      {},
      'klines',
      [restRow(60, '1', '1', '1', '1'), []],
      [restRow(60, '1', '1', '1', '1'), ['60', '1', '1', '1', '1']],
      [restRow(-1, '1', '1', '1', '1')],
      [['1.5', '1', '1', '1', '1', '0']],
      [restRow(60, '1e3', '1', '1', '1')],
      [restRow(60, '1', 'abc', '1', '1')],
      [restRow(60, '1', '1', '1', '')],
    ];

    for (const payload of invalidPayloads) {
      expect(() => parseRestKlines(payload)).toThrow(KlineParseError);
    }
  });
});

describe('parseKlineEvent', () => {
  it('validates and converts a live kline envelope', () => {
    const payload = klineEvent('BTCUSDT', '5m', candle(1_700_000_000, '42.5'));

    expect(parseKlineEvent(payload)).toEqual({
      symbol: 'BTCUSDT',
      interval: '5m',
      candle: {
        time: 1_700_000_000,
        open: '42.5',
        high: '42.5',
        low: '42.5',
        close: '42.5',
      },
    });
  });

  it('accepts a closed bar', () => {
    const payload = klineEvent(
      'ETHUSDT',
      '1h',
      candle(1_700_000_000, '1'),
      true,
    );

    expect(parseKlineEvent(payload)?.interval).toBe('1h');
  });

  it('rejects incomplete or malformed envelopes', () => {
    const valid = klineEvent(
      'BTCUSDT',
      '1m',
      candle(1_700_000_000, '1'),
    ) as Record<string, unknown>;
    const kline = valid.k as Record<string, unknown>;

    const invalid: unknown[] = [
      null,
      undefined,
      1,
      'kline',
      [],
      {},
      { ...valid, e: 'trade' },
      { ...valid, s: '' },
      { ...valid, k: null },
      { ...valid, k: { ...kline, s: '' } },
      { ...valid, k: { ...kline, i: '' } },
      { ...valid, k: { ...kline, t: -1 } },
      { ...valid, k: { ...kline, t: '1700000000000' } },
      { ...valid, k: { ...kline, o: 'abc' } },
      { ...valid, k: { ...kline, h: 1 } },
      { ...valid, k: { ...kline, l: '' } },
      { ...valid, k: { ...kline, c: '1e3' } },
      { ...valid, k: { ...kline, x: 'false' } },
    ];

    for (const payload of invalid) {
      expect(parseKlineEvent(payload)).toBeNull();
    }
  });
});

describe('klineStreamName', () => {
  it('uses the lowercase symbol and interval for the shared stream', () => {
    expect(klineStreamName('BTCUSDT', '15m')).toBe('btcusdt@kline_15m');
    expect(klineStreamName('ethusdt', '1d')).toBe('ethusdt@kline_1d');
  });
});

describe('mergeCandleUpdate', () => {
  it('replaces the latest bar in place', () => {
    const candles = [candle(60, '1.5'), candle(120, '2.5')];
    const next = mergeCandleUpdate(candles, candle(120, '2.75'));

    expect(next).toHaveLength(2);
    expect(next[1].close).toBe('2.75');
    expect(candles[1].close).toBe('2.5');
  });

  it('appends a newer bar', () => {
    const next = mergeCandleUpdate([candle(60, '1')], candle(120, '2'));

    expect(next.map((item) => item.time)).toEqual([60, 120]);
  });

  it('ignores stale bars and unchanged updates', () => {
    const candles = [candle(60, '1'), candle(120, '2')];

    expect(mergeCandleUpdate(candles, candle(60, '9'))).toBe(candles);
    expect(mergeCandleUpdate(candles, candle(120, '2'))).toBe(candles);
  });

  it('coalesces multiple updates with the latest value per bar', () => {
    const next = mergeCandleUpdates(
      [candle(60, '1')],
      [candle(120, '4'), candle(120, '3'), candle(180, '5')],
    );

    expect(next.map((item) => [item.time, item.close])).toEqual([
      [60, '1'],
      [120, '3'],
      [180, '5'],
    ]);
  });
});

describe('buildKlineSeries', () => {
  it('aligns EMA points with candle times after the seed window', () => {
    const candles = Array.from({ length: 25 }, (_, index) =>
      candle(60 * (index + 1), '100'),
    );
    const snapshot = buildKlineSeries(candles);

    expect(snapshot.candles).toHaveLength(25);
    expect(snapshot.ema).toHaveLength(6);
    expect(snapshot.ema[0]).toEqual({ time: 60 * 20, value: '100' });
    expect(snapshot.ema[5]).toEqual({ time: 60 * 25, value: '100' });
  });

  it('keeps the result empty without history', () => {
    expect(buildKlineSeries([])).toEqual({ candles: [], ema: [] });
  });
});
