// Детерминированный генератор (mulberry32). Его состояние хранится прямо в
// GameState, поэтому офлайн-догонялка и тесты воспроизводимы.

import type { GameState } from './types';

export function rand(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Нормальное распределение N(0, 1) по Боксу — Мюллеру. */
export function gauss(s: GameState): number {
  const u = Math.max(rand(s), 1e-12);
  const v = rand(s);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function randInt(s: GameState, min: number, max: number): number {
  return min + Math.floor(rand(s) * (max - min + 1));
}

export function newSeed(): number {
  return (Math.floor(Math.random() * 4294967296) ^ Date.now()) >>> 0;
}
