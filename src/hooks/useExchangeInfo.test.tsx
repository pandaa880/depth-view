// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { binanceRest } from '../lib/binance/rest-client';
import { useExchangeInfoStore } from '../stores/globalStore';
import { useExchangeInfo } from './useExchangeInfo';

afterEach(() => {
  vi.restoreAllMocks();
  useExchangeInfoStore.setState({ symbolInfo: {}, isBootstrapped: false });
});

describe('useExchangeInfo', () => {
  it('requests exchange info once under StrictMode and does not refetch', async () => {
    const fetchInfo = vi
      .spyOn(binanceRest, 'getExchangeInfo')
      .mockResolvedValue({ symbols: [] } as never);

    const { result, rerender } = renderHook(() => useExchangeInfo(), {
      wrapper: StrictMode,
    });
    await waitFor(() => expect(result.current.isBootstrapped).toBe(true));
    rerender();

    expect(fetchInfo).toHaveBeenCalledTimes(1);
  });
});
