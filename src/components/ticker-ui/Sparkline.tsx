// map price history from mini ticker stream to x,y points to draw the line
const buildPoints = (history: number[]): string => {
  if (history.length < 2) return '';

  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;

  return history.map((price, i) => {
    const x = (i / (history.length - 1)) * 60;
    const y = 18 - ((price - min) / range) * 18; // invert Y
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ')
}

type SparklineProps = {
  history: number[],
  color: string
}

export const Sparkline = (props: SparklineProps) => {
  const points = buildPoints(props.history);

  if (!points) return <div style={{ height: 18 }} />;

  return (
    <svg width="100%" height="18" viewBox="0 0 60 18">
      <polyline
        points={points}
        fill="none"
        stroke={props.color}
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

