import { useEffect, useRef } from 'react';

/**
 * Игровой таймер: один тик = один игровой день.
 * На скорости 1× интервал ровно 1 секунда, на 2× — 500 мс, на 4× — 250 мс.
 * Колбэк хранится в ref, поэтому интервал не пересоздаётся на каждом рендере.
 */
export function useGameLoop(onTick: () => void, active: boolean, speed: number): void {
  const callback = useRef(onTick);

  useEffect(() => {
    callback.current = onTick;
  }, [onTick]);

  useEffect(() => {
    if (!active || speed <= 0) return undefined;
    const id = window.setInterval(() => callback.current(), 1000 / speed);
    return () => window.clearInterval(id);
  }, [active, speed]);
}
