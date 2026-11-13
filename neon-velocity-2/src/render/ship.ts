/**
 * Корабль на линии удара: контур из SHIP_GEOMETRY, крен, ядро, пламя сопел,
 * кольцо щита, мерцание неуязвимости и поле магнита. Корабль парит над
 * полотном и слегка наклонён к зрителю — так треугольник остаётся
 * треугольником даже при пологой камере.
 */
import { clamp, easeOutBack, TAU } from '../core/math';
import { SHIP_GEOMETRY, SHIP_SIZE, type Point, type ShipGeometry } from '../core/shipGeometry';
import { blit, hash01, useWorld, type View } from './view';

/** Наибольший поворот корпуса при полном крене, рад. */
const BANK_ANGLE = 0.42;
/** Как долго корабль «собирается» после появления, сек. */
const WARP_TIME = 0.45;
/** Высота парения над полотном, единицы мира. */
export const SHIP_HOVER = 1.3;

export class Ship {
  /** 1 сразу после появления, гаснет до 0. */
  private warp = 0;

  /** Корабль появился заново (новый забег, смена сцены): скрыть «прыжок» анимацией сборки. */
  spawn(): void {
    this.warp = 1;
  }

  /** Насколько наклонён корпус к зрителю: доля высоты, которая остаётся на экране. */
  static tilt(view: View): number {
    return clamp(view.flat * 1.9, 0.56, 0.8);
  }

