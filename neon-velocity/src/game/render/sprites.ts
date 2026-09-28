/**
 * Кэш офскрин-спрайтов свечения. Вместо shadowBlur в циклах по объектам
 * ореолы рисуются одним drawImage готового радиального градиента нужного цвета
 * (в режиме 'lighter' они складываются, как настоящий свет).
 */
import { rgba } from '../math';
import { createSurface, hotColor, releaseSurface, type Surface } from './util';

/** Размер спрайтов ореола: достаточно для гладкого градиента при растяжении. */
const GLOW_PX = 128;
/** Профиль луча: поперёк — гаусс, вдоль — однородно (растягивается на любую длину). */
const BEAM_LONG = 4;
const BEAM_ACROSS = 64;
/** Спрайт факела двигателя. */
const FLAME_W = 40;
const FLAME_H = 104;
/** Рельса: гаусс по X, яркость растёт сверху вниз. */
const RAIL_W = 48;
const RAIL_H = 128;
/** Больше цветов разом в игре не бывает; переполнение — признак мусора, кэш сбрасывается. */
const MAP_LIMIT = 64;

/** Приближение гауссова спада: exp(-k·r²) в нескольких опорных точках. */
const GAUSS_STOPS = [0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88, 1];
function gauss(r: number): number {
  return Math.exp(-5.2 * r * r) * (1 - r * r);
}

type SpriteMap = Map<string, HTMLCanvasElement>;

export class SpriteCache {
  private readonly glows: SpriteMap = new Map();
  private readonly hots: SpriteMap = new Map();
  private readonly beams: SpriteMap = new Map();
  private readonly rails: SpriteMap = new Map();
  private readonly flames: SpriteMap = new Map();
  private readonly surfaces: Surface[] = [];
  private blank: HTMLCanvasElement | null = null;

  /** Мягкий ореол чистого цвета: центр — полная яркость, к краю — ноль. */
  glow(color: string): HTMLCanvasElement {
    return this.get(this.glows, color, () => this.paintGlow(color, false));
  }

  /** Ореол с раскалённой почти белой сердцевиной — ядра, наконечники лучей. */
  hot(color: string): HTMLCanvasElement {
    return this.get(this.hots, color, () => this.paintGlow(color, true));
  }

  /** Горизонтальный луч: профиль поперёк оси Y, по X растягивается. */
  beam(color: string): HTMLCanvasElement {
    return this.get(this.beams, color, () => this.paintBeam(color));
  }

  /** Вертикальная рельса по краю поля с раскалённой осью. */
  rail(color: string): HTMLCanvasElement {
    return this.get(this.rails, color, () => this.paintRail(color));
  }

  /** Факел двигателя: капля от белого к цвету и в прозрачность. */
  flame(color: string): HTMLCanvasElement {
    return this.get(this.flames, color, () => this.paintFlame(color));
  }

  clear(): void {
    for (const s of this.surfaces) releaseSurface(s);
    this.surfaces.length = 0;
    this.glows.clear();
    this.hots.clear();
    this.beams.clear();
    this.rails.clear();
    this.flames.clear();
  }

  private get(map: SpriteMap, color: string, paint: () => HTMLCanvasElement): HTMLCanvasElement {
    const cached = map.get(color);
    if (cached) return cached;
    if (map.size >= MAP_LIMIT) map.clear();
    const canvas = paint();
    map.set(color, canvas);
    return canvas;
  }

  private surface(w: number, h: number): Surface | null {
    const s = createSurface(w, h);
    if (s) this.surfaces.push(s);
    return s;
  }

  /** Без 2D-контекста спрайт — пустой холст 1×1: drawImage его просто не покажет. */
  private empty(): HTMLCanvasElement {
    if (!this.blank) {
      this.blank = document.createElement('canvas');
      this.blank.width = 1;
      this.blank.height = 1;
    }
    return this.blank;
  }

  private paintGlow(color: string, withCore: boolean): HTMLCanvasElement {
    const s = this.surface(GLOW_PX, GLOW_PX);
    if (!s) return this.empty();
    const { canvas, ctx } = s;
    const c = GLOW_PX / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    if (withCore) {
      const core = hotColor(color);
      g.addColorStop(0, rgba('#ffffff', 1));
      g.addColorStop(0.08, rgba(core, 0.95));
      g.addColorStop(0.2, rgba(color, 0.6));
      g.addColorStop(0.38, rgba(color, 0.22));
      g.addColorStop(0.6, rgba(color, 0.07));
      g.addColorStop(0.8, rgba(color, 0.02));
      g.addColorStop(1, rgba(color, 0));
    } else {
      for (const r of GAUSS_STOPS) g.addColorStop(r, rgba(color, gauss(r)));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, GLOW_PX, GLOW_PX);
    return canvas;
  }

