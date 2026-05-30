import { useCallback, useEffect, useRef, useState } from 'react';

import { binanceRest } from '../lib/binance/rest-client';
import { transformExchangeInfo } from '../lib/binance/transformers/exchangeInfo';
import { useExchangeInfoStore } from '../stores/globalStore';

export function useExchangeInfo() {
  const isFetchingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const isBootstrapped = useExchangeInfoStore((state) => state.isBootstrapped);
  const setSymbolInfo = useExchangeInfoStore((state) => state.setSymbolInfo);

  const bootstrap = useCallback(async () => {
    if (isFetchingRef.current) return;

    isFetchingRef.current = true;

    try {
      const rawInfo = await binanceRest.getExchangeInfo();
      const modifiedExchangeInfo = transformExchangeInfo(rawInfo);
      setSymbolInfo(modifiedExchangeInfo);
    } catch (error) {
      isFetchingRef.current = false;
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
    }
  }, [setSymbolInfo]
  );

  useEffect(() => {
    if (!isBootstrapped) {
      bootstrap();
    }
  }, [bootstrap, isBootstrapped]);

  return {
    isBootstrapped,
    error,
  };
}
