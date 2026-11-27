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
import { PerformanceOverlay } from './PerformanceOverlay';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const press = (init: KeyboardEventInit, target: Window | Element = window) =>
  fireEvent.keyDown(target, { key: 'P', shiftKey: true, ...init });

function setup() {
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  const caf = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation(() => {});
  const metrics = vi.spyOn(wsManager, 'getConnectionMetrics');
  render(<PerformanceOverlay commitsRef={{ current: 0 }} />);
  return { raf, caf, metrics };
}

describe('PerformanceOverlay', () => {
  it('is hidden and measures nothing until Shift+P', () => {
    vi.useFakeTimers();
    const { raf, metrics } = setup();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByLabelText('Performance')).toBeNull();
    expect(raf).not.toHaveBeenCalled();
    expect(metrics).not.toHaveBeenCalled();

    press({});
    expect(screen.getByLabelText('Performance')).toBeTruthy();
    expect(raf).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(metrics).toHaveBeenCalled();
  });

  it('cancels frame sampling and timers when hidden again', () => {
    vi.useFakeTimers();
    const { caf, metrics } = setup();

    press({});
    press({});
    expect(screen.queryByLabelText('Performance')).toBeNull();
    expect(caf).toHaveBeenCalled();

    metrics.mockClear();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(metrics).not.toHaveBeenCalled();
  });

  it('ignores editable targets, repeats, composition and modifiers', () => {
    setup();
    const input = document.createElement('input');
    document.body.appendChild(input);

    press({}, input);
    press({ repeat: true });
    press({ isComposing: true });
    press({ ctrlKey: true });
    press({ shiftKey: false });

    expect(screen.queryByLabelText('Performance')).toBeNull();
    input.remove();
  });
});
