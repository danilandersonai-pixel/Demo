import { motion, type Transition } from 'framer-motion';
import type { ReactNode } from 'react';

type Accent = 'pink' | 'cyan' | 'yellow';

const FRAME: Record<Accent, { frame: string; corner: string }> = {
  pink: { frame: 'box-glow-pink', corner: 'border-neon-pink' },
  cyan: { frame: 'box-glow-cyan', corner: 'border-neon-cyan' },
  yellow: { frame: 'box-glow-yellow', corner: 'border-neon-yellow' },
};

/** Пружина только для движения: у filter перелёт пружины даёт недопустимый отрицательный blur(). */
const ENTER: Transition = {
  type: 'spring',
  stiffness: 250,
  damping: 24,
  filter: { duration: 0.35, ease: 'easeOut' },
  opacity: { duration: 0.3, ease: 'easeOut' },
};

export interface NeonCardProps {
  accent: Accent;
  /** id заголовка диалога. */
  labelledBy: string;
  className?: string;
  children: ReactNode;
}

/**
 * Неоновая карточка экранов паузы и Game Over: стекло, светящаяся рамка,
 * уголки-скобы. Появляется с подъёмом, масштабом и расфокусом.
 */
export function NeonCard({ accent, labelledBy, className = '', children }: NeonCardProps) {
  const a = FRAME[accent];
  return (
    <motion.section
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      initial={{ opacity: 0, y: 36, scale: 0.92, filter: 'blur(10px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: 18, scale: 0.96, filter: 'blur(6px)', transition: { duration: 0.2 } }}
      transition={ENTER}
      className={['glass relative my-auto w-full rounded-[4px]', a.frame, className].join(' ')}
    >
      <span aria-hidden className={`pointer-events-none absolute -left-1 -top-1 h-4 w-4 border-l-2 border-t-2 ${a.corner}`} />
      <span aria-hidden className={`pointer-events-none absolute -right-1 -top-1 h-4 w-4 border-r-2 border-t-2 ${a.corner}`} />
      <span aria-hidden className={`pointer-events-none absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 ${a.corner}`} />
      <span aria-hidden className={`pointer-events-none absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 ${a.corner}`} />
      {children}
    </motion.section>
  );
}
