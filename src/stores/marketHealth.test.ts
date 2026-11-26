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

  it('publishes the previous complete second at a boundary', () => {
    const store = createMarketHealthStore();
    const before = store.getState();
    before.updateGlobal({ isStale: true });

    for (let index = 0; index < 50; index += 1) {
      store.getState().recordGlobalMessage(1000 + index);
    }

    expect(store.getState().global.messagesPerSecond).toBe(0);
    expect(store.getState().global.lastMessageAt).toBe(1049);
    expect(store.getState().global.isStale).toBe(false);
    expect(store.getState().book).toBe(before.book);

    store.getState().recordGlobalMessage(2000);
    expect(store.getState().global.messagesPerSecond).toBe(50);
    expect(store.getState().global.lastMessageAt).toBe(2000);

    store.getState().recordGlobalMessage(2100);
    expect(store.getState().global.messagesPerSecond).toBe(50);
  });

  it('samples the previous complete second without a message', () => {
    const store = createMarketHealthStore();

    for (let index = 0; index < 50; index += 1) {
      store.getState().recordGlobalMessage(1000 + index);
    }

    store.getState().sampleGlobalMessages(2000);
    const afterSample = store.getState();
    expect(afterSample.global.messagesPerSecond).toBe(50);

    store.getState().sampleGlobalMessages(2000);
    expect(store.getState().global).toBe(afterSample.global);

    store.getState().sampleGlobalMessages(3000);
    expect(store.getState().global.messagesPerSecond).toBe(0);
  });

  it('decays to zero after a full second of silence', () => {
    const store = createMarketHealthStore();

    store.getState().recordGlobalMessage(1000);
    store.getState().recordGlobalMessage(1200);
    store.getState().sampleGlobalMessages(2000);
    expect(store.getState().global.messagesPerSecond).toBe(2);

    store.getState().sampleGlobalMessages(4000);
    expect(store.getState().global.messagesPerSecond).toBe(0);

    store.getState().recordGlobalMessage(4100);
    expect(store.getState().global.messagesPerSecond).toBe(0);
    store.getState().sampleGlobalMessages(5000);
    expect(store.getState().global.messagesPerSecond).toBe(1);
  });

  it('ignores late messages and samples without moving backwards', () => {
    const store = createMarketHealthStore();

    store.getState().recordGlobalMessage(1000);
    store.getState().recordGlobalMessage(1200);
    store.getState().recordGlobalMessage(1400);
    store.getState().recordGlobalMessage(900);

    expect(store.getState().global.messagesPerSecond).toBe(0);
    expect(store.getState().global.lastMessageAt).toBe(1400);

    store.getState().sampleGlobalMessages(2000);
    expect(store.getState().global.messagesPerSecond).toBe(3);

    store.getState().sampleGlobalMessages(1500);
    expect(store.getState().global.messagesPerSecond).toBe(3);
  });

  it('keeps explicit global updates from corrupting later counts', () => {
    const store = createMarketHealthStore();

    store.getState().updateGlobal({ messagesPerSecond: 999 });
    store.getState().recordGlobalMessage(1000);
    store.getState().recordGlobalMessage(1200);
    store.getState().updateGlobal({ messagesPerSecond: 999 });
    store.getState().recordGlobalMessage(1400);

    expect(store.getState().global.messagesPerSecond).toBe(999);

    store.getState().sampleGlobalMessages(2000);
    expect(store.getState().global.messagesPerSecond).toBe(3);
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
