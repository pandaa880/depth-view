import {
  assign,
  enqueueActions,
  fromPromise,
  raise,
  setup,
  type ActorRefFrom,
  type SnapshotFrom,
} from 'xstate';

import type { BookSyncState } from '../../models/market';
import type { DepthSnapshotResponse, DepthUpdateEvent } from '../binance/types';
import type { BufferedReconciliation } from './orderBook';

export const MAX_RETRY_DELAY_MS = 5_000;
export const MAX_STALE_SNAPSHOTS = 3;

export type LiveApplyResult = 'applied' | 'ignored' | 'gap';

/**
 * Book operations the sync machine drives. The coordinator owns the book,
 * the pre-snapshot buffer and view publication; the machine owns the phase.
 */
export interface BookSyncPort {
  fetchSnapshot: (signal: AbortSignal) => Promise<DepthSnapshotResponse>;
  /** Buffers a pre-snapshot event; returns false when the buffer is full. */
  bufferEvent: (update: DepthUpdateEvent) => boolean;
  /** Loads the snapshot and reconciles the buffered events against it. */
  loadSnapshot: (snapshot: DepthSnapshotResponse) => BufferedReconciliation;
  /** Reconciles one event while waiting for the bridging event. */
  reconcileEvent: (update: DepthUpdateEvent) => BufferedReconciliation;
  applyLiveEvent: (update: DepthUpdateEvent) => LiveApplyResult;
  recordGap: () => void;
  /** Drops the buffer and clears the book before a fresh sync. */
  resetSync: () => void;
  markViewChanged: () => void;
}

export interface BookSyncInput {
  requestTimeoutMs: number;
  retryBaseMs: number;
}

interface BookSyncContext extends BookSyncInput {
  retryAttempt: number;
  retryDelayMs: number;
  staleSnapshots: number;
}

/**
 * DEPTH, MALFORMED and WS_* come from the coordinator. LIVE, BRIDGING, GAP
 * and STALE_SNAPSHOT are raised by the machine from book operation results.
 */
export type BookSyncEvent =
  | { type: 'DEPTH'; update: DepthUpdateEvent }
  | { type: 'MALFORMED' }
  | { type: 'WS_OPEN' }
  | { type: 'WS_INTERRUPTED' }
  | { type: 'LIVE' }
  | { type: 'BRIDGING' }
  | { type: 'GAP' }
  | { type: 'STALE_SNAPSHOT' };

const RECONCILIATION_EVENTS = {
  live: { type: 'LIVE' },
  waiting: { type: 'BRIDGING' },
  gap: { type: 'GAP' },
  'stale-snapshot': { type: 'STALE_SNAPSHOT' },
} as const satisfies Record<BufferedReconciliation, BookSyncEvent>;

/**
 * Binance local order-book sync: wait for the first diff, fetch a REST
 * snapshot, bridge buffered diffs onto it, then apply diffs live. Any gap or
 * socket interruption restarts the sync; failed snapshots retry with backoff.
 *
 * Book operations run inside `enqueueActions` so their result can raise the
 * next event in the same macrostep. The machine is meant to run in an actor,
 * not to be evaluated with pure transition helpers.
 */
