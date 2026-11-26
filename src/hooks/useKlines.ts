import { useCallback, useEffect, useRef, useState } from 'react';

import { wsManager } from '../lib/binance/BinanceWebSocket';
import { binanceRest } from '../lib/binance/rest-client';
import { createFrameTask, type FrameTask } from '../lib/frameTask';
import {
  buildKlineSeries,
  KLINE_HISTORY_LIMIT,
  klineStreamName,
  mergeCandleUpdates,
  parseKlineEvent,
  parseRestKlines,
  type Candle,
  type EmaSeriesPoint,
  type KlineTimeframe,
} from '../lib/indicators/klines';

export type KlinesStatus = 'loading' | 'ready' | 'error' | 'empty';

export interface KlineDependencies {
  fetchKlines: (
    symbol: string,
    timeframe: KlineTimeframe,
    limit: number,
    signal: AbortSignal,
  ) => Promise<unknown>;
  subscribe: (
    stream: string,
    handler: (payload: unknown) => void,
  ) => () => void;
  createFrameTask: (callback: () => void) => FrameTask;
}

export interface UseKlinesResult {
  candles: Candle[];
  ema: EmaSeriesPoint[];
  status: KlinesStatus;
  error: string | null;
  retry: () => void;
}

interface InternalState {
  key: string;
  candles: Candle[];
  ema: EmaSeriesPoint[];
  status: KlinesStatus;
  error: string | null;
}

const EMPTY_CANDLES: Candle[] = [];
const EMPTY_EMA: EmaSeriesPoint[] = [];

function loadingState(key: string): InternalState {
  return {
    key,
    candles: EMPTY_CANDLES,
    ema: EMPTY_EMA,
    status: 'loading',
    error: null,
  };
}

/**
 * Subscribes to the shared Binance socket manager. Connection ownership stays
 * with the application shell; this hook only registers the kline stream.
 */
function defaultSubscribe(
  stream: string,
  handler: (payload: unknown) => void,
): () => void {
  return wsManager.subscribe(stream, handler);
}

const defaultDependencies: KlineDependencies = {
  fetchKlines: (symbol, timeframe, limit, signal) =>
    binanceRest.getKlines(symbol, timeframe, limit, signal),
  subscribe: defaultSubscribe,
  createFrameTask: (callback) => createFrameTask(callback),
};

export function useKlines(
  symbol: string,
  timeframe: KlineTimeframe,
  overrides: Partial<KlineDependencies> = {},
): UseKlinesResult {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const requestKey = `${normalizedSymbol}:${timeframe}`;
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<InternalState>(() =>
    loadingState(requestKey),
  );

  const generationRef = useRef(0);
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  const retry = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    const key = `${normalizedSymbol}:${timeframe}`;
    const dependencies: KlineDependencies = {
      ...defaultDependencies,
      ...overridesRef.current,
    };
    const controller = new AbortController();

    let disposed = false;
    let loaded = false;
    let candles: Candle[] = [];
    const pending = new Map<number, Candle>();
    let frameTask: FrameTask | null = null;
    let unsubscribe: (() => void) | null = null;

    function publish(): void {
      const series = buildKlineSeries(candles);
      setState({
        key,
        candles: series.candles,
        ema: series.ema,
        status: series.candles.length === 0 ? 'empty' : 'ready',
        error: null,
      });
    }

    function flushPending(): void {
      if (!loaded || pending.size === 0) return;

      candles = mergeCandleUpdates(candles, pending.values());
      pending.clear();
      publish();
    }

    setState(loadingState(key));

    frameTask = dependencies.createFrameTask(() => {
      if (!disposed) flushPending();
    });

    unsubscribe = dependencies.subscribe(
      klineStreamName(normalizedSymbol, timeframe),
      (payload) => {
        if (disposed) return;

        const update = parseKlineEvent(payload);
        if (!update) return;
        if (update.symbol.toUpperCase() !== normalizedSymbol) return;
        if (update.interval !== timeframe) return;

        pending.set(update.candle.time, update.candle);
        frameTask?.request();
      },
    );

    async function load(): Promise<void> {
      try {
        const payload = await dependencies.fetchKlines(
          normalizedSymbol,
          timeframe,
          KLINE_HISTORY_LIMIT,
          controller.signal,
        );

        if (disposed || generation !== generationRef.current) return;

        candles = parseRestKlines(payload);
        loaded = true;

        if (pending.size > 0) {
          candles = mergeCandleUpdates(candles, pending.values());
          pending.clear();
        }

        publish();
      } catch (error) {
        if (disposed || generation !== generationRef.current) return;
        if (controller.signal.aborted) return;

        setState({
          key,
          candles: EMPTY_CANDLES,
          ema: EMPTY_EMA,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    void load();

    return () => {
      disposed = true;
      controller.abort();
      unsubscribe?.();
      frameTask?.cancel();
    };
  }, [normalizedSymbol, timeframe, reloadToken]);

  const visible = state.key === requestKey ? state : loadingState(requestKey);

  return {
    candles: visible.candles,
    ema: visible.ema,
    status: visible.status,
    error: visible.error,
    retry,
  };
}
