import { useMemo } from 'react';

import {
  formatCompact,
  formatPercent,
  formatPrice,
} from '../lib/format/number';
import type { TickerData } from '../models';
import type { MarketTone } from '../components/ui/Metric';
import { useTickerStore } from '../stores/globalStore';

export const MISSING_STAT = '–';

export interface MarketStats {
  hasData: boolean;
  lastPrice: string;
  changeText: string;
  changeArrow: string;
  changeTone: MarketTone;
  high: string;
  low: string;
  quoteVolume: string;
}

const EMPTY_STATS: MarketStats = {
  hasData: false,
  lastPrice: MISSING_STAT,
  changeText: MISSING_STAT,
  changeArrow: '',
  changeTone: 'neutral',
  high: MISSING_STAT,
  low: MISSING_STAT,
  quoteVolume: MISSING_STAT,
};

function priceOrMissing(symbol: string, raw: string | undefined): string {
  return raw === undefined ? MISSING_STAT : formatPrice(symbol, raw);
}

function toneOf(percent: number): MarketTone {
  const { isFlat, isPositive } = formatPercent(percent);
  if (!Number.isFinite(percent)) return 'neutral';
  if (isFlat) return 'flat';
  return isPositive ? 'up' : 'down';
}

/** Formats one ticker record for display; no ticker means no data yet. */
export function deriveMarketStats(
  symbol: string,
  ticker: TickerData | undefined,
): MarketStats {
  if (!ticker) return EMPTY_STATS;

  const change = formatPercent(ticker.priceChangePercent);

  return {
    hasData: true,
    lastPrice: formatPrice(symbol, ticker.lastPrice),
    changeText: change.text,
    changeArrow: change.arrow,
    changeTone: toneOf(ticker.priceChangePercent),
    high: priceOrMissing(symbol, ticker.highPrice),
    low: priceOrMissing(symbol, ticker.lowPrice),
    quoteVolume: formatCompact(ticker.volume24h),
  };
}

export function useMarketStats(symbol: string): MarketStats {
  const ticker = useTickerStore((state) => state.tickers[symbol]);
  return useMemo(() => deriveMarketStats(symbol, ticker), [symbol, ticker]);
}
