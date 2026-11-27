// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { OrderBookView } from '../../models/market';
import { createEmptyOrderBookView } from '../../lib/orderbook';
import { OrderBookPanel } from './OrderBook';

const liveView = (): OrderBookView => ({
  ...createEmptyOrderBookView('BTCUSDT', 'live'),
  bids: [
    {
      price: '100',
      quantity: '2',
      cumulativeQuantity: '2',
      depthRatio: 0.5,
    },
    {
      price: '99',
      quantity: '1',
      cumulativeQuantity: '3',
      depthRatio: 1,
    },
  ],
  asks: [
    {
      price: '101',
      quantity: '1.5',
      cumulativeQuantity: '1.5',
      depthRatio: 0.6,
    },
    {
      price: '102',
      quantity: '1',
      cumulativeQuantity: '2.5',
      depthRatio: 1,
    },
  ],
  spread: '1',
  spreadBps: '99.5',
  lastUpdateId: 42,
});

const pricesIn = (container: HTMLElement, side: 'bids' | 'asks') =>
  Array.from(
    container.querySelectorAll(
      `.ob-row[data-side="${side}"][data-price] .ob-cell-price`,
    ),
  ).map((cell) => cell.textContent);

afterEach(cleanup);

describe('OrderBookPanel', () => {
  it('renders bids descending and asks ascending with the best ask on top', () => {
    const { container } = render(
      <OrderBookPanel symbol="BTCUSDT" view={liveView()} />,
    );

    expect(pricesIn(container, 'bids')).toEqual(['100', '99']);
    expect(pricesIn(container, 'asks')).toEqual(['101', '102']);
    expect(pricesIn(container, 'asks')[0]).toBe('101');
    expect(screen.getByText('Bids')).toBeTruthy();
    expect(screen.getByText('Asks')).toBeTruthy();
    expect(
      screen.getByRole('table', { name: 'BTCUSDT bids ladder' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('table', { name: 'BTCUSDT asks ladder' }),
    ).toBeTruthy();
  });

  it('shows exact spread values only when both sides are present', () => {
    const { rerender } = render(
      <OrderBookPanel symbol="BTCUSDT" view={liveView()} />,
    );
    const summary = screen.getByLabelText('Spread summary');

    expect(within(summary).getByText('1')).toBeTruthy();
    expect(within(summary).getByText('99.5000')).toBeTruthy();

    rerender(
      <OrderBookPanel
        symbol="BTCUSDT"
        view={{
          ...liveView(),
          bids: [],
          spread: '0',
          spreadBps: '0',
        }}
      />,
    );

    expect(within(summary).getAllByText('–')).toHaveLength(2);
    expect(
      screen
        .getByRole('table', { name: 'BTCUSDT bids ladder' })
        .querySelectorAll('.ob-row-blank').length,
    ).toBe(20);
  });

  it('truncates spreadBps to 4 zero-padded fraction digits', () => {
    const { container } = render(
      <OrderBookPanel
        symbol="BTCUSDT"
        view={{ ...liveView(), spreadBps: '0.001619214374996609' }}
      />,
    );
    const bps = container.querySelector('.ob-summary-bps') as HTMLElement;

    expect(bps.textContent).toBe('0.0016');
    expect(bps.getAttribute('title')).toBe('0.0016');
  });

  it('derives depth-only bar transforms from the engine ratio', () => {
    const { container } = render(
      <OrderBookPanel symbol="BTCUSDT" view={liveView()} />,
    );
    const bidBar = container.querySelector(
      '.ob-row[data-price="100"] .ob-depth',
    ) as HTMLElement;
    const askBar = container.querySelector(
      '.ob-row[data-price="101"] .ob-depth',
    ) as HTMLElement;

    expect(bidBar.getAttribute('aria-hidden')).toBe('true');
    expect(bidBar.style.transform).toBe('scaleX(0.5)');
    expect(bidBar.style.transformOrigin).toBe('left');
    expect(askBar.style.transform).toBe('scaleX(0.6)');
    expect(askBar.style.transformOrigin).toBe('right');
  });

  it('keeps the last levels visible while re-syncing and on error', () => {
    const view = liveView();
    const { rerender } = render(
      <OrderBookPanel symbol="BTCUSDT" view={view} />,
    );

    rerender(
      <OrderBookPanel
        symbol="BTCUSDT"
        view={{ ...view, state: 'stale', gapCount: 3 }}
      />,
    );
    expect(screen.getByText('Re-syncing')).toBeTruthy();
    expect(screen.getByText('3 gaps')).toBeTruthy();
    expect(screen.getAllByRole('cell').length).toBeGreaterThan(6);

    rerender(
      <OrderBookPanel symbol="BTCUSDT" view={{ ...view, state: 'error' }} />,
    );
    expect(screen.getByText('Feed error')).toBeTruthy();
    expect(
      screen.getByRole('table', { name: 'BTCUSDT bids ladder' }),
    ).toBeTruthy();
  });

  it('reserves the full ladder height with rect skeletons while connecting', () => {
    const { container } = render(
      <OrderBookPanel
        symbol="BTCUSDT"
        view={createEmptyOrderBookView('BTCUSDT')}
      />,
    );

    expect(screen.getByText('Connecting')).toBeTruthy();
    expect(container.querySelectorAll('.ob-row-skeleton').length).toBe(40);
    expect(container.querySelectorAll('.ob-row[data-price]').length).toBe(0);
  });
});
