import { useShallow } from 'zustand/react/shallow';

import { useExchangeInfoStore } from '../../stores/globalStore';

import { TickerCard } from './TickerCard';

export const TickerGrid = () => {
  const symbols = useExchangeInfoStore(
    useShallow((state) => Object.keys(state.symbolInfo)),
  );

  const renderTickerCards = () => {
    return symbols.map((s) => (
      <div key={s} className="mx-4 min-w-40">
        <TickerCard symbol={s} />
      </div>
    ));
  };

  return <div className="w-full flex">{renderTickerCards()}</div>;
};
