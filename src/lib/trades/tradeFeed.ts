import type { TradeView } from '../../models/market';
import { wsManager } from '../binance/BinanceWebSocket';
import { isTradeEvent } from '../binance/guards';
import { createFrameTask, type FrameTask } from '../frameTask';

export const MAX_TRADE_ROWS = 50;

export type TradeStreamSubscribe = (
  stream: string,
  handler: (data: unknown) => void,
) => () => void;

export interface TradeFeedOptions {
  subscribe?: TradeStreamSubscribe;
  frameTaskFactory?: (callback: () => void) => FrameTask;
}

export interface TradeFeed {
  readonly symbol: string;
  getTrades: () => readonly TradeView[];
  subscribe: (listener: () => void) => () => void;
  start: () => void;
  stop: () => void;
}

const EMPTY_TRADES: readonly TradeView[] = Object.freeze([]);

function sameTrades(
  left: readonly TradeView[],
  right: readonly TradeView[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((trade, index) => trade === right[index]);
}

export function createTradeFeed(
  symbol: string,
  options: TradeFeedOptions = {},
): TradeFeed {
  const stream = `${symbol.toLowerCase()}@trade`;
  const subscribeToStream =
    options.subscribe ??
    ((name: string, handler: (data: unknown) => void) =>
      wsManager.subscribe(name, handler));
  const createTask =
    options.frameTaskFactory ??
    ((callback: () => void) => createFrameTask(callback));

  const listeners = new Set<() => void>();
  let trades: readonly TradeView[] = EMPTY_TRADES;
  let pending: TradeView[] = [];
  let seenIds = new Set<number>();
  let unsubscribeStream: (() => void) | null = null;
  let started = false;

  const publication = createTask(() => flush());

  function flush(): void {
    if (pending.length === 0) return;

    const incoming = pending;
    pending = [];
    const next: TradeView[] = [];
    const nextIds = new Set<number>();

    for (
      let index = incoming.length - 1;
      index >= 0 && next.length < MAX_TRADE_ROWS;
      index -= 1
    ) {
      const trade = incoming[index];
      if (nextIds.has(trade.id)) continue;
      nextIds.add(trade.id);
      next.push(trade);
    }

    for (const trade of trades) {
      if (next.length >= MAX_TRADE_ROWS) break;
      if (nextIds.has(trade.id)) continue;
      nextIds.add(trade.id);
      next.push(trade);
    }

    seenIds = nextIds;
    if (sameTrades(next, trades)) return;

    trades = Object.freeze(next);
    for (const listener of Array.from(listeners)) listener();
  }

  function handleMessage(data: unknown): void {
    if (!started || !isTradeEvent(data)) return;
    if (data.s.toUpperCase() !== symbol.toUpperCase()) return;
    if (seenIds.has(data.t)) return;

    seenIds.add(data.t);
    pending.push({
      id: data.t,
      time: data.T,
      price: data.p,
      quantity: data.q,
      isBuyerMaker: data.m,
    });
    publication.request();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    let active = true;

    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  function start(): void {
    if (started) return;
    started = true;
    unsubscribeStream = subscribeToStream(stream, handleMessage);
  }

  function stop(): void {
    started = false;
    publication.cancel();
    pending = [];
    trades = EMPTY_TRADES;
    seenIds.clear();

    const unsubscribe = unsubscribeStream;
    unsubscribeStream = null;
    unsubscribe?.();
  }

  return {
    symbol,
    getTrades: () => trades,
    subscribe,
    start,
    stop,
  };
}