  draw(view: View, realDt: number): void {
    const { ctx, cam, state } = view;
    const player = state.player;
    this.warp = Math.max(0, this.warp - realDt / WARP_TIME);
    if (!player.alive) return;

    const geo = SHIP_GEOMETRY[view.skin.shape];
    const size = SHIP_SIZE * cam.unit;
    const tilt = Ship.tilt(view);
    const grow = this.warp > 0 && !view.reduced ? easeOutBack(1 - this.warp) : 1;
    const sx = view.shipSx;
    const sy = view.shipSy;
    // Неуязвимость после щита: корабль мерцает (или просто полупрозрачен, если просят меньше движения).
    const blink = player.invulnTicks > 0 ? (view.reduced ? 0.55 : Math.floor(view.t / 6) % 2 === 0 ? 1 : 0.32) : 1;
    const alpha = blink * (1 - this.warp * 0.6);

    useWorld(view);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Отсвет на полотне под корпусом — точное место корабля на дороге.
    const under = size * 1.4;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * (0.6 + 0.2 * view.beat);
    blit(ctx, view.sprites.halo(view.hull), sx, cam.lineY, under, under * view.flat * 1.1);

    ctx.globalCompositeOperation = 'source-over';
    if (state.magnetRadius > 0) this.magnetField(view, alpha);

    const bank = player.bank;
    const angle = bank * BANK_ANGLE;
    const scaleX = size * grow * (1 - 0.16 * Math.abs(bank));
    const scaleY = size * grow * tilt;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    ctx.globalCompositeOperation = 'lighter';
    this.flames(view, geo, sx, sy, scaleX, scaleY, cos, sin, alpha);

    // Путь строится в повёрнутых и сжатых координатах корпуса, а обводится уже в координатах мира:
    // толщина линии не искажается наклоном.
    ctx.transform(cos * scaleX, sin * scaleX, -sin * scaleY, cos * scaleY, sx, sy);
    ctx.beginPath();
    polygon(ctx, geo.hull);
    useWorld(view);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = view.colors.bg;
    ctx.globalAlpha = alpha * 0.9;
    ctx.fill();
    ctx.fillStyle = view.hull;
    ctx.globalAlpha = alpha * (0.2 + 0.1 * view.beat);
    ctx.fill();
    const width = Math.max(1.2, 2.2 * view.line);
    ctx.strokeStyle = view.hull;
    ctx.lineWidth = width * 3.6;
    ctx.globalAlpha = alpha * 0.3;
    ctx.stroke();
    ctx.strokeStyle = view.shipCore;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.stroke();

    ctx.transform(cos * scaleX, sin * scaleX, -sin * scaleY, cos * scaleY, sx, sy);
    ctx.beginPath();
    polygon(ctx, geo.inner);
    useWorld(view);
    ctx.strokeStyle = view.hull;
    ctx.lineWidth = Math.max(0.9, 1.3 * view.line);
    ctx.globalAlpha = alpha * 0.85;
    ctx.stroke();

    // Ядро.
    const cx = sx + (geo.core[0] * cos * scaleX - geo.core[1] * sin * scaleY);
    const cy = sy + (geo.core[0] * sin * scaleX + geo.core[1] * cos * scaleY);
    const heart = size * (0.5 + 0.14 * view.beat);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    view.sprites.glow(view, view.shipCore, true, cx, cy, heart);
    ctx.globalAlpha = alpha * 0.9;
    view.sprites.glow(view, view.hull, false, cx, cy, heart * 1.6);

    ctx.globalCompositeOperation = 'source-over';
    this.ring(view, geo, sx, sy, size * grow, alpha);
    if (this.warp > 0 && !view.reduced) {
      // Кольцо сборки сжимается к кораблю.
      ctx.beginPath();
      ctx.arc(sx, sy, size * (1.2 + 3.4 * this.warp), 0, TAU);
      ctx.strokeStyle = view.hull;
      ctx.lineWidth = Math.max(1, 2 * view.line);
      ctx.globalAlpha = (1 - this.warp) * this.warp * 2.4;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Пламя сопел: два вложенных клина и горячая точка у среза. */
  private flames(view: View, geo: ShipGeometry, sx: number, sy: number, scaleX: number, scaleY: number, cos: number, sin: number, alpha: number): void {
    const { ctx, colors } = view;
    const size = SHIP_SIZE * view.cam.unit;
    const boost = clamp(view.speed / 170, 1, 3);
    for (let k = 0; k < geo.engines.length; k++) {
      const e = geo.engines[k];
      const x = sx + (e[0] * cos * scaleX - e[1] * sin * scaleY);
      const y = sy + (e[0] * sin * scaleX + e[1] * cos * scaleY);
      const flicker = view.reduced ? 0.5 : hash01(Math.floor(view.now * 34) * 7 + k);
      const length = size * (0.55 + 0.22 * boost + 0.45 * flicker + 0.5 * view.overdrive) * (geo.engines.length > 1 ? 0.8 : 1);
      const half = size * 0.2;
      // Струя отклоняется против крена — корабль «заносит».
      const tipX = x - sin * length * 0.9;
      const tipY = y + length;
      ctx.fillStyle = colors.trail;
      ctx.globalAlpha = alpha * 0.6;
      ctx.beginPath();
      ctx.moveTo(x - half, y);
      ctx.lineTo(x + half, y);
      ctx.lineTo(tipX, tipY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = alpha * 0.85;
      ctx.beginPath();
      ctx.moveTo(x - half * 0.45, y);
      ctx.lineTo(x + half * 0.45, y);
      ctx.lineTo(x + (tipX - x) * 0.55, y + length * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = alpha * 0.9;
      view.sprites.glow(view, colors.trail, true, x, y + half * 0.4, half * 2.4);
    }
  }

  /** Кольцо корпуса-сферы и пузырь щита, пока есть заряд. */
  private ring(view: View, geo: ShipGeometry, sx: number, sy: number, size: number, alpha: number): void {
    const { ctx, state } = view;
    const shielded = state.player.shield > 0;
    if (geo.ring <= 0 && !shielded) return;
    const radius = size * Math.max(geo.ring, 1.42);
    if (!shielded) {
      // Заряд потрачен: от сферы остаётся тусклый контур.
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, TAU);
      ctx.strokeStyle = view.hull;
      ctx.lineWidth = Math.max(0.8, 1.1 * view.line);
      ctx.globalAlpha = alpha * 0.28;
      ctx.stroke();
      return;
    }
    const pulse = 0.5 + 0.5 * view.beat;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, TAU);
    ctx.fillStyle = view.hull;
    ctx.globalAlpha = alpha * (0.07 + 0.06 * pulse);
    ctx.fill();
    ctx.strokeStyle = view.hull;
    ctx.lineWidth = Math.max(1, 1.6 * view.line);
    ctx.globalAlpha = alpha * (0.55 + 0.25 * pulse);
    ctx.stroke();
    // Три дуги бегут по пузырю — щит «живой».
    const spin = view.reduced ? 0.6 : view.now * 1.5;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = spin + (k * TAU) / 3;
      ctx.moveTo(sx + Math.cos(a) * radius, sy + Math.sin(a) * radius);
      ctx.arc(sx, sy, radius, a, a + 0.85);
    }
    ctx.strokeStyle = view.shipCore;
    ctx.lineWidth = Math.max(1.2, 2.4 * view.line);
    ctx.globalAlpha = alpha;
    ctx.stroke();
  }

  /** Поле магнита на полотне: внешний контур — честная ширина захвата, кольца сбегаются к кораблю. */
  private magnetField(view: View, alpha: number): void {
    const { ctx, cam, state } = view;
    const rx = state.magnetRadius * cam.unit;
    const ry = rx * view.flat * 0.9;
    const cy = cam.lineY - ry * 0.35;
    ctx.strokeStyle = view.hull;
    ctx.beginPath();
    ctx.ellipse(view.shipSx, cy, rx, ry, 0, 0, TAU);
    ctx.lineWidth = Math.max(1, 1.6 * view.line);
    ctx.globalAlpha = alpha * (0.5 + 0.2 * view.beat);
    ctx.stroke();
    for (let k = 0; k < 2; k++) {
      const phase = view.reduced ? (k + 0.5) / 2 : (view.now * 0.7 + k / 2) % 1;
      const shrink = 1 - 0.82 * phase;
      ctx.beginPath();
      ctx.ellipse(view.shipSx, cy, rx * shrink, ry * shrink, 0, 0, TAU);
      ctx.lineWidth = Math.max(1, 2 * view.line);
      ctx.globalAlpha = alpha * 0.6 * Math.sin(Math.PI * phase);
      ctx.stroke();
    }
  }
}

function polygon(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
}
