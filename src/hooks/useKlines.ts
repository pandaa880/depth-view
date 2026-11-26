import { useCallback, useEffect, useRef, useState } from 'react';

import { wsManager } from '../lib/binance/BinanceWebSocket';
import { binanceRest } from '../lib/binance/rest-client';
import { createFrameTask, type FrameTask } from '../lib/frameTask';
import {
  boundKlineHistory,
  buildKlineSeries,
  isContinuousKlineSeries,
  KLINE_HISTORY_LIMIT,
  klineIntervalSeconds,
  klineStreamName,
  mergeCandleUpdates,
  parseKlineEvent,
  parseRestKlines,
  type Candle,
  type EmaSeriesPoint,
  type KlineTimeframe,
} from '../lib/indicators/klines';

export type KlinesStatus =
  | 'loading'
  | 'ready'
  | 'resyncing'
  | 'error'
  | 'empty';
export type KlineUpdateKind = 'replace' | 'update';

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
  subscribeStatus: (handler: (status: string) => void) => () => void;
  getStatus: () => string;
  createFrameTask: (callback: () => void) => FrameTask;
}

export interface UseKlinesResult {
  candles: Candle[];
  ema: EmaSeriesPoint[];
  status: KlinesStatus;
  updateKind: KlineUpdateKind;
  error: string | null;
  retry: () => void;
}

interface InternalState {
  key: string;
  candles: Candle[];
  ema: EmaSeriesPoint[];
  status: KlinesStatus;
  updateKind: KlineUpdateKind;
  error: string | null;
}

const EMPTY_CANDLES: Candle[] = [];
const EMPTY_EMA: EmaSeriesPoint[] = [];

const DISCONNECTED_STATUSES = new Set([
  'closed',
  'disconnected',
  'reconnecting',
]);

function isDisconnectedStatus(status: string): boolean {
  return DISCONNECTED_STATUSES.has(status);
}

