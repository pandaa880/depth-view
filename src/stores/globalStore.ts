import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import { type SymbolInfo } from '../models/SymbolInfo';

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
    { name: 'Markets UI' },
  ),
);
