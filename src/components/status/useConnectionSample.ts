import { useEffect, useState } from 'react';

import {
  wsManager,
  type ConnectionMetrics,
} from '../../lib/binance/BinanceWebSocket';

const SAMPLE_INTERVAL_MS = 1000;

export interface ConnectionSample {
  metrics: ConnectionMetrics;
  now: number;
}

const takeSample = (): ConnectionSample => ({
  metrics: wsManager.getConnectionMetrics(),
  now: Date.now(),
});

/**
 * Samples live connection metrics once per second, only while `active`.
 * Returns null until the first sample; the timer is cleared on close.
 */
export function useConnectionSample(active: boolean): ConnectionSample | null {
  const [sample, setSample] = useState<ConnectionSample | null>(null);

  useEffect(() => {
    if (!active) return;

    setSample(takeSample());
    const timer = setInterval(
      () => setSample(takeSample()),
      SAMPLE_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [active]);

  return sample;
}
