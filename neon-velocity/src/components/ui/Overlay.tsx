import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export interface OverlayProps {
  children: ReactNode;
  /** Клик по фону вне содержимого. */
  onBackdropClick?: () => void;
  /** Сила размытия заднего плана. */
  blur?: 'sm' | 'md' | 'lg';
  /** Слой: 30 — экраны (пауза, game over, меню), 40 — панели поверх меню. */
  layer?: 30 | 40;
  className?: string;
  /** Подпись для скринридеров. */
  label?: string;
}

const BLUR = { sm: 'backdrop-blur-sm', md: 'backdrop-blur-md', lg: 'backdrop-blur-lg' } as const;

/**
 * Полноэкранная подложка с размытием заднего плана (backdrop-blur) и плавным
 * появлением. Оборачивайте в <AnimatePresence>, чтобы работала анимация выхода.
 */
export function Overlay({ children, onBackdropClick, blur = 'md', layer = 30, className = '', label }: OverlayProps) {
  return (
    <motion.div
      role="presentation"
      aria-label={label}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      onPointerDown={(e) => {
        if (onBackdropClick && e.target === e.currentTarget) onBackdropClick();
      }}
      className={[
        'fixed inset-0 flex items-center justify-center overflow-y-auto bg-void/55 px-4 py-6',
        layer === 40 ? 'z-40' : 'z-30',
        BLUR[blur],
        className,
      ].join(' ')}
      style={{
        paddingTop: 'max(1.5rem, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom, 0px))',
      }}
    >
      {children}
    </motion.div>
  );
}
