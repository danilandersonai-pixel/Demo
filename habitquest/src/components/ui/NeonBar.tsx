import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { clamp } from '../../game/utils';

export type BarTone = 'hp' | 'xp' | 'gold' | 'cyber';

const TONES: Record<BarTone, { fill: string; glow: string; track: string; text: string }> = {
  hp: {
    fill: 'from-rose-600 via-rose-500 to-pink-400',
    glow: 'shadow-[0_0_16px_rgba(255,59,92,0.75)]',
    track: 'bg-rose-950/60 border-rose-500/25',
    text: 'text-rose-300 neon-hp',
  },
  xp: {
    fill: 'from-violet-700 via-violet-500 to-fuchsia-400',
    glow: 'shadow-[0_0_16px_rgba(168,85,247,0.8)]',
    track: 'bg-violet-950/60 border-violet-500/25',
    text: 'text-violet-300 neon-xp',
  },
  gold: {
    fill: 'from-amber-600 via-amber-400 to-yellow-300',
    glow: 'shadow-[0_0_16px_rgba(251,191,36,0.75)]',
    track: 'bg-amber-950/60 border-amber-500/25',
    text: 'text-amber-300 neon-gold',
  },
  cyber: {
    fill: 'from-cyan-600 via-cyan-400 to-sky-300',
    glow: 'shadow-[0_0_16px_rgba(34,211,238,0.75)]',
    track: 'bg-cyan-950/60 border-cyan-500/25',
    text: 'text-cyan-300 neon-cyber',
  },
};

interface NeonBarProps {
  value: number;
  max: number;
  tone: BarTone;
  label?: string;
  icon?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Подпись справа; по умолчанию «value / max». */
  valueText?: string;
  /** Мигать, когда значение критически мало (для HP). */
  warnBelow?: number;
}

const HEIGHTS = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-4' };

export function NeonBar({ value, max, tone, label, icon, size = 'md', valueText, warnBelow }: NeonBarProps) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
  const colors = TONES[tone];
  const warning = warnBelow !== undefined && pct <= warnBelow * 100;

  return (
    <div className="w-full">
      {(label || icon) && (
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span className={`flex items-center gap-1.5 font-display tracking-wider uppercase ${colors.text}`}>
            {icon}
            {label}
          </span>
          <span className={`font-mono tabular-nums ${warning ? 'animate-pulse-soft text-rose-300' : 'text-violet-100/80'}`}>
            {valueText ?? `${Math.round(value)} / ${max}`}
          </span>
        </div>
      )}
      <div
        className={`relative w-full overflow-hidden rounded-full border ${colors.track} ${HEIGHTS[size]}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(value)}
      >
        <motion.div
          className={`relative h-full rounded-full bg-gradient-to-r ${colors.fill} ${colors.glow}`}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        >
          <span className="absolute inset-0 overflow-hidden rounded-full">
            <span className="absolute inset-y-0 w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          </span>
        </motion.div>
      </div>
    </div>
  );
}
