/**
 * Статичный фон сцены: небо, звёзды, ретро-солнце с прорезями, неоновые горы,
 * «пол» под горизонтом, приглушение за краями поля и лёгкая виньетка. Всё это
 * рисуется один раз в офскрин-холст на размер экрана и тему, а в кадре — одним
 * drawImage: полноэкранные слои в каждом кадре съедали бы филрейт на DPR 2.
 */
import { clamp, mixColor, rgba, TAU } from '../math';
import type { Theme, Viewport } from '../types';
import type { Palette } from './palette';
import { drawSprite, type SpriteCache } from './sprites';
import { cacheScale, createSurface, hash, hashString, releaseSurface, seededRandom, smoothstep, type Surface } from './util';

/** Горизонт — на 38 % высоты экрана (солнце садится на него). */
export const HORIZON_RATIO = 0.38;
/** Какая доля пола под горизонтом тонет в дымке. */
const FOG_DEPTH = 0.3;
/** Непрозрачность диска солнца. */
const SUN_ALPHA = 0.86;
/** Затемнение фона за пределами игрового поля. */
const OUTSIDE_SHADE = 0.3;
/** Бюджет пикселей кэша фона (≈ 34 МБ): до 1920×1080 при DPR 2 — один в один. */
const BACKGROUND_PIXELS = 8_500_000;
/** Сколько звёзд вспыхивает поверх кэша. */
const TWINKLES = 14;

export interface Horizon {
  /** Y горизонта, CSS-пиксели. */
  hy: number;
  /** Высота «пола» под горизонтом. */
  floorH: number;
  /** Точка схода по X — центр экрана. */
  cx: number;
  sunR: number;
  sunY: number;
}

export function horizonOf(vp: Viewport): Horizon {
  const hy = Math.round(vp.cssH * HORIZON_RATIO);
  const sunR = clamp(Math.min(vp.cssW * 0.3, hy * 0.56), 36, 230);
  return { hy, floorH: vp.cssH - hy, cx: vp.cssW / 2, sunR, sunY: hy - sunR * 0.32 };
}

export class BackgroundCache {
  private surface: Surface | null = null;
  /** Физических пикселей кэша на CSS-пиксель (обычно = dpr). */
  private scale = 1;
  /** Доля бюджета пикселей: рендер снижает её, если кэш не помещается в видеопамять. */
  private quality = 1;
  /** Раскладка и тема, под которые построен кэш (сравнение полей — без строк в кадре). */
  private readonly built = { cssW: 0, cssH: 0, dpr: 0, fieldX: 0, theme: null as Theme | null };
  private fog: CanvasGradient | null = null;

  /** Перестроить кэш, если поменялся размер, плотность пикселей или тема. */
  ensure(ctx: CanvasRenderingContext2D, vp: Viewport, theme: Theme, palette: Palette, h: Horizon): void {
    const b = this.built;
    if (
      this.surface &&
      b.theme === theme &&
      b.cssW === vp.cssW &&
      b.cssH === vp.cssH &&
      b.dpr === vp.dpr &&
      b.fieldX === vp.fieldX
    ) {
      return;
    }
    b.theme = theme;
    b.cssW = vp.cssW;
    b.cssH = vp.cssH;
    b.dpr = vp.dpr;
    b.fieldX = vp.fieldX;
    releaseSurface(this.surface);
    this.scale = cacheScale(vp.cssW, vp.cssH, vp.dpr, BACKGROUND_PIXELS * this.quality);
    this.surface = createSurface(vp.cssW * this.scale, vp.cssH * this.scale);
    if (this.surface) paintScene(this.surface.ctx, vp, this.scale, theme, palette, h);
    // Туман над дальней частью сетки: скрывает частокол линий у точки схода.
    const fog = ctx.createLinearGradient(0, h.hy, 0, h.hy + h.floorH * FOG_DEPTH);
    fog.addColorStop(0, palette.fogStrong);
    fog.addColorStop(0.35, palette.fogMid);
    fog.addColorStop(1, palette.fogClear);
    this.fog = fog;
  }

