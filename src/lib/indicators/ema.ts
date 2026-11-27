import {
  addDecimal,
  decimalRatio,
  isDecimalString,
  multiplyDecimal,
} from '../decimal';

export const EMA_PERIOD = 20;
export const EMA_DECIMALS = 12;

export interface EmaPoint {
  index: number;
  value: string;
}

function assertDecimals(values: readonly string[]): void {
  for (const value of values) {
    if (!isDecimalString(value)) {
      throw new TypeError(`EMA input is not a decimal string: ${value}`);
    }
  }
}

/**
 * Exact-decimal EMA over close prices.
 *
 * The seed is the arithmetic mean of the first 20 closes. Every following
 * value smooths with the standard EMA(20) weight:
 * `(previous * 19 + close * 2) / 21`, truncated to EMA_DECIMALS fraction
 * digits. Points are emitted from index 19 onward.
 */
export function computeEma20(closes: readonly string[]): EmaPoint[] {
  if (closes.length < EMA_PERIOD) return [];
  assertDecimals(closes);

  const points: EmaPoint[] = [];
  let seedSum = '0';
  for (let index = 0; index < EMA_PERIOD; index += 1) {
    seedSum = addDecimal(seedSum, closes[index]);
  }

  let ema = decimalRatio(seedSum, String(EMA_PERIOD), EMA_DECIMALS);
  points.push({ index: EMA_PERIOD - 1, value: ema });

  for (let index = EMA_PERIOD; index < closes.length; index += 1) {
    const weighted = multiplyDecimal(ema, String(EMA_PERIOD - 1));
    const closeWeight = multiplyDecimal(closes[index], '2');
    const total = addDecimal(weighted, closeWeight);
    ema = decimalRatio(total, String(EMA_PERIOD + 1), EMA_DECIMALS);
    points.push({ index, value: ema });
  }

  return points;
}
