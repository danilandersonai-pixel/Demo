/**
 * Неподвижный задник: небо, звёзды, полосатое солнце, дымка, тёмная равнина и
 * полотно дороги с виньеткой. Всё это рисуется один раз в офскрин-слой и в
 * кадре стоит один блит «пиксель в пиксель». Живые детали поверх — мерцание
 * звёзд и вспышка солнца на сильную долю.
 *
 * Слой шире экрана на BLEED: тряска камеры сдвигает его на целое число
 * пикселей устройства, и по краям не появляется пустота.
 */
import { createRng } from '../core/rng';
import { darken, lighten, mixColor, rgba, TAU } from '../core/math';
import type { ThemeColors } from '../core/types';
import type { Camera } from './camera';
import { BLEED, freeLayer, layerContext, makeLayer, type View } from './view';

/** Сколько звёзд мерцает поверх запечённых. */
const TWINKLES = 26;
const TWINKLE_STRIDE = 5;

export interface SunGeometry {
  x: number;
  y: number;
  r: number;
}

/** Солнце стоит над точкой схода; размер ограничен высотой неба, чтобы не лезть под HUD. */
export function sunGeometry(cam: Camera): SunGeometry {
  const r = Math.min(cam.cssW * 0.2, cam.horizonY * 0.44);
  return { x: cam.cx, y: cam.horizonY - r * 0.55, r };
}

export class Backdrop {
  private layer: HTMLCanvasElement | null = null;
  private sunGlow: HTMLCanvasElement | null = null;
  private bleedX = 0;
  private bleedY = 0;
  /** Положение вспышки солнца и высота её видимой (над горизонтом) части, пиксели устройства. */
  private glowX = 0;
  private glowY = 0;
  private glowH = 0;
  private readonly twinkles = new Float32Array(TWINKLES * TWINKLE_STRIDE);
  private twinkleCount = 0;

