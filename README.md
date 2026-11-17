# Depthview

A real-time crypto market data terminal built with React and TypeScript. It
streams market data straight from Binance's public WebSocket API, with no
backend.

**Status: work in progress.** The streaming layer and the ticker grid work.
The order book, trade tape and chart are planned.

## Built

- **One multiplexed WebSocket.** A single connection to Binance's combined
  stream endpoint serves every subscriber. Subscriptions are reference
  counted per stream, so a stream is subscribed once and unsubscribed when
  its last handler leaves.
- **Reconnect with backoff.** A dropped connection retries with exponential
  backoff (1 s doubling, capped at 30 s) and resubscribes every active stream
  once the socket reopens.
- **Connection status indicator.** The header shows the socket state:
  connecting, live, reconnecting or closed.
- **Ticker grid.** Live price cards from the `!miniTicker@arr` stream, each
  with 24h change and a sparkline of recent prices.
- **Symbol metadata.** Exchange info is fetched once over REST and cached in a
  Zustand store before the UI renders.
- **Routing.** TanStack Router, with a per-symbol detail route (stub for now).

## Planned

- Order book: REST depth snapshot plus the diff stream, with update-id
  sequence validation and gap recovery
- Trade tape: the most recent trades, coloured by side
- Candlestick chart with lightweight-charts, several timeframes and an EMA
  overlay
- Unit tests for the order book merge and the reconnect logic

## Stack

React 19, TypeScript, Vite, Tailwind CSS v4, Zustand, TanStack Router,
oxlint and oxfmt.

## Project structure

```text
src/
  components/ticker-ui/   ticker grid, cards, sparkline
  hooks/                  WebSocket connection, status, exchange info
  lib/binance/            WebSocket manager, REST client, transformers, types
  lib/format/             number formatting
  models/                 domain types
  pages/                  Home, Detail, root layout
  stores/                 Zustand stores
```

## Running locally

Requires pnpm.

```bash
git clone https://github.com/pandaa880/depth-view
cd depth-view
pnpm install
pnpm dev           # start the dev server
pnpm build         # type-check and build
pnpm lint          # oxlint
pnpm format:check  # oxfmt (pnpm format to fix)
```

No environment variables are needed: every Binance endpoint used is public.

## License

[MIT](LICENSE)
