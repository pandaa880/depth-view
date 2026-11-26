import { describe, expect, it } from 'vitest';

import { isDepthUpdateEvent, isTradeEvent } from './guards';
import type { DepthUpdateEvent, TradeEvent } from './types';

function validDepth(): DepthUpdateEvent {
  return {
    e: 'depthUpdate',
    E: 1672515782136,
    s: 'BTCUSDT',
    U: 100,
    u: 101,
    b: [
      ['98123.10', '1.25'],
      ['98123.09', '0'],
    ],
    a: [['98123.11', '0.5']],
  };
}

function validTrade(): TradeEvent {
  return {
    e: 'trade',
    E: 1672515782136,
    s: 'BTCUSDT',
    t: 12345,
    p: '98123.10',
    q: '0.000001',
    T: 1672515782135,
    m: false,
  };
}

describe('isDepthUpdateEvent', () => {
  it('accepts valid payloads and empty level arrays', () => {
    expect(isDepthUpdateEvent(validDepth())).toBe(true);
    expect(isDepthUpdateEvent({ ...validDepth(), b: [], a: [] })).toBe(true);
  });

  it('rejects unknown envelopes and normal garbage', () => {
    for (const value of [null, undefined, 1, 'depthUpdate', [], {}, true]) {
      expect(isDepthUpdateEvent(value)).toBe(false);
    }
    expect(isDepthUpdateEvent({ ...validDepth(), e: 'trade' })).toBe(false);
  });

  it.each([['U'], ['u']])('validates sequence id %s', (key) => {
    for (const id of [-1, 1.5, Number.NaN, 9007199254740992, '100']) {
      expect(isDepthUpdateEvent({ ...validDepth(), [key]: id })).toBe(false);
    }
    expect(isDepthUpdateEvent({ ...validDepth(), [key]: 0 })).toBe(true);
  });

  it('validates event fields and every price level', () => {
    expect(isDepthUpdateEvent({ ...validDepth(), E: -1 })).toBe(false);
    expect(isDepthUpdateEvent({ ...validDepth(), s: 1 })).toBe(false);
    expect(isDepthUpdateEvent({ ...validDepth(), b: {} })).toBe(false);
    expect(isDepthUpdateEvent({ ...validDepth(), a: [['1']] })).toBe(false);
    expect(isDepthUpdateEvent({ ...validDepth(), b: [['1', 2]] })).toBe(false);
    expect(isDepthUpdateEvent({ ...validDepth(), b: [['1', '2', '3']] })).toBe(
      false,
    );
    expect(isDepthUpdateEvent({ ...validDepth(), a: [null] })).toBe(false);
  });
});

describe('isTradeEvent', () => {
  it('accepts valid maker and taker payloads', () => {
    expect(isTradeEvent(validTrade())).toBe(true);
    expect(isTradeEvent({ ...validTrade(), m: true })).toBe(true);
  });

  it('rejects unknown envelopes and normal garbage', () => {
    for (const value of [null, undefined, 0, 'trade', [], {}, false]) {
      expect(isTradeEvent(value)).toBe(false);
    }
    expect(isTradeEvent({ ...validTrade(), e: 'depthUpdate' })).toBe(false);
  });

  it('validates all consumed fields', () => {
    for (const key of ['E', 't', 'T']) {
      for (const invalid of [-1, 1.5, Number.NaN, 9007199254740992, '1']) {
        expect(isTradeEvent({ ...validTrade(), [key]: invalid })).toBe(false);
      }
    }

    expect(isTradeEvent({ ...validTrade(), s: null })).toBe(false);
    expect(isTradeEvent({ ...validTrade(), p: 1 })).toBe(false);
    expect(isTradeEvent({ ...validTrade(), q: undefined })).toBe(false);
    expect(isTradeEvent({ ...validTrade(), m: 'false' })).toBe(false);
  });

  it('accepts zero ids and timestamps', () => {
    expect(isTradeEvent({ ...validTrade(), E: 0, t: 0, T: 0 })).toBe(true);
  });
});
