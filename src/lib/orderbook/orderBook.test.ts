import { describe, expect, it } from 'vitest';

import type { DepthSnapshotResponse, DepthUpdateEvent } from '../binance/types';
import {
  applyNextDepthUpdate,
  createEmptyOrderBookView,
  createOrderBook,
  loadDepthSnapshot,
  normalizeDepthUpdate,
  projectOrderBookView,
  reconcileBufferedDepthUpdates,
} from './orderBook';

function snapshot(
  lastUpdateId: number,
  bids: [string, string][] = [],
  asks: [string, string][] = [],
): DepthSnapshotResponse {
  return { lastUpdateId, bids, asks };
}

function update(
  U: number,
  u: number,
  bids: [string, string][] = [],
  asks: [string, string][] = [],
): DepthUpdateEvent {
  return {
    e: 'depthUpdate',
    E: 1000 + u,
    s: 'BTCUSDT',
    U,
    u,
    b: bids,
    a: asks,
  };
}

describe('order-book sequence helpers', () => {
  it('drops stale buffered events and accepts the first snapshot bridge', () => {
    const book = createOrderBook();
    loadDepthSnapshot(
      book,
      snapshot(100, [['100.000', '1.0']], [['101', '1']]),
    );

    const result = reconcileBufferedDepthUpdates(book, [
      update(99, 100, [['90', '9']]),
      update(100, 101, [['100.00', '0.1']]),
      update(102, 102, [['100', '0']], [['102', '2']]),
    ]);

    expect(result).toBe('live');
    expect(book.lastUpdateId).toBe(102);
    expect(book.bids.has('90')).toBe(false);
    expect(book.bids.has('100')).toBe(false);
    expect(book.asks.get('102')).toBe('2');
  });

  it('waits when all buffered events are stale', () => {
    const book = createOrderBook();
    loadDepthSnapshot(book, snapshot(100));

    expect(
      reconcileBufferedDepthUpdates(book, [update(99, 99), update(100, 100)]),
    ).toBe('waiting');
    expect(book.lastUpdateId).toBe(100);
  });

  it('rejects a bridge that starts after the snapshot boundary', () => {
    const book = createOrderBook();
    loadDepthSnapshot(book, snapshot(100));

    expect(reconcileBufferedDepthUpdates(book, [update(102, 102)])).toBe('gap');
  });

  it('rejects a discontinuity on the second diff without reordering', () => {
    const book = createOrderBook();
    loadDepthSnapshot(book, snapshot(100));

    expect(
      reconcileBufferedDepthUpdates(book, [
        update(101, 101),
        update(103, 103),
        update(102, 102),
      ]),
    ).toBe('gap');
  });

  it('requires every live diff to start at previous u + 1', () => {
    const book = createOrderBook();
    loadDepthSnapshot(book, snapshot(10));

    expect(applyNextDepthUpdate(book, update(11, 11))).toBe('applied');
    expect(applyNextDepthUpdate(book, update(11, 11))).toBe('gap');
    expect(applyNextDepthUpdate(book, update(13, 13))).toBe('gap');
  });

  it('canonicalizes decimal levels and removes quantities equaling zero', () => {
    const event = normalizeDepthUpdate(
      update(11, 11, [['00100.000', '0.000']], [['101.000', '01.2500']]),
    );
    expect(event.b[0]).toEqual(['100', '0']);
    expect(event.a[0]).toEqual(['101', '1.25']);

    const book = createOrderBook();
    loadDepthSnapshot(book, snapshot(10, [['100', '4']], [['101', '1']]));
    expect(applyNextDepthUpdate(book, event)).toBe('applied');
    expect(book.bids.has('100')).toBe(false);
    expect(book.asks.get('101')).toBe('1.25');
  });

  it('keeps only the best 1000 prices on each internal side', () => {
    const bids: [string, string][] = [];
    for (let price = 1; price <= 1002; price += 1) {
      bids.push([String(price), '1']);
    }

    const book = createOrderBook();
    loadDepthSnapshot(book, snapshot(1, bids));
    expect(book.bids.size).toBe(1000);
    expect(book.bids.has('1002')).toBe(true);
    expect(book.bids.has('3')).toBe(true);
    expect(book.bids.has('2')).toBe(false);
  });
});

