import { animate, useReducedMotion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { fmt } from '../../game/format.ts';

interface AnimatedNumberProps {
  value: number;
  digits?: number;
  className?: string;
  format?: (value: number, digits: number) => string;
}

/**
 * Число, которое «докручивается» до нового значения (Framer Motion animate).
 * Текст пишется напрямую в DOM-узел, чтобы не перерисовывать React 60 раз в секунду.
 */
export function AnimatedNumber({ value, digits = 0, className, format = fmt }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = format(shown.current, digits);
    // Только первичная отрисовка; дальше работает анимация ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (reduce || Math.abs(value - shown.current) < 1e-9) {
      shown.current = value;
      node.textContent = format(value, digits);
      return undefined;
    }
    const controls = animate(shown.current, value, {
      duration: 0.55,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (latest) => {
        shown.current = latest;
        node.textContent = format(latest, digits);
      },
    });
    return () => controls.stop();
  }, [value, digits, format, reduce]);

  return <span ref={ref} className={className} />;
}
