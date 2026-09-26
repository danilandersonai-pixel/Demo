import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Accent } from '../../game/types.ts';
import { ACCENT } from './accent.ts';
import { cn } from './cn.ts';

interface PanelProps {
  id: string;
  code: string;
  title: string;
  icon: LucideIcon;
  accent?: Accent;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  delay?: number;
  children: ReactNode;
}

/** Модуль командного центра: стеклянная панель с угловыми скобами и шапкой «код // название». */
export function Panel({ id, code, title, icon: Icon, accent = 'data', actions, className, bodyClassName, delay = 0, children }: PanelProps) {
  const a = ACCENT[accent];
  return (
    <motion.section
      aria-labelledby={`${id}-title`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn('panel relative flex min-w-0 flex-col', className)}
    >
      <span className="corner corner-tl" />
      <span className="corner corner-tr" />
      <span className="corner corner-bl" />
      <span className="corner corner-br" />
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn('grid size-8 shrink-0 place-items-center border', a.border, a.soft)}>
            <Icon className={cn('size-4', a.text)} aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="font-mono text-[10px] tracking-[0.28em] text-dim">{code}</div>
            <h2 id={`${id}-title`} className="truncate font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">
              {title}
            </h2>
          </div>
        </div>
        {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn('min-w-0 flex-1 p-4', bodyClassName)}>{children}</div>
    </motion.section>
  );
}
