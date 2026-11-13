import { motion } from 'framer-motion';
import { Hand, Keyboard, MousePointer2 } from 'lucide-react';
import { useState } from 'react';
import { Kbd } from '../ui/Kbd';
import { isCoarsePointer } from './pointer';

/**
 * Подсказка управления в первом забеге. Стоит у нижнего края, под кораблём,
 * чтобы не закрывать летящие препятствия. App убирает её через несколько секунд.
 */
export function ControlHint() {
  const [touch] = useState(isCoarsePointer);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10, transition: { duration: 0.4 } }}
      transition={{ delay: 0.3, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-x-0 flex justify-center px-3"
      style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="glass flex max-w-full items-center gap-2 rounded-[3px] px-3 py-1.5 text-[10px] font-semibold tracking-wide text-ink shadow-[0_0_0_1px_rgba(34,240,255,0.45),0_0_14px_rgba(34,240,255,0.25)] sm:gap-4 sm:px-4 sm:py-2 sm:text-xs">
        {touch ? (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <Hand size={14} className="shrink-0 text-neon-cyan" aria-hidden />
            Ведите пальцем — корабль плывёт следом
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <Keyboard size={14} className="shrink-0 text-neon-cyan" aria-hidden />
              <Kbd>←</Kbd>
              <Kbd>→</Kbd>
              <span className="text-ink-faint">/</span>
              <Kbd>A</Kbd>
              <Kbd>D</Kbd>
            </span>
            <span className="h-3 w-px bg-white/15" aria-hidden />
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <MousePointer2 size={14} className="shrink-0 text-neon-pink" aria-hidden />
              <span>или мышь</span>
            </span>
            <span className="hidden h-3 w-px bg-white/15 sm:block" aria-hidden />
            <span className="hidden whitespace-nowrap text-ink-dim sm:inline">сферы подряд — комбо</span>
          </>
        )}
      </div>
    </motion.div>
  );
}
