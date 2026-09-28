/**
 * Энергетические сферы-кристаллы: вращающийся гранёный ромб (бипирамида,
 * спроецированная ортогонально) с раскалённым ядром и ореолом. Редкие —
 * крупнее, своего цвета, с искрой-звездой и кольцом. Притягиваемые магнитом
 * тянут к кораблю бегущую пунктирную линию поля.
 */
import { TAU } from '../math';
import type { Crystal, GameState } from '../types';
import type { FrameInfo } from './frame';
import type { Palette } from './palette';
import { drawSprite, type SpriteCache } from './sprites';
import { DASH_MAGNET, NO_DASH } from './util';

/** Геометрия кристалла в долях радиуса. */
const TOP = 1.4;
const BOTTOM = 1.15;
const GIRDLE = -0.22;
const WIDTH = 0.86;
/** Скорость вращения вокруг вертикальной оси, рад/с. */
const SPIN = 2.3;

function isVisible(c: Crystal, f: FrameInfo): boolean {
  const e = c.radius * 3;
  return c.y + e >= f.top && c.y - e <= f.bottom && c.x + e >= f.left && c.x - e <= f.right;
}

/** Пульсирующий радиус: такт музыки + собственная фаза. */
function pulseRadius(c: Crystal, f: FrameInfo): number {
  return c.radius * (1 + 0.1 * f.beat + 0.05 * Math.sin(f.time * 5 + c.phase));
}

/** Внешний контур ромба с учётом поворота вокруг вертикали. */
function outlinePath(ctx: CanvasRenderingContext2D, c: Crystal, r: number, spin: number): void {
  const half = r * WIDTH * Math.max(Math.abs(Math.cos(spin)), Math.abs(Math.sin(spin)));
  const gy = c.y + r * GIRDLE;
  ctx.moveTo(c.x, c.y - r * TOP);
  ctx.lineTo(c.x + half, gy);
  ctx.lineTo(c.x, c.y + r * BOTTOM);
  ctx.lineTo(c.x - half, gy);
  ctx.closePath();
}

/** Верхняя «корона» — треугольник над поясом, в него ложится блик. */
function crownPath(ctx: CanvasRenderingContext2D, c: Crystal, r: number, spin: number): void {
  const half = r * WIDTH * Math.max(Math.abs(Math.cos(spin)), Math.abs(Math.sin(spin)));
  const gy = c.y + r * GIRDLE;
  ctx.moveTo(c.x, c.y - r * TOP);
  ctx.lineTo(c.x + half, gy);
  ctx.lineTo(c.x - half, gy);
  ctx.closePath();
}

/** Видимые рёбра: от вершин к передним вершинам пояса, плюс сам пояс. */
function facetPath(ctx: CanvasRenderingContext2D, c: Crystal, r: number, spin: number): void {
  const cs = Math.cos(spin);
  const sn = Math.sin(spin);
  const R = r * WIDTH;
  const half = R * Math.max(Math.abs(cs), Math.abs(sn));
  const gy = c.y + r * GIRDLE;
  const top = c.y - r * TOP;
  const bottom = c.y + r * BOTTOM;
  // Четыре вершины пояса: x = R·cos(θ + k·90°), глубина z = R·sin(θ + k·90°); видны те, что z > 0.
  const vx0 = R * cs;
  const vz0 = R * sn;
  const vx1 = -R * sn;
  const vz1 = R * cs;
  if (vz0 > 0) edge(ctx, c.x + vx0, gy, c.x, top, bottom);
  if (vz1 > 0) edge(ctx, c.x + vx1, gy, c.x, top, bottom);
  if (-vz0 > 0) edge(ctx, c.x - vx0, gy, c.x, top, bottom);
  if (-vz1 > 0) edge(ctx, c.x - vx1, gy, c.x, top, bottom);
  ctx.moveTo(c.x - half, gy);
  ctx.lineTo(c.x + half, gy);
}

function edge(ctx: CanvasRenderingContext2D, x: number, y: number, cx: number, top: number, bottom: number): void {
  ctx.moveTo(cx, top);
  ctx.lineTo(x, y);
  ctx.lineTo(cx, bottom);
}

export function drawCrystals(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  f: FrameInfo,
  pal: Palette,
  sprites: SpriteCache,
): void {
  const list = state.crystals;
  if (list.length === 0) return;
  ctx.globalCompositeOperation = 'lighter';

  drawMagnetLines(ctx, state, f, pal);

  // Ореолы: у редких ярче и шире.
  const halo = sprites.glow(pal.crystal);
  const haloRare = sprites.glow(pal.rare);
  let rareCount = 0;
  for (const c of list) {
    if (!isVisible(c, f)) continue;
    const r = pulseRadius(c, f);
    if (c.rare) {
      rareCount++;
      ctx.globalAlpha = 0.45 + 0.15 * f.beat;
      drawSprite(ctx, haloRare, c.x, c.y, r * 3.7);
    } else {
      ctx.globalAlpha = 0.38 + 0.2 * f.beat;
      drawSprite(ctx, halo, c.x, c.y, r * 3.4);
    }
  }

  drawGems(ctx, list, f, false, pal.crystal, pal.crystalHot, pal.body);
  if (rareCount > 0) {
    drawGems(ctx, list, f, true, pal.rare, pal.rareHot, pal.body);
    drawRareSparkles(ctx, list, f, pal);
  }

  // Раскалённые ядра.
  const core = sprites.hot(pal.crystal);
  const coreRare = sprites.hot(pal.rare);
  ctx.globalAlpha = 0.95;
  for (const c of list) {
    if (!isVisible(c, f)) continue;
    const r = pulseRadius(c, f);
    drawSprite(ctx, c.rare ? coreRare : core, c.x, c.y - r * 0.1, r * (c.rare ? 1.25 : 1.05));
  }
  ctx.globalAlpha = 1;
}

