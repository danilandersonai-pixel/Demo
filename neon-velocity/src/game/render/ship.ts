/**
 * Корабль игрока: корпус из SHIP_GEOMETRY × SHIP_SIZE, крен по tilt, светящееся ядро,
 * факелы из сопел, пятно света на полу, кольцо магнита, пузырь щита-призрака,
 * мерцание при неуязвимости и белая вспышка при потере щита.
 */
import { clamp, TAU } from '../math';
import { SHIP_GEOMETRY, SHIP_SIZE, type Point } from '../shipGeometry';
import type { GameState } from '../types';
import type { FrameInfo } from './frame';
import type { Palette, ShipPalette } from './palette';
import { drawSprite, type SpriteCache } from './sprites';
import { DASH_RANGE, hash, NO_DASH } from './util';

/** Максимальный угол крена, рад, и «сплющивание» корпуса в вираже. */
const BANK_ANGLE = 0.3;
const BANK_SQUASH = 0.16;
/** Радиус пузыря щита, если у корпуса нет своего кольца (в долях SHIP_SIZE). */
const SHIELD_RADIUS = 1.6;

function polygon(ctx: CanvasRenderingContext2D, pts: readonly Point[]): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0] * SHIP_SIZE;
    const y = pts[i][1] * SHIP_SIZE;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function drawShip(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  f: FrameInfo,
  pal: Palette,
  ship: ShipPalette,
  sprites: SpriteCache,
): void {
  const p = state.player;
  if (!p.alive) return;
  const geo = SHIP_GEOMETRY[state.skin.shape];
  const S = SHIP_SIZE;
  const t = f.time;
  // Неуязвимость: корабль мигает ~8 раз в секунду.
  const vis = p.invuln > 0 && Math.floor(t * 16) % 2 === 1 ? 0.3 : 1;

  ctx.globalCompositeOperation = 'lighter';

  // Пятно света на полу под кораблём.
  ctx.save();
  ctx.translate(p.x, p.y + S * 1.55);
  ctx.scale(1, 0.28);
  ctx.globalAlpha = 0.32 * vis;
  drawSprite(ctx, sprites.glow(ship.hull), 0, 0, S * 3);
  ctx.restore();

  // Радиус магнита: едва заметное вращающееся кольцо.
  if (state.magnetRadius > 0) {
    ctx.setLineDash(DASH_RANGE);
    ctx.lineDashOffset = -t * 14;
    ctx.strokeStyle = pal.crystal;
    ctx.lineWidth = 1;
    ctx.globalAlpha = (0.16 + 0.08 * f.beat) * vis;
    ctx.beginPath();
    ctx.arc(p.x, p.y, state.magnetRadius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.lineDashOffset = 0;
  }

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.tilt * BANK_ANGLE);
  ctx.scale(1 - Math.abs(p.tilt) * BANK_SQUASH, 1);

  // Факелы двигателей (под корпусом). Длина дрожит и растёт со скоростью.
  const flame = sprites.flame(ship.flame);
  const nozzle = sprites.hot(ship.flame);
  const multi = geo.engines.length > 1;
  const fw = S * (multi ? 0.46 : 0.62);
  const boost = 1 + clamp((state.speedMult - 1) * 0.35, 0, 0.6);
  for (let i = 0; i < geo.engines.length; i++) {
    const ex = geo.engines[i][0] * S;
    const ey = geo.engines[i][1] * S;
    const flick = hash(Math.floor(t * 34) + i * 7.1);
    const len = S * (1.45 + 0.45 * flick) * boost * (multi ? 0.85 : 1);
    ctx.globalAlpha = 0.95 * vis;
    ctx.drawImage(flame, ex - fw / 2, ey - fw * 0.3, fw, len);
    ctx.globalAlpha = 0.7 * vis;
    drawSprite(ctx, nozzle, ex, ey + S * 0.1, S * 0.5);
  }

  // Корпус: тёмное тело, цветная подсветка, три штриха неона.
  polygon(ctx, geo.hull);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = pal.body;
  ctx.globalAlpha = 0.85 * vis;
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = ship.hull;
  ctx.globalAlpha = 0.16 * vis;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ship.hull;
  ctx.lineWidth = 7;
  ctx.globalAlpha = 0.16 * vis;
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.55 * vis;
  ctx.stroke();
  ctx.strokeStyle = ship.hullHot;
  ctx.lineWidth = 1.3;
  ctx.globalAlpha = vis;
  ctx.stroke();

  // Деталь корпуса (кабина, рёбра).
  polygon(ctx, geo.inner);
  ctx.strokeStyle = ship.hullHot;
  ctx.lineWidth = 0.9;
  ctx.globalAlpha = 0.75 * vis;
  ctx.stroke();

  // Ядро пульсирует в такт музыке.
  const cx = geo.core[0] * S;
  const cy = geo.core[1] * S;
  ctx.globalAlpha = vis;
  drawSprite(ctx, sprites.hot(ship.core), cx, cy, S * (0.62 + 0.14 * f.beat));
  ctx.globalAlpha = 0.35 * vis;
  drawSprite(ctx, sprites.glow(ship.hull), cx, cy, S * 1.9);

  // Собственное кольцо корпуса (у «сферы»): без зарядов щита — погасшее, пунктиром.
  if (geo.ring > 0 && p.shieldCharges <= 0) {
    ctx.setLineDash(DASH_RANGE);
    ctx.strokeStyle = ship.hull;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3 * vis;
    ctx.beginPath();
    ctx.arc(0, 0, geo.ring * S, 0, TAU);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
  }

  // Вспышка при потере щита: корпус белеет.
  if (p.hitFlash > 0.01) {
    polygon(ctx, geo.hull);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = clamp(p.hitFlash, 0, 1);
    ctx.fill();
    drawSprite(ctx, sprites.hot('#ffffff'), 0, 0, S * (2 + 2 * p.hitFlash));
  }
  ctx.restore();

  if (p.shieldCharges > 0) drawShield(ctx, state, f, ship, sprites, vis, geo.ring > 0 ? geo.ring : SHIELD_RADIUS);

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Пузырь щита-призрака: мягкое свечение, двойной контур и вращающиеся сегменты. */
function drawShield(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  f: FrameInfo,
  ship: ShipPalette,
  sprites: SpriteCache,
  vis: number,
  ringUnits: number,
): void {
  const p = state.player;
  const t = f.time;
  const R = ringUnits * SHIP_SIZE * (1 + 0.035 * Math.sin(t * 4) + 0.03 * f.beat);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.2 * vis;
  drawSprite(ctx, sprites.glow(ship.shield), p.x, p.y, R * 1.55);

  ctx.beginPath();
  ctx.arc(p.x, p.y, R, 0, TAU);
  ctx.strokeStyle = ship.shield;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.18 * vis;
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.75 * vis;
  ctx.stroke();

  // Шесть дуг-сегментов снаружи медленно вращаются — щит «живой».
  const seg = TAU / 6;
  const rot = t * 0.9;
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a0 = rot + k * seg + 0.16;
    const a1 = rot + (k + 1) * seg - 0.16;
    ctx.moveTo(p.x + Math.cos(a0) * R * 1.14, p.y + Math.sin(a0) * R * 1.14);
    ctx.arc(p.x, p.y, R * 1.14, a0, a1);
  }
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.45 * vis;
  ctx.stroke();
}
