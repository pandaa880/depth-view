# Depthview
A real-time crypto market data terminal built with React and TypeScript. Streams live order book, trade tape, and candlestick chart data directly from Binance's public WebSocket API — no backend required.

### What it does

- Live order book — 20 levels deep on each side, updating at 100ms intervals with depth visualization bars and sequence number validation
- Trade tape — last 50 trades scrolling in real time, color-coded by direction
- Candlestick chart — powered by TradingView's lightweight-charts with 6 timeframes (1m → 1d) and EMA(20) overlay
- Ticker grid — 20 symbol cards with live prices, 24h change, and sparklines
- Connection status — WebSocket health indicator showing messages/sec, reconnection state, and sequence gap count

### Project structure
```bash
src/
  components/
  lib/
    websocket/
    binance/
    orderbook/
    format/
  stores/
  hooks/
  pages/
```

### Running locally
```bash
# Clone
git clone https://github.com/prashantchaudhary/depthview
cd depthview

# Install (requires pnpm)
pnpm install

# Start dev server
pnpm dev

# Lint
pnpm lint

# Format
pnpm format

# Test
pnpm test
```

No environment variables required — all Binance endpoints used are public.