describe('order-book view projection', () => {
  it('sorts the displayed top 20 in opposite directions', () => {
    const bids: [string, string][] = [];
    const asks: [string, string][] = [];
    for (let index = 0; index < 25; index += 1) {
      bids.push([String(index + 1), '1']);
      asks.push([String(100 + index), '1']);
    }

    const book = createOrderBook();
    loadDepthSnapshot(book, snapshot(1, bids, asks));
    reconcileBufferedDepthUpdates(book, [update(2, 2)]);
    const view = projectOrderBookView(
      book,
      'BTCUSDT',
      0,
      createEmptyOrderBookView('BTCUSDT'),
    );

    expect(view.bids).toHaveLength(20);
    expect(view.asks).toHaveLength(20);
    expect(view.bids[0].price).toBe('25');
    expect(view.bids[19].price).toBe('6');
    expect(view.asks[0].price).toBe('100');
    expect(view.asks[19].price).toBe('119');
  });

  it('uses exact cumulative quantities, spread, midpoint, and ratios', () => {
    const book = createOrderBook();
    loadDepthSnapshot(
      book,
      snapshot(
        1,
        [
          ['99', '0.1'],
          ['98', '0.2'],
          ['97', '0.3'],
        ],
        [
          ['101', '1'],
          ['102', '2'],
        ],
      ),
    );
    reconcileBufferedDepthUpdates(book, [update(2, 2)]);

    const view = projectOrderBookView(
      book,
      'BTCUSDT',
      0,
      createEmptyOrderBookView('BTCUSDT'),
    );

    expect(view.bids.map((row) => row.cumulativeQuantity)).toEqual([
      '0.1',
      '0.3',
      '0.6',
    ]);
    expect(view.asks.map((row) => row.cumulativeQuantity)).toEqual(['1', '3']);
    expect(view.bids[0].depthRatio).toBeCloseTo(1 / 6);
    expect(view.bids[1].depthRatio).toBe(0.5);
    expect(view.bids[2].depthRatio).toBe(1);
    expect(view.asks[1].depthRatio).toBe(1);
    expect(view.spread).toBe('2');
    expect(view.spreadBps).toBe('200');
  });

  it('uses zero spread values when either side is empty', () => {
    const book = createOrderBook();
    loadDepthSnapshot(book, snapshot(1, [['100', '1']]));
    reconcileBufferedDepthUpdates(book, [update(2, 2)]);

    const view = projectOrderBookView(
      book,
      'BTCUSDT',
      0,
      createEmptyOrderBookView('BTCUSDT'),
    );
    expect(view.spread).toBe('0');
    expect(view.spreadBps).toBe('0');
  });

  it('preserves unchanged rows and side arrays across projections', () => {
    const book = createOrderBook();
    loadDepthSnapshot(
      book,
      snapshot(
        1,
        [['99', '1']],
        [
          ['101', '1'],
          ['102', '2'],
        ],
      ),
    );
    reconcileBufferedDepthUpdates(book, [update(2, 2)]);
    const previous = projectOrderBookView(
      book,
      'BTCUSDT',
      0,
      createEmptyOrderBookView('BTCUSDT'),
    );

    applyNextDepthUpdate(book, update(3, 3, [['99', '2']]));
    const next = projectOrderBookView(book, 'BTCUSDT', 0, previous);

    expect(next).not.toBe(previous);
    expect(next.asks).toBe(previous.asks);
    expect(next.asks[0]).toBe(previous.asks[0]);
    expect(next.bids[0]).not.toBe(previous.bids[0]);
  });
});
