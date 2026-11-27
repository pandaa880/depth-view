import { CandlestickChart } from '../chart/CandlestickChart';
import { OrderBook } from '../orderbook/OrderBook';
import { TradeTape } from '../trades/TradeTape';
import './detail.css';

/** Keyed by symbol so each navigation tears down its own subscriptions. */
export function DetailLayout({ symbol }: { symbol: string }) {
  return (
    <div className="detail-grid">
      <div className="detail-chart-cell">
        <CandlestickChart
          key={`chart-${symbol}`}
          symbol={symbol}
          className="detail-chart"
          plotClassName="detail-chart-plot"
        />
      </div>
      <div className="detail-side">
        <OrderBook key={`book-${symbol}`} symbol={symbol} />
        <TradeTape key={`tape-${symbol}`} symbol={symbol} />
      </div>
    </div>
  );
}
