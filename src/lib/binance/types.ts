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

type BidItem = [string, string]; /// [Price, Qty]
type AskItem = [string, string]; /// [Price, Qty]

export interface DepthSnapshotResponse {
  lastUpdateId: number;
  bids: BidItem[];
  asks: AskItem[];
}

export type BinanceKlineTuple = [
  number, // 0: Kline open time (Unix Timestamp in ms)
  string, // 1: Open price
  string, // 2: High price
  string, // 3: Low price
  string, // 4: Close price
  string, // 5: Volume
  number, // 6: Kline close time (Unix Timestamp in ms)
  string, // 7: Quote asset volume
  number, // 8: Number of trades
  string, // 9: Taker buy base asset volume
  string, // 10: Taker buy quote asset volume
  string, // 11: Unused field (Ignore)
];

export interface ApiResponseRateLimit {
  rateLimitType: 'REQUEST_WEIGHT' | 'ORDERS' | 'RAW_REQUESTS';
  interval: 'SECOND' | 'MINUTE' | 'DAY';
  intervalNum: number;
  limit: number;
  count: number;
}

export interface KlineResponse {
  id: string;
  status: number;
  result: BinanceKlineTuple[];
  rateLimits: ApiResponseRateLimit[];
}
