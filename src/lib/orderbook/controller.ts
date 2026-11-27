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
  type MutableOrderBook,
} from './orderBook';

const DEFAULT_REQUEST_TIMEOUT = 10_000;
const DEFAULT_RETRY_DELAY = 250;
const MAX_RETRY_DELAY = 5_000;
const DEFAULT_BUFFER_LIMIT = 5_000;
const MAX_STALE_SNAPSHOTS = 3;

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

interface ActiveSnapshot {
  generation: number;
  abort: AbortController;
  timeout: number | null;
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

  private book: MutableOrderBook = createOrderBook();
  private buffered: DepthUpdateEvent[] = [];
  private view: OrderBookView;
  private lastGoodView: OrderBookView | null = null;
  private viewState: OrderBookView['state'] = 'connecting';
  private gapCount = 0;
  private started = false;
  private snapshotReady = false;
  private awaitingFirstEvent = false;
  private staleSnapshots = 0;
  private connectionInterrupted = false;
  private generation = 0;
  private activeSnapshot: ActiveSnapshot | null = null;
  private retryTimer: number | null = null;
  private retryAttempt = 0;
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
    if (this.started) return;

    this.started = true;
    this.book = createOrderBook();
    this.buffered = [];
    this.lastGoodView = null;
    this.gapCount = 0;
    this.retryAttempt = 0;
    this.snapshotReady = false;
    this.awaitingFirstEvent = true;
    this.staleSnapshots = 0;
    this.connectionInterrupted = false;
    this.viewState = 'connecting';
    this.view = createEmptyOrderBookView(this.symbol);
    this.viewDirty = true;
    this.pendingStatus = this.socket.getStatus();
    this.pendingGaps = 0;
    this.pendingMessageAt = null;

    this.unsubscribeStatus = this.socket.onStatusChange(this.handleStatus);
    this.unsubscribeDepth = this.socket.subscribe(
      `${this.symbol.toLowerCase()}@depth@100ms`,
      this.handleMessage,
    );

