import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clamp } from '../../game/utils';

export type BarTone = 'hp' | 'xp' | 'gold' | 'cyber';

const TONES: Record<BarTone, { fill: string; glow: string; track: string; label: string; delta: string }> = {
  hp: {
    fill: 'bg-gradient-to-r from-red-500 to-rose-600',
    glow: 'drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]',
    track: 'bg-red-950/40 border-red-500/15',
    label: 'text-red-400',
    delta: 'text-red-300',
  },
  xp: {
    fill: 'bg-gradient-to-r from-fuchsia-500 via-purple-600 to-indigo-600',
    glow: 'drop-shadow-[0_0_8px_rgba(192,38,211,0.55)]',
    track: 'bg-indigo-950/40 border-purple-500/15',
    label: 'text-fuchsia-400',
    delta: 'text-fuchsia-300',
  },
  gold: {
    fill: 'bg-gradient-to-r from-amber-400 to-orange-500',
    glow: 'drop-shadow-[0_0_8px_rgba(251,146,60,0.5)]',
    track: 'bg-amber-950/40 border-amber-500/15',
    label: 'text-amber-400',
    delta: 'text-amber-300',
  },
  cyber: {
    fill: 'bg-gradient-to-r from-cyan-400 to-sky-600',
    glow: 'drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]',
    track: 'bg-cyan-950/40 border-cyan-500/15',
    label: 'text-cyan-400',
    delta: 'text-cyan-300',
  },
};

const HEIGHTS = { sm: 'h-1.5', md: 'h-2', lg: 'h-3.5' };

interface NeonBarProps {
  value: number;
  max: number;
  tone: BarTone;
  label?: string;
  icon?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Подпись справа; по умолчанию «value / max». */
  valueText?: string;
  /** Доля, ниже которой полоса пульсирует (для HP — 0.3). */
  warnBelow?: number;
}

interface Gain {
  id: number;
  from: number;
  to: number;
  delta: number;
}

/**
 * Неоновый индикатор. При росте значения сначала вспыхивает «призрачный» сегмент прибавки,
 * затем основная заливка мягко наплывает на него. При низком значении полоса пульсирует.
 */
export function NeonBar({ value, max, tone, label, icon, size = 'md', valueText, warnBelow }: NeonBarProps) {
  const reduceMotion = useReducedMotion();
  const pctOf = (v: number) => (max > 0 ? clamp((v / max) * 100, 0, 100) : 0);
  const pct = pctOf(value);
  const colors = TONES[tone];
  const warning = warnBelow !== undefined && pct <= warnBelow * 100;

  const prev = useRef({ value, max });
  const [gain, setGain] = useState<Gain | null>(null);

  useEffect(() => {
    const before = prev.current;
    if (before.max === max && value > before.value) {
      setGain({ id: Date.now(), from: pctOf(before.value), to: pctOf(value), delta: value - before.value });
    }
    prev.current = { value, max };
    // pctOf зависит только от max, который уже есть в зависимостях.
  }, [value, max]);

  useEffect(() => {
    if (!gain) return;
    const timer = window.setTimeout(() => setGain(null), 1500);
    return () => window.clearTimeout(timer);
  }, [gain]);

  return (
    <div className="w-full">
      {(label || icon) && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
          <span className={`flex items-center gap-1.5 font-mono font-bold tracking-[0.2em] uppercase ${colors.label}`}>
            {icon}
            {label}
          </span>
          <span className="relative flex items-center gap-2 font-mono tracking-wider text-slate-300 tabular-nums">
            <AnimatePresence>
              {gain && (
                <motion.span
                  key={gain.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.35 }}
                  className={`font-bold ${colors.delta}`}
                >
                  +{Math.round(gain.delta)}
                </motion.span>
              )}
            </AnimatePresence>
            <span className={warning ? 'animate-pulse-soft text-red-300' : ''}>{valueText ?? `${Math.round(value)} / ${max}`}</span>
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
        {/* Сегмент прибавки: вспыхивает раньше основной заливки. */}
        <AnimatePresence>
          {gain && (
            <motion.div
              key={gain.id}
              className="absolute inset-y-0 rounded-full bg-white/50"
              style={{ left: `${gain.from}%`, width: `${Math.max(0, gain.to - gain.from)}%` }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.9, 0.35] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9 }}
            />
          )}
        </AnimatePresence>

        <motion.div
          className={`relative h-full rounded-full ${colors.fill} ${colors.glow}`}
          initial={false}
          animate={{
            width: `${pct}%`,
            opacity: warning && !reduceMotion ? [1, 0.55, 1] : 1,
          }}
          transition={{
            width: { type: 'spring', stiffness: 90, damping: 20, delay: gain ? 0.18 : 0 },
            opacity: warning ? { duration: 1.3, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 },
          }}
        >
          <span className="absolute inset-0 overflow-hidden rounded-full">
            <span className="absolute inset-y-0 w-1/4 animate-shimmer bg-gradient-to-r from-transparent via-white/35 to-transparent" />
          </span>
          <span className="absolute inset-x-0 top-0 h-1/2 rounded-full bg-white/15" />
        </motion.div>
      </div>
    </div>
  );
}
