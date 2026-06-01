import { useTickerStore } from "../../stores/globalStore"

import { TickerCard } from "./TickerCard";

export const TickerGrid = () => {
  const tickerData = useTickerStore((state) => state.tickers);

  const tickerCardData = Object.values(tickerData).map((value) => {
    return {
      symbol: value.symbol,
      lastPrice: value.lastPrice,
      flashDirection: value.flashDirection,
      priceChangePercent: value.priceChangePercent,
      priceHistory: value.priceHistory
    }
  });

  const renderTickerCards = () => {
    return tickerCardData.map(item => (
      <div key={item.symbol} className="mx-4 min-w-40">
      <TickerCard {...item} />
      </div>
    ))

  }

  return (
    <div className="w-full flex">
      {renderTickerCards()}
    </div>
  )
}
