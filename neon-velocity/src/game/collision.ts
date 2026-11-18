/**
 * Хитбоксы препятствий против круга игрока. Хитбоксы чуть меньше нарисованных
 * фигур (GAME.hitbox) — задевание «краешком» прощается, так честнее.
 *
 * - куб — повёрнутый квадрат (OBB) с половиной стороны size · hitbox.cube;
 * - пила — круг радиуса size · hitbox.saw;
 * - лазер — горизонтальная полоса толщиной 2 · size во всю ширину поля
 *   с проходом [x − gapW/2, x + gapW/2]; радиус игрока для лазера — r · hitbox.laser.
 */
import { GAME } from './config';
import type { Obstacle, ObstacleKind } from './types';

/** Половина стороны квадрата-хитбокса куба. */
export function cubeHalf(o: Obstacle): number {
  return o.size * GAME.hitbox.cube;
}

/** Радиус хитбокса пилы. */
export function sawRadius(o: Obstacle): number {
  return o.size * GAME.hitbox.saw;
}

/** Радиус игрока, с которым сравнивается лазер. */
export function laserPlayerRadius(r: number): number {
  return r * GAME.hitbox.laser;
}

/**
 * Полуразмер хитбокса по X и по Y при ЛЮБОМ повороте — для планирования
 * проходов (куб крутится, поэтому берётся полудиагональ). Для лазера это
 * половина толщины луча: по X он перекрывает всё поле, кроме прохода.
 */
export function hitboxExtent(kind: ObstacleKind, size: number): number {
  if (kind === 'cube') return size * GAME.hitbox.cube * Math.SQRT2;
  if (kind === 'saw') return size * GAME.hitbox.saw;
  return size;
}

/** Полуразмер хитбокса препятствия при любом повороте (см. hitboxExtent). */
export function obstacleExtent(o: Obstacle): number {
  return hitboxExtent(o.kind, o.size);
}

/**
 * Знаковое расстояние от точки до прямоугольника, заданного «выступами»
 * dx, dy (> 0 — точка снаружи по этой оси, < 0 — внутри на столько).
 */
function outsideDistance(dx: number, dy: number): number {
  if (dx > 0 || dy > 0) {
    const ox = dx > 0 ? dx : 0;
    const oy = dy > 0 ? dy : 0;
    return Math.sqrt(ox * ox + oy * oy);
  }
  return dx > dy ? dx : dy;
}

/** Знаковое расстояние от точки до повёрнутого квадрата с половиной стороны h. */
function boxDistance(px: number, py: number, o: Obstacle, h: number): number {
  const dx = px - o.x;
  const dy = py - o.y;
  const c = Math.cos(o.rotation);
  const s = Math.sin(o.rotation);
  // Переводим точку в локальные оси квадрата (поворот на −rotation).
  const lx = Math.abs(dx * c + dy * s) - h;
  const ly = Math.abs(-dx * s + dy * c) - h;
  return outsideDistance(lx, ly);
}

/** Знаковое расстояние от точки до ближайшей из двух половин лазерного луча. */
function laserDistance(px: number, py: number, o: Obstacle): number {
  const dy = Math.abs(py - o.y) - o.size;
  const half = o.gapW / 2;
  // Левая половина луча — всё левее x − gapW/2, правая — всё правее x + gapW/2.
  const left = outsideDistance(px - (o.x - half), dy);
  const right = outsideDistance(o.x + half - px, dy);
  return left < right ? left : right;
}

/**
 * Зазор между хитбоксом препятствия и кругом игрока (cx, cy, r):
 * > 0 — не касаются, < 0 — пересекаются. Используется для near miss.
 */
export function obstacleClearance(o: Obstacle, cx: number, cy: number, r: number): number {
  if (o.kind === 'cube') return boxDistance(cx, cy, o, cubeHalf(o)) - r;
  if (o.kind === 'saw') {
    const dx = cx - o.x;
    const dy = cy - o.y;
    return Math.sqrt(dx * dx + dy * dy) - sawRadius(o) - r;
  }
  return laserDistance(cx, cy, o) - laserPlayerRadius(r);
}

/** Столкновение препятствия с кругом игрока. */
export function obstacleHitsCircle(o: Obstacle, cx: number, cy: number, r: number): boolean {
  if (o.kind === 'laser') {
    // По спецификации: игрок пересекает полосу по Y и хотя бы частично вне прохода.
    const rl = laserPlayerRadius(r);
    if (Math.abs(cy - o.y) >= o.size + rl) return false;
    const half = o.gapW / 2;
    return cx - rl < o.x - half || cx + rl > o.x + half;
  }
  return obstacleClearance(o, cx, cy, r) < 0;
}

/** Пересекаются ли два круга. */
export function circlesOverlap(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy < rr * rr;
}
