import { animate, motion, useMotionValue, useReducedMotionConfig, useTransform } from 'framer-motion';
import { useEffect } from 'react';
import { formatNumber } from '../kit/format';

export interface CountUpProps {
  value: number;
  /** Длительность набора и задержка перед ним, сек. */
  duration?: number;
  delay?: number;
  className?: string;
}

/**
 * Число, которое «набирается» от нуля до значения (счёт на экране Game Over).
 * Текст пишется прямо в DOM через MotionValue — React не перерисовывается на
 * кадрах анимации; набор конечен. Для скринридера число скрыто: итог
 * вызывающий озвучивает сам, sr-only подписью со склонением.
 */
export function CountUp({ value, duration = 1.1, delay = 0, className = '' }: CountUpProps) {
  const reduce = useReducedMotionConfig();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => formatNumber(Math.round(v)));

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration, delay, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [mv, value, reduce, duration, delay]);

  return (
    <motion.span aria-hidden className={className}>
      {text}
    </motion.span>
  );
}
