import { Gem } from 'lucide-react';
import { formatNumber, plural } from './format';

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

/**
 * Кристаллы — валюта магазина: иконка-кристалл и число. Скринридер читает не
 * «+4», а sr-only подпись со склонением: «плюс 4 кристалла». Не aria-label:
 * у span без роли ARIA имя запрещает, и скринридер читает текст внутри.
 */
export function CrystalCount({ value, size = 'md', signed = false, className = '' }: CrystalCountProps) {
  const s = SIZE[size];
  const spoken = `${signed ? 'плюс ' : ''}${formatNumber(value)} ${plural(value, ['кристалл', 'кристалла', 'кристаллов'])}`;
  return (
    <span
      className={['inline-flex items-center font-mono font-bold tabular-nums text-neon-cyan text-glow-cyan', s.gap, s.text, className].join(' ')}
    >
      <Gem size={s.icon} strokeWidth={2.25} aria-hidden />
      <span aria-hidden>
        {signed ? '+' : ''}
        {formatNumber(value)}
      </span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
