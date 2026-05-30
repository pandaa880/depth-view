import { type TickerData } from "../../../models";

export type MiniTickerRaw = {
  "e": string;    // Event type
  "E": number;    // Event time
  "s": string;    // Symbol
  "c": string;    // Close price
  "o": string;    // Open price
  "h": string;    // High price
  "l": string;    // Low price
  "v": string;    // Total traded base asset volume
  "q": string;    // Total traded quote asset volume
}

export function transformMiniTicker(raw: MiniTickerRaw, existing?: TickerData): TickerData {

  const closePrice = parseFloat(raw.c);
  const openPrice = parseFloat(raw.o);
  const prevPrice = existing?.lastPrice ?? raw.c;

  const priceChangePercent = ((closePrice - openPrice) / openPrice) * 100;

  const priceHistory = [...(existing?.priceHistory ?? []), closePrice].slice(-60);

  const flashDirection = existing
    ? closePrice > parseFloat(existing.lastPrice) ? 'up'
      : closePrice < parseFloat(existing.lastPrice) ? 'down'
        : null
    : null;

  return {
    symbol: raw.s,
    lastPrice: raw.c,
    priceChangePercent,
    priceHistory,
    prevPrice,
    volume24h: raw.q,
    flashDirection
  }
}