function loadingState(key: string): InternalState {
  return {
    key,
    candles: EMPTY_CANDLES,
    ema: EMPTY_EMA,
    status: 'loading',
    updateKind: 'replace',
    error: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  subscribeStatus: (handler) => wsManager.onStatusChange(handler),
  getStatus: () => wsManager.getStatus(),
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
    generationRef.current += 1;
    const generation = generationRef.current;

    const key = `${normalizedSymbol}:${timeframe}`;
    const dependencies: KlineDependencies = {
      ...defaultDependencies,
      ...overridesRef.current,
    };
    const interval = klineIntervalSeconds(timeframe);

    let disposed = false;
    let loaded = false;
    let resyncing = false;
    let needsResync = isDisconnectedStatus(dependencies.getStatus());
    let candles: Candle[] = [];
    const pending = new Map<number, Candle>();
    let frameTask: FrameTask | null = null;
    let unsubscribeStream: (() => void) | null = null;
    let unsubscribeStatus: (() => void) | null = null;

    let activeFetch: AbortController | null = null;
    let fetchSequence = 0;
    let activeFetchId = 0;

    function isCurrentFetch(fetchId: number): boolean {
      return (
        !disposed &&
        generation === generationRef.current &&
        fetchId === activeFetchId
      );
    }

    function publish(updateKind: KlineUpdateKind): void {
      const series = buildKlineSeries(candles);
      setState({
        key,
        candles: series.candles,
        ema: series.ema,
        status: series.candles.length === 0 ? 'empty' : 'ready',
        updateKind,
        error: null,
      });
    }

    function publishStale(): void {
      if (!loaded || candles.length === 0) return;

      setState((previous) =>
        previous.key === key && previous.status === 'ready'
          ? { ...previous, status: 'resyncing', error: null }
          : previous,
      );
    }

    function publishError(message: string, keepVisible: boolean): void {
      const series = keepVisible
        ? buildKlineSeries(candles)
        : { candles: EMPTY_CANDLES, ema: EMPTY_EMA };

      setState({
        key,
        candles: series.candles,
        ema: series.ema,
        status: 'error',
        updateKind: 'replace',
        error: message,
      });
    }

    function flushPending(): void {
      if (disposed || !loaded || resyncing || pending.size === 0) return;

      const updates = Array.from(pending.values()).sort(
        (left, right) => left.time - right.time,
      );

      let latestTime: number | null =
        candles.length > 0 ? candles[candles.length - 1].time : null;

      for (const update of updates) {
        if (latestTime !== null && update.time > latestTime + interval) {
          void fetchHistory('resync');
          return;
        }
        if (latestTime === null || update.time > latestTime) {
          latestTime = update.time;
        }
      }

      candles = boundKlineHistory(mergeCandleUpdates(candles, updates));
      pending.clear();
      publish('update');
    }

    function mergePendingIntoSnapshot(snapshot: Candle[]): Candle[] {
      if (pending.size === 0) return snapshot;

      const merged = mergeCandleUpdates(snapshot, pending.values());
      pending.clear();
      return merged;
    }

    async function fetchHistory(mode: 'initial' | 'resync'): Promise<void> {
      if (disposed) return;

      fetchSequence += 1;
      const fetchId = fetchSequence;
      activeFetchId = fetchId;
      activeFetch?.abort();

      const controller = new AbortController();
      activeFetch = controller;

      if (mode === 'resync') {
        resyncing = true;
        publishStale();
      }

      try {
        const payload = await dependencies.fetchKlines(
          normalizedSymbol,
          timeframe,
          KLINE_HISTORY_LIMIT,
          controller.signal,
        );

        if (!isCurrentFetch(fetchId)) return;

        const snapshot = boundKlineHistory(parseRestKlines(payload));
        const merged = boundKlineHistory(mergePendingIntoSnapshot(snapshot));

        if (!isContinuousKlineSeries(merged, timeframe)) {
          resyncing = false;
          pending.clear();
          publishError(
            'Candle history is discontinuous; retry to resynchronize.',
            mode === 'resync' && loaded,
          );
          return;
        }

        candles = merged;
        loaded = true;
        resyncing = false;
        publish('replace');
      } catch (error) {
        if (
          disposed ||
          generation !== generationRef.current ||
          fetchId !== activeFetchId ||
          controller.signal.aborted
        ) {
          return;
        }

        resyncing = false;
        pending.clear();
        publishError(errorMessage(error), mode === 'resync' && loaded);
      }
    }

    setState(loadingState(key));

    frameTask = dependencies.createFrameTask(() => {
      if (!disposed) flushPending();
    });

    unsubscribeStream = dependencies.subscribe(
      klineStreamName(normalizedSymbol, timeframe),
      (payload) => {
        if (disposed) return;

        const update = parseKlineEvent(payload);
        if (!update) return;
        if (update.symbol.toUpperCase() !== normalizedSymbol) return;
        if (update.interval !== timeframe) return;

        pending.set(update.candle.time, update.candle);
        while (pending.size > KLINE_HISTORY_LIMIT) {
          const oldest = pending.keys().next();
          if (oldest.done) break;
          pending.delete(oldest.value);
        }
        frameTask?.request();
      },
    );

    unsubscribeStatus = dependencies.subscribeStatus((status) => {
      if (disposed) return;

      if (isDisconnectedStatus(status)) {
        needsResync = true;
        publishStale();
        return;
      }

      if (status === 'open' && needsResync) {
        needsResync = false;
        void fetchHistory('resync');
      }
    });

    void fetchHistory('initial');

    return () => {
      disposed = true;
      activeFetch?.abort();
      unsubscribeStream?.();
      unsubscribeStatus?.();
      frameTask?.cancel();
    };
  }, [normalizedSymbol, timeframe, reloadToken]);

  const visible = state.key === requestKey ? state : loadingState(requestKey);

  return {
    candles: visible.candles,
    ema: visible.ema,
    status: visible.status,
    updateKind: visible.updateKind,
    error: visible.error,
    retry,
  };
}
