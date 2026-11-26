// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BinanceWebSocketManager } from '../lib/binance/BinanceWebSocket';
import { createFeedHealth, useMarketHealthStore } from '../stores/marketHealth';
import { useWsStatus } from './useWsStatus';

class TestSocket {
  static instances: TestSocket[] = [];

  readyState = 0;
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor() {
    TestSocket.instances.push(this);
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(): void {}

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }

  private emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function createManager(): BinanceWebSocketManager {
  TestSocket.instances = [];
  return new BinanceWebSocketManager({
    socketFactory: () => new TestSocket() as unknown as WebSocket,
    setTimeout: () => 0,
    clearTimeout: () => {},
    now: () => 0,
  });
}

afterEach(() => {
  TestSocket.instances = [];
  useMarketHealthStore.setState({ global: createFeedHealth() });
});

describe('useWsStatus', () => {
  it('maps manager status and styles, and exposes reconnect metadata', () => {
    const manager = createManager();
    const { result } = renderHook(() => useWsStatus(manager));

    expect(result.current.status).toBe('uninstantiated');
    expect(result.current.statusElmStyles.dot).toBe('bg-connection-failed');
    expect(result.current.nextReconnectAt).toBeNull();
    expect(result.current.reconnectAttempt).toBe(0);

    act(() => {
      manager.connect();
      TestSocket.instances[0]?.open();
    });

    expect(result.current.status).toBe('live');
    expect(result.current.statusElmStyles).toEqual({
      dot: 'bg-connection-live',
      text: 'text-connection-live',
    });

    act(() => {
      useMarketHealthStore.getState().updateGlobal({
        nextReconnectAt: 42_000,
        reconnectAttempt: 2,
      });
    });

    expect(result.current.nextReconnectAt).toBe(42_000);
    expect(result.current.reconnectAttempt).toBe(2);
  });
});
