import { describe, expect, it } from 'vitest';

import {
  createFeedHealth,
  createMarketHealthStore,
  initialFeedHealth,
} from './marketHealth';

describe('feed health defaults', () => {
  it('starts with independent zeroed readings', () => {
    const store = createMarketHealthStore();
    const { global, book } = store.getState();

    expect(global).toEqual(initialFeedHealth);
    expect(book).toEqual(initialFeedHealth);
    expect(global).not.toBe(book);
    expect(global).not.toBe(initialFeedHealth);
    expect(global.status).toBe('uninstantiated');
    expect(global.messagesPerSecond).toBe(0);
    expect(global.lastMessageAt).toBeNull();
    expect(global.gapCount).toBe(0);
    expect(global.reconnectAttempt).toBe(0);
    expect(global.nextReconnectAt).toBeNull();
    expect(global.isStale).toBe(false);
  });

  it('creates fresh health objects and stores for repeated use', () => {
    const first = createFeedHealth({ gapCount: 1 });
    const second = createFeedHealth();
    expect(first).toEqual({ ...initialFeedHealth, gapCount: 1 });
    expect(second).toEqual(initialFeedHealth);
    expect(first).not.toBe(second);

    first.gapCount = 5;
    expect(second.gapCount).toBe(0);

    const firstStore = createMarketHealthStore();
    const secondStore = createMarketHealthStore();
    firstStore.getState().noteBookGap();
    expect(secondStore.getState().book.gapCount).toBe(0);
  });
});

describe('scoped health actions', () => {
  it('partially updates global health and preserves book identity', () => {
    const store = createMarketHealthStore();
    const before = store.getState();

    before.updateGlobal({ status: 'open', messagesPerSecond: 12 });
    const after = store.getState();

    expect(after.global.status).toBe('open');
    expect(after.global.messagesPerSecond).toBe(12);
    expect(after.global.gapCount).toBe(0);
    expect(after.global).not.toBe(before.global);
    expect(after.book).toBe(before.book);
  });

  it('partially updates book health and preserves global identity', () => {
    const store = createMarketHealthStore();
    const before = store.getState();

    before.updateBook({ reconnectAttempt: 2, isStale: true });
    const after = store.getState();

    expect(after.book.reconnectAttempt).toBe(2);
    expect(after.book.isStale).toBe(true);
    expect(after.book.status).toBe('uninstantiated');
    expect(after.global).toBe(before.global);
  });

  it('keeps scoped identity for no-op patches and ignores undefined', () => {
    const store = createMarketHealthStore();
    const before = store.getState();

    before.updateGlobal({ status: 'uninstantiated' });
    expect(store.getState().global).toBe(before.global);

    before.updateBook({ lastMessageAt: undefined });
    expect(store.getState().book).toBe(before.book);
    expect(store.getState().book.lastMessageAt).toBeNull();
  });

  it('records messages in one-second windows', () => {
    const store = createMarketHealthStore();
    const before = store.getState();
    before.updateGlobal({ isStale: true });

    store.getState().recordGlobalMessage(1000);
    store.getState().recordGlobalMessage(1999);
    expect(store.getState().global.messagesPerSecond).toBe(2);
    expect(store.getState().global.lastMessageAt).toBe(1999);
    expect(store.getState().global.isStale).toBe(false);
    expect(store.getState().book).toBe(before.book);

    store.getState().recordGlobalMessage(2000);
    expect(store.getState().global.messagesPerSecond).toBe(1);
    expect(store.getState().global.lastMessageAt).toBe(2000);
  });

  it('increments book gaps atomically and marks the book stale', () => {
    const store = createMarketHealthStore();
    store.getState().updateBook({ status: 'open', messagesPerSecond: 8 });
    const before = store.getState();

    before.noteBookGap();
    before.noteBookGap();
    const after = store.getState();

    expect(after.book.gapCount).toBe(2);
    expect(after.book.isStale).toBe(true);
    expect(after.book.status).toBe('open');
    expect(after.book.messagesPerSecond).toBe(8);
    expect(after.global).toBe(before.global);
  });
});
