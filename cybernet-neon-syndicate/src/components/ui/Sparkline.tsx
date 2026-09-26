import { useId } from 'react';

interface SparklineProps {
  values: number[];
  color: string;
  height?: number;
  width?: number;
  className?: string;
  label: string;
}

/** Мини-график: линия, заливка, пунктир нуля (если график его пересекает) и точка на конце. */
export function Sparkline({ values, color, height = 40, width = 240, className, label }: SparklineProps) {
  const gradientId = useId();
  const series = values.length >= 2 ? values : [values[0] ?? 0, values[0] ?? 0];
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || Math.max(1, Math.abs(max) * 0.1);
  const pad = 4;
  const x = (i: number) => (i / (series.length - 1)) * (width - pad * 2) + pad;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const line = series.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
  const last = series[series.length - 1];
  const showZero = min < 0 && max > 0;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={pad} x2={width - pad} y1={height * f} y2={height * f} stroke="rgb(148 180 220 / 0.07)" strokeWidth="1" />
      ))}
      {showZero ? (
        <line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} stroke="#ff4d6d" strokeOpacity="0.55" strokeDasharray="3 3" strokeWidth="1" />
      ) : null}
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(series.length - 1)} cy={y(last)} r="2.6" fill={color} />
      <circle cx={x(series.length - 1)} cy={y(last)} r="5" fill={color} fillOpacity="0.2" />
    </svg>
  );
}