export function createBookSyncMachine(port: BookSyncPort) {
  return setup({
    types: {
      context: {} as BookSyncContext,
      events: {} as BookSyncEvent,
      input: {} as BookSyncInput,
    },
    actors: {
      fetchSnapshot: fromPromise<DepthSnapshotResponse>(({ signal }) =>
        port.fetchSnapshot(signal),
      ),
    },
    delays: {
      requestTimeout: ({ context }) => context.requestTimeoutMs,
      retryBackoff: ({ context }) => context.retryDelayMs,
    },
    guards: {
      staleSnapshotLimitReached: ({ context }) =>
        context.staleSnapshots + 1 >= MAX_STALE_SNAPSHOTS,
    },
    actions: {
      markViewChanged: () => port.markViewChanged(),
      recordGap: () => port.recordGap(),
      resetSync: () => port.resetSync(),
      clearStaleSnapshots: assign({ staleSnapshots: 0 }),
      countStaleSnapshot: assign({
        staleSnapshots: ({ context }) => context.staleSnapshots + 1,
      }),
      resetRetry: assign({ retryAttempt: 0, staleSnapshots: 0 }),
      scheduleRetry: assign(({ context }) => ({
        retryDelayMs: Math.min(
          context.retryBaseMs * 2 ** context.retryAttempt,
          MAX_RETRY_DELAY_MS,
        ),
        retryAttempt: context.retryAttempt + 1,
        staleSnapshots: 0,
      })),
      bufferEvent: enqueueActions(({ event, enqueue }) => {
        if (event.type !== 'DEPTH') return;
        if (!port.bufferEvent(event.update)) enqueue.raise({ type: 'GAP' });
      }),
      reconcileEvent: enqueueActions(({ event, enqueue }) => {
        if (event.type !== 'DEPTH') return;
        enqueue.raise(RECONCILIATION_EVENTS[port.reconcileEvent(event.update)]);
      }),
      applyLiveEvent: enqueueActions(({ event, enqueue }) => {
        if (event.type !== 'DEPTH') return;
        if (port.applyLiveEvent(event.update) === 'gap') {
          enqueue.raise({ type: 'GAP' });
        }
      }),
    },
  }).createMachine({
    id: 'bookSync',
    context: ({ input }) => ({
      ...input,
      retryAttempt: 0,
      retryDelayMs: input.retryBaseMs,
      staleSnapshots: 0,
    }),
    initial: 'awaitingEvent',
    // Root-level transitions apply from any phase that can raise them.
    on: {
      WS_INTERRUPTED: {
        target: '.interrupted',
        actions: ['recordGap', 'resetSync', 'clearStaleSnapshots'],
      },
      GAP: {
        target: '.fetchingSnapshot',
        actions: ['recordGap', 'resetSync', 'clearStaleSnapshots'],
      },
      LIVE: { target: '.live', actions: ['resetRetry', 'markViewChanged'] },
      BRIDGING: { target: '.bridging', actions: 'markViewChanged' },
      // A snapshot older than the stream is refetched without counting a gap.
      STALE_SNAPSHOT: [
        {
          guard: 'staleSnapshotLimitReached',
          target: '.retryWait',
          actions: ['resetSync', 'scheduleRetry'],
        },
        { target: '.fetchingSnapshot', actions: 'countStaleSnapshot' },
      ],
    },
    states: {
      // Waits for a diff so the snapshot is never older than the stream.
      awaitingEvent: {
        on: {
          DEPTH: {
            target: 'fetchingSnapshot',
            actions: 'bufferEvent',
          },
        },
      },
      fetchingSnapshot: {
        entry: 'markViewChanged',
        invoke: {
          src: 'fetchSnapshot',
          onDone: {
            actions: enqueueActions(({ event, enqueue }) => {
              enqueue.raise(
                RECONCILIATION_EVENTS[port.loadSnapshot(event.output)],
              );
            }),
          },
          onError: { target: 'retryWait', actions: 'scheduleRetry' },
        },
        after: {
          requestTimeout: { target: 'retryWait', actions: 'scheduleRetry' },
        },
        on: {
          DEPTH: {
            actions: 'bufferEvent',
          },
        },
      },
      // Snapshot loaded; waiting for the diff that bridges it to the stream.
      bridging: {
        on: {
          DEPTH: {
            actions: 'reconcileEvent',
          },
        },
      },
      live: {
        on: {
          DEPTH: {
            actions: 'applyLiveEvent',
          },
          MALFORMED: { actions: raise({ type: 'GAP' }) },
        },
      },
      retryWait: {
        entry: 'markViewChanged',
        after: {
          retryBackoff: {
            target: 'fetchingSnapshot',
            actions: ['resetSync', 'clearStaleSnapshots'],
          },
        },
        on: {
          DEPTH: {
            actions: 'bufferEvent',
          },
        },
      },
      // Diffs are dropped until the socket reopens; repeats count no new gap.
      interrupted: {
        entry: 'markViewChanged',
        on: {
          WS_OPEN: 'awaitingEvent',
          WS_INTERRUPTED: { actions: [] },
        },
      },
    },
  });
}

export type BookSyncMachine = ReturnType<typeof createBookSyncMachine>;
export type BookSyncActor = ActorRefFrom<BookSyncMachine>;
export type BookSyncPhase = SnapshotFrom<BookSyncMachine>['value'];

/** Maps the sync phase to the view state, keeping last good rows as stale. */
export function toSyncState(
  phase: BookSyncPhase,
  hasLastGoodView: boolean,
): BookSyncState {
  if (phase === 'live') return 'live';
  if (hasLastGoodView) return 'stale';

  switch (phase) {
    case 'awaitingEvent':
    case 'interrupted':
      return 'connecting';
    case 'fetchingSnapshot':
    case 'bridging':
      return 'syncing';
    case 'retryWait':
      return 'error';
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}
