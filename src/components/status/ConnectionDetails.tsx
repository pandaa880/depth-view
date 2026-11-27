import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from 'react';

import { useWsStatus } from '../../hooks/useWsStatus';
import { useMarketHealthStore } from '../../stores/marketHealth';
import { cx } from '../ui/cx';
import { getStatusTone } from './connectionTone';
import { useConnectionSample } from './useConnectionSample';
import './status.css';

const MISSING = '–';

const formatClock = (timestamp: number | null): string =>
  timestamp === null
    ? MISSING
    : new Date(timestamp).toLocaleTimeString([], { hour12: false });

const formatAge = (timestamp: number | null, now: number): string =>
  timestamp === null
    ? MISSING
    : `${Math.max(0, Math.floor((now - timestamp) / 1000))}s ago`;

const formatCountdown = (target: number | null, now: number): string =>
  target === null
    ? MISSING
    : `${Math.max(0, Math.ceil((target - now) / 1000))}s`;

type DetailRowProps = { label: string; value: string };

const DetailRow = ({ label, value }: DetailRowProps) => (
  <div className="conn-row">
    <dt>{label}</dt>
    <dd className="numeric">{value}</dd>
  </div>
);

function useDismiss(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onOutside: () => void,
  onEscape: () => void,
): void {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onOutside();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, containerRef, onOutside, onEscape]);
}

type ConnectionDetailsProps = { className?: string };

export function ConnectionDetails({ className }: ConnectionDetailsProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const { status, reconnectAttempt, nextReconnectAt } = useWsStatus();
  const gapCount = useMarketHealthStore((state) => state.book.gapCount);
  const sample = useConnectionSample(open);

  const closeQuietly = useCallback(() => setOpen(false), []);
  const closeAndRefocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  useDismiss(open, containerRef, closeQuietly, closeAndRefocus);

  return (
    <div ref={containerRef} className={cx('conn', className)}>
      <button
        ref={triggerRef}
        type="button"
        className="status-badge conn-trigger"
        data-tone={getStatusTone(status)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Feed ${status}. Connection details`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="status-badge-marker" aria-hidden="true" />
        <span className="status-badge-label">Feed</span>
        <span className="status-badge-value">{status}</span>
      </button>

      {open && (
        <div
          id={panelId}
          className="conn-popover"
          role="group"
          aria-label="Connection details"
        >
          <dl className="conn-list">
            <DetailRow
              label="Messages / sec"
              value={
                sample ? String(sample.metrics.messagesPerSecond) : MISSING
              }
            />
            <DetailRow
              label="Last message"
              value={
                sample
                  ? `${formatClock(sample.metrics.lastMessageAt)} (${formatAge(sample.metrics.lastMessageAt, sample.now)})`
                  : MISSING
              }
            />
            <DetailRow label="Sequence gaps" value={String(gapCount)} />
            <DetailRow
              label="Reconnect attempt"
              value={String(reconnectAttempt)}
            />
            {nextReconnectAt !== null && (
              <DetailRow
                label="Next reconnect"
                value={formatCountdown(
                  nextReconnectAt,
                  sample?.now ?? Date.now(),
                )}
              />
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
