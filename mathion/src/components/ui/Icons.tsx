import {
  Anvil,
  Axe,
  Biohazard,
  Bird,
  Bomb,
  BookOpen,
  Bot,
  Brain,
  Bug,
  Crown,
  Droplets,
  Eye,
  Flame,
  FlaskRound,
  Gem,
  Ghost,
  Glasses,
  Heart,
  Hexagon,
  Hourglass,
  Mountain,
  Orbit,
  Rat,
  Shield,
  Skull,
  Snail,
  Snowflake,
  Sparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { ELEMENT_META } from '../../game/constants';
import type { Element, EnemyIconId, Essences, PotionId, SpellId, UpgradeId } from '../../types';

export const ELEMENT_ICONS: Record<Element, LucideIcon> = {
  earth: Mountain,
  fire: Flame,
  water: Droplets,
  void: Orbit,
};

/** Цвета школ: текст, мягкая подложка, свечение, «снаряд» заклинания. */
export const ELEMENT_STYLE: Record<Element, { text: string; soft: string; glow: string; orb: string; ring: string }> = {
  earth: {
    text: 'text-lime-300',
    soft: 'border-lime-400/40 bg-lime-500/10',
    glow: 'shadow-[0_0_20px_-4px_rgba(163,230,53,0.8)]',
    orb: 'bg-lime-300 shadow-[0_0_24px_8px_rgba(163,230,53,0.7)]',
    ring: 'ring-lime-300/70',
  },
  fire: {
    text: 'text-orange-300',
    soft: 'border-orange-400/40 bg-orange-500/10',
    glow: 'shadow-[0_0_20px_-4px_rgba(251,146,60,0.85)]',
    orb: 'bg-orange-300 shadow-[0_0_26px_10px_rgba(249,115,22,0.75)]',
    ring: 'ring-orange-300/70',
  },
  water: {
    text: 'text-sky-300',
    soft: 'border-sky-400/40 bg-sky-500/10',
    glow: 'shadow-[0_0_20px_-4px_rgba(56,189,248,0.85)]',
    orb: 'bg-sky-200 shadow-[0_0_24px_8px_rgba(56,189,248,0.75)]',
    ring: 'ring-sky-300/70',
  },
  void: {
    text: 'text-violet-300',
    soft: 'border-violet-400/40 bg-violet-500/10',
    glow: 'shadow-[0_0_20px_-4px_rgba(167,139,250,0.9)]',
    orb: 'bg-violet-300 shadow-[0_0_28px_10px_rgba(139,92,246,0.8)]',
    ring: 'ring-violet-300/70',
  },
};

export const ENEMY_ICONS: Record<EnemyIconId, LucideIcon> = {
  rat: Rat,
  bug: Bug,
  snail: Snail,
  bird: Bird,
  ghost: Ghost,
  skull: Skull,
  golem: Bot,
  anvil: Anvil,
  flame: Flame,
  snowflake: Snowflake,
  eye: Eye,
  hourglass: Hourglass,
  crown: Crown,
  orbit: Orbit,
  axe: Axe,
  hexagon: Hexagon,
  biohazard: Biohazard,
};

export const POTION_ICONS: Record<PotionId, { icon: LucideIcon; color: string; liquid: string }> = {
  health: { icon: Heart, color: 'text-red-300', liquid: 'from-red-500 to-rose-700' },
  freeze: { icon: Snowflake, color: 'text-cyan-200', liquid: 'from-cyan-300 to-sky-600' },
  bomb: { icon: Bomb, color: 'text-orange-300', liquid: 'from-orange-400 to-red-600' },
  mana: { icon: Sparkles, color: 'text-sky-300', liquid: 'from-sky-400 to-indigo-600' },
};

export const SPELL_ICONS: Record<SpellId, LucideIcon> = {
  regen: FlaskRound,
  shatter: Zap,
  meteor: Flame,
};

export const UPGRADE_ICONS: Record<UpgradeId, LucideIcon> = {
  stone: Gem,
  codex: BookOpen,
  lenses: Glasses,
  crystal: Sparkles,
  shield: Brain,
  amulet: Shield,
};

/** Иконка школы магии в цвете школы. */
export function ElementIcon({ element, size = 16, className = '' }: { element: Element; size?: number; className?: string }) {
  const Icon = ELEMENT_ICONS[element];
  return <Icon size={size} className={`${ELEMENT_STYLE[element].text} ${className}`} aria-label={ELEMENT_META[element].name} />;
}

/**
 * Строка эссенций: иконка + количество.
 * Без have — показывает кошелёк (все четыре школы). С have — это цена: показываются только нужные
 * эссенции, а те, которых не хватает, подсвечиваются красным.
 */
export function EssenceRow({
  essences,
  have,
  hideEmpty = false,
  size = 'md',
}: {
  essences: Partial<Essences>;
  have?: Essences;
  /** Скрыть школы с нулём (для наград). */
  hideEmpty?: boolean;
  size?: 'sm' | 'md';
}) {
  const elements: Element[] = ['earth', 'fire', 'water', 'void'];
  const shown = have === undefined && !hideEmpty ? elements : elements.filter((el) => (essences[el] ?? 0) > 0);
  return (
    <span className={`inline-flex flex-wrap items-center ${size === 'sm' ? 'gap-2' : 'gap-3'}`}>
      {shown.map((el) => {
        const value = essences[el] ?? 0;
        const lacking = have !== undefined && have[el] < value;
        return (
          <span
            key={el}
            className={`inline-flex items-center gap-1 font-mono ${size === 'sm' ? 'text-xs' : 'text-sm'} ${lacking ? 'text-red-400' : 'text-amber-100'}`}
            title={`${ELEMENT_META[el].essence}${lacking ? ' — не хватает' : ''}`}
          >
            <ElementIcon element={el} size={size === 'sm' ? 12 : 14} />
            {value}
          </span>
        );
      })}
    </span>
  );
}
