import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { OrderBookView } from '../models/market';
import {
  createEmptyOrderBookView,
  orderBookRegistry,
  type OrderBookController,
} from '../lib/orderbook';

type Selector = (view: OrderBookView) => unknown;

interface Registration {
  readonly symbol: string;
  readonly emptyView: OrderBookView;
  controller: OrderBookController | null;
  cachedView: OrderBookView | null;
  cachedSelector: Selector | null;
  cachedSelection: unknown;
}

const selectFullView = (view: OrderBookView): OrderBookView => view;

function createRegistration(symbol: string): Registration {
  return {
    symbol,
    emptyView: createEmptyOrderBookView(symbol),
    controller: null,
    cachedView: null,
    cachedSelector: null,
    cachedSelection: undefined,
  };
}

function selectSnapshot(
  registration: Registration,
  selector: Selector,
): unknown {
  const view = registration.controller?.getSnapshot() ?? registration.emptyView;

  if (
    registration.cachedView === view &&
    registration.cachedSelector === selector
  ) {
    return registration.cachedSelection;
  }

  const selection = selector(view);
  if (
    registration.cachedView === view &&
    Object.is(registration.cachedSelection, selection)
  ) {
    registration.cachedSelector = selector;
    return registration.cachedSelection;
  }

  registration.cachedView = view;
  registration.cachedSelector = selector;
  registration.cachedSelection = selection;
  return selection;
}

export function useOrderBook(symbol: string): OrderBookView;
export function useOrderBook<T>(
  symbol: string,
  selector: (view: OrderBookView) => T,
): T;
export function useOrderBook<T>(
  symbol: string,
  selector?: (view: OrderBookView) => T,
): T | OrderBookView {
  const registration = useMemo(() => createRegistration(symbol), [symbol]);
  const select = (selector ?? selectFullView) as Selector;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const lease = orderBookRegistry.acquire(registration.symbol);
      const controller = lease.controller;
      registration.controller = controller;
      const unsubscribe = controller.subscribe(onStoreChange);
      let subscribed = true;
      onStoreChange();

      return () => {
        if (!subscribed) return;
        subscribed = false;
        unsubscribe();
        lease.release();
        if (registration.controller === controller) {
          registration.controller = null;
        }
      };
    },
    [registration],
  );

  const getSnapshot = useCallback(
    () => selectSnapshot(registration, select),
    [registration, select],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot) as
    | T
    | OrderBookView;
}

export function useOrderBookSelector<T>(
  symbol: string,
  selector: (view: OrderBookView) => T,
): T {
  return useOrderBook(symbol, selector);
}
