/**
 * Препятствия: каркасные кубы, циркулярные пилы, лазерные стены.
 * Кубы и пилы одного вида собираются в общие пути и обводятся несколькими
 * штрихами разом (широкий тусклый + средний + тонкий раскалённый) — неон без shadowBlur.
 */
import { WORLD_W } from '../config';
import { clamp, TAU } from '../math';
import type { GameState, Obstacle } from '../types';
import type { FrameInfo } from './frame';
import type { Palette } from './palette';
import { drawSprite, type SpriteCache } from './sprites';
import { hash } from './util';

/** Задняя грань куба: доля размера и сдвиг к точке схода. */
const CUBE_BACK_SCALE = 0.6;
const CUBE_BACK_SHIFT = 0.3;
/** Задержки «призраков» зигзага, сек. */
const GHOST_DELAYS = [0.045, 0.09] as const;
/** Лазер появляется из-за верхней кромки: предупреждение за столько мировых единиц. */
const LASER_WARN_DISTANCE = 150;

function isVisible(o: Obstacle, f: FrameInfo, extent: number): boolean {
  return o.y + extent >= f.top && o.y - extent <= f.bottom && o.x + extent >= f.left && o.x - extent <= f.right;
}

export function drawObstacles(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  f: FrameInfo,
  pal: Palette,
  sprites: SpriteCache,
): void {
  let cubes = 0;
  let saws = 0;
  for (const o of state.obstacles) {
    if (o.kind === 'laser') drawLaser(ctx, o, f, pal, sprites);
    else if (o.kind === 'cube') cubes++;
    else saws++;
  }
  if (saws > 0) drawSaws(ctx, state, f, pal, sprites);
  if (cubes > 0) drawCubes(ctx, state, f, pal, sprites);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ─── Зигзаг: полупрозрачные «призраки» на прошлых позициях ───────────────────

/** Позиция препятствия delay секунд назад по формуле зигзага. */
function ghostX(o: Obstacle, delay: number): number {
  const z = o.zigzag;
  if (!z) return o.x;
  return o.baseX + z.amp * Math.sin(TAU * z.freq * (o.age - delay) + z.phase);
}

function ghostY(o: Obstacle, state: GameState, f: FrameInfo, delay: number): number {
  return o.y - o.vy * state.speedMult * f.heightFactor * delay;
}

// ─── Кубы ───────────────────────────────────────────────────────────────────

/** Квадрат с центром (x, y), полустороной s и поворотом (cos, sin) — в текущий путь. */
function squarePath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, c: number, sn: number): void {
  const ux = c * s;
  const uy = sn * s;
  const vx = -sn * s;
  const vy = c * s;
  ctx.moveTo(x - ux - vx, y - uy - vy);
  ctx.lineTo(x + ux - vx, y + uy - vy);
  ctx.lineTo(x + ux + vx, y + uy + vy);
  ctx.lineTo(x - ux + vx, y - uy + vy);
  ctx.closePath();
}

