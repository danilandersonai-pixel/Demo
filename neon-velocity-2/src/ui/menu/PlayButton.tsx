import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { playUiSound } from '../../audio/uiSound';
import { Kbd } from '../kit/Kbd';
import './menu.css';
import { releasePointerFocus } from './shared';

export interface PlayButtonProps {
  onPlay(): void;
}

/**
 * Главная кнопка меню — единственная залитая: пластина в градиенте солнца с
 * теми же прорезями, что у знака «II». Свечение лежит отдельным статичным
 * слоем, поэтому бегущий блик не заставляет браузер пересчитывать размытие.
 */
export function PlayButton({ onPlay }: PlayButtonProps) {
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 460, damping: 26 }}
      onMouseEnter={() => playUiSound('hover')}
      onClick={(e) => {
        releasePointerFocus(e.currentTarget);
        playUiSound('click');
        onPlay();
      }}
      className="nvm-play group select-none font-mono font-extrabold uppercase"
    >
      <span aria-hidden className="nvm-play-glow" />
      <span aria-hidden className="nvm-play-plate" />
      <Play size={22} strokeWidth={0} fill="currentColor" className="shrink-0" aria-hidden />
      <span className="text-xl tracking-[0.32em] [@media(max-height:559.98px)]:text-base [@media(min-width:900px)_and_(min-height:560px)]:text-2xl">
        Играть
      </span>
      {/* Обёртка без собственного display: её прячут медиа-варианты, а у Kbd свой inline-flex. */}
      <span className="ml-1 max-sm:hidden pointer-coarse:hidden">
        <Kbd>Enter</Kbd>
      </span>
    </motion.button>
  );
}
