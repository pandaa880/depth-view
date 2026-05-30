import { useEffect } from 'react';

import {
  wsManager,
} from '../lib/binance/BinanceWebSocket';
import { transformMiniTicker, type MiniTickerRaw } from '../lib/binance/transformers/miniTicker';
import { useTickerStore } from '../stores/globalStore';
import { useExchangeInfoStore } from '../stores/globalStore';
import type { TickerData } from '../models';

export function useWsConnection() {
  const miniTickerSubscriptionHandler = (data: MiniTickerRaw[]) => {
    const messages = data;
    // filter out the tracked symbols
    const trackedSymbols = new Set(Object.keys(useExchangeInfoStore.getState().symbolInfo));

    if (trackedSymbols.size === 0) return;       // exchange info not loaded yet

    // get the existing tickers data
    const existing = useTickerStore.getState().tickers;
    const updates: Record<string, TickerData> = {};

    //filter out the message per symbol
    for (const message of messages) {
      if (!trackedSymbols.has(message.s)) {
        continue;
      }
      updates[message.s] = transformMiniTicker(message, existing[message.s]);
    }

    if (Object.keys(updates).length > 0) {
      useTickerStore.getState().setTickers(updates);
    }
  }

  useEffect(() => {
    wsManager.connect();
    const unsub = wsManager.subscribe('!miniTicker@arr', miniTickerSubscriptionHandler);

    return () => unsub();
  }, []);
}
