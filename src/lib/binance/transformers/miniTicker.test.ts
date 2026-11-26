import { describe, expect, it } from 'vitest';

import type { TickerData } from '../../../models';
import {
  isMiniTickerRaw,
  mergeTickerSnapshot,
  transformMiniTicker,
  transformTicker24hr,
  type MiniTickerRaw,
  type Ticker24hrSnapshot,
} from './miniTicker';

function makeRaw(overrides: Partial<MiniTickerRaw> = {}): MiniTickerRaw {
  return {
    e: '24hrMiniTicker',
    E: 1_700_000_000_000,
    s: 'BTCUSDT',
    c: '101.00',
    o: '100.00',
    h: '105.00',
    l: '99.00',
    v: '10.00000000',
    q: '1000.00000000',
    ...overrides,
  };
}

function makeTicker(overrides: Partial<TickerData> = {}): TickerData {
  return {
    symbol: 'BTCUSDT',
    lastPrice: '100.00',
    prevPrice: '99.00',
    priceChangePercent: 0,
    volume24h: '900',
    priceHistory: [98, 99, 100],
    flashDirection: 'up',
    lastEventTime: 1_000,
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<Ticker24hrSnapshot> = {},
): Ticker24hrSnapshot {
  return {
    symbol: 'BTCUSDT',
    lastPrice: '101.00',
    priceChangePercent: 1.23,
    highPrice: '105.00',
    lowPrice: '99.00',
    quoteVolume: '1000.00000000',
    closeTime: 2_000,
    ...overrides,
  };
}

describe('isMiniTickerRaw', () => {
  it('accepts a payload with the consumed fields', () => {
    expect(isMiniTickerRaw(makeRaw())).toBe(true);
  });

  it('rejects non-objects and consumed fields with the wrong type', () => {
    for (const value of [null, undefined, 1, 'BTCUSDT', [], {}]) {
      expect(isMiniTickerRaw(value)).toBe(false);
    }

    expect(isMiniTickerRaw(makeRaw({ s: 1 as unknown as string }))).toBe(false);
    expect(isMiniTickerRaw(makeRaw({ E: -1 }))).toBe(false);
    expect(isMiniTickerRaw(makeRaw({ E: 1.5 }))).toBe(false);
    expect(isMiniTickerRaw(makeRaw({ c: 'abc' }))).toBe(false);
    expect(isMiniTickerRaw(makeRaw({ o: '1e3' }))).toBe(false);
    expect(isMiniTickerRaw(makeRaw({ h: '' }))).toBe(false);
    expect(
      isMiniTickerRaw(makeRaw({ l: undefined as unknown as string })),
    ).toBe(false);
    expect(isMiniTickerRaw(makeRaw({ q: 'NaN' }))).toBe(false);
  });

  it('ignores unconsumed extra fields', () => {
    const raw = { ...makeRaw(), extra: { nested: true } };
    expect(isMiniTickerRaw(raw)).toBe(true);
  });
});

describe('transformMiniTicker', () => {
  it('keeps exact prices and quote volume and records the event time', () => {
    const result = transformMiniTicker(makeRaw());

    expect(result).toEqual({
      symbol: 'BTCUSDT',
      lastPrice: '101.00',
      prevPrice: '101.00',
      priceChangePercent: 1,
      priceHistory: [101],
      flashDirection: null,
      volume24h: '1000',
      highPrice: '105.00',
      lowPrice: '99.00',
      lastEventTime: 1_700_000_000_000,
    });
  });

  it('uses exact decimal arithmetic for the percentage and flash', () => {
    const result = transformMiniTicker(
      makeRaw({ c: '0.1', o: '0.3', E: 2_000 }),
      makeTicker({ lastPrice: '0.2', lastEventTime: 1_000 }),
    );

    expect(result).not.toBeNull();
    expect(result!.priceChangePercent).toBeCloseTo(-66.66666666, 6);
    expect(result!.flashDirection).toBe('down');
    expect(result!.prevPrice).toBe('0.2');
  });

  it('reports up, down, and unchanged directions', () => {
    const existing = makeTicker({ lastPrice: '100.00' });

    expect(
      transformMiniTicker(makeRaw({ c: '100.00000001' }), existing)
        ?.flashDirection,
    ).toBe('up');
    expect(
      transformMiniTicker(makeRaw({ c: '99.99999999' }), existing)
        ?.flashDirection,
    ).toBe('down');
    expect(
      transformMiniTicker(makeRaw({ c: '100.00' }), existing)?.flashDirection,
    ).toBeNull();
  });

  it('appends validated numeric history and caps it at 60 points', () => {
    const history = Array.from({ length: 60 }, (_, index) => index);
    const result = transformMiniTicker(
      makeRaw({ c: '123.45000000' }),
      makeTicker({ priceHistory: history }),
    );

    expect(result!.priceHistory).toHaveLength(60);
    expect(result!.priceHistory[59]).toBe(123.45);
  });

  it('drops stale events instead of replacing fresher stream data', () => {
    const existing = makeTicker({ lastEventTime: 2_000 });

    expect(transformMiniTicker(makeRaw({ E: 1_999 }), existing)).toBeNull();
    expect(transformMiniTicker(makeRaw({ E: 2_000 }), existing)).not.toBeNull();
  });

  it('returns null for malformed input rather than zero values', () => {
    expect(transformMiniTicker(makeRaw({ c: 'not-a-price' }))).toBeNull();
    expect(transformMiniTicker({} as MiniTickerRaw)).toBeNull();
  });
});

describe('transformTicker24hr', () => {
  it('validates exact strings and converts the raw percentage', () => {
    expect(
      transformTicker24hr({
        symbol: 'BTCUSDT',
        lastPrice: '101.00',
        priceChangePercent: '1.23000000',
        highPrice: '105.00',
        lowPrice: '99.00',
        quoteVolume: '1000.00000000',
        closeTime: 2_000,
        ignored: 'field',
      }),
    ).toEqual({
      symbol: 'BTCUSDT',
      lastPrice: '101.00',
      priceChangePercent: 1.23,
      highPrice: '105.00',
      lowPrice: '99.00',
      quoteVolume: '1000.00000000',
      closeTime: 2_000,
    });
  });

  it('accepts a finite numeric percentage', () => {
    expect(
      transformTicker24hr({
        symbol: 'ETHUSDT',
        lastPrice: '2.00',
        priceChangePercent: -4.5,
        highPrice: '2.10',
        lowPrice: '1.90',
        quoteVolume: '10',
        closeTime: 0,
      })?.priceChangePercent,
    ).toBe(-4.5);
  });

  it('rejects malformed rows without coercing them to zero', () => {
    const valid = {
      symbol: 'BTCUSDT',
      lastPrice: '101.00',
      priceChangePercent: '1.23',
      highPrice: '105.00',
      lowPrice: '99.00',
      quoteVolume: '1000',
      closeTime: 2_000,
    };

    for (const value of [null, undefined, 1, 'row', [], {}]) {
      expect(transformTicker24hr(value)).toBeNull();
    }

    for (const key of [
      'lastPrice',
      'highPrice',
      'lowPrice',
      'quoteVolume',
    ] as const) {
      for (const invalid of ['', ' ', '1e3', 'abc', 1]) {
        expect(transformTicker24hr({ ...valid, [key]: invalid })).toBeNull();
      }
    }

    expect(transformTicker24hr({ ...valid, symbol: 1 })).toBeNull();
    expect(transformTicker24hr({ ...valid, symbol: '' })).toBeNull();
    expect(transformTicker24hr({ ...valid, closeTime: -1 })).toBeNull();
    expect(transformTicker24hr({ ...valid, closeTime: 1.5 })).toBeNull();
    expect(
      transformTicker24hr({ ...valid, priceChangePercent: 'abc' }),
    ).toBeNull();
    expect(
      transformTicker24hr({ ...valid, priceChangePercent: Number.NaN }),
    ).toBeNull();
    expect(
      transformTicker24hr({
        ...valid,
        priceChangePercent: Number.POSITIVE_INFINITY,
      }),
    ).toBeNull();
  });
});

describe('mergeTickerSnapshot', () => {
  it('seeds a fresh row without a flash or fabricated history', () => {
    const result = mergeTickerSnapshot(
      undefined,
      makeSnapshot({ quoteVolume: '1000.50000000' }),
    );

    expect(result).toEqual({
      symbol: 'BTCUSDT',
      lastPrice: '101.00',
      prevPrice: undefined,
      priceChangePercent: 1.23,
      volume24h: '1000.5',
      priceHistory: [],
      flashDirection: null,
      highPrice: '105.00',
      lowPrice: '99.00',
      lastEventTime: 2_000,
    });
  });

  it('does not overwrite data from a fresher stream event', () => {
    const existing = makeTicker({ lastEventTime: 2_000 });

    expect(
      mergeTickerSnapshot(existing, makeSnapshot({ closeTime: 1_999 })),
    ).toBe(existing);
  });

  it('applies at or after the stream timestamp and keeps stream history', () => {
    const existing = makeTicker({
      lastEventTime: 2_000,
      priceHistory: [98, 99, 100],
      flashDirection: 'down',
    });
    const result = mergeTickerSnapshot(
      existing,
      makeSnapshot({ closeTime: 2_000 }),
    );

    expect(result).not.toBe(existing);
    expect(result.lastPrice).toBe('101.00');
    expect(result.priceHistory).toEqual([98, 99, 100]);
    expect(result.flashDirection).toBe('down');
    expect(result.prevPrice).toBe('99.00');
    expect(result.lastEventTime).toBe(2_000);
  });
});
