import { create } from 'zustand';

import type { ConnectionStatus } from '../lib/binance/BinanceWebSocket';

export interface FeedHealth {
  status: ConnectionStatus;
  messagesPerSecond: number;
  lastMessageAt: number | null;
  gapCount: number;
  reconnectAttempt: number;
  nextReconnectAt: number | null;
  isStale: boolean;
}

export const initialFeedHealth: FeedHealth = {
  status: 'uninstantiated',
  messagesPerSecond: 0,
  lastMessageAt: null,
  gapCount: 0,
  reconnectAttempt: 0,
  nextReconnectAt: null,
  isStale: false,
};

export function createFeedHealth(
  overrides: Partial<FeedHealth> = {},
): FeedHealth {
  return { ...initialFeedHealth, ...overrides };
}

export interface MarketHealthStore {
  global: FeedHealth;
  book: FeedHealth;
  updateGlobal: (patch: Partial<FeedHealth>) => void;
  updateBook: (patch: Partial<FeedHealth>) => void;
  recordGlobalMessage: (timestamp: number) => void;
  noteBookGap: () => void;
}

function mergeFeedHealth(
  current: FeedHealth,
  patch: Partial<FeedHealth>,
): FeedHealth {
  let changed = false;
  const definedPatch: Partial<FeedHealth> = {};

  for (const key of Object.keys(patch) as (keyof FeedHealth)[]) {
    const value = patch[key];
    if (value === undefined) continue;

    if (current[key] !== value) changed = true;
    Object.assign(definedPatch, { [key]: value });
  }

  return changed ? { ...current, ...definedPatch } : current;
}

export function createMarketHealthStore() {
  let messageSecond: number | null = null;
  let messagesInSecond = 0;

  return create<MarketHealthStore>()((set) => ({
    global: createFeedHealth(),
    book: createFeedHealth(),

    updateGlobal(patch) {
      set((state) => {
        const global = mergeFeedHealth(state.global, patch);
        return global === state.global ? state : { global };
      });
    },

    updateBook(patch) {
      set((state) => {
        const book = mergeFeedHealth(state.book, patch);
        return book === state.book ? state : { book };
      });
    },

    recordGlobalMessage(timestamp) {
      const second = Math.floor(timestamp / 1000);
      if (second === messageSecond) {
        messagesInSecond += 1;
      } else {
        messageSecond = second;
        messagesInSecond = 1;
      }

      set((state) => ({
        global: {
          ...state.global,
          messagesPerSecond: messagesInSecond,
          lastMessageAt: timestamp,
          isStale: false,
        },
      }));
    },

    noteBookGap() {
      set((state) => ({
        book: {
          ...state.book,
          gapCount: state.book.gapCount + 1,
          isStale: true,
        },
      }));
    },
  }));
}

export const useMarketHealthStore = createMarketHealthStore();
