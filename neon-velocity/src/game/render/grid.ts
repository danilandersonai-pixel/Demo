/**
 * Перспективная неоновая сетка на «полу», линия горизонта, рельсы по краям поля
 * и полосы скорости. Цвет сетки следует за уровнем с плавным переходом,
 * яркость пульсирует в такт, повышение уровня пускает по полу яркую волну.
 *
 * Продольные линии — тонкие треугольники от точки схода (к зрителю утолщаются, как
 * настоящая перспектива). Они не зависят от времени, поэтому рисуются один раз в
 * офскрин-кэш на цвет и размер, а смещение пола вбок за кораблём — это аффинный
 * сдвиг (shear) того же изображения: прямые через точку схода остаются такими же.
 * Поперечные линии — fillRect с толщиной и яркостью по глубине. Вне игрового поля
 * сетка приглушена (клип по полосам и градиент заливки) — без затемняющего слоя.
 */
import { WORLD_W } from '../config';
import { clamp, easeInOutSine, hexToRgb, type Rgb } from '../math';
import type { GameState, Viewport } from '../types';
import type { Horizon } from './background';
import type { SpriteCache } from './sprites';
import { cacheScale, createSurface, hash, HOT_AMOUNT, hotColor, releaseSurface, smoothstep, wrap, type Surface } from './util';

/** Секунды на перетекание цвета сетки после смены уровня или темы. */
const COLOR_FADE_SEC = 1;
/** Глубина нижней кромки экрана в «клетках» — задаёт силу перспективы. */
const Z0 = 5.2;
/** Доля скорости препятствий, с которой пол едет на зрителя (пол «дальше» объектов). */
const FLOOR_SPEED = 0.62;
/** Смещение сетки вбок за кораблём, в клетках на всю ширину мира. */
const LATERAL_PARALLAX = 1.1;
/** Полоса (в долях высоты пола), на которой дальние поперечные линии гаснут. */
const TRANSVERSE_FADE = 0.2;
/** Яркость сетки за пределами игрового поля. */
const OUTSIDE_ALPHA = 0.6;
/** Полосы скорости в поле. */
const STREAKS = 26;
/** Бюджет пикселей одного кэша продольных линий (≈ 24 МБ). */
const LINE_CACHE_PIXELS = 6_000_000;

type GridSprite = 'beam' | 'rail';

/** Кэш продольных линий одного цвета для текущего размера экрана. */
interface LineCache {
  color: string;
  surface: Surface;
  /** Физических пикселей кэша на CSS-пиксель. */
  scale: number;
}

export class GridPainter {
  private readonly sprites: SpriteCache;
  /** Цвета перехода — всегда цвета палитры (по ним кэшируются спрайты). */
  private from = '';
  private to = '';
  private fade = 1;
  /** Текущий (возможно, промежуточный) цвет линий и их сердцевины. */
  private color = '';
  private colorHot = '';
  private readonly rgb: Rgb = { r: 0, g: 0, b: 0 };
  /** Заливка линий: цвет или градиент «приглушить вне поля». */
  private fill: CanvasGradient | string = '';
  private fillColor = '';
  private fillFieldX = -1;
  private fillCssW = -1;
  /** Кэши продольных линий (не больше двух: «откуда» и «куда» в переходе цвета). */
  private lineCaches: LineCache[] = [];
  /** Раскладка, под которую построены кэши линий. */
  private readonly lineLayout = { cssW: 0, cssH: 0, dpr: 0, fieldW: 0 };
  /** Доля бюджета пикселей кэша линий (снижается при нехватке видеопамяти). */
  private quality = 1;

  constructor(sprites: SpriteCache) {
    this.sprites = sprites;
  }

