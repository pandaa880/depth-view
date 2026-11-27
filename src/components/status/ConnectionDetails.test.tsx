// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { wsManager } from '../../lib/binance/BinanceWebSocket';
import { ConnectionDetails } from './ConnectionDetails';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const stubMetrics = (messagesPerSecond: number) =>
  vi.spyOn(wsManager, 'getConnectionMetrics').mockImplementation(() => ({
    status: 'open',
    messagesPerSecond,
    lastMessageAt: Date.now() - 2000,
    reconnectAttempt: 0,
    nextReconnectAt: null,
  }));

describe('ConnectionDetails', () => {
  it('opens on click, samples each second, and closes on Escape with focus restored', () => {
    vi.useFakeTimers();
    const spy = stubMetrics(7);
    render(<ConnectionDetails />);
    const trigger = screen.getByRole('button', { name: /connection details/i });

    expect(
      screen.queryByRole('group', { name: 'Connection details' }),
    ).toBeNull();
    const callsWhileClosed = spy.mock.calls.length;

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('Sequence gaps')).toBeTruthy();

    const callsAtOpen = spy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(callsAtOpen + 3);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('group', { name: 'Connection details' }),
    ).toBeNull();
    expect(document.activeElement).toBe(trigger);

    const callsAfterClose = spy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(spy.mock.calls.length).toBe(callsAfterClose);
    expect(callsWhileClosed).toBeLessThanOrEqual(callsAtOpen);
  });

  it('closes on an outside pointer press', () => {
    stubMetrics(1);
    render(<ConnectionDetails />);
    fireEvent.click(
      screen.getByRole('button', { name: /connection details/i }),
    );
    fireEvent.pointerDown(document.body);
    expect(
      screen.queryByRole('group', { name: 'Connection details' }),
    ).toBeNull();
  });
});
