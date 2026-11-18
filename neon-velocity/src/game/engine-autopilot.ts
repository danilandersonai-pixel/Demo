/**
 * Автопилот демо-сцены в меню: корабль плавно покачивается, заранее уходит
 * с пути препятствий и подбирает сферы — фон «живёт», пока игрок читает меню.
 * Столкновений в демо-сцене нет, автопилот нужен только ради красоты.
 */
import { GAME, WORLD_W } from './config';
import { obstacleExtent } from './collision';
import { type MotionModel, type SimCrystal, type SimObstacle, timeToTravel } from './engine-motion';
import { rand } from './math';

/** Насколько вперёд автопилот смотрит на препятствия, сек. */
const LOOK_OBSTACLES = 1.4;
/** Сферы ближе этого по времени — цель. */
const LOOK_CRYSTALS = 1.1;
/** Запас к хитбоксам, ед. */
const MARGIN = 14;

export class Autopilot {
  private t = 0;
  /** Плоский массив занятых интервалов центра корабля [lo, hi, …]. */
  private readonly blocked: number[] = [];
  /** Свободные интервалы центра корабля. */
  private readonly free: number[] = [];

  reset(): void {
    // Случайная фаза покачивания — каждый заход в меню выглядит по-своему.
    this.t = rand(0, 120);
  }

  /** Куда вести корабль на этом подшаге. */
  target(
    h: number,
    playerX: number,
    playerY: number,
    obstacles: readonly SimObstacle[],
    crystals: readonly SimCrystal[],
    m: MotionModel,
  ): number {
    this.t += h;
    const t = this.t;
    let desired = WORLD_W / 2 + Math.sin(t * 0.45) * 118 + Math.sin(t * 1.17 + 1.3) * 34;

    this.collectBlocked(playerY, obstacles, m);
    this.buildFree();
    if (this.free.length === 0) return desired;

    // Ближайшая по времени сфера, до которой можно дотянуться, важнее покачивания.
    let bestT = LOOK_CRYSTALS;
    for (const c of crystals) {
      if (c.y >= playerY) continue;
      const tc = timeToTravel(m, c.vy, playerY - c.y);
      if (tc < bestT && this.isFree(c.x) && Math.abs(c.x - playerX) < 170) {
        bestT = tc;
        desired = c.x;
      }
    }
    return this.nearestFree(desired);
  }

  private collectBlocked(playerY: number, obstacles: readonly SimObstacle[], m: MotionModel): void {
    const b = this.blocked;
    b.length = 0;
    const r = GAME.player.radius + MARGIN;
    for (const o of obstacles) {
      const half = obstacleExtent(o);
      if (o.y - half > playerY + r) continue;
      const tIn = timeToTravel(m, o.vy, playerY - r - half - o.y);
      if (tIn > LOOK_OBSTACLES) continue;
      const amp = o.zigzag ? o.zigzag.amp : 0;
      if (o.kind === 'laser') {
        const g = o.gapW / 2;
        b.push(-1, o.baseX + amp - g + r, o.baseX - amp + g - r, WORLD_W + 1);
      } else {
        b.push(o.baseX - amp - half - r, o.baseX + amp + half + r);
      }
    }
  }

  private buildFree(): void {
    const b = this.blocked;
    const f = this.free;
    f.length = 0;
    const minX: number = GAME.player.edgePadding;
    const maxX = WORLD_W - minX;
    let cursor = minX;
    // Интервалов единицы — простой выбор минимума вместо сортировки.
    const used = b.length / 2;
    for (let n = 0; n < used; n++) {
      let best = -1;
      for (let i = 0; i < b.length; i += 2) {
        if (b[i] <= b[i + 1] && (best < 0 || b[i] < b[best])) best = i;
      }
      if (best < 0) break;
      const lo = b[best];
      const hi = b[best + 1];
      // Помечаем интервал использованным (lo > hi).
      b[best] = 1;
      b[best + 1] = 0;
      if (lo > cursor) f.push(cursor, Math.min(lo, maxX));
      if (hi > cursor) cursor = hi;
      if (cursor >= maxX) break;
    }
    if (cursor < maxX) f.push(cursor, maxX);
  }

  private isFree(x: number): boolean {
    const f = this.free;
    for (let i = 0; i < f.length; i += 2) if (x >= f[i] && x <= f[i + 1]) return true;
    return false;
  }

  private nearestFree(x: number): number {
    const f = this.free;
    let best = x;
    let bestD = Infinity;
    for (let i = 0; i < f.length; i += 2) {
      const cx = x < f[i] ? f[i] : x > f[i + 1] ? f[i + 1] : x;
      const d = Math.abs(cx - x);
      if (d < bestD) {
        bestD = d;
        best = cx;
      }
    }
    return best;
  }
}
