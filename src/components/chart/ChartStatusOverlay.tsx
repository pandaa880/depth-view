import type { KlinesStatus } from '../../hooks/useKlines';

interface ChartStatusOverlayProps {
  status: KlinesStatus;
  error: string | null;
  onRetry: () => void;
}

const LOADING_BARS = [10, 18, 8, 22, 13];

export function ChartStatusOverlay({
  status,
  error,
  onRetry,
}: ChartStatusOverlayProps) {
  if (status === 'ready') return null;

  if (status === 'resyncing') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded border border-border bg-background/80 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted"
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-connection-in-progress motion-safe:animate-pulse"
        />
        Resyncing candles
      </div>
    );
  }

  const isError = status === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/60 px-6 text-center"
    >
      {status === 'loading' && (
        <>
          <div className="flex items-end gap-1" aria-hidden="true">
            {LOADING_BARS.map((height, index) => (
              <span
                key={index}
                className="w-1 rounded-sm bg-muted/40 motion-safe:animate-pulse"
                style={{ height }}
              />
            ))}
          </div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted">
            Loading candles
          </p>
        </>
      )}

      {status === 'empty' && (
        <p className="text-xs text-muted">
          No candle data is available for this market yet.
        </p>
      )}

      {isError && (
        <>
          <p className="text-xs text-foreground">Unable to load candles.</p>
          {error && (
            <p
              className="max-w-sm truncate text-[10px] text-muted"
              title={error}
            >
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-border px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted transition-colors hover:border-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-foreground/40 focus-visible:outline-none"
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}
