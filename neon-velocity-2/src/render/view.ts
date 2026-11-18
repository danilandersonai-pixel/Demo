/**
 * Общие данные кадра и офскрин-спрайты. Один объект View живёт всё время
 * рендера и переписывается каждый кадр: слои читают из него время, камеру и
 * цвета и ничего не выделяют в куче сами.
 */
import { hexToRgb, lighten } from '../core/math';
import type { SimState, Skin, ThemeColors } from '../core/types';
import type { Camera } from './camera';

/** Шрифт надписей на холсте (SPEC §6). */
export const CANVAS_FONT = '"Orbitron", "JetBrains Mono Variable", monospace';

/** Запас кэш-слоёв вокруг экрана под тряску камеры, CSS-пиксели. */
export const BLEED = 24;

export interface View {
  ctx: CanvasRenderingContext2D;
  cam: Camera;
  state: SimState;
  colors: ThemeColors;
  skin: Skin;
  sprites: Sprites;
  /** Пикселей холста на CSS-пиксель по осям (≈ dpr). */
  kx: number;
  ky: number;
  /** Мировое время кадра, тики (дробное): state.tick − 1 + alpha. */
  t: number;
  alpha: number;
  /** Реальное время, сек. */
  now: number;
  /** Сколько мирового времени прошло с прошлого кадра, сек (0 на паузе и при смене сцены). */
  dt: number;
  /** Импульс доли: 1 в момент удара, гаснет к следующему. */
  beat: number;
  /** Импульс сильной доли такта. */
  downbeat: number;
  /** Корабль: X на дороге (между тиками) и точка на экране. */
  shipX: number;
  shipSx: number;
  shipSy: number;
  /** Цвета корпуса и ядра корабля (скин или тема). */
  hull: string;
  shipCore: string;
  /** Цвет сетки с учётом перехода между уровнями. */
  gridColor: string;
  /** Путь, пройденный дорогой, единицы мира (для сетки и столбиков). */
  scroll: number;
  /** Скорость дороги, единиц мира в секунду. */
  speed: number;
  /** 0..1 — плавно включающийся OVERDRIVE. */
  overdrive: number;
  /** Меньше движения: без качания, мерцания и рывков. */
  reduced: boolean;
  /** Множитель толщины линий: 1 на «эталонном» экране, меньше на телефоне. */
  line: number;
  /** Высота дороги на экране от горизонта до линии корабля, CSS-пиксели. */
  span: number;
  /** Во сколько раз сжата по вертикали окружность, лежащая на дороге у корабля. */
  flat: number;
  /** Тряска камеры: сдвиг всего кадра в пикселях холста (целые). */
  ox: number;
  oy: number;
  /** Удар масштаба дороги вокруг точки схода (1 — нет). */
  zoom: number;
  /**
   * Крен мира вслед за кораблём: на сколько CSS-пикселей точка смещается вбок
   * на каждый пиксель ниже горизонта. Наклон задан сдвигом строк, а не
   * поворотом — так кэш-слои и линии сетки остаются выровненными по пикселям.
   */
  shear: number;
}

/** Толщина линий под экран: 1 там, где единица мира занимает REFERENCE_UNIT CSS-пикселей. */
const REFERENCE_UNIT = 8;

export function lineScale(cam: Camera): number {
  return Math.min(1.3, Math.max(0.6, cam.unit / REFERENCE_UNIT));
}

/** Точка сцены (CSS-пиксели) → X на холсте с учётом тряски, крена и удара масштаба. */
export function devX(view: View, x: number, y: number): number {
  const cam = view.cam;
  return view.kx * (cam.cx + view.zoom * (x - cam.cx + view.shear * (y - cam.horizonY))) + view.ox;
}

/** Y сцены (CSS-пиксели) → Y на холсте. */
export function devY(view: View, y: number): number {
  const hy = view.cam.horizonY;
  return view.ky * (hy + view.zoom * (y - hy)) + view.oy;
}

/** Включить матрицу мира: дальше слой рисует в CSS-пикселях сцены. */
export function useWorld(view: View): void {
  const cam = view.cam;
  const z = view.zoom;
  view.ctx.setTransform(
    view.kx * z,
    0,
    view.kx * z * view.shear,
    view.ky * z,
    view.kx * (cam.cx - z * cam.cx - z * view.shear * cam.horizonY) + view.ox,
    view.ky * (cam.horizonY - z * cam.horizonY) + view.oy,
  );
}

