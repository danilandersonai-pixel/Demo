import { AnimatePresence, motion } from 'framer-motion';
import { fmtRate } from '../../game/format.ts';
import { cn } from './cn.ts';

interface FloatingDeltaProps {
  value: number;
  /** Номер тика: новая «всплывашка» на каждый игровой день. */
  tick: number;
  show: boolean;
  /** Длительность полёта; на высокой скорости короче, чтобы цифры не наслаивались. */
  duration?: number;
  unit?: string;
  className?: string;
}

/** Анимация дохода: «+15.2» всплывает над счётчиком и тает. */
export function FloatingDelta({ value, tick, show, duration = 1.1, unit = '', className }: FloatingDeltaProps) {
  const visible = show && Math.abs(value) >= 0.05;
  return (
    <span className={cn('pointer-events-none absolute', className)} aria-hidden>
      <AnimatePresence mode="popLayout">
        {visible ? (
          <motion.span
            key={tick}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: [0, 1, 1, 0], y: -18 }}
            exit={{ opacity: 0, transition: { duration: 0.05 } }}
            transition={{ duration, ease: 'easeOut', times: [0, 0.15, 0.6, 1] }}
            className={cn('absolute left-0 whitespace-nowrap font-mono text-xs font-semibold', value >= 0 ? 'text-credit' : 'text-danger')}
          >
            {fmtRate(value)}
            {unit}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
