export function fmt(n: number, digits = 1): string {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(digits) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(digits) + 'k';
  if (a >= 1000) return (n / 1e3).toFixed(digits) + 'k';
  if (a >= 100) return Math.round(n).toString();
  if (a >= 10) return n.toFixed(0);
  if (a === 0) return '0';
  return n.toFixed(a < 1 ? 2 : 1).replace(/\.0+$/, '');
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

export function signed(n: number, digits = 1): string {
  return (n >= 0 ? '+' : '−') + fmt(Math.abs(n), digits);
}

export function mw(kw: number): string {
  if (Math.abs(kw) >= 1000) return (kw / 1000).toFixed(kw >= 10000 ? 0 : 1) + ' MW';
  return Math.round(kw) + ' kW';
}

export function pct(x: number): string {
  return Math.round(x * 100) + '%';
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function gameTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
