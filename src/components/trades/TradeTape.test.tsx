// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TradeView } from '../../models/market';
import { useExchangeInfoStore } from '../../stores/globalStore';
import { TradeList } from './TradeList';

const trade = (overrides: Partial<TradeView> = {}): TradeView => ({
  id: 1,
  time: 3_661_000,
  price: '100.50000000',
  quantity: '0.12345600',
  isBuyerMaker: false,
  ...overrides,
});

beforeEach(() => {
  useExchangeInfoStore.setState({
    symbolInfo: {
      BTCUSDT: {
        symbol: 'BTCUSDT',
        tickSize: '0.01',
        stepSize: '0.000001',
        baseAssetPrecision: 8,
        quoteAssetPrecision: 8,
      },
    },
    isBootstrapped: true,
  });
});

afterEach(() => {
  cleanup();
  useExchangeInfoStore.setState({ symbolInfo: {}, isBootstrapped: false });
});

describe('TradeList', () => {
  it('renders labelled columns, exact values and non-color side cues', () => {
    const { container } = render(
      <TradeList
        symbol="BTCUSDT"
        feedState="live"
        trades={[
          trade({ id: 2, isBuyerMaker: true }),
          trade({
            id: 1,
            time: 3_661_001,
            price: '100.40000000',
            quantity: '2.00000000',
          }),
        ]}
      />,
    );

    expect(
      screen.getByRole('table', {
        name: /BTCUSDT recent trades, newest first/i,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('columnheader', { name: /Time UTC/i }),
    ).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Price' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Quantity' })).toBeTruthy();
    expect(
      screen.getByRole('region', {
        name: 'BTCUSDT recent trades, scrollable',
      }),
    ).toBeTruthy();

    const rows = container.querySelectorAll('.tt-row');
    expect(rows).toHaveLength(2);

    const sellRow = rows[0] as HTMLElement;
    expect(sellRow.getAttribute('data-side')).toBe('sell');
    expect(within(sellRow).getByText('01:01:01')).toBeTruthy();
    expect(within(sellRow).getByText('▼')).toBeTruthy();
    expect(within(sellRow).getByText('Sell')).toBeTruthy();
    expect(sellRow.textContent).toContain('100.50');
    expect(sellRow.textContent).toContain('0.123456');

    const buyRow = rows[1] as HTMLElement;
    expect(buyRow.getAttribute('data-side')).toBe('buy');
    expect(within(buyRow).getByText('▲')).toBeTruthy();
    expect(within(buyRow).getByText('Buy')).toBeTruthy();
    expect(buyRow.textContent).toContain('100.40');
    expect(buyRow.textContent).toContain('2.000000');
  });

  it('keeps panel height with skeleton rows and no invented trades', () => {
    const { container } = render(
      <TradeList symbol="BTCUSDT" trades={[]} feedState="connecting" />,
    );

    expect(screen.getByText('Connecting to trade feed')).toBeTruthy();
    expect(container.querySelectorAll('.tt-row-skeleton')).toHaveLength(12);
    expect(container.querySelectorAll('.tt-row')).toHaveLength(12);
    expect(
      screen.getByRole('table', {
        name: /BTCUSDT recent trades, newest first/i,
      }),
    ).toBeTruthy();
    expect(container.querySelector('.tt-row[data-side]')).toBeNull();
  });

  it('labels stale data while preserving the last trades', () => {
    const { container } = render(
      <TradeList
        symbol="BTCUSDT"
        feedState="stale"
        trades={[trade({ id: 7, isBuyerMaker: true })]}
      />,
    );

    expect(screen.getByText('Feed stale, showing last trades')).toBeTruthy();
    expect(container.querySelectorAll('.tt-row-skeleton')).toHaveLength(0);
    expect(container.querySelectorAll('.tt-row[data-side]')).toHaveLength(1);
  });
});
