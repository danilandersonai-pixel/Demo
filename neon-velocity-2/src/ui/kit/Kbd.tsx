import type { ReactNode } from 'react';

/** Подсказка клавиши: [Esc], [←], [Enter]. */
export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={[
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] border border-current/40 bg-white/5 px-1.5',
        'font-mono text-[10px] font-semibold normal-case tracking-normal opacity-80',
        className,
      ].join(' ')}
    >
      {children}
    </kbd>
  );
}
