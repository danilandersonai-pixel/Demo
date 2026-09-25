import { AnimatePresence, animate, motion, useAnimationControls, useMotionValue, useTransform } from 'framer-motion';
import { Coins, Sparkle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AVATARS } from '../../game/icons';
import type { AvatarId } from '../../types';

/** Число, которое плавно «докручивается» до нового значения. */
export function AnimatedNumber({ value, className = '', pad = 0 }: { value: number; className?: string; pad?: number }) {
  const motionValue = useMotionValue(value);
  const display = useTransform(motionValue, (v) => {
    const rounded = Math.round(v);
    return pad > 0 ? String(rounded).padStart(pad, '0') : rounded.toLocaleString('ru-RU');
  });

  useEffect(() => {
    const controls = animate(motionValue, value, { duration: 0.8, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [motionValue, value]);

  return <motion.span className={`font-mono tabular-nums ${className}`}>{display}</motion.span>;
}

/** Анимация появления карточек: fade-in + slide-up. */
export const riseIn = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};

interface PanelProps {
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
  /** Номер уровня: при его росте вокруг панели вспыхивает неоновая рамка. */
  flashOnLevel?: number;
}

/** Стеклянная панель с заголовком и мягким появлением. */
export function Panel({ title, icon, actions, children, className = '', delay = 0, flashOnLevel }: PanelProps) {
  return (
    <motion.section
      {...riseIn}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`glass relative rounded-2xl p-4 sm:p-5 ${className}`}
    >
      {flashOnLevel !== undefined && <LevelUpFlash level={flashOnLevel} />}
      {(title || actions) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="flex items-center gap-2.5 font-display text-[12px] font-medium tracking-[0.16em] text-slate-100 uppercase">
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

/**
 * Неоновая рамка «Апгрейда»: вспыхивает примерно на секунду, когда уровень героя растёт.
 * Кладётся внутрь любого relative-контейнера со скруглением.
 */
export function LevelUpFlash({ level }: { level: number }) {
  const prev = useRef(level);
  const [flashId, setFlashId] = useState(0);

  useEffect(() => {
    if (level > prev.current) setFlashId((id) => id + 1);
    prev.current = level;
  }, [level]);

  return (
    <AnimatePresence>
      {flashId > 0 && (
        <motion.span
          key={flashId}
          aria-hidden="true"
          className="pointer-events-none absolute -inset-px z-20 rounded-[inherit] border-2 border-fuchsia-400 shadow-[0_0_28px_4px_rgba(217,70,239,0.75),inset_0_0_28px_rgba(34,211,238,0.45)]"
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.985, 1.012, 1, 1] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.15, times: [0, 0.18, 0.6, 1], ease: 'easeOut' }}
          onAnimationComplete={() => setFlashId(0)}
        />
      )}
    </AnimatePresence>
  );
}

/** Счётчик золота: янтарно-оранжевый градиент, мерцающие искры и отскок при изменении. */
export function GoldCounter({ value, size = 'md', suffix }: { value: number; size?: 'sm' | 'md' | 'lg'; suffix?: string }) {
  const controls = useAnimationControls();
  const prev = useRef(value);

  useEffect(() => {
    if (value !== prev.current) {
      void controls.start({ scale: [1, 1.12, 1], transition: { duration: 0.4 } });
    }
    prev.current = value;
  }, [value, controls]);

  const dims = {
    sm: { box: 'gap-2 px-2.5 py-1.5', coin: 'h-6 w-6', icon: 13, text: 'text-base' },
    md: { box: 'gap-2.5 px-3 py-2', coin: 'h-7 w-7', icon: 15, text: 'text-lg' },
    lg: { box: 'gap-3 px-4 py-2.5', coin: 'h-9 w-9', icon: 19, text: 'text-2xl' },
  }[size];

  return (
    <motion.div
      animate={controls}
      className={`relative flex shrink-0 items-center rounded-xl border border-amber-400/25 bg-gradient-to-r from-amber-400/[0.08] to-orange-500/[0.12] ${dims.box}`}
      aria-label={`Золото: ${value}`}
    >
      <span className={`grid place-items-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 shadow-[0_0_16px_rgba(251,146,60,0.7)] ${dims.coin}`}>
        <Coins size={dims.icon} className="text-[#2a1703]" strokeWidth={2.4} />
      </span>
      <AnimatedNumber value={value} className={`gold-sheen font-bold tracking-wider ${dims.text}`} />
      {suffix && <span className="text-xs text-amber-200/60">{suffix}</span>}
      <Sparkle size={10} className="absolute -top-1 right-2 animate-twinkle fill-amber-200 text-amber-200" aria-hidden="true" />
      <Sparkle size={8} className="absolute right-0.5 bottom-0.5 animate-twinkle fill-orange-300 text-orange-300 [animation-delay:1.1s]" aria-hidden="true" />
    </motion.div>
  );
}

const AVATAR_SIZES = {
  sm: { box: 'h-10 w-10 rounded-xl p-[1.5px]', icon: 20 },
  md: { box: 'h-16 w-16 rounded-2xl p-[2px]', icon: 32 },
  lg: { box: 'h-28 w-28 rounded-3xl p-[2px]', icon: 54 },
};

export function Avatar({ avatar, size = 'md', level }: { avatar: AvatarId; size?: 'sm' | 'md' | 'lg'; level?: number }) {
  const meta = AVATARS[avatar];
  const Icon = meta.icon;
  const dims = AVATAR_SIZES[size];
  return (
    <div className="relative shrink-0">
      {size === 'lg' && (
        <motion.div
          aria-hidden="true"
          className="absolute -inset-3 rounded-[2rem] bg-[conic-gradient(from_0deg,rgba(217,70,239,0.55),rgba(34,211,238,0.45),rgba(99,102,241,0.5),rgba(217,70,239,0.55))] opacity-60 blur-xl"
          animate={{ rotate: 360 }}
          transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
        />
      )}
      <div className={`relative bg-gradient-to-br ${meta.gradient} ${dims.box} shadow-[0_0_24px_-6px_rgba(168,85,247,0.8)]`}>
        <div className="grid h-full w-full place-items-center rounded-[inherit] bg-[#0b0d17]/90">
          <Icon size={dims.icon} className="text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]" strokeWidth={1.5} />
        </div>
      </div>
      {level !== undefined && (
        <span className="absolute -right-2 -bottom-2 grid min-w-7 place-items-center rounded-md border border-white/20 bg-gradient-to-br from-fuchsia-500 to-indigo-600 px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wider text-white shadow-[0_0_12px_rgba(192,38,211,0.9)]">
          {level}
        </span>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <motion.div
      {...riseIn}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/[0.1] px-4 py-8 text-center"
    >
      <div className="text-slate-500">{icon}</div>
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      <p className="max-w-xs text-xs text-slate-400">{hint}</p>
    </motion.div>
  );
}

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider ${className}`}>
      {children}
    </span>
  );
}
