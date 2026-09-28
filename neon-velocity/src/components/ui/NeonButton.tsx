import { motion, type HTMLMotionProps } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { playUiSound, type UiSound } from '../../game/uiSound';
import { Kbd } from './Kbd';

export type NeonVariant = 'pink' | 'cyan' | 'yellow' | 'theme' | 'ghost';
export type NeonSize = 'sm' | 'md' | 'lg';

// Полные строки классов — чтобы Tailwind их увидел при сборке.
const VARIANT: Record<NeonVariant, string> = {
  pink: 'text-neon-pink box-glow-pink hover:bg-neon-pink/15 [&_.nv-label]:text-glow-pink',
  cyan: 'text-neon-cyan box-glow-cyan hover:bg-neon-cyan/15 [&_.nv-label]:text-glow-cyan',
  yellow: 'text-neon-yellow box-glow-yellow hover:bg-neon-yellow/15 [&_.nv-label]:text-glow-yellow',
  theme: 'text-theme-a box-glow-theme hover:bg-theme-a/15 [&_.nv-label]:text-glow-theme',
  ghost: 'text-ink-dim border border-ink-faint/60 hover:text-ink hover:border-ink-dim hover:bg-white/5',
};

const SIZE: Record<NeonSize, string> = {
  sm: 'h-9 gap-2 px-3 text-[11px]',
  md: 'h-11 gap-2.5 px-5 text-xs sm:text-sm',
  lg: 'h-14 gap-3 px-8 text-sm sm:text-base',
};

const ICON: Record<NeonSize, number> = { sm: 14, md: 17, lg: 20 };

export interface NeonButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: NeonVariant;
  size?: NeonSize;
  icon?: LucideIcon;
  /** Подсказка клавиши справа, например «Enter». */
  hotkey?: string;
  /** Звук нажатия (по умолчанию 'click'); null — без звука. */
  sound?: UiSound | null;
  fullWidth?: boolean;
  children: ReactNode;
}

/** Неоновая кнопка аркадного меню. */
export function NeonButton({
  variant = 'cyan',
  size = 'md',
  icon: Icon,
  hotkey,
  sound = 'click',
  fullWidth = false,
  className = '',
  disabled,
  onClick,
  onMouseEnter,
  children,
  type = 'button',
  ...rest
}: NeonButtonProps) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.035 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
      onMouseEnter={(e) => {
        if (!disabled) playUiSound('hover');
        onMouseEnter?.(e);
      }}
      onClick={(e) => {
        if (!disabled && sound) playUiSound(sound);
        onClick?.(e);
      }}
      className={[
        'group relative inline-flex select-none items-center justify-center rounded-[3px] bg-void/60',
        'font-mono font-bold uppercase tracking-widest transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none',
        fullWidth ? 'w-full' : '',
        SIZE[size],
        VARIANT[variant],
        className,
      ].join(' ')}
      {...rest}
    >
      {/* Уголки-засечки в стиле аркадного автомата. */}
      <span aria-hidden className="pointer-events-none absolute left-0 top-0 h-1.5 w-1.5 border-l-2 border-t-2 border-current" />
      <span aria-hidden className="pointer-events-none absolute bottom-0 right-0 h-1.5 w-1.5 border-b-2 border-r-2 border-current" />
      {Icon && <Icon size={ICON[size]} strokeWidth={2.25} className="shrink-0" aria-hidden />}
      <span className="nv-label whitespace-nowrap">{children}</span>
      {/* Обёртка прячет подсказку на телефонах: у самого Kbd свой display, и hidden на нём проигрывает. */}
      {hotkey && (
        <span className="ml-1 hidden sm:inline-flex">
          <Kbd>{hotkey}</Kbd>
        </span>
      )}
    </motion.button>
  );
}
