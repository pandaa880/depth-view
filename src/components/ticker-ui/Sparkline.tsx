import { memo, useMemo } from 'react';

import type { MarketTone } from '../ui/Metric';

const WIDTH = 120;
const HEIGHT = 36;
const PADDING_Y = 3;

const buildPoints = (history: readonly number[]): string => {
  const prices = history.filter(Number.isFinite);
  if (prices.length < 2) return '';

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  const usableHeight = HEIGHT - PADDING_Y * 2;

  return prices
    .map((price, index) => {
      const x = (index / (prices.length - 1)) * WIDTH;
      const y =
        range === 0
          ? HEIGHT / 2
          : HEIGHT - PADDING_Y - ((price - min) / range) * usableHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
};

type SparklineProps = {
  history: readonly number[];
  symbol: string;
  tone: MarketTone;
};

export const Sparkline = memo(function Sparkline({
  history,
  symbol,
  tone,
}: SparklineProps) {
  const points = useMemo(() => buildPoints(history), [history]);
  const hasHistory = points.length > 0;
  const movement =
    tone === 'up' ? 'rising' : tone === 'down' ? 'falling' : 'flat';
  const label = hasHistory
    ? `${symbol} recent price history, ${movement}`
    : `${symbol} recent price history unavailable`;

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      data-up={tone === 'up' || undefined}
      data-down={tone === 'down' || undefined}
      data-flat={tone === 'flat' || undefined}
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
            tone === 'down' ? '5 3' : tone === 'flat' ? '1 3' : undefined
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
