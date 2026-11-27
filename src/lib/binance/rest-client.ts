import { DEFAULT_SYMBOLS } from '../../config/markets';
import type {
  ExchangeInfoResponse,
  DepthSnapshotResponse,
  KlineResponse,
  Ticker24hrResponse,
} from './types';

const BASE_URL: string = 'https://api.binance.com';

export class BinanceRestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Binance request failed with status ${status}`);
    this.name = 'BinanceRestError';
    this.status = status;
    this.body = body;
  }
}

async function get<T>(
  path: string,
  params?: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(BASE_URL + path);

  if (params) {
    Object.entries(params).forEach(([key, value]) =>
      url.searchParams.set(key, String(value)),
    );
  }

  const res = await fetch(url.toString(), { signal });

  if (!res.ok) {
    throw new BinanceRestError(res.status, await res.text());
  }

  const result = await res.json();

  return result as Promise<T>;
}

export const binanceRest = {
  getExchangeInfo: () =>
    get<ExchangeInfoResponse>('/api/v3/exchangeInfo', {
      symbols: JSON.stringify(DEFAULT_SYMBOLS),
    }),
  getDepthSnapshot: (symbol: string, limit = 1000, signal?: AbortSignal) =>
    get<DepthSnapshotResponse>('/api/v3/depth', { symbol, limit }, signal),

  getKlines: (
    symbol: string,
    interval: string,
    limit = 500,
    signal?: AbortSignal,
  ) =>
    get<KlineResponse[]>('/api/v3/klines', { symbol, interval, limit }, signal),

  get24hrTickers: (symbols: readonly string[], signal?: AbortSignal) =>
    get<Ticker24hrResponse[]>(
      '/api/v3/ticker/24hr',
      { symbols: JSON.stringify(symbols) },
      signal,
    ),
};
