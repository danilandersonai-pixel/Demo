import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { playUiSound } from '../../game/uiSound';
import { Kbd } from '../ui/Kbd';
import './menu.css';

/**
 * Главная кнопка меню: залитая неоновая плашка (единственная во всём меню —
 * сразу видно, куда жать), тёмный текст для контраста, пульсирующая аура и
 * пробегающий блик.
 */
export function PlayButton({ onPlay, label = 'Играть' }: { onPlay(): void; label?: string }) {
  return (
    <div className="relative">
      <span aria-hidden className="nvm-play-aura pointer-events-none absolute -inset-x-6 -inset-y-4 rounded-full" />
      <motion.button
        type="button"
        onClick={() => {
          playUiSound('click');
          onPlay();
        }}
        onMouseEnter={() => playUiSound('hover')}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 500, damping: 26 }}
        className="nvm-play group relative flex h-16 w-full select-none items-center justify-center gap-3 overflow-hidden rounded-[3px] font-mono text-lg font-extrabold uppercase tracking-[0.3em] text-void sm:text-xl [@media(max-height:560px)]:h-12"
      >
        <span aria-hidden className="nvm-sweep pointer-events-none absolute inset-0" />
        <span aria-hidden className="pointer-events-none absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-void/60" />
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-void/60"
        />
        <Play size={22} strokeWidth={2.5} fill="currentColor" className="relative shrink-0" aria-hidden />
        <span className="relative pl-[0.3em]">{label}</span>
        <Kbd className="relative ml-1 border-void/50! bg-void/15! text-void opacity-100!">Enter</Kbd>
      </motion.button>
    </div>
  );
}
