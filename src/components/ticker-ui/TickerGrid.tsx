import { useShallow } from 'zustand/react/shallow';

import { DEFAULT_SYMBOLS } from '../../config/markets';
import { useExchangeInfoStore, useTickerStore } from '../../stores/globalStore';
import { TickerCard } from './TickerCard';

export const TickerGrid = () => {
  const symbols = useExchangeInfoStore(
    useShallow((state) =>
      DEFAULT_SYMBOLS.filter((symbol) => state.symbolInfo[symbol]),
    ),
  );
  const hasTicker = useTickerStore((state) =>
    DEFAULT_SYMBOLS.some((symbol) => state.tickers[symbol] !== undefined),
  );

  if (symbols.length === 0) {
    return (
      <div className="market-empty" role="status">
        No selected USDT pairs are available in exchange information.
      </div>
    );
  }

  return (
    <>
      {!hasTicker && (
        <p className="sr-only" role="status">
          Waiting for live ticker data.
        </p>
      )}
      <ul
        className="ticker-grid"
        aria-label="Selected USDT spot markets"
        aria-busy={!hasTicker}
      >
        {symbols.map((symbol) => (
          <li className="ticker-grid-item" key={symbol}>
            <TickerCard symbol={symbol} />
          </li>
        ))}
      </ul>
    </>
  );
};