  /** Весь статичный фон одним блитом (трансформ — единичный, физические пиксели). */
  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (!this.surface) return;
    if (this.scale === vp.dpr) ctx.drawImage(this.surface.canvas, 0, 0);
    else ctx.drawImage(this.surface.canvas, 0, 0, vp.cssW * vp.dpr, vp.cssH * vp.dpr);
  }

  /** Туман у горизонта поверх сетки (трансформ — CSS-пиксели). */
  drawFog(ctx: CanvasRenderingContext2D, vp: Viewport, h: Horizon): void {
    if (!this.fog) return;
    ctx.fillStyle = this.fog;
    ctx.fillRect(0, h.hy, vp.cssW, h.floorH * FOG_DEPTH);
  }

  invalidate(): void {
    this.built.theme = null;
  }

  /** Новая доля бюджета пикселей; кэш перестроится в следующем кадре. */
  setQuality(quality: number): void {
    this.quality = quality;
    this.invalidate();
  }

  dispose(): void {
    releaseSurface(this.surface);
    this.surface = null;
    this.fog = null;
    this.built.theme = null;
  }
}

/**
 * Мерцающие звёзды поверх кэша: редкие вспышки-крестики в небе (трансформ — CSS-пиксели).
 * Позиции и ритм — детерминированный шум, время — симуляции (на паузе замирают).
 */
export function drawTwinkles(ctx: CanvasRenderingContext2D, vp: Viewport, h: Horizon, time: number, sprites: SpriteCache): void {
  const glow = sprites.glow('#ffffff');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < TWINKLES; i++) {
    const s = Math.sin(time * (0.5 + hash(i * 2.31) * 1.1) + i * 2.1);
    if (s <= 0.55) continue;
    // Острый пик: звезда вспыхивает на мгновение и гаснет.
    const a = Math.pow((s - 0.55) / 0.45, 3);
    const x = hash(i * 12.9 + 1.7) * vp.cssW;
    const y = Math.pow(hash(i * 4.1 + 9.3), 1.4) * h.hy * 0.8;
    const r = 2 + 4 * a;
    ctx.globalAlpha = a * 0.9;
    drawSprite(ctx, glow, x, y, r);
    ctx.fillRect(x - r * 2.2, y - 0.35, r * 4.4, 0.7);
    ctx.fillRect(x - 0.35, y - r * 2.2, 0.7, r * 4.4);
  }
  ctx.globalAlpha = 1;
}

// ─── Отрисовка кэша ─────────────────────────────────────────────────────────