export function makeLayer(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

/**
 * Контекст офскрин-слоя; null — браузер не дал 2D-контекст (слой останется пустым).
 * opaque — слой без прозрачности: такой копируется на холст заметно быстрее.
 */
export function layerContext(canvas: HTMLCanvasElement, opaque = false): CanvasRenderingContext2D | null {
  return canvas.getContext('2d', { alpha: !opaque });
}

/** Освободить память слоя сразу, не дожидаясь сборщика мусора. */
export function freeLayer(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

const GLOW_SIZE = 64;
const TEXT_CACHE_LIMIT = 40;
/** Радиусы готовых спрайтов свечения, пиксели холста: геометрическая лесенка с шагом ~19 %. */
const BUCKETS = 30;
const BUCKET_BASE = 3;
const BUCKET_STEP = Math.log(1.19);
const HALO_STOPS = [0, 0.55, 0.22, 0.24, 0.5, 0.07, 1, 0];
const CORE_STOPS = [0, 1, 0.16, 0.85, 0.4, 0.26, 1, 0];

export interface TextSprite {
  canvas: HTMLCanvasElement;
  /** Размер в CSS-пикселях. */
  w: number;
  h: number;
}

type Ladder = (HTMLCanvasElement | undefined)[];

/**
 * Кэш спрайтов свечения и надписей. Ореол — радиальный градиент, нарисованный
 * один раз: в кадре это drawImage вместо shadowBlur. Чтобы блит был «пиксель в
 * пиксель» (масштабирование спрайта в разы дороже), для каждого цвета лениво
 * создаётся лесенка размеров и берётся ближайший.
 */
export class Sprites {
  private readonly halos = new Map<string, HTMLCanvasElement>();
  private readonly cores = new Map<string, HTMLCanvasElement>();
  private readonly haloLadders = new Map<string, Ladder>();
  private readonly coreLadders = new Map<string, Ladder>();
  private readonly texts = new Map<string, TextSprite>();
  private pixelScale = 1;

  /** Плотность пикселей для надписей (ореолы от неё не зависят — они и так размыты). */
  setPixelScale(scale: number): void {
    if (scale === this.pixelScale) return;
    this.pixelScale = scale;
    this.clearTexts();
  }

  /** Мягкий ореол: широкое свечение цвета (базовый спрайт для растянутых бликов). */
  halo(color: string): HTMLCanvasElement {
    let sprite = this.halos.get(color);
    if (!sprite) {
      sprite = radialSprite(color, GLOW_SIZE / 2, HALO_STOPS, false);
      this.halos.set(color, sprite);
    }
    return sprite;
  }

  /** Горячее ядро: белый центр, быстро спадающий в цвет. */
  core(color: string): HTMLCanvasElement {
    let sprite = this.cores.get(color);
    if (!sprite) {
      sprite = radialSprite(color, GLOW_SIZE / 2, CORE_STOPS, true);
      this.cores.set(color, sprite);
    }
    return sprite;
  }

  /**
   * Круглое свечение радиуса r с центром в точке сцены (CSS-пиксели), без
   * масштабирования: спрайт ближайшего размера ставится на целые пиксели
   * холста. hot — ядро с белым центром, иначе мягкий ореол. Прозрачность и
   * режим смешивания задаёт вызывающий; матрица мира после вызова включена.
   */
  glow(view: View, color: string, hot: boolean, x: number, y: number, r: number): void {
    const radius = r * view.kx * view.zoom;
    if (radius < 0.75) return;
    const ladders = hot ? this.coreLadders : this.haloLadders;
    let ladder = ladders.get(color);
    if (!ladder) {
      ladder = new Array<HTMLCanvasElement | undefined>(BUCKETS).fill(undefined);
      ladders.set(color, ladder);
    }
    const index = Math.min(BUCKETS - 1, Math.max(0, Math.round(Math.log(radius / BUCKET_BASE) / BUCKET_STEP)));
    let sprite = ladder[index];
    if (!sprite) {
      sprite = radialSprite(color, Math.round(BUCKET_BASE * Math.exp(index * BUCKET_STEP)), hot ? CORE_STOPS : HALO_STOPS, hot);
      ladder[index] = sprite;
    }
    const half = sprite.width / 2;
    const ctx = view.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sprite, Math.round(devX(view, x, y) - half), Math.round(devY(view, y) - half));
    useWorld(view);
  }

  /** Надпись с неоновым свечением; px — высота шрифта в CSS-пикселях. */
  text(text: string, color: string, px: number): TextSprite {
    const key = `${px}|${color}|${text}`;
    const cached = this.texts.get(key);
    if (cached) return cached;
    if (this.texts.size >= TEXT_CACHE_LIMIT) {
      // Старейшая запись — первая: Map хранит порядок вставки.
      const oldest = this.texts.keys().next();
      if (!oldest.done) {
        freeLayer(this.texts.get(oldest.value)?.canvas ?? null);
        this.texts.delete(oldest.value);
      }
    }
    const sprite = textSprite(text, color, px, this.pixelScale);
    this.texts.set(key, sprite);
    return sprite;
  }

  /** Шрифт догрузился — надписи надо нарисовать заново. */
  clearTexts(): void {
    this.texts.forEach((s) => freeLayer(s.canvas));
    this.texts.clear();
  }

  dispose(): void {
    this.halos.forEach(freeLayer);
    this.cores.forEach(freeLayer);
    this.haloLadders.forEach((ladder) => ladder.forEach((sprite) => freeLayer(sprite ?? null)));
    this.coreLadders.forEach((ladder) => ladder.forEach((sprite) => freeLayer(sprite ?? null)));
    this.halos.clear();
    this.cores.clear();
    this.haloLadders.clear();
    this.coreLadders.clear();
    this.clearTexts();
  }
}

/** Радиальный спрайт радиуса r. stops — пары (позиция, непрозрачность); white — центр уходит в белый. */
function radialSprite(color: string, r: number, stops: number[], white: boolean): HTMLCanvasElement {
  const canvas = makeLayer(r * 2, r * 2);
  const ctx = layerContext(canvas);
  if (!ctx) return canvas;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  const { r: cr, g: cg, b: cb } = hexToRgb(color);
  for (let i = 0; i < stops.length; i += 2) {
    const pos = stops[i];
    const a = stops[i + 1];
    // Ближе к центру цвет выбеливается — так спрайт читается как источник света.
    const w = white ? Math.max(0, 1 - pos / 0.3) : 0;
    g.addColorStop(pos, `rgba(${mix(cr, w)},${mix(cg, w)},${mix(cb, w)},${a})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, r * 2, r * 2);
  return canvas;
}

function mix(channel: number, white: number): number {
  return Math.round(channel + (255 - channel) * white);
}

function textSprite(text: string, color: string, px: number, scale: number): TextSprite {
  const font = `900 ${px}px ${CANVAS_FONT}`;
  const pad = Math.ceil(px * 0.7);
  const probe = makeLayer(1, 1);
  const pctx = layerContext(probe);
  let textW = text.length * px * 0.7;
  if (pctx) {
    pctx.font = font;
    textW = pctx.measureText(text).width;
  }
  const w = Math.ceil(textW + pad * 2);
  const h = Math.ceil(px + pad * 2);
  const canvas = makeLayer(w * scale, h * scale);
  const ctx = layerContext(canvas);
  if (ctx) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Свечение рисуется один раз при создании спрайта — в кадре shadowBlur нет.
    ctx.shadowColor = color;
    ctx.shadowBlur = px * 0.55;
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
    ctx.fillText(text, w / 2, h / 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = lighten(color, 0.72);
    ctx.fillText(text, w / 2, h / 2);
  }
  return { canvas, w, h };
}

/** Растянутый спрайт свечения с центром в (x, y) и полуосями rx, ry — для бликов на полотне. */
export function blit(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, rx: number, ry: number): void {
  ctx.drawImage(sprite, x - rx, y - ry, rx * 2, ry * 2);
}

/** Дешёвый воспроизводимый шум 0..1 по целому ключу (искры, мерцание). */
export function hash01(n: number): number {
  let x = Math.imul(n | 0, 0x9e3779b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}
