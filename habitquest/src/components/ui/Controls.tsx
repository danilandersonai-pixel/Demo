import { motion } from 'framer-motion';
import { Star } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { ALL_DAYS, DIFFICULTY_META, DIFFICULTY_ORDER, STAT_META, STAT_ORDER, WEEKDAYS_SHORT } from '../../game/constants';
import { STAT_COLORS, STAT_ICONS } from '../../game/icons';
import type { Difficulty, StatKey } from '../../types';

/** Переключатель-«тумблер» с пружинной анимацией и неоновым свечением во включённом состоянии. */
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-sm font-semibold text-slate-100">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
      </label>
      <motion.button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        whileTap={{ scale: 0.9 }}
        className={`focus-ring relative h-7 w-12 shrink-0 cursor-pointer rounded-full border transition-[background-color,border-color,box-shadow] duration-300 ${
          checked ? 'border-cyan-300/50 bg-cyan-400/30 shadow-[0_0_18px_-2px_rgba(34,211,238,0.7)]' : 'border-white/[0.1] bg-white/[0.04]'
        }`}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 700, damping: 32 }}
          className={`absolute top-1 h-[18px] w-[18px] rounded-full ${
            checked ? 'right-1 bg-cyan-100 shadow-[0_0_10px_rgba(34,211,238,1)]' : 'left-1 bg-slate-400'
          }`}
        />
      </motion.button>
    </div>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

/** Сегментный переключатель с «плавающей» неоновой подсветкой активного пункта. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const groupId = useId();
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex w-full gap-1 rounded-xl border border-white/[0.08] bg-black/20 p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <motion.button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            whileTap={{ scale: 0.95 }}
            className={`focus-ring relative flex-1 cursor-pointer rounded-lg px-2.5 py-2 text-xs font-semibold tracking-wide transition-colors duration-300 sm:text-[13px] ${
              active ? 'text-white' : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${groupId}`}
                className="absolute inset-0 rounded-lg border border-white/[0.14] bg-gradient-to-r from-fuchsia-500/35 via-purple-600/30 to-indigo-600/35 shadow-[0_0_20px_-6px_rgba(192,38,211,0.9)]"
                transition={{ type: 'spring', stiffness: 500, damping: 36 }}
              />
            )}
            <span className="relative z-10 flex items-center justify-center gap-1.5">{option.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

export function DifficultyStars({ difficulty, className = '' }: { difficulty: Difficulty; className?: string }) {
  const { stars, label } = DIFFICULTY_META[difficulty];
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} title={`Сложность: ${label}`} aria-label={`Сложность: ${label}`}>
      {[1, 2, 3].map((i) => (
        <Star
          key={i}
          size={10}
          className={i <= stars ? 'fill-amber-300 text-amber-300 drop-shadow-[0_0_4px_rgba(251,191,36,0.8)]' : 'text-slate-600'}
        />
      ))}
    </span>
  );
}

export function DifficultyPicker({ value, onChange }: { value: Difficulty; onChange: (value: Difficulty) => void }) {
  return (
    <Segmented
      ariaLabel="Сложность"
      value={value}
      onChange={onChange}
      options={DIFFICULTY_ORDER.map((d) => ({
        value: d,
        label: (
          <>
            <DifficultyStars difficulty={d} />
            {DIFFICULTY_META[d].label}
          </>
        ),
      }))}
    />
  );
}

export function StatPicker({ value, onChange }: { value: StatKey; onChange: (value: StatKey) => void }) {
  return (
    <div role="radiogroup" aria-label="Характеристика" className="grid grid-cols-3 gap-2">
      {STAT_ORDER.map((stat) => {
        const Icon = STAT_ICONS[stat];
        const active = stat === value;
        const colors = STAT_COLORS[stat];
        return (
          <motion.button
            key={stat}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(stat)}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.95 }}
            className={`focus-ring flex cursor-pointer flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-semibold transition-[background-color,border-color,color,box-shadow] duration-300 ${
              active ? `${colors.soft} ${colors.text} ${colors.glow}` : 'border-white/[0.08] bg-white/[0.02] text-slate-400 hover:border-white/[0.18] hover:text-slate-100'
            }`}
          >
            <Icon size={18} />
            {STAT_META[stat].label}
          </motion.button>
        );
      })}
    </div>
  );
}

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (value: number[]) => void }) {
  const toggle = (day: number) => {
    const next = value.includes(day) ? value.filter((d) => d !== day) : [...value, day];
    onChange(next.sort((a, b) => a - b));
  };
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Дни недели">
      {ALL_DAYS.map((day) => {
        const active = value.includes(day);
        return (
          <motion.button
            key={day}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(day)}
            whileTap={{ scale: 0.9 }}
            className={`focus-ring h-9 w-10 cursor-pointer rounded-lg border font-mono text-[11px] font-bold tracking-wider transition-[background-color,border-color,color,box-shadow] duration-300 ${
              active
                ? 'border-fuchsia-400/50 bg-fuchsia-500/20 text-white shadow-[0_0_14px_-3px_rgba(217,70,239,0.85)]'
                : 'border-white/[0.08] bg-white/[0.02] text-slate-500 hover:text-slate-200'
            }`}
          >
            {WEEKDAYS_SHORT[day]}
          </motion.button>
        );
      })}
    </div>
  );
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block font-mono text-[10px] font-bold tracking-[0.22em] text-slate-400 uppercase">
      {children}
    </label>
  );
}
