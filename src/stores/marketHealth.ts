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
  sampleGlobalMessages: (timestamp: number) => void;
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
  let observedSecond: number | null = null;
  let observedCount = 0;

  return create<MarketHealthStore>()((set, get) => {
    function publishGlobal(patch: Partial<FeedHealth>): void {
      set((state) => {
        const global = mergeFeedHealth(state.global, patch);
        return global === state.global ? state : { global };
      });
    }

    function completeObservedSecond(nextSecond: number): number {
      const previousSecond = observedSecond;
      const completedCount =
        previousSecond !== null && nextSecond === previousSecond + 1
          ? observedCount
          : 0;
      observedSecond = nextSecond;
      observedCount = 0;
      return completedCount;
    }

    return {
      global: createFeedHealth(),
      book: createFeedHealth(),

      updateGlobal(patch) {
        publishGlobal(patch);
      },

      updateBook(patch) {
        set((state) => {
          const book = mergeFeedHealth(state.book, patch);
          return book === state.book ? state : { book };
        });
      },

      recordGlobalMessage(timestamp) {
        const second = Math.floor(timestamp / 1000);

        if (observedSecond === null) {
          observedSecond = second;
          observedCount = 1;
          publishGlobal({
            messagesPerSecond: 0,
            lastMessageAt: timestamp,
            isStale: false,
          });
          return;
        }

        if (second > observedSecond) {
          const completedCount = completeObservedSecond(second);
          observedCount = 1;
          publishGlobal({
            messagesPerSecond: completedCount,
            lastMessageAt: timestamp,
            isStale: false,
          });
          return;
        }

        if (second === observedSecond) {
          observedCount += 1;
        }

        const previousLastMessageAt = get().global.lastMessageAt;
        const lastMessageAt =
          previousLastMessageAt === null || timestamp > previousLastMessageAt
            ? timestamp
            : previousLastMessageAt;

        publishGlobal({ lastMessageAt, isStale: false });
      },

      sampleGlobalMessages(timestamp) {
        const second = Math.floor(timestamp / 1000);
        if (observedSecond === null || second <= observedSecond) return;

        publishGlobal({
          messagesPerSecond: completeObservedSecond(second),
        });
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
    };
  });
}

export const useMarketHealthStore = createMarketHealthStore();
