import { motion } from 'framer-motion';
import { cn } from './cn.ts';

interface MeterProps {
  value: number;
  max: number;
  color: string;
  className?: string;
  label: string;
  segments?: number;
}

/** Полоса заполнения с делениями — для хранилищ и нагрузки сети. */
export function Meter({ value, max, color, className, label, segments = 20 }: MeterProps) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Number(max.toFixed(2))}
      aria-valuenow={Number(Math.min(value, max).toFixed(2))}
      aria-valuetext={`${Math.round(ratio * 100)}%`}
      className={cn('relative h-2 overflow-hidden bg-white/[0.05]', className)}
    >
      <motion.div
        className="absolute inset-y-0 left-0"
        style={{ background: color, boxShadow: `0 0 12px ${color}` }}
        initial={false}
        animate={{ width: `${ratio * 100}%` }}
        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `repeating-linear-gradient(90deg, transparent 0 calc(${100 / segments}% - 1px), rgb(9 10 15 / 0.85) calc(${100 / segments}% - 1px) ${100 / segments}%)`,
        }}
      />
    </div>
  );
}
