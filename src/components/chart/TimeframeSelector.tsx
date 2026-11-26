import {
  KLINE_TIMEFRAMES,
  type KlineTimeframe,
} from '../../lib/indicators/klines';

interface TimeframeSelectorProps {
  value: KlineTimeframe;
  onChange: (value: KlineTimeframe) => void;
}

export function TimeframeSelector({ value, onChange }: TimeframeSelectorProps) {
  return (
    <div
      role="group"
      aria-label="Chart timeframe"
      className="flex items-center gap-0.5 rounded-md border border-border bg-[rgba(30,35,50,0.35)] p-0.5"
    >
      {KLINE_TIMEFRAMES.map((timeframe) => {
        const isActive = timeframe === value;

        return (
          <button
            key={timeframe}
            type="button"
            aria-pressed={isActive}
            aria-label={`Show ${timeframe} candles`}
            onClick={() => onChange(timeframe)}
            className={`min-w-8 rounded px-1.5 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors focus-visible:ring-1 focus-visible:ring-foreground/40 focus-visible:outline-none ${
              isActive
                ? 'bg-border text-foreground'
                : 'text-muted hover:bg-white/5 hover:text-foreground'
            }`}
          >
            {timeframe}
          </button>
        );
      })}
    </div>
  );
}
