/**
 * Проба препятствия на сетке честности: какие клетки поперёк дороги оно
 * перекрывает в заданный момент. Сетка та же, что у verifyChart (клетка — 1 ед.,
 * центр корабля ходит от edge до roadW − edge).
 *
 * Ответ — тот же, что дал бы перебор клеток через contactAt с запасом margin,
 * но в замкнутом виде и за постоянное время. «Корабль ближе запаса к
 * прямоугольнику» — это прямоугольник со скруглёнными углами, а путь корабля
 * поперёк дороги — прямая; их пересечение — один отрезок. Пробой пользуются и
 * коридор генератора (chart-corridor.ts), и бот-планировщик (bot.ts): оба видят
 * препятствие одинаково, на этом держится правило «честный трек не запирает».
 */
import { depthReach } from './collision';
import { GAME, WORLD } from './config';
import { depthAt, obstacleX, yawAt } from './motion';
import type { Obstacle } from './types';

/** Ширина клетки, единицы дороги. */
export const CELL = 1;
/** Клеток поперёк дороги. */
export const CELLS = Math.floor((WORLD.roadW - 2 * GAME.player.edge) / CELL) + 1;

/** X центра клетки. */
export function cellX(cell: number): number {
  return GAME.player.edge + cell * CELL;
}

/** Ближайшая клетка к X (с зажимом в дорогу). */
export function cellOf(x: number): number {
  return Math.min(CELLS - 1, Math.max(0, Math.round((x - GAME.player.edge) / CELL)));
}

/** Отрезок клеток (или X центра корабля) от lo до hi включительно. */
export interface Span {
  lo: number;
  hi: number;
}

/**
 * Клетка на самой границе отрезка считается занятой: проба может быть строже
 * contactAt на ошибку округления, но никогда не мягче.
 */
const EDGE = 1e-9;
/** Направление считается параллельным стороне прямоугольника. */
const PARALLEL = 1e-12;

// Отрезок пробы в единицах смещения от центра препятствия: копится по частям фигуры.
let hitLo = Infinity;
let hitHi = -Infinity;

/** Часть фигуры — прямоугольник ±ex, ±ez: добавить отрезок, где в нём лежит прямая A + t·U. */
function hitBox(ax: number, az: number, ux: number, uz: number, ex: number, ez: number): void {
  let t0 = -Infinity;
  let t1 = Infinity;
  if (Math.abs(ux) < PARALLEL) {
    if (Math.abs(ax) >= ex) return;
  } else {
    const a = (-ex - ax) / ux;
    const b = (ex - ax) / ux;
    t0 = Math.min(a, b);
    t1 = Math.max(a, b);
  }
  if (Math.abs(uz) < PARALLEL) {
    if (Math.abs(az) >= ez) return;
  } else {
    const a = (-ez - az) / uz;
    const b = (ez - az) / uz;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (t0 >= t1) return;
  if (t0 < hitLo) hitLo = t0;
  if (t1 > hitHi) hitHi = t1;
}

/** Часть фигуры — круг радиуса touch с центром в углу прямоугольника (dx, dz — от угла до точки A). */
function hitCorner(dx: number, dz: number, ux: number, uz: number, touch: number): void {
  const b = ux * dx + uz * dz;
  const d = b * b - (dx * dx + dz * dz - touch * touch);
  if (d <= 0) return;
  const root = Math.sqrt(d);
  if (-b - root < hitLo) hitLo = -b - root;
  if (-b + root > hitHi) hitHi = -b + root;
}

/**
 * Клетки, в которых корабль в момент time ближе margin к кубу или пиле:
 * out.lo…out.hi. false — таких клеток нет (или объект вне полосы контакта).
 */
export function solidCells(o: Obstacle, time: number, margin: number, out: Span): boolean {
  const z = depthAt(o.arriveTick, o.approachTicks, time);
  if (Math.abs(z) > depthReach(o)) return false;
  let hx: number;
  let hz: number;
  let c = 1;
  let s = 0;
  if (o.kind === 'cube') {
    const yaw = yawAt(o, time);
    c = Math.cos(yaw);
    s = Math.sin(yaw);
    hx = hz = o.halfW * GAME.hitbox.cube;
  } else {
    hx = o.halfW * GAME.hitbox.saw;
    hz = o.halfD;
  }
  // Корабль задевает, если его центр ближе touch к прямоугольнику хитбокса.
  const touch = GAME.player.radius + margin;
  // Центр корабля в системе препятствия: A + t·U, где t — смещение по x от центра препятствия.
  const ax = -z * s;
  const az = -z * c;
  const uz = -s;
  hitLo = Infinity;
  hitHi = -Infinity;
  hitBox(ax, az, c, uz, hx + touch, hz);
  hitBox(ax, az, c, uz, hx, hz + touch);
  hitCorner(ax - hx, az - hz, c, uz, touch);
  hitCorner(ax - hx, az + hz, c, uz, touch);
  hitCorner(ax + hx, az - hz, c, uz, touch);
  hitCorner(ax + hx, az + hz, c, uz, touch);
  if (hitLo >= hitHi) return false;
  const origin = obstacleX(o, time) - GAME.player.edge;
  out.lo = Math.max(0, Math.floor((origin + hitLo - EDGE) / CELL) + 1);
  out.hi = Math.min(CELLS - 1, Math.ceil((origin + hitHi + EDGE) / CELL) - 1);
  return out.lo <= out.hi;
}

/**
 * Клетки прохода лазерных ворот, где в момент time соблюдён запас margin:
 * out.lo…out.hi (lo > hi — проход уже корабля с запасом). false — луч не в
 * полосе контакта, свободна вся дорога.
 */
export function gateCells(o: Obstacle, time: number, margin: number, out: Span): boolean {
  const z = depthAt(o.arriveTick, o.approachTicks, time);
  if (Math.abs(z) > depthReach(o)) return false;
  const origin = obstacleX(o, time) - GAME.player.edge;
  const pass = o.halfW - GAME.player.radius * GAME.hitbox.laserPlayer - margin;
  out.lo = Math.max(0, Math.ceil((origin - pass + EDGE) / CELL));
  out.hi = Math.min(CELLS - 1, Math.floor((origin + pass - EDGE) / CELL));
  return true;
}
