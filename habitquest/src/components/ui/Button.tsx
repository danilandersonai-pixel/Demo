import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'gold' | 'cyber';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white border-violet-400/50 shadow-[0_0_22px_-4px_rgba(168,85,247,0.7)] hover:shadow-[0_0_30px_-2px_rgba(168,85,247,0.9)]',
  ghost: 'bg-white/5 text-violet-100 border-violet-400/20 hover:bg-white/10 hover:border-violet-300/40',
  danger:
    'bg-rose-600/20 text-rose-200 border-rose-400/40 hover:bg-rose-600/35 hover:shadow-[0_0_20px_-4px_rgba(255,59,92,0.8)]',
  gold: 'bg-gradient-to-r from-amber-500 to-yellow-400 text-amber-950 border-amber-300/60 shadow-[0_0_20px_-4px_rgba(251,191,36,0.7)] hover:shadow-[0_0_28px_-2px_rgba(251,191,36,0.95)]',
  cyber:
    'bg-cyan-500/15 text-cyan-100 border-cyan-400/40 hover:bg-cyan-500/25 hover:shadow-[0_0_20px_-4px_rgba(34,211,238,0.8)]',
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

export function Button({ variant = 'ghost', size = 'md', icon, square = false, children, className = '', disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.03, y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      className={`focus-ring inline-flex shrink-0 cursor-pointer items-center justify-center border font-semibold tracking-wide transition-[background-color,box-shadow,border-color,color] duration-200 select-none disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${VARIANTS[variant]} ${square ? SQUARE_SIZES[size] : SIZES[size]} ${className}`}
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
  default: 'text-violet-200/70 hover:text-white hover:bg-white/10',
  danger: 'text-rose-300/70 hover:text-rose-200 hover:bg-rose-500/15',
  cyber: 'text-cyan-300/80 hover:text-cyan-100 hover:bg-cyan-500/15',
};

export function IconButton({ label, children, tone = 'default', className = '', type = 'button', ...rest }: IconButtonProps) {
  return (
    <motion.button
      type={type}
      aria-label={label}
      title={label}
      whileHover={{ scale: 1.12 }}
      whileTap={{ scale: 0.88 }}
      transition={{ type: 'spring', stiffness: 600, damping: 25 }}
      className={`focus-ring grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${ICON_TONES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
