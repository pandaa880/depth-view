import { beforeEach, describe, expect, it } from 'vitest';

import { useExchangeInfoStore } from '../../stores/globalStore';
import {
  decimalPlacesFromIncrement,
  formatCompact,
  formatPercent,
  formatPrice,
  formatQty,
} from './number';

type MockedSymbol = {
  symbol: string;
  tickSize: string;
  stepSize: string;
};

/**
 * Replaces exchange metadata through the real store, so the formatters
 * are exercised exactly as in the app without REST or WebSocket.
 */
function mockSymbolInfo(symbols: MockedSymbol[]): void {
  useExchangeInfoStore.getState().setSymbolInfo(
    Object.fromEntries(
      symbols.map(({ symbol, tickSize, stepSize }) => [
        symbol,
        {
          symbol,
          tickSize,
          stepSize,
          baseAssetPrecision: 8,
          quoteAssetPrecision: 8,
        },
      ]),
    ),
  );
}

beforeEach(() => {
  mockSymbolInfo([
    { symbol: 'BTCUSDT', tickSize: '0.01000000', stepSize: '0.00001000' },
    { symbol: 'ETHUSDT', tickSize: '0.01000000', stepSize: '0.00010000' },
    { symbol: 'PEPEUSDT', tickSize: '0.00000100', stepSize: '1.00000000' },
    { symbol: 'SHIBUSDT', tickSize: '0.00000100', stepSize: '0.01000000' },
  ]);
});

describe('decimalPlacesFromIncrement', () => {
  it.each([
    ['0.01000000', 2],
    ['0.00000100', 6],
    ['0.10', 1],
    ['1.00000000', 0],
    ['5', 0],
  ])('counts places for %s', (increment, expected) => {
    expect(decimalPlacesFromIncrement(increment)).toBe(expected);
  });

  it('treats unusable metadata as unknown', () => {
    expect(decimalPlacesFromIncrement('0')).toBeNull();
    expect(decimalPlacesFromIncrement('-0.01000000')).toBeNull();
    expect(decimalPlacesFromIncrement('abc')).toBeNull();
    expect(decimalPlacesFromIncrement('1e3')).toBeNull();
  });
});

describe('formatPrice', () => {
  it('pads and groups using tickSize precision', () => {
    expect(formatPrice('BTCUSDT', '1234.5')).toBe('1,234.50');
    expect(formatPrice('ETHUSDT', '75753.78000000')).toBe('75,753.78');
  });

  it('uses small-alt tick precision without quoteAssetPrecision', () => {
    expect(formatPrice('PEPEUSDT', '0.1')).toBe('0.100000');
    expect(formatPrice('SHIBUSDT', '0.00001234')).toBe('0.000012');
  });

  it('truncates extra fraction digits instead of rounding', () => {
    expect(formatPrice('BTCUSDT', '1234.5679')).toBe('1,234.56');
    expect(formatPrice('ETHUSDT', '75753.7899999999')).toBe('75,753.78');
  });

  it('formats zero, extreme magnitudes, and negatives exactly', () => {
    expect(formatPrice('BTCUSDT', '0')).toBe('0.00');
    expect(formatPrice('BTCUSDT', '-0')).toBe('0.00');
    expect(formatPrice('BTCUSDT', '-0.001')).toBe('0.00');
    expect(formatPrice('BTCUSDT', '-1234.56')).toBe('-1,234.56');
    expect(formatPrice('BTCUSDT', '98765432109876.5')).toBe(
      '98,765,432,109,876.50',
    );
    expect(formatPrice('ETHUSDT', '0.00000001')).toBe('0.00');
  });

  it('resolves the canonical uppercase symbol per call', () => {
    expect(formatPrice('btcusdt', '1.5')).toBe('1.50');
  });

  it('keeps the raw fraction digits when metadata is missing', () => {
    expect(formatPrice('NOPEUSDT', '1234.5')).toBe('1,234.5');
    expect(formatPrice('', '0.125')).toBe('0.125');
  });

  it('marks missing and malformed input instead of coercing to zero', () => {
    expect(formatPrice('BTCUSDT', null)).toBe('—');
    expect(formatPrice('BTCUSDT', undefined)).toBe('—');
    expect(formatPrice('BTCUSDT', 'NaN')).toBe('—');
    expect(formatPrice('BTCUSDT', 'abc')).toBe('—');
    expect(formatPrice('BTCUSDT', '1e3')).toBe('—');
  });
});

