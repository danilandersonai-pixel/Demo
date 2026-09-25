import {
  Bed,
  BookOpen,
  Bot,
  Brain,
  Cat,
  Coffee,
  Crosshair,
  Dumbbell,
  Film,
  FlaskConical,
  Gamepad2,
  Ghost,
  Gift,
  IceCream,
  Music,
  Plane,
  Pizza,
  Shield,
  ShoppingBag,
  Skull,
  Swords,
  Target,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import type { AvatarId, RewardIconId, StatKey } from '../types';

export interface AvatarMeta {
  icon: LucideIcon;
  label: string;
  /** Градиент рамки аватара (классы Tailwind). */
  gradient: string;
}

export const AVATARS: Record<AvatarId, AvatarMeta> = {
  warrior: { icon: Swords, label: 'Воин', gradient: 'from-rose-500 via-fuchsia-500 to-violet-600' },
  mage: { icon: WandSparkles, label: 'Техномаг', gradient: 'from-violet-500 via-indigo-500 to-cyan-400' },
  guardian: { icon: Shield, label: 'Страж', gradient: 'from-cyan-400 via-sky-500 to-indigo-600' },
  ranger: { icon: Crosshair, label: 'Снайпер', gradient: 'from-emerald-400 via-teal-500 to-cyan-600' },
  necro: { icon: Skull, label: 'Некромант', gradient: 'from-lime-400 via-emerald-600 to-slate-800' },
  phantom: { icon: Ghost, label: 'Фантом', gradient: 'from-slate-300 via-violet-400 to-fuchsia-600' },
  android: { icon: Bot, label: 'Андроид', gradient: 'from-amber-300 via-orange-500 to-rose-600' },
  familiar: { icon: Cat, label: 'Кибер-кот', gradient: 'from-pink-400 via-fuchsia-500 to-amber-400' },
};

export const AVATAR_ORDER: AvatarId[] = ['warrior', 'mage', 'guardian', 'ranger', 'necro', 'phantom', 'android', 'familiar'];

export const REWARD_ICONS: Record<RewardIconId, { icon: LucideIcon; label: string }> = {
  film: { icon: Film, label: 'Кино' },
  pizza: { icon: Pizza, label: 'Еда' },
  game: { icon: Gamepad2, label: 'Игры' },
  coffee: { icon: Coffee, label: 'Кофе' },
  sleep: { icon: Bed, label: 'Сон' },
  music: { icon: Music, label: 'Музыка' },
  shopping: { icon: ShoppingBag, label: 'Покупки' },
  travel: { icon: Plane, label: 'Отдых' },
  book: { icon: BookOpen, label: 'Книги' },
  gift: { icon: Gift, label: 'Подарок' },
  potion: { icon: FlaskConical, label: 'Зелье' },
  icecream: { icon: IceCream, label: 'Сладкое' },
};

export const CUSTOM_REWARD_ICONS: RewardIconId[] = [
  'film', 'pizza', 'game', 'coffee', 'sleep', 'music', 'shopping', 'travel', 'book', 'gift', 'icecream',
];

export const STAT_ICONS: Record<StatKey, LucideIcon> = {
  strength: Dumbbell,
  intellect: Brain,
  discipline: Target,
};

/** Цвет каждой характеристики: текст, фон полосы, свечение. */
export const STAT_COLORS: Record<StatKey, { text: string; bar: string; glow: string; soft: string }> = {
  strength: { text: 'text-rose-300', bar: 'from-rose-500 to-orange-400', glow: 'shadow-[0_0_14px_rgba(251,113,133,0.55)]', soft: 'bg-rose-500/10 border-rose-400/30' },
  intellect: { text: 'text-cyan-300', bar: 'from-cyan-400 to-sky-500', glow: 'shadow-[0_0_14px_rgba(34,211,238,0.55)]', soft: 'bg-cyan-500/10 border-cyan-400/30' },
  discipline: { text: 'text-emerald-300', bar: 'from-emerald-400 to-lime-400', glow: 'shadow-[0_0_14px_rgba(52,211,153,0.55)]', soft: 'bg-emerald-500/10 border-emerald-400/30' },
};
