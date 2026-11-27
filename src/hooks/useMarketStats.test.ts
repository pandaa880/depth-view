import { beforeEach, describe, expect, it } from 'vitest';

import { useExchangeInfoStore } from '../stores/globalStore';
import { deriveMarketStats } from './useMarketStats';

beforeEach(() => {
  useExchangeInfoStore.setState({
    symbolInfo: {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        tickSize: '0.01',
        stepSize: '0.00001',
        baseAssetPrecision: 8,
        quoteAssetPrecision: 8,
      },
    },
    isBootstrapped: true,
  });
});

describe('deriveMarketStats', () => {
  it('uses dashes without a ticker', () => {
    const stats = deriveMarketStats('BTCUSDT', undefined);
    expect(stats.hasData).toBe(false);
    expect(stats.lastPrice).toBe('–');
    expect(stats.high).toBe('–');
  });

  it('formats exact strings and keeps missing high/low as dashes', () => {
    const stats = deriveMarketStats('BTCUSDT', {
      symbol: 'BTCUSDT',
      lastPrice: '100.5',
      prevPrice: undefined,
      priceChangePercent: -2,
      volume24h: '12300',
      priceHistory: [],
      flashDirection: null,
    });
    expect(stats.lastPrice).toBe('100.50');
    expect(stats.changeText).toBe('-2.00%');
    expect(stats.changeTone).toBe('down');
    expect(stats.quoteVolume).toBe('12.3K');
    expect(stats.high).toBe('–');
  });
});
