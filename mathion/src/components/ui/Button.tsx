import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';

type Variant = 'brass' | 'wood' | 'emerald' | 'danger' | 'ghost' | 'arcane';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  brass: 'brass-plaque font-bold hover:brightness-110',
  wood: 'border border-amber-600/35 bg-gradient-to-b from-[#34220f] to-[#1d130a] text-amber-100 hover:border-amber-400/70 hover:text-amber-50 hover:shadow-[0_0_18px_-6px_rgba(240,200,114,0.7)]',
  emerald:
    'border border-emerald-400/45 bg-gradient-to-b from-emerald-700/60 to-emerald-900/70 text-emerald-50 shadow-[0_0_18px_-8px_rgba(52,211,153,0.9)] hover:border-emerald-300/80 hover:shadow-[0_0_24px_-6px_rgba(52,211,153,0.9)]',
  danger: 'border border-red-500/40 bg-gradient-to-b from-red-900/60 to-red-950/70 text-red-100 hover:border-red-400/70 hover:shadow-[0_0_18px_-6px_rgba(248,113,113,0.8)]',
  ghost: 'border border-transparent text-amber-200/80 hover:border-amber-600/30 hover:bg-amber-500/5 hover:text-amber-100',
  arcane:
    'border border-violet-400/45 bg-gradient-to-b from-violet-800/55 to-indigo-950/70 text-violet-50 shadow-[0_0_18px_-8px_rgba(167,139,250,0.9)] hover:border-violet-300/80 hover:shadow-[0_0_24px_-6px_rgba(167,139,250,0.9)]',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-[15px] gap-2 rounded-xl',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-xl',
};

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  children?: ReactNode;
}

/** Кнопка с физической отдачей: при нажатии сжимается до 95%. */
export function Button({ variant = 'wood', size = 'md', icon, children, className = '', disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
      className={`focus-brass inline-flex shrink-0 cursor-pointer items-center justify-center font-serif font-medium transition-[filter,box-shadow,border-color,color,background-color] duration-200 select-none disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:brightness-75 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </motion.button>
  );
}
