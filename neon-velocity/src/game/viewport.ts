/**
 * Раскладка экрана: холст занимает весь экран, а игровое поле — центральную
 * колонку фиксированной «мировой» ширины WORLD_W. Так сложность одинакова на
 * телефоне и на широком мониторе, а фон (небо, сетка) тянется на весь экран.
 */
import { REFERENCE_WORLD_H, WORLD_W } from './config';
import type { Viewport } from './types';

/** Поле не уже этого (в CSS-пикселях), если экран позволяет. */
const MIN_FIELD_W = 420;
/** Отношение ширины поля к высоте экрана на широких экранах. */
const FIELD_ASPECT = 0.66;

export function computeViewport(cssW: number, cssH: number, devicePixelRatio: number): Viewport {
  const w = Math.max(1, Math.floor(cssW));
  const h = Math.max(1, Math.floor(cssH));
  const fieldW = Math.min(w, Math.max(h * FIELD_ASPECT, Math.min(w, MIN_FIELD_W)));
  const scale = fieldW / WORLD_W;
  return {
    cssW: w,
    cssH: h,
    dpr: Math.min(Math.max(devicePixelRatio || 1, 1), 2),
    fieldX: (w - fieldW) / 2,
    fieldW,
    scale,
    worldW: WORLD_W,
    worldH: h / scale,
  };
}

/** Мировые координаты → CSS-пиксели относительно левого верхнего угла холста. */
export function worldToScreen(vp: Viewport, x: number, y: number): { x: number; y: number } {
  return { x: vp.fieldX + x * vp.scale, y: y * vp.scale };
}

/** clientX относительно холста (CSS-пиксели) → мировой X (без ограничения краями поля). */
export function screenToWorldX(vp: Viewport, cssX: number): number {
  return (cssX - vp.fieldX) / vp.scale;
}

/** Во сколько раз реальная высота мира больше эталонной — для нормировки скоростей. */
export function heightFactor(vp: Viewport): number {
  return vp.worldH / REFERENCE_WORLD_H;
}