function drawCubes(ctx: CanvasRenderingContext2D, state: GameState, f: FrameInfo, pal: Palette, sprites: SpriteCache): void {
  const list = state.obstacles;
  ctx.globalCompositeOperation = 'lighter';

  // Ореолы.
  const halo = sprites.glow(pal.cube);
  ctx.globalAlpha = 0.3;
  for (const o of list) {
    if (o.kind !== 'cube' || !isVisible(o, f, o.size * 1.6)) continue;
    drawSprite(ctx, halo, o.x, o.y, o.size * 3.3);
  }

  // Призраки зигзага: подсказывают, куда куб виляет.
  let ghosts = false;
  ctx.beginPath();
  for (const o of list) {
    if (o.kind !== 'cube' || !o.zigzag || !isVisible(o, f, o.size * 3)) continue;
    ghosts = true;
    for (const d of GHOST_DELAYS) {
      const rot = o.rotation - o.spin * d;
      squarePath(ctx, ghostX(o, d), ghostY(o, state, f, d), o.size * 0.92, Math.cos(rot), Math.sin(rot));
    }
  }
  if (ghosts) {
    ctx.strokeStyle = pal.cube;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.2;
    ctx.stroke();
  }

  // Тело: тёмная заливка (сетка не просвечивает) и лёгкий цветной оттенок.
  ctx.beginPath();
  for (const o of list) {
    if (o.kind !== 'cube' || !isVisible(o, f, o.size * 1.5)) continue;
    squarePath(ctx, o.x, o.y, o.size, Math.cos(o.rotation), Math.sin(o.rotation));
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = pal.body;
  ctx.globalAlpha = 0.72;
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = pal.cube;
  ctx.globalAlpha = 0.1;
  ctx.fill();

  // Передняя грань (= хитбокс по размеру и повороту): три штриха неона.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = pal.cube;
  ctx.lineWidth = 6.5;
  ctx.globalAlpha = 0.16;
  ctx.stroke();
  ctx.lineWidth = 2.8;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.strokeStyle = pal.cubeHot;
  ctx.lineWidth = 1.15;
  ctx.globalAlpha = 1;
  ctx.stroke();

  // Задняя грань и рёбра — тусклее, отсюда ощущение объёма.
  ctx.beginPath();
  for (const o of list) {
    if (o.kind !== 'cube' || !isVisible(o, f, o.size * 1.5)) continue;
    const c = Math.cos(o.rotation);
    const sn = Math.sin(o.rotation);
    const dx = f.vanishX - o.x;
    const dy = f.vanishY - o.y;
    const len = Math.hypot(dx, dy) || 1;
    const shift = o.size * CUBE_BACK_SHIFT;
    const bx = o.x + (dx / len) * shift;
    const by = o.y + (dy / len) * shift;
    const s = o.size;
    const b = s * CUBE_BACK_SCALE;
    squarePath(ctx, bx, by, b, c, sn);
    // Рёбра между соответствующими углами передней и задней граней.
    for (let k = 0; k < 4; k++) {
      const lx = k === 0 || k === 3 ? -1 : 1;
      const ly = k < 2 ? -1 : 1;
      const fx = lx * c - ly * sn;
      const fy = lx * sn + ly * c;
      ctx.moveTo(o.x + fx * s, o.y + fy * s);
      ctx.lineTo(bx + fx * b, by + fy * b);
    }
  }
  ctx.strokeStyle = pal.cube;
  ctx.lineWidth = 3.2;
  ctx.globalAlpha = 0.14;
  ctx.stroke();
  ctx.strokeStyle = pal.cubeHot;
  ctx.lineWidth = 0.9;
  ctx.globalAlpha = 0.55;
  ctx.stroke();

  // Энергетическое ядро в центре.
  const core = sprites.hot(pal.cube);
  ctx.globalAlpha = 0.45;
  for (const o of list) {
    if (o.kind !== 'cube' || !isVisible(o, f, o.size)) continue;
    drawSprite(ctx, core, o.x, o.y, o.size * 0.7);
  }
}

// ─── Пилы ───────────────────────────────────────────────────────────────────

function teethFor(r: number): number {
  return clamp(Math.round(r * 0.52), 10, 18);
}

/** Контур пилы с зубьями (пологий подъём, крутой спад) — в текущий путь. */
function sawPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  const teeth = teethFor(r);
  const step = TAU / teeth;
  const inner = r * 0.8;
  for (let i = 0; i < teeth; i++) {
    const a = rot + i * step;
    const tip = a + step * 0.8;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
    else ctx.lineTo(x + Math.cos(a) * inner, y + Math.sin(a) * inner);
    ctx.lineTo(x + Math.cos(tip) * r, y + Math.sin(tip) * r);
  }
  ctx.closePath();
}

function circlePath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
}