    this.socket.connect();
  };

  stop = (): void => {
    if (!this.started) return;

    this.started = false;
    this.generation += 1;
    this.cancelActiveSnapshot();
    this.clearRetry();
    this.publication.cancel();

    const unsubscribeDepth = this.unsubscribeDepth;
    const unsubscribeStatus = this.unsubscribeStatus;
    this.unsubscribeDepth = null;
    this.unsubscribeStatus = null;
    unsubscribeDepth?.();
    unsubscribeStatus?.();

    this.buffered = [];
    clearOrderBook(this.book);
    this.snapshotReady = false;
    this.awaitingFirstEvent = false;
    this.listeners.clear();
    this.pendingGaps = 0;
    this.pendingMessageAt = null;
    this.pendingStatus = null;
  };

  private handleMessage = (data: unknown): void => {
    if (
      !this.started ||
      this.connectionInterrupted ||
      !isDepthUpdateEvent(data) ||
      data.s !== this.symbol
    ) {
      return;
    }

    let event: DepthUpdateEvent;
    try {
      event = normalizeDepthUpdate(data);
    } catch {
      if (this.viewState === 'live') this.recordGapAndSync();
      return;
    }

    this.pendingMessageAt = event.E;

    if (this.viewState === 'live') {
      const result = applyNextDepthUpdate(this.book, event);
      if (result === 'gap') {
        this.recordGapAndSync();
        return;
      }
      if (result === 'applied') {
        this.requestPublication(true);
      }
      return;
    }

    if (this.snapshotReady) {
      this.reconcileReadyBook([event]);
      return;
    }

    if (this.buffered.length >= this.maxBufferedEvents) {
      this.recordGapAndSync();
      return;
    }

    this.buffered.push(event);
    if (this.awaitingFirstEvent) {
      this.awaitingFirstEvent = false;
      this.requestSnapshot();
    } else {
      this.requestPublication(false);
    }
  };

  private handleStatus = (status: ConnectionStatus): void => {
    if (!this.started) return;
    this.pendingStatus = status;

    if (status === CONNECTION_STATUS.Open) {
      if (this.connectionInterrupted) {
        this.connectionInterrupted = false;
        this.awaitingFirstEvent = true;
        this.requestPublication(false);
      } else {
        this.requestPublication(false);
      }
      return;
    }

    if (!interruptedStatuses.has(status)) {
      this.requestPublication(false);
      return;
    }

    if (!this.connectionInterrupted) {
      this.connectionInterrupted = true;
      this.gapCount += 1;
      this.pendingGaps += 1;
      this.invalidateSync();
      this.viewState = this.lastGoodView ? 'stale' : 'connecting';
      this.requestPublication(true);
    } else {
      this.requestPublication(false);
    }
  };

  private startSnapshot(): void {
    if (!this.started || this.connectionInterrupted) return;

    this.invalidateSync();
    this.requestSnapshot();
  }

  // Fetches a snapshot for the current generation, keeping buffered events.
  private requestSnapshot(): void {
    if (!this.started || this.connectionInterrupted) return;

    const generation = this.generation;
    this.viewState = this.lastGoodView ? 'stale' : 'syncing';
    this.requestPublication(true);

    const active: ActiveSnapshot = {
      generation,
      abort: new AbortController(),
      timeout: null,
    };
    this.activeSnapshot = active;
    active.timeout = this.scheduler.setTimeout(() => {
      if (this.activeSnapshot !== active) return;
      this.activeSnapshot = null;
      active.timeout = null;
      active.abort.abort();
      this.handleSnapshotFailure(generation);
    }, this.requestTimeoutMs);

    let request: Promise<DepthSnapshotResponse>;
    try {
      request = this.rest.getDepthSnapshot(
        this.symbol,
        1000,
        active.abort.signal,
      );
    } catch {
      this.rejectSnapshot(active);
      return;
    }

    Promise.resolve(request).then(
      (snapshot) => this.resolveSnapshot(active, snapshot),
      () => this.rejectSnapshot(active),
    );
  }

  private resolveSnapshot(
    active: ActiveSnapshot,
    snapshot: DepthSnapshotResponse,
  ): void {
    if (this.activeSnapshot !== active || !this.started) return;
    this.clearSnapshotTimer(active);
    this.activeSnapshot = null;

    try {
      loadDepthSnapshot(this.book, snapshot);
      this.snapshotReady = true;
      this.reconcileReadyBook(this.buffered);
    } catch {
      this.recordGapAndSync();
    }
  }

  private rejectSnapshot(active: ActiveSnapshot): void {
    if (this.activeSnapshot !== active || !this.started) return;
    this.clearSnapshotTimer(active);
    this.activeSnapshot = null;
    this.handleSnapshotFailure(active.generation);
  }

  private handleSnapshotFailure(generation: number): void {
    if (
      !this.started ||
      this.connectionInterrupted ||
      generation !== this.generation
    ) {
      return;
    }

    this.snapshotReady = false;
    this.staleSnapshots = 0;
    this.viewState = this.lastGoodView ? 'stale' : 'error';
    this.requestPublication(true);

    const delay = Math.min(
      this.retryDelayMs * 2 ** this.retryAttempt,
      MAX_RETRY_DELAY,
    );
    this.retryAttempt += 1;
    this.clearRetry();
    this.retryTimer = this.scheduler.setTimeout(() => {
      this.retryTimer = null;
      if (generation !== this.generation) return;
      this.startSnapshot();
    }, delay);
  }

  private reconcileReadyBook(events: DepthUpdateEvent[]): void {
    const staleId = this.book.lastUpdateId;
    const pending = events.filter(
      (event) => staleId === null || event.u > staleId,
    );

    let result: ReturnType<typeof reconcileBufferedDepthUpdates> = 'waiting';
    try {
      result = reconcileBufferedDepthUpdates(this.book, pending);
    } catch {
      result = 'gap';
    }

    if (this.buffered.length > 0) this.buffered = [];

    if (result === 'gap') {
      this.recordGapAndSync();
      return;
    }

    if (result === 'stale-snapshot') {
      this.refetchStaleSnapshot(pending);
      return;
    }

    if (result === 'live') {
      this.viewState = 'live';
      this.retryAttempt = 0;
      this.staleSnapshots = 0;
    } else {
      this.viewState = this.lastGoodView ? 'stale' : 'syncing';
    }
    this.requestPublication(true);
  }

  // The snapshot is older than the stream: refetch, not a sequence gap.
  private refetchStaleSnapshot(pending: DepthUpdateEvent[]): void {
    this.staleSnapshots += 1;
    this.snapshotReady = false;
    clearOrderBook(this.book);

    if (this.staleSnapshots >= MAX_STALE_SNAPSHOTS) {
      this.buffered = [];
      this.handleSnapshotFailure(this.generation);
      return;
    }

    this.buffered = pending;
    this.requestSnapshot();
  }

  private recordGapAndSync(): void {
    if (!this.started) return;
    this.gapCount += 1;
    this.pendingGaps += 1;
    this.startSnapshot();
  }

  private invalidateSync(): void {
    this.generation += 1;
    this.cancelActiveSnapshot();
    this.clearRetry();
    this.buffered = [];
    clearOrderBook(this.book);
    this.snapshotReady = false;
    this.awaitingFirstEvent = false;
    this.staleSnapshots = 0;
  }

  private cancelActiveSnapshot(): void {
    const active = this.activeSnapshot;
    if (!active) return;
    this.activeSnapshot = null;
    this.clearSnapshotTimer(active);
    active.abort.abort();
  }

  private clearSnapshotTimer(active: ActiveSnapshot): void {
    if (active.timeout === null) return;
    this.scheduler.clearTimeout(active.timeout);
    active.timeout = null;
  }

  private clearRetry(): void {
    if (this.retryTimer === null) return;
    this.scheduler.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private requestPublication(viewChanged: boolean): void {
    if (!this.started) return;
    if (viewChanged) this.viewDirty = true;
    this.publication.request();
  }

  private deriveView(): OrderBookView {
    if (this.viewState === 'live') {
      return projectOrderBookView(
        this.book,
        this.symbol,
        this.gapCount,
        this.view,
      );
    }

    return preserveOrderBookView(
      this.lastGoodView ?? this.view,
      this.viewState,
      this.gapCount,
    );
  }

  private flushPublication(): void {
    if (!this.started) return;

    const nextView = this.viewDirty ? this.deriveView() : this.view;
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