  private paintBeam(color: string): HTMLCanvasElement {
    const s = this.surface(BEAM_LONG, BEAM_ACROSS);
    if (!s) return this.empty();
    const { canvas, ctx } = s;
    const g = ctx.createLinearGradient(0, 0, 0, BEAM_ACROSS);
    for (const r of GAUSS_STOPS) {
      const a = gauss(r);
      g.addColorStop(0.5 - r / 2, rgba(color, a));
      g.addColorStop(0.5 + r / 2, rgba(color, a));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, BEAM_LONG, BEAM_ACROSS);
    return canvas;
  }

  private paintRail(color: string): HTMLCanvasElement {
    const s = this.surface(RAIL_W, RAIL_H);
    if (!s) return this.empty();
    const { canvas, ctx } = s;
    const g = ctx.createLinearGradient(0, 0, RAIL_W, 0);
    const core = hotColor(color);
    for (const r of GAUSS_STOPS) {
      const a = gauss(r) * 0.55;
      g.addColorStop(0.5 - r / 2, rgba(color, a));
      g.addColorStop(0.5 + r / 2, rgba(color, a));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, RAIL_W, RAIL_H);
    // Раскалённая ось рельсы.
    ctx.fillStyle = core;
    ctx.fillRect(RAIL_W / 2 - 1, 0, 2, RAIL_H);
    ctx.fillStyle = rgba(color, 0.9);
    ctx.fillRect(RAIL_W / 2 - 2.5, 0, 1.5, RAIL_H);
    ctx.fillRect(RAIL_W / 2 + 1, 0, 1.5, RAIL_H);
    // Сверху (в «небе») рельса тает — маска по вертикали.
    ctx.globalCompositeOperation = 'destination-in';
    const fade = ctx.createLinearGradient(0, 0, 0, RAIL_H);
    fade.addColorStop(0, 'rgba(0,0,0,0.3)');
    fade.addColorStop(0.45, 'rgba(0,0,0,0.75)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, RAIL_W, RAIL_H);
    ctx.globalCompositeOperation = 'source-over';
    return canvas;
  }

  private paintFlame(color: string): HTMLCanvasElement {
    const s = this.surface(FLAME_W, FLAME_H);
    if (!s) return this.empty();
    const { canvas, ctx } = s;
    const cx = FLAME_W / 2;
    const top = 10;
    const bottom = FLAME_H - 6;
    const r = FLAME_W * 0.26;
    const drawDrop = (radius: number, length: number): void => {
      ctx.beginPath();
      ctx.moveTo(cx - radius, top + radius);
      ctx.arc(cx, top + radius, radius, Math.PI, 0);
      ctx.quadraticCurveTo(cx + radius * 0.9, top + length * 0.55, cx, top + length);
      ctx.quadraticCurveTo(cx - radius * 0.9, top + length * 0.55, cx - radius, top + radius);
      ctx.closePath();
    };
    // Внешнее пламя цветом шлейфа, размытие — только здесь, один раз при создании.
    const outer = ctx.createLinearGradient(0, top, 0, bottom);
    outer.addColorStop(0, rgba(color, 0.95));
    outer.addColorStop(0.45, rgba(color, 0.55));
    outer.addColorStop(1, rgba(color, 0));
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = outer;
    drawDrop(r, bottom - top);
    ctx.fill();
    // Белая сердцевина короче и уже.
    const inner = ctx.createLinearGradient(0, top, 0, top + (bottom - top) * 0.6);
    inner.addColorStop(0, 'rgba(255,255,255,1)');
    inner.addColorStop(0.5, rgba(hotColor(color), 0.8));
    inner.addColorStop(1, rgba(color, 0));
    ctx.shadowBlur = 4;
    ctx.fillStyle = inner;
    drawDrop(r * 0.5, (bottom - top) * 0.6);
    ctx.fill();
    ctx.shadowBlur = 0;
    return canvas;
  }
}

/** Нарисовать ореол-спрайт с центром (x, y) и радиусом r. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  r: number,
): void {
  ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
}
