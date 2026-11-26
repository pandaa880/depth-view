export interface BookViewLevel {
  price: string;
  quantity: string;
  cumulativeQuantity: string;
  depthRatio: number;
}

export type BookSyncState =
  | 'connecting'
  | 'syncing'
  | 'live'
  | 'stale'
  | 'error';

export interface OrderBookView {
  symbol: string;
  bids: BookViewLevel[];
  asks: BookViewLevel[];
  spread: string;
  spreadBps: string;
  state: BookSyncState;
  lastUpdateId: number | null;
  gapCount: number;
}

export interface TradeView {
  id: number;
  time: number;
  price: string;
  quantity: string;
  isBuyerMaker: boolean;
}
