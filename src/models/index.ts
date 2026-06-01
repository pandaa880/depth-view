export type TickerData = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: number;
  volume24h: string;
  priceHistory: number[];
  flashDirection: 'up' | 'down' | null;
};
