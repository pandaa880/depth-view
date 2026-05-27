import { useEffect, useRef, useState } from 'react';

import { binanceRest } from '../lib/binance/rest-client';
import { transformExchangeInfo } from '../lib/binance/transformers/exchangeInfo';
import { useExchangeInfoStore } from '../stores/globalStore';

export function useExchangeInfo() {
  const isFetchingRef = useRef(false);
  const [error, setError] = useState({
    isError: false,
    message: ''
  });

  const isBootstrapped = useExchangeInfoStore((state) => state.isBootstrapped);
  const setSymbolInfo = useExchangeInfoStore((state) => state.setSymbolInfo);

  const bootstrap = async () => {
    if (isFetchingRef.current) return;

    isFetchingRef.current = true;

    try {
      const rawInfo = await binanceRest.getExchangeInfo();
      const modifiedExchangeInfo = transformExchangeInfo(rawInfo);
      setSymbolInfo(modifiedExchangeInfo);
    } catch (error) {
      isFetchingRef.current = false;
      setError({
        isError: true,
        message: error
      });
    }
  };

  useEffect(() => {
    if (!isBootstrapped) {
      bootstrap();
    }
  }, []);

  return {
    isBootstrapped,
    error,
  };
}
