/**
 * Воспроизводимый генератор случайных чисел (mulberry32). Симуляция и генератор
 * трека берут случайность только отсюда — никакого Math.random: одно зерно и
 * один и тот же ввод обязаны давать один и тот же забег.
 */
export interface Rng {
  /** Равномерно в [0, 1). */
  next(): number;
  /** Равномерно в [min, max). */
  range(min: number, max: number): number;
  /** Целое в [min, max] включительно. */
  int(min: number, max: number): number;
  /** true с вероятностью p. */
  chance(p: number): boolean;
  /** Случайный элемент. */
  pick<T>(items: readonly T[]): T;
  /** Случайный элемент с весами; веса ≤ 0 не выбираются. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
  /** Независимый поток случайности, выведенный из этого (например, на каждый такт). */
  fork(salt: number): Rng;
}

function hash32(a: number): number {
  let x = a | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

export function createRng(seed: number): Rng {
  let s = hash32(Math.floor(seed) ^ 0x9e3779b9) || 1;
  const next = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (items, weight) => {
      let total = 0;
      for (const item of items) total += Math.max(0, weight(item));
      let r = next() * total;
      for (const item of items) {
        r -= Math.max(0, weight(item));
        if (r <= 0) return item;
      }
      return items[items.length - 1];
    },
    fork: (salt) => createRng(hash32(s ^ Math.imul(Math.floor(salt) + 1, 0x27d4eb2d))),
  };
  return rng;
}

/** Зерно для нового забега (единственное место, где берётся настоящая случайность). */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
