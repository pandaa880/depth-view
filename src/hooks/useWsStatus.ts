import { useCallback, useSyncExternalStore } from 'react';

import {
  wsManager,
  type BinanceWebSocketManager,
} from '../lib/binance/BinanceWebSocket';

type UseWsStatusResult = {
  status: string;
  statusElmStyles: {
    dot: string;
    text: string;
  };
  nextReconnectAt: number | null;
  reconnectAttempt: number;
};

const statusStyles: Record<string, { dot: string; text: string }> = {
  uninstantiated: {
    dot: 'bg-connection-failed',
    text: 'text-connection-failed',
  },
  connecting: {
    dot: 'bg-connection-in-progress',
    text: 'text-connection-in-progress',
  },
  open: { dot: 'bg-connection-live', text: 'text-connection-live' },
  closing: {
    dot: 'bg-connection-in-progress',
    text: 'text-connection-in-progress',
  },
  closed: { dot: 'bg-connection-failed', text: 'text-connection-failed' },
  disconnected: { dot: 'bg-connection-failed', text: 'text-connection-failed' },
  reconnecting: {
    dot: 'bg-connection-in-progress',
    text: 'text-connection-in-progress',
  },
  live: { dot: 'bg-connection-live', text: 'text-connection-live' },
};

export function useWsStatus(
  manager: BinanceWebSocketManager = wsManager,
): UseWsStatusResult {
  const subscribe = useCallback(
    (onStatusChange: () => void) => manager.onStatusChange(onStatusChange),
    [manager],
  );

  // every value comes from the same manager instance; reconnecting creates a
  // new metrics object each call, so snapshots expose primitives instead
  const readStatus = useCallback(
    () => manager.getConnectionMetrics().status,
    [manager],
  );
  const readReconnectAttempt = useCallback(
    () => manager.getConnectionMetrics().reconnectAttempt,
    [manager],
  );
  const readNextReconnectAt = useCallback(
    () => manager.getConnectionMetrics().nextReconnectAt,
    [manager],
  );

  const status = useSyncExternalStore(subscribe, readStatus, readStatus);
  const reconnectAttempt = useSyncExternalStore(
    subscribe,
    readReconnectAttempt,
    readReconnectAttempt,
  );
  const nextReconnectAt = useSyncExternalStore(
    subscribe,
    readNextReconnectAt,
    readNextReconnectAt,
  );

  const statusText = status === 'open' ? 'live' : status;
  const statusElmStyles = statusStyles[status] ?? statusStyles.uninstantiated;

  return {
    status: statusText,
    statusElmStyles,
    nextReconnectAt,
    reconnectAttempt,
  };
}
