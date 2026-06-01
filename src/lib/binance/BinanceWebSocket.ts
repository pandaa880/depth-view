// connection to binance stream url
const STREAM_URL = 'wss://stream.binance.com:9443/stream';

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

export class BinanceWebSocketManager {
  private socket: WebSocket | null = null;
  private subscriptions: Map<string, Set<MessageHandler>> = new Map();
  private statusHandlers: Set<StatusHandler> = new Set();
  private status: ConnectionStatus = CONNECTION_STATUS.Uninstantiated;
  private messageId: number = 1;

  private isIntentionallyDisconnected: boolean = false;
  private reconnectAttempt: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // connect to url
  connect(): void {
    this.isIntentionallyDisconnected = false;

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING ||
        this.socket.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    this.socket = new WebSocket(STREAM_URL);
    this.setStatus(CONNECTION_STATUS.Connecting);

    this.socket.addEventListener('open', () => {
      this.reconnectAttempt = 0;
      this.setStatus(CONNECTION_STATUS.Open);

      this.resubscribeAll();
    });

    this.socket.addEventListener('message', (event) => {
      const parsed = JSON.parse(event.data as string);

      if (parsed.ping) {
        this.socket?.send(JSON.stringify({ pong: parsed.ping }));
        return;
      }

      // ignore ack message when subscribing to stream
      if (parsed.result === null && parsed.id) return;

      if (parsed.stream && parsed.data) {
        this.subscriptions.get(parsed.stream)?.forEach((h) => h(parsed.data));
      }
    });

    this.socket.addEventListener('close', () => {
      this.setStatus(CONNECTION_STATUS.Closed);
      this.socket = null;

      if (!this.isIntentionallyDisconnected) {
        this.scheduleReconnect();
      }
    });

    this.socket.addEventListener('error', () => {
      this.setStatus(CONNECTION_STATUS.Disconnected);
    });
  }

  disconnect(): void {
    if (!this.socket) return;

    this.isIntentionallyDisconnected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket.close();
    this.socket = null;
    this.setStatus(CONNECTION_STATUS.Closed);
  }

  forceDisconnect(): void {
    this.socket?.close(1000, 'forced test disconnect');
  }

  scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30_000);
    this.reconnectAttempt++;
    this.setStatus(CONNECTION_STATUS.Reconnecting);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // message handler
  subscribe(streamName: string, handler: MessageHandler): () => void {
    if (!this.subscriptions.has(streamName)) {
      this.subscriptions.set(streamName, new Set());
      this.sendSubscribe(streamName);
    }
    this.subscriptions.get(streamName)!.add(handler);

    return () => {
      this.subscriptions.get(streamName)?.delete(handler);
      if (this.subscriptions.get(streamName)?.size === 0) {
        this.subscriptions.delete(streamName);
        this.sendUnsubscribe(streamName);
      }
    };
  }

  sendSubscribe(streamName: string): void {
    if (this.status !== CONNECTION_STATUS.Open) return;

    this.socket?.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params: [streamName],
        id: this.messageId++,
      }),
    );
  }

  sendUnsubscribe(streamName: string): void {
    if (this.status !== CONNECTION_STATUS.Open) return;

    this.socket?.send(
      JSON.stringify({
        method: 'UNSUBSCRIBE',
        params: [streamName],
        id: this.messageId++,
      }),
    );
  }

  private resubscribeAll(): void {
    const streams = Array.from(this.subscriptions.keys());
    if (streams.length === 0) return;

    this.socket?.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params: streams,
        id: this.messageId++,
      }),
    );
  }

  pause(): void {
    if (!this.socket) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket.close();
    this.socket = null;
    this.setStatus(CONNECTION_STATUS.Closed);
    // isIntentionallyDisconnected stays false
  }

  resume(): void {
    const streams = Array.from(this.subscriptions.keys());
    if (streams.length > 0) this.connect(); // resubscribeAll fires automatically on open
  }

  // status change handler
  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);

    return () => this.statusHandlers.delete(handler);
  }

  // getter & setter for status
  getStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status));
  }

  setupVisibilityHandler(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // this.disconnect();
        this.pause();
      } else {
        const streams = Array.from(this.subscriptions.keys());
        if (streams.length > 0) {
          // this.connect();
          this.resume();
        }
      }
    });
  }
}

export const wsManager = new BinanceWebSocketManager();

wsManager.setupVisibilityHandler();