  build(cam: Camera, colors: ThemeColors, kx: number, ky: number, seed: number): void {
    this.dispose();
    this.bleedX = Math.ceil(BLEED * kx);
    this.bleedY = Math.ceil(BLEED * ky);
    const layer = makeLayer(Math.round(cam.cssW * kx) + this.bleedX * 2, Math.round(cam.cssH * ky) + this.bleedY * 2);
    this.layer = layer;
    const ctx = layerContext(layer);
    if (!ctx) return;
    ctx.setTransform(kx, 0, 0, ky, this.bleedX, this.bleedY);

    const left = -BLEED;
    const top = -BLEED;
    const w = cam.cssW + BLEED * 2;
    const bottom = cam.cssH + BLEED;
    const hy = cam.horizonY;
    const span = cam.lineY - hy;
    const sun = sunGeometry(cam);
    const rng = createRng(seed);

    // ── Небо ──
    const sky = ctx.createLinearGradient(0, top, 0, hy);
    sky.addColorStop(0, colors.skyTop);
    sky.addColorStop(0.45, mixColor(colors.skyTop, colors.skyBottom, 0.3));
    sky.addColorStop(1, colors.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(left, top, w, hy - top + 1);

    // Туманности — два-три мягких пятна акцентных цветов, чтобы небо не было плоским.
    ctx.globalCompositeOperation = 'lighter';
    const tints = [colors.accent, colors.accent2, colors.sceneryFar];
    for (let i = 0; i < 3; i++) {
      const nx = left + w * (0.14 + 0.36 * i + rng.range(-0.06, 0.06));
      const ny = hy * rng.range(0.12, 0.5);
      const nr = Math.max(cam.cssW, cam.cssH) * rng.range(0.2, 0.34);
      const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
      g.addColorStop(0, rgba(tints[i], 0.11));
      g.addColorStop(1, rgba(tints[i], 0));
      ctx.fillStyle = g;
      ctx.fillRect(nx - nr, Math.max(top, ny - nr), nr * 2, Math.min(hy, ny + nr) - Math.max(top, ny - nr));
    }

    // ── Звёзды ──
    this.twinkleCount = 0;
    const stars = Math.round((w * (hy - top)) / 1500);
    for (let i = 0; i < stars; i++) {
      const x = left + rng.next() * w;
      const y = top + rng.next() * (hy - top) * 0.96;
      // К горизонту звёзды гаснут в дымке.
      const fade = 1 - Math.pow(Math.max(0, (y - top) / (hy - top)), 2.2) * 0.85;
      const big = rng.chance(0.07);
      const size = big ? rng.range(1.5, 2.2) : rng.range(0.7, 1.4);
      const tint = rng.chance(0.2) ? lighten(rng.pick([colors.accent2, colors.accent3, colors.accent]), 0.55) : '#ffffff';
      // Вне запаса под тряску: звезда, уехавшая за край, не должна мерцать «из ниоткуда».
      const twinkle = this.twinkleCount < TWINKLES && rng.chance(0.14) && x > 4 && x < cam.cssW - 4 && y > 4;
      ctx.globalAlpha = fade * (twinkle ? 0.35 : rng.range(0.35, 0.95));
      ctx.fillStyle = tint;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      if (big) {
        // Крестик-блик у самых ярких.
        ctx.globalAlpha *= 0.45;
        ctx.fillRect(x - size * 2, y - 0.3, size * 4, 0.6);
        ctx.fillRect(x - 0.3, y - size * 2, 0.6, size * 4);
      }
      if (twinkle) {
        const o = this.twinkleCount * TWINKLE_STRIDE;
        this.twinkles[o] = x;
        this.twinkles[o + 1] = y;
        this.twinkles[o + 2] = size * 1.25;
        this.twinkles[o + 3] = rng.range(0, TAU);
        this.twinkles[o + 4] = rng.range(1.3, 4.2);
        this.twinkleCount += 1;
      }
    }
    ctx.globalAlpha = 1;

    // ── Зарево у горизонта и ореол солнца ──
    const glowR = Math.max(sun.r * 3.4, cam.cssW * 0.42);
    const halo = ctx.createRadialGradient(sun.x, sun.y, sun.r * 0.7, sun.x, sun.y, glowR);
    halo.addColorStop(0, rgba(colors.sunBottom, 0.4));
    halo.addColorStop(0.35, rgba(colors.haze, 0.14));
    halo.addColorStop(1, rgba(colors.haze, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(left, top, w, hy - top);
    const dusk = ctx.createLinearGradient(0, hy - span * 0.42, 0, hy);
    dusk.addColorStop(0, rgba(colors.haze, 0));
    dusk.addColorStop(1, rgba(colors.haze, 0.3));
    ctx.fillStyle = dusk;
    ctx.fillRect(left, hy - span * 0.42, w, span * 0.42);
    ctx.globalCompositeOperation = 'source-over';

    // ── Солнце ──
    const disc = paintSun(sun.r, colors, kx, ky);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const discX = Math.round(this.bleedX + (sun.x - sun.r) * kx);
    const discY = Math.round(this.bleedY + (sun.y - sun.r) * ky);
    ctx.drawImage(disc, discX, discY);
    ctx.restore();
    this.buildSunGlow(disc, sun, cam, colors, kx, ky);
    freeLayer(disc);

    // ── Равнина и полотно дороги ──
    const ground = ctx.createLinearGradient(0, hy, 0, bottom);
    ground.addColorStop(0, mixColor(colors.bg, colors.haze, 0.3));
    ground.addColorStop(0.1, mixColor(colors.bg, colors.haze, 0.1));
    ground.addColorStop(0.4, colors.bg);
    ground.addColorStop(1, darken(colors.bg, 0.35));
    ctx.fillStyle = ground;
    ctx.fillRect(left, hy, w, bottom - hy);

    const reach = ((bottom - hy) / span) * cam.unit * 50;
    const road = ctx.createLinearGradient(0, hy, 0, bottom);
    road.addColorStop(0, mixColor(colors.road, colors.haze, 0.42));
    road.addColorStop(0.16, mixColor(colors.road, colors.haze, 0.1));
    road.addColorStop(0.5, colors.road);
    road.addColorStop(1, lighten(colors.road, 0.03));
    ctx.fillStyle = road;
    ctx.beginPath();
    ctx.moveTo(cam.cx, hy);
    ctx.lineTo(cam.cx + reach, bottom);
    ctx.lineTo(cam.cx - reach, bottom);
    ctx.closePath();
    ctx.fill();

    // Дорожка света от солнца на полотне.
    ctx.globalCompositeOperation = 'lighter';
    const streak = ctx.createLinearGradient(0, hy, 0, hy + span * 0.7);
    streak.addColorStop(0, rgba(colors.sunBottom, 0.34));
    streak.addColorStop(0.3, rgba(colors.sunBottom, 0.1));
    streak.addColorStop(1, rgba(colors.sunBottom, 0));
    ctx.fillStyle = streak;
    ctx.beginPath();
    ctx.moveTo(cam.cx, hy);
    ctx.lineTo(cam.cx + reach * 0.34, bottom);
    ctx.lineTo(cam.cx - reach * 0.34, bottom);
    ctx.closePath();
    ctx.fill();

    // Линия горизонта с ореолом.
    const bloom = Math.max(4, span * 0.035);
    const line = ctx.createLinearGradient(0, hy - bloom, 0, hy + bloom);
    line.addColorStop(0, rgba(colors.haze, 0));
    line.addColorStop(0.5, rgba(colors.haze, 0.5));
    line.addColorStop(1, rgba(colors.haze, 0));
    ctx.fillStyle = line;
    ctx.fillRect(left, hy - bloom, w, bloom * 2);
    ctx.fillStyle = rgba(lighten(colors.haze, 0.6), 0.8);
    ctx.fillRect(left, hy - 0.6, w, 1.2);
    ctx.globalCompositeOperation = 'source-over';

    // ── Виньетка ──
    const vx = cam.cssW / 2;
    const vy = cam.cssH * 0.52;
    const diag = Math.hypot(cam.cssW, cam.cssH) / 2;
    const vignette = ctx.createRadialGradient(vx, vy, diag * 0.55, vx, vy, diag * 1.08);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = vignette;
    ctx.fillRect(left, top, w, bottom - top);
  }

  /** Спрайт вспышки: ореол и сам диск, которые добавляются к солнцу на сильную долю. */
  private buildSunGlow(disc: HTMLCanvasElement, sun: SunGeometry, cam: Camera, colors: ThemeColors, kx: number, ky: number): void {
    const reach = sun.r * 1.9;
    const glow = makeLayer(reach * 2 * kx, reach * 2 * ky);
    this.sunGlow = glow;
    this.glowX = Math.round((sun.x - reach) * kx);
    this.glowY = Math.round((sun.y - reach) * ky);
    this.glowH = Math.max(0, Math.min(glow.height, Math.round(cam.horizonY * ky) - this.glowY));
    const ctx = layerContext(glow);
    if (!ctx) return;
    ctx.setTransform(kx, 0, 0, ky, 0, 0);
    const g = ctx.createRadialGradient(reach, reach, sun.r * 0.6, reach, reach, reach);
    g.addColorStop(0, rgba(colors.sunBottom, 0.55));
    g.addColorStop(0.45, rgba(colors.sunBottom, 0.16));
    g.addColorStop(1, rgba(colors.sunBottom, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, reach * 2, reach * 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(disc, Math.round((reach - sun.r) * kx), Math.round((reach - sun.r) * ky));
  }

  /** ox, oy — сдвиг тряски в пикселях устройства (целые). */
  draw(view: View, ox: number, oy: number): void {
    const ctx = view.ctx;
    if (!this.layer) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, ox - this.bleedX, oy - this.bleedY);

    // Солнце вспыхивает на сильную долю, на остальные — едва заметно.
    const pulse = (view.downbeat * 0.5 + view.beat * 0.12) * (view.reduced ? 0.4 : 1);
    ctx.globalCompositeOperation = 'lighter';
    if (this.sunGlow && pulse > 0.02 && this.glowH > 0) {
      ctx.globalAlpha = Math.min(1, pulse);
      const sw = this.sunGlow.width;
      ctx.drawImage(this.sunGlow, 0, 0, sw, this.glowH, this.glowX + ox, this.glowY + oy, sw, this.glowH);
    }

    ctx.setTransform(view.kx, 0, 0, view.ky, ox, oy);
    ctx.fillStyle = '#ffffff';
    const tw = this.twinkles;
    for (let i = 0; i < this.twinkleCount; i++) {
      const o = i * TWINKLE_STRIDE;
      const wave = view.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(view.now * tw[o + 4] + tw[o + 3]);
      const size = tw[o + 2] * (0.7 + 0.5 * wave);
      ctx.globalAlpha = wave * wave * 0.9;
      ctx.fillRect(tw[o] - size / 2, tw[o + 1] - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  dispose(): void {
    freeLayer(this.layer);
    freeLayer(this.sunGlow);
    this.layer = null;
    this.sunGlow = null;
    this.twinkleCount = 0;
  }
}

/** Диск солнца с прорезанными полосами — отдельным спрайтом, чтобы сквозь полосы было видно небо. */
function paintSun(r: number, colors: ThemeColors, kx: number, ky: number): HTMLCanvasElement {
  const canvas = makeLayer(r * 2 * kx, r * 2 * ky);
  const ctx = layerContext(canvas);
  if (!ctx) return canvas;
  ctx.setTransform(kx, 0, 0, ky, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, r * 2);
  g.addColorStop(0, lighten(colors.sunTop, 0.25));
  g.addColorStop(0.3, colors.sunTop);
  g.addColorStop(0.62, mixColor(colors.sunTop, colors.sunBottom, 0.62));
  g.addColorStop(1, colors.sunBottom);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, TAU);
  ctx.fill();
  // Полосы: чем ниже, тем толще — классика ретровейва.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  const first = r * 0.92;
  const last = r * 1.62;
  const stripes = 7;
  for (let i = 0; i < stripes; i++) {
    const k = i / (stripes - 1);
    const y = first + (last - first) * Math.pow(k, 0.92);
    const h = r * (0.022 + 0.062 * k);
    ctx.fillRect(0, y - h / 2, r * 2, h);
  }
  return canvas;
}
