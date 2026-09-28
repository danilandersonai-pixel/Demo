/**
 * Внутренние сущности движка и точное предсказание их падения.
 *
 * Всё падает со скоростью vy · speedMult · heightFactor, а speedMult растёт
 * скачком на границе уровня. Значит, путь — кусочно-линейная функция времени,
 * и её можно посчитать заранее без погрешности: генератор планирует ряды на
 * несколько секунд вперёд и проверяет честность по будущим позициям, а
 * повышение уровня посреди полёта не ломает расчёт.
 */
import { TAU } from './math';
import type { Crystal, Obstacle, Zigzag } from './types';

/** Препятствие с полями, которые нужны только движку. */
export interface SimObstacle extends Obstacle {
  /** Минимальный зазор до игрока за время пролёта (для near miss). */
  minClear: number;
}

/** Сфера с полями, которые нужны только движку. */
export interface SimCrystal extends Crystal {
  /** Скорость, набранная от магнита, ед/с. */
  mvx: number;
  mvy: number;
  /** Сфера уже засчитана как пропущенная. */
  missed: boolean;
}

export interface MotionModel {
  /** heightFactor(viewport): скорости заданы для эталонной высоты мира. */
  hf: number;
  /** Текущий speedMult. */
  mult: number;
  /** speedMult после ближайшего повышения уровня. */
  multNext: number;
  /** Секунды до повышения уровня; Infinity — его не будет (меню, конец забега). */
  toLevelUp: number;
}

/**
 * Путь «на единицу собственной скорости» за t секунд от текущего момента:
 * объект с собственной скоростью vy пройдёт vy · travel(m, t).
 */
export function travel(m: MotionModel, t: number): number {
  if (t <= 0) return 0;
  if (t <= m.toLevelUp) return m.hf * m.mult * t;
  return m.hf * (m.mult * m.toLevelUp + m.multNext * (t - m.toLevelUp));
}

/** За сколько секунд объект с собственной скоростью vy пройдёт путь d. */
export function timeToTravel(m: MotionModel, vy: number, d: number): number {
  if (d <= 0) return 0;
  const need = d / vy;
  const beforeLevelUp = m.toLevelUp === Infinity ? Infinity : m.hf * m.mult * m.toLevelUp;
  if (need <= beforeLevelUp) return need / (m.hf * m.mult);
  return m.toLevelUp + (need - beforeLevelUp) / (m.hf * m.multNext);
}

/** Смещение зигзага по X в возрасте age: amp · sin(2π · freq · age + phase). */
export function zigzagOffset(z: Zigzag | null, age: number): number {
  return z ? z.amp * Math.sin(TAU * z.freq * age + z.phase) : 0;
}

/** Минимум и максимум sin(θ) на отрезке [a, b] (a ≤ b). Пишет в out[0], out[1]. */
function sinRange(a: number, b: number, out: [number, number]): void {
  if (b - a >= TAU) {
    out[0] = -1;
    out[1] = 1;
    return;
  }
  const sa = Math.sin(a);
  const sb = Math.sin(b);
  let lo = sa < sb ? sa : sb;
  let hi = sa < sb ? sb : sa;
  // Ближайшие к a вершины синусоиды: максимум в π/2 + 2πk, минимум в −π/2 + 2πk.
  const peak = Math.PI / 2 + Math.ceil((a - Math.PI / 2) / TAU) * TAU;
  if (peak <= b) hi = 1;
  const trough = -Math.PI / 2 + Math.ceil((a + Math.PI / 2) / TAU) * TAU;
  if (trough <= b) lo = -1;
  out[0] = lo;
  out[1] = hi;
}

/**
 * Диапазон смещения зигзага за отрезок возраста [age0, age1]. Пишет в out;
 * без зигзага — [0, 0].
 */
export function zigzagRange(z: Zigzag | null, age0: number, age1: number, out: [number, number]): void {
  if (!z || z.amp <= 0) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  const k = TAU * z.freq;
  sinRange(k * age0 + z.phase, k * Math.max(age0, age1) + z.phase, out);
  out[0] *= z.amp;
  out[1] *= z.amp;
}
