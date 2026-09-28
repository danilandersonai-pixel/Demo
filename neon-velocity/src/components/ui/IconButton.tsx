import { motion, type HTMLMotionProps } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { playUiSound, type UiSound } from '../../game/uiSound';
import type { NeonVariant } from './NeonButton';

const VARIANT: Record<NeonVariant, string> = {
  pink: 'text-neon-pink box-glow-pink hover:bg-neon-pink/15',
  cyan: 'text-neon-cyan box-glow-cyan hover:bg-neon-cyan/15',
  yellow: 'text-neon-yellow box-glow-yellow hover:bg-neon-yellow/15',
  theme: 'text-theme-a box-glow-theme hover:bg-theme-a/15',
  ghost: 'text-ink-dim border border-ink-faint/60 hover:text-ink hover:border-ink-dim hover:bg-white/5',
};

export interface IconButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  icon: LucideIcon;
  /** Обязательная подпись для скринридеров и всплывающей подсказки. */
  label: string;
  variant?: NeonVariant;
  size?: 'sm' | 'md';
  sound?: UiSound | null;
}

/** Квадратная неоновая кнопка с иконкой (пауза, звук, закрыть). */
export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 'md',
  sound = 'click',
  className = '',
  onClick,
  disabled,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <motion.button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.08 }}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
      onClick={(e) => {
        if (!disabled && sound) playUiSound(sound);
        onClick?.(e);
      }}
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-[3px] bg-void/60 transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-9 w-9' : 'h-11 w-11',
        VARIANT[variant],
        className,
      ].join(' ')}
      {...rest}
    >
      <Icon size={size === 'sm' ? 16 : 20} strokeWidth={2.25} aria-hidden />
    </motion.button>
  );
}
