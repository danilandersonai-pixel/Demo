// Форматирование чисел в русской локали: запятая как десятичный разделитель,
// неразрывный пробел между разрядами, большие числа — «тыс», «млн», «млрд».

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

const UNITS: Array<[number, string]> = [
  [1e15, 'квдр'],
  [1e12, 'трлн'],
  [1e9, 'млрд'],
  [1e6, 'млн'],
  [1e3, 'тыс'],
];

function byMagnitude(x: number): string {
  const a = Math.abs(x);
  if (a >= 100) return nf0.format(x);
  if (a >= 10) return nf1.format(x);
  return nf2.format(x);
}

/** Число целиком до 100 000, дальше — сокращённо. */
export function num(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e5) {
    for (const [v, u] of UNITS) {
      if (a >= v) return `${byMagnitude(n / v)} ${u}`;
    }
  }
  if (a > 0 && a < 0.005) return '0';
  return byMagnitude(n);
}

/** Целое число с разрядами (для счётчиков). */
export function int(n: number): string {
  return nf0.format(Math.floor(n));
}

export function money(n: number): string {
  return n < 0 ? `−$${num(-n)}` : `$${num(n)}`;
}

export function signed(n: number): string {
  if (Math.abs(n) < 0.005) return '±0';
  return n > 0 ? `+${num(n)}` : `−${num(-n)}`;
}

export function perSec(n: number): string {
  return `${signed(n)}/с`;
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function clock(ticks: number): string {
  const h = Math.floor(ticks / 3600);
  const m = Math.floor((ticks % 3600) / 60);
  const s = Math.floor(ticks % 60);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `T+${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function duration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  if (m > 0) return r > 0 ? `${m} мин ${r} с` : `${m} мин`;
  return `${r} с`;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export function roman(n: number): string {
  return ROMAN[n] ?? String(n);
}
