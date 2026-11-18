/** Математика и цвета, общие для ядра и рендера. */

export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Плавное приближение к цели, не зависящее от шага. rate — 1/с. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/** Сдвинуть value к target не больше чем на step. */
export function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(value + step, target) : Math.max(value - step, target);
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp(t, 0, 1) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** 0 при x ≤ a, 1 при x ≥ b, плавно между. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// ─── Цвета ──────────────────────────────────────────────────────────────────

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const rgbCache = new Map<string, Rgb>();

/** '#rgb' или '#rrggbb' → {r, g, b}; результат кэшируется. */
export function hexToRgb(hex: string): Rgb {
  const cached = rgbCache.get(hex);
  if (cached) return cached;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  const rgb = Number.isFinite(n) ? { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 } : { r: 255, g: 255, b: 255 };
  rgbCache.set(hex, rgb);
  return rgb;
}

/** '#ff2bd6' + 0.4 → 'rgba(255,43,214,0.4)'. */
export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

function toHex2(v: number): string {
  const s = Math.round(clamp(v, 0, 255)).toString(16);
  return s.length === 1 ? '0' + s : s;
}

/** Смешать два hex-цвета: t = 0 → a, t = 1 → b. */
export function mixColor(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = clamp(t, 0, 1);
  return '#' + toHex2(lerp(ca.r, cb.r, k)) + toHex2(lerp(ca.g, cb.g, k)) + toHex2(lerp(ca.b, cb.b, k));
}

export function lighten(hex: string, amount: number): string {
  return mixColor(hex, '#ffffff', amount);
}

export function darken(hex: string, amount: number): string {
  return mixColor(hex, '#000000', amount);
}
