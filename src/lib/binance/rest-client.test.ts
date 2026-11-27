import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SYMBOLS } from '../../config/markets';
import { BinanceRestError, binanceRest } from './rest-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('binanceRest.getExchangeInfo', () => {
  it('requests every configured symbol in order with one fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ symbols: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await binanceRest.getExchangeInfo();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [request] = fetchMock.mock.calls[0];
    const url = new URL(request.toString());
    const symbolsParameter = url.searchParams.get('symbols');

    expect(url.pathname).toBe('/api/v3/exchangeInfo');
    expect(symbolsParameter).not.toBeNull();
    const symbols = JSON.parse(symbolsParameter!) as unknown;
    expect(symbols).toHaveLength(20);
    expect(symbols).toEqual([...DEFAULT_SYMBOLS]);
  });
});

describe('binanceRest errors', () => {
  it('throws a typed error carrying status and body for a 404', async () => {
    const body = '<html>' + 'x'.repeat(500) + '</html>';
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(body, { status: 404 })),
    );

    const failure = await binanceRest
      .getKlines('BTCUSDT', '1m')
      .catch((e) => e);

    expect(failure).toBeInstanceOf(BinanceRestError);
    expect(failure.name).toBe('BinanceRestError');
    expect(failure.status).toBe(404);
    expect(failure.body).toBe(body);
    expect(failure.message).toBe('Binance request failed with status 404');
  });
});
