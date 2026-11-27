import type { BookViewLevel, OrderBookView } from '../../models/market';
import {
  addDecimal,
  compareDecimal,
  decimalRatio,
  multiplyDecimal,
  normalizeDecimal,
  ratioToFraction,
  subtractDecimal,
} from '../decimal';
import type { DepthSnapshotResponse, DepthUpdateEvent } from '../binance/types';

export const BOOK_LEVEL_LIMIT = 1000;
export const VIEW_LEVEL_LIMIT = 20;

const SPREAD_BPS_DIGITS = 18;

type PriceLevel = [string, string];

export interface MutableOrderBook {
  bids: Map<string, string>;
  asks: Map<string, string>;
  lastUpdateId: number | null;
}

export type BufferedReconciliation =
  | 'waiting'
  | 'live'
  | 'gap'
  | 'stale-snapshot';

export function createOrderBook(): MutableOrderBook {
  return {
    bids: new Map(),
    asks: new Map(),
    lastUpdateId: null,
  };
}

export function clearOrderBook(book: MutableOrderBook): void {
  book.bids.clear();
  book.asks.clear();
  book.lastUpdateId = null;
}

function normalizeLevels(levels: PriceLevel[]): PriceLevel[] {
  return levels.map(([price, quantity]) => [
    normalizeDecimal(price),
    normalizeDecimal(quantity),
  ]);
}

export function normalizeDepthUpdate(
  event: DepthUpdateEvent,
): DepthUpdateEvent {
  return {
    ...event,
    b: normalizeLevels(event.b),
    a: normalizeLevels(event.a),
  };
}

function sortedPrices(
  levels: Map<string, string>,
  side: 'bids' | 'asks',
): string[] {
  return Array.from(levels.keys()).sort((left, right) =>
    side === 'bids' ? compareDecimal(right, left) : compareDecimal(left, right),
  );
}

function trimLevels(levels: Map<string, string>, side: 'bids' | 'asks'): void {
  if (levels.size <= BOOK_LEVEL_LIMIT) return;

  const keep = new Set(sortedPrices(levels, side).slice(0, BOOK_LEVEL_LIMIT));
  for (const price of levels.keys()) {
    if (!keep.has(price)) levels.delete(price);
  }
}

function applyLevels(levels: Map<string, string>, updates: PriceLevel[]): void {
  for (const [price, quantity] of updates) {
    if (quantity === '0') {
      levels.delete(price);
    } else {
      levels.set(price, quantity);
    }
  }
}

export function loadDepthSnapshot(
  book: MutableOrderBook,
  snapshot: DepthSnapshotResponse,
): void {
  if (
    !Number.isSafeInteger(snapshot.lastUpdateId) ||
    snapshot.lastUpdateId < 0
  ) {
    throw new TypeError('Invalid depth snapshot sequence');
  }

  const bids = normalizeLevels(snapshot.bids);
  const asks = normalizeLevels(snapshot.asks);

  clearOrderBook(book);
  applyLevels(book.bids, bids);
  applyLevels(book.asks, asks);
  trimLevels(book.bids, 'bids');
  trimLevels(book.asks, 'asks');
  book.lastUpdateId = snapshot.lastUpdateId;
}

function updateSequence(book: MutableOrderBook, event: DepthUpdateEvent): void {
  applyLevels(book.bids, event.b);
  applyLevels(book.asks, event.a);
  trimLevels(book.bids, 'bids');
  trimLevels(book.asks, 'asks');
  book.lastUpdateId = event.u;
}

export function applyNextDepthUpdate(
  book: MutableOrderBook,
  event: DepthUpdateEvent,
): 'applied' | 'ignored' | 'gap' {
  if (book.lastUpdateId !== null && event.u <= book.lastUpdateId) {
    return 'ignored';
  }

  if (
    book.lastUpdateId === null ||
    event.u < event.U ||
    event.U !== book.lastUpdateId + 1
  ) {
    return 'gap';
  }

  updateSequence(book, event);
  return 'applied';
}

