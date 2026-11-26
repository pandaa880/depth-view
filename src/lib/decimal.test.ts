import { describe, expect, it } from 'vitest';

import {
  addDecimal,
  compareDecimal,
  decimalRatio,
  multiplyDecimal,
  normalizeDecimal,
  ratioToPercent,
  subtractDecimal,
} from './decimal';

describe('normalizeDecimal', () => {
  it.each([
    ['0', '0'],
    ['-0', '0'],
    ['-000.0000', '0'],
    ['000123', '123'],
    ['001.2300', '1.23'],
    ['-000.001200', '-0.0012'],
    ['64000.0000000100', '64000.00000001'],
    ['0.000000010000', '0.00000001'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeDecimal(input)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    ' 1',
    '1 ',
    '1\n',
    '1\r\n',
    '+1',
    '.5',
    '1.',
    '--1',
    '1.2.3',
    '1e3',
    '1E-8',
    'NaN',
    'Infinity',
    '-Infinity',
  ])('rejects malformed input %s', (input) => {
    expect(() => normalizeDecimal(input)).toThrow(TypeError);
  });

  it.each([null, undefined, 1, Number.NaN])(
    'rejects non-string input %s',
    (input) => {
      expect(() =>
        normalizeDecimal(input as unknown as string),
      ).toThrow(TypeError);
    },
  );
});

describe('decimal arithmetic', () => {
  it('compares tick sizes and trailing zeros exactly', () => {
    expect(compareDecimal('0.00000001', '0.0000000100')).toBe(0);
    expect(compareDecimal('0.00000001', '0.00000002')).toBe(-1);
    expect(compareDecimal('100.00000001', '100.000000009')).toBe(1);
  });

  it('distinguishes prices that differ only by precision', () => {
    expect(compareDecimal('98123.123456789', '98123.123456788')).toBe(1);
    expect(compareDecimal('0.000000000001', '0.000000000002')).toBe(-1);
  });

  it('adds large prices and tiny increments without float rounding', () => {
    expect(addDecimal('98304.12345678', '0.00000001')).toBe('98304.12345679');
    expect(addDecimal('0.1', '0.2')).toBe('0.3');
    expect(
      addDecimal('0.000000000000000001', '0.000000000000000002'),
    ).toBe('0.000000000000000003');
  });

  it('subtracts adjacent book prices exactly', () => {
    expect(subtractDecimal('64321.12', '64321.11')).toBe('0.01');
    expect(subtractDecimal('0.3', '0.1')).toBe('0.2');
    expect(subtractDecimal('0.000001', '0.00000001')).toBe('0.00000099');
  });

  it('multiplies prices and quantities exactly', () => {
    expect(multiplyDecimal('98304.12345678', '0.00000001')).toBe(
      '0.0009830412345678',
    );
    expect(multiplyDecimal('0.00001234', '120000000')).toBe('1480.8');
    expect(multiplyDecimal('0', '98304.12345678')).toBe('0');
  });

  it('supports negatives and canonical zero results', () => {
    expect(addDecimal('-1.25', '0.25')).toBe('-1');
    expect(addDecimal('-0', '-0.000')).toBe('0');
    expect(subtractDecimal('1.25', '2.5')).toBe('-1.25');
    expect(multiplyDecimal('-0.25', '4')).toBe('-1');
    expect(multiplyDecimal('-0.25', '-4')).toBe('1');
    expect(compareDecimal('-1', '0')).toBe(-1);
  });

  it('supports zero-quantity deletion checks', () => {
    expect(compareDecimal('0.00000000', '0')).toBe(0);
    expect(compareDecimal('-0.000', '0')).toBe(0);
    expect(subtractDecimal('1.2500', '1.25')).toBe('0');
  });
});

describe('decimalRatio', () => {
  it('truncates ratios to the requested fraction digits', () => {
    expect(decimalRatio('1', '3', 6)).toBe('0.333333');
    expect(decimalRatio('2', '3', 0)).toBe('0');
    expect(decimalRatio('0.00000003', '0.00000008', 4)).toBe('0.375');
    expect(decimalRatio('1', '8', 2)).toBe('0.12');
  });

  it('preserves signs without producing negative zero', () => {
    expect(decimalRatio('-1', '3', 2)).toBe('-0.33');
    expect(decimalRatio('-1', '-3', 2)).toBe('0.33');
    expect(decimalRatio('1', '-3', 0)).toBe('0');
  });

  it('rejects zero denominators and invalid precision', () => {
    expect(() => decimalRatio('1', '0', 2)).toThrow(RangeError);
    expect(() => decimalRatio('1', '-0.000', 2)).toThrow(RangeError);

    for (const digits of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => decimalRatio('1', '2', digits)).toThrow(RangeError);
    }
  });
});

describe('ratioToPercent', () => {
  it('returns bounded ratios for CSS visualization', () => {
    expect(ratioToPercent('1', '2')).toBe(0.5);
    expect(ratioToPercent('1', '3')).toBe(0.3333333333333333);
    expect(ratioToPercent('-1', '-2')).toBe(0.5);
    expect(ratioToPercent('-1', '2')).toBe(0);
    expect(ratioToPercent('2', '1')).toBe(1);
  });

  it('returns zero for a zero denominator', () => {
    expect(ratioToPercent('1', '0')).toBe(0);
    expect(ratioToPercent('1', '-0.000')).toBe(0);
  });

  it('clamps exactly beyond the maximum safe integer', () => {
    expect(ratioToPercent('9007199254740993', '9007199254740992')).toBe(1);
    const ratio = ratioToPercent('9007199254740992', '9007199254740993');
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBeGreaterThanOrEqual(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it('stays finite for extremely small and large decimal strings', () => {
    const small = ratioToPercent('1', '1000000000000000000000000000000');
    const large = ratioToPercent('1000000000000000000000000000000', '1');
    expect(small).toBe(0);
    expect(large).toBe(1);
  });
});
