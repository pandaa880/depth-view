import { memo, useMemo } from 'react';

import type { MarketTone } from '../ui/Metric';

const WIDTH = 120;
const HEIGHT = 36;
const PADDING_Y = 3;

type Trend = 'up' | 'down' | 'flat';

type SparklineGeometry = {
  points: string;
  trend: Trend | null;
};

const buildGeometry = (history: readonly number[]): SparklineGeometry => {
  const prices = history.filter(Number.isFinite);
  if (prices.length < 2) return { points: '', trend: null };

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  const usableHeight = HEIGHT - PADDING_Y * 2;

  const points = prices
    .map((price, index) => {
      const x = (index / (prices.length - 1)) * WIDTH;
      const y =
        range === 0
          ? HEIGHT / 2
          : HEIGHT - PADDING_Y - ((price - min) / range) * usableHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const first = prices[0];
  const last = prices[prices.length - 1];
  const trend: Trend = last > first ? 'up' : last < first ? 'down' : 'flat';

  return { points, trend };
};

type SparklineProps = {
  history: readonly number[];
  symbol: string;
  // Daily tone stays on the change label; the sparkline derives its own.
  tone?: MarketTone;
};

const MOVEMENT_LABEL: Record<Trend, string> = {
  up: 'rising',
  down: 'falling',
  flat: 'flat',
};

export const Sparkline = memo(function Sparkline({
  history,
  symbol,
}: SparklineProps) {
  const { points, trend } = useMemo(() => buildGeometry(history), [history]);
  const hasHistory = points.length > 0;
  const label =
    hasHistory && trend
      ? `${symbol} recent price history, ${MOVEMENT_LABEL[trend]}`
      : `${symbol} recent price history unavailable`;

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      data-up={trend === 'up' || undefined}
      data-down={trend === 'down' || undefined}
      data-flat={trend === 'flat' || undefined}
    >
      <title>{label}</title>
      {hasHistory ? (
        <polyline
          className="sparkline-path"
          points={points}
          fill="none"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          strokeDasharray={
            trend === 'down' ? '5 3' : trend === 'flat' ? '1 3' : undefined
          }
        />
      ) : (
        <line
          className="sparkline-baseline"
          x1="0"
          x2={WIDTH}
          y1={HEIGHT / 2}
          y2={HEIGHT / 2}
          strokeWidth="1"
          strokeDasharray="2 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
});
