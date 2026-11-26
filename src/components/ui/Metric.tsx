import type { ReactNode } from 'react';

import { cx } from './cx';

export type MarketTone = 'neutral' | 'up' | 'down' | 'flat';

type MetricProps = {
  label: ReactNode;
  value: ReactNode;
  tone?: MarketTone;
  className?: string;
};

export const Metric = ({
  label,
  value,
  tone = 'neutral',
  className,
}: MetricProps) => (
  <div
    className={cx('metric', className)}
    data-up={tone === 'up' || undefined}
    data-down={tone === 'down' || undefined}
    data-flat={tone === 'flat' || undefined}
  >
    <span className="metric-label">{label}</span>
    <span className="metric-value numeric">{value}</span>
  </div>
);
