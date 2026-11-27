import { useEffect, useRef, useState, type RefObject } from 'react';

import { wsManager } from '../../lib/binance/BinanceWebSocket';

const SAMPLE_INTERVAL_MS = 1000;

export interface PerformanceSample {
  fps: number | null;
  messagesPerSecond: number;
  commits: number;
}

const INITIAL_SAMPLE: PerformanceSample = {
  fps: null,
  messagesPerSecond: 0,
  commits: 0,
};

/**
 * Counts animation frames and samples once per second. Frames are
 * ignored while the tab is hidden so a paused tab never skews the value.
 * Only call this while the overlay is visible: all work stops on cleanup.
 */
export function usePerformanceSamples(
  commitsRef: RefObject<number>,
): PerformanceSample {
  const [sample, setSample] = useState<PerformanceSample>(INITIAL_SAMPLE);
  const frames = useRef(0);

  useEffect(() => {
    let frameId = 0;
    let windowStart = performance.now();
    let previousCommits = commitsRef.current;

    const resetWindow = () => {
      frames.current = 0;
      windowStart = performance.now();
    };
    const countFrame = () => {
      frames.current += 1;
      frameId = requestAnimationFrame(countFrame);
    };
    const takeSample = () => {
      const now = performance.now();
      if (document.hidden) {
        resetWindow();
        return;
      }
      const commits = commitsRef.current;
      setSample({
        fps: Math.round(
          (frames.current * 1000) / Math.max(1, now - windowStart),
        ),
        messagesPerSecond: wsManager.getConnectionMetrics().messagesPerSecond,
        commits: commits - previousCommits,
      });
      previousCommits = commits;
      resetWindow();
    };

    document.addEventListener('visibilitychange', resetWindow);
    frameId = requestAnimationFrame(countFrame);
    const timer = setInterval(takeSample, SAMPLE_INTERVAL_MS);

    return () => {
      cancelAnimationFrame(frameId);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resetWindow);
    };
  }, [commitsRef]);

  return sample;
}
