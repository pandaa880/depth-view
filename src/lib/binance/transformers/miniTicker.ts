import { type TickerData } from '../../../models';
import {
  compareDecimal,
  isDecimalString,
  normalizeDecimal,
} from '../../decimal';

export type MiniTickerRaw = {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol
  c: string; // Close price
  o: string; // Open price
  h: string; // High price
  l: string; // Low price
  v: string; // Total traded base asset volume
  q: string; // Total traded quote asset volume
  P: string; // 24h price-change percentage
};

export type Ticker24hrSnapshot = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: number;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
  closeTime: number;
};

const HISTORY_LIMIT = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates only the fields the feed consumes. Unknown extra fields are
 * ignored so future Binance additions cannot break the stream.
 */
export function isMiniTickerRaw(value: unknown): value is MiniTickerRaw {
  return (
    isRecord(value) &&
    typeof value.s === 'string' &&
    value.s.length > 0 &&
    isNonnegativeSafeInteger(value.E) &&
    toPercentNumber(value.P) !== null &&
    isDecimalString(value.c) &&
    isDecimalString(value.o) &&
    isDecimalString(value.h) &&
    isDecimalString(value.l) &&
    isDecimalString(value.q)
  );
}

/**
 * Converts an exact percentage decimal string from the 24hr endpoint to
 * the display number without recomputing it from prices.
 */
function toPercentNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (!isDecimalString(value)) return null;

  const converted = Number(normalizeDecimal(value));
  return Number.isFinite(converted) ? converted : null;
}

/**
 * Validates a raw 24hr ticker row. A malformed row returns null rather
 * than producing zero-valued market data.
 */
export function transformTicker24hr(raw: unknown): Ticker24hrSnapshot | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.symbol !== 'string' || raw.symbol.length === 0) return null;
  if (
    !isDecimalString(raw.lastPrice) ||
    !isDecimalString(raw.highPrice) ||
    !isDecimalString(raw.lowPrice) ||
    !isDecimalString(raw.quoteVolume)
  ) {
    return null;
  }
  if (!isNonnegativeSafeInteger(raw.closeTime)) return null;

  const priceChangePercent = toPercentNumber(raw.priceChangePercent);
  if (priceChangePercent === null) return null;

  return {
    symbol: raw.symbol,
    lastPrice: raw.lastPrice,
    priceChangePercent,
    highPrice: raw.highPrice,
    lowPrice: raw.lowPrice,
    quoteVolume: raw.quoteVolume,
    closeTime: raw.closeTime,
  };
}

function nextPriceHistory(
  existing: TickerData | undefined,
  close: string,
): number[] {
  const numericClose = Number(normalizeDecimal(close));
  if (!Number.isFinite(numericClose)) {
    return existing?.priceHistory ?? [];
  }

  return [...(existing?.priceHistory ?? []), numericClose].slice(
    -HISTORY_LIMIT,
  );
}

function resolveFlashDirection(
  existing: TickerData | undefined,
  close: string,
): 'up' | 'down' | null {
  if (!existing) return null;

  try {
    const comparison = compareDecimal(close, existing.lastPrice);
    return comparison > 0 ? 'up' : comparison < 0 ? 'down' : null;
  } catch {
    return null;
  }
}

/**
 * Builds one ticker row from a streamed mini ticker. Exact decimal
 * strings are retained for prices and volume; only sparkline geometry
 * and the percent display value are numeric. Stale events are ignored.
 */
export function transformMiniTicker(
  raw: MiniTickerRaw,
  existing?: TickerData,
): TickerData | null {
  try {
    if (!isMiniTickerRaw(raw)) return null;
    if (
      existing?.lastEventTime !== undefined &&
      raw.E < existing.lastEventTime
    ) {
      return null;
    }

    return {
      symbol: raw.s,
      lastPrice: raw.c,
      prevPrice: existing?.lastPrice ?? raw.c,
      priceChangePercent: toPercentNumber(raw.P) ?? Number.NaN,
      priceHistory: nextPriceHistory(existing, raw.c),
      flashDirection: resolveFlashDirection(existing, raw.c),
      volume24h: normalizeDecimal(raw.q),
      highPrice: raw.h,
      lowPrice: raw.l,
      lastEventTime: raw.E,
    };
  } catch {
    return null;
  }
}

/**
 * Merges a validated 24hr snapshot into the current row. A snapshot
 * older than already committed stream data is discarded. Snapshot data
 * never invents a flash or sparkline history.
 */
export function mergeTickerSnapshot(
  existing: TickerData | undefined,
  snapshot: Ticker24hrSnapshot,
): TickerData {
  if (
    existing?.lastEventTime !== undefined &&
    snapshot.closeTime <= existing.lastEventTime
  ) {
    return existing;
  }

  return {
    symbol: snapshot.symbol,
    lastPrice: snapshot.lastPrice,
    prevPrice: existing?.prevPrice,
    priceChangePercent: snapshot.priceChangePercent,
    volume24h: normalizeDecimal(snapshot.quoteVolume),
    priceHistory: existing?.priceHistory ?? [],
    flashDirection: null,
    highPrice: snapshot.highPrice,
    lowPrice: snapshot.lowPrice,
    lastEventTime: snapshot.closeTime,
  };
}
