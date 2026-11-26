import { isDecimalString } from '../decimal';
import { computeEma20 } from './ema';

export const KLINE_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type KlineTimeframe = (typeof KLINE_TIMEFRAMES)[number];
export const KLINE_HISTORY_LIMIT = 500;

export const KLINE_INTERVAL_SECONDS: Record<KlineTimeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3_600,
  '4h': 14_400,
  '1d': 86_400,
};

export interface Candle {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface EmaSeriesPoint {
  time: number;
  value: string;
}

export interface KlineSeriesSnapshot {
  candles: Candle[];
  ema: EmaSeriesPoint[];
}

export interface KlineEventUpdate {
  symbol: string;
  interval: string;
  candle: Candle;
}

export class KlineParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KlineParseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function toCandle(
  openTimeMs: number,
  open: string,
  high: string,
  low: string,
  close: string,
): Candle {
  return {
    time: Math.floor(openTimeMs / 1000),
    open,
    high,
    low,
    close,
  };
}

/**
 * Parses the raw `/api/v3/klines` tuple array into exact-decimal candles.
 * Rows must be well formed; duplicates keep the latest row for a given time.
 */
export function parseRestKlines(payload: unknown): Candle[] {
  if (!Array.isArray(payload)) {
    throw new KlineParseError('Kline payload must be an array');
  }

  const byTime = new Map<number, Candle>();

  payload.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length < 6) {
      throw new KlineParseError(`Malformed kline row at index ${rowIndex}`);
    }

    const [openTime, open, high, low, close] = row as unknown[];
    if (!isTimestamp(openTime)) {
      throw new KlineParseError(`Invalid open time at row ${rowIndex}`);
    }

    if (
      !isDecimalString(open) ||
      !isDecimalString(high) ||
      !isDecimalString(low) ||
      !isDecimalString(close)
    ) {
      throw new KlineParseError(`Invalid OHLC value at row ${rowIndex}`);
    }

    const candle = toCandle(openTime, open, high, low, close);
    byTime.set(candle.time, candle);
  });

  return Array.from(byTime.values()).sort(
    (left, right) => left.time - right.time,
  );
}

/**
 * Validates a kline websocket envelope before it reaches chart state.
 * Returns null for anything that is not a complete kline payload.
 */
export function parseKlineEvent(payload: unknown): KlineEventUpdate | null {
  if (!isRecord(payload) || payload.e !== 'kline') return null;

  const symbol = payload.s;
  const kline = payload.k;
  if (typeof symbol !== 'string' || symbol.length === 0) return null;
  if (!isRecord(kline)) return null;

  const { s: streamSymbol, i: interval, t, o, h, l, c, x } = kline;
  if (typeof streamSymbol !== 'string' || streamSymbol.length === 0)
    return null;
  if (typeof interval !== 'string' || interval.length === 0) return null;
  if (!isTimestamp(t)) return null;
  if (
    !isDecimalString(o) ||
    !isDecimalString(h) ||
    !isDecimalString(l) ||
    !isDecimalString(c)
  ) {
    return null;
  }
  if (typeof x !== 'boolean') return null;

  return {
    symbol,
    interval,
    candle: toCandle(t, o, h, l, c),
  };
}

export function klineStreamName(
  symbol: string,
  timeframe: KlineTimeframe,
): string {
  return `${symbol.toLowerCase()}@kline_${timeframe}`;
}

export function klineIntervalSeconds(timeframe: KlineTimeframe): number {
  return KLINE_INTERVAL_SECONDS[timeframe];
}

/**
 * Keeps the retained history bounded so frame work and EMA recomputation stay
 * constant no matter how long the stream runs.
 */
export function boundKlineHistory(candles: Candle[]): Candle[] {
  return candles.length > KLINE_HISTORY_LIMIT
    ? candles.slice(-KLINE_HISTORY_LIMIT)
    : candles;
}

/**
 * A retained series is trustworthy only when every adjacent bar advances by
 * exactly one interval. Missing intervals make the exact-decimal EMA invalid.
 */
export function isContinuousKlineSeries(
  candles: readonly Candle[],
  timeframe: KlineTimeframe,
): boolean {
  const interval = klineIntervalSeconds(timeframe);

  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index].time - candles[index - 1].time !== interval) {
      return false;
    }
  }

  return true;
}

function sameCandle(left: Candle, right: Candle): boolean {
  return (
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close
  );
}

/**
 * Applies one live candle. A matching latest bar is replaced, a newer bar is
 * appended, and a stale bar is ignored so series updates only move forward.
 */
export function mergeCandleUpdate(candles: Candle[], update: Candle): Candle[] {
  if (candles.length === 0) return [update];

  const last = candles[candles.length - 1];
  if (update.time < last.time) return candles;

  if (update.time === last.time) {
    if (sameCandle(last, update)) return candles;
    return [...candles.slice(0, -1), update];
  }

  return [...candles, update];
}

export function mergeCandleUpdates(
  candles: Candle[],
  updates: Iterable<Candle>,
): Candle[] {
  const ordered = Array.from(updates).sort(
    (left, right) => left.time - right.time,
  );

  let next = candles;
  for (const update of ordered) {
    next = mergeCandleUpdate(next, update);
  }
  return next;
}

/**
 * Builds the exact-decimal series used by the chart. The EMA is converted to
 * chart coordinates only inside the canvas adapter, never here.
 */
export function buildKlineSeries(
  candles: readonly Candle[],
): KlineSeriesSnapshot {
  if (candles.length === 0) return { candles: [], ema: [] };

  const points = computeEma20(candles.map((candle) => candle.close));

  return {
    candles: candles.slice(),
    ema: points.map(({ index, value }) => ({
      time: candles[index].time,
      value,
    })),
  };
}
