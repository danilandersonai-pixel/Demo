import { motion } from 'framer-motion';
import { Star } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { ALL_DAYS, DIFFICULTY_META, DIFFICULTY_ORDER, STAT_META, STAT_ORDER, WEEKDAYS_SHORT } from '../../game/constants';
import { STAT_COLORS, STAT_ICONS } from '../../game/icons';
import type { Difficulty, StatKey } from '../../types';

/** Переключатель-«тумблер» с пружинной анимацией. */
export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-sm font-semibold text-violet-50">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-violet-200/55">{hint}</span>}
      </label>
      <motion.button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        whileTap={{ scale: 0.9 }}
        className={`focus-ring relative h-7 w-12 shrink-0 cursor-pointer rounded-full border transition-colors duration-300 ${
          checked ? 'border-cyan-300/60 bg-cyan-500/40 shadow-[0_0_16px_rgba(34,211,238,0.6)]' : 'border-violet-400/25 bg-white/5'
        }`}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 700, damping: 32 }}
          className={`absolute top-1 h-[18px] w-[18px] rounded-full ${checked ? 'right-1 bg-cyan-100' : 'left-1 bg-violet-300/70'}`}
        />
      </motion.button>
    </div>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

/** Сегментный переключатель с «плавающей» подсветкой активного пункта. */
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
    <div role="radiogroup" aria-label={ariaLabel} className="flex w-full gap-1 rounded-xl border border-violet-400/20 bg-black/30 p-1">
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
            className={`focus-ring relative flex-1 cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold tracking-wide transition-colors sm:text-sm ${
              active ? 'text-white' : 'text-violet-200/60 hover:text-violet-100'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${groupId}`}
                className="absolute inset-0 rounded-lg border border-violet-300/40 bg-gradient-to-r from-violet-600/60 to-fuchsia-600/50 shadow-[0_0_18px_-4px_rgba(168,85,247,0.8)]"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
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
          size={11}
          className={i <= stars ? 'fill-amber-300 text-amber-300 drop-shadow-[0_0_4px_rgba(251,191,36,0.8)]' : 'text-violet-300/25'}
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
            whileTap={{ scale: 0.94 }}
            className={`focus-ring flex cursor-pointer flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-semibold transition-colors ${
              active ? `${colors.soft} ${colors.text} ${colors.glow}` : 'border-violet-400/15 bg-white/[0.03] text-violet-200/55 hover:text-violet-100'
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
            whileTap={{ scale: 0.88 }}
            className={`focus-ring h-9 w-10 cursor-pointer rounded-lg border text-xs font-bold transition-all ${
              active
                ? 'border-violet-300/60 bg-violet-500/35 text-white shadow-[0_0_12px_-2px_rgba(168,85,247,0.8)]'
                : 'border-violet-400/15 bg-white/[0.03] text-violet-200/45 hover:text-violet-100'
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
    <label htmlFor={htmlFor} className="mb-1.5 block font-display text-[11px] tracking-[0.18em] text-violet-200/60 uppercase">
      {children}
    </label>
  );
}
