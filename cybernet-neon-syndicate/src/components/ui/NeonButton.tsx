import { motion } from 'framer-motion';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Accent } from '../../game/types.ts';
import { cn } from './cn.ts';

type Variant = 'solid' | 'outline' | 'ghost';

interface NeonButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'> {
  accent?: Accent;
  variant?: Variant;
  size?: 'xs' | 'sm' | 'md';
  children: ReactNode;
}

const SOLID: Record<Accent, string> = {
  credit: 'bg-credit text-void hover:bg-credit/90 shadow-[0_0_18px_-4px_var(--color-credit)]',
  data: 'bg-data text-void hover:bg-data/90 shadow-[0_0_18px_-4px_var(--color-data)]',
  energy: 'bg-energy text-void hover:bg-energy/90 shadow-[0_0_18px_-4px_var(--color-energy)]',
  research: 'bg-research text-void hover:bg-research/90 shadow-[0_0_18px_-4px_var(--color-research)]',
  danger: 'bg-danger text-void hover:bg-danger/90 shadow-[0_0_18px_-4px_var(--color-danger)]',
};

const OUTLINE: Record<Accent, string> = {
  credit: 'border border-credit/45 text-credit bg-credit/5 hover:bg-credit/15',
  data: 'border border-data/45 text-data bg-data/5 hover:bg-data/15',
  energy: 'border border-energy/45 text-energy bg-energy/5 hover:bg-energy/15',
  research: 'border border-research/45 text-research bg-research/5 hover:bg-research/15',
  danger: 'border border-danger/45 text-danger bg-danger/5 hover:bg-danger/15',
};

const SIZE = {
  xs: 'h-7 px-2.5 text-[11px] gap-1.5',
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-[13px] gap-2',
};

/** Кнопка со скошенными углами. В заблокированном состоянии — тусклая, без неона. */
export function NeonButton({ accent = 'data', variant = 'outline', size = 'sm', className, disabled, children, ...rest }: NeonButtonProps) {
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.96 }}
      disabled={disabled}
      className={cn(
        'chamfer inline-flex shrink-0 select-none items-center justify-center font-mono font-semibold uppercase tracking-wider transition-colors duration-150',
        SIZE[size],
        disabled
          ? 'cursor-not-allowed border border-line bg-white/[0.02] text-dim shadow-none'
          : variant === 'solid'
            ? SOLID[accent]
            : variant === 'outline'
              ? OUTLINE[accent]
              : 'text-muted hover:bg-white/5 hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
