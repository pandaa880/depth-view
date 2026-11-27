export type TickerData = {
  symbol: string;
  lastPrice: string;
  prevPrice: string | undefined;
  priceChangePercent: number;
  volume24h: string;
  priceHistory: number[];
  flashDirection: 'up' | 'down' | null;
  highPrice?: string;
  lowPrice?: string;
  lastEventTime?: number;
};
