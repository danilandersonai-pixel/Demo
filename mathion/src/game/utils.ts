import type { Rng } from '../types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Целое число в диапазоне [min, max] включительно. */
export function randInt(rng: Rng, min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function pick<T>(rng: Rng, list: readonly T[]): T {
  const item = list[Math.floor(rng() * list.length)];
  if (item === undefined) throw new Error('pick: пустой список');
  return item;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function plural(value: number, forms: [string, string, string]): string {
  const abs = Math.abs(value) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export function formatSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1);
}
