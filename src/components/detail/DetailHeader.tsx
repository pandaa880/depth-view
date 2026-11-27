import { useMarketStats } from '../../hooks/useMarketStats';
import { BackLink } from './BackLink';
import { ConnectionDetails } from '../status/ConnectionDetails';
import { Metric } from '../ui/Metric';

type DetailHeaderProps = {
  symbol: string;
  baseAsset: string;
};

export function DetailHeader({ symbol, baseAsset }: DetailHeaderProps) {
  const stats = useMarketStats(symbol);

  return (
    <header className="detail-header">
      <div className="detail-header-inner">
        <BackLink />

        <h1 className="detail-pair">
          {baseAsset}
          <span className="ticker-quote">/USDT</span>
        </h1>

        <div className="detail-price" aria-label="Last price">
          <span className="detail-price-value numeric">{stats.lastPrice}</span>
          <span
            className="detail-change numeric"
            data-up={stats.changeTone === 'up' || undefined}
            data-down={stats.changeTone === 'down' || undefined}
            data-flat={stats.changeTone === 'flat' || undefined}
            aria-label="24 hour change"
          >
            {stats.changeArrow && (
              <span aria-hidden="true">{stats.changeArrow} </span>
            )}
            {stats.changeText}
          </span>
        </div>

        <div className="detail-stats">
          <Metric label="24h high" value={stats.high} />
          <Metric label="24h low" value={stats.low} />
          <Metric label="24h volume" value={stats.quoteVolume} />
        </div>

        <ConnectionDetails className="detail-connection" />
      </div>
    </header>
  );
}
