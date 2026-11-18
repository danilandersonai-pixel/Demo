import { animate, motion, useMotionValue, useReducedMotionConfig, useTransform } from 'framer-motion';
import { useEffect } from 'react';
import { formatNumber } from '../kit/format';

/** Длительность «прокрутки» к новому значению, сек. */
const ROLL_SECONDS = 0.7;

export interface AnimatedNumberProps {
  value: number;
  className?: string;
}

/**
 * Число, которое «докручивается» до нового значения. Текст пишется прямо в DOM
 * через MotionValue — React не перерисовывается на каждом кадре анимации.
 *
 * Для скринридера число скрыто: во время прокрутки в DOM лежат промежуточные
 * значения. Итог вызывающий озвучивает сам — sr-only подписью со склонением.
 */
export function AnimatedNumber({ value, className = '' }: AnimatedNumberProps) {
  const reduce = useReducedMotionConfig();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => formatNumber(Math.round(v)));

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: ROLL_SECONDS, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [mv, value, reduce]);

  return (
    <motion.span aria-hidden className={className}>
      {text}
    </motion.span>
  );
}
