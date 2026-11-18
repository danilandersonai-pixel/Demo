/**
 * Хитбоксы — единое определение для симуляции, генератора трека и тестов.
 *
 * Корабль — круг радиуса GAME.player.radius в точке (playerX, z = 0).
 *  • cube  — квадрат со стороной 2·halfW·hitbox.cube, повёрнутый на yaw (OBB);
 *  • saw   — прямоугольник: ±halfW·hitbox.saw по x и ±halfD по z (диск ребром);
 *  • laser — полоса ±halfD по z во всю ширину дороги, кроме прохода
 *            [x − halfW, x + halfW]; у корабля учитывается hitbox.laserPlayer радиуса.
 */
import { GAME, WORLD } from './config';
import { depthAt, obstacleX, yawAt } from './motion';
import type { Obstacle } from './types';

export interface Contact {
  /** Объект сейчас в полосе глубины, где столкновение вообще возможно. */
  inRange: boolean;
  /** Зазор между хитбоксами (отрицательный — столкновение). Имеет смысл при inRange. */
  clear: number;
}

type Body = Pick<Obstacle, 'kind' | 'x' | 'sway' | 'arriveTick' | 'approachTicks' | 'halfW' | 'halfD' | 'yaw0' | 'yawRate'>;

/** Половина глубины, в пределах которой объект может задеть корабль. */
export function depthReach(o: Pick<Obstacle, 'kind' | 'halfW' | 'halfD'>): number {
  const r = GAME.player.radius;
  if (o.kind === 'cube') return o.halfW * GAME.hitbox.cube * Math.SQRT2 + r;
  if (o.kind === 'saw') return o.halfD + r;
  return o.halfD + r * GAME.hitbox.laserPlayer;
}

/** Контакт корабля в точке playerX с препятствием в тик t (t может быть дробным). */
export function contactAt(o: Body, t: number, playerX: number, out: Contact = { inRange: false, clear: Infinity }): Contact {
  const z = depthAt(o.arriveTick, o.approachTicks, t);
  const reach = depthReach(o);
  if (Math.abs(z) > reach) {
    out.inRange = false;
    out.clear = Infinity;
    return out;
  }
  out.inRange = true;
  const r = GAME.player.radius;
  const ox = obstacleX(o, t);

  if (o.kind === 'laser') {
    const pr = r * GAME.hitbox.laserPlayer;
    // Зазор до ближайшего края прохода: отрицательный, если корабль задевает луч.
    out.clear = Math.min(playerX - pr - (ox - o.halfW), ox + o.halfW - (playerX + pr));
    return out;
  }

  // Центр корабля в системе координат препятствия.
  let lx = playerX - ox;
  let lz = -z;
  let hx: number;
  let hz: number;
  if (o.kind === 'cube') {
    const yaw = yawAt(o, t);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const rx = lx * c + lz * s;
    const rz = -lx * s + lz * c;
    lx = rx;
    lz = rz;
    hx = hz = o.halfW * GAME.hitbox.cube;
  } else {
    hx = o.halfW * GAME.hitbox.saw;
    hz = o.halfD;
  }
  const dx = Math.abs(lx) - hx;
  const dz = Math.abs(lz) - hz;
  // Расстояние от точки до прямоугольника (отрицательное внутри).
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  const inside = Math.min(Math.max(dx, dz), 0);
  out.clear = outside + inside - r;
  return out;
}

/** Корабль в точке playerX сталкивается с препятствием в тик t. */
export function hitsAt(o: Body, t: number, playerX: number): boolean {
  const c = contactAt(o, t, playerX);
  return c.inRange && c.clear < 0;
}

/**
 * Первый и последний тик, когда препятствие вообще может задеть корабль
 * (включительно). Удобно генератору трека и ботам: вне этого окна объект безопасен.
 */
export function dangerWindow(o: Pick<Obstacle, 'kind' | 'halfW' | 'halfD' | 'arriveTick' | 'approachTicks'>): { from: number; to: number } {
  const ticks = (depthReach(o) * o.approachTicks) / WORLD.zFar;
  return { from: Math.floor(o.arriveTick - ticks), to: Math.ceil(o.arriveTick + ticks) };
}
