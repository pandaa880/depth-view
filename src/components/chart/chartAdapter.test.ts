// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Candle, EmaSeriesPoint } from '../../lib/indicators/klines';
import { createLightweightChart } from './chartAdapter';

const mocks = vi.hoisted(() => {
  const candleSeries = {
    applyOptions: vi.fn(),
    setData: vi.fn(),
    update: vi.fn(),
  };
  const emaSeries = {
    applyOptions: vi.fn(),
    setData: vi.fn(),
    update: vi.fn(),
  };
  const fitContent = vi.fn();
  const remove = vi.fn();
  const addSeries = vi.fn((seriesType: unknown) =>
    seriesType === 'candles' ? candleSeries : emaSeries,
  );
  const createChart = vi.fn(() => ({
    addSeries,
    timeScale: () => ({ fitContent }),
    remove,
  }));

  return { candleSeries, emaSeries, createChart, fitContent, remove };
});

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'candles',
  LineSeries: 'line',
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Normal: 0 },
  LineStyle: { Dashed: 0 },
  createChart: mocks.createChart,
}));

function candle(time: number, close: string): Candle {
  return { time, open: close, high: close, low: close, close };
}

function emaPoint(time: number, value: string): EmaSeriesPoint {
  return { time, value };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createLightweightChart', () => {
  it('replaces both series from a full history snapshot', () => {
    const adapter = createLightweightChart(document.createElement('div'));
    const candles = [candle(60, '1'), candle(120, '2')];
    const ema = [emaPoint(120, '2')];

    adapter.replaceSnapshot({ candles, ema }, { fitContent: true });

    expect(mocks.candleSeries.setData).toHaveBeenCalledTimes(1);
    expect(mocks.candleSeries.setData).toHaveBeenCalledWith([
      { time: 60, open: 1, high: 1, low: 1, close: 1 },
      { time: 120, open: 2, high: 2, low: 2, close: 2 },
    ]);
    expect(mocks.emaSeries.setData).toHaveBeenCalledWith([
      { time: 120, value: 2 },
    ]);
    expect(mocks.fitContent).toHaveBeenCalledTimes(1);
  });

  it('updates live candles and EMA without replacing the series', () => {
    const adapter = createLightweightChart(document.createElement('div'));
    const candles = [candle(60, '1'), candle(120, '2')];

    adapter.replaceSnapshot(
      { candles, ema: [emaPoint(120, '2')] },
      {
        fitContent: false,
      },
    );
    mocks.candleSeries.setData.mockClear();
    mocks.emaSeries.setData.mockClear();

    adapter.updateSnapshot({
      candles: [candles[0], candle(120, '5')],
      ema: [emaPoint(120, '5')],
    });

    expect(mocks.candleSeries.update).toHaveBeenCalledWith({
      time: 120,
      open: 5,
      high: 5,
      low: 5,
      close: 5,
    });
    expect(mocks.emaSeries.update).toHaveBeenCalledWith({
      time: 120,
      value: 5,
    });
    expect(mocks.candleSeries.setData).not.toHaveBeenCalled();
    expect(mocks.emaSeries.setData).not.toHaveBeenCalled();
  });

  it('applies each bar appended since the previous frame', () => {
    const adapter = createLightweightChart(document.createElement('div'));
    const candles = [candle(60, '1'), candle(120, '2')];

    adapter.replaceSnapshot(
      { candles, ema: [emaPoint(120, '2')] },
      {
        fitContent: false,
      },
    );
    mocks.candleSeries.setData.mockClear();

    adapter.updateSnapshot({
      candles: [...candles, candle(180, '3'), candle(240, '4')],
      ema: [emaPoint(120, '2'), emaPoint(180, '3'), emaPoint(240, '4')],
    });

    const updatedTimes = mocks.candleSeries.update.mock.calls.map(
      ([data]) => data.time,
    );
    expect(updatedTimes).toEqual([120, 180, 240]);
    expect(mocks.candleSeries.setData).not.toHaveBeenCalled();
  });

  it('appends a new live bar with update and replaces only at the cap', () => {
    const adapter = createLightweightChart(document.createElement('div'));
    const history = Array.from({ length: 500 }, (_, index) =>
      candle((index + 1) * 60, '1'),
    );

    adapter.replaceSnapshot(
      { candles: history, ema: [] },
      {
        fitContent: false,
      },
    );
    mocks.candleSeries.setData.mockClear();

    adapter.updateSnapshot({
      candles: [...history.slice(1), candle(501 * 60, '2')],
      ema: [],
    });

    expect(mocks.candleSeries.setData).toHaveBeenCalledTimes(1);
    expect(mocks.candleSeries.update).not.toHaveBeenCalled();
  });
});
