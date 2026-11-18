import { motion } from 'framer-motion';
import { Hand, MousePointer2 } from 'lucide-react';
import { Kbd } from '../kit/Kbd';
import { EASE_OUT } from './constants';

/**
 * Подсказка управления первого забега — внизу, под кораблём. Клавиши
 * показываются только там, где они есть: на узком экране и при «пальце»
 * (в том числе телефон боком) — подсказка про касание.
 */
export function ControlHint() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.45, ease: EASE_OUT, delay: 0.25 }}
      className="absolute inset-x-0 bottom-0 flex justify-center pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] [@media(max-height:560px)]:pb-[max(0.375rem,env(safe-area-inset-bottom,0px))]"
    >
      <div className="flex max-w-full items-center gap-2 rounded-[3px] border border-neon-cyan/35 bg-void/75 px-3 py-1.5 text-[11px] leading-tight tracking-wide text-ink shadow-[0_0_14px_rgba(34,240,255,0.18)] sm:text-xs [@media(max-height:560px)]:py-1">
        <span className="hidden items-center gap-2 max-sm:flex pointer-coarse:flex">
          <Hand size={15} className="shrink-0 text-neon-cyan" aria-hidden />
          <span>Ведите корабль пальцем</span>
        </span>
        <span className="flex items-center gap-2 max-sm:hidden pointer-coarse:hidden">
          <span className="flex shrink-0 gap-1 text-neon-cyan">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
          </span>
          <span>или</span>
          <MousePointer2 size={14} className="shrink-0 text-neon-cyan" aria-hidden />
          <span>мышь — корабль летит за курсором</span>
          <span aria-hidden className="text-ink-faint">
            ·
          </span>
          <span className="flex shrink-0 text-ink-dim">
            <Kbd>Esc</Kbd>
          </span>
          <span className="text-ink-dim">пауза</span>
        </span>
      </div>
    </motion.div>
  );
}
