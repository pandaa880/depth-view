import { compareDecimal, decimalRatio, normalizeDecimal } from '../decimal';
import { useExchangeInfoStore } from '../../stores/globalStore';

// ─── precision helpers ───────────────────────────────────────────

/**
 * Marker for amounts that cannot be displayed: null/undefined or a raw
 * value that is not a plain decimal string. Malformed values are never
 * coerced to zero.
 */
const MISSING_VALUE = '—';

/**
 * Upper bound for fraction digits accepted by formatCompact, so a bad
 * call site cannot request unbounded output width.
 */
const MAX_COMPACT_FRACTION_DIGITS = 8;

/**
 * Counts the meaningful decimal places of a tick/step size string.
 * "0.01000000" → 2, "0.00000100" → 6, "1.00000000" → 0.
 * Returns null when the increment is unusable metadata (malformed or
 * non-positive), which formatPrice/formatQty treat the same way as
 * missing symbol metadata.
 */
export function decimalPlacesFromIncrement(increment: string): number | null {
  let normalized: string;
  try {
    normalized = normalizeDecimal(increment);
  } catch {
    return null;
  }

  if (compareDecimal(normalized, '0') <= 0) {
    return null;
  }

  const dot = normalized.indexOf('.');
  return dot === -1 ? 0 : normalized.length - dot - 1;
}

/**
 * Inserts a comma every three integer digits using a plain string
 * operation; the fraction part is never touched.
 */
function groupThousands(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Renders a canonical decimal string (normalizeDecimal output) at a
 * fixed number of fraction places: extra digits are truncated, missing
 * digits are right-padded with zeros, integer digits are comma-grouped.
 * A value that truncates to all zeros keeps no sign, so "-0.00" can
 * never appear.
 */
function renderWithPlaces(normalized: string, places: number): string {
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integer, fraction = ''] = unsigned.split('.');
  const fractionAtPlaces = (fraction + '0'.repeat(places)).slice(0, places);
  const grouped = groupThousands(integer);
  const body = places > 0 ? `${grouped}.${fractionAtPlaces}` : grouped;
  const isTruncatedToZero = /^0*(\.0+)?$/.test(body);

  return `${negative && !isTruncatedToZero ? '-' : ''}${body}`;
}

function fractionPlacesOf(normalized: string): number {
  const dot = normalized.indexOf('.');
  return dot === -1 ? 0 : normalized.length - dot - 1;
}

/**
 * Formats a signed decimal amount for one symbol.
 *
 * Display precision is inferred from the symbol's increment (tickSize
 * for prices, stepSize for quantities), never from quoteAssetPrecision
 * and never through float math. Extra fraction digits past the
 * increment precision are truncated; valid Binance levels should
 * already align, so truncation is a safety net only. Zeros are padded
 * back out to the increment precision.
 *
 * Unknown-symbol fallback (conservative, deterministic): when metadata
 * for the symbol is missing or its increment is unusable, the value
 * keeps exactly the fraction digits already present on its normalized
 * form — no invented precision, no dropped digits. This only happens
 * before bootstrap; display rows must not crash on it.
 */
function formatByIncrement(
  symbol: string,
  raw: string,
  incrementKey: 'tickSize' | 'stepSize',
): string {
  const normalized = normalizeDecimal(raw);
  const symbolInfo =
    useExchangeInfoStore.getState().symbolInfo[symbol.toUpperCase()];
  const increment = symbolInfo?.[incrementKey];
  const places =
    (increment !== undefined ? decimalPlacesFromIncrement(increment) : null) ??
    fractionPlacesOf(normalized);

  return renderWithPlaces(normalized, places);
}

// ─── price / quantity formatters ─────────────────────────────────

/**
 * Formats a raw price string for display: "75753.78000000" with a
 * "0.01" tick size becomes "75,753.78". Precision follows the symbol's
 * tickSize. See formatByIncrement for the unknown-symbol fallback;
 * missing or malformed input yields the missing-value marker.
 */
export function formatPrice(
  symbol: string,
  rawPrice: string | null | undefined,
): string {
  if (rawPrice === null || rawPrice === undefined) return MISSING_VALUE;

  try {
    return formatByIncrement(symbol, rawPrice, 'tickSize');
  } catch {
    return MISSING_VALUE;
  }
}

/**
 * Formats a raw quantity string for display. Precision follows the
 * symbol's stepSize. Same fallback and missing-value behavior as
 * formatPrice.
 */
