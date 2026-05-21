import { useEffect, useRef, useState } from 'react'

import { BinanceWebSocketManager, CONNECTION_STATUS, type ConnectionStatus } from '../lib/binance/BinanceWebSocket';

export function useBinance(stream: string) {
  const socketManagerRef = useRef<BinanceWebSocketManager | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(CONNECTION_STATUS.Uninstantiated);

  const onMessageHandler = (data: unknown) => {
    console.log('onMessageHandler', data);
  }

  useEffect(() => {
    // initialize binance connection
    const manager = new BinanceWebSocketManager();
    socketManagerRef.current = manager;
    // status change listner with delete handler
    const unsubscribeStatusChange = manager.onStatusChange(setStatus);
    const unsubscribeMessageListener = manager.onMessage(onMessageHandler);

    manager.connect(stream);

    // cleanup
    return () => {
      unsubscribeStatusChange();
      unsubscribeMessageListener();
      manager.disconnect();
    }
  }, [stream]);

  return {
    status,
    manager: socketManagerRef.current
  }

}
