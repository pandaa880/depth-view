import { useExchangeInfoStore } from '../../stores/globalStore';

// ─── precision helpers ───────────────────────────────────────────

/**
 * Derives decimal places from a tick/step size string.
 * "0.01000000" → 2
 * "0.00000100" → 6
 * "1.00000000" → 0
 */
export function getPrecision(size: string): number {
  const [, decimal] = size.split('.');
  if (!decimal) return 0;
  return decimal.replace(/0+$/, '').length;
}

// ─── price formatter ─────────────────────────────────────────────

/**
 * Formats a price string using the symbol's tickSize precision.
 * Always pads zeros to the right.
 * "75753.78000000" + tickSize "0.01" → "75,753.78"
 */
export function formatPrice(symbol: string, rawPrice: string): string {
  const symbolInfo = useExchangeInfoStore.getState().symbolInfo[symbol];
  const precision = symbolInfo ? getPrecision(symbolInfo.tickSize) : 2;
  const num = parseFloat(rawPrice);

  return num.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

export function formatPercent(value: number): {
  text: string;
  arrow: '▲' | '▼';
  isPositive: boolean;
} {
  const isPositive = value >= 0;
  const abs = Math.abs(value).toFixed(2);

  return {
    text: `${isPositive ? '+' : '-'}${abs}%`,
    arrow: isPositive ? '▲' : '▼',
    isPositive,
  };
}
