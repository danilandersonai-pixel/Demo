import { motion, useAnimate, type HTMLMotionProps } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { playUiSound, type UiSound } from '../../audio/uiSound';

export type ActionTone = 'buy' | 'equip' | 'done' | 'locked' | 'danger' | 'ghost';

// Полные строки классов — чтобы Tailwind увидел их при сборке.
const TONE: Record<ActionTone, string> = {
  buy: 'text-neon-yellow box-glow-yellow bg-neon-yellow/[0.07] hover:bg-neon-yellow/20',
  equip: 'text-neon-cyan box-glow-cyan bg-neon-cyan/[0.05] hover:bg-neon-cyan/20',
  done: 'cursor-default border border-neon-green/45 bg-neon-green/[0.07] text-neon-green',
  locked: 'cursor-not-allowed border border-dashed border-neon-red/45 bg-neon-red/[0.04] text-neon-red/85',
  danger: 'border border-neon-red/70 bg-neon-red/[0.08] text-neon-red shadow-[0_0_12px_rgba(255,59,107,0.3)] hover:bg-neon-red/20',
  ghost: 'border border-ink-faint/60 text-ink-dim hover:border-ink-dim hover:bg-white/5 hover:text-ink',
};

export interface ActionButtonProps extends Omit<HTMLMotionProps<'button'>, 'children' | 'ref'> {
  tone: ActionTone;
  icon?: LucideIcon;
  /**
   * Действие сейчас недоступно (не хватает кристаллов). Кнопка остаётся в порядке
   * Tab и читается скринридером — так о нехватке можно узнать с клавиатуры, —
   * но вместо действия отвечает звуком ошибки и «отказом» (дрожью).
   */
  unavailable?: boolean;
  /**
   * Это уже состояние, а не действие («Надето», «Максимум»). Кнопка остаётся тем
   * же элементом — фокус клавиатуры не теряется в момент покупки, — но не нажимается.
   */
  passive?: boolean;
  sound?: UiSound | null;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}

/** Кнопка действия карточки: купить, надеть, улучшить, сбросить. */
export function ActionButton({
  tone,
  icon: Icon,
  unavailable = false,
  passive = false,
  sound = 'click',
  className = '',
  onClick,
  children,
  type = 'button',
  ref,
  ...rest
}: ActionButtonProps) {
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  const idle = unavailable || passive;
  return (
    <motion.button
      ref={ref}
      type={type}
      aria-disabled={idle || undefined}
      whileHover={idle ? undefined : { scale: 1.03 }}
      whileTap={idle ? undefined : { scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 520, damping: 28 }}
      onMouseEnter={() => {
        if (!idle) playUiSound('hover');
      }}
      onClick={(e) => {
        if (passive) return;
        if (unavailable) {
          playUiSound('error');
          void animate(scope.current, { x: [0, -5, 5, -3, 3, 0] }, { duration: 0.32, ease: 'easeOut' });
          return;
        }
        if (sound) playUiSound(sound);
        onClick?.(e);
      }}
      className={[
        'relative inline-flex h-10 select-none items-center justify-center rounded-[3px] px-3',
        'font-mono text-[11px] font-bold uppercase tracking-wider transition-colors duration-150',
        TONE[tone],
        className,
      ].join(' ')}
      {...rest}
    >
      <span ref={scope} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
        {Icon && <Icon size={14} strokeWidth={2.4} className="shrink-0" aria-hidden />}
        {children}
      </span>
    </motion.button>
  );
}
