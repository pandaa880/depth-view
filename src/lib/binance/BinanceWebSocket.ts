import { useMarketHealthStore } from '../../stores/marketHealth';

// single multiplexed combined-stream endpoint
const STREAM_URL = 'wss://stream.binance.com:9443/stream';
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const DEFAULT_WATCHDOG_MS = 30_000;
const MESSAGE_WINDOW_MS = 1_000;
const MESSAGE_WINDOW_CAPACITY = 2_048;

// numeric readyState values keep module import safe where WebSocket is absent
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

export const CONNECTION_STATUS = {
  Uninstantiated: 'uninstantiated',
  Connecting: 'connecting',
  Open: 'open',
  Closing: 'closing',
  Closed: 'closed',
  Disconnected: 'disconnected',
  Reconnecting: 'reconnecting',
} as const;

export type ConnectionStatus =
  (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

type MessageHandler = (data: unknown) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export type SocketFactory = (url: string) => WebSocket;
type TimeoutHandle = unknown;

export interface BinanceWebSocketTimers {
  setTimeout?: (callback: () => void, delay: number) => TimeoutHandle;
  clearTimeout?: (handle: TimeoutHandle) => void;
}

export interface ConnectionHealthPatch {
  status: ConnectionStatus;
  reconnectAttempt: number;
  nextReconnectAt: number | null;
  isStale?: boolean;
}

export interface BinanceWebSocketOptions extends BinanceWebSocketTimers {
  socketFactory?: SocketFactory;
  now?: () => number;
  watchdogMs?: number;
  publishHealth?: (patch: ConnectionHealthPatch) => void;
}

export interface ConnectionMetrics {
  status: ConnectionStatus;
  messagesPerSecond: number;
  lastMessageAt: number | null;
  reconnectAttempt: number;
  nextReconnectAt: number | null;
}

type TimerGlobal = {
  setTimeout: (callback: () => void, delay: number) => TimeoutHandle;
  clearTimeout: (handle: TimeoutHandle) => void;
};

type WebSocketGlobal = {
  WebSocket?: new (url: string) => WebSocket;
};

function defaultSocketFactory(url: string): WebSocket {
  const socketCtor = (globalThis as unknown as WebSocketGlobal).WebSocket;
  if (typeof socketCtor !== 'function') {
    throw new TypeError('WebSocket is unavailable');
  }
  return new socketCtor(url);
}

function defaultSetTimeout(callback: () => void, delay: number): TimeoutHandle {
  return (globalThis as unknown as TimerGlobal).setTimeout(callback, delay);
}

function defaultClearTimeout(handle: TimeoutHandle): void {
  (globalThis as unknown as TimerGlobal).clearTimeout(handle);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// SUBSCRIBE/UNSUBSCRIBE acks carry result:null and an id (which may be 0);
// error replies carry code/msg. Neither is market data.
function isControlResponse(parsed: Record<string, unknown>): boolean {
  if (!('id' in parsed)) return false;
  return 'result' in parsed || 'error' in parsed || 'code' in parsed;
}

export class BinanceWebSocketManager {
  private socket: WebSocket | null = null;
  // incremented whenever the active socket is replaced or invalidated, so
  // late open/message/close/error events from an old socket can be ignored
  private socketGeneration = 0;
  // stream -> handler -> registration count, so the same callback can be
  // registered twice and still only receive one call per frame
  private subscriptions: Map<string, Map<MessageHandler, number>> = new Map();
  private statusHandlers: Set<StatusHandler> = new Set();
  private status: ConnectionStatus = CONNECTION_STATUS.Uninstantiated;
  private messageId = 1;

  private isIntentionallyDisconnected = false;
  private isPaused = false;
  private reconnectAttempt = 0;
  private nextReconnectAt: number | null = null;
  private reconnectTimer: TimeoutHandle | null = null;
  private watchdogTimer: TimeoutHandle | null = null;
  private lastMessageAt: number | null = null;
  private messageWindow: number[] = [];
  private visibilityHandler: (() => void) | null = null;
  private visibilityCleanup: (() => void) | null = null;

  private readonly socketFactory: SocketFactory;
  private readonly scheduleTimeout: (
    callback: () => void,
    delay: number,
  ) => TimeoutHandle;
  private readonly cancelTimeout: (handle: TimeoutHandle) => void;
  private readonly now: () => number;
  private readonly watchdogMs: number;
  private readonly healthPublisher: (patch: ConnectionHealthPatch) => void;

  constructor(options: BinanceWebSocketOptions = {}) {
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.scheduleTimeout = options.setTimeout ?? defaultSetTimeout;
    this.cancelTimeout = options.clearTimeout ?? defaultClearTimeout;
    this.now = options.now ?? (() => Date.now());
    this.watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
    this.healthPublisher = options.publishHealth ?? (() => {});
  }

  connect(): void {
    this.isIntentionallyDisconnected = false;
    this.isPaused = false;
    this.clearReconnectTimer();

    const current = this.socket;
    if (
      current &&
      (current.readyState === SOCKET_CONNECTING ||
        current.readyState === SOCKET_OPEN)
    ) {
      return;
    }

    if (current) {
      // abandon a closing socket without letting its events reach the new one
      this.socket = null;
      this.socketGeneration += 1;
    }

    this.openSocket();
  }

  private openSocket(): void {
    let socket: WebSocket;
    try {
      socket = this.socketFactory(STREAM_URL);
    } catch {
      this.setStatus(CONNECTION_STATUS.Disconnected);
      this.scheduleReconnect();
      return;
    }

    const generation = this.socketGeneration + 1;
    this.socketGeneration = generation;
    this.socket = socket;
    this.setStatus(CONNECTION_STATUS.Connecting);

    socket.addEventListener('open', () => {
      this.handleOpen(socket, generation);
    });

    socket.addEventListener('message', (event) => {
      this.handleMessage(socket, generation, event);
    });

    socket.addEventListener('close', () => {
      this.handleClose(socket, generation);
    });

    socket.addEventListener('error', () => {
      this.handleError(socket, generation);
    });

    // cover the handshake too: a socket that never opens would otherwise sit
    // in CONNECTING forever with no deadline
    this.armWatchdog(socket, generation);
  }

  private handleOpen(socket: WebSocket, generation: number): void {
    if (!this.isActiveSocket(socket, generation)) return;

    this.reconnectAttempt = 0;
    this.nextReconnectAt = null;
    this.clearReconnectTimer();
    this.setStatus(CONNECTION_STATUS.Open, { isStale: false });
    this.resubscribeAll();
    this.armWatchdog(socket, generation);
  }

  private handleMessage(
    socket: WebSocket,
    generation: number,
    event: MessageEvent,
  ): void {
    if (!this.isActiveSocket(socket, generation)) return;

    const timestamp = this.now();
    this.lastMessageAt = timestamp;
    this.recordMessage(timestamp);
    // any traffic proves liveness, so the idle window restarts here
    this.armWatchdog(socket, generation);

    let parsed: unknown;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (!isRecord(parsed)) return;

    if (parsed.ping !== undefined) {
      if (this.isOpenSocket()) {
        socket.send(JSON.stringify({ pong: parsed.ping }));
      }
      return;
    }

    if (isControlResponse(parsed)) return;

    if (typeof parsed.stream === 'string' && 'data' in parsed) {
      const handlers = this.subscriptions.get(parsed.stream);
      if (!handlers) return;
      // iterate keys: a handler registered twice still runs once per frame
      for (const handler of handlers.keys()) handler(parsed.data);
    }
  }

  private handleClose(socket: WebSocket, generation: number): void {
    if (!this.isActiveSocket(socket, generation)) return;

    this.socket = null;
    this.socketGeneration += 1;
    this.clearWatchdogTimer();
    this.nextReconnectAt = null;

    if (this.isPaused || this.isIntentionallyDisconnected) {
      this.setStatus(CONNECTION_STATUS.Closed);
      return;
    }

    this.setStatus(CONNECTION_STATUS.Disconnected);
    this.scheduleReconnect();
  }

  private handleError(socket: WebSocket, generation: number): void {
    if (!this.isActiveSocket(socket, generation)) return;
    // the close event drives reconnection; wait for it (watchdog covers hangs)
    this.setStatus(CONNECTION_STATUS.Disconnected);
  }

  disconnect(): void {
    this.isIntentionallyDisconnected = true;
    this.isPaused = false;
    this.clearReconnectTimer();
    this.clearWatchdogTimer();

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.socketGeneration += 1;
      try {
        socket.close();
      } catch {
        // already closed sockets can throw in some runtimes
      }
    }

    this.setStatus(CONNECTION_STATUS.Closed);
  }

  forceDisconnect(): void {
    this.socket?.close(1000, 'forced test disconnect');
  }

  scheduleReconnect(): void {
    if (this.isIntentionallyDisconnected || this.isPaused) return;
    if (this.reconnectTimer !== null) return;
    if (this.hasLiveSocket()) return;

    const attempt = this.reconnectAttempt + 1;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** (attempt - 1),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt = attempt;
    this.nextReconnectAt = this.now() + delay;

    this.reconnectTimer = this.scheduleTimeout(() => {
      this.reconnectTimer = null;
      this.nextReconnectAt = null;
      if (this.isIntentionallyDisconnected || this.isPaused) return;
      this.connect();
    }, delay);

    this.setStatus(CONNECTION_STATUS.Reconnecting);
  }

  subscribe(streamName: string, handler: MessageHandler): () => void {
    let handlers = this.subscriptions.get(streamName);
    if (!handlers) {
      handlers = new Map();
      this.subscriptions.set(streamName, handlers);
      // only the first registration opens the stream
      this.sendSubscribe(streamName);
    }
    handlers.set(handler, (handlers.get(handler) ?? 0) + 1);

    let active = true;
    return () => {
      if (!active) return;
      active = false;

      const current = this.subscriptions.get(streamName);
      const count = current?.get(handler);
      if (!current || count === undefined) return;

      if (count > 1) {
        current.set(handler, count - 1);
        return;
      }

      current.delete(handler);
      if (current.size === 0) {
        this.subscriptions.delete(streamName);
        // only the final removal closes the stream
        this.sendUnsubscribe(streamName);
      }
    };
  }

  sendSubscribe(streamName: string): void {
    if (!this.isOpenSocket()) return;
    this.sendRaw({
      method: 'SUBSCRIBE',
      params: [streamName],
      id: this.messageId++,
    });
  }

  sendUnsubscribe(streamName: string): void {
    if (!this.isOpenSocket()) return;
    this.sendRaw({
      method: 'UNSUBSCRIBE',
      params: [streamName],
      id: this.messageId++,
    });
  }

  private resubscribeAll(): void {
    const streams = Array.from(this.subscriptions.keys());
    if (streams.length === 0) return;

    this.sendRaw({
      method: 'SUBSCRIBE',
      params: streams,
      id: this.messageId++,
    });
  }

  private sendRaw(payload: unknown): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    socket.send(JSON.stringify(payload));
  }

  pause(): void {
    this.isPaused = true;
    this.clearReconnectTimer();
    this.clearWatchdogTimer();

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.socketGeneration += 1;
      try {
        socket.close();
      } catch {
        // already closed sockets can throw in some runtimes
      }
    }

    this.setStatus(CONNECTION_STATUS.Closed);
  }

  resume(): void {
    this.isPaused = false;
    this.isIntentionallyDisconnected = false;
    if (this.subscriptions.size === 0) return;
    this.connect();
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getConnectionMetrics(): ConnectionMetrics {
    const timestamp = this.now();
    const cutoff = timestamp - MESSAGE_WINDOW_MS;

    let kept = 0;
    for (let index = 0; index < this.messageWindow.length; index += 1) {
      const messageAt = this.messageWindow[index];
      if (messageAt > cutoff) {
        this.messageWindow[kept] = messageAt;
        kept += 1;
      }
    }
    this.messageWindow.length = kept;

    return {
      status: this.status,
      messagesPerSecond: kept,
      lastMessageAt: this.lastMessageAt,
      reconnectAttempt: this.reconnectAttempt,
      nextReconnectAt: this.nextReconnectAt,
    };
  }

  setupVisibilityHandler(): () => void {
    if (typeof document === 'undefined') return () => {};
    if (this.visibilityCleanup) return this.visibilityCleanup;

    const handler = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        // an intentional disconnect stays in charge; hiding must not re-arm it
        if (!this.isIntentionallyDisconnected) this.pause();
        return;
      }
      // resume only a visibility pause, never an intentional disconnect
      if (this.isPaused && !this.isIntentionallyDisconnected) this.resume();
    };

    document.addEventListener('visibilitychange', handler);

    const cleanup = () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handler);
      }
      if (this.visibilityHandler === handler) {
        this.visibilityHandler = null;
        this.visibilityCleanup = null;
      }
    };

    this.visibilityHandler = handler;
    this.visibilityCleanup = cleanup;
    return cleanup;
  }

  private setStatus(
    status: ConnectionStatus,
    extra: Partial<ConnectionHealthPatch> = {},
  ): void {
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status));
    this.healthPublisher({
      status: this.status,
      reconnectAttempt: this.reconnectAttempt,
      nextReconnectAt: this.nextReconnectAt,
      ...extra,
    });
  }

  private isActiveSocket(socket: WebSocket, generation: number): boolean {
    return this.socket === socket && this.socketGeneration === generation;
  }

  private isOpenSocket(): boolean {
    return this.socket !== null && this.socket.readyState === SOCKET_OPEN;
  }

  private hasLiveSocket(): boolean {
    const readyState = this.socket?.readyState;
    return readyState === SOCKET_CONNECTING || readyState === SOCKET_OPEN;
  }

  private recordMessage(timestamp: number): void {
    if (this.messageWindow.length >= MESSAGE_WINDOW_CAPACITY) {
      this.messageWindow.shift();
    }
    this.messageWindow.push(timestamp);
  }

  private armWatchdog(socket: WebSocket, generation: number): void {
    this.clearWatchdogTimer();
    this.watchdogTimer = this.scheduleTimeout(() => {
      this.handleWatchdog(socket, generation);
    }, this.watchdogMs);
  }

  private handleWatchdog(socket: WebSocket, generation: number): void {
    this.watchdogTimer = null;
    if (!this.isActiveSocket(socket, generation)) return;

    // detach before closing so the socket's own close/error cannot trigger a
    // second reconnect flow for the same failure
    this.socket = null;
    this.socketGeneration += 1;
    this.clearReconnectTimer();

    try {
      socket.close(4000, 'heartbeat timeout');
    } catch {
      // already closed sockets can throw in some runtimes
    }

    if (this.isPaused || this.isIntentionallyDisconnected) {
      this.setStatus(CONNECTION_STATUS.Closed);
      return;
    }

    this.setStatus(CONNECTION_STATUS.Disconnected, { isStale: true });
    this.scheduleReconnect();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      this.cancelTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.nextReconnectAt = null;
  }

  private clearWatchdogTimer(): void {
    if (this.watchdogTimer !== null) {
      this.cancelTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}

export const wsManager = new BinanceWebSocketManager({
  publishHealth(patch) {
    useMarketHealthStore.getState().updateGlobal(patch);
  },
});

wsManager.setupVisibilityHandler();
