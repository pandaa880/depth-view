import { BackLink } from '../components/detail/BackLink';
import { Wordmark } from '../components/ui/Wordmark';
import './about.css';

const REPO_URL = 'https://github.com/pandaa880/depth-view';
const PORTFOLIO_URL = 'https://prashantchaudhari.dev/';

const STACK = [
  ['React 19 + TypeScript', 'typed components with strict compiler settings'],
  ['Vite', 'fast dev server and a small static production build'],
  ['Tailwind CSS v4', 'utility styling on top of shared design tokens'],
  ['Zustand', 'small stores read through narrow selectors'],
] as const;

const DECISIONS = [
  [
    'Exact-string financial math',
    'Prices and quantities stay decimal strings from the wire to the screen. Comparison, cumulative totals and ratios use string arithmetic, so no float rounding reaches a displayed number.',
  ],
  [
    'Snapshot and diff order book',
    'A REST snapshot is aligned with buffered depth diffs by update id. Duplicate and stale events are dropped, a gap triggers a fresh snapshot, and a failed resync is latched visibly instead of hidden.',
  ],
  [
    'Frame coalescing and narrow selectors',
    'Socket frames are collected and applied at most once per animation frame. Components subscribe to the smallest slice they render, so a tick on one pair does not re-render the others.',
  ],
  [
    'Bounded canvas chart and history',
    'Candles and the 20-period EMA live in capped buffers, and live updates patch the last candle instead of rebuilding the series. Sparkline history is capped as well.',
  ],
  [
    'Reliable socket lifecycle and metrics',
    'One shared connection with backoff reconnects, resubscription, and real message-rate and age metrics that feed the connection panel.',
  ],
] as const;

type ExternalLinkProps = { href: string; children: string };

const ExternalLink = ({ href, children }: ExternalLinkProps) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
    <span className="sr-only"> (opens in a new tab)</span>
  </a>
);

export function About() {
  return (
    <div className="terminal-shell">
      <header className="terminal-header">
        <div className="terminal-header-inner">
          <Wordmark />
          <BackLink label="Back to markets" />
        </div>
      </header>

      <main className="about">
        <h1>About Depth View</h1>
        <p>
          Depth View is a real-time spot market terminal for Binance USDT pairs.
          It shows a live watchlist, and for each pair a candlestick chart with
          an EMA, a 20-level order book on each side, and a scrolling trade
          tape.
        </p>
        <p>
          It runs entirely in the browser. There is no backend and no
          credentials or environment variables: it reads Binance public REST and
          WebSocket market data directly.
        </p>

        <h2>Stack</h2>
        <ul>
          {STACK.map(([name, reason]) => (
            <li key={name}>
              <strong>{name}</strong> — {reason}
            </li>
          ))}
        </ul>

        <h2>Technical decisions</h2>
        <ul>
          {DECISIONS.map(([title, text]) => (
            <li key={title}>
              <strong>{title}.</strong> {text}
            </li>
          ))}
        </ul>

        <p className="about-hint">
          Press <kbd>Shift</kbd> + <kbd>P</kbd> to toggle a small performance
          readout.
        </p>

        <p className="about-links">
          <ExternalLink href={REPO_URL}>Source on GitHub</ExternalLink>
          <ExternalLink href={PORTFOLIO_URL}>Portfolio</ExternalLink>
        </p>
      </main>
    </div>
  );
}
