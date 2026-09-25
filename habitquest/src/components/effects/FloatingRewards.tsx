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
            className="absolute flex -translate-x-1/2 flex-col items-center gap-0.5 font-mono text-sm font-bold tracking-wider whitespace-nowrap"
            style={{ left: f.x, top: f.y }}
            initial={{ opacity: 0, y: 0, scale: 0.6, filter: 'blur(4px)' }}
            animate={{
              opacity: [0, 1, 1, 0],
              y: -96,
              scale: f.crit ? [0.6, 1.35, 1.15, 1] : [0.6, 1.1, 1, 1],
              filter: ['blur(4px)', 'blur(0px)', 'blur(0px)', 'blur(2px)'],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5, ease: 'easeOut', times: [0, 0.15, 0.7, 1] }}
          >
            {f.crit && (
              <span className="flex items-center gap-1 rounded border border-cyan-300/50 bg-cyan-400/15 px-1.5 text-[10px] tracking-[0.25em] text-cyan-200 neon-cyan">
                <Zap size={11} /> CRIT
              </span>
            )}
            {f.xp !== 0 && (
              <span className={`flex items-center gap-1 ${f.xp > 0 ? 'text-fuchsia-300 neon-fuchsia' : 'text-fuchsia-400/60'}`}>
                <Sparkles size={13} /> {signed(f.xp)} XP
              </span>
            )}
            {f.gold !== 0 && (
              <span className={`flex items-center gap-1 ${f.gold > 0 ? 'gold-sheen' : 'text-orange-400/80'}`}>
                <Coins size={13} className={f.gold > 0 ? 'text-amber-300' : ''} /> {signed(f.gold)} G
              </span>
            )}
            {f.hp !== 0 && (
              <span className={`flex items-center gap-1 ${f.hp > 0 ? 'text-emerald-300' : 'text-red-400 neon-red'}`}>
                <Heart size={13} /> {signed(f.hp)} HP
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
