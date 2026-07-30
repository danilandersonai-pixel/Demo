// Сидируемый ГПСЧ (mulberry32) и детерминированное комбинирование сидов.
// Никаких Math.random/Date.now в симуляции: вся случайность — отсюда.

/**
 * mulberry32 — быстрый 32-битный ГПСЧ. Один seed → одна и та же
 * последовательность чисел в [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Детерминированная свёртка двух 32-битных значений в новый сид.
 * Используется, чтобы каждый матч получал независимый поток случайности,
 * не зависящий от порядка матчей в турнире.
 */
export function combineSeed(a, b) {
  let h = (a >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (b >>> 0), 2654435761) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Свёртка произвольного числа компонентов: combineSeedAll(seed, gen, i, j). */
export function combineSeedAll(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) h = combineSeed(h, p);
  return h;
}
