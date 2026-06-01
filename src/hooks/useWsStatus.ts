import { useEffect, useState } from 'react';
import { wsManager, type ConnectionStatus, CONNECTION_STATUS as ConnectionStatusValue } from '../lib/binance/BinanceWebSocket';

type UseWsStatusResult = {
  status: ConnectionStatus;
  statusElmStyles: {
    dot: string,
    text: string,
  }
}

const statusStyles: Record<ConnectionStatus, { dot: string; text: string }> = {
  uninstantiated: { dot: 'bg-connection-failed', text: 'text-connection-failed' },
  connecting: { dot: 'bg-connection-in-progress', text: 'text-connection-in-progress' },
  open: { dot: 'bg-connection-live', text: 'text-connection-live' },
  closing: { dot: 'bg-connection-in-progress', text: 'text-connection-in-progress' },
  closed: { dot: 'bg-connection-failed', text: 'text-connection-failed' },
  disconnected: { dot: 'bg-connection-failed', text: 'text-connection-failed' },
  reconnecting: { dot: 'bg-connection-in-progress', text: 'text-connection-in-progress' },
  live: { dot: 'bg-connection-live', text: 'text-connection-live' },
};

export function useWsStatus(): UseWsStatusResult {
  const [status, setStatus] = useState<ConnectionStatus>(wsManager.getStatus());

  useEffect(() => {
    return wsManager.onStatusChange(setStatus); // returns unsubscribe
  }, []);

  const statusText = status === 'open' ? 'live' : status;
  const statusElmStyles = statusStyles[status];

  return {
    status: statusText,
    statusElmStyles
  };
}