describe('formatQty', () => {
  it('uses stepSize precision for quantities', () => {
    expect(formatQty('BTCUSDT', '1.2345678')).toBe('1.23456');
    expect(formatQty('BTCUSDT', '12.3')).toBe('12.30000');
    expect(formatQty('ETHUSDT', '1.23456789')).toBe('1.2345');
  });

  it('supports integer-lot step sizes', () => {
    expect(formatQty('PEPEUSDT', '1234.56789')).toBe('1,234');
    expect(formatQty('PEPEUSDT', '42')).toBe('42');
  });

  it('formats zero, negatives, and unknown symbols', () => {
    expect(formatQty('BTCUSDT', '0')).toBe('0.00000');
    expect(formatQty('BTCUSDT', '-0.000000001')).toBe('0.00000');
    expect(formatQty('SHIBUSDT', '-1.234')).toBe('-1.23');
    expect(formatQty('UNKNOWNUSDT', '2.5')).toBe('2.5');
    expect(formatQty('BTCUSDT', undefined)).toBe('—');
  });
});

describe('formatCompact', () => {
  it('renders magnitudes with the requested fraction digits', () => {
    expect(formatCompact('1230000000', 2)).toBe('1.23B');
    expect(formatCompact('456700000')).toBe('456.7M');
    expect(formatCompact('12300')).toBe('12.3K');
  });

  it('keeps sensible sub-1K values without a suffix', () => {
    expect(formatCompact('983.4')).toBe('983.4');
    expect(formatCompact('12')).toBe('12');
    expect(formatCompact('999.99')).toBe('999.9');
  });

  it('trims trailing fraction zeros', () => {
    expect(formatCompact('1000000000')).toBe('1B');
    expect(formatCompact('1200000000')).toBe('1.2B');
    expect(formatCompact('1000')).toBe('1K');
    expect(formatCompact('983.0')).toBe('983');
  });

  it('crosses unit boundaries exactly', () => {
    expect(formatCompact('999999999')).toBe('999.9M');
    expect(formatCompact('1000000000')).toBe('1B');
    expect(formatCompact('1234567890123')).toBe('1.2T');
  });

  it('handles zero, negatives, and malformed input', () => {
    expect(formatCompact('0')).toBe('0');
    expect(formatCompact('-456700000')).toBe('-456.7M');
    expect(formatCompact('abc')).toBe('—');
    expect(formatCompact('1e3')).toBe('—');
    expect(formatCompact(null)).toBe('—');
  });

  it('rejects invalid fraction digit counts', () => {
    expect(() => formatCompact('1230000000', -1)).toThrow(RangeError);
    expect(() => formatCompact('1230000000', 1.5)).toThrow(RangeError);
    expect(() => formatCompact('1230000000', 9)).toThrow(RangeError);
  });
});

describe('formatPercent', () => {
  it('keeps the signed shape for actual positive and negative values', () => {
    expect(formatPercent(12.3456)).toEqual({
      text: '+12.35%',
      arrow: '▲',
      isPositive: true,
      isFlat: false,
    });
    expect(formatPercent(-4.567)).toEqual({
      text: '-4.57%',
      arrow: '▼',
      isPositive: false,
      isFlat: false,
    });
  });

  it('is flat with neutral text and arrow at zero', () => {
    const flat = {
      text: '0.00%',
      arrow: '→',
      isPositive: false,
      isFlat: true,
    };

    expect(formatPercent(0)).toEqual(flat);
    expect(formatPercent(-0)).toEqual(flat);
    expect(formatPercent(-0.001)).toEqual(flat);
  });

  it('is flat but positive-flagged when actual input is positive', () => {
    expect(formatPercent(0.004)).toEqual({
      text: '0.00%',
      arrow: '→',
      isPositive: true,
      isFlat: true,
    });
  });

  it('marks non-finite input as missing', () => {
    const missing = {
      text: '—',
      arrow: '→',
      isPositive: false,
      isFlat: false,
    };

    expect(formatPercent(Number.NaN)).toEqual(missing);
    expect(formatPercent(Number.POSITIVE_INFINITY)).toEqual(missing);
    expect(formatPercent(Number.NEGATIVE_INFINITY)).toEqual(missing);
  });
});
