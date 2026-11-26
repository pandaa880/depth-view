import { describe, expect, it } from 'vitest';

import { computeEma20, EMA_DECIMALS } from './ema';

function values(closes: string[]): string[] {
  return computeEma20(closes).map((point) => point.value);
}

describe('computeEma20', () => {
  it('returns no points until 20 closes are available', () => {
    expect(computeEma20([])).toEqual([]);
    expect(computeEma20(['1'])).toEqual([]);
    expect(computeEma20(Array.from({ length: 19 }, () => '1'))).toEqual([]);
  });

  it('seeds from the exact mean of the first 20 closes', () => {
    const closes = Array.from({ length: 20 }, (_, index) =>
      (index + 1).toString(),
    );

    expect(computeEma20(closes)).toEqual([{ index: 19, value: '10.5' }]);
  });

  it('keeps a flat series exactly flat', () => {
    const closes = Array.from({ length: 30 }, () => '100.5');
    const points = computeEma20(closes);

    expect(points).toHaveLength(11);
    expect(points.map((point) => point.index)).toEqual([
      19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    ]);
    for (const point of points) {
      expect(point.value).toBe('100.5');
    }
  });

  it('applies the exact decimal recursion for a simple series', () => {
    const closes = Array.from({ length: 22 }, (_, index) =>
      (index + 1).toString(),
    );

    expect(values(closes)).toEqual(['10.5', '11.5', '12.5']);
  });

  it('truncates tiny prices without floating point noise', () => {
    const closes = [
      ...Array.from({ length: 20 }, () => '0.00000001'),
      '0.00000002',
      '0.00000003',
    ];

    expect(values(closes)).toEqual([
      '0.00000001',
      '0.000000010952',
      '0.000000012766',
    ]);
  });

  it('averages decimal strings without binary rounding', () => {
    const closes = [...Array.from({ length: 19 }, () => '0.1'), '0.3'];

    expect(computeEma20(closes)).toEqual([{ index: 19, value: '0.11' }]);
  });

  it(`truncates every value to ${EMA_DECIMALS} fraction digits`, () => {
    const closes = [...Array.from({ length: 20 }, () => '1'), '2', '3'];

    for (const point of computeEma20(closes)) {
      const fraction = point.value.split('.')[1] ?? '';
      expect(fraction.length).toBeLessThanOrEqual(EMA_DECIMALS);
    }
  });

  it('rejects malformed close values once history is long enough', () => {
    const closes = [...Array.from({ length: 19 }, () => '1'), 'not-a-number'];

    expect(() => computeEma20(closes)).toThrow(TypeError);
  });
});
