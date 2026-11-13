/**
 * Горизонт — свой у каждой темы: город, пальмы, заводы или ледяные пики под
 * сиянием. Два плана с параллаксом от положения корабля: дальний запекается в
 * слой неба (см. backdrop.ts) и едва сдвигается вместе с ним, ближний живёт
 * отдельным слоем и сдвигается заметнее. Поверх ближнего — немного живых
 * деталей: маячки на крышах и дым из труб.
 *
 * Художники рисуют в координатах экрана по X и «от горизонта вверх» по Y
 * (0 — линия горизонта, отрицательные значения — выше).
 */
import { createRng, type Rng } from '../core/rng';
import { clamp, lighten, mixColor, rgba, smoothstep, TAU } from '../core/math';
import type { Scenery as SceneryKind, Theme, ThemeColors } from '../core/types';
import type { Camera } from './camera';
import { BLEED, blit, freeLayer, layerContext, makeLayer, type View } from './view';

interface Plane {
  canvas: HTMLCanvasElement;
  /** Левый верхний угол слоя без сдвига, пиксели устройства. */
  x0: number;
  y0: number;
  /** Наибольший сдвиг параллакса, CSS-пиксели. */
  range: number;
}

/** Дальний план для запекания в небо. rays — лучи сияния пятёрками: x, верх, высота, фаза, частота. */
export interface FarPlane extends Plane {
  rays: number[];
}

/** Мигающий огонёк на крыше или трубе. */
interface Beacon {
  x: number;
  y: number;
  r: number;
  phase: number;
  rate: number;
  color: string;
}

/** Источник дыма: клубы поднимаются из этой точки. */
interface Vent {
  x: number;
  y: number;
  size: number;
  phase: number;
  color: string;
}

interface Painter {
  ctx: CanvasRenderingContext2D;
  rng: Rng;
  colors: ThemeColors;
  cam: Camera;
  /** Масштаб деталей: 1 на экране 1280×800. */
  sc: number;
  left: number;
  right: number;
  /** Высота слоя над горизонтом. */
  h: number;
  beacons: Beacon[];
  vents: Vent[];
  rays: number[];
}

/** Сколько клубов дыма одновременно висит над одной трубой. */
const PUFFS = 4;

function detailScale(cam: Camera): number {
  return clamp(cam.horizonY / 272, 0.42, 1.4);
}

/** Дальний план: рисуется во временный слой, который задник переносит в небо. */
export function paintFarPlane(cam: Camera, theme: Theme, kx: number, ky: number, seed: number): FarPlane {
  const span = cam.lineY - cam.horizonY;
  // Сияние занимает почти всё небо, остальным хватает полосы над горизонтом.
  const height = theme.scenery === 'aurora' ? cam.horizonY * 0.94 : Math.min(cam.horizonY * 0.5, span * 0.4);
  const rays: number[] = [];
  const plane = paintPlane(cam, kx, ky, height, 7 * detailScale(cam), theme.colors, createRng(seed + 11), [], [], rays, FAR_PAINTERS[theme.scenery]);
  return { ...plane, rays };
}

/** Ближний план горизонта с живыми деталями. */
export class Scenery {
  private near: Plane | null = null;
  private readonly beacons: Beacon[] = [];
  private readonly vents: Vent[] = [];

  build(cam: Camera, theme: Theme, kx: number, ky: number, seed: number): void {
    this.dispose();
    const span = cam.lineY - cam.horizonY;
    const height = Math.min(cam.horizonY * 0.62, span * 0.48);
    this.near = paintPlane(
      cam,
      kx,
      ky,
      height,
      18 * detailScale(cam),
      theme.colors,
      createRng(seed + 23),
      this.beacons,
      this.vents,
      [],
      NEAR_PAINTERS[theme.scenery],
    );
  }

