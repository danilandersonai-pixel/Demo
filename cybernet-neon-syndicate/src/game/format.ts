// Форматирование чисел в стиле терминала: разряды через тонкий пробел, точка как разделитель.

const THIN = ' ';
const MINUS = '−';

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

/** 12 480 · 124.5K · 1.24M · 3.1B. Отрицательные — с настоящим знаком минуса. */
export function fmt(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? MINUS : '';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e5) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  const fixed = abs.toFixed(digits);
  const [intPart, frac] = fixed.split('.');
  const rounded = frac && /^0+$/.test(frac) ? '' : frac;
  const text = rounded ? `${group(intPart)}.${rounded}` : group(intPart);
  return text === '0' ? '0' : `${sign}${text}`;
}

/** Скорость изменения: +15.2 / −3.4 / ±0. */
export function fmtRate(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.05) return '±0';
  const digits = Math.abs(value) < 100 ? 1 : 0;
  return `${value > 0 ? '+' : ''}${fmt(value, digits)}`;
}

/** Процент от доли: 0.15 → «+15%». */
export function fmtPct(value: number, signed = true): string {
  const pct = Math.round(value * 100);
  if (!signed) return `${pct}%`;
  return `${pct > 0 ? '+' : pct < 0 ? MINUS : ''}${Math.abs(pct)}%`;
}

export function padDay(day: number, width = 4): string {
  return String(Math.max(0, Math.floor(day))).padStart(width, '0');
}

/** Склонение: plural(5, ['день', 'дня', 'дней']). */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.floor(n)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export function days(n: number): string {
  return `${n} ${plural(n, ['день', 'дня', 'дней'])}`;
}
