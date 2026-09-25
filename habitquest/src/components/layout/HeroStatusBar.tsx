import { motion, useAnimationControls } from 'framer-motion';
import { Coins, Heart, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { heroTitle } from '../../game/constants';
import type { Hero } from '../../types';
import { AnimatedNumber, Avatar } from '../ui/Misc';
import { NeonBar } from '../ui/NeonBar';

interface HeroStatusBarProps {
  hero: Hero;
  maxHp: number;
  xpNeeded: number;
  onOpenProfile: () => void;
}

/** Компактная панель героя, видимая на всех экранах. Трясётся при получении урона. */
export function HeroStatusBar({ hero, maxHp, xpNeeded, onOpenProfile }: HeroStatusBarProps) {
  const controls = useAnimationControls();
  const goldControls = useAnimationControls();
  const prevHp = useRef(hero.hp);
  const prevGold = useRef(hero.gold);

  useEffect(() => {
    if (hero.hp < prevHp.current) {
      void controls.start({ x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.4 } });
    }
    prevHp.current = hero.hp;
  }, [hero.hp, controls]);

  useEffect(() => {
    if (hero.gold !== prevGold.current) {
      void goldControls.start({ scale: [1, 1.18, 1], transition: { duration: 0.35 } });
    }
    prevGold.current = hero.gold;
  }, [hero.gold, goldControls]);

  return (
    <motion.header animate={controls} className="glass relative z-30 rounded-2xl px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-3 md:flex-nowrap md:gap-6">
        <button
          type="button"
          onClick={onOpenProfile}
          className="focus-ring group flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl text-left md:flex-none"
          aria-label="Редактировать профиль героя"
        >
          <Avatar avatar={hero.avatar} size="sm" level={hero.level} />
          <div className="min-w-0 pl-1">
            <p className="truncate font-display text-base text-white transition-colors group-hover:text-cyan-200">{hero.name}</p>
            <p className="truncate text-xs text-violet-200/60">
              Ур. {hero.level} · {heroTitle(hero.level)}
            </p>
          </div>
        </button>

        <div className="order-3 grid basis-full grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4 md:order-2 md:basis-0 md:flex-1">
          <NeonBar tone="hp" label="HP" icon={<Heart size={12} />} value={hero.hp} max={maxHp} size="md" warnBelow={0.3} />
          <NeonBar tone="xp" label="XP" icon={<Sparkles size={12} />} value={hero.xp} max={xpNeeded} size="md" />
        </div>

        <motion.div
          animate={goldControls}
          className="order-2 flex shrink-0 items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 md:order-3"
          aria-label={`Золото: ${hero.gold}`}
        >
          <Coins size={18} className="text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
          <AnimatedNumber value={hero.gold} className="font-display text-lg text-amber-200 neon-gold" />
        </motion.div>
      </div>
    </motion.header>
  );
}
