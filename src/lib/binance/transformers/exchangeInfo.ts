import type {
  BinanceSymbol,
  ExchangeInfoResponse,
  PriceFilter,
  LotSizeFilter,
} from '../types';
import type { SymbolInfo } from '../../../models/SymbolInfo';

export const transformSymbol = (raw: BinanceSymbol): SymbolInfo | null => {
  if (raw.status !== 'TRADING') {
    return null;
  }

  const priceFilter = raw.filters.find(
    (item): item is PriceFilter => item.filterType === 'PRICE_FILTER',
  );

  const lotFilter = raw.filters.find(
    (f): f is LotSizeFilter => f.filterType === 'LOT_SIZE',
  );

  if (!priceFilter || !lotFilter) return null;

  return {
    symbol: raw.symbol,
    tickSize: priceFilter.tickSize,
    stepSize: lotFilter.stepSize,
    baseAssetPrecision: raw.baseAssetPrecision,
    quoteAssetPrecision: raw.quoteAssetPrecision,
  };
};

export const transformExchangeInfo = (
  rawInfo: ExchangeInfoResponse,
): Record<string, SymbolInfo> => {
  const result: Record<string, SymbolInfo> = {};

  for (const raw of rawInfo.symbols) {
    const transformed = transformSymbol(raw);

    if (transformed) {
      result[transformed.symbol] = transformed;
    }
  }

  return result;
};
