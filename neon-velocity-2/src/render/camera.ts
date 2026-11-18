/**
 * Камера: перспективная проекция дороги на экран. Одна и та же математика
 * нужна рендеру (рисовать) и вводу (перевести палец/курсор в X на дороге),
 * поэтому она вынесена в контракт.
 *
 * Камера смотрит вдоль дороги. Точка на дороге (x, z) с высотой y проецируется
 * с масштабом s = D / (D + z): на линии корабля (z = 0) s = 1, у дальней
 * границы появления объектов (z = zFar) s ≈ 0.28, на бесконечности — горизонт.
 */
import { WORLD } from '../core/config';

/** Расстояние от камеры до линии корабля, единицы мира. */
export const CAMERA_D = 156;

export interface Camera {
  /** Размер холста в CSS-пикселях. */
  cssW: number;
  cssH: number;
  /** Плотность пикселей (не больше 2). */
  dpr: number;
  /** Экранный X оси дороги. */
  cx: number;
  /** Экранный Y горизонта и линии корабля. */
  horizonY: number;
  lineY: number;
  /** CSS-пикселей на единицу мира на линии корабля. */
  unit: number;
}

export interface Projected {
  x: number;
  y: number;
  /** CSS-пикселей на единицу мира в этой точке. */
  scale: number;
}

export function makeCamera(cssW: number, cssH: number, devicePixelRatio: number): Camera {
  const w = Math.max(1, Math.floor(cssW));
  const h = Math.max(1, Math.floor(cssH));
  const portrait = h >= w;
  const horizonY = h * (portrait ? 0.3 : 0.34);
  const lineY = h * (portrait ? 0.8 : 0.82);
  const span = lineY - horizonY;
  // Дорога на линии корабля: почти во всю ширину телефона, но не шире «красивой» трапеции.
  const roadHalf = Math.min(w * 0.47, span * (portrait ? 0.62 : 1.05));
  return {
    cssW: w,
    cssH: h,
    dpr: Math.min(Math.max(devicePixelRatio || 1, 1), 2),
    cx: w / 2,
    horizonY,
    lineY,
    unit: roadHalf / (WORLD.roadW / 2),
  };
}

/** Перспективный масштаб на глубине z (z > −CAMERA_D). */
export function depthScale(z: number): number {
  return CAMERA_D / (CAMERA_D + Math.max(z, -CAMERA_D * 0.9));
}

/** Мир → экран (CSS-пиксели). y — высота над дорогой. */
export function project(cam: Camera, x: number, y: number, z: number, out: Projected = { x: 0, y: 0, scale: 0 }): Projected {
  const s = depthScale(z);
  out.scale = cam.unit * s;
  out.x = cam.cx + (x - WORLD.roadW / 2) * out.scale;
  out.y = cam.horizonY + (cam.lineY - cam.horizonY) * s - y * out.scale;
  return out;
}

/** Экранный X (CSS-пиксели от левого края холста) → X на дороге на линии корабля. */
export function screenToRoadX(cam: Camera, cssX: number): number {
  return WORLD.roadW / 2 + (cssX - cam.cx) / cam.unit;
}

/** X на дороге на линии корабля → экранный X. */
export function roadToScreenX(cam: Camera, x: number): number {
  return cam.cx + (x - WORLD.roadW / 2) * cam.unit;
}
