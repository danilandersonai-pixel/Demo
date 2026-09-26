// Форматирование чисел и игрового времени

import { START_HOUR } from './config.js';

export function gameTime(hour) {
  const total = hour + START_HOUR;
  const day = Math.floor(total / 24) + 1;
  const h = total % 24;
  return { day, hh: String(h).padStart(2, '0') + ':00' };
}

export function stamp(hour) {
  const t = gameTime(hour);
  return `Д${t.day} ${t.hh}`;
}

export function money(v, digits) {
  const sign = v < 0 ? '−' : '';
  const abs = Math.abs(v);
  let d = digits;
  if (d === undefined) d = abs >= 1000 ? 0 : abs >= 100 ? 0 : 2;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${abs.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function signedMoney(v, digits) {
  if (v > 0) return '+' + money(v, digits);
  return money(v, digits);
}

export function num(v, digits = 0) {
  return v.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function compact(v) {
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (abs >= 1e4) return (v / 1e3).toFixed(1) + 'k';
  return Math.round(v).toLocaleString('ru-RU');
}

export function pct(v, digits = 0) {
  return (v * 100).toFixed(digits) + '%';
}

export function hoursLabel(h) {
  if (h < 48) return `${h} ч`;
  const d = Math.floor(h / 24);
  const r = h % 24;
  return r ? `${d} д ${r} ч` : `${d} д`;
}
