import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'gold' | 'cyber';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-fuchsia-500 via-purple-600 to-indigo-600 text-white border-white/15 shadow-[0_0_24px_-6px_rgba(168,85,247,0.85)] hover:shadow-[0_0_32px_-4px_rgba(192,38,211,0.95)]',
  ghost: 'bg-white/[0.04] text-slate-200 border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.2] hover:text-white',
  danger: 'bg-red-500/10 text-red-300 border-red-500/30 hover:bg-red-500/20 hover:border-red-400/50 hover:shadow-[0_0_22px_-6px_rgba(239,68,68,0.8)]',
  gold: 'bg-gradient-to-r from-amber-400 to-orange-500 text-[#1c1003] border-amber-200/40 shadow-[0_0_24px_-6px_rgba(251,146,60,0.85)] hover:shadow-[0_0_32px_-4px_rgba(251,191,36,0.95)]',
  cyber: 'bg-cyan-400/10 text-cyan-200 border-cyan-400/30 hover:bg-cyan-400/20 hover:border-cyan-300/60 hover:shadow-[0_0_22px_-6px_rgba(34,211,238,0.85)]',
};

const SQUARE_SIZES: Record<Size, string> = {
  sm: 'h-8 w-8 text-xs rounded-lg',
  md: 'h-10 w-10 text-sm rounded-xl',
  lg: 'h-12 w-12 text-base rounded-xl',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-xl',
};

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  /** Квадратная кнопка под одну иконку. */
  square?: boolean;
  children?: ReactNode;
}

/** Кнопка с физической отдачей: приподнимается при наведении и сжимается до 95% при нажатии. */
export function Button({ variant = 'ghost', size = 'md', icon, square = false, children, className = '', disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -1.5 }}
      whileTap={disabled ? undefined : { scale: 0.95, y: 0 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
      className={`focus-ring inline-flex shrink-0 cursor-pointer items-center justify-center border font-semibold tracking-wide transition-[background-color,box-shadow,border-color,color] duration-300 select-none disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${VARIANTS[variant]} ${square ? SQUARE_SIZES[size] : SIZES[size]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </motion.button>
  );
}

interface IconButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  label: string;
  children: ReactNode;
  tone?: 'default' | 'danger' | 'cyber';
}

const ICON_TONES = {
  default: 'text-slate-400 hover:text-white hover:bg-white/[0.08]',
  danger: 'text-red-300/70 hover:text-red-200 hover:bg-red-500/15',
  cyber: 'text-cyan-300/80 hover:text-cyan-100 hover:bg-cyan-400/15',
};

export function IconButton({ label, children, tone = 'default', className = '', type = 'button', ...rest }: IconButtonProps) {
  return (
    <motion.button
      type={type}
      aria-label={label}
      title={label}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 600, damping: 25 }}
      className={`focus-ring grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${ICON_TONES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
