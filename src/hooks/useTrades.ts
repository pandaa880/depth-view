import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { TradeView } from '../models/market';
import { createTradeFeed } from '../lib/trades/tradeFeed';

export function useTrades(symbol: string): readonly TradeView[] {
  const feed = useMemo(() => createTradeFeed(symbol), [symbol]);

  useEffect(() => {
    feed.start();
    return () => feed.stop();
  }, [feed]);

  return useSyncExternalStore(feed.subscribe, feed.getTrades, feed.getTrades);
}
