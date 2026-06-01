import { Navigate } from '@tanstack/react-router';

import { useExchangeInfoStore } from '../stores/globalStore';
import { detailRoute } from '../router';


export function Detail() {
  const { symbol } = detailRoute.useParams();

  const symbolInfo = useExchangeInfoStore(state => state.symbolInfo[symbol?.toUpperCase()]);

  if (!symbolInfo) {
    return <Navigate to="/" />; 
  }

  return <div>Detail view for {symbol}</div>;
}
