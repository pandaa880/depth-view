import { useEffect, useRef, useState } from 'react';

import { useKlines } from '../../hooks/useKlines';
import type { KlineTimeframe } from '../../lib/indicators/klines';
import { createLightweightChart, type ChartAdapter } from './chartAdapter';
import { ChartStatusOverlay } from './ChartStatusOverlay';
import { TimeframeSelector } from './TimeframeSelector';

export interface CandlestickChartProps {
  symbol: string;
  /** Presentation only: extra classes for the outer section. */
  className?: string;
  /** Presentation only: replaces the default fixed plot-height classes. */
  plotClassName?: string;
}

const DEFAULT_PLOT_CLASS = 'h-[300px] sm:h-[400px]';

export function CandlestickChart({
  symbol,
  className,
  plotClassName = DEFAULT_PLOT_CLASS,
}: CandlestickChartProps) {
  const [timeframe, setTimeframe] = useState<KlineTimeframe>('1m');
  const { candles, ema, status, updateKind, error, retry } = useKlines(
    symbol,
    timeframe,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<ChartAdapter | null>(null);
  const fitPendingRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const adapter = createLightweightChart(container);
    adapterRef.current = adapter;

    return () => {
      adapterRef.current = null;
      adapter.destroy();
    };
  }, []);

  useEffect(() => {
    fitPendingRef.current = true;
  }, [symbol, timeframe]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;

    const shouldFit = fitPendingRef.current && candles.length > 0;
    if (updateKind === 'update' && !shouldFit) {
      adapter.updateSnapshot({ candles, ema });
    } else {
      adapter.replaceSnapshot({ candles, ema }, { fitContent: shouldFit });
    }
    if (shouldFit) fitPendingRef.current = false;
  }, [candles, ema, updateKind]);

  const displaySymbol = symbol.toUpperCase();

  return (
    <section
      aria-label={`${displaySymbol} market chart`}
      className={`flex w-full min-w-0 flex-col overflow-hidden rounded-md border border-border bg-transparent${className ? ` ${className}` : ''}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="truncate text-sm font-semibold tracking-wide text-foreground">
            {displaySymbol}
          </h2>
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted">
            <span
              aria-hidden="true"
              className="inline-block h-px w-4 bg-[rgba(240,185,11,0.72)]"
            />
            EMA 20
          </span>
        </div>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </header>

      <div className={`relative w-full overflow-hidden ${plotClassName}`}>
        <div
          ref={containerRef}
          role="img"
          aria-label={`${displaySymbol} ${timeframe} candlestick chart with a 20 period EMA`}
          className="absolute inset-0"
        />
        <ChartStatusOverlay status={status} error={error} onRetry={retry} />
      </div>
    </section>
  );
}