function drawGems(
  ctx: CanvasRenderingContext2D,
  list: readonly Crystal[],
  f: FrameInfo,
  rare: boolean,
  color: string,
  hot: string,
  body: string,
): void {
  let found = false;
  ctx.beginPath();
  for (const c of list) {
    if (c.rare !== rare || !isVisible(c, f)) continue;
    found = true;
    outlinePath(ctx, c, pulseRadius(c, f), f.time * SPIN + c.phase);
  }
  if (!found) return;
  // Тёмное тело: на светлом солнце кристалл остаётся гранёным, а не белым пятном.
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = body;
  ctx.globalAlpha = 0.6;
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.3;
  ctx.fill();
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = color;
  ctx.lineWidth = 4.5;
  ctx.globalAlpha = 0.2;
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.strokeStyle = hot;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1;
  ctx.stroke();

  // Блик на короне.
  ctx.beginPath();
  for (const c of list) {
    if (c.rare !== rare || !isVisible(c, f)) continue;
    crownPath(ctx, c, pulseRadius(c, f), f.time * SPIN + c.phase);
  }
  ctx.fillStyle = hot;
  ctx.globalAlpha = 0.28;
  ctx.fill();

  // Грани.
  ctx.beginPath();
  for (const c of list) {
    if (c.rare !== rare || !isVisible(c, f)) continue;
    facetPath(ctx, c, pulseRadius(c, f), f.time * SPIN + c.phase);
  }
  ctx.strokeStyle = hot;
  ctx.lineWidth = 0.75;
  ctx.globalAlpha = 0.7;
  ctx.stroke();
}

/** Редкая сфера: вращающаяся четырёхлучевая искра и тонкое кольцо. */
function drawRareSparkles(ctx: CanvasRenderingContext2D, list: readonly Crystal[], f: FrameInfo, pal: Palette): void {
  ctx.beginPath();
  for (const c of list) {
    if (!c.rare || !isVisible(c, f)) continue;
    const r = pulseRadius(c, f);
    const a = f.time * 1.6 + c.phase;
    const long = r * (2.3 + 0.4 * Math.sin(f.time * 7 + c.phase));
    const short = long * 0.55;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    ctx.moveTo(c.x - ca * long, c.y - sa * long);
    ctx.lineTo(c.x + ca * long, c.y + sa * long);
    ctx.moveTo(c.x + sa * short, c.y - ca * short);
    ctx.lineTo(c.x - sa * short, c.y + ca * short);
    ctx.moveTo(c.x + r * 1.95, c.y);
    ctx.arc(c.x, c.y, r * 1.95, 0, TAU);
  }
  ctx.strokeStyle = pal.rare;
  ctx.lineWidth = 2.6;
  ctx.globalAlpha = 0.18;
  ctx.stroke();
  ctx.strokeStyle = pal.rareHot;
  ctx.lineWidth = 0.8;
  ctx.globalAlpha = 0.65;
  ctx.stroke();
}

/** Линии поля от притягиваемых сфер к кораблю: изогнутый пунктир, бегущий к магниту. */
function drawMagnetLines(ctx: CanvasRenderingContext2D, state: GameState, f: FrameInfo, pal: Palette): void {
  const p = state.player;
  if (!p.alive) return;
  let found = false;
  ctx.beginPath();
  for (const c of state.crystals) {
    if (!c.magnetized || !isVisible(c, f)) continue;
    found = true;
    const mx = (c.x + p.x) / 2;
    const my = (c.y + p.y) / 2;
    // Изгиб поперёк линии — «силовая линия», а не прямой отрезок.
    const bend = 0.18 * Math.sin(f.time * 3 + c.phase);
    ctx.moveTo(c.x, c.y);
    ctx.quadraticCurveTo(mx + (c.y - p.y) * bend, my - (c.x - p.x) * bend, p.x, p.y);
  }
  if (!found) return;
  ctx.setLineDash(DASH_MAGNET);
  ctx.lineDashOffset = -f.time * 60;
  ctx.strokeStyle = pal.crystal;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.12;
  ctx.stroke();
  ctx.strokeStyle = pal.crystalHot;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.setLineDash(NO_DASH);
  ctx.lineDashOffset = 0;
}
