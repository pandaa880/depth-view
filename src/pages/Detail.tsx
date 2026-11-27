import { Navigate } from '@tanstack/react-router';

import { DetailHeader } from '../components/detail/DetailHeader';
import { DetailLayout } from '../components/detail/DetailLayout';
import { useDocumentTitle } from '../components/detail/useDocumentTitle';
import { detailRoute } from '../router';
import { useExchangeInfoStore } from '../stores/globalStore';

const QUOTE_ASSET = 'USDT';

const baseAssetOf = (symbol: string): string =>
  symbol.endsWith(QUOTE_ASSET) ? symbol.slice(0, -QUOTE_ASSET.length) : symbol;

export function Detail() {
  const { symbol: routeSymbol } = detailRoute.useParams();
  const symbol = routeSymbol.toUpperCase();
  const baseAsset = baseAssetOf(symbol);

  const isBootstrapped = useExchangeInfoStore((state) => state.isBootstrapped);
  const isKnown = useExchangeInfoStore((state) => symbol in state.symbolInfo);

  useDocumentTitle(`${baseAsset}/${QUOTE_ASSET} · Depth View`);

  if (!isBootstrapped) return null;
  if (!isKnown) return <Navigate to="/" replace />;

  return (
    <div className="terminal-shell">
      <DetailHeader symbol={symbol} baseAsset={baseAsset} />
      <main className="detail-main">
        <DetailLayout symbol={symbol} />
      </main>
    </div>
  );
}
