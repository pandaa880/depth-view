import { createActor } from 'xstate';

import type { OrderBookView } from '../../models/market';
import type { FeedHealth, MarketHealthStore } from '../../stores/marketHealth';
import { useMarketHealthStore } from '../../stores/marketHealth';
import {
  CONNECTION_STATUS,
  wsManager,
  type ConnectionStatus,
} from '../binance/BinanceWebSocket';
import { isDepthUpdateEvent } from '../binance/guards';
import { binanceRest } from '../binance/rest-client';
import type { DepthSnapshotResponse, DepthUpdateEvent } from '../binance/types';
import type { FrameTask } from '../frameTask';
import { createFrameTask } from '../frameTask';
import {
  applyNextDepthUpdate,
  clearOrderBook,
  createEmptyOrderBookView,
  createOrderBook,
  loadDepthSnapshot,
  normalizeDepthUpdate,
  preserveOrderBookView,
  projectOrderBookView,
  reconcileBufferedDepthUpdates,
  type BufferedReconciliation,
  type MutableOrderBook,
} from './orderBook';
import {
  createBookSyncMachine,
  toSyncState,
  type BookSyncActor,
  type BookSyncMachine,
  type BookSyncPort,
  type LiveApplyResult,
} from './syncMachine';

const DEFAULT_REQUEST_TIMEOUT = 10_000;
const DEFAULT_RETRY_DELAY = 250;
const DEFAULT_BUFFER_LIMIT = 5_000;
const SNAPSHOT_LIMIT = 1000;

type MessageHandler = (data: unknown) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export interface OrderBookSocket {
  connect: () => void;
  subscribe: (stream: string, handler: MessageHandler) => () => void;
  onStatusChange: (handler: StatusHandler) => () => void;
  getStatus: () => ConnectionStatus;
}

export interface DepthSnapshotClient {
  getDepthSnapshot: (
    symbol: string,
    limit: number,
    signal?: AbortSignal,
  ) => Promise<DepthSnapshotResponse>;
}

export interface OrderBookScheduler {
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (handle: number) => void;
}

type BookHealth = Pick<MarketHealthStore, 'noteBookGap' | 'updateBook'>;

export interface OrderBookControllerOptions {
  socket?: OrderBookSocket;
  rest?: DepthSnapshotClient;
  health?: BookHealth;
  frameTaskFactory?: (callback: () => void) => FrameTask;
  scheduler?: OrderBookScheduler;
  requestTimeoutMs?: number;
  retryDelayMs?: number;
  maxBufferedEvents?: number;
}

export interface OrderBookController {
  readonly symbol: string;
  start: () => void;
  stop: () => void;
  getSnapshot: () => OrderBookView;
  subscribe: (listener: () => void) => () => void;
}

export interface OrderBookLease {
  controller: OrderBookController;
  release: () => void;
}

export interface OrderBookRegistry {
  acquire: (symbol: string) => OrderBookLease;
}

const defaultScheduler: OrderBookScheduler = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

const interruptedStatuses = new Set<ConnectionStatus>([
  CONNECTION_STATUS.Closing,
  CONNECTION_STATUS.Closed,
  CONNECTION_STATUS.Disconnected,
  CONNECTION_STATUS.Reconnecting,
]);

/**
 * Owns one symbol's book data and view publication. The sync phase (waiting,
 * snapshot, bridging, live, retry, interrupted) lives in the sync machine.
 */
class BookCoordinator implements OrderBookController {
  readonly symbol: string;

  private readonly socket: OrderBookSocket;
  private readonly rest: DepthSnapshotClient;
  private readonly health: BookHealth;
  private readonly scheduler: OrderBookScheduler;
  private readonly requestTimeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly maxBufferedEvents: number;
  private readonly publication: FrameTask;
  private readonly listeners = new Set<() => void>();
  private readonly syncMachine: BookSyncMachine;

  private actor: BookSyncActor | null = null;
  private activeRequest: AbortController | null = null;
  private book: MutableOrderBook = createOrderBook();
  private buffered: DepthUpdateEvent[] = [];
  private view: OrderBookView;
  private lastGoodView: OrderBookView | null = null;
  private gapCount = 0;
  private unsubscribeDepth: (() => void) | null = null;
  private unsubscribeStatus: (() => void) | null = null;
  private viewDirty = false;
  private pendingGaps = 0;
  private pendingStatus: ConnectionStatus | null = null;
  private pendingMessageAt: number | null = null;