  /** ox, oy — сдвиг тряски в пикселях устройства (целые). */
  draw(view: View, ox: number, oy: number): void {
    const near = this.near;
    if (!near) return;
    const ctx = view.ctx;
    const lean = clamp((view.shipX - 50) / 50, -1, 1);
    // Сдвиг округляется до пикселя устройства: слой остаётся резким, а блит — дешёвым.
    const shift = Math.round(-lean * near.range * view.kx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(near.canvas, near.x0 + ox + shift, near.y0 + oy);

    if (this.beacons.length === 0 && this.vents.length === 0) return;
    ctx.setTransform(view.kx, 0, 0, view.ky, ox + shift, oy + Math.round(view.cam.horizonY * view.ky));
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.beacons) {
      const blink = view.reduced ? 0.7 : Math.pow(0.5 + 0.5 * Math.sin(view.now * b.rate + b.phase), 3);
      if (blink < 0.04) continue;
      ctx.globalAlpha = blink;
      blit(ctx, view.sprites.core(b.color), b.x, b.y, b.r * 3.2, b.r * 3.2);
    }
    for (const v of this.vents) {
      const sprite = view.sprites.halo(v.color);
      for (let i = 0; i < PUFFS; i++) {
        // Каждый клуб живёт свой цикл: поднимается, растёт и тает.
        const life = view.reduced ? (i + 0.5) / PUFFS : (view.now * 0.11 + v.phase + i / PUFFS) % 1;
        const r = v.size * (0.7 + life * 2.4);
        ctx.globalAlpha = 0.34 * Math.sin(Math.PI * life);
        blit(ctx, sprite, v.x + life * v.size * 3.4, v.y - life * v.size * 6.5, r * 1.5, r);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose(): void {
    freeLayer(this.near?.canvas ?? null);
    this.near = null;
    this.beacons.length = 0;
    this.vents.length = 0;
  }
}

function paintPlane(
  cam: Camera,
  kx: number,
  ky: number,
  height: number,
  range: number,
  colors: ThemeColors,
  rng: Rng,
  beacons: Beacon[],
  vents: Vent[],
  rays: number[],
  paint: (p: Painter) => void,
): Plane {
  const margin = BLEED + range + 2;
  const canvas = makeLayer((cam.cssW + margin * 2) * kx, height * ky);
  const plane: Plane = {
    canvas,
    x0: -Math.round(margin * kx),
    y0: Math.round(cam.horizonY * ky) - canvas.height,
    range,
  };
  const ctx = layerContext(canvas);
  if (!ctx) return plane;
  ctx.setTransform(kx, 0, 0, ky, -plane.x0, canvas.height);
  paint({ ctx, rng, colors, cam, sc: detailScale(cam), left: -margin, right: cam.cssW + margin, h: height, beacons, vents, rays });
  return plane;
}

/**
 * Профиль высоты: в центре, над дорогой и перед солнцем, декорации низкие,
 * к краям экрана поднимаются. floor — доля высоты в самом центре.
 */
function envelope(p: Painter, x: number, floor: number, from: number, to: number): number {
  const xn = Math.abs(x - p.cam.cx) / (p.cam.cssW / 2);
  return floor + (1 - floor) * smoothstep(from, to, xn);
}

/** Силуэты растворяются в дымке у основания — так планы не «вырезаны ножницами». */
function sinkIntoHaze(p: Painter, strength: number, reach: number): void {
  const { ctx, colors } = p;
  const g = ctx.createLinearGradient(0, -p.h * reach, 0, 0);
  const tone = mixColor(colors.skyBottom, colors.haze, 0.55);
  g.addColorStop(0, rgba(tone, 0));
  g.addColorStop(1, rgba(tone, strength));
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = g;
  ctx.fillRect(p.left, -p.h, p.right - p.left, p.h);
  ctx.globalCompositeOperation = 'source-over';
}

/** Неоновая обводка: свечение через shadowBlur допустимо — слой рисуется один раз. */
function neonStroke(p: Painter, color: string, alpha: number, width: number, blur: number): void {
  const ctx = p.ctx;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * p.sc;
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = Math.max(0.6, width * p.sc);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ─── Город ──────────────────────────────────────────────────────────────────

function paintCityFar(p: Painter): void {
  const { ctx, rng, colors, sc } = p;
  const body = mixColor(colors.skyBottom, colors.sceneryFar, 0.34);
  const light = lighten(colors.sceneryFar, 0.35);
  let x = p.left;
  while (x < p.right) {
    const w = rng.range(9, 30) * sc;
    const h = p.h * envelope(p, x + w / 2, 0.34, 0, 0.75) * rng.range(0.3, 1);
    ctx.fillStyle = body;
    ctx.fillRect(x, -h, w + 0.5, h);
    ctx.fillStyle = rgba(light, 0.55);
    ctx.fillRect(x, -h, w, Math.max(0.7, sc));
    // Редкие окна — крошечные точки.
    ctx.fillStyle = rgba(light, 0.4);
    const step = 4 * sc;
    for (let wy = -h + step; wy < -step; wy += step) {
      for (let wx = x + step * 0.5; wx < x + w - step * 0.5; wx += step) {
        if (rng.chance(0.16)) ctx.fillRect(wx, wy, Math.max(0.8, 1.2 * sc), Math.max(0.8, 1.2 * sc));
      }
    }
    x += w + rng.range(-1, 3) * sc;
  }
  sinkIntoHaze(p, 0.8, 0.7);
}

function paintCityNear(p: Painter): void {
  const { ctx, rng, colors, sc } = p;
  const body = mixColor(colors.bg, colors.sceneryNear, 0.06);
  const lights = [colors.sceneryNear, colors.sceneryNear, colors.accent3, colors.accent];
  let x = p.left - 6 * sc;
  while (x < p.right) {
    const w = rng.range(20, 56) * sc;
    const h = Math.max(6 * sc, p.h * envelope(p, x + w / 2, 0.13, 0.1, 0.86) * rng.range(0.42, 0.94));
    const style = rng.int(0, 4);
    const lit = rng.pick(lights);

    // Контур башни: плоская крыша, уступ, скос или шпиль.
    ctx.beginPath();
    ctx.moveTo(x, 0);
    if (style === 1) {
      const inset = w * rng.range(0.16, 0.26);
      const step = h * rng.range(0.74, 0.86);
      ctx.lineTo(x, -step);
      ctx.lineTo(x + inset, -step);
      ctx.lineTo(x + inset, -h);
      ctx.lineTo(x + w - inset, -h);
      ctx.lineTo(x + w - inset, -step);
      ctx.lineTo(x + w, -step);
    } else if (style === 2) {
      ctx.lineTo(x, -h * 0.86);
      ctx.lineTo(x + w * 0.62, -h);
      ctx.lineTo(x + w, -h * 0.93);
    } else {
      ctx.lineTo(x, -h);
      ctx.lineTo(x + w, -h);
    }
    ctx.lineTo(x + w, 0);
    ctx.fillStyle = body;
    ctx.fill();
    neonStroke(p, colors.sceneryNear, 0.8, 1, 5);

    // Окна: сетка, часть горит.
    const cellX = 4.6 * sc;
    const cellY = 5.4 * sc;
    const winW = Math.max(1, 2.2 * sc);
    const winH = Math.max(1, 2.8 * sc);
    const top = style === 2 ? -h * 0.84 : style === 1 ? -h * 0.72 : -h + cellY * 0.6;
    const share = rng.range(0.14, 0.42);
    for (let wy = top + cellY * 0.5; wy < -cellY; wy += cellY) {
      for (let wx = x + cellX * 0.7; wx < x + w - cellX * 0.9; wx += cellX) {
        if (!rng.chance(share)) continue;
        ctx.fillStyle = rgba(rng.chance(0.82) ? lit : rng.pick(lights), rng.range(0.4, 0.95));
        ctx.fillRect(wx, wy, winW, winH);
      }
    }
    // Вертикальная неоновая вывеска на некоторых башнях.
    if (rng.chance(0.24) && w > 26 * sc) {
      const sx = x + w * rng.range(0.2, 0.8);
      ctx.fillStyle = rgba(colors.accent, 0.85);
      ctx.fillRect(sx, -h * rng.range(0.55, 0.8), Math.max(1, 1.6 * sc), h * 0.3);
    }
    // Шпиль с маячком.
    if (style === 3 || (style === 0 && rng.chance(0.3))) {
      const mast = h * rng.range(0.12, 0.26);
      const mx = x + w * rng.range(0.3, 0.7);
      ctx.fillStyle = rgba(colors.sceneryNear, 0.8);
      ctx.fillRect(mx - 0.5 * sc, -h - mast, Math.max(0.8, sc), mast);
      p.beacons.push({ x: mx, y: -h - mast, r: 2.2 * sc, phase: rng.range(0, TAU), rate: rng.range(1.6, 3.4), color: colors.laser });
    }
    x += w + rng.range(-4, 5) * sc;
  }
  sinkIntoHaze(p, 0.42, 0.34);
}

// ─── Пальмы и холмы ─────────────────────────────────────────────────────────

/** Высоты гребня: несколько октав плавного шума. */
function ridge(p: Painter, step: number, rough: number): number[] {
  const { rng } = p;
  const n = Math.ceil((p.right - p.left) / step) + 2;
  const out = new Array<number>(n).fill(0);
  let amp = 1;
  let total = 0;
  for (let period = 16; period >= 1; period = Math.floor(period / 2)) {
    const knots: number[] = [];
    for (let i = 0; i <= Math.ceil(n / period) + 1; i++) knots.push(rng.next());
    for (let i = 0; i < n; i++) {
      const k = Math.floor(i / period);
      const f = (i % period) / period;
      const u = f * f * (3 - 2 * f);
      out[i] += (knots[k] + (knots[k + 1] - knots[k]) * u) * amp;
    }
    total += amp;
    amp *= rough;
  }
  for (let i = 0; i < n; i++) out[i] /= total;
  return out;
}

function paintPalmsFar(p: Painter): void {
  const { ctx, colors, sc } = p;
  const step = 13 * sc;
  const heights = ridge(p, step, 0.62);
  const n = heights.length;
  const yAt = (i: number): number => -p.h * envelope(p, p.left + i * step, 0.2, 0.04, 0.8) * (0.22 + 0.78 * heights[i]);

  const g = ctx.createLinearGradient(0, -p.h, 0, 0);
  g.addColorStop(0, mixColor(colors.skyBottom, colors.sceneryFar, 0.62));
  g.addColorStop(1, mixColor(colors.bg, colors.sceneryFar, 0.3));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(p.left, 0);
  for (let i = 0; i < n; i++) ctx.lineTo(p.left + i * step, yAt(i));
  ctx.lineTo(p.left + (n - 1) * step, 0);
  ctx.closePath();
  ctx.fill();

  // Каркас гор: рёбра от гребня к подножию и горизонтали.
  const wire = lighten(colors.sceneryFar, 0.3);
  ctx.beginPath();
  for (let i = 0; i < n; i += 2) {
    const x = p.left + i * step;
    ctx.moveTo(x, yAt(i));
    ctx.lineTo(x + (x - p.cam.cx) * 0.05, 0);
  }
  for (const level of [0.34, 0.67]) {
    ctx.moveTo(p.left, yAt(0) * level);
    for (let i = 1; i < n; i++) ctx.lineTo(p.left + i * step, yAt(i) * level);
  }
  ctx.strokeStyle = rgba(wire, 0.3);
  ctx.lineWidth = Math.max(0.6, 0.8 * sc);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.left, yAt(0));
  for (let i = 1; i < n; i++) ctx.lineTo(p.left + i * step, yAt(i));
  neonStroke(p, wire, 0.9, 1.1, 6);
  sinkIntoHaze(p, 0.7, 0.6);
}

function paintPalm(p: Painter, x: number, base: number, height: number, lean: number, body: string): void {
  const { ctx, rng, colors, sc } = p;
  const topX = x + lean * height;
  const topY = base - height;
  const bendX = x + lean * height * 0.15;
  const bendY = base - height * 0.6;
  const thick = Math.max(1.4, height * 0.035);

  // Ствол: сужающаяся изогнутая лента.
  ctx.beginPath();
  ctx.moveTo(x - thick, base);
  ctx.quadraticCurveTo(bendX - thick * 0.8, bendY, topX - thick * 0.4, topY);
  ctx.lineTo(topX + thick * 0.4, topY);
  ctx.quadraticCurveTo(bendX + thick * 0.8, bendY, x + thick, base);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = rgba(colors.sceneryNear, 0.42);
  ctx.lineWidth = Math.max(0.6, 0.8 * sc);
  ctx.stroke();

  // Крона: веер перистых листьев, каждый — серп с бахромой.
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const spread = (i / (fronds - 1)) * 2 - 1;
    const angle = -Math.PI / 2 + spread * 1.75 + rng.range(-0.12, 0.12);
    const len = height * rng.range(0.34, 0.46) * (1 - Math.abs(spread) * 0.12);
    const droop = len * (0.25 + Math.abs(spread) * 0.5);
    const tipX = topX + Math.cos(angle) * len;
    const tipY = topY + Math.sin(angle) * len + droop;
    const cx = topX + Math.cos(angle) * len * 0.5;
    const cy = topY + Math.sin(angle) * len * 0.62 - len * 0.2;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(cx, cy, tipX, tipY);
    ctx.quadraticCurveTo(cx, cy + len * 0.2, topX, topY);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(cx, cy, tipX, tipY);
    // Бахрома: короткие штрихи вниз от жилки листа.
    for (let j = 1; j <= 7; j++) {
      const u = j / 8;
      const qx = (1 - u) * (1 - u) * topX + 2 * (1 - u) * u * cx + u * u * tipX;
      const qy = (1 - u) * (1 - u) * topY + 2 * (1 - u) * u * cy + u * u * tipY;
      ctx.moveTo(qx, qy);
      ctx.lineTo(qx + Math.cos(angle) * len * 0.05, qy + len * 0.16 * Math.sin(Math.PI * u));
    }
    ctx.strokeStyle = rgba(colors.sceneryNear, 0.55);
    ctx.lineWidth = Math.max(0.6, 0.9 * sc);
    ctx.stroke();
  }
}

function paintPalmsNear(p: Painter): void {
  const { ctx, rng, colors, sc } = p;
  const body = mixColor(colors.bg, colors.sceneryNear, 0.07);
  const step = 16 * sc;
  const heights = ridge(p, step, 0.5);
  const n = heights.length;
  const yAt = (i: number): number => -p.h * 0.2 * envelope(p, p.left + i * step, 0.14, 0.08, 0.9) * (0.35 + 0.65 * heights[i]);

  // Пальмы стоят по сторонам от дороги: центр остаётся солнцу.
  const half = p.cam.cssW / 2;
  const spacing = Math.max(46 * sc, half / 5.5);
  for (let side = -1; side <= 1; side += 2) {
    for (let d = Math.max(half * 0.2, 70 * sc); d < half + p.right - p.cam.cssW + 30; d += spacing * rng.range(0.7, 1.25)) {
      const x = p.cam.cx + side * d;
      const tall = p.h * rng.range(0.5, 0.96) * envelope(p, x, 0.5, 0.15, 0.7);
      paintPalm(p, x, 0, tall, -side * rng.range(0.04, 0.24), body);
    }
  }

  // Холмы перед стволами.
  ctx.beginPath();
  ctx.moveTo(p.left, 0);
  for (let i = 0; i < n; i++) ctx.lineTo(p.left + i * step, yAt(i));
  ctx.lineTo(p.left + (n - 1) * step, 0);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(p.left, yAt(0));
  for (let i = 1; i < n; i++) ctx.lineTo(p.left + i * step, yAt(i));
  neonStroke(p, colors.sceneryNear, 0.75, 1, 5);
  sinkIntoHaze(p, 0.3, 0.2);
}

// ─── Заводы ─────────────────────────────────────────────────────────────────

function paintToxicFar(p: Painter): void {
  const { ctx, rng, colors, sc } = p;
  // Смог: тяжёлые фиолетовые облака над цехами.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const x = p.left + rng.next() * (p.right - p.left);
    const y = -p.h * rng.range(0.25, 0.8) * envelope(p, x, 0.45, 0, 0.7);
    const r = p.h * rng.range(0.3, 0.6);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(colors.sceneryFar, 0.2));
    g.addColorStop(1, rgba(colors.sceneryFar, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 1.6, y - r, r * 3.2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';

  const body = mixColor(colors.skyBottom, colors.sceneryFar, 0.4);
  const edge = lighten(colors.sceneryFar, 0.3);
  let x = p.left;
  while (x < p.right) {
    const w = rng.range(24, 60) * sc;
    const h = p.h * 0.5 * envelope(p, x + w / 2, 0.3, 0, 0.7) * rng.range(0.4, 1);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    if (rng.chance(0.5)) {
      // Пилообразная крыша цеха.
      const teeth = Math.max(2, Math.round(w / (9 * sc)));
      const tw = w / teeth;
      ctx.lineTo(x, -h);
      for (let i = 0; i < teeth; i++) {
        ctx.lineTo(x + tw * (i + 1), -h - tw * 0.45);
        ctx.lineTo(x + tw * (i + 1), -h);
      }
    } else {
      ctx.lineTo(x, -h);
      ctx.lineTo(x + w, -h);
    }
    ctx.lineTo(x + w, 0);
    ctx.fill();
    ctx.strokeStyle = rgba(edge, 0.5);
    ctx.lineWidth = Math.max(0.6, 0.8 * sc);
    ctx.stroke();
    if (rng.chance(0.55)) {
      // Дальняя труба.
      const cw = rng.range(2.5, 5) * sc;
      const ch = p.h * rng.range(0.5, 0.95) * envelope(p, x, 0.35, 0, 0.7);
      const cxp = x + w * rng.range(0.2, 0.8);
      ctx.fillRect(cxp, -ch, cw, ch);
      ctx.fillStyle = rgba(edge, 0.6);
      ctx.fillRect(cxp, -ch, cw, Math.max(0.8, sc));
    }
    x += w + rng.range(0, 8) * sc;
  }
  sinkIntoHaze(p, 0.75, 0.7);
}

function paintToxicNear(p: Painter): void {
  const { ctx, rng, colors, sc } = p;
  const body = mixColor(colors.bg, colors.sceneryNear, 0.05);
  const rim = colors.sceneryNear;
  let x = p.left;
  while (x < p.right) {
    const env = envelope(p, x, 0.12, 0.1, 0.85);
    const kind = rng.int(0, 3);
    let w = 0;
    if (kind === 0) {
      // Дымовая труба с полосами и огнями.
      w = rng.range(9, 15) * sc;
      const h = Math.max(10 * sc, p.h * env * rng.range(0.7, 0.98));
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + w * 0.18, -h);
      ctx.lineTo(x + w * 0.82, -h);
      ctx.lineTo(x + w, 0);
      ctx.fillStyle = body;
      ctx.fill();
      neonStroke(p, rim, 0.8, 1, 5);
      for (let i = 0; i < 3; i++) {
        const y = -h * (0.93 - i * 0.07);
        ctx.fillStyle = rgba(i % 2 === 0 ? colors.accent3 : rim, 0.55);
        ctx.fillRect(x + w * 0.2, y, w * 0.6, Math.max(1, h * 0.022));
      }
      p.beacons.push({ x: x + w / 2, y: -h, r: 2 * sc, phase: rng.range(0, TAU), rate: rng.range(1.4, 2.8), color: colors.laser });
      p.vents.push({ x: x + w / 2, y: -h - 3 * sc, size: rng.range(7, 11) * sc, phase: rng.next(), color: rng.chance(0.5) ? colors.sceneryNear : colors.sceneryFar });
    } else if (kind === 1) {
      // Градирня: гиперболоид с паром.
      w = rng.range(34, 52) * sc;
      const h = Math.max(8 * sc, p.h * env * rng.range(0.42, 0.62));
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + w * 0.3, -h * 0.55, x + w * 0.16, -h);
      ctx.lineTo(x + w * 0.84, -h);
      ctx.quadraticCurveTo(x + w * 0.7, -h * 0.55, x + w, 0);
      ctx.fillStyle = body;
      ctx.fill();
      neonStroke(p, rim, 0.75, 1, 5);
      p.vents.push({ x: x + w / 2, y: -h - 2 * sc, size: rng.range(11, 16) * sc, phase: rng.next(), color: colors.sceneryNear });
    } else if (kind === 2) {
      // Резервуар-купол с лесенкой.
      w = rng.range(22, 36) * sc;
      const r = w / 2;
      const h = Math.max(5 * sc, p.h * env * rng.range(0.18, 0.3));
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, -h);
      ctx.arc(x + r, -h, r, Math.PI, TAU);
      ctx.lineTo(x + w, 0);
      ctx.fillStyle = body;
      ctx.fill();
      neonStroke(p, rim, 0.7, 1, 4);
      ctx.fillStyle = rgba(rim, 0.4);
      ctx.fillRect(x + w * 0.7, -h - r * 0.6, Math.max(0.8, sc), h + r * 0.6);
    } else {
      // Цех с трубопроводом и редкими окнами.
      w = rng.range(30, 64) * sc;
      const h = Math.max(6 * sc, p.h * env * rng.range(0.2, 0.42));
      ctx.fillStyle = body;
      ctx.fillRect(x, -h, w, h);
      ctx.beginPath();
      ctx.rect(x, -h, w, h);
      neonStroke(p, rim, 0.7, 1, 4);
      for (let wx = x + 4 * sc; wx < x + w - 5 * sc; wx += 7 * sc) {
        if (rng.chance(0.4)) {
          ctx.fillStyle = rgba(rng.chance(0.7) ? colors.accent3 : rim, rng.range(0.4, 0.85));
          ctx.fillRect(wx, -h * 0.62, 3 * sc, Math.max(1, 2 * sc));
        }
      }
      ctx.fillStyle = rgba(rim, 0.45);
      ctx.fillRect(x - 6 * sc, -h * 0.3, w + 12 * sc, Math.max(1, 1.4 * sc));
    }
    x += w + rng.range(2, 16) * sc;
  }
  sinkIntoHaze(p, 0.36, 0.3);