export function reconcileBufferedDepthUpdates(
  book: MutableOrderBook,
  events: DepthUpdateEvent[],
): BufferedReconciliation {
  if (book.lastUpdateId === null) return 'gap';

  let index = 0;
  while (index < events.length && events[index].u <= book.lastUpdateId) {
    index += 1;
  }

  if (index === events.length) return 'waiting';

  const first = events[index];
  const nextId = book.lastUpdateId + 1;
  // The snapshot predates the stream: not a sequence gap, refetch it.
  if (first.U > nextId) return 'stale-snapshot';
  if (first.u < nextId || first.u < first.U) return 'gap';
  updateSequence(book, first);
  index += 1;

  for (; index < events.length; index += 1) {
    if (applyNextDepthUpdate(book, events[index]) === 'gap') return 'gap';
  }

  return 'live';
}

function sameLevel(left: BookViewLevel, right: BookViewLevel): boolean {
  return (
    left.price === right.price &&
    left.quantity === right.quantity &&
    left.cumulativeQuantity === right.cumulativeQuantity &&
    left.depthRatio === right.depthRatio
  );
}

function projectSide(
  levels: Map<string, string>,
  side: 'bids' | 'asks',
  previous: BookViewLevel[],
): BookViewLevel[] {
  const prices = sortedPrices(levels, side).slice(0, VIEW_LEVEL_LIMIT);
  const rows: BookViewLevel[] = [];
  let cumulative = '0';

  for (const price of prices) {
    const quantity = levels.get(price)!;
    cumulative = addDecimal(cumulative, quantity);
    rows.push({
      price,
      quantity,
      cumulativeQuantity: cumulative,
      depthRatio: 0,
    });
  }

  const maximum = cumulative;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    row.depthRatio = ratioToFraction(row.cumulativeQuantity, maximum);
    const previousRow = previous[index];
    if (previousRow && sameLevel(previousRow, row)) rows[index] = previousRow;
  }

  if (
    rows.length === previous.length &&
    rows.every((row, index) => row === previous[index])
  ) {
    return previous;
  }

  return rows;
}

function metadataView(
  previous: OrderBookView,
  symbol: string,
  state: OrderBookView['state'],
  lastUpdateId: number | null,
  gapCount: number,
): OrderBookView {
  if (
    previous.symbol === symbol &&
    previous.state === state &&
    previous.lastUpdateId === lastUpdateId &&
    previous.gapCount === gapCount
  ) {
    return previous;
  }

  return { ...previous, symbol, state, lastUpdateId, gapCount };
}

export function createEmptyOrderBookView(
  symbol: string,
  state: OrderBookView['state'] = 'connecting',
): OrderBookView {
  return {
    symbol,
    bids: [],
    asks: [],
    spread: '0',
    spreadBps: '0',
    state,
    lastUpdateId: null,
    gapCount: 0,
  };
}

export function preserveOrderBookView(
  previous: OrderBookView,
  state: OrderBookView['state'],
  gapCount: number,
): OrderBookView {
  return metadataView(
    previous,
    previous.symbol,
    state,
    previous.lastUpdateId,
    gapCount,
  );
}

export function projectOrderBookView(
  book: MutableOrderBook,
  symbol: string,
  gapCount: number,
  previous: OrderBookView,
): OrderBookView {
  const bids = projectSide(book.bids, 'bids', previous.bids);
  const asks = projectSide(book.asks, 'asks', previous.asks);
  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;

  let spread = '0';
  let spreadBps = '0';
  if (bestBid !== undefined && bestAsk !== undefined) {
    spread = subtractDecimal(bestAsk, bestBid);
    const midpoint = multiplyDecimal(addDecimal(bestBid, bestAsk), '0.5');
    if (midpoint !== '0') {
      spreadBps = decimalRatio(
        multiplyDecimal(spread, '10000'),
        midpoint,
        SPREAD_BPS_DIGITS,
      );
    }
  }

  if (
    previous.symbol === symbol &&
    previous.state === 'live' &&
    previous.lastUpdateId === book.lastUpdateId &&
    previous.gapCount === gapCount &&
    previous.spread === spread &&
    previous.spreadBps === spreadBps &&
    previous.bids === bids &&
    previous.asks === asks
  ) {
    return previous;
  }

  return {
    symbol,
    bids,
    asks,
    spread,
    spreadBps,
    state: 'live',
    lastUpdateId: book.lastUpdateId,
    gapCount,
  };
}
