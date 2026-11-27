import { memo } from 'react';

import { formatPrice, formatQty } from '../../lib/format/number';
import type { TradeView } from '../../models/market';
import { Skeleton } from '../ui/Skeleton';
import './tradeTape.css';

export type TradeFeedState = 'connecting' | 'live' | 'stale' | 'offline';

type TradeListProps = {
  symbol: string;
  trades: readonly TradeView[];
  feedState: TradeFeedState;
};

type TradeRowProps = {
  symbol: string;
  trade: TradeView;
};

const SKELETON_ROWS = 12;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatUtcTradeTime(time: number): string {
  const totalSeconds = Math.floor(time / 1000);
  return `${pad(Math.floor(totalSeconds / 3600) % 24)}:${pad(
    Math.floor(totalSeconds / 60) % 60,
  )}:${pad(totalSeconds % 60)}`;
}

export const TradeRow = memo(function TradeRow({
  symbol,
  trade,
}: TradeRowProps) {
  const isBuy = !trade.isBuyerMaker;
  const side = isBuy ? 'buy' : 'sell';

  return (
    <tr className="tt-row" data-side={side}>
      <td className="tt-time numeric">{formatUtcTradeTime(trade.time)}</td>
      <td className="tt-price numeric">
        <span className="tt-side" data-side={side} aria-hidden="true">
          {isBuy ? '▲' : '▼'}
        </span>
        <span className="sr-only">{isBuy ? 'Buy' : 'Sell'}</span>
        {formatPrice(symbol, trade.price)}
      </td>
      <td className="tt-qty numeric">{formatQty(symbol, trade.quantity)}</td>
    </tr>
  );
});

const SkeletonRows = () => (
  <>
    {Array.from({ length: SKELETON_ROWS }, (_, index) => (
      <tr
        className="tt-row tt-row-skeleton"
        key={`trade-skeleton-${index}`}
        aria-hidden="true"
      >
        <td className="tt-time">
          <Skeleton className="tt-skeleton tt-skeleton-time" />
        </td>
        <td className="tt-price">
          <Skeleton className="tt-skeleton tt-skeleton-price" />
        </td>
        <td className="tt-qty">
          <Skeleton className="tt-skeleton tt-skeleton-qty" />
        </td>
      </tr>
    ))}
  </>
);

function feedNote(feedState: TradeFeedState, isEmpty: boolean): string {
  if (feedState === 'live') {
    return isEmpty ? 'Waiting for trades' : '';
  }
  if (feedState === 'connecting') {
    return isEmpty
      ? 'Connecting to trade feed'
      : 'Reconnecting, showing last trades';
  }
  if (feedState === 'stale') {
    return isEmpty ? 'Trade feed stale' : 'Feed stale, showing last trades';
  }
  return isEmpty
    ? 'Trade feed unavailable'
    : 'Feed disconnected, showing last trades';
}

export function TradeList({ symbol, trades, feedState }: TradeListProps) {
  const isEmpty = trades.length === 0;
  const note = feedNote(feedState, isEmpty);

  return (
    <div className="tt">
      {note.length > 0 && (
        <p className="tt-note" data-state={feedState} role="status">
          {note}
        </p>
      )}
      <div
        className="tt-scroll"
        role="region"
        tabIndex={0}
        aria-label={`${symbol} recent trades, scrollable`}
      >
        <table className="tt-table">
          <caption className="sr-only">
            {symbol} recent trades, newest first, time in UTC
          </caption>
          <thead>
            <tr>
              <th scope="col" className="tt-time">
                Time <span className="tt-utc">UTC</span>
              </th>
              <th scope="col" className="tt-price">
                Price
              </th>
              <th scope="col" className="tt-qty">
                Quantity
              </th>
            </tr>
          </thead>
          <tbody>
            {isEmpty ? (
              <SkeletonRows />
            ) : (
              trades.map((trade) => (
                <TradeRow key={trade.id} symbol={symbol} trade={trade} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
