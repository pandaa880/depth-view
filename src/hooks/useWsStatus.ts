import { useCallback, useSyncExternalStore } from 'react';

import {
  wsManager,
  type BinanceWebSocketManager,
} from '../lib/binance/BinanceWebSocket';
import { useMarketHealthStore } from '../stores/marketHealth';

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
  const getSnapshot = useCallback(() => manager.getStatus(), [manager]);
  const status = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // only low-frequency reconnect metadata is read from the health store, so
  // raw messages never re-render this hook
  const nextReconnectAt = useMarketHealthStore(
    (state) => state.global.nextReconnectAt,
  );
  const reconnectAttempt = useMarketHealthStore(
    (state) => state.global.reconnectAttempt,
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
