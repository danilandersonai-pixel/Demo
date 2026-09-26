import { AnimatePresence, motion } from 'framer-motion';
import { FlaskConical, Info, Siren, Trophy } from 'lucide-react';
import { useEffect } from 'react';
import type { Toast } from '../game/types.ts';
import { useGameContext } from './GameContext.tsx';
import { cn } from './ui/cn.ts';

const STYLE: Record<Toast['kind'], { box: string; icon: typeof Trophy; title: string }> = {
  record: {
    box: 'border-credit/70 bg-deep/95 shadow-[0_0_40px_-6px_var(--color-credit),inset_0_0_30px_-12px_var(--color-credit)]',
    icon: Trophy,
    title: 'text-credit glow-credit',
  },
  research: {
    box: 'border-research/60 bg-deep/95 shadow-[0_0_30px_-10px_var(--color-research)]',
    icon: FlaskConical,
    title: 'text-research',
  },
  alert: {
    box: 'border-danger/60 bg-deep/95 shadow-[0_0_30px_-10px_var(--color-danger)]',
    icon: Siren,
    title: 'text-danger',
  },
  info: { box: 'border-data/50 bg-deep/95', icon: Info, title: 'text-data' },
};

function ToastItem({ toast }: { toast: Toast }) {
  const { dispatch } = useGameContext();
  const style = STYLE[toast.kind];
  const Icon = style.icon;

  useEffect(() => {
    const id = window.setTimeout(() => dispatch({ type: 'DISMISS_TOAST', id: toast.id }), toast.kind === 'record' ? 6500 : 5000);
    return () => window.clearTimeout(id);
  }, [dispatch, toast.id, toast.kind]);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -24, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      className={cn('pointer-events-auto relative w-full overflow-hidden border', style.box)}
    >
      {toast.kind === 'record' ? <div className="sheen absolute inset-0" aria-hidden /> : null}
      <button
        type="button"
        onClick={() => dispatch({ type: 'DISMISS_TOAST', id: toast.id })}
        className="relative flex w-full items-start gap-3 p-3 text-left"
        aria-label={`${toast.title}. ${toast.text}. Закрыть`}
      >
        <motion.span
          animate={toast.kind === 'record' ? { rotate: [0, -12, 12, -6, 0], scale: [1, 1.2, 1] } : undefined}
          transition={{ duration: 0.9, delay: 0.15 }}
          className="mt-0.5"
        >
          <Icon className={cn('size-5', style.title)} />
        </motion.span>
        <span className="min-w-0">
          <span className={cn('block font-display text-[13px] font-bold uppercase tracking-wider', style.title)}>{toast.title}</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{toast.text}</span>
        </span>
      </button>
    </motion.li>
  );
}

/** Уведомления: рекорды (ярко-неоновые), завершённые исследования, тревоги. */
export function Toasts() {
  const { state } = useGameContext();
  return (
    <ol className="toast-stack pointer-events-none fixed inset-x-4 z-[70] mx-auto flex max-w-md flex-col-reverse gap-2 sm:flex-col" aria-live="assertive">
      <AnimatePresence initial={false}>
        {state.toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </ol>
  );
}
