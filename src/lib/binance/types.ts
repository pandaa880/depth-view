export interface RateLimit {
  rateLimitType: 'REQUEST_WEIGHT' | 'ORDERS' | 'RAW_REQUESTS';
  interval: 'SECOND' | 'MINUTE' | 'DAY';
  intervalNum: number;
  limit: number;
}

export interface PriceFilter {
  filterType: 'PRICE_FILTER';
  minPrice: string;
  maxPrice: string;
  tickSize: string; // Crucial for Order Book Y-Axis & UI pricing
}

export interface LotSizeFilter {
  filterType: 'LOT_SIZE';
  minQty: string;
  maxQty: string;
  stepSize: string; // Crucial for Order Book size depth & scaling
}

// Generic fallback catch for other filters (NOTIONAL, TRAILING_DELTA, etc.)
export interface GenericFilter {
  filterType: string;
  [key: string]: any;
}

export type SymbolFilter = PriceFilter | LotSizeFilter | GenericFilter;

export interface BinanceSymbol {
  symbol: string;
  status: 'TRADING' | 'HALT' | 'BREAK' | string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quotePrecision: number;
  quoteAssetPrecision: number;
  baseCommissionPrecision: number;
  quoteCommissionPrecision: number;
  orderTypes: string[];
  icebergAllowed: boolean;
  ocoAllowed: boolean;
  otoAllowed: boolean;
  opoAllowed: boolean;
  quoteOrderQtyMarketAllowed: boolean;
  allowTrailingStop: boolean;
  cancelReplaceAllowed: boolean;
  amendAllowed: boolean;
  pegInstructionsAllowed: boolean;
  isSpotTradingAllowed: boolean;
  isMarginTradingAllowed: boolean;
  filters: SymbolFilter[];
  permissions: string[];
  permissionSets: string[][];
  defaultSelfTradePreventionMode: string;
  allowedSelfTradePreventionModes: string[];
}

export interface ExchangeInfoResponse {
  timezone: string;
  serverTime: number;
  rateLimits: RateLimit[];
  exchangeFilters: any[];
  symbols: BinanceSymbol[];
}