  constructor(symbol: string, options: OrderBookControllerOptions = {}) {
    this.symbol = symbol;
    this.socket = options.socket ?? wsManager;
    this.rest = options.rest ?? binanceRest;
    this.health = options.health ?? useMarketHealthStore.getState();
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY;
    this.maxBufferedEvents = options.maxBufferedEvents ?? DEFAULT_BUFFER_LIMIT;
    this.view = createEmptyOrderBookView(symbol);
    this.publication = (options.frameTaskFactory ?? createFrameTask)(() =>
      this.flushPublication(),
    );
    this.syncMachine = createBookSyncMachine(this.createSyncPort());
  }

  getSnapshot = (): OrderBookView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    let subscribed = true;

    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  };

  start = (): void => {
    if (this.actor) return;

    this.book = createOrderBook();
    this.buffered = [];
    this.lastGoodView = null;
    this.gapCount = 0;
    this.view = createEmptyOrderBookView(this.symbol);
    this.viewDirty = true;
    this.pendingStatus = this.socket.getStatus();
    this.pendingGaps = 0;
    this.pendingMessageAt = null;

    this.startSyncActor();

    this.unsubscribeStatus = this.socket.onStatusChange(this.handleStatus);
    this.unsubscribeDepth = this.socket.subscribe(
      `${this.symbol.toLowerCase()}@depth@100ms`,
      this.handleMessage,
    );

    this.socket.connect();
  };

  stop = (): void => {
    const actor = this.actor;
    if (!actor) return;

    // Stopping the actor aborts the snapshot request and clears its timers.
    this.actor = null;
    actor.stop();
    this.publication.cancel();

    const unsubscribeDepth = this.unsubscribeDepth;
    const unsubscribeStatus = this.unsubscribeStatus;
    this.unsubscribeDepth = null;
    this.unsubscribeStatus = null;
    unsubscribeDepth?.();
    unsubscribeStatus?.();

    this.buffered = [];
    clearOrderBook(this.book);
    this.listeners.clear();
    this.pendingGaps = 0;
    this.pendingMessageAt = null;
    this.pendingStatus = null;
  };

  private startSyncActor(): void {
    const actor = createActor(this.syncMachine, {
      input: {
        requestTimeoutMs: this.requestTimeoutMs,
        retryBaseMs: this.retryDelayMs,
      },
      clock: this.scheduler,
    });
    // An errored actor ignores every later event, so restart the sync instead
    // of leaving the book frozen until the next stop/start.
    actor.subscribe({ error: (error) => this.restartSync(actor, error) });
    this.actor = actor;
    actor.start();
  }

  private restartSync(failed: BookSyncActor, error: unknown): void {
    if (this.actor !== failed) return;

    globalThis.reportError?.(
      new Error(`Order book sync failed for ${this.symbol}; restarting`, {
        cause: error,
      }),
    );
    // XState leaves an errored actor's invoked request running; abort it here.
    this.activeRequest?.abort();
    this.buffered = [];
    clearOrderBook(this.book);
    this.gapCount += 1;
    this.pendingGaps += 1;
    this.startSyncActor();
    this.requestPublication(true);
  }

  private handleMessage = (data: unknown): void => {
    const actor = this.actor;
    if (!actor || !isDepthUpdateEvent(data) || data.s !== this.symbol) return;

    let update: DepthUpdateEvent;
    try {
      update = normalizeDepthUpdate(data);
    } catch {
      actor.send({ type: 'MALFORMED' });
      return;
    }

    actor.send({ type: 'DEPTH', update });
  };

  private handleStatus = (status: ConnectionStatus): void => {
    const actor = this.actor;
    if (!actor) return;

    this.pendingStatus = status;
    if (status === CONNECTION_STATUS.Open) {
      actor.send({ type: 'WS_OPEN' });
    } else if (interruptedStatuses.has(status)) {
      actor.send({ type: 'WS_INTERRUPTED' });
    }
    this.requestPublication(false);
  };

  private createSyncPort(): BookSyncPort {
    return {
      fetchSnapshot: (signal) => this.fetchSnapshot(signal),
      bufferEvent: (update) => this.bufferEvent(update),
      loadSnapshot: (snapshot) => this.loadSnapshot(snapshot),
      reconcileEvent: (update) => {
        this.noteMessage(update);
        return this.reconcileReadyBook([update]);
      },
      applyLiveEvent: (update) => this.applyLiveEvent(update),
      recordGap: () => {
        this.gapCount += 1;
        this.pendingGaps += 1;
      },
      resetSync: () => {
        this.buffered = [];
        clearOrderBook(this.book);
      },
      markViewChanged: () => this.requestPublication(true),
    };
  }

  private fetchSnapshot(signal: AbortSignal): Promise<DepthSnapshotResponse> {
    // Mirrors the machine's signal and lets restartSync abort the request too.
    const request = new AbortController();
    signal.addEventListener('abort', () => request.abort(), { once: true });
    this.activeRequest = request;
    try {
      return this.rest.getDepthSnapshot(
        this.symbol,
        SNAPSHOT_LIMIT,
        request.signal,
      );
    } catch (error) {
      return Promise.reject(
        new Error('Depth snapshot request failed', { cause: error }),
      );
    }
  }

  private bufferEvent(update: DepthUpdateEvent): boolean {
    this.noteMessage(update);
    if (this.buffered.length >= this.maxBufferedEvents) return false;

    this.buffered.push(update);
    this.requestPublication(false);
    return true;
  }

  private loadSnapshot(
    snapshot: DepthSnapshotResponse,
  ): BufferedReconciliation {
    try {
      loadDepthSnapshot(this.book, snapshot);
    } catch {
      return 'gap';
    }
    return this.reconcileReadyBook(this.buffered);
  }

  private applyLiveEvent(update: DepthUpdateEvent): LiveApplyResult {
    this.noteMessage(update);
    const result = applyNextDepthUpdate(this.book, update);
    if (result === 'applied') this.requestPublication(true);
    return result;
  }

  // Drops events the snapshot already covers, then bridges the rest onto it.
  private reconcileReadyBook(
    events: DepthUpdateEvent[],
  ): BufferedReconciliation {
    const staleId = this.book.lastUpdateId;
    const pending = events.filter(
      (event) => staleId === null || event.u > staleId,
    );

    let result: BufferedReconciliation;
    try {
      result = reconcileBufferedDepthUpdates(this.book, pending);
    } catch {
      result = 'gap';
    }

    this.buffered = [];
    // The snapshot is older than the stream: keep the events for the refetch.
    if (result === 'stale-snapshot') {
      clearOrderBook(this.book);
      this.buffered = pending;
    }
    return result;
  }

  private noteMessage(update: DepthUpdateEvent): void {
    this.pendingMessageAt = update.E;
  }

  private requestPublication(viewChanged: boolean): void {
    if (!this.actor) return;
    if (viewChanged) this.viewDirty = true;
    this.publication.request();
  }

  private deriveView(actor: BookSyncActor): OrderBookView {
    const state = toSyncState(
      actor.getSnapshot().value,
      this.lastGoodView !== null,
    );
    if (state === 'live') {
      return projectOrderBookView(
        this.book,
        this.symbol,
        this.gapCount,
        this.view,
      );
    }

    return preserveOrderBookView(
      this.lastGoodView ?? this.view,
      state,
      this.gapCount,
    );
  }

  private flushPublication(): void {
    const actor = this.actor;
    if (!actor) return;

    const nextView = this.viewDirty ? this.deriveView(actor) : this.view;
    this.viewDirty = false;
    const gaps = this.pendingGaps;
    const status = this.pendingStatus;
    const messageAt = this.pendingMessageAt;
    this.pendingGaps = 0;
    this.pendingStatus = null;
    this.pendingMessageAt = null;

    for (let index = 0; index < gaps; index += 1) {
      this.health.noteBookGap();
    }

    const healthPatch: Partial<FeedHealth> = {
      isStale: nextView.state === 'stale' || nextView.state === 'error',
    };
    if (status !== null) healthPatch.status = status;
    if (messageAt !== null) {
      healthPatch.lastMessageAt = messageAt;
      healthPatch.isStale = nextView.state !== 'live';
    }
    this.health.updateBook(healthPatch);

    if (nextView === this.view) return;
    this.view = nextView;
    if (nextView.state === 'live') this.lastGoodView = nextView;
    for (const listener of this.listeners) listener();
  }
}

export function createOrderBookController(
  symbol: string,
  options: OrderBookControllerOptions = {},
): OrderBookController {
  return new BookCoordinator(symbol, options);
}

export function createOrderBookRegistry(
  factory: (symbol: string) => OrderBookController = createOrderBookController,
): OrderBookRegistry {
  const entries = new Map<
    string,
    { controller: OrderBookController; references: number }
  >();

  return {
    acquire(symbol) {
      let entry = entries.get(symbol);
      if (!entry) {
        entry = { controller: factory(symbol), references: 0 };
        entries.set(symbol, entry);
      }

      entry.references += 1;
      if (entry.references === 1) entry.controller.start();

      let released = false;
      return {
        controller: entry.controller,
        release() {
          if (released) return;
          released = true;
          entry.references -= 1;
          if (entry.references > 0) return;
          entries.delete(symbol);
          entry.controller.stop();
        },
      };
    },
  };
}

export const orderBookRegistry = createOrderBookRegistry();
