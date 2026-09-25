import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}

/** Деревянная панель с латунной табличкой-заголовком. */
export function Panel({ title, icon, actions, children, className = '', delay = 0 }: PanelProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`wood-panel p-4 sm:p-5 ${className}`}
    >
      {(title || actions) && (
        <header className="relative mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="brass-plaque inline-flex items-center gap-2 rounded-md px-3 py-1 font-display text-[15px] font-bold tracking-wide">
              {icon}
              {title}
            </h2>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="relative">{children}</div>
    </motion.section>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2 font-display text-xs font-bold tracking-[0.2em] text-amber-300/70 uppercase">{children}</p>;
}
