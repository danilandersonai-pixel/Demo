/**
 * Неподвижный задник в двух непрозрачных слоях: небо (градиент, туманности,
 * звёзды, полосатое солнце, зарево и дальний план горизонта) и земля (равнина,
 * полотно дороги, линия горизонта, продольные линии сетки и бортики). Слои
 * рисуются один раз и в кадре стоят блитами «пиксель в пиксель»; непрозрачный
 * слой копируется без смешивания.
 *
 * Небо вместе с дальним планом чуть сдвигается вслед за кораблём — это первый
 * план параллакса. Земля кренится: строки слоя сдвигаются вбок тем сильнее,
 * чем они ниже горизонта. Живые детали поверх неба: мерцание звёзд, пульс
 * солнца на сильную долю, лучи северного сияния.
 *
 * Цвет сетки меняется с уровнем, поэтому слоёв земли два: текущий и следующий.
 * Следующий запекается заранее по несколько клиньев за кадр, а при смене
 * уровня слои плавно сменяют друг друга.
 *
 * Слои шире экрана на BLEED: тряска камеры сдвигает их на целое число
 * пикселей устройства, и по краям не появляется пустота.
 */
import { createRng } from '../core/rng';
import { clamp, darken, lighten, mixColor, rgba, TAU } from '../core/math';
import type { Theme, ThemeColors } from '../core/types';
import type { Camera } from './camera';
import { LANE_STEPS, paintLane } from './road';
import { paintFarPlane } from './scenery';
import { BLEED, freeLayer, layerContext, makeLayer, type View } from './view';

/** Сколько звёзд мерцает поверх запечённых. */
const TWINKLES = 26;
const TWINKLE_STRIDE = 5;
const RAY_STRIDE = 5;

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

/** Слой земли с запечённой сеткой одного цвета. */
interface Ground {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  /** Цвет сетки; пустая строка — слой свободен. */
  color: string;
  /** Сколько клиньев уже запечено (LANE_STEPS — готов). */
  step: number;
}

export class Backdrop {
  private sky: HTMLCanvasElement | null = null;
  /** Земля без сетки — заготовка, с которой начинается каждый слой земли. */
  private base: HTMLCanvasElement | null = null;
  private ground: Ground | null = null;
  private next: Ground | null = null;
  private ray: HTMLCanvasElement | null = null;
  private cam: Camera | null = null;
  private colors: ThemeColors | null = null;
  private kx = 1;
  private ky = 1;
  /** Левый край слоя неба без сдвига и запасы слоёв, пиксели устройства. */
  private skyX0 = 0;
  private bleedX = 0;
  private bleedY = 0;
  /** Строка холста, на которой небо встречается с землёй. */
  private seamY = 0;
  /** Наибольший сдвиг неба вслед за кораблём, CSS-пиксели. */
  private range = 0;
  private sun: SunGeometry = { x: 0, y: 0, r: 0 };
  private sunRim = '#ffffff';
  private readonly twinkles = new Float32Array(TWINKLES * TWINKLE_STRIDE);
  private twinkleCount = 0;
  /** Лучи сияния: x, верх, высота (CSS-пиксели, y от горизонта), фаза, частота. */
  private rays: number[] = [];

  build(cam: Camera, theme: Theme, kx: number, ky: number, seed: number): void {
    this.dispose();
    const colors = theme.colors;
    this.cam = cam;
    this.colors = colors;
    this.kx = kx;
    this.ky = ky;
    const far = paintFarPlane(cam, theme, kx, ky, seed);
    this.range = far.range;
    this.rays = far.rays;
    this.sun = sunGeometry(cam);
    this.sunRim = lighten(colors.sunTop, 0.5);
    this.bleedX = Math.ceil(BLEED * kx);
    this.bleedY = Math.ceil(BLEED * ky);
    this.seamY = Math.round(cam.horizonY * ky);
    this.skyX0 = far.x0;

    this.sky = this.paintSky(cam, colors, kx, ky, seed, far.canvas);
    freeLayer(far.canvas);
    this.base = this.paintGround(cam, colors, kx, ky);
    this.ground = this.makeGround();
    this.next = this.makeGround();
    if (this.rays.length > 0) this.ray = paintRay(colors);
  }

  private makeGround(): Ground {
    const base = this.base as HTMLCanvasElement;
    const canvas = makeLayer(base.width, base.height);
    return { canvas, ctx: layerContext(canvas, true), color: '', step: 0 };
  }

  // ─── Земля и сетка ────────────────────────────────────────────────────────

