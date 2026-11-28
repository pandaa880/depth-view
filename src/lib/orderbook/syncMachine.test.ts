import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

import type { DepthSnapshotResponse, DepthUpdateEvent } from '../binance/types';
import type { BufferedReconciliation } from './orderBook';
import {
  createBookSyncMachine,
  MAX_RETRY_DELAY_MS,
  toSyncState,
  type BookSyncActor,
  type BookSyncPort,
  type LiveApplyResult,
} from './syncMachine';

const SNAPSHOT: DepthSnapshotResponse = {
  lastUpdateId: 100,
  bids: [['99', '1']],
  asks: [['101', '1']],
};

function depth(u: number): DepthUpdateEvent {
  return { e: 'depthUpdate', E: u, s: 'BTCUSDT', U: u, u, b: [], a: [] };
}

interface PendingFetch {
  signal: AbortSignal;
  resolve: (snapshot: DepthSnapshotResponse) => void;
  reject: (error: Error) => void;
}

function createFakeClock() {
  let nextHandle = 1;
  const timers = new Map<number, { callback: () => void; delay: number }>();

  return {
    timers,
    clock: {
      setTimeout(callback: () => void, delay: number) {
        const handle = nextHandle++;
        timers.set(handle, { callback, delay });
        return handle;
      },
      clearTimeout(handle: number) {
        timers.delete(handle);
      },
    },
    delays: () => Array.from(timers.values(), (timer) => timer.delay),
    fire(delay: number) {
      const entry = Array.from(timers.entries()).find(
        ([, timer]) => timer.delay === delay,
      );
      if (!entry) throw new Error(`No pending timer with delay ${delay}`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

function createHarness() {
  const fetches: PendingFetch[] = [];
  const outcomes = {
    load: 'live' as BufferedReconciliation,
    reconcile: 'live' as BufferedReconciliation,
    apply: 'applied' as LiveApplyResult,
    buffer: true,
  };
  const port = {
    fetchSnapshot: vi.fn(
      (signal: AbortSignal) =>
        new Promise<DepthSnapshotResponse>((resolve, reject) => {
          fetches.push({ signal, resolve, reject });
        }),
    ),
    bufferEvent: vi.fn(() => outcomes.buffer),
    loadSnapshot: vi.fn(() => outcomes.load),
    reconcileEvent: vi.fn(() => outcomes.reconcile),
    applyLiveEvent: vi.fn(() => outcomes.apply),
    recordGap: vi.fn(),
    resetSync: vi.fn(),
    markViewChanged: vi.fn(),
  } satisfies BookSyncPort;

  const fakeClock = createFakeClock();
  const actor: BookSyncActor = createActor(createBookSyncMachine(port), {
    input: { requestTimeoutMs: 10_000, retryBaseMs: 250 },
    clock: fakeClock.clock,
  });
  actor.start();
  actors.add(actor);

  return {
    actor,
    port,
    fetches,
    outcomes,
    ...fakeClock,
    phase: () => actor.getSnapshot().value,
    async resolveFetch(index: number) {
      fetches[index]?.resolve(SNAPSHOT);
      await Promise.resolve();
      await Promise.resolve();
    },
    async rejectFetch(index: number) {
      fetches[index]?.reject(new Error('rejected'));
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const actors = new Set<BookSyncActor>();

afterEach(() => {
  for (const actor of actors) actor.stop();
  actors.clear();
});

describe('book sync machine', () => {
  it('fetches a snapshot only after the first depth event', () => {
    const h = createHarness();
    expect(h.phase()).toBe('awaitingEvent');
    expect(h.port.fetchSnapshot).not.toHaveBeenCalled();

    h.actor.send({ type: 'DEPTH', update: depth(101) });

    expect(h.phase()).toBe('fetchingSnapshot');
    expect(h.port.bufferEvent).toHaveBeenCalledWith(depth(101));
    expect(h.port.fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it('goes live when the snapshot bridges the buffered events', async () => {
    const h = createHarness();
    h.actor.send({ type: 'DEPTH', update: depth(101) });

    await h.resolveFetch(0);

    expect(h.port.loadSnapshot).toHaveBeenCalledWith(SNAPSHOT);
    expect(h.phase()).toBe('live');
    expect(h.timers.size).toBe(0);
  });

  it('waits in bridging until a reconciled event goes live', async () => {
    const h = createHarness();
    h.outcomes.load = 'waiting';
    h.actor.send({ type: 'DEPTH', update: depth(101) });
    await h.resolveFetch(0);
    expect(h.phase()).toBe('bridging');

    h.actor.send({ type: 'DEPTH', update: depth(102) });

    expect(h.port.reconcileEvent).toHaveBeenCalledWith(depth(102));
    expect(h.phase()).toBe('live');
  });

  it('counts a live gap once and starts a fresh snapshot', async () => {
    const h = createHarness();
    h.actor.send({ type: 'DEPTH', update: depth(101) });
    await h.resolveFetch(0);
    h.outcomes.apply = 'gap';

    h.actor.send({ type: 'DEPTH', update: depth(200) });

    expect(h.port.recordGap).toHaveBeenCalledTimes(1);
    expect(h.port.resetSync).toHaveBeenCalledTimes(1);
    expect(h.phase()).toBe('fetchingSnapshot');
    expect(h.port.fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it('treats a malformed event as a gap only while live', async () => {
    const h = createHarness();
    h.actor.send({ type: 'MALFORMED' });
    expect(h.phase()).toBe('awaitingEvent');
    expect(h.port.recordGap).not.toHaveBeenCalled();

    h.actor.send({ type: 'DEPTH', update: depth(101) });
    await h.resolveFetch(0);
    h.actor.send({ type: 'MALFORMED' });

    expect(h.port.recordGap).toHaveBeenCalledTimes(1);
    expect(h.phase()).toBe('fetchingSnapshot');
  });

  it('starts a fresh sync when the pre-snapshot buffer overflows', () => {
    const h = createHarness();
    h.actor.send({ type: 'DEPTH', update: depth(101) });
    const firstSignal = h.fetches[0]?.signal;
    h.outcomes.buffer = false;

    h.actor.send({ type: 'DEPTH', update: depth(102) });

    expect(h.port.recordGap).toHaveBeenCalledTimes(1);
    expect(firstSignal?.aborted).toBe(true);
    expect(h.port.fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it('refetches stale snapshots without a gap, then falls back to retry', async () => {
    const h = createHarness();
    h.outcomes.load = 'stale-snapshot';
    h.actor.send({ type: 'DEPTH', update: depth(101) });

    await h.resolveFetch(0);
    await h.resolveFetch(1);
    expect(h.phase()).toBe('fetchingSnapshot');
    expect(h.port.fetchSnapshot).toHaveBeenCalledTimes(3);
    expect(h.port.resetSync).not.toHaveBeenCalled();

    await h.resolveFetch(2);

    expect(h.phase()).toBe('retryWait');
    expect(h.port.recordGap).not.toHaveBeenCalled();
    expect(h.delays()).toEqual([250]);
  });

  it('retries failed snapshots with capped exponential backoff', async () => {
    const h = createHarness();
    h.actor.send({ type: 'DEPTH', update: depth(101) });
    const seen: number[] = [];

    for (let attempt = 0; attempt < 7; attempt += 1) {
      await h.rejectFetch(attempt);
      expect(h.phase()).toBe('retryWait');
      const [delay] = h.delays();
      if (delay === undefined) throw new Error('No retry timer scheduled');
      seen.push(delay);
      h.fire(delay);
      expect(h.phase()).toBe('fetchingSnapshot');
    }

    expect(seen).toEqual([250, 500, 1000, 2000, 4000, 5000, 5000]);
    expect(Math.max(...seen)).toBe(MAX_RETRY_DELAY_MS);
  });

  it('resets the backoff after the book goes live', async () => {
    const h = createHarness();
    h.actor.send({ type: 'DEPTH', update: depth(101) });
    await h.rejectFetch(0);
    h.fire(250);
    await h.resolveFetch(1);
    expect(h.phase()).toBe('live');

    h.outcomes.apply = 'gap';
    h.actor.send({ type: 'DEPTH', update: depth(300) });
    await h.rejectFetch(2);

    expect(h.delays()).toEqual([250]);
  });

  it('times out a snapshot, aborts it and ignores its late result', async () => {
    const h = createHarness();
    h.actor.send({ type: 'DEPTH', update: depth(101) });

    h.fire(10_000);

    expect(h.phase()).toBe('retryWait');
    expect(h.fetches[0]?.signal.aborted).toBe(true);
    await h.resolveFetch(0);
    expect(h.port.loadSnapshot).not.toHaveBeenCalled();
    expect(h.phase()).toBe('retryWait');
  });

  it('drops events while interrupted and counts repeated drops once', async () => {
    const h = createHarness();
    h.actor.send({ type: 'DEPTH', update: depth(101) });
    await h.resolveFetch(0);

    h.actor.send({ type: 'WS_INTERRUPTED' });
    h.actor.send({ type: 'WS_INTERRUPTED' });
    h.actor.send({ type: 'DEPTH', update: depth(102) });

    expect(h.phase()).toBe('interrupted');
    expect(h.port.recordGap).toHaveBeenCalledTimes(1);
    expect(h.port.applyLiveEvent).not.toHaveBeenCalled();
    expect(h.port.bufferEvent).toHaveBeenCalledTimes(1);
  });

  it('waits for a fresh event after the socket reopens', () => {
    const h = createHarness();
    h.actor.send({ type: 'WS_INTERRUPTED' });
    h.actor.send({ type: 'WS_OPEN' });

    expect(h.phase()).toBe('awaitingEvent');
    expect(h.port.fetchSnapshot).not.toHaveBeenCalled();
  });

  it('calls each book operation once per event', async () => {
    const h = createHarness();
    h.actor.send({ type: 'DEPTH', update: depth(101) });
    h.actor.send({ type: 'DEPTH', update: depth(102) });
    await h.resolveFetch(0);
    h.actor.send({ type: 'DEPTH', update: depth(103) });

    expect(h.port.bufferEvent).toHaveBeenCalledTimes(2);
    expect(h.port.loadSnapshot).toHaveBeenCalledTimes(1);
    expect(h.port.applyLiveEvent).toHaveBeenCalledTimes(1);
  });

  it('aborts the snapshot and its timer when the socket drops mid-fetch', async () => {
    const h = createHarness();
    h.actor.send({ type: 'DEPTH', update: depth(101) });

    h.actor.send({ type: 'WS_INTERRUPTED' });

    expect(h.fetches[0]?.signal.aborted).toBe(true);
    expect(h.timers.size).toBe(0);
    await h.resolveFetch(0);
    expect(h.port.loadSnapshot).not.toHaveBeenCalled();
    expect(h.phase()).toBe('interrupted');
  });

  it('cancels the retry backoff when the socket drops', async () => {
    const h = createHarness();
    h.actor.send({ type: 'DEPTH', update: depth(101) });
    await h.rejectFetch(0);
    expect(h.delays()).toEqual([250]);

    h.actor.send({ type: 'WS_INTERRUPTED' });

    expect(h.timers.size).toBe(0);
    expect(h.phase()).toBe('interrupted');
  });

  it('refetches at once on overflow during retry and keeps the backoff step', async () => {
    const h = createHarness();
    h.actor.send({ type: 'DEPTH', update: depth(101) });
    await h.rejectFetch(0);
    h.outcomes.buffer = false;

    h.actor.send({ type: 'DEPTH', update: depth(102) });

    expect(h.phase()).toBe('fetchingSnapshot');
    expect(h.port.fetchSnapshot).toHaveBeenCalledTimes(2);
    await h.rejectFetch(1);
    expect(h.delays()).toEqual([500]);
  });

  it('carries the stale-snapshot count from bridging to the limit', async () => {
    const h = createHarness();
    h.outcomes.load = 'stale-snapshot';
    h.actor.send({ type: 'DEPTH', update: depth(101) });
    await h.resolveFetch(0);
    await h.resolveFetch(1);
    h.outcomes.load = 'waiting';
    await h.resolveFetch(2);
    expect(h.phase()).toBe('bridging');

    h.outcomes.reconcile = 'stale-snapshot';
    h.actor.send({ type: 'DEPTH', update: depth(102) });

    expect(h.phase()).toBe('retryWait');
    expect(h.port.recordGap).not.toHaveBeenCalled();
  });

  it('resets the stale-snapshot count after a gap', async () => {
    const h = createHarness();
    h.outcomes.load = 'stale-snapshot';
    h.actor.send({ type: 'DEPTH', update: depth(101) });
    await h.resolveFetch(0);
    await h.resolveFetch(1);
    h.outcomes.load = 'gap';
    await h.resolveFetch(2);

    expect(h.port.recordGap).toHaveBeenCalledTimes(1);
    h.outcomes.load = 'stale-snapshot';
    await h.resolveFetch(3);
    await h.resolveFetch(4);

    expect(h.phase()).toBe('fetchingSnapshot');
  });

  it('aborts the request and clears timers when stopped', () => {
    const h = createHarness();
    h.actor.send({ type: 'DEPTH', update: depth(101) });

    h.actor.stop();

    expect(h.fetches[0]?.signal.aborted).toBe(true);
    expect(h.timers.size).toBe(0);
  });
});

describe('toSyncState', () => {
  it.each([
    ['awaitingEvent', 'connecting'],
    ['interrupted', 'connecting'],
    ['fetchingSnapshot', 'syncing'],
    ['bridging', 'syncing'],
    ['retryWait', 'error'],
    ['live', 'live'],
  ] as const)('maps %s to %s before any live view', (phase, state) => {
    expect(toSyncState(phase, false)).toBe(state);
  });

  it('keeps last good rows as stale in every non-live phase', () => {
    const phases = [
      'awaitingEvent',
      'interrupted',
      'fetchingSnapshot',
      'bridging',
      'retryWait',
    ] as const;
    for (const phase of phases) expect(toSyncState(phase, true)).toBe('stale');
    expect(toSyncState('live', true)).toBe('live');
  });
});
