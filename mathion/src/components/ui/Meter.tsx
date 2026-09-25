import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { clamp } from '../../game/utils';

export type MeterTone = 'hp' | 'mana' | 'xp' | 'shield' | 'enemy' | 'time' | 'danger';

const TONES: Record<MeterTone, { fill: string; glow: string; label: string }> = {
  hp: { fill: 'from-red-500 to-rose-700', glow: 'shadow-[0_0_10px_rgba(239,68,68,0.7)]', label: 'text-red-300' },
  mana: { fill: 'from-sky-400 to-indigo-600', glow: 'shadow-[0_0_10px_rgba(56,189,248,0.7)]', label: 'text-sky-300' },
  xp: { fill: 'from-amber-300 to-amber-600', glow: 'shadow-[0_0_10px_rgba(240,200,114,0.7)]', label: 'text-amber-300' },
  shield: { fill: 'from-cyan-200 to-cyan-500', glow: 'shadow-[0_0_10px_rgba(103,232,249,0.7)]', label: 'text-cyan-200' },
  enemy: { fill: 'from-fuchsia-500 to-purple-700', glow: 'shadow-[0_0_10px_rgba(192,38,211,0.7)]', label: 'text-fuchsia-300' },
  time: { fill: 'from-emerald-300 to-emerald-600', glow: 'shadow-[0_0_10px_rgba(52,211,153,0.7)]', label: 'text-emerald-300' },
  danger: { fill: 'from-orange-400 to-red-600', glow: 'shadow-[0_0_12px_rgba(249,115,22,0.8)]', label: 'text-orange-300' },
};

const HEIGHTS = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-3.5' };

interface MeterProps {
  value: number;
  max: number;
  tone: MeterTone;
  label?: string;
  icon?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  valueText?: string;
  /** Без пружины — для таймера, который обновляется 10 раз в секунду. */
  linear?: boolean;
}

/** Шкала в латунной оправе: HP, мана, опыт, щит, таймер. */
export function Meter({ value, max, tone, label, icon, size = 'md', valueText, linear = false }: MeterProps) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
  const colors = TONES[tone];
  return (
    <div className="w-full">
      {(label || icon || valueText) && (
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span className={`flex items-center gap-1.5 font-display font-bold tracking-wider uppercase ${colors.label}`}>
            {icon}
            {label}
          </span>
          <span className="font-mono text-[11px] text-amber-100/80 tabular-nums">{valueText ?? `${Math.round(value)} / ${max}`}</span>
        </div>
      )}
      <div
        className={`relative overflow-hidden rounded-full border border-amber-700/40 bg-black/50 ${HEIGHTS[size]}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(value)}
      >
        <motion.div
          className={`h-full rounded-full bg-gradient-to-r ${colors.fill} ${colors.glow}`}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={linear ? { duration: 0.1, ease: 'linear' } : { type: 'spring', stiffness: 110, damping: 20 }}
        />
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-full bg-white/10" />
      </div>
    </div>
  );
}