  /** Начать слой земли для цвета сетки: копия заготовки, клинья допекаются в bakeInto. */
  private begin(ground: Ground, color: string): void {
    ground.color = color;
    ground.step = 0;
    if (!ground.ctx || !this.base) return;
    ground.ctx.setTransform(1, 0, 0, 1, 0, 0);
    ground.ctx.globalCompositeOperation = 'copy';
    ground.ctx.drawImage(this.base, 0, 0);
  }

  private bakeInto(ground: Ground, steps: number): void {
    const { cam, colors } = this;
    if (!ground.ctx || !cam || !colors) {
      ground.step = LANE_STEPS;
      return;
    }
    const ctx = ground.ctx;
    ctx.setTransform(this.kx, 0, 0, this.ky, this.bleedX, -this.seamY);
    ctx.globalCompositeOperation = 'lighter';
    const until = Math.min(LANE_STEPS, ground.step + steps);
    while (ground.step < until) paintLane(ctx, cam, colors, ground.color, ground.step++);
  }

  /** Земля этого цвета нужна прямо сейчас (начало сцены): допечь без рассрочки. */
  showGrid(color: string): void {
    const { ground, next } = this;
    if (!ground || !next) return;
    if (ground.color !== color) {
      if (next.color === color) this.commit();
      else this.begin(ground, color);
    }
    this.bakeInto(this.ground as Ground, LANE_STEPS);
  }

  /** Готовить землю следующего цвета заранее; сама выпечка идёт в bake(). */
  prepare(color: string): void {
    const { ground, next } = this;
    if (!ground || !next || ground.color === color || next.color === color) return;
    this.begin(next, color);
  }

  /** Допечь несколько клиньев следующего слоя (вызывается каждый кадр). */
  bake(steps: number): void {
    const next = this.next;
    if (next && next.color !== '' && next.step < LANE_STEPS) this.bakeInto(next, steps);
  }

  /** Начинается переход к цвету: следующий слой обязан быть готов целиком. */
  fadeTo(color: string): void {
    const next = this.next;
    if (!next) return;
    if (next.color !== color) this.begin(next, color);
    this.bakeInto(next, LANE_STEPS);
  }

  /** Переход закончен: следующий слой становится текущим. */
  commit(): void {
    const { ground, next } = this;
    if (!ground || !next || next.color === '') return;
    this.bakeInto(next, LANE_STEPS);
    this.ground = next;
    this.next = ground;
    ground.color = '';
  }

  /**
   * Земля с креном. ox, oy — тряска в пикселях устройства; blend — доля
   * следующего слоя поверх текущего (0 — перехода нет).
   */
  drawGround(view: View, ox: number, oy: number, blend: number): void {
    const { ground, next } = this;
    if (!ground) return;
    const ctx = view.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Сдвиг строки растёт с расстоянием от горизонта: view.shear CSS-пикселей на CSS-пиксель.
    const slope = (view.shear * view.kx) / view.ky;
    blitRows(ctx, ground.canvas, ox - this.bleedX, oy + this.seamY, slope);
    if (blend > 0.004 && next && next.color !== '') {
      ctx.globalAlpha = Math.min(1, blend);
      blitRows(ctx, next.canvas, ox - this.bleedX, oy + this.seamY, slope);
      ctx.globalAlpha = 1;
    }
  }

  private paintSky(cam: Camera, colors: ThemeColors, kx: number, ky: number, seed: number, far: HTMLCanvasElement): HTMLCanvasElement {
    const layer = makeLayer(far.width, this.seamY + this.bleedY);
    const ctx = layerContext(layer, true);
    if (!ctx) return layer;
    ctx.setTransform(kx, 0, 0, ky, -this.skyX0, this.bleedY);

    const left = this.skyX0 / kx;
    const top = -BLEED;
    const w = layer.width / kx;
    const hy = cam.horizonY;
    const span = cam.lineY - hy;
    const sun = this.sun;
    const rng = createRng(seed);

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
      // Только на экране: звезда, уехавшая за край, не должна мерцать «из ниоткуда».
      const twinkle = this.twinkleCount < TWINKLES && rng.chance(0.14) && x > 24 && x < cam.cssW - 24 && y > 4;
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

    // ── Солнце и дальний план ──
    const disc = paintSun(sun.r, colors, kx, ky);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(disc, Math.round((sun.x - sun.r) * kx) - this.skyX0, Math.round((sun.y - sun.r) * ky) + this.bleedY);
    freeLayer(disc);
    ctx.drawImage(far, 0, layer.height - far.height);
    ctx.setTransform(kx, 0, 0, ky, -this.skyX0, this.bleedY);

    // Верхняя половина ореола линии горизонта (нижняя — в слое земли).
    const bloom = horizonBloom(span);
    const line = ctx.createLinearGradient(0, hy - bloom, 0, hy);
    line.addColorStop(0, rgba(colors.haze, 0));
    line.addColorStop(1, rgba(colors.haze, 0.5));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = line;
    ctx.fillRect(left, hy - bloom, w, bloom);
    ctx.globalCompositeOperation = 'source-over';

    paintVignette(ctx, cam, left, top, w, hy - top);
    return layer;
  }

