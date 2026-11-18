/**
 * Движение объектов как чистые функции тика. Ничего не накапливается: зная
 * arriveTick и approachTicks, положение можно вычислить для любого момента,
 * в том числе дробного (рендер передаёт tick + alpha) и будущего (генератор
 * трека и тесты проверяют честность наперёд).
 */
import { GAME, WORLD } from './config';
import { clamp, lerp, TAU } from './math';
import type { Crystal, Obstacle, Sway } from './types';

/** Глубина объекта: zFar в момент появления, 0 в arriveTick, отрицательная — уже за кораблём. */
export function depthAt(arriveTick: number, approachTicks: number, t: number): number {
  return (WORLD.zFar * (arriveTick - t)) / approachTicks;
}

/** Скорость сближения, единиц за тик. */
export function speedPerTick(approachTicks: number): number {
  return WORLD.zFar / approachTicks;
}

/** Смещение от «виляния»: ровно 0 в момент прилёта, так что spec.x — точка прилёта. */
export function swayOffset(sway: Sway | null, arriveTick: number, t: number): number {
  if (!sway) return 0;
  return sway.amp * (Math.sin((TAU * (t - arriveTick)) / sway.periodTicks + sway.phase) - Math.sin(sway.phase));
}

/** Пределы, в которых может находиться центр объекта с полушириной halfW. */
function clampToRoad(x: number, halfW: number): number {
  return clamp(x, halfW, WORLD.roadW - halfW);
}

/** X препятствия (для laser — центр прохода) в тик t. */
export function obstacleX(o: Pick<Obstacle, 'x' | 'sway' | 'arriveTick' | 'halfW'>, t: number): number {
  return clampToRoad(o.x + swayOffset(o.sway, o.arriveTick, t), o.halfW);
}

/** Угол поворота куба в тик t. */
export function yawAt(o: Pick<Obstacle, 'yaw0' | 'yawRate' | 'arriveTick'>, t: number): number {
  return o.yaw0 + o.yawRate * (t - o.arriveTick);
}

/** X сферы без магнита. */
export function crystalBaseX(c: Pick<Crystal, 'x' | 'sway' | 'arriveTick'>, t: number): number {
  return clampToRoad(c.x + swayOffset(c.sway, c.arriveTick, t), GAME.crystal.radius);
}

/** X сферы с магнитом; alpha — доля тика для интерполяции (1 = текущий тик). */
export function crystalX(c: Crystal, t: number, alpha = 1): number {
  return crystalBaseX(c, t) + lerp(c.prevPull, c.pull, alpha);
}

/** Радиус сферы. */
export function crystalRadius(rare: boolean): number {
  return rare ? GAME.crystal.rareRadius : GAME.crystal.radius;
}

/** Полуширина зоны подбора по x и по z. */
export function pickupReach(rare: boolean): number {
  return crystalRadius(rare) + GAME.player.radius + GAME.crystal.pickupPad;
}
