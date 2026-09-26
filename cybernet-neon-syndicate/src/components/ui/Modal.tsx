import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from './cn.ts';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  labelledBy: string;
  className?: string;
  tone?: 'default' | 'danger' | 'research';
  /** Слой поверх остальных окон (например, справка над загрузочным экраном). */
  layer?: string;
  /**
   * Куда поставить фокус при открытии. 'container' — на само окно: для окон, которые
   * всплывают без запроса игрока, чтобы нажатый в этот момент пробел ничего не выбрал.
   */
  initialFocus?: 'auto' | 'container';
  /** Окно перекрыто другим окном — убрать его из порядка фокуса. */
  inert?: boolean;
  children: ReactNode;
}

const TONE = {
  default: 'border-line',
  danger: 'border-danger/50 shadow-[0_0_60px_-20px_var(--color-danger)]',
  research: 'border-research/50 shadow-[0_0_60px_-20px_var(--color-research)]',
};

/** Стек открытых окон: Esc закрывает только верхнее. */
const stack: string[] = [];

/** Модальное окно: затемнение с блюром, Esc закрывает верхнее окно, фокус переносится внутрь. */
export function Modal({ open, onClose, labelledBy, className, tone = 'default', layer = 'z-50', initialFocus = 'auto', inert, children }: ModalProps) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  // Колбэк в ref: родитель передаёт новую функцию на каждом рендере (а игра рендерится каждый тик),
  // и без ref эффект ниже перезапускался бы и дёргал фокус.
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    stack.push(id);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const node = box.current;
      if (!node) return;
      const target =
        initialFocus === 'container'
          ? node
          : (node.querySelector<HTMLElement>('[data-autofocus]:not([disabled])') ?? node.querySelector<HTMLElement>('button:not([disabled])') ?? node);
      target.focus({ preventScroll: true });
    }, 40);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || stack[stack.length - 1] !== id || !closeRef.current) return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      const index = stack.lastIndexOf(id);
      if (index >= 0) stack.splice(index, 1);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [open, id, initialFocus]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={cn('fixed inset-0 flex items-end justify-center overflow-y-auto bg-void/75 p-4 backdrop-blur-md sm:items-center', layer)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          inert={inert}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRef.current?.();
          }}
        >
          <motion.div
            ref={box}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            tabIndex={-1}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className={cn('panel relative my-auto w-full max-w-xl border bg-deep/95 outline-none', TONE[tone], className)}
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
