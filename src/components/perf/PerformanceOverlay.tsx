import type { RefObject } from 'react';

import { useMarketHealthStore } from '../../stores/marketHealth';
import { usePerformanceSamples } from './usePerformanceSamples';
import { usePerformanceToggle } from './usePerformanceToggle';
import './perf.css';

const MISSING = '–';

// React only reports profiler commits in development builds.
const COMMITS_AVAILABLE = import.meta.env.DEV;

type ReadoutProps = { commitsRef: RefObject<number> };

function PerformanceReadout({ commitsRef }: ReadoutProps) {
  const sample = usePerformanceSamples(commitsRef);
  const gapCount = useMarketHealthStore((state) => state.book.gapCount);

  return (
    <div className="perf" role="group" aria-label="Performance">
      <dl>
        <div>
          <dt>FPS</dt>
          <dd>{sample.fps ?? MISSING}</dd>
        </div>
        <div>
          <dt>WS msg/s</dt>
          <dd>{sample.messagesPerSecond}</dd>
        </div>
        <div>
          <dt>Book gaps</dt>
          <dd>{gapCount}</dd>
        </div>
        <div>
          <dt>Profiler commits/s</dt>
          <dd>{COMMITS_AVAILABLE ? sample.commits : MISSING}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Hidden by default; samples nothing until toggled on with Shift+P. */
export function PerformanceOverlay({ commitsRef }: ReadoutProps) {
  const visible = usePerformanceToggle();
  return visible ? <PerformanceReadout commitsRef={commitsRef} /> : null;
}
