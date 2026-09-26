import { AnimatePresence, motion } from 'framer-motion';
import { Crown } from 'lucide-react';
import { ScoreDigits } from './ScoreDigits';

export interface ScoreBlockProps {
  score: number;
  /** max(рекорд до забега, текущий счёт). */
  best: number;
  /** Прошлый рекорд уже побит в этом забеге. */
  beaten: boolean;
}

/** Левый верхний угол HUD: крупный SCORE и абсолютный рекорд BEST. */
export function ScoreBlock({ score, best, beaten }: ScoreBlockProps) {
  return (
    <div className="flex min-w-0 flex-col items-start">
      <span className="text-[9px] font-bold tracking-[0.4em] text-neon-cyan/80 sm:text-[11px] [@media(max-height:560px)_and_(orientation:landscape)]:text-[9px]">SCORE</span>
      <ScoreDigits
        value={score}
        className="text-[25px] font-extrabold leading-none tracking-wider sm:text-5xl sm:tracking-widest [@media(max-height:560px)_and_(orientation:landscape)]:text-[25px] [@media(max-height:560px)_and_(orientation:landscape)]:tracking-wider max-[359px]:text-[21px] max-[359px]:tracking-normal"
        digitsClassName={beaten ? 'text-neon-yellow text-glow-yellow' : 'text-white text-glow-cyan'}
      />
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold tracking-widest sm:mt-2 sm:gap-2 sm:text-xs [@media(max-height:560px)_and_(orientation:landscape)]:mt-1.5 [@media(max-height:560px)_and_(orientation:landscape)]:gap-1.5 [@media(max-height:560px)_and_(orientation:landscape)]:text-[10px] max-[359px]:gap-1">
        <span className={beaten ? 'text-neon-yellow text-glow-yellow' : 'text-ink-dim'}>BEST</span>
        <ScoreDigits
          value={best}
          digitsClassName={beaten ? 'text-neon-yellow' : 'text-ink'}
          leadClassName={beaten ? 'text-neon-yellow/35' : 'text-ink-faint/60'}
        />
        <AnimatePresence>
          {beaten && (
            <motion.span
              key="record-tag"
              initial={{ opacity: 0, scale: 0.4, x: -6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 520, damping: 18 }}
              className="nv-record-flicker inline-flex items-center gap-1 rounded-[2px] bg-neon-yellow px-1.5 py-px text-[9px] font-black text-void shadow-[0_0_12px_rgba(255,233,74,0.75)] sm:text-[10px] [@media(max-height:560px)_and_(orientation:landscape)]:text-[9px]"
            >
              <Crown size={10} strokeWidth={3} aria-hidden />
              {/* При ширине меньше 360 px от метки остаётся корона — слово не влезает рядом с BEST. */}
              <span className="max-[359px]:sr-only">NEW</span>
              <span className="hidden sm:inline"> RECORD</span>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
