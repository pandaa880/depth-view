import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type LineData,
  type UTCTimestamp,
} from 'lightweight-charts';

import {
  KLINE_HISTORY_LIMIT,
  type Candle,
  type EmaSeriesPoint,
} from '../../lib/indicators/klines';

export interface ChartSeriesSnapshot {
  candles: readonly Candle[];
  ema: readonly EmaSeriesPoint[];
}

export interface ChartAdapter {
  replaceSnapshot: (
    snapshot: ChartSeriesSnapshot,
    options: { fitContent: boolean },
  ) => void;
  updateSnapshot: (snapshot: ChartSeriesSnapshot) => void;
  destroy: () => void;
}

function decimalPlaces(value: string): number {
  if (!value.includes('.')) return 0;

  const trimmed = value.replace(/0+$/, '');
  const dot = trimmed.indexOf('.');
  return dot === -1 ? 0 : trimmed.length - dot - 1;
}

function inferPricePrecision(candles: readonly Candle[]): number {
  let precision = 2;

  for (const candle of candles) {
    precision = Math.max(
      precision,
      decimalPlaces(candle.open),
      decimalPlaces(candle.high),
      decimalPlaces(candle.low),
      decimalPlaces(candle.close),
    );
  }

  return Math.min(precision, 8);
}

function toCandleData(candle: Candle): CandlestickData<UTCTimestamp> {
  return {
    time: candle.time as UTCTimestamp,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
  };
}

function toLineData(point: EmaSeriesPoint): LineData<UTCTimestamp> {
  return {
    time: point.time as UTCTimestamp,
    value: Number(point.value),
  };
}

/**
 * Original lightweight-charts v5 adapter. Exact decimal values stay in the
 * domain layer and become numeric presentation data only here.
 */
export function createLightweightChart(container: HTMLElement): ChartAdapter {
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: '#64748b',
      fontSize: 11,
      fontFamily: "'Roboto Mono', ui-monospace, SFMono-Regular, monospace",
    },
    grid: {
      vertLines: { color: 'rgba(100, 116, 139, 0.1)' },
      horzLines: { color: 'rgba(100, 116, 139, 0.1)' },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: {
        color: 'rgba(148, 163, 184, 0.35)',
        style: LineStyle.Dashed,
        labelBackgroundColor: '#1e2332',
      },
      horzLine: {
        color: 'rgba(148, 163, 184, 0.35)',
        style: LineStyle.Dashed,
        labelBackgroundColor: '#1e2332',
      },
    },
    rightPriceScale: {
      borderColor: 'rgba(100, 116, 139, 0.28)',
      entireTextOnly: true,
      scaleMargins: { top: 0.12, bottom: 0.14 },
    },
    timeScale: {
      borderColor: 'rgba(100, 116, 139, 0.28)',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 4,
      barSpacing: 7,
      minBarSpacing: 2,
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
  });

  const candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: 'rgba(34, 197, 94, 0.55)',
    downColor: 'rgba(239, 68, 68, 0.55)',
    borderVisible: false,
    wickUpColor: 'rgba(34, 197, 94, 0.8)',
    wickDownColor: 'rgba(239, 68, 68, 0.8)',
    priceLineVisible: false,
    lastValueVisible: true,
  });

  const emaSeries = chart.addSeries(LineSeries, {
    color: 'rgba(240, 185, 11, 0.72)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  let pricePrecision = -1;
  let renderedCandleCount = 0;
  let lastCandleTime: number | null = null;
  let lastEmaTime: number | null = null;

  function applyPricePrecision(precision: number): void {
    if (precision === pricePrecision) return;

    candleSeries.applyOptions({
      priceFormat: {
        type: 'price',
        precision,
        minMove: 10 ** -precision,
      },
    });
    pricePrecision = precision;
  }

  function replaceData(snapshot: ChartSeriesSnapshot): void {
    applyPricePrecision(inferPricePrecision(snapshot.candles));

    candleSeries.setData(snapshot.candles.map(toCandleData));
    emaSeries.setData(snapshot.ema.map(toLineData));

    renderedCandleCount = snapshot.candles.length;
    lastCandleTime = snapshot.candles.at(-1)?.time ?? null;
    lastEmaTime = snapshot.ema.at(-1)?.time ?? null;
  }

  return {
    replaceSnapshot(snapshot, options) {
      replaceData(snapshot);

      if (options.fitContent && snapshot.candles.length > 0) {
        chart.timeScale().fitContent();
      }
    },

    updateSnapshot(snapshot) {
      const lastCandle = snapshot.candles.at(-1);
      if (!lastCandle) return;

      const previousCandleTime = lastCandleTime;
      const changedCandles =
        previousCandleTime === null
          ? snapshot.candles
          : snapshot.candles.filter(
              (candle) => candle.time >= previousCandleTime,
            );

      if (changedCandles.length === 0) return;

      const appended = changedCandles.filter(
        (candle) =>
          previousCandleTime === null || candle.time > previousCandleTime,
      ).length;

      // The retained window is capped, so drop the oldest bars by replacing
      // the full series only when an append would push the canvas past it.
      if (renderedCandleCount + appended > KLINE_HISTORY_LIMIT) {
        replaceData(snapshot);
        return;
      }

      applyPricePrecision(
        Math.max(pricePrecision, inferPricePrecision(changedCandles)),
      );
      for (const candle of changedCandles) {
        candleSeries.update(toCandleData(candle));
      }

      for (const point of snapshot.ema) {
        if (lastEmaTime === null || point.time >= lastEmaTime) {
          emaSeries.update(toLineData(point));
          lastEmaTime = point.time;
        }
      }

      renderedCandleCount += appended;
      lastCandleTime = lastCandle.time;
    },

    destroy() {
      chart.remove();
    },
  };
}
