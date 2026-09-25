import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Нельзя закрыть кликом по фону или Esc (итоги боя). */
  persistent?: boolean;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Модальное окно в портале поверх всего интерфейса. */
export function Modal({ open, onClose, title, icon, children, footer, persistent = false }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }, 60);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !persistent) {
        event.preventDefault();
        onCloseRef.current?.();
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
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, persistent]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={persistent ? undefined : onClose} aria-hidden="true" />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="wood-panel relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden"
            initial={{ y: 30, scale: 0.94, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 20, scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
          >
            <div className="relative flex items-center justify-between gap-3 border-b border-amber-700/30 px-5 py-4">
              <h2 id={titleId} className="flex items-center gap-2 font-display text-xl font-bold text-amber-100 gold-glow">
                {icon}
                {title}
              </h2>
              {!persistent && onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Закрыть"
                  className="focus-brass grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-amber-200/70 transition-colors hover:bg-amber-500/10 hover:text-amber-100"
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <div className="relative overflow-y-auto px-5 py-5">{children}</div>
            {footer && <div className="relative flex flex-wrap justify-end gap-2 border-t border-amber-700/30 px-5 py-4">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
          <Button
            variant="danger"
            data-autofocus
            onClick={() => {
              onConfirm();
              onCancel();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[15px] leading-relaxed text-amber-50/85">{message}</p>
    </Modal>
  );
}