function paintScene(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  scale: number,
  theme: Theme,
  palette: Palette,
  h: Horizon,
): void {
  const c = theme.colors;
  const W = vp.cssW;
  const H = vp.cssH;
  const rnd = seededRandom(hashString(theme.id));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, W, H);

  // Небо: тьма наверху, к горизонту — цвет заката.
  const sky = ctx.createLinearGradient(0, 0, 0, h.hy);
  sky.addColorStop(0, c.skyTop);
  sky.addColorStop(0.5, mixColor(c.skyTop, c.skyBottom, 0.35));
  sky.addColorStop(0.85, mixColor(c.skyTop, c.skyBottom, 0.8));
  sky.addColorStop(1, c.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, h.hy + 1);

  // Зарево у горизонта: широкий эллипс цвета солнца.
  ctx.save();
  ctx.translate(h.cx, h.hy);
  ctx.scale(Math.max(W * 0.62, h.sunR * 3), h.hy * 0.55);
  const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  haze.addColorStop(0, rgba(c.sunBottom, 0.42));
  haze.addColorStop(0.45, rgba(c.sunBottom, 0.14));
  haze.addColorStop(1, rgba(c.sunBottom, 0));
  ctx.fillStyle = haze;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillRect(-1, -1, 2, 1);
  ctx.restore();

  paintStars(ctx, W, h, theme, rnd);
  paintSun(ctx, theme, h);
  paintMountains(ctx, W, h, theme, rnd);
  paintFloor(ctx, W, H, h, theme, palette);
  paintFrame(ctx, vp);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function paintStars(ctx: CanvasRenderingContext2D, W: number, h: Horizon, theme: Theme, rnd: () => number): void {
  const c = theme.colors;
  const count = Math.round(clamp((W * h.hy) / 1500, 50, 420));
  const tints = ['#ffffff', '#ffffff', '#ffffff', c.accent2, c.accent, c.accent3];
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const x = rnd() * W;
    // Гуще наверху, у горизонта звёзды тонут в зареве.
    const y = Math.pow(rnd(), 1.5) * h.hy * 0.93;
    const fade = Math.pow(1 - y / h.hy, 0.7);
    const big = rnd() < 0.06;
    const size = big ? 1.4 + rnd() * 0.9 : 0.5 + Math.pow(rnd(), 3) * 1.1;
    const color = tints[Math.floor(rnd() * tints.length)];
    ctx.globalAlpha = (0.25 + rnd() * 0.75) * fade;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.5, 0, TAU);
    ctx.fill();
    if (big) {
      // Крестик-блик у ярких звёзд.
      const len = size * (3 + rnd() * 3);
      ctx.globalAlpha *= 0.55;
      ctx.fillRect(x - len, y - 0.35, len * 2, 0.7);
      ctx.fillRect(x - 0.35, y - len, 0.7, len * 2);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function paintSun(ctx: CanvasRenderingContext2D, theme: Theme, h: Horizon): void {
  const c = theme.colors;
  const R = h.sunR;
  const { cx, sunY } = h;

  // Мягкое свечение вокруг диска.
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(cx, sunY, R * 0.5, cx, sunY, R * 2.6);
  halo.addColorStop(0, rgba(c.sunBottom, 0.5));
  halo.addColorStop(0.3, rgba(c.sunBottom, 0.2));
  halo.addColorStop(0.65, rgba(c.sunBottom, 0.06));
  halo.addColorStop(1, rgba(c.sunBottom, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(cx - R * 2.6, sunY - R * 2.6, R * 5.2, R * 5.2);
  ctx.globalCompositeOperation = 'source-over';

  // Диск с горизонтальными прорезями, которые к низу становятся толще.
  const body = ctx.createLinearGradient(0, sunY - R, 0, sunY + R);
  body.addColorStop(0, mixColor(c.sunTop, '#ffffff', 0.12));
  body.addColorStop(0.35, c.sunTop);
  body.addColorStop(0.7, mixColor(c.sunTop, c.sunBottom, 0.75));
  body.addColorStop(1, c.sunBottom);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, sunY, R, 0, TAU);
  ctx.clip();
  // Диск чуть приглушён: препятствия на его фоне должны оставаться читаемыми.
  ctx.globalAlpha = SUN_ALPHA;
  ctx.fillStyle = body;
  const bottom = sunY + R;
  let y = sunY - R;
  const solidEnd = sunY - R * 0.12;
  ctx.fillRect(cx - R, y, R * 2, solidEnd - y);
  y = solidEnd;
  for (let i = 0; y < bottom; i++) {
    const gap = R * (0.022 + 0.016 * i);
    const band = Math.max(R * 0.035, R * (0.13 - 0.016 * i));
    y += gap;
    ctx.fillRect(cx - R, y, R * 2, Math.min(band, bottom - y));
    y += band;
  }
  // Блик сверху — диск кажется объёмнее.
  const shine = ctx.createRadialGradient(cx, sunY - R * 0.55, 0, cx, sunY - R * 0.55, R * 0.9);
  shine.addColorStop(0, 'rgba(255,255,255,0.22)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.fillRect(cx - R, sunY - R, R * 2, R);
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Ломаная хребта: острые пики, в центре — провал, чтобы не закрывать солнце. */
function ridge(W: number, h: Horizon, rnd: () => number, height: number, step: number, centerGap: number): number[] {
  const pts: number[] = [];
  let x = -step * rnd();
  let up = rnd() < 0.5;
  while (x < W + step) {
    const off = Math.abs(x - h.cx) / Math.max(W, h.sunR * 4);
    const mask = 0.12 + 0.88 * smoothstep(centerGap, centerGap + 0.22, off);
    const peak = up ? 0.55 + rnd() * 0.45 : 0.08 + rnd() * 0.3;
    pts.push(x, h.hy - height * peak * mask);
    x += step * (0.55 + rnd() * 0.9);
    up = !up;
  }
  return pts;
}

function paintMountains(ctx: CanvasRenderingContext2D, W: number, h: Horizon, theme: Theme, rnd: () => number): void {
  const c = theme.colors;
  const layers = [
    { height: h.hy * 0.3, step: Math.max(38, W / 22), gap: 0.1, fill: 0.55, edge: c.accent2, edgeAlpha: 0.45, width: 1 },
    { height: h.hy * 0.17, step: Math.max(26, W / 34), gap: 0.16, fill: 0.85, edge: c.accent, edgeAlpha: 0.85, width: 1.4 },
  ];
  for (const layer of layers) {
    const pts = ridge(W, h, rnd, layer.height, layer.step, layer.gap);
    const trace = (): void => {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    };
    // Тело хребта: от цвета неба к фону у подножия.
    const fill = ctx.createLinearGradient(0, h.hy - layer.height, 0, h.hy);
    fill.addColorStop(0, mixColor(c.skyBottom, c.bg, layer.fill - 0.25));
    fill.addColorStop(1, mixColor(c.skyBottom, c.bg, layer.fill));
    trace();
    ctx.lineTo(W + layer.step * 2, h.hy + 1);
    ctx.lineTo(-layer.step * 2, h.hy + 1);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // Каркасные рёбра от пиков к подножию — ретро-вайрфрейм.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = layer.edge;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const px = pts[i];
      const py = pts[i + 1];
      if (h.hy - py < layer.height * 0.35) continue;
      const lean = (px - h.cx) * 0.08;
      ctx.moveTo(px, py);
      ctx.lineTo(px + lean + layer.step * 0.25, h.hy);
      ctx.moveTo(px, py);
      ctx.lineTo(px + lean - layer.step * 0.3, h.hy);
    }
    ctx.globalAlpha = layer.edgeAlpha * 0.28;
    ctx.stroke();

    // Неоновая кромка: здесь, в кэше, shadowBlur допустим — рисуется один раз.
    trace();
    ctx.shadowColor = layer.edge;
    ctx.shadowBlur = 10;
    ctx.lineJoin = 'round';
    ctx.lineWidth = layer.width * 2.4;
    ctx.globalAlpha = layer.edgeAlpha * 0.35;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = layer.width;
    ctx.globalAlpha = layer.edgeAlpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

function paintFloor(ctx: CanvasRenderingContext2D, W: number, H: number, h: Horizon, theme: Theme, palette: Palette): void {
  const c = theme.colors;
  const floor = ctx.createLinearGradient(0, h.hy, 0, H);
  floor.addColorStop(0, palette.floorTop);
  floor.addColorStop(0.3, mixColor(c.skyBottom, c.bg, 0.72));
  floor.addColorStop(1, c.bg);
  ctx.fillStyle = floor;
  ctx.fillRect(0, h.hy, W, H - h.hy);

  // Отражение солнца на полу — вытянутое вниз пятно.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(h.cx, h.hy);
  ctx.scale(h.sunR * 1.25, h.floorH * 0.5);
  const refl = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  refl.addColorStop(0, rgba(c.sunBottom, 0.3));
  refl.addColorStop(0.4, rgba(c.sunBottom, 0.1));
  refl.addColorStop(1, rgba(c.sunBottom, 0));
  ctx.fillStyle = refl;
  ctx.fillRect(-1, 0, 2, 1);
  ctx.restore();
}

/** Приглушение за краями поля (поле выделяется) и лёгкая виньетка по углам. */
function paintFrame(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  const W = vp.cssW;
  const H = vp.cssH;
  if (vp.fieldW < W - 2) {
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = OUTSIDE_SHADE;
    ctx.fillRect(0, 0, vp.fieldX, H);
    ctx.fillRect(vp.fieldX + vp.fieldW, 0, W - vp.fieldX - vp.fieldW, H);
    ctx.globalAlpha = 1;
  }
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(W / 2, H / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.55, 'rgba(0,0,0,0)');
  g.addColorStop(0.85, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}
