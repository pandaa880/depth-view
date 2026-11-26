import type { DepthUpdateEvent, TradeEvent } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isLevel(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'string'
  );
}

function isLevelArray(value: unknown): value is [string, string][] {
  return Array.isArray(value) && value.every(isLevel);
}

export function isDepthUpdateEvent(value: unknown): value is DepthUpdateEvent {
  return (
    isRecord(value) &&
    value.e === 'depthUpdate' &&
    isNonnegativeSafeInteger(value.E) &&
    typeof value.s === 'string' &&
    isNonnegativeSafeInteger(value.U) &&
    isNonnegativeSafeInteger(value.u) &&
    isLevelArray(value.b) &&
    isLevelArray(value.a)
  );
}

export function isTradeEvent(value: unknown): value is TradeEvent {
  return (
    isRecord(value) &&
    value.e === 'trade' &&
    isNonnegativeSafeInteger(value.E) &&
    typeof value.s === 'string' &&
    isNonnegativeSafeInteger(value.t) &&
    typeof value.p === 'string' &&
    typeof value.q === 'string' &&
    isNonnegativeSafeInteger(value.T) &&
    typeof value.m === 'boolean'
  );
}
