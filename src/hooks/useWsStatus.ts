import { useEffect, useState } from 'react';
import { wsManager, type ConnectionStatus } from '../lib/binance/BinanceWebSocket';

export function useWsStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(wsManager.getStatus());

  useEffect(() => {
    return wsManager.onStatusChange(setStatus); // returns unsubscribe
  }, []);

  return status;
}
