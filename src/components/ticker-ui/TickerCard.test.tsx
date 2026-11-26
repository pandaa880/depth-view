// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TickerData } from '../../models';
import { useExchangeInfoStore, useTickerStore } from '../../stores/globalStore';
import { TickerCard } from './TickerCard';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BTC_INFO = {
  symbol: 'BTCUSDT',
  tickSize: '0.01',
  stepSize: '0.000001',
  baseAssetPrecision: 8,
  quoteAssetPrecision: 8,
};

const makeTicker = (overrides: Partial<TickerData> = {}): TickerData => ({
  symbol: 'BTCUSDT',
  lastPrice: '100.00',
  prevPrice: undefined,
  priceChangePercent: 0,
  volume24h: '12345.60000000',
  priceHistory: [100, 101, 102],
  flashDirection: null,
  ...overrides,
});

const setTicker = (ticker: TickerData) => {
  useTickerStore.getState().setTickers({ BTCUSDT: ticker });
};

const getPriceElement = (container: HTMLElement) => {
  const price = container.querySelector('data.ticker-price');
  expect(price).not.toBeNull();
  return price!;
};

beforeEach(() => {
  useExchangeInfoStore.setState({
    symbolInfo: { BTCUSDT: BTC_INFO },
    isBootstrapped: true,
  });
  useTickerStore.setState({ tickers: {} });
});

afterEach(() => {
  cleanup();
  useTickerStore.setState({ tickers: {} });
});

describe('TickerCard', () => {
  it('renders a fixed skeleton shape without a fabricated price', () => {
    const { container } = render(<TickerCard symbol="BTCUSDT" />);
    const skeleton = container.querySelector('.ticker-card-loading');

    expect(skeleton).not.toBeNull();
    expect(skeleton!.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton!.children).toHaveLength(5);
    expect(container.querySelectorAll('.skeleton')).toHaveLength(7);
    expect(container.querySelector('.skeleton-price')!.textContent).toBe('');
    expect(container.textContent).toBe('');
    expect(container.querySelector('a')).toBeNull();
  });

  it.each([0, 0.004, -0.001])(
    'uses neutral flat direction for rounded-zero change %s',
    (priceChangePercent) => {
      const { container } = render(<TickerCard symbol="BTCUSDT" />);
      act(() => setTicker(makeTicker({ priceChangePercent })));

      const change = container.querySelector('.ticker-change')!;
      const sparkline = screen.getByRole('img');
      for (const element of [change, sparkline]) {
        expect(element.getAttribute('data-flat')).toBe('true');
        expect(element.hasAttribute('data-up')).toBe(false);
        expect(element.hasAttribute('data-down')).toBe(false);
      }
      expect(change.textContent).toContain('0.00%');
      expect(change.textContent).not.toContain('+');
      expect(change.textContent).not.toContain('-');
    },
  );

  it('announces unknown direction for nonfinite change with price history', () => {
    render(<TickerCard symbol="BTCUSDT" />);
    act(() => setTicker(makeTicker({ priceChangePercent: Number.NaN })));

    const sparkline = screen.getByRole('img', {
      name: 'BTCUSDT recent price history, direction unknown',
    });
    expect(sparkline.hasAttribute('data-flat')).toBe(false);
  });

  it('remounts only the price for consecutive flashes and ignores unchanged prices', () => {
    const { container } = render(<TickerCard symbol="BTCUSDT" />);
    act(() => setTicker(makeTicker()));

    const initialPrice = getPriceElement(container);
    expect(initialPrice.classList.contains('price-flash-up')).toBe(false);
    expect(initialPrice.classList.contains('price-flash-down')).toBe(false);

    act(() =>
      setTicker(
        makeTicker({
          lastPrice: '101.00',
          prevPrice: '100.00',
          flashDirection: 'up',
        }),
      ),
    );
    const firstIncrease = getPriceElement(container);
    expect(firstIncrease).not.toBe(initialPrice);
    expect(firstIncrease.classList.contains('price-flash-up')).toBe(true);

    act(() =>
      setTicker(
        makeTicker({
          lastPrice: '102.00',
          prevPrice: '101.00',
          flashDirection: 'up',
        }),
      ),
    );
    const secondIncrease = getPriceElement(container);
    expect(secondIncrease).not.toBe(firstIncrease);
    expect(secondIncrease.classList.contains('price-flash-up')).toBe(true);

    act(() =>
      setTicker(
        makeTicker({
          lastPrice: '102.00',
          prevPrice: '102.00',
          flashDirection: 'up',
        }),
      ),
    );
    const unchangedPrice = getPriceElement(container);
    expect(unchangedPrice).toBe(secondIncrease);
    expect(unchangedPrice.classList.contains('price-flash-up')).toBe(false);
  });
});
