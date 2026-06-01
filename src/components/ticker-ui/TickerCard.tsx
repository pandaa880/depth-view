import { Link } from '@tanstack/react-router';

import { useTickerStore } from '../../stores/globalStore';
import { Sparkline } from './Sparkline';
import { formatPrice, formatPercent } from '../../lib/format/number';

interface TickerCardProps {
  symbol: string;
}

export const TickerCard = ({ symbol }: TickerCardProps) => {
  const ticker = useTickerStore((state) => state.tickers[symbol]);

  if (!ticker) {
    console.warn('No ticker data available yet!');
    return null;
  }

  const { flashDirection, lastPrice, priceChangePercent, priceHistory } =
    ticker;

  const { text, arrow, isPositive } = formatPercent(priceChangePercent);
  const changeColor = isPositive ? 'text-green-500' : 'text-red-500';

  const flashClass =
    flashDirection === 'up'
      ? 'text-green-400'
      : flashDirection === 'down'
        ? 'text-red-400'
        : 'text-slate-200';

  return (
    <Link
      to={`/symbol/$symbol`}
      params={{ symbol }}
      className="px-4 py-2 flex flex-col border border-solid border-border"
    >
      <span className="text-xs text-muted">
        {symbol.replace('USDT', '/USDT')}
      </span>
      <span
        className={`mb-2 text-base transition-colors duration-100 ${flashClass}`}
      >
        {formatPrice(symbol, lastPrice)}
      </span>
      <div
        className={`mb-4 flex items-baseline gap-2.5 text-xs font-mono ${changeColor}`}
      >
        <span className="text-base">{arrow}</span>
        <span>{text}</span>
      </div>
      <div className="my-2">
        <Sparkline
          history={priceHistory}
          color={isPositive ? '#22c55e' : '#ef4444'}
        />
      </div>
    </Link>
  );
};
