import { motion, type HTMLMotionProps } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { playUiSound } from '../../game/uiSound';

export type ShopButtonTone = 'pink' | 'cyan' | 'yellow' | 'theme' | 'red' | 'ghost' | 'done' | 'locked';

// Полные строки классов — чтобы Tailwind их увидел при сборке.
const TONE: Record<ShopButtonTone, string> = {
  pink: 'text-neon-pink box-glow-pink hover:bg-neon-pink/15 [&_.sb-label]:text-glow-pink',
  cyan: 'text-neon-cyan box-glow-cyan hover:bg-neon-cyan/15 [&_.sb-label]:text-glow-cyan',
  yellow: 'text-neon-yellow box-glow-yellow hover:bg-neon-yellow/15 [&_.sb-label]:text-glow-yellow',
  theme: 'text-theme-a box-glow-theme hover:bg-theme-a/15 [&_.sb-label]:text-glow-theme',
  red: 'text-neon-red border border-neon-red/80 shadow-[0_0_14px_rgba(255,59,107,0.45),inset_0_0_12px_rgba(255,59,107,0.2)] hover:bg-neon-red/15 [&_.sb-label]:text-glow-red',
  ghost: 'text-ink-dim border border-ink-faint/60 hover:text-ink hover:border-ink-dim hover:bg-white/5',
  done: 'text-neon-green border border-neon-green/45 bg-neon-green/[0.06] cursor-default',
  locked: 'text-ink-faint border border-dashed border-ink-faint/60 cursor-not-allowed',
};

const SIZE = {
  sm: 'h-9 gap-1.5 px-3 text-[11px]',
  md: 'h-10 gap-2 px-4 text-xs',
} as const;

export interface ShopButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  tone: ShopButtonTone;
  icon?: LucideIcon;
  size?: keyof typeof SIZE;
  /**
   * Кнопка видна и фокусируема, но действие недоступно (aria-disabled): фокус
   * не теряется, когда «Купить» превращается в «Надето», а клик по «не хватает»
   * можно озвучить ошибкой.
   */
  inactive?: boolean;
  children: ReactNode;
}

/** Кнопка действия в карточке магазина и в опасной зоне настроек. */
export function ShopButton({
  tone,
  icon: Icon,
  size = 'md',
  inactive = false,
  className = '',
  onMouseEnter,
  children,
  type = 'button',
  ...rest
}: ShopButtonProps) {
  return (
    <motion.button
      type={type}
      aria-disabled={inactive || undefined}
      whileHover={inactive ? undefined : { scale: 1.04 }}
      whileTap={inactive ? undefined : { scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
      onMouseEnter={(e) => {
        if (!inactive) playUiSound('hover');
        onMouseEnter?.(e);
      }}
      className={[
        'relative inline-flex shrink-0 select-none items-center justify-center rounded-[3px] bg-void/60',
        'font-mono font-bold uppercase tracking-widest transition-colors duration-150',
        SIZE[size],
        TONE[tone],
        className,
      ].join(' ')}
      {...rest}
    >
      <span aria-hidden className="pointer-events-none absolute left-0 top-0 h-1.5 w-1.5 border-l-2 border-t-2 border-current" />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 h-1.5 w-1.5 border-b-2 border-r-2 border-current"
      />
      {Icon && <Icon size={size === 'sm' ? 13 : 15} strokeWidth={2.4} className="shrink-0" aria-hidden />}
      <span className="sb-label whitespace-nowrap">{children}</span>
    </motion.button>
  );
}
