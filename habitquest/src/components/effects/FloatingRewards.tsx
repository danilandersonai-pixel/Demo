import { AnimatePresence, motion } from 'framer-motion';
import { Coins, Heart, Sparkles, Zap } from 'lucide-react';
import type { Floater } from '../../types';

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

/** Всплывающие цифры наград, вылетающие из точки клика. */
export function FloatingRewards({ floaters }: { floaters: Floater[] }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[80]" aria-hidden="true">
      <AnimatePresence>
        {floaters.map((f) => (
          <motion.div
            key={f.id}
            className="absolute flex -translate-x-1/2 flex-col items-center gap-0.5 font-display text-sm whitespace-nowrap"
            style={{ left: f.x, top: f.y }}
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0], y: -90, scale: f.crit ? [0.6, 1.35, 1.15, 1] : [0.6, 1.1, 1, 1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5, ease: 'easeOut', times: [0, 0.15, 0.7, 1] }}
          >
            {f.crit && (
              <span className="flex items-center gap-1 text-xs tracking-widest text-cyan-200 neon-cyber">
                <Zap size={12} /> КРИТ!
              </span>
            )}
            {f.xp !== 0 && (
              <span className={`flex items-center gap-1 ${f.xp > 0 ? 'text-violet-300 neon-xp' : 'text-violet-400/70'}`}>
                <Sparkles size={14} /> {signed(f.xp)} XP
              </span>
            )}
            {f.gold !== 0 && (
              <span className={`flex items-center gap-1 ${f.gold > 0 ? 'text-amber-300 neon-gold' : 'text-amber-500/80'}`}>
                <Coins size={14} /> {signed(f.gold)}
              </span>
            )}
            {f.hp !== 0 && (
              <span className={`flex items-center gap-1 ${f.hp > 0 ? 'text-emerald-300' : 'text-rose-400 neon-hp'}`}>
                <Heart size={14} /> {signed(f.hp)} HP
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
