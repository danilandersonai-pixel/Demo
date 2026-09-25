import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';
import { AVATARS } from '../../game/icons';
import type { AvatarId } from '../../types';

/** Число, которое плавно «докручивается» до нового значения. */
export function AnimatedNumber({ value, className = '' }: { value: number; className?: string }) {
  const motionValue = useMotionValue(value);
  const display = useTransform(motionValue, (v) => Math.round(v).toLocaleString('ru-RU'));

  useEffect(() => {
    const controls = animate(motionValue, value, { duration: 0.7, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [motionValue, value]);

  return <motion.span className={`tabular-nums ${className}`}>{display}</motion.span>;
}

interface PanelProps {
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}

/** Стеклянная панель с заголовком и мягким появлением. */
export function Panel({ title, icon, actions, children, className = '', delay = 0 }: PanelProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`glass relative rounded-2xl p-4 sm:p-5 ${className}`}
    >
      {(title || actions) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="flex items-center gap-2 font-display text-sm tracking-[0.14em] text-violet-100 uppercase">
              {icon}
              {title}
            </h2>
          )}
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      {children}
    </motion.section>
  );
}

const AVATAR_SIZES = {
  sm: { box: 'h-10 w-10 rounded-xl p-[2px]', icon: 20 },
  md: { box: 'h-16 w-16 rounded-2xl p-[2px]', icon: 32 },
  lg: { box: 'h-28 w-28 rounded-3xl p-[3px]', icon: 56 },
};

export function Avatar({ avatar, size = 'md', level }: { avatar: AvatarId; size?: 'sm' | 'md' | 'lg'; level?: number }) {
  const meta = AVATARS[avatar];
  const Icon = meta.icon;
  const dims = AVATAR_SIZES[size];
  return (
    <div className="relative shrink-0">
      <div className={`bg-gradient-to-br ${meta.gradient} ${dims.box} shadow-[0_0_30px_-6px_rgba(168,85,247,0.8)]`}>
        <div className="grid h-full w-full place-items-center rounded-[inherit] bg-[#0b0820]/90">
          <Icon size={dims.icon} className="text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.45)]" strokeWidth={1.6} />
        </div>
      </div>
      {level !== undefined && (
        <span className="absolute -right-2 -bottom-2 grid min-w-7 place-items-center rounded-lg border border-violet-300/50 bg-violet-600 px-1.5 py-0.5 font-display text-xs text-white shadow-[0_0_12px_rgba(168,85,247,0.9)]">
          {level}
        </span>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-violet-400/20 px-4 py-8 text-center"
    >
      <div className="text-violet-300/50">{icon}</div>
      <p className="text-sm font-semibold text-violet-100/80">{title}</p>
      <p className="max-w-xs text-xs text-violet-200/50">{hint}</p>
    </motion.div>
  );
}

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${className}`}>
      {children}
    </span>
  );
}
