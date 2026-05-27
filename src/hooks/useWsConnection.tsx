import { useEffect } from 'react';

import {
  wsManager,
} from '../lib/binance/BinanceWebSocket';

export function useWsConnection() {
  useEffect(() => {
    wsManager.connect();
    const unsub = wsManager.subscribe('!miniTicker@arr', (data) => {
      console.log(data); // verify messages arriving before wiring to store
    });

    return () => unsub();
  }, []);
}