function drawSaws(ctx: CanvasRenderingContext2D, state: GameState, f: FrameInfo, pal: Palette, sprites: SpriteCache): void {
  const list = state.obstacles;
  ctx.globalCompositeOperation = 'lighter';

  const halo = sprites.glow(pal.saw);
  ctx.globalAlpha = 0.28;
  for (const o of list) {
    if (o.kind !== 'saw' || !isVisible(o, f, o.size * 1.5)) continue;
    drawSprite(ctx, halo, o.x, o.y, o.size * 2.7);
  }

  let ghosts = false;
  ctx.beginPath();
  for (const o of list) {
    if (o.kind !== 'saw' || !o.zigzag || !isVisible(o, f, o.size * 3)) continue;
    ghosts = true;
    for (const d of GHOST_DELAYS) circlePath(ctx, ghostX(o, d), ghostY(o, state, f, d), o.size * 0.85);
  }
  if (ghosts) {
    ctx.strokeStyle = pal.saw;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.2;
    ctx.stroke();
  }

  // Диск с зубьями.
  ctx.beginPath();
  for (const o of list) {
    if (o.kind !== 'saw' || !isVisible(o, f, o.size * 1.2)) continue;
    sawPath(ctx, o.x, o.y, o.size, o.rotation);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = pal.body;
  ctx.globalAlpha = 0.75;
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = pal.saw;
  ctx.globalAlpha = 0.12;
  ctx.fill();
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = pal.saw;
  ctx.lineWidth = 5.5;
  ctx.globalAlpha = 0.16;
  ctx.stroke();
  ctx.lineWidth = 2.4;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.strokeStyle = pal.sawHot;
  ctx.lineWidth = 1.05;
  ctx.globalAlpha = 1;
  ctx.stroke();

  // Размытие вращения: светлое кольцо по зубьям.
  ctx.beginPath();
  for (const o of list) {
    if (o.kind !== 'saw' || !isVisible(o, f, o.size * 1.2)) continue;
    circlePath(ctx, o.x, o.y, o.size * 0.9);
  }
  ctx.strokeStyle = pal.saw;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.14;
  ctx.stroke();

  // Внутреннее кольцо, ступица и отверстия, вращаются вместе с диском.
  ctx.beginPath();
  for (const o of list) {
    if (o.kind !== 'saw' || !isVisible(o, f, o.size * 1.2)) continue;
    const r = o.size;
    circlePath(ctx, o.x, o.y, r * 0.56);
    circlePath(ctx, o.x, o.y, r * 0.17);
    for (let k = 0; k < 3; k++) {
      const a = o.rotation + (k * TAU) / 3;
      circlePath(ctx, o.x + Math.cos(a) * r * 0.37, o.y + Math.sin(a) * r * 0.37, r * 0.085);
    }
  }
  ctx.strokeStyle = pal.saw;
  ctx.lineWidth = 2.6;
  ctx.globalAlpha = 0.25;
  ctx.stroke();
  ctx.strokeStyle = pal.sawHot;
  ctx.lineWidth = 0.9;
  ctx.globalAlpha = 0.85;
  ctx.stroke();

  const core = sprites.hot(pal.saw);
  ctx.globalAlpha = 0.6;
  for (const o of list) {
    if (o.kind !== 'saw' || !isVisible(o, f, o.size)) continue;
    drawSprite(ctx, core, o.x, o.y, o.size * 0.45);
  }
}

// ─── Лазерная стена ─────────────────────────────────────────────────────────

function drawLaser(ctx: CanvasRenderingContext2D, o: Obstacle, f: FrameInfo, pal: Palette, sprites: SpriteCache): void {
  const th = o.size;
  const y = o.y;
  const gl = clamp(o.x - o.gapW / 2, 0, WORLD_W);
  const gr = clamp(o.x + o.gapW / 2, 0, WORLD_W);

  if (y < -th * 2) drawLaserWarning(ctx, o, f, pal, sprites, gl, gr);
  if (y + th * 8 < f.top || y - th * 8 > f.bottom) return;

  // Мерцание и треск — детерминированный шум от времени, на паузе кадр замирает.
  const tick = Math.floor(f.time * 36);
  const flick = 0.82 + 0.18 * hash(tick + o.id * 13.7);

  // Тёмная подложка: луч читается даже на фоне яркого солнца.
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = pal.body;
  ctx.globalAlpha = 0.55;
  if (gl > 0) ctx.fillRect(0, y - th * 2.2, gl, th * 4.4);
  if (gr < WORLD_W) ctx.fillRect(gr, y - th * 2.2, WORLD_W - gr, th * 4.4);
  ctx.globalCompositeOperation = 'lighter';

  // Подсветка прохода: мягкое «безопасное» пятно, скобки по краям и шевроны.
  const gapW = gr - gl;
  if (gapW > 1) {
    ctx.globalAlpha = 0.22;
    ctx.drawImage(sprites.glow(pal.gap), gl, y - th * 6, gapW, th * 12);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    const arm = Math.min(10, gapW * 0.2);
    ctx.moveTo(gl + arm, y - th * 4);
    ctx.lineTo(gl + 2, y - th * 4);
    ctx.lineTo(gl + 2, y + th * 4);
    ctx.lineTo(gl + arm, y + th * 4);
    ctx.moveTo(gr - arm, y - th * 4);
    ctx.lineTo(gr - 2, y - th * 4);
    ctx.lineTo(gr - 2, y + th * 4);
    ctx.lineTo(gr - arm, y + th * 4);
    // Шевроны «сюда» в центре прохода, бегут вниз.
    const cx = (gl + gr) / 2;
    const run = (f.time * 2.2) % 1;
    for (let k = 0; k < 2; k++) {
      const cy = y - th * 2.6 + (k + run) * th * 2.4;
      ctx.moveTo(cx - th * 1.3, cy - th * 0.7);
      ctx.lineTo(cx, cy + th * 0.4);
      ctx.lineTo(cx + th * 1.3, cy - th * 0.7);
    }
    ctx.strokeStyle = pal.gap;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Ореол, тело и раскалённая сердцевина луча — по двум отрезкам.
  const beam = sprites.beam(pal.laser);
  ctx.globalAlpha = 0.75 * flick;
  if (gl > 0) ctx.drawImage(beam, 0, y - th * 7, gl, th * 14);
  if (gr < WORLD_W) ctx.drawImage(beam, gr, y - th * 7, WORLD_W - gr, th * 14);
  ctx.fillStyle = pal.laser;
  ctx.globalAlpha = 0.9 * flick;
  if (gl > 0) ctx.fillRect(0, y - th * 0.85, gl, th * 1.7);
  if (gr < WORLD_W) ctx.fillRect(gr, y - th * 0.85, WORLD_W - gr, th * 1.7);
  ctx.fillStyle = pal.laserHot;
  ctx.globalAlpha = 1;
  if (gl > 0) ctx.fillRect(0, y - th * 0.3, gl, th * 0.6);
  if (gr < WORLD_W) ctx.fillRect(gr, y - th * 0.3, WORLD_W - gr, th * 0.6);

  // Треск: пара искр, пробегающих по лучу.
  for (let j = 0; j < 4; j++) {
    const sx = hash(tick * 1.7 + j * 5.3 + o.id) * WORLD_W;
    if (sx > gl - 2 && sx < gr + 2) continue;
    const sy = y + (hash(tick * 2.3 + j * 11.1 + o.id) - 0.5) * th * 3;
    ctx.fillRect(sx - 1, sy - 1, 2, 2);
  }

  // Концы луча у прохода и эмиттеры по краям поля.
  const hot = sprites.hot(pal.laser);
  ctx.globalAlpha = 0.9 * flick;
  if (gl > 0) drawSprite(ctx, hot, gl, y, th * 4.5);
  if (gr < WORLD_W) drawSprite(ctx, hot, gr, y, th * 4.5);
  ctx.globalAlpha = 1;
  drawSprite(ctx, hot, 0, y, th * 6);
  drawSprite(ctx, hot, WORLD_W, y, th * 6);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = pal.body;
  ctx.fillRect(-3, y - th * 2.4, 7, th * 4.8);
  ctx.fillRect(WORLD_W - 4, y - th * 2.4, 7, th * 4.8);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = pal.laserHot;
  ctx.lineWidth = 1;
  ctx.strokeRect(-3, y - th * 2.4, 7, th * 4.8);
  ctx.strokeRect(WORLD_W - 4, y - th * 2.4, 7, th * 4.8);
}

/** Лазер ещё за верхней кромкой: мигающая разметка будущей стены и её прохода. */
function drawLaserWarning(
  ctx: CanvasRenderingContext2D,
  o: Obstacle,
  f: FrameInfo,
  pal: Palette,
  sprites: SpriteCache,
  gl: number,
  gr: number,
): void {
  const distance = -o.y;
  if (distance > LASER_WARN_DISTANCE) return;
  const k = 1 - distance / LASER_WARN_DISTANCE;
  const blink = Math.floor(f.time * 9) % 2 === 0 ? 1 : 0.45;
  // Верхняя кромка экрана — мировой y = 0.
  const y = 3;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5 * k * blink;
  ctx.fillStyle = pal.laser;
  if (gl > 0) ctx.fillRect(0, y - 0.6, gl, 1.2);
  if (gr < WORLD_W) ctx.fillRect(gr, y - 0.6, WORLD_W - gr, 1.2);
  const hot = sprites.hot(pal.laser);
  ctx.globalAlpha = k * blink;
  drawSprite(ctx, hot, 0, y, 10 + 8 * k);
  drawSprite(ctx, hot, WORLD_W, y, 10 + 8 * k);
  ctx.globalAlpha = 1;
}
