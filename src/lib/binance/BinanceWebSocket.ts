// connection to binance stream url
const STREAM_URL = "wss://stream.binance.com:443/ws";

export const CONNECTION_STATUS = {
  Uninstantiated: 'uninstantiated',
  Connecting: 'connecting',
  Open: 'open',
  Closing: 'closing',
  Closed: 'closed',
  Disconnected: 'disconnected',
} as const;

export type ConnectionStatus = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

type MessageHandler = (data: unknown) => void;
type StatusHandler = (status: ConnectionStatus) => void;

export class BinanceWebSocketManager {
  private socket: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private status: ConnectionStatus = CONNECTION_STATUS.Uninstantiated;

  // connect to url
  connect(stream: string): void {
    this.socket = new WebSocket(`${STREAM_URL}/${stream}`);
    this.setStatus(CONNECTION_STATUS.Connecting);

    this.socket.addEventListener('open', () => {
      this.setStatus(CONNECTION_STATUS.Open);
    });

    this.socket.addEventListener('message', (event) => {
      const data = JSON.parse(event.data as string);
      this.messageHandlers.forEach((handler) => handler(data));
    })

    this.socket.addEventListener('close', () => {
      this.setStatus(CONNECTION_STATUS.Closed);
    })

    this.socket.addEventListener('error', () => {
      this.setStatus(CONNECTION_STATUS.Disconnected);
    })
  }

  // disconnect
  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  // message handler
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);

    return () => this.messageHandlers.delete(handler);
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
};
