import { motion, useAnimationControls } from 'framer-motion';
import { Heart, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { heroTitle } from '../../game/constants';
import type { Hero } from '../../types';
import { Avatar, GoldCounter, LevelUpFlash } from '../ui/Misc';
import { NeonBar } from '../ui/NeonBar';

interface HeroStatusBarProps {
  hero: Hero;
  maxHp: number;
  xpNeeded: number;
  onOpenProfile: () => void;
}

/** Компактная панель героя, видимая на всех экранах. Вздрагивает от урона, вспыхивает при новом уровне. */
export function HeroStatusBar({ hero, maxHp, xpNeeded, onOpenProfile }: HeroStatusBarProps) {
  const controls = useAnimationControls();
  const prevHp = useRef(hero.hp);

  useEffect(() => {
    if (hero.hp < prevHp.current) {
      void controls.start({ x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.4 } });
    }
    prevHp.current = hero.hp;
  }, [hero.hp, controls]);

  return (
    <motion.header animate={controls} className="glass relative z-30 rounded-2xl px-4 py-3 sm:px-5">
      <LevelUpFlash level={hero.level} />
      <div className="flex flex-wrap items-center gap-3 md:flex-nowrap md:gap-6">
        <button
          type="button"
          onClick={onOpenProfile}
          className="focus-ring group flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl text-left md:flex-none"
          aria-label="Редактировать профиль героя"
        >
          <Avatar avatar={hero.avatar} size="sm" level={hero.level} />
          <div className="min-w-0 pl-1">
            <p className="truncate font-display text-[14px] font-medium text-white transition-colors duration-300 group-hover:text-cyan-200">{hero.name}</p>
            <p className="truncate font-mono text-[10px] tracking-[0.18em] text-slate-400 uppercase">
              LVL {String(hero.level).padStart(2, '0')} · {heroTitle(hero.level)}
            </p>
          </div>
        </button>

        <div className="order-3 grid basis-full grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-5 md:order-2 md:basis-0 md:flex-1">
          <NeonBar tone="hp" label="HP" icon={<Heart size={12} />} value={hero.hp} max={maxHp} size="md" warnBelow={0.3} />
          <NeonBar tone="xp" label="XP" icon={<Sparkles size={12} />} value={hero.xp} max={xpNeeded} size="md" />
        </div>

        <div className="order-2 md:order-3">
          <GoldCounter value={hero.gold} size="sm" />
        </div>
      </div>
    </motion.header>
  );
}
