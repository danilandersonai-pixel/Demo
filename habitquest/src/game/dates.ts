import type { DateKey } from '../types';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toDateKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(key: DateKey, days: number): DateKey {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

/** Сколько суток от a до b (b позже → положительное число). */
export function diffDays(a: DateKey, b: DateKey): number {
  const ms = parseDateKey(b).getTime() - parseDateKey(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** День недели с понедельника: 0 — Пн … 6 — Вс. */
export function weekdayIndex(key: DateKey): number {
  return (parseDateKey(key).getDay() + 6) % 7;
}

/** Текущий игровой день: реальная дата плюс сдвиг симуляции. */
export function gameToday(dayOffset: number): DateKey {
  return addDays(toDateKey(new Date()), dayOffset);
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
const shortFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const timeFormatter = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function formatLongDate(key: DateKey): string {
  return dateFormatter.format(parseDateKey(key));
}

export function formatShortDate(key: DateKey): string {
  return shortFormatter.format(parseDateKey(key));
}

export function formatTime(ts: number): string {
  return timeFormatter.format(new Date(ts));
}
