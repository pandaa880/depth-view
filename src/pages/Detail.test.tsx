// @vitest-environment jsdom
import { createMemoryHistory } from '@tanstack/react-router';
import { RouterProvider } from '@tanstack/react-router';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/chart/CandlestickChart', () => ({
  CandlestickChart: ({ symbol }: { symbol: string }) => (
    <div data-testid="chart">{symbol}</div>
  ),
}));
vi.mock('../components/orderbook/OrderBook', () => ({
  OrderBook: ({ symbol }: { symbol: string }) => (
    <div data-testid="book">{symbol}</div>
  ),
}));
vi.mock('../components/trades/TradeTape', () => ({
  TradeTape: ({ symbol }: { symbol: string }) => (
    <div data-testid="tape">{symbol}</div>
  ),
}));
vi.mock('../hooks/useWsConnection', () => ({ useWsConnection: () => {} }));
vi.mock('../hooks/useExchangeInfo', async () => {
  const { useExchangeInfoStore } = await import('../stores/globalStore');
  return {
    useExchangeInfo: () => ({
      isBootstrapped: useExchangeInfoStore((state) => state.isBootstrapped),
      error: null,
    }),
  };
});
vi.mock('../components/ticker-ui/TickerGrid', () => ({
  TickerGrid: () => <div data-testid="grid" />,
}));

import { createAppRouter } from '../router';
import { useExchangeInfoStore, useTickerStore } from '../stores/globalStore';

const btcInfo = {
  symbol: 'BTCUSDT',
  tickSize: '0.01',
  stepSize: '0.00001',
  baseAssetPrecision: 8,
  quoteAssetPrecision: 8,
};

async function renderAt(path: string) {
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [path] }),
  );
  await act(async () => {
    render(<RouterProvider router={router} />);
    await router.load();
  });
  return router;
}

beforeEach(() => {
  useExchangeInfoStore.setState({
    symbolInfo: { BTCUSDT: btcInfo },
    isBootstrapped: true,
  });
  useTickerStore.setState({ tickers: {} });
});

afterEach(() => {
  cleanup();
  useTickerStore.setState({ tickers: {} });
});

describe('Detail page', () => {
  it('shows dashes before data and exact formatted stats after', async () => {
    document.title = 'before';
    await renderAt('/symbol/btcusdt');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'BTC/USDT',
    );
    expect(screen.getByLabelText('Last price').textContent).toContain('–');
    expect(document.title).toBe('BTC/USDT · Depth View');

    act(() => {
      useTickerStore.setState({
        tickers: {
          BTCUSDT: {
            symbol: 'BTCUSDT',
            lastPrice: '75753.7',
            prevPrice: undefined,
            priceChangePercent: 1.234,
            volume24h: '1230000000',
            priceHistory: [],
            flashDirection: null,
            highPrice: '76000',
            lowPrice: '74000.5',
          },
        },
      });
    });

    expect(screen.getByLabelText('Last price').textContent).toContain(
      '75,753.70',
    );
    expect(screen.getByLabelText('24 hour change').textContent).toContain(
      '+1.23%',
    );
    expect(screen.getByText('76,000.00')).toBeTruthy();
    expect(screen.getByText('74,000.50')).toBeTruthy();
    expect(screen.getByText('1.23B')).toBeTruthy();
    expect(screen.getByTestId('chart').textContent).toBe('BTCUSDT');
    expect(screen.getByTestId('book').textContent).toBe('BTCUSDT');
    expect(screen.getByTestId('tape').textContent).toBe('BTCUSDT');
  });

  it('restores the document title on unmount', async () => {
    document.title = 'before';
    await renderAt('/symbol/BTCUSDT');
    cleanup();
    expect(document.title).toBe('before');
  });

  it('redirects an unknown symbol home after bootstrap', async () => {
    const router = await renderAt('/symbol/FAKEUSDT');
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByTestId('grid')).toBeTruthy();
  });
});

describe('About route', () => {
  it('renders factual content and links back to markets', async () => {
    const router = await renderAt('/about');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'About Depth View',
    );
    expect(screen.getByText(/Exact-string financial math/)).toBeTruthy();
    expect(screen.getByText(/Shift/)).toBeTruthy();
    const github = screen.getByRole('link', { name: /Source on GitHub/ });
    expect(github.getAttribute('href')).toBe(
      'https://github.com/pandaa880/depth-view',
    );
    expect(github.getAttribute('rel')).toBe('noopener noreferrer');
    const portfolio = screen.getByRole('link', { name: /Portfolio/ });
    expect(portfolio.getAttribute('href')).toBe(
      'https://prashantchaudhari.dev/',
    );

    await act(async () => {
      screen.getByRole('link', { name: /Back to markets/ }).click();
    });
    expect(router.state.location.pathname).toBe('/');
  });
});
