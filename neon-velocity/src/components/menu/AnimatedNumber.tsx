import { animate, motion, useMotionValue, useReducedMotionConfig, useTransform } from 'framer-motion';
import { useEffect } from 'react';
import { formatNumber } from '../ui/format';

export interface AnimatedNumberProps {
  value: number;
  /** Длительность «прокрутки» к новому значению, сек. */
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}

/**
 * Число, которое «докручивается» до нового значения. Пишет текст прямо в DOM
 * через MotionValue — без ререндеров React на каждом кадре анимации.
 */
export function AnimatedNumber({ value, duration = 0.7, format = formatNumber, className = '' }: AnimatedNumberProps) {
  const reduce = useReducedMotionConfig();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(Math.round(v)));

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [mv, value, duration, reduce]);

  return <motion.span className={className}>{text}</motion.span>;
}
