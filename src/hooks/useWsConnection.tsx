import { useEffect } from 'react';

import { DEFAULT_SYMBOLS } from '../config/markets';
import { wsManager } from '../lib/binance/BinanceWebSocket';
import { binanceRest } from '../lib/binance/rest-client';
import {
  isMiniTickerRaw,
  mergeTickerSnapshot,
  transformMiniTicker,
  transformTicker24hr,
  type MiniTickerRaw,
} from '../lib/binance/transformers/miniTicker';
import { createFrameTask, type FrameTask } from '../lib/frameTask';
import type { TickerData } from '../models';
import type { SymbolInfo } from '../models/SymbolInfo';
import { useExchangeInfoStore, useTickerStore } from '../stores/globalStore';

const MINI_TICKER_STREAM = '!miniTicker@arr';

type TickerMessageHandler = (data: unknown) => void;

export type TickerSocket = {
  connect: () => void;
  subscribe: (stream: string, handler: TickerMessageHandler) => () => void;
};

type SymbolInfoSource = () => Record<string, SymbolInfo>;
type TickerSource = () => Record<string, TickerData>;
type TickerSink = (updates: Record<string, TickerData>) => void;

export interface MiniTickerFeedOptions {
  socket?: TickerSocket;
  frameTaskFactory?: (callback: () => void) => FrameTask;
  getSymbolInfo?: SymbolInfoSource;
  getTickers?: TickerSource;
  setTickers?: TickerSink;
  symbols?: readonly string[];
}

export interface MiniTickerFeed {
  start: () => () => void;
  requestFlush: () => void;
}

const defaultSymbolInfo: SymbolInfoSource = () =>
  useExchangeInfoStore.getState().symbolInfo;
const defaultTickers: TickerSource = () => useTickerStore.getState().tickers;
const defaultSetTickers: TickerSink = (updates) =>
  useTickerStore.getState().setTickers(updates);

/**
 * Owns the global mini ticker subscription. Raw frames are the only
 * thing the socket handler touches; Zustand is updated from the frame
 * callback so high frequency messages cannot trigger per-message
 * renders. Subscription counts make repeated start/release idempotent.
 */
export function createMiniTickerFeed(
  options: MiniTickerFeedOptions = {},
): MiniTickerFeed {
  const socket = options.socket ?? wsManager;
  const frameTaskFactory = options.frameTaskFactory ?? createFrameTask;
  const getSymbolInfo = options.getSymbolInfo ?? defaultSymbolInfo;
  const getTickers = options.getTickers ?? defaultTickers;
  const setTickers = options.setTickers ?? defaultSetTickers;
  const symbolSet = new Set<string>(options.symbols ?? DEFAULT_SYMBOLS);

  const pending = new Map<string, MiniTickerRaw>();
  let task: FrameTask | null = null;
  let unsubscribe: (() => void) | null = null;
  let subscribers = 0;
  let active = false;

  const flush = (): void => {
    if (!active) return;

    const symbolInfo = getSymbolInfo();
    if (Object.keys(symbolInfo).length === 0) return;

    const existing = getTickers();
    const updates: Record<string, TickerData> = {};
    const buffered = Array.from(pending.entries());
    pending.clear();

    for (const [symbol, raw] of buffered) {
      if (!symbolInfo[symbol]) continue;

      const next = transformMiniTicker(raw, existing[symbol]);
      if (next) updates[symbol] = next;
    }

    if (Object.keys(updates).length > 0) setTickers(updates);
  };

  const handleMessage = (data: unknown): void => {
    if (!active || !Array.isArray(data)) return;

    let accepted = false;
    for (const item of data) {
      if (!isMiniTickerRaw(item) || !symbolSet.has(item.s)) continue;
      const previous = pending.get(item.s);
      if (previous && previous.E > item.E) continue;

      pending.set(item.s, item);
      accepted = true;
    }

    if (accepted) task?.request();
  };

  const start = (): (() => void) => {
    subscribers += 1;

    if (subscribers === 1) {
      active = true;
      task = frameTaskFactory(flush);
      unsubscribe = socket.subscribe(MINI_TICKER_STREAM, handleMessage);
      socket.connect();
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      subscribers = Math.max(0, subscribers - 1);
      if (subscribers > 0) return;

      active = false;
      const remove = unsubscribe;
      const pendingTask = task;
      unsubscribe = null;
      task = null;
      remove?.();
      pendingTask?.cancel();
      pending.clear();
    };
  };

  return {
    start,
    requestFlush: () => {
      if (active) task?.request();
    },
  };
}

export interface TickerSnapshotRest {
  get24hrTickers: (
    symbols: readonly string[],
    signal?: AbortSignal,
  ) => Promise<unknown>;
}

export interface TickerBootstrapOptions {
  rest?: TickerSnapshotRest;
  symbols?: readonly string[];
  getTickers?: TickerSource;
  setTickers?: TickerSink;
}

export interface TickerBootstrap {
  run: () => Promise<void>;
}

/**
 * Runs the 24hr snapshot request once for the page lifetime. A settled
 * request, successful or not, is reused so React effect replays cannot
 * produce duplicate fetches or a retry loop. A failed snapshot leaves
 * the live stream untouched.
 */
export function createTickerBootstrap(
  options: TickerBootstrapOptions = {},
): TickerBootstrap {
  const rest = options.rest ?? binanceRest;
  const symbols = options.symbols ?? DEFAULT_SYMBOLS;
  const allowedSymbols = new Set<string>(symbols);
  const getTickers = options.getTickers ?? defaultTickers;
  const setTickers = options.setTickers ?? defaultSetTickers;

  let request: Promise<void> | null = null;

  const execute = async (): Promise<void> => {
    try {
      const rows = await rest.get24hrTickers(symbols);
      if (!Array.isArray(rows)) return;

      const existing = getTickers();
      const updates: Record<string, TickerData> = {};

      for (const row of rows) {
        const snapshot = transformTicker24hr(row);
        if (!snapshot || !allowedSymbols.has(snapshot.symbol)) continue;

        const current = updates[snapshot.symbol] ?? existing[snapshot.symbol];
        const merged = mergeTickerSnapshot(current, snapshot);
        if (merged !== current) updates[snapshot.symbol] = merged;
      }

      if (Object.keys(updates).length > 0) setTickers(updates);
    } catch {
      // snapshot is an enhancement; streamed values remain authoritative
    }
  };

  return {
    run: () => {
      if (!request) request = execute();
      return request;
    },
  };
}

const sharedFeed = createMiniTickerFeed();
const sharedBootstrap = createTickerBootstrap();

export type WsConnectionOptions = {
  feed?: MiniTickerFeed;
  bootstrap?: TickerBootstrap;
};

export function useWsConnection(options: WsConnectionOptions = {}) {
  const feed = options.feed ?? sharedFeed;
  const bootstrap = options.bootstrap ?? sharedBootstrap;
  const isBootstrapped = useExchangeInfoStore((state) => state.isBootstrapped);

  useEffect(() => feed.start(), [feed]);

  useEffect(() => {
    if (!isBootstrapped) return;

    feed.requestFlush();
    void bootstrap.run();
  }, [bootstrap, feed, isBootstrapped]);
}
