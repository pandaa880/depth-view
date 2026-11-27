import { useTrades } from '../../hooks/useTrades';
import type { ConnectionStatus } from '../../lib/binance/BinanceWebSocket';
import { useMarketHealthStore } from '../../stores/marketHealth';
import { Panel } from '../ui/Panel';
import { TradeList, type TradeFeedState } from './TradeList';

function toFeedState(
  status: ConnectionStatus,
  isStale: boolean,
): TradeFeedState {
  if (isStale) return 'stale';
  if (status === 'open') return 'live';
  if (status === 'connecting' || status === 'reconnecting') {
    return 'connecting';
  }
  return 'offline';
}

export function TradeTape({ symbol }: { symbol: string }) {
  const trades = useTrades(symbol);
  const status = useMarketHealthStore((state) => state.global.status);
  const isStale = useMarketHealthStore((state) => state.global.isStale);

  return (
    <Panel
      variant="flush"
      className="trade-tape"
      title="Recent trades"
      aria-label={`${symbol} recent trades`}
    >
      <TradeList
        symbol={symbol}
        trades={trades}
        feedState={toFeedState(status, isStale)}
      />
    </Panel>
  );
}