  /** Цель — цвет уровня из палитры темы; dt — реальные секунды (0 на паузе). */
  update(target: string, dt: number): void {
    if (this.to === '') {
      this.from = this.to = target;
      this.fade = 1;
      this.applyColor();
      return;
    }
    if (target !== this.to) {
      // Прерванный переход продолжается от ближайшего цвета палитры: спрайты остаются в кэше.
      this.from = this.fade >= 0.5 ? this.to : this.from;
      this.to = target;
      this.fade = 0;
    }
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / COLOR_FADE_SEC);
      this.applyColor();
    }
  }

  reset(): void {
    this.to = '';
    this.fillColor = '';
    this.dropLineCaches();
  }

  /** Новая доля бюджета пикселей; кэши линий перестроятся по требованию. */
  setQuality(quality: number): void {
    this.quality = quality;
    this.dropLineCaches();
  }

  private dropLineCaches(): void {
    for (const c of this.lineCaches) releaseSurface(c.surface);
    this.lineCaches = [];
  }

  /** Посчитать строки цвета; промежуточные цвета собираются числами, мимо общих кэшей. */
  private applyColor(): void {
    if (this.fade >= 1) {
      this.color = this.to;
      this.colorHot = hotColor(this.to);
      const c = hexToRgb(this.to);
      this.rgb.r = c.r;
      this.rgb.g = c.g;
      this.rgb.b = c.b;
      return;
    }
    const a = hexToRgb(this.from);
    const b = hexToRgb(this.to);
    const k = easeInOutSine(this.fade);
    const r = a.r + (b.r - a.r) * k;
    const g = a.g + (b.g - a.g) * k;
    const bl = a.b + (b.b - a.b) * k;
    this.rgb.r = r;
    this.rgb.g = g;
    this.rgb.b = bl;
    this.color = `rgb(${r | 0},${g | 0},${bl | 0})`;
    this.colorHot = `rgb(${(r + (255 - r) * HOT_AMOUNT) | 0},${(g + (255 - g) * HOT_AMOUNT) | 0},${(bl + (255 - bl) * HOT_AMOUNT) | 0})`;
  }

  /** Заливка линий: если поле уже экрана — градиент, приглушённый по бокам. */
  private fillStyle(ctx: CanvasRenderingContext2D, vp: Viewport): CanvasGradient | string {
    if (vp.fieldW >= vp.cssW - 2) return this.color;
    if (this.fillColor === this.color && this.fillFieldX === vp.fieldX && this.fillCssW === vp.cssW) return this.fill;
    const { r, g, b } = this.rgb;
    const rgbText = `${r | 0},${g | 0},${b | 0}`;
    const dim = `rgba(${rgbText},${OUTSIDE_ALPHA})`;
    const full = `rgb(${rgbText})`;
    const left = vp.fieldX / vp.cssW;
    const right = (vp.fieldX + vp.fieldW) / vp.cssW;
    const soft = 6 / vp.cssW;
    const grad = ctx.createLinearGradient(0, 0, vp.cssW, 0);
    grad.addColorStop(0, dim);
    grad.addColorStop(clamp(left - soft, 0, 1), dim);
    grad.addColorStop(clamp(left + soft, 0, 1), full);
    grad.addColorStop(clamp(right - soft, 0, 1), full);
    grad.addColorStop(clamp(right + soft, 0, 1), dim);
    grad.addColorStop(1, dim);
    this.fill = grad;
    this.fillColor = this.color;
    this.fillFieldX = vp.fieldX;
    this.fillCssW = vp.cssW;
    return grad;
  }

  /** Спрайт цвета сетки; во время перехода — наложение спрайтов обоих цветов палитры. */
  private drawSprite(
    ctx: CanvasRenderingContext2D,
    kind: GridSprite,
    alpha: number,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (this.fade >= 1) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.sprite(kind, this.to), x, y, w, h);
      return;
    }
    const k = easeInOutSine(this.fade);
    ctx.globalAlpha = alpha * (1 - k);
    ctx.drawImage(this.sprite(kind, this.from), x, y, w, h);
    ctx.globalAlpha = alpha * k;
    ctx.drawImage(this.sprite(kind, this.to), x, y, w, h);
  }

  private sprite(kind: GridSprite, color: string): HTMLCanvasElement {
    return kind === 'beam' ? this.sprites.beam(color) : this.sprites.rail(color);
  }

  /** Ширина клетки у нижней кромки, CSS-пиксели. */
  private cellFor(vp: Viewport): number {
    return clamp(vp.fieldW / 7.5, 34, 84);
  }

  /**
   * Продольные линии цвета color: свечение + сердцевина, точка схода — вверху по центру.
   * Поля по бокам в одну клетку: сдвиг до клетки не открывает пустых краёв.
   */
  private lineCache(color: string, vp: Viewport, h: Horizon): LineCache | null {
    const lay = this.lineLayout;
    if (lay.cssW !== vp.cssW || lay.cssH !== vp.cssH || lay.dpr !== vp.dpr || lay.fieldW !== vp.fieldW) {
      this.dropLineCaches();
      lay.cssW = vp.cssW;
      lay.cssH = vp.cssH;
      lay.dpr = vp.dpr;
      lay.fieldW = vp.fieldW;
    }
    for (const c of this.lineCaches) if (c.color === color) return c;
    // Держим только цвета текущего перехода — остальные освобождаем.
    for (let i = this.lineCaches.length - 1; i >= 0; i--) {
      const c = this.lineCaches[i];
      if (c.color !== this.from && c.color !== this.to) {
        releaseSurface(c.surface);
        this.lineCaches.splice(i, 1);
      }
    }
    const cell = this.cellFor(vp);
    const margin = cell;
    const width = vp.cssW + margin * 2;
    const scale = cacheScale(width, h.floorH, vp.dpr, LINE_CACHE_PIXELS * this.quality);
    const surface = createSurface(width * scale, h.floorH * scale);
    if (!surface) return null;
    const g = surface.ctx;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = color;
    const vx = margin + h.cx;
    // Линии, чей низ далеко за экраном, всё равно пересекают его у горизонта: берём с запасом.
    const kMax = Math.ceil((vp.cssW / 2 + margin) / (cell * 0.2)) + 1;
    const widths = [3.6, 0.85];
    const alphas = [0.16, 0.85];
    for (let pass = 0; pass < 2; pass++) {
      const hw = widths[pass];
      g.globalAlpha = alphas[pass];
      g.beginPath();
      for (let k = -kMax; k <= kMax; k++) {
        const xb = vx + k * cell;
        g.moveTo(vx, 0);
        g.lineTo(xb + hw, h.floorH);
        g.lineTo(xb - hw, h.floorH);
        g.closePath();
      }
      g.fill();
    }
    const cache: LineCache = { color, surface, scale };
    this.lineCaches.push(cache);
    return cache;
  }

  /** Кэш продольных линий со сдвигом: x' = x + shear·(y − hy). Трансформ — физические пиксели. */
  private blitLines(
    ctx: CanvasRenderingContext2D,
    cache: LineCache,
    vp: Viewport,
    h: Horizon,
    shear: number,
    offX: number,
    alpha: number,
  ): void {
    const dpr = vp.dpr;
    const k = dpr / cache.scale;
    const margin = this.cellFor(vp);
    ctx.globalAlpha = alpha;
    ctx.setTransform(k, 0, shear * k, k, (offX - margin) * dpr, h.hy * dpr);
    ctx.drawImage(cache.surface.canvas, 0, 0);
  }

  /** Продольные линии кадра: с переходом цвета — наложение двух кэшей. */
  private drawLongitudinal(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    h: Horizon,
    shear: number,
    offX: number,
    alpha: number,
  ): void {
    const to = this.lineCache(this.to, vp, h);
    if (this.fade >= 1) {
      if (to) this.blitLines(ctx, to, vp, h, shear, offX, alpha);
      return;
    }
    const from = this.lineCache(this.from, vp, h);
    const k = easeInOutSine(this.fade);
    if (from) this.blitLines(ctx, from, vp, h, shear, offX, alpha * (1 - k));
    if (to) this.blitLines(ctx, to, vp, h, shear, offX, alpha * k);
  }

  /**
   * Сетка пола. Трансформ — CSS-пиксели. offX/offY — доля тряски камеры.
   * intensity 0..1 — общая яркость (такт + вспышка уровня).
   */
  drawFloor(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    h: Horizon,
    state: GameState,
    intensity: number,
    offX: number,
    offY: number,
  ): void {
    const W = vp.cssW;
    const { hy, floorH } = h;
    const dpr = vp.dpr;
    const cell = this.cellFor(vp);
    ctx.globalCompositeOperation = 'lighter';

    // Продольные линии: пол «едет» вбок за кораблём — низ линий смещается на долю клетки.
    const lateral = ((state.player.x - WORLD_W / 2) / WORLD_W) * LATERAL_PARALLAX;
    const shear = (-wrap(lateral, 1) * cell) / floorH;
    if (vp.fieldW >= W - 2) {
      this.drawLongitudinal(ctx, vp, h, shear, offX, intensity);
    } else {
      // Три вертикальные полосы: поле ярко, по бокам приглушённо; каждый пиксель рисуется раз.
      const left = vp.fieldX;
      const right = vp.fieldX + vp.fieldW;
      for (let band = 0; band < 3; band++) {
        const x0 = band === 0 ? 0 : band === 1 ? left : right;
        const x1 = band === 0 ? left : band === 1 ? right : W;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        ctx.rect(x0, hy, x1 - x0, floorH);
        ctx.clip();
        this.drawLongitudinal(ctx, vp, h, shear, offX, intensity * (band === 1 ? 1 : OUTSIDE_ALPHA));
        ctx.restore();
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.fillStyle(ctx, vp);

    // Поперечные линии: равный шаг по глубине, прокрутка на зрителя. Толщина и
    // яркость падают с глубиной, а у предела плавно гаснут — без резкой кромки.
    const scrollCells = (state.scroll * FLOOR_SPEED * vp.scale * Z0) / floorH;
    const phase = wrap(scrollCells, 1);
    // Дальше этой глубины шаг меньше ~1.5 px — линии слились бы в муар.
    const zMax = Math.sqrt((floorH * Z0) / 1.5);
    const invFar = Z0 / zMax;
    for (let i = 1; ; i++) {
      const z = Z0 + i - phase;
      if (z > zMax) break;
      const inv = Z0 / z;
      const fade = smoothstep(invFar, invFar + TRANSVERSE_FADE, inv) * intensity;
      if (fade < 0.01) continue;
      const y = hy + floorH * inv + offY * inv;
      const glow = Math.max(1.2, 7 * inv);
      const core = Math.max(0.5, 1.9 * inv);
      ctx.globalAlpha = 0.13 * fade;
      ctx.fillRect(-8, y - glow / 2, W + 16, glow);
      ctx.globalAlpha = 0.8 * fade;
      ctx.fillRect(-8, y - core / 2, W + 16, core);
    }

    // Волна повышения уровня: яркая полоса катится от горизонта к зрителю.
    const pulse = state.levelUpPulse;
    if (pulse > 0.01) {
      const z = Z0 + (zMax * 0.85 - Z0) * pulse * pulse;
      const inv = Z0 / z;
      const y = hy + floorH * inv;
      const band = 8 + 60 * inv;
      const a = clamp(pulse * 1.4, 0, 1);
      this.drawSprite(ctx, 'beam', a, -8, y - band, W + 16, band * 2);
      ctx.fillStyle = this.colorHot;
      ctx.globalAlpha = a;
      ctx.fillRect(-8, y - 1, W + 16, 2);
    }
    ctx.globalAlpha = 1;
  }

  /** Линия горизонта поверх тумана: яркий шов между небом и полом с дымкой вокруг. */
  drawHorizon(ctx: CanvasRenderingContext2D, vp: Viewport, h: Horizon, intensity: number): void {
    ctx.globalCompositeOperation = 'lighter';
    const haze = h.floorH * 0.09;
    this.drawSprite(ctx, 'beam', 0.28 * intensity, 0, h.hy - haze, vp.cssW, haze * 2);
    this.drawSprite(ctx, 'beam', 0.55 * intensity, 0, h.hy - 14, vp.cssW, 28);
    ctx.globalAlpha = 0.9 * intensity;
    ctx.fillStyle = this.colorHot;
    ctx.fillRect(0, h.hy - 0.75, vp.cssW, 1.5);
    ctx.globalAlpha = 1;
  }

  /**
   * Рельсы по краям поля, если поле уже экрана (затемнение за ними запечено в фон).
   * Засечки на рельсах бегут вниз со скоростью пола.
   */
  drawRails(ctx: CanvasRenderingContext2D, vp: Viewport, state: GameState, intensity: number, offX: number): void {
    if (vp.fieldW >= vp.cssW - 2) return;
    const H = vp.cssH;
    const left = vp.fieldX + offX;
    const right = vp.fieldX + vp.fieldW + offX;
    const rw = 34;
    ctx.globalCompositeOperation = 'lighter';
    this.drawSprite(ctx, 'rail', 0.85 * intensity, left - rw / 2, 0, rw, H);
    this.drawSprite(ctx, 'rail', 0.85 * intensity, right - rw / 2, 0, rw, H);

    // Засечки-«шпалы» с внутренней стороны рельс, к зрителю длиннее.
    const gap = 46;
    const shift = wrap(state.scroll * vp.scale * FLOOR_SPEED * 1.4, gap);
    ctx.fillStyle = this.colorHot;
    ctx.beginPath();
    for (let y = shift - gap; y < H; y += gap) {
      const len = 3 + 7 * clamp(y / H, 0, 1);
      ctx.rect(left + 3, y, len, 1.5);
      ctx.rect(right - 3 - len, y, len, 1.5);
    }
    ctx.globalAlpha = 0.5 * intensity;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /**
   * Полосы скорости внутри поля (мировые координаты): чем выше скорость,
   * тем их больше и тем они длиннее. Позиции — детерминированный шум, без состояния.
   */
  drawStreaks(ctx: CanvasRenderingContext2D, state: GameState, worldTop: number, worldBottom: number): void {
    const speed = clamp((state.speedMult - 1) / 1.3, 0, 1);
    const count = Math.round(8 + (STREAKS - 8) * speed);
    const len = 36 + 90 * speed;
    const span = worldBottom - worldTop + len;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = this.colorHot;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = 6 + hash(i * 3.17) * (WORLD_W - 12);
      const rate = 1.3 + hash(i * 7.31) * 1.4;
      const y = worldTop - len + wrap(hash(i * 1.93) * span + state.scroll * rate, span);
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len);
    }
    ctx.globalAlpha = 0.05 + 0.07 * speed;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
