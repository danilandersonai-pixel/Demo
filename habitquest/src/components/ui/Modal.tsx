import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './Button';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg';
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea, select, [href], [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, icon, children, footer, width = 'md' }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 60);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={`glass-strong relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl ${width === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}
            initial={{ y: 40, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 30, scale: 0.97, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-violet-400/15 px-5 py-4">
              <h2 id={titleId} className="flex items-center gap-2 font-display text-lg tracking-wide text-white">
                {icon}
                {title}
              </h2>
              <IconButton label="Закрыть" onClick={onClose}>
                <X size={18} />
              </IconButton>
            </div>
            <div className="overflow-y-auto px-5 py-5">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-violet-400/15 px-5 py-4">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
