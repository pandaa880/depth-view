import { Panel } from '../components/ui/Panel';
import { StatusBadge, type StatusTone } from '../components/ui/StatusBadge';
import { Wordmark } from '../components/ui/Wordmark';
import { TickerGrid } from '../components/ticker-ui/TickerGrid';
import { useWsStatus } from '../hooks/useWsStatus';

const getStatusTone = (status: string): StatusTone => {
  if (status === 'live' || status === 'open') return 'live';
  if (
    status === 'connecting' ||
    status === 'reconnecting' ||
    status === 'closing'
  ) {
    return 'pending';
  }
  return 'offline';
};

export const Home = () => {
  const { status } = useWsStatus();

  return (
    <div className="terminal-shell">
      <header className="terminal-header">
        <div className="terminal-header-inner">
          <div className="brand-group">
            <Wordmark />
            <span className="terminal-descriptor">Real-time spot terminal</span>
          </div>
          <StatusBadge status={status} tone={getStatusTone(status)} />
        </div>
      </header>

      <main className="terminal-main">
        <div className="market-intro">
          <div>
            <p className="section-kicker">Binance spot / USDT</p>
            <h1>Market watch</h1>
          </div>
          <p className="market-intro-copy">
            Live last trade, daily movement, and quote volume across selected
            pairs.
          </p>
        </div>

        <Panel
          variant="flush"
          className="markets-panel"
          aria-label="Live market watchlist"
        >
          <TickerGrid />
        </Panel>
      </main>

      <footer className="terminal-footer">
        <span>Selected USDT spot pairs</span>
        <a
          className="source-link"
          href="https://github.com/pandaa880/depth-view"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub source
          <span className="external-link-icon" aria-hidden="true">
            ↗
          </span>
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </footer>
    </div>
  );
};
