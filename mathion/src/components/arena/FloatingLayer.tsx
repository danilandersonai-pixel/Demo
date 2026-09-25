import { AnimatePresence, motion } from 'framer-motion';
import type { Floater, FloaterTarget, FloaterTone } from '../../hooks/useGame';

const TONES: Record<FloaterTone, string> = {
  damage: 'text-fuchsia-300 text-3xl [text-shadow:0_0_14px_rgba(192,38,211,0.9)]',
  crit: 'text-fuchsia-200 text-4xl [text-shadow:0_0_20px_rgba(217,70,239,1),0_0_4px_rgba(255,255,255,0.8)]',
  hurt: 'text-red-400 text-3xl [text-shadow:0_0_14px_rgba(239,68,68,0.9)]',
  heal: 'text-emerald-300 text-2xl [text-shadow:0_0_12px_rgba(52,211,153,0.9)]',
  mana: 'text-sky-300 text-lg [text-shadow:0_0_10px_rgba(56,189,248,0.9)]',
  shield: 'text-cyan-200 text-lg [text-shadow:0_0_10px_rgba(103,232,249,0.9)]',
  points: 'text-amber-200 text-3xl [text-shadow:0_0_14px_rgba(240,200,114,0.9)]',
  time: 'text-emerald-300 text-lg [text-shadow:0_0_10px_rgba(52,211,153,0.9)]',
};

/** Всплывающие цифры урона и эффектов над целью. Кладётся внутрь relative-контейнера. */
export function FloatingLayer({ floaters, target }: { floaters: Floater[]; target: FloaterTarget }) {
  const mine = floaters.filter((f) => f.target === target);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-6 z-20 flex justify-center" aria-hidden="true">
      <AnimatePresence>
        {mine.map((f) => (
          <motion.span
            key={f.id}
            className={`absolute font-mono font-bold whitespace-nowrap ${TONES[f.tone]}`}
            style={{ x: f.offset }}
            initial={{ opacity: 0, y: 20, scale: 0.5 }}
            animate={{ opacity: [0, 1, 1, 0], y: -70, scale: f.tone === 'crit' ? [0.5, 1.4, 1.15, 1] : [0.5, 1.1, 1, 1] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.3, ease: 'easeOut', times: [0, 0.15, 0.7, 1] }}
          >
            {f.text}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
