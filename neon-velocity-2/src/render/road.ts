/**
 * Дорога: перспективная сетка, светящиеся бортики со столбиками, линия удара
 * и волны, бегущие к горизонту.
 *
 * Сетка состоит из двух половин. Продольные линии и бортики неподвижны на
 * экране, а длинные тонкие клинья — самое дорогое, что есть для растеризатора,
 * поэтому они запекаются в слой земли (paintLane, см. backdrop.ts). Поперечные
 * линии «едут» на зрителя и рисуются каждый кадр — ровными прямоугольниками в
 * пикселях холста, по одному fillRect на линию: это быстрый путь и для
 * программной, и для аппаратной отрисовки.
 */
import { WORLD } from '../core/config';
import { clamp, hexToRgb, lighten } from '../core/math';
import { mod } from '../core/timing';
import type { ThemeColors } from '../core/types';
import { CAMERA_D, type Camera } from './camera';
import { BLEED, devX, devY, lineScale, type View } from './view';

/** Шаг поперечных линий сетки, единицы мира. */
const CELL = 25;
/** Шаг продольных линий на дороге и на равнине. */
const LANE = 10;
const PLAIN_LANE = 30;
const PLAIN_LINES = 12;
/** Дальше этой глубины сетка не рисуется: линии там уже слились с дымкой. */
const GRID_FAR = 1500;
/** Столбики вдоль бортиков. */
const POST_GAP = 50;
const POST_FAR = 1100;
const POST_SIDE = 3.2;
const POST_HEIGHT = 7.5;
/** Волны: сколько одновременно и как быстро бегут, единиц мира в секунду. */
const WAVES = 4;
const WAVE_SPEED = 620;
const WAVE_REACH = 1200;
/** Запас за нижним краем экрана под тряску и удар масштаба, CSS-пиксели. */
const BELOW = 40;

const ROAD_LANES = WORLD.roadW / LANE - 1;
/** Сколько клиньев в запекаемой половине сетки (см. paintLane). */
export const LANE_STEPS = PLAIN_LINES * 2 + ROAD_LANES * 2 + 6;

/** Затухание линий к горизонту: 0 в дымке, 1 у корабля. s — перспективный масштаб. */
function fadeAt(s: number): number {
  if (s <= 0.09) return 0;
  if (s < 0.2) return ((s - 0.09) / 0.11) * 0.16;
  if (s < 0.3) return 0.16 + ((s - 0.2) / 0.1) * 0.24;
  if (s < 0.55) return 0.4 + ((s - 0.3) / 0.25) * 0.4;
  if (s < 1) return 0.8 + ((s - 0.55) / 0.45) * 0.2;
  return 1;
}

