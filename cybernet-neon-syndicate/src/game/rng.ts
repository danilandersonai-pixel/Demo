// Детерминированный генератор случайных чисел (mulberry32).
// Семя хранится в состоянии игры, поэтому reducer остаётся чистой функцией:
// одинаковое состояние + одинаковое действие = одинаковый результат.

export interface Rng {
  next(): number;
  chance(probability: number): boolean;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  gauss(): number;
  readonly seed: number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    chance(probability: number): boolean {
      return next() < probability;
    },
    int(min: number, max: number): number {
      return Math.floor(min + next() * (max - min + 1));
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.min(items.length - 1, Math.floor(next() * items.length))];
    },
    gauss(): number {
      // Преобразование Бокса — Мюллера.
      const u = Math.max(next(), 1e-9);
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    get seed(): number {
      return state;
    },
  };
}

/** Новое семя для новой игры (вызывается вне reducer). */
export function freshSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}
