// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BinanceWebSocketManager } from '../lib/binance/BinanceWebSocket';
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

  emitClose(): void {
    this.readyState = 3;
    this.emit('close');
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
      TestSocket.instances[0]?.emitClose();
    });

    // metadata comes from the same manager instance, not a global store
    expect(result.current.status).toBe('reconnecting');
    expect(result.current.nextReconnectAt).toBe(1000);
    expect(result.current.reconnectAttempt).toBe(1);
  });

  it('follows the manager passed in rather than the shared singleton', () => {
    const manager = createManager();
    const { result } = renderHook(() => useWsStatus(manager));

    act(() => {
      manager.connect();
      TestSocket.instances[0]?.open();
    });

    expect(result.current.status).toBe('live');
    expect(result.current.reconnectAttempt).toBe(0);
    expect(result.current.nextReconnectAt).toBeNull();
  });
});
