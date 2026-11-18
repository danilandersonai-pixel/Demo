/** Форматирование чисел, дат и времени для интерфейса. */

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** 1234567 → «1 234 567». */
export function formatNumber(n: number): string {
  return numberFormat.format(Math.floor(Math.max(0, n)));
}

/**
 * Аркадный счёт с ведущими нулями: 12450 → { lead: '00', digits: '12450' }.
 * lead рисуют приглушённо, digits — ярко.
 */
export function padScore(n: number, width = 7): { lead: string; digits: string } {
  const digits = String(Math.floor(Math.max(0, n)));
  return { lead: digits.length < width ? '0'.repeat(width - digits.length) : '', digits };
}

/** 1.284 → «×1.28». */
export function formatSpeed(mult: number): string {
  return '×' + mult.toFixed(2);
}

/** 125.4 → «2:05». */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** ISO → { date: '25.09.2026', time: '18:42' }. */
export function formatDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '—', time: '' };
  return { date: dateFormat.format(d), time: timeFormat.format(d) };
}

/** Склонение: plural(5, ['кристалл', 'кристалла', 'кристаллов']) → «кристаллов». */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(Math.floor(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
