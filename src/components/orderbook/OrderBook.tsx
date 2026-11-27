import { memo, useMemo } from 'react';

import { useOrderBook } from '../../hooks/useOrderBook';
import { formatPrice, formatQty } from '../../lib/format/number';
import type {
  BookSyncState,
  BookViewLevel,
  OrderBookView,
} from '../../models/market';
import { Panel } from '../ui/Panel';
import { Skeleton } from '../ui/Skeleton';
import './orderbook.css';

const LEVELS_PER_SIDE = 20;
const MISSING = '–';

type Side = 'bids' | 'asks';

const STATE_LABELS: Record<BookSyncState, string> = {
  connecting: 'Connecting',
  syncing: 'Re-syncing',
  live: 'Live',
  stale: 'Re-syncing',
  error: 'Feed error',
};

type OrderBookPanelProps = {
  symbol: string;
  view: OrderBookView;
};

type LadderProps = {
  symbol: string;
  side: Side;
  levels: readonly BookViewLevel[];
  showSkeleton: boolean;
};

type RowProps = {
  symbol: string;
  side: Side;
  level: BookViewLevel;
};

const OrderBookRow = memo(function OrderBookRow({
  symbol,
  side,
  level,
}: RowProps) {
  const ratio = Math.min(1, Math.max(0, level.depthRatio));

  return (
    <div
      className="ob-row"
      role="row"
      data-side={side}
      data-price={level.price}
    >
      <span
        className="ob-depth"
        aria-hidden="true"
        style={{
          transform: `scaleX(${ratio})`,
          transformOrigin: side === 'bids' ? 'left' : 'right',
        }}
      />
      <div className="ob-cell ob-cell-price numeric" role="cell">
        {formatPrice(symbol, level.price)}
      </div>
      <div className="ob-cell ob-cell-qty numeric" role="cell">
        {formatQty(symbol, level.quantity)}
      </div>
      <div className="ob-cell ob-cell-total numeric" role="cell">
        {formatQty(symbol, level.cumulativeQuantity)}
      </div>
    </div>
  );
});

const BlankRow = () => (
  <div className="ob-row ob-row-blank" role="row" aria-hidden="true">
    <div className="ob-cell ob-cell-price" role="cell" />
    <div className="ob-cell ob-cell-qty" role="cell" />
    <div className="ob-cell ob-cell-total" role="cell" />
  </div>
);

const SkeletonRow = ({ side }: { side: Side }) => (
  <div
    className="ob-row ob-row-skeleton"
    role="row"
    aria-hidden="true"
    data-side={side}
  >
    <div className="ob-cell ob-cell-price" role="cell">
      <Skeleton className="ob-skeleton ob-skeleton-price" />
    </div>
    <div className="ob-cell ob-cell-qty" role="cell">
      <Skeleton className="ob-skeleton ob-skeleton-qty" />
    </div>
    <div className="ob-cell ob-cell-total" role="cell">
      <Skeleton className="ob-skeleton ob-skeleton-total" />
    </div>
  </div>
);

const Ladder = memo(function Ladder({
  symbol,
  side,
  levels,
  showSkeleton,
}: LadderProps) {
  const shown = levels.slice(0, LEVELS_PER_SIDE);
  const blankCount = LEVELS_PER_SIDE - shown.length;
  const title = side === 'bids' ? 'Bids' : 'Asks';

  return (
    <div className="ob-ladder" data-side={side}>
      <p className="ob-side" data-side={side}>
        {title}
      </p>
      <div
        className="ob-grid"
        role="table"
        aria-label={`${symbol} ${side} ladder`}
      >
        <div role="rowgroup">
          <div className="ob-head" role="row">
            <span className="ob-cell" role="columnheader">
              Price (USDT)
            </span>
            <span className="ob-cell ob-cell-qty" role="columnheader">
              Quantity
            </span>
            <span className="ob-cell ob-cell-total" role="columnheader">
              Total
            </span>
          </div>
        </div>
        <div role="rowgroup">
          {showSkeleton
            ? Array.from({ length: LEVELS_PER_SIDE }, (_, index) => (
                <SkeletonRow key={`skeleton-${index}`} side={side} />
              ))
            : shown.map((level) => (
                <OrderBookRow
                  key={level.price}
                  symbol={symbol}
                  side={side}
                  level={level}
                />
              ))}
          {!showSkeleton &&
            Array.from({ length: blankCount }, (_, index) => (
              <BlankRow key={`blank-${index}`} />
            ))}
        </div>
      </div>
    </div>
  );
});

export function OrderBookPanel({ symbol, view }: OrderBookPanelProps) {
  const bids = useMemo(() => view.bids.slice(0, LEVELS_PER_SIDE), [view.bids]);
  const asks = useMemo(
    () => view.asks.slice(0, LEVELS_PER_SIDE).reverse(),
    [view.asks],
  );
  const hasSides = bids.length > 0 && asks.length > 0;
  const spread = hasSides ? formatPrice(symbol, view.spread) : MISSING;
  const spreadBps =
    hasSides && view.spreadBps.length > 0 ? view.spreadBps : MISSING;

  return (
    <Panel
      variant="flush"
      className="orderbook"
      title="Order book"
      aria-label={`${symbol} order book`}
    >
      <div className="ob-body">
        <div className="ob-toolbar">
          <span
            className="ob-state"
            data-state={view.state}
            role="status"
            aria-live="polite"
          >
            {STATE_LABELS[view.state]}
          </span>
          {view.gapCount > 0 && (
            <span className="ob-gaps">
              {view.gapCount} {view.gapCount === 1 ? 'gap' : 'gaps'}
            </span>
          )}
        </div>

        <div className="ob-ladders">
          <Ladder
            symbol={symbol}
            side="bids"
            levels={bids}
            showSkeleton={bids.length === 0 && view.state !== 'live'}
          />
          <Ladder
            symbol={symbol}
            side="asks"
            levels={asks}
            showSkeleton={asks.length === 0 && view.state !== 'live'}
          />
        </div>

        <footer className="ob-summary" aria-label="Spread summary">
          <span className="ob-summary-item">
            <span className="ob-summary-label">Spread (USDT)</span>
            <span className="ob-summary-value numeric">{spread}</span>
          </span>
          <span className="ob-summary-item">
            <span className="ob-summary-label">Spread (bps)</span>
            <span
              className="ob-summary-value ob-summary-bps numeric"
              title={spreadBps}
            >
              {spreadBps}
            </span>
          </span>
        </footer>
      </div>
    </Panel>
  );
}

export function OrderBook({ symbol }: { symbol: string }) {
  const view = useOrderBook(symbol);

  return <OrderBookPanel symbol={symbol} view={view} />;
}
