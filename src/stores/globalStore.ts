import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import { type SymbolInfo } from '../models/SymbolInfo';
import { type TickerData } from '../models';

type CachedSymbolInfo = Record<string, SymbolInfo>;

export type ExchangeInfoStore = {
  symbolInfo: CachedSymbolInfo;
  isBootstrapped: boolean;

  setSymbolInfo: (info: CachedSymbolInfo) => void;
};

export const useExchangeInfoStore = create<ExchangeInfoStore>()(
  devtools(
    (set) => ({
      symbolInfo: {},
      isBootstrapped: false,
      setSymbolInfo: (info) => set({ symbolInfo: info, isBootstrapped: true }),
    }),
    { name: 'Markets UI - Depth view' },
  ),
);

export type TickerDataStore = {
  tickers: Record<string, TickerData>;
  setTickers: (updates: Record<string, TickerData>) => void;
}

export const useTickerStore = create<TickerDataStore>()(
  devtools(
    (set) => ({
      tickers: {},
      setTickers: (updates) => set((state) => ({
        tickers: { ...state.tickers, ...updates }
      }))
    }),
    { name: "Markets UI - Ticker Store" }
  )
);
