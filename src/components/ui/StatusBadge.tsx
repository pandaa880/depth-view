import { cx } from './cx';

export type StatusTone = 'live' | 'pending' | 'offline' | 'neutral';

type StatusBadgeProps = {
  status: string;
  tone?: StatusTone;
  label?: string;
  className?: string;
};

export const StatusBadge = ({
  status,
  tone = 'neutral',
  label = 'Feed',
  className,
}: StatusBadgeProps) => (
  <span
    className={cx('status-badge', className)}
    data-tone={tone}
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    <span className="status-badge-marker" aria-hidden="true" />
    <span className="status-badge-label">{label}</span>
    <span className="status-badge-value">{status}</span>
  </span>
);