  private paintGround(cam: Camera, colors: ThemeColors, kx: number, ky: number): HTMLCanvasElement {
    const layer = makeLayer(Math.round(cam.cssW * kx) + this.bleedX * 2, Math.round(cam.cssH * ky) - this.seamY + this.bleedY);
    const ctx = layerContext(layer, true);
    if (!ctx) return layer;
    // Начало координат — как у экрана: слой начинается точно со шва.
    ctx.setTransform(kx, 0, 0, ky, this.bleedX, -this.seamY);

    const left = -BLEED;
    const w = cam.cssW + BLEED * 2;
    const hy = cam.horizonY;
    const top = this.seamY / ky;
    const bottom = cam.cssH + BLEED;
    const span = cam.lineY - hy;

    const plain = ctx.createLinearGradient(0, hy, 0, bottom);
    plain.addColorStop(0, mixColor(colors.bg, colors.haze, 0.3));
    plain.addColorStop(0.1, mixColor(colors.bg, colors.haze, 0.1));
    plain.addColorStop(0.4, colors.bg);
    plain.addColorStop(1, darken(colors.bg, 0.35));
    ctx.fillStyle = plain;
    ctx.fillRect(left, top - 1, w, bottom - top + 2);

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

    // Линия горизонта и нижняя половина её ореола.
    const bloom = horizonBloom(span);
    const line = ctx.createLinearGradient(0, hy, 0, hy + bloom);
    line.addColorStop(0, rgba(colors.haze, 0.5));
    line.addColorStop(1, rgba(colors.haze, 0));
    ctx.fillStyle = line;
    ctx.fillRect(left, top, w, bloom);
    ctx.fillStyle = rgba(lighten(colors.haze, 0.6), 0.8);
    ctx.fillRect(left, top, w, Math.max(1.2, 1 / ky));
    ctx.globalCompositeOperation = 'source-over';

    paintVignette(ctx, cam, left, top, w, bottom - top);
    return layer;
  }