export function formatQty(
  symbol: string,
  rawQty: string | null | undefined,
): string {
  if (rawQty === null || rawQty === undefined) return MISSING_VALUE;

  try {
    return formatByIncrement(symbol, rawQty, 'stepSize');
  } catch {
    return MISSING_VALUE;
  }
}

// ─── compact magnitude formatter ─────────────────────────────────

const COMPACT_UNITS = [
  { suffix: 'T', divisor: '1000000000000' },
  { suffix: 'B', divisor: '1000000000' },
  { suffix: 'M', divisor: '1000000' },
  { suffix: 'K', divisor: '1000' },
] as const;

/**
 * Formats a volume or other aggregate magnitude compactly:
 * 1230000000 → "1.23B", 456700000 → "456.7M", 12300 → "12.3K",
 * 983.4 → "983.4". Uses exact decimal division on strings, then pads
 * and trims the fraction — no float intermediate, no exponent
 * notation. Defaults to two fraction digits; trailing zeros are trimmed
 * ("1.20B" renders as "1.2B"). Values below 1000 carry no suffix and
 * values at or beyond one trillion use the "T" suffix. Negative
 * magnitudes keep their sign. Missing or malformed input (including
 * exponent notation, which is deliberately not accepted) yields the
 * missing-value marker.
 */
export function formatCompact(
  raw: string | null | undefined,
  maxFractionDigits = 2,
): string {
  if (raw === null || raw === undefined) return MISSING_VALUE;
  if (
    !Number.isSafeInteger(maxFractionDigits) ||
    maxFractionDigits < 0 ||
    maxFractionDigits > MAX_COMPACT_FRACTION_DIGITS
  ) {
    throw new RangeError(
      `maxFractionDigits must be an integer between 0 and ${MAX_COMPACT_FRACTION_DIGITS}`,
    );
  }

  try {
    return formatCompactNormalized(normalizeDecimal(raw), maxFractionDigits);
  } catch {
    return MISSING_VALUE;
  }
}

/**
 * Picks the largest unit whose divisor the value reaches, then divides
 * exactly with decimalRatio (truncation toward zero) before string
 * padding and trimming.
 */
function formatCompactNormalized(
  decimal: string,
  maxFractionDigits: number,
): string {
  const unsigned = decimal.startsWith('-') ? decimal.slice(1) : decimal;

  for (const unit of COMPACT_UNITS) {
    if (compareDecimal(unsigned, unit.divisor) >= 0) {
      return renderCompactRatio(
        decimalRatio(decimal, unit.divisor, maxFractionDigits),
        maxFractionDigits,
        unit.suffix,
      );
    }
  }

  return renderCompactRatio(
    decimalRatio(decimal, '1', maxFractionDigits),
    maxFractionDigits,
    '',
  );
}

function renderCompactRatio(
  ratio: string,
  maxFractionDigits: number,
  suffix: string,
): string {
  const rendered = renderWithPlaces(ratio, maxFractionDigits);
  const trimmed = rendered.includes('.')
    ? rendered.replace(/0+$/, '').replace(/\.$/, '')
    : rendered;

  return `${trimmed}${suffix}`;
}

// ─── percent formatter ───────────────────────────────────────────

/**
 * Renders a signed percent change for ticker cards, preserving the
 * {text, arrow, isPositive} shape existing consumers rely on. The
 * percent field arrives from the ticker feed as a number (not an
 * order-book price), so fixed-decimal string conversion via toFixed is
 * its formatting step.
 * Values that round to 0.00% are flat, including a small negative input.
 * Flat values have neutral text and never imply an upward or downward move.
 * Non-finite input gets the missing-value marker text.
 */
export function formatPercent(value: number): {
  text: string;
  arrow: '▲' | '▼' | '→';
  isPositive: boolean;
  isFlat: boolean;
} {
  if (!Number.isFinite(value)) {
    return {
      text: MISSING_VALUE,
      arrow: '→',
      isPositive: false,
      isFlat: false,
    };
  }

  const absoluteText = Math.abs(value).toFixed(2);
  const isFlat = absoluteText === '0.00';
  const isPositive = value > 0;

  return {
    text: `${isFlat ? '' : isPositive ? '+' : '-'}${absoluteText}%`,
    arrow: isFlat ? '→' : isPositive ? '▲' : '▼',
    isPositive,
    isFlat,
  };
}