/** То же затухание градиентом — для запекаемых клиньев. */
function fadeGradient(ctx: CanvasRenderingContext2D, cam: Camera, color: string, alpha: number): CanvasGradient {
  const { r, g, b } = hexToRgb(color);
  const gradient = ctx.createLinearGradient(0, cam.horizonY, 0, cam.lineY);
  gradient.addColorStop(0.09, `rgba(${r},${g},${b},0)`);
  gradient.addColorStop(0.2, `rgba(${r},${g},${b},${0.16 * alpha})`);
  gradient.addColorStop(0.3, `rgba(${r},${g},${b},${0.4 * alpha})`);
  gradient.addColorStop(0.55, `rgba(${r},${g},${b},${0.8 * alpha})`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},${alpha})`);
  return gradient;
}

/**
 * Запечь один клин неподвижной половины сетки: линии равнины, продольные линии
 * дороги (ореол и сердцевина) и бортики. Вызывается по шагам 0…LANE_STEPS − 1,
 * чтобы слой следующего уровня можно было готовить понемногу, не роняя кадр.
 * ctx — в CSS-координатах сцены, режим смешивания 'lighter'.
 */
export function paintLane(ctx: CanvasRenderingContext2D, cam: Camera, colors: ThemeColors, gridColor: string, step: number): void {
  let x: number;
  let width: number;
  let alpha: number;
  let color = gridColor;
  if (step < PLAIN_LINES * 2) {
    const k = Math.floor(step / 2) + 1;
    x = step % 2 === 0 ? -PLAIN_LANE * k : WORLD.roadW + PLAIN_LANE * k;
    width = 1.1;
    alpha = 0.2;
  } else if (step < PLAIN_LINES * 2 + ROAD_LANES) {
    x = LANE * (step - PLAIN_LINES * 2 + 1);
    width = 6.5;
    alpha = 0.24;
  } else if (step < PLAIN_LINES * 2 + ROAD_LANES * 2) {
    x = LANE * (step - PLAIN_LINES * 2 - ROAD_LANES + 1);
    width = 1.7;
    alpha = 0.78;
    color = lighten(gridColor, 0.22);
  } else {
    const k = step - PLAIN_LINES * 2 - ROAD_LANES * 2;
    x = k % 2 === 0 ? 0 : WORLD.roadW;
    width = k < 2 ? 15 : k < 4 ? 6 : 2.2;
    alpha = k < 2 ? 0.24 : k < 4 ? 0.62 : 0.95;
    color = k < 4 ? colors.rail : lighten(colors.rail, 0.65);
  }
  const span = cam.lineY - cam.horizonY;
  const farS = CAMERA_D / (CAMERA_D + GRID_FAR);
  const nearS = (cam.cssH + BLEED - cam.horizonY) / span;
  const dx = (x - WORLD.roadW / 2) * cam.unit;
  const w = (width * lineScale(cam)) / 2;
  const yFar = cam.horizonY + span * farS;
  const yNear = cam.horizonY + span * nearS;
  ctx.fillStyle = fadeGradient(ctx, cam, color, alpha);
  ctx.beginPath();
  ctx.moveTo(cam.cx + dx * farS - w * farS, yFar);
  ctx.lineTo(cam.cx + dx * farS + w * farS, yFar);
  ctx.lineTo(cam.cx + dx * nearS + w * nearS, yNear);
  ctx.lineTo(cam.cx + dx * nearS - w * nearS, yNear);
  ctx.closePath();
  ctx.fill();
}

export class Road {
  private coreOf = '';
  private core = '';
  private railCoreOf = '';
  private railCore = '';
  private readonly waveZ = new Float32Array(WAVES).fill(-1);
  private readonly wavePower = new Float32Array(WAVES);
  private readonly waveColor: string[] = new Array<string>(WAVES).fill('#ffffff');

  reset(): void {
    this.waveZ.fill(-1);
  }

  /** Пустить волну от корабля к горизонту (смена уровня, старт). */
  wave(color: string, power: number): void {
    let slot = 0;
    for (let i = 0; i < WAVES; i++) {
      if (this.waveZ[i] < 0) {
        slot = i;
        break;
      }
      if (this.waveZ[i] > this.waveZ[slot]) slot = i;
    }
    this.waveZ[slot] = 0;
    this.wavePower[slot] = power;
    this.waveColor[slot] = color;
  }

  update(dt: number): void {
    for (let i = 0; i < WAVES; i++) {
      if (this.waveZ[i] < 0) continue;
      this.waveZ[i] += WAVE_SPEED * dt;
      if (this.waveZ[i] > WAVE_REACH) this.waveZ[i] = -1;
    }
  }

  draw(view: View): void {
    const { ctx, colors } = view;
    if (this.coreOf !== view.gridColor) {
      this.coreOf = view.gridColor;
      this.core = lighten(view.gridColor, 0.22);
    }
    if (this.railCoreOf !== colors.rail) {
      this.railCoreOf = colors.rail;
      this.railCore = lighten(colors.rail, 0.65);
    }
    // Всё ниже — ровные прямоугольники в пикселях холста. Обычное наложение на тёмной
    // сцене выглядит как сложение, а заливается в разы быстрее; 'lighter' — только огням.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    const pulse = view.reduced ? view.beat * 0.3 : view.beat;

    this.crossLines(view, pulse);

    this.drawBeatRipple(view, pulse);
    this.drawWaves(view);
    this.drawPosts(view, pulse);
    this.drawHitLine(view, pulse);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Масштаб у нижнего края экрана: ближе линии рисовать незачем. */
  private static bottomScale(view: View): number {
    return (view.cam.cssH + BELOW - view.cam.horizonY) / view.span;
  }

  /**
   * Поперечные линии, «едущие» на зрителя: тусклая на равнине во весь холст,
   * на дороге — ореол и яркая сердцевина от бортика до бортика.
   */
  private crossLines(view: View, pulse: number): void {
    const { ctx, cam } = view;
    const zNear = CAMERA_D / Road.bottomScale(view) - CAMERA_D;
    const first = Math.ceil((zNear + view.scroll) / CELL) * CELL - view.scroll;
    const half = (WORLD.roadW / 2) * cam.unit * view.kx * view.zoom;
    const thick = view.line * view.ky * view.zoom;
    const full = ctx.canvas.width;
    const plain = 0.16 + 0.07 * pulse;
    const glow = 0.2 + 0.2 * pulse;
    const core = 0.62 + 0.38 * pulse;

    ctx.fillStyle = view.gridColor;
    for (let z = first; z < GRID_FAR; z += CELL) {
      const s = CAMERA_D / (CAMERA_D + z);
      const fade = fadeAt(s);
      if (fade <= 0) break;
      const yScene = cam.horizonY + view.span * s;
      const y = devY(view, yScene);
      const h = Math.max(0.5, 1.3 * thick * s);
      ctx.globalAlpha = plain * fade;
      ctx.fillRect(0, y - h / 2, full, h);
      // Вдали ореол тоньше пикселя — там хватает сердцевины.
      const wide = 6.5 * thick * s;
      if (wide < 2) continue;
      ctx.globalAlpha = glow * fade;
      ctx.fillRect(devX(view, cam.cx, yScene) - half * s, y - wide / 2, half * s * 2, wide);
    }
    ctx.fillStyle = this.core;
    for (let z = first; z < GRID_FAR; z += CELL) {
      const s = CAMERA_D / (CAMERA_D + z);
      const fade = fadeAt(s);
      if (fade <= 0) break;
      const yScene = cam.horizonY + view.span * s;
      const h = Math.max(0.5, 1.7 * thick * s);
      ctx.globalAlpha = core * fade;
      ctx.fillRect(devX(view, cam.cx, yScene) - half * s, devY(view, yScene) - h / 2, half * s * 2, h);
    }
  }

  /** Поперечная полоса на дороге на глубине z толщиной thick единиц мира. */
  private band(view: View, z: number, thick: number, alpha: number): void {
    const { ctx, cam } = view;
    const s = CAMERA_D / (CAMERA_D + z);
    const fade = fadeAt(s);
    if (fade <= 0) return;
    const half = (WORLD.roadW / 2) * cam.unit * s;
    const yScene = cam.horizonY + view.span * s;
    const h = Math.max(0.8, thick * view.flat * cam.unit * s * s * view.ky * view.zoom);
    ctx.globalAlpha = alpha * fade;
    ctx.fillRect(devX(view, cam.cx - half, yScene), devY(view, yScene) - h / 2, half * 2 * view.kx * view.zoom, h);
  }

  /** На каждую долю от линии удара вперёд убегает тонкая рябь. */
  private drawBeatRipple(view: View, pulse: number): void {
    if (view.reduced || pulse < 0.03) return;
    view.ctx.fillStyle = view.colors.rail;
    this.band(view, 190 * Math.pow(1 - view.beat, 0.7), 2.2, pulse * pulse * 0.55);
  }

  private drawWaves(view: View): void {
    const { ctx, cam } = view;
    for (let i = 0; i < WAVES; i++) {
      const z = this.waveZ[i];
      if (z < 0) continue;
      const life = 1 - z / WAVE_REACH;
      const power = Math.min(1, this.wavePower[i] * life);
      const color = this.waveColor[i];
      // Гребень, его ореол и два затухающих следа.
      ctx.fillStyle = color;
      this.band(view, z, 5, power);
      this.band(view, z, 16, power * 0.4);
      if (z > 30) this.band(view, z - 30, 4, power * 0.4);
      if (z > 62) this.band(view, z - 62, 2.5, power * 0.4);
      // Вспышки на бортиках там, где проходит гребень.
      const s = CAMERA_D / (CAMERA_D + z);
      const half = (WORLD.roadW / 2) * cam.unit * s;
      const y = cam.horizonY + view.span * s;
      const r = (6 + 8 * this.wavePower[i]) * cam.unit * s * life;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(power * 1.2, 0, 1);
      view.sprites.glow(view, color, true, cam.cx - half, y, r);
      view.sprites.glow(view, color, true, cam.cx + half, y, r);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** Столбики с огнями проносятся мимо — главный признак скорости. */
  private drawPosts(view: View, pulse: number): void {
    const { ctx, cam, colors } = view;
    const zNear = CAMERA_D / Road.bottomScale(view) - CAMERA_D - 12;
    const first = Math.ceil((zNear + view.scroll) / POST_GAP) * POST_GAP - view.scroll;
    const side = (WORLD.roadW / 2 + POST_SIDE) * cam.unit;
    const px = view.kx * view.zoom;

    ctx.fillStyle = colors.rail;
    for (let z = first; z < POST_FAR; z += POST_GAP) {
      const s = CAMERA_D / (CAMERA_D + z);
      const fade = fadeAt(s);
      if (fade <= 0) break;
      const yScene = cam.horizonY + view.span * s;
      const y = devY(view, yScene);
      const h = POST_HEIGHT * cam.unit * s * view.ky * view.zoom;
      const w = Math.max(1, 0.55 * cam.unit * s * px);
      ctx.globalAlpha = 0.85 * fade;
      ctx.fillRect(devX(view, cam.cx - side * s, yScene) - w / 2, y - h, w, h);
      ctx.fillRect(devX(view, cam.cx + side * s, yScene) - w / 2, y - h, w, h);
    }

    ctx.globalCompositeOperation = 'lighter';
    for (let z = first; z < POST_FAR; z += POST_GAP) {
      const s = CAMERA_D / (CAMERA_D + z);
      // Дальние огни сливаются с бортиком — рисуем только различимые.
      const fade = clamp((s - 0.2) / 0.2, 0, 1);
      if (fade <= 0) break;
      const top = cam.horizonY + view.span * s - POST_HEIGHT * cam.unit * s;
      // Огни «дышат» по очереди: чётные столбики на долю, нечётные — между.
      const index = Math.round((z + view.scroll) / POST_GAP);
      const lit = mod(index, 2) === 0 ? pulse : 1 - pulse;
      const r = (1.3 + 0.9 * lit) * cam.unit * s;
      ctx.globalAlpha = fade * (0.55 + 0.45 * lit);
      view.sprites.glow(view, colors.rail, true, cam.cx - side * s, top, r);
      view.sprites.glow(view, colors.rail, true, cam.cx + side * s, top, r);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Линия удара: здесь объекты пересекают корабль, и здесь же бьётся доля. */
  private drawHitLine(view: View, pulse: number): void {
    const { ctx, cam, colors } = view;
    const half = (WORLD.roadW / 2) * cam.unit;
    const y = devY(view, cam.lineY);
    const left = devX(view, cam.cx - half, cam.lineY);
    const width = half * 2 * view.kx * view.zoom;
    const k = view.line * (1 + 0.55 * pulse) * view.ky;
    ctx.fillStyle = colors.rail;
    ctx.globalAlpha = 0.07 + 0.14 * pulse;
    ctx.fillRect(left, y - 9 * k, width, 18 * k);
    ctx.globalAlpha = 0.16 + 0.26 * pulse;
    ctx.fillRect(left, y - 3.6 * k, width, 7.2 * k);
    ctx.fillStyle = this.railCore;
    ctx.globalAlpha = 0.7 + 0.3 * pulse;
    ctx.fillRect(left, y - 1.1 * k, width, 2.2 * k);
    // Узлы на бортиках.
    const r = (8 + 8 * pulse) * view.line;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.8 + 0.2 * pulse;
    view.sprites.glow(view, colors.rail, true, cam.cx - half, cam.lineY, r);
    view.sprites.glow(view, colors.rail, true, cam.cx + half, cam.lineY, r);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
