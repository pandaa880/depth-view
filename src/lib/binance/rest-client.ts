import type {
  ExchangeInfoResponse,
  DepthSnapshotResponse,
  KlineResponse,
} from './types';

const BASE_URL: string = 'https://api.binance.com';

const tickerSymbols = ['SOLUSDT', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT'];

async function get<T>(
  path: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const url = new URL(BASE_URL + path);

  if (params) {
    Object.entries(params).forEach(([key, value]) =>
      url.searchParams.set(key, String(value)),
    );
  }

  const res = await fetch(url.toString());

  if (!res.ok) {
    const errorMessage = {
      status: res.status,
      message: await res.text(),
    };
    throw new Error(JSON.stringify(errorMessage));
  }

  const result = await res.json();

  return result as Promise<T>;
}

export const binanceRest = {
  getExchangeInfo: () =>
    get<ExchangeInfoResponse>('/api/v3/exchangeInfo', {
      symbols: JSON.stringify(tickerSymbols),
    }),
  getDepthSnapshot: (symbol: string, limit = 1000) =>
    get<DepthSnapshotResponse>('/api/v3/depth', { symbol, limit }),

  getKlines: (symbol: string, interval: string, limit = 500) =>
    get<KlineResponse[]>('/api/v3/klines', { symbol, interval, limit }),
};
