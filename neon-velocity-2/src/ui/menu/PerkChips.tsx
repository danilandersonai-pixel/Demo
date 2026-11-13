import { Magnet, Shield, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react';
import type { Skin } from '../../core/types';
import { formatBonus } from './shared';

interface Perk {
  key: string;
  icon: LucideIcon;
  label: string;
  /** Полные строки классов — чтобы Tailwind увидел их при сборке. */
  tone: string;
}

/** Перки корабля в порядке «что видно в забеге»: шлейф, щит, магнит, бонус. */
function perksOf(skin: Skin): Perk[] {
  const p = skin.perks;
  const perks: Perk[] = [];
  if (p.trail) perks.push({ key: 'trail', icon: Sparkles, label: 'Шлейф', tone: 'border-neon-pink/45 text-neon-pink' });
  if (p.shieldCharges > 0) {
    perks.push({ key: 'shield', icon: Shield, label: `Щит ×${p.shieldCharges}`, tone: 'border-neon-violet/55 text-[#c4b5fd]' });
  }
  if (p.magnet) perks.push({ key: 'magnet', icon: Magnet, label: 'Магнит', tone: 'border-neon-yellow/45 text-neon-yellow' });
  if (p.scoreBonus > 0) {
    perks.push({ key: 'bonus', icon: TrendingUp, label: `${formatBonus(p.scoreBonus)} очков`, tone: 'border-neon-green/45 text-neon-green' });
  }
  return perks;
}

export interface PerkChipsProps {
  skin: Skin;
  /** Только значки (узкая плашка снаряжения); подписи остаются скринридеру. */
  compact?: boolean;
  className?: string;
}

/** Чипы перков корабля. У корабля без систем — честная приглушённая пометка. */
export function PerkChips({ skin, compact = false, className = '' }: PerkChipsProps) {
  const perks = perksOf(skin);
  if (perks.length === 0) {
    return compact ? null : (
      <ul className={['flex flex-wrap gap-1.5', className].join(' ')}>
        <li className="rounded-[2px] border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink-faint">Без систем</li>
      </ul>
    );
  }
  return (
    <ul className={['flex flex-wrap', compact ? 'gap-1' : 'gap-1.5', className].join(' ')}>
      {perks.map(({ key, icon: Icon, label, tone }) => (
        <li
          key={key}
          className={[
            'inline-flex items-center gap-1 rounded-[2px] border bg-void/60 font-semibold tracking-wide',
            compact ? 'h-5 w-5 justify-center' : 'px-1.5 py-0.5 text-[10px]',
            tone,
          ].join(' ')}
        >
          <Icon size={11} strokeWidth={2.4} className="shrink-0" aria-hidden />
          <span className={compact ? 'sr-only' : 'whitespace-nowrap'}>{label}</span>
        </li>
      ))}
    </ul>
  );
}
