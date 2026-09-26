import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from './cn.ts';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  labelledBy: string;
  className?: string;
  tone?: 'default' | 'danger' | 'research';
  /** Слой поверх остальных окон (например, справка над загрузочным экраном). */
  layer?: string;
  children: ReactNode;
}

const TONE = {
  default: 'border-line',
  danger: 'border-danger/50 shadow-[0_0_60px_-20px_var(--color-danger)]',
  research: 'border-research/50 shadow-[0_0_60px_-20px_var(--color-research)]',
};

/** Модальное окно: затемнение с блюром, Esc закрывает, фокус переносится внутрь. */
export function Modal({ open, onClose, labelledBy, className, tone = 'default', layer = 'z-50', children }: ModalProps) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const id = window.setTimeout(() => {
      const target = box.current?.querySelector<HTMLElement>('[data-autofocus], button:not([disabled])');
      target?.focus();
    }, 40);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onClose) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={cn('fixed inset-0 flex items-end justify-center overflow-y-auto bg-void/75 p-4 backdrop-blur-md sm:items-center', layer)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && onClose) onClose();
          }}
        >
          <motion.div
            ref={box}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className={cn('panel relative my-auto w-full max-w-xl border bg-deep/95', TONE[tone], className)}
          >
            <span className="corner corner-tl" />
            <span className="corner corner-tr" />
            <span className="corner corner-bl" />
            <span className="corner corner-br" />
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
