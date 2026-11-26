export type Decimal = string;

type ParsedDecimal = {
  value: bigint;
  scale: number;
};

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;
const CSS_RATIO_DIGITS = 18;

function parseDecimal(value: string): ParsedDecimal {
  if (typeof value !== 'string') {
    throw new TypeError('Decimal input must be a string');
  }

  const match = DECIMAL_PATTERN.exec(value);
  if (!match || match[0] !== value) {
    throw new TypeError(`Invalid decimal: ${value}`);
  }

  const fraction = match[3] ?? '';
  const unsigned = BigInt(`${match[2]}${fraction}`);

  return {
    value: match[1] === '-' ? -unsigned : unsigned,
    scale: fraction.length,
  };
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function formatDecimal(value: bigint, scale: number): Decimal {
  if (value === 0n) return '0';

  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, '0');
  const integer = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction =
    scale === 0 ? '' : digits.slice(-scale).replace(/0+$/, '');

  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

function alignDecimals(a: ParsedDecimal, b: ParsedDecimal): [bigint, bigint] {
  const scale = Math.max(a.scale, b.scale);
  return [
    a.value * powerOfTen(scale - a.scale),
    b.value * powerOfTen(scale - b.scale),
  ];
}

export function normalizeDecimal(value: string): Decimal {
  const parsed = parseDecimal(value);
  return formatDecimal(parsed.value, parsed.scale);
}

export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const [left, right] = alignDecimals(parseDecimal(a), parseDecimal(b));
  return left < right ? -1 : left > right ? 1 : 0;
}

export function addDecimal(a: string, b: string): Decimal {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  const [leftValue, rightValue] = alignDecimals(left, right);
  return formatDecimal(
    leftValue + rightValue,
    Math.max(left.scale, right.scale),
  );
}

export function subtractDecimal(a: string, b: string): Decimal {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  const [leftValue, rightValue] = alignDecimals(left, right);
  return formatDecimal(
    leftValue - rightValue,
    Math.max(left.scale, right.scale),
  );
}

export function multiplyDecimal(a: string, b: string): Decimal {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  return formatDecimal(left.value * right.value, left.scale + right.scale);
}

export function decimalRatio(
  numerator: string,
  denominator: string,
  digits: number,
): Decimal {
  if (!Number.isSafeInteger(digits) || digits < 0) {
    throw new RangeError('Ratio digits must be a nonnegative safe integer');
  }

  const top = parseDecimal(numerator);
  const bottom = parseDecimal(denominator);
  if (bottom.value === 0n) {
    throw new RangeError('Ratio denominator cannot be zero');
  }

  const negative = (top.value < 0n) !== (bottom.value < 0n);
  const [topValue, bottomValue] = alignDecimals(top, bottom);
  const quotient =
    ((topValue < 0n ? -topValue : topValue) * powerOfTen(digits)) /
    (bottomValue < 0n ? -bottomValue : bottomValue);

  return formatDecimal(negative ? -quotient : quotient, digits);
}

export function ratioToPercent(numerator: string, denominator: string): number {
  const top = parseDecimal(numerator);
  const bottom = parseDecimal(denominator);
  if (bottom.value === 0n || top.value === 0n) return 0;

  const [topValue, bottomValue] = alignDecimals(top, bottom);
  if ((topValue < 0n) !== (bottomValue < 0n)) return 0;

  const absoluteTop = topValue < 0n ? -topValue : topValue;
  const absoluteBottom = bottomValue < 0n ? -bottomValue : bottomValue;
  if (absoluteTop >= absoluteBottom) return 1;

  const ratio = decimalRatio(numerator, denominator, CSS_RATIO_DIGITS);
  return Number(ratio);
}
