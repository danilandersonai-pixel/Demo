import { Gem } from 'lucide-react';
import { formatNumber } from './format';

const SIZE = {
  sm: { text: 'text-xs', icon: 13, gap: 'gap-1' },
  md: { text: 'text-sm sm:text-base', icon: 16, gap: 'gap-1.5' },
  lg: { text: 'text-xl sm:text-2xl', icon: 22, gap: 'gap-2' },
} as const;

export interface CrystalCountProps {
  value: number;
  size?: keyof typeof SIZE;
  /** Показать со знаком «+» (заработано за забег). */
  signed?: boolean;
  className?: string;
}

/** Кристаллы — валюта магазина: иконка-кристалл и число. */
export function CrystalCount({ value, size = 'md', signed = false, className = '' }: CrystalCountProps) {
  const s = SIZE[size];
  return (
    <span
      className={['inline-flex items-center font-mono font-bold tabular-nums text-neon-cyan text-glow-cyan', s.gap, s.text, className].join(' ')}
      aria-label={`${signed ? 'плюс ' : ''}${value} кристаллов`}
    >
      <Gem size={s.icon} strokeWidth={2.25} aria-hidden />
      <span>
        {signed ? '+' : ''}
        {formatNumber(value)}
      </span>
    </span>
  );
}
