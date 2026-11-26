import { memo, useMemo } from 'react';
import { Link } from '@tanstack/react-router';

import { useTickerStore } from '../../stores/globalStore';
import {
  formatCompact,
  formatPercent,
  formatPrice,
} from '../../lib/format/number';
import { Metric, type MarketTone } from '../ui/Metric';
import { Skeleton } from '../ui/Skeleton';
import { cx } from '../ui/cx';
import { Sparkline } from './Sparkline';

type TickerCardProps = {
  symbol: string;
};

const TickerCardSkeleton = () => (
  <div className="ticker-card ticker-card-loading" aria-hidden="true">
    <div className="ticker-top">
      <Skeleton className="skeleton-symbol" />
      <Skeleton className="skeleton-market-type" />
    </div>
    <Skeleton className="ticker-price skeleton-price" />
    <div className="ticker-change">
      <Skeleton className="skeleton-change" />
    </div>
    <Skeleton className="sparkline skeleton-sparkline" />
    <div className="metric ticker-volume">
      <Skeleton className="skeleton-volume-label" />
      <Skeleton className="skeleton-volume-value" />
    </div>
  </div>
);

export const TickerCard = memo(function TickerCard({
  symbol,
}: TickerCardProps) {
  const ticker = useTickerStore((state) => state.tickers[symbol]);
  const linkParams = useMemo(() => ({ symbol }), [symbol]);

  if (!ticker) return <TickerCardSkeleton />;

  const {
    flashDirection,
    lastPrice,
    prevPrice,
    priceChangePercent,
    priceHistory,
    volume24h,
  } = ticker;
  const { text, arrow, isPositive, isFlat } = formatPercent(priceChangePercent);
  const tone: MarketTone = isFlat
    ? 'flat'
    : !Number.isFinite(priceChangePercent)
      ? 'neutral'
      : isPositive
        ? 'up'
        : 'down';
  const baseAsset = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  const formattedPrice = formatPrice(symbol, lastPrice);
  const formattedVolume = formatCompact(volume24h);
  const hasPriceChange = prevPrice !== undefined && prevPrice !== lastPrice;

  return (
    <Link to="/symbol/$symbol" params={linkParams} className="ticker-card">
      <div className="ticker-top">
        <span className="ticker-pair">
          {baseAsset}
          <span className="ticker-quote">/USDT</span>
        </span>
        <span className="ticker-market-type">SPOT</span>
      </div>
      <data
        key={lastPrice}
        value={lastPrice}
        className={cx(
          'ticker-price',
          'numeric',
          hasPriceChange && flashDirection === 'up' && 'price-flash-up',
          hasPriceChange && flashDirection === 'down' && 'price-flash-down',
        )}
      >
        {formattedPrice}
      </data>
      <div
        className="ticker-change numeric"
        data-up={tone === 'up' || undefined}
        data-down={tone === 'down' || undefined}
        data-flat={tone === 'flat' || undefined}
      >
        <span className="ticker-change-label">24h change</span>
        <span className="ticker-change-arrow" aria-hidden="true">
          {arrow}
        </span>
        <span>{text}</span>
      </div>
      <Sparkline history={priceHistory} symbol={symbol} />
      <Metric
        className="ticker-volume"
        label="24h volume"
        value={`${formattedVolume} USDT`}
      />
    </Link>
  );
});