  // Ядовитый туман стелется у земли.
  const fog = ctx.createLinearGradient(0, -p.h * 0.3, 0, 0);
  fog.addColorStop(0, rgba(colors.sceneryNear, 0));
  fog.addColorStop(1, rgba(colors.sceneryNear, 0.3));
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = fog;
  ctx.fillRect(p.left, -p.h * 0.3, p.right - p.left, p.h * 0.3);
  ctx.globalCompositeOperation = 'source-over';
}

// ─── Льды и сияние ──────────────────────────────────────────────────────────

function paintAuroraFar(p: Painter): void {
  const { ctx, rng, colors, sc } = p;
  // Занавеси сияния: вертикальные столбики света вдоль волнистой кромки.
  ctx.globalCompositeOperation = 'lighter';
  const step = Math.max(1.5, 2 * sc);
  const top = mixColor(colors.sceneryFar, colors.accent2, 0.7);
  for (let curtain = 0; curtain < 3; curtain++) {
    const f1 = rng.range(0.004, 0.008) / sc;
    const f2 = rng.range(0.013, 0.022) / sc;
    const f3 = rng.range(0.02, 0.05) / sc;
    const p1 = rng.range(0, TAU);
    const p2 = rng.range(0, TAU);
    const p3 = rng.range(0, TAU);
    const level = 0.3 + curtain * 0.14;
    const tall = p.h * rng.range(0.34, 0.5);
    for (let x = p.left; x < p.right; x += step) {
      const edge = -p.h * (level + 0.1 * Math.sin(x * f1 + p1) + 0.04 * Math.sin(x * f2 + p2));
      const power = Math.pow(0.5 + 0.5 * Math.sin(x * f3 + p3), 1.6) * (0.45 + 0.55 * Math.sin(x * f1 * 2.3 + p2) ** 2);
      if (power < 0.03) continue;
      const height = tall * (0.55 + 0.45 * power);
      // Самые яркие столбики получают живой луч поверх запечённой занавеси.
      if (power > 0.72 && p.rays.length < 5 * 22 && rng.chance(0.05)) {
        p.rays.push(x, edge - height, height, rng.range(0, TAU), rng.range(0.5, 1.7));
      }
      const g = ctx.createLinearGradient(0, edge - height, 0, edge);
      g.addColorStop(0, rgba(top, 0));
      g.addColorStop(0.55, rgba(mixColor(colors.sceneryFar, top, 0.35), 0.16 * power));
      g.addColorStop(0.94, rgba(colors.sceneryFar, 0.5 * power));
      g.addColorStop(1, rgba(colors.sceneryFar, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x, edge - height, step + 0.4, height);
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // Дальняя гряда.
  const stepX = 11 * sc;
  const heights = ridge(p, stepX, 0.68);
  const low = Math.min(p.h * 0.2, (p.cam.lineY - p.cam.horizonY) * 0.2);
  ctx.beginPath();
  ctx.moveTo(p.left, 0);
  for (let i = 0; i < heights.length; i++) {
    const x = p.left + i * stepX;
    ctx.lineTo(x, -low * envelope(p, x, 0.3, 0, 0.75) * (0.25 + 0.75 * heights[i]));
  }
  ctx.lineTo(p.left + (heights.length - 1) * stepX, 0);
  ctx.closePath();
  ctx.fillStyle = mixColor(colors.skyBottom, colors.sceneryNear, 0.26);
  ctx.fill();
  ctx.strokeStyle = rgba(lighten(colors.sceneryNear, 0.3), 0.55);
  ctx.lineWidth = Math.max(0.6, 0.9 * sc);
  ctx.stroke();
}

function paintAuroraNear(p: Painter): void {
  const { ctx, rng, colors, sc } = p;
  const lit = mixColor(colors.bg, colors.sceneryNear, 0.3);
  const shade = mixColor(colors.bg, colors.sceneryNear, 0.08);
  const peaks: { x: number; h: number; wl: number; wr: number }[] = [];
  let x = p.left - 20 * sc;
  while (x < p.right + 20 * sc) {
    const h = Math.max(5 * sc, p.h * envelope(p, x, 0.12, 0.1, 0.86) * rng.range(0.4, 1));
    peaks.push({ x, h, wl: h * rng.range(0.42, 0.8), wr: h * rng.range(0.42, 0.8) });
    x += rng.range(26, 62) * sc;
  }
  // Высокие — назад, низкие — вперёд.
  peaks.sort((a, b) => b.h - a.h);
  for (const peak of peaks) {
    const apexX = peak.x;
    const apexY = -peak.h;
    // Ломаный гребень делит пик на освещённый и теневой склоны.
    const midX = apexX + rng.range(-0.12, 0.2) * peak.h;
    const midY = -peak.h * rng.range(0.42, 0.58);
    const footX = apexX + rng.range(-0.1, 0.3) * peak.h;
    ctx.beginPath();
    ctx.moveTo(apexX - peak.wl, 0);
    ctx.lineTo(apexX, apexY);
    ctx.lineTo(midX, midY);
    ctx.lineTo(footX, 0);
    ctx.closePath();
    ctx.fillStyle = lit;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(apexX + peak.wr, 0);
    ctx.lineTo(apexX, apexY);
    ctx.lineTo(midX, midY);
    ctx.lineTo(footX, 0);
    ctx.closePath();
    ctx.fillStyle = shade;
    ctx.fill();
    // Ледяная шапка.
    ctx.beginPath();
    ctx.moveTo(apexX - peak.wl * 0.3, apexY * 0.7);
    ctx.lineTo(apexX, apexY);
    ctx.lineTo(apexX + (midX - apexX) * 0.55, apexY + (midY - apexY) * 0.55);
    ctx.lineTo(apexX - peak.wl * 0.12, apexY * 0.78);
    ctx.closePath();
    ctx.fillStyle = rgba(lighten(colors.sceneryNear, 0.5), 0.5);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(apexX - peak.wl, 0);
    ctx.lineTo(apexX, apexY);
    ctx.lineTo(apexX + peak.wr, 0);
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(midX, midY);
    ctx.lineTo(footX, 0);
    neonStroke(p, colors.sceneryNear, 0.75, 1, 5);
  }
  sinkIntoHaze(p, 0.34, 0.3);
}

const FAR_PAINTERS: Record<SceneryKind, (p: Painter) => void> = {
  city: paintCityFar,
  palms: paintPalmsFar,
  toxic: paintToxicFar,
  aurora: paintAuroraFar,
};

const NEAR_PAINTERS: Record<SceneryKind, (p: Painter) => void> = {
  city: paintCityNear,
  palms: paintPalmsNear,
  toxic: paintToxicNear,
  aurora: paintAuroraNear,
};