  /**
   * Небо, пульс солнца, мерцание и лучи. ox, oy — сдвиг тряски в пикселях
   * устройства (целые). Рисуется до ближнего плана: тот заслоняет солнце.
   */
  drawSky(view: View, ox: number, oy: number): void {
    const ctx = view.ctx;
    if (!this.sky) return;
    const lean = clamp((view.shipX - 50) / 50, -1, 1);
    // Сдвиг округляется до пикселя устройства: слой остаётся резким, а блит — дешёвым.
    const shift = Math.round(-lean * this.range * view.kx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.sky, this.skyX0 + ox + shift, oy - this.bleedY);

    ctx.setTransform(view.kx, 0, 0, view.ky, ox + shift, oy);
    ctx.globalCompositeOperation = 'lighter';
    this.drawSunPulse(view);

    ctx.fillStyle = '#ffffff';
    const tw = this.twinkles;
    for (let i = 0; i < this.twinkleCount; i++) {
      const o = i * TWINKLE_STRIDE;
      const wave = view.reduced ? 0.6 : 0.5 + 0.5 * Math.sin(view.now * tw[o + 4] + tw[o + 3]);
      const size = tw[o + 2] * (0.7 + 0.5 * wave);
      ctx.globalAlpha = wave * wave * 0.9;
      ctx.fillRect(tw[o] - size / 2, tw[o + 1] - size / 2, size, size);
    }

    if (this.ray) {
      // Сияние дышит: узкие лучи внутри занавесей то разгораются, то гаснут.
      const hy = view.cam.horizonY;
      const rays = this.rays;
      for (let i = 0; i < rays.length; i += RAY_STRIDE) {
        const wave = view.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(view.now * rays[i + 4] + rays[i + 3]);
        ctx.globalAlpha = 0.1 + 0.5 * wave * wave;
        const width = rays[i + 2] * (0.12 + 0.06 * wave);
        ctx.drawImage(this.ray, rays[i] - width / 2, hy + rays[i + 1], width, rays[i + 2]);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Солнце «бьётся» в такт: ободок вспыхивает на долю, на сильную — от диска расходится кольцо. */
  private drawSunPulse(view: View): void {
    const ctx = view.ctx;
    const sun = this.sun;
    // Только сильная доля: большой контур — недешёвая фигура, а солнце и должно бить реже сетки.
    const rim = view.downbeat * (view.reduced ? 0.4 : 1);
    // Видимая часть окружности — выше горизонта.
    const below = view.cam.horizonY - sun.y;
    ctx.strokeStyle = this.sunRim;
    if (rim > 0.02) {
      const a = Math.asin(Math.min(1, below / sun.r));
      ctx.globalAlpha = rim;
      ctx.lineWidth = sun.r * 0.035;
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, sun.r * 1.012, Math.PI - a, TAU + a);
      ctx.stroke();
    }
    if (view.downbeat > 0.02 && !view.reduced) {
      const grow = 1 - view.downbeat;
      const r = sun.r * (1.05 + 0.5 * grow);
      const a = Math.asin(Math.min(1, below / r));
      ctx.globalAlpha = view.downbeat * view.downbeat * 0.55;
      ctx.lineWidth = sun.r * (0.05 - 0.035 * grow);
      ctx.beginPath();
      ctx.arc(sun.x, sun.y, r, Math.PI - a, TAU + a);
      ctx.stroke();
    }
  }

  dispose(): void {
    freeLayer(this.sky);
    freeLayer(this.base);
    freeLayer(this.ground?.canvas ?? null);
    freeLayer(this.next?.canvas ?? null);
    freeLayer(this.ray);
    this.sky = null;
    this.base = null;
    this.ground = null;
    this.next = null;
    this.ray = null;
    this.twinkleCount = 0;
    this.rays = [];
  }
}

/**
 * Скопировать слой со сдвигом строк: строка r уезжает вбок на round(slope · r)
 * пикселей. Слой режется на полосы с одинаковым сдвигом — каждая копируется
 * «пиксель в пиксель», без фильтрации.
 */
function blitRows(ctx: CanvasRenderingContext2D, layer: HTMLCanvasElement, x: number, y: number, slope: number): void {
  const rows = layer.height;
  const reach = Math.abs(slope) * rows;
  if (reach < 0.5) {
    ctx.drawImage(layer, x, y);
    return;
  }
  const dir = slope > 0 ? 1 : -1;
  const width = layer.width;
  let from = 0;
  for (let shift = 0; from < rows; shift++) {
    // Полоса со сдвигом shift кончается там, где round(|slope| · r) станет shift + 1.
    const to = Math.min(rows, Math.ceil((shift + 0.5) / Math.abs(slope)));
    if (to > from) ctx.drawImage(layer, 0, from, width, to - from, x + dir * shift, y + from, width, to - from);
    from = to;
  }
}

function horizonBloom(span: number): number {
  return Math.max(4, span * 0.035);
}

/** Виньетка общая для обоих слоёв: центр и радиус заданы в координатах экрана. */
function paintVignette(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, w: number, h: number): void {
  const vx = cam.cssW / 2;
  const vy = cam.cssH * 0.52;
  const diag = Math.hypot(cam.cssW, cam.cssH) / 2;
  const vignette = ctx.createRadialGradient(vx, vy, diag * 0.55, vx, vy, diag * 1.08);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = vignette;
  ctx.fillRect(x, y, w, h);
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

/** Луч сияния: мягкое вертикальное пятно света, которое растягивается под каждую занавесь. */
function paintRay(colors: ThemeColors): HTMLCanvasElement {
  const canvas = makeLayer(16, 64);
  const ctx = layerContext(canvas);
  if (!ctx) return canvas;
  const top = mixColor(colors.sceneryFar, colors.accent2, 0.7);
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, rgba(top, 0));
  g.addColorStop(0.5, rgba(mixColor(colors.sceneryFar, top, 0.4), 0.35));
  g.addColorStop(0.92, rgba(lighten(colors.sceneryFar, 0.25), 0.9));
  g.addColorStop(1, rgba(colors.sceneryFar, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 64);
  // Края луча по горизонтали растворяются.
  const side = ctx.createLinearGradient(0, 0, 16, 0);
  side.addColorStop(0, 'rgba(0,0,0,0)');
  side.addColorStop(0.5, 'rgba(0,0,0,1)');
  side.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, 16, 64);
  return canvas;
}
