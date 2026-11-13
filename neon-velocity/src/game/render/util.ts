/**
 * Общие помощники рендера: офскрин-холсты, детерминированный шум и кэш
 * «раскалённых» оттенков. Всё, что можно посчитать один раз, считается один раз:
 * в горячем цикле нельзя плодить строки цветов и массивы.
 */
import { lighten } from '../math';

export interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** Офскрин-холст заданного размера в физических пикселях. */
export function createSurface(width: number, height: number): Surface | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

/**
 * Масштаб офскрин-кэша: как у экрана (dpr), но не больше бюджета пикселей —
 * на огромных мониторах кэш чуть мягче, зато не съедает сотни мегабайт видеопамяти.
 */
export function cacheScale(cssW: number, cssH: number, dpr: number, maxPixels: number): number {
  const area = Math.max(1, cssW * cssH);
  return Math.min(dpr, Math.sqrt(maxPixels / area));
}

/** Освободить память офскрин-холста (браузер держит буфер, пока жив элемент). */
export function releaseSurface(surface: Surface | null): void {
  if (!surface) return;
  surface.canvas.width = 0;
  surface.canvas.height = 0;
}

/** Быстрый детерминированный шум 0..1 от числа — для мерцаний без Math.random. */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Строка → 32-битное зерно (темы получают свои «случайные» горы и звёзды). */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Генератор mulberry32: одинаковая картинка фона при каждой перестройке кэша. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Остаток от деления, всегда неотрицательный (для прокрутки назад). */
export function wrap(value: number, period: number): number {
  const r = value % period;
  return r < 0 ? r + period : r;
}

/** Насколько «раскалённая» сердцевина неонового цвета ближе к белому. */
export const HOT_AMOUNT = 0.62;
const HOT_CACHE_LIMIT = 256;
const hotCache = new Map<string, string>();

/**
 * «Раскалённая» сердцевина неонового цвета — почти белая с оттенком.
 * Кэшируется: частицы и всплывашки спрашивают её каждый кадр.
 */
export function hotColor(color: string): string {
  const cached = hotCache.get(color);
  if (cached !== undefined) return cached;
  if (hotCache.size >= HOT_CACHE_LIMIT) hotCache.clear();
  const value = lighten(color, HOT_AMOUNT);
  hotCache.set(color, value);
  return value;
}

/** Постоянный набор штрихов для пунктиров: setLineDash не должен получать новый массив каждый кадр. */
export const DASH_MAGNET: number[] = [6, 7];
export const DASH_RANGE: number[] = [3, 9];
export const NO_DASH: number[] = [];
