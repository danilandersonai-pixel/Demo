import { CircleDot, Magnet, Shield, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react';
import type { SkinPerks } from '../../game/types';
import { formatBonus } from './shared';

interface Chip {
  key: string;
  icon: LucideIcon;
  text: string;
  tone: string;
}

// Полные строки классов — чтобы Tailwind их увидел при сборке.
const TONE = {
  trail: 'border-neon-pink/45 bg-neon-pink/10 text-neon-pink',
  shield: 'border-neon-violet/50 bg-neon-violet/10 text-[#c9a8ff]',
  magnet: 'border-neon-yellow/45 bg-neon-yellow/10 text-neon-yellow',
  score: 'border-neon-green/45 bg-neon-green/10 text-neon-green',
  none: 'border-white/10 bg-white/[0.03] text-ink-faint',
} as const;

function chipsFor(perks: SkinPerks): Chip[] {
  const chips: Chip[] = [];
  if (perks.trail) chips.push({ key: 'trail', icon: Sparkles, text: 'Шлейф', tone: TONE.trail });
  if (perks.shieldCharges > 0)
    chips.push({ key: 'shield', icon: Shield, text: `Щит ×${perks.shieldCharges}`, tone: TONE.shield });
  if (perks.magnet) chips.push({ key: 'magnet', icon: Magnet, text: 'Магнит', tone: TONE.magnet });
  if (perks.scoreBonus > 0)
    chips.push({ key: 'score', icon: TrendingUp, text: `${formatBonus(perks.scoreBonus)} очков`, tone: TONE.score });
  if (chips.length === 0) chips.push({ key: 'none', icon: CircleDot, text: 'Без перков', tone: TONE.none });
  return chips;
}

/** Перки корабля значками: «Шлейф», «Щит ×1», «Магнит», «+10 % очков». */
export function PerkChips({ perks, className = '' }: { perks: SkinPerks; className?: string }) {
  return (
    <ul className={['flex flex-wrap gap-1.5', className].join(' ')} aria-label="Перки">
      {chipsFor(perks).map(({ key, icon: Icon, text, tone }) => (
        <li
          key={key}
          className={[
            'inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
            tone,
          ].join(' ')}
        >
          <Icon size={11} strokeWidth={2.5} aria-hidden />
          {text}
        </li>
      ))}
    </ul>
  );
}
