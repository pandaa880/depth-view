import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SYMBOLS } from '../../config/markets';
import { binanceRest } from './rest-client';

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
