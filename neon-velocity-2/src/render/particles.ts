/**
 * Частицы и прочая «пыль» событий: светящиеся пиксели, искры, осколки,
 * ударные кольца, всплывающие надписи, шлейф корабля и скоростные линии
 * OVERDRIVE. Всё хранится в заранее выделенных массивах — в кадре ничего не
 * создаётся. Частицы живут в координатах мира (x поперёк, y вверх, z вдоль) и
 * проецируются той же камерой, что и дорога: искра, летящая на зрителя, растёт.
 *
 * Физика затухания: скорость гаснет, частица падает, отскакивает от полотна,
 * тускнеет и сжимается.
 */
import { clamp, easeOutBack, easeOutCubic, lerp, lighten, TAU } from '../core/math';
import { SHIP_GEOMETRY, SHIP_SIZE } from '../core/shipGeometry';
import type { ObstacleKind, SimEvent, SimState, ThemeColors } from '../core/types';
import { project, type Projected } from './camera';
import { SHIP_HOVER, Ship } from './ship';
import { devX, devY, hash01, useWorld, type TextSprite, type View } from './view';

const MAX = 800;
const STRIDE = 14;
const X = 0;
const Y = 1;
const Z = 2;
const VX = 3;
const VY = 4;
const VZ = 5;
const LIFE = 6;
const SPAN = 7;
const SIZE = 8;
const DRAG = 9;
const GRAVITY = 10;
const COLOR = 11;
const KIND = 12;
const SPIN = 13;

/** Светящийся пиксель, искра-штрих, вращающийся осколок. */
const PIXEL = 0;
const SPARK = 1;
const SHARD = 2;

const RINGS = 24;
const RING_STRIDE = 10;
const R_X = 0;
const R_Y = 1;
const R_Z = 2;
const R_FROM = 3;
const R_TO = 4;
const R_AGE = 5;
const R_SPAN = 6;
const R_WIDTH = 7;
const R_COLOR = 8;
const R_KIND = 9;

/** Кольцо лицом к зрителю, кольцо на полотне, вспышка-шар. */
const RING_FACING = 0;
const RING_ROAD = 1;
const RING_GLOW = 2;

const LABELS = 10;
const MAX_COLORS = 24;
/** Частица за этой глубиной уже позади камеры. */
const Z_BEHIND = -120;
/** Скоростные линии OVERDRIVE. */
const SPEED_LINES = 18;
/** Высота, на которой собирается сфера (см. objects.ts). */
const PICKUP_Y = 4.6;

interface Label {
  sprite: TextSprite | null;
  /** Точка мира, к которой привязана надпись. */
  x: number;
  y: number;
  z: number;
  /** На сколько CSS-пикселей надпись уже всплыла над своей точкой. */
  lift: number;
  age: number;
  span: number;
}

function obstacleColor(colors: ThemeColors, kind: ObstacleKind): string {
  return kind === 'cube' ? colors.cube : kind === 'saw' ? colors.saw : colors.laser;
}

export class Particles {
  private readonly data = new Float32Array(MAX * STRIDE);
  private count = 0;
  private readonly rings = new Float32Array(RINGS * RING_STRIDE);
  private readonly labels: Label[] = [];
  private readonly colors: string[] = [];
  private readonly colorIds = new Map<string, number>();
  private readonly p: Projected = { x: 0, y: 0, scale: 0 };
  private readonly q: Projected = { x: 0, y: 0, scale: 0 };
  /** Дробный остаток частиц шлейфа между кадрами. */
  private trailDebt = 0;
  private tintOf = '';
  private tint = '#ffffff';

  constructor() {
    for (let i = 0; i < LABELS; i++) this.labels.push({ sprite: null, x: 0, y: 0, z: 0, lift: 0, age: 0, span: 0 });
    this.clear();
  }

  /** Сколько частиц сейчас живо. */
  get alive(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
    this.trailDebt = 0;
    for (let i = 0; i < RINGS; i++) this.rings[i * RING_STRIDE + R_SPAN] = 0;
    for (const label of this.labels) label.sprite = null;
    this.colors.length = 0;
    this.colorIds.clear();
  }

  /** Спрайты надписей пересозданы (догрузился шрифт, сменился размер) — старые ссылки недействительны. */
  dropLabels(): void {
    for (const label of this.labels) label.sprite = null;
  }

  private colorId(color: string): number {
    let id = this.colorIds.get(color);
    if (id === undefined) {
      // Палитра темы невелика; лишний цвет делит ячейку с первым, а не растит таблицу.
      if (this.colors.length >= MAX_COLORS) return 0;
      id = this.colors.length;
      this.colors.push(color);
      this.colorIds.set(color, id);
    }
    return id;
  }

  // ─── Рождение ─────────────────────────────────────────────────────────────

  private spawn(kind: number, color: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, drag: number, gravity: number): void {
    if (this.count >= MAX) return;
    const o = this.count * STRIDE;
    const d = this.data;
    d[o + X] = x;
    d[o + Y] = y;
    d[o + Z] = z;
    d[o + VX] = vx;
    d[o + VY] = vy;
    d[o + VZ] = vz;
    d[o + LIFE] = life;
    d[o + SPAN] = life;
    d[o + SIZE] = size;
    d[o + DRAG] = drag;
    d[o + GRAVITY] = gravity;
    d[o + COLOR] = color;
    d[o + KIND] = kind;
    d[o + SPIN] = Math.random() * TAU;
    this.count += 1;
  }

  /**
   * Вспышка частиц из точки во все стороны. up — насколько разлёт прижат к
   * верхней полусфере (0 — сфера, 1 — только вверх); back — снос к зрителю.
   */
  private burst(kind: number, color: string, count: number, x: number, y: number, z: number, speed: number, life: number, size: number, up: number, back: number): void {
    const id = this.colorId(color);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const ring = Math.sqrt(1 - u * u);
      const a = Math.random() * TAU;
      const v = speed * (0.25 + 0.75 * Math.random());
      const vy = lerp(u, Math.abs(u), up) * v;
      this.spawn(
        kind,
        id,
        x,
        y,
        z,
        Math.cos(a) * ring * v,
        vy,
        Math.sin(a) * ring * v * 0.7 - back,
        life * (0.55 + 0.45 * Math.random()),
        size * (0.6 + 0.8 * Math.random()),
        kind === SPARK ? 3.4 : 2.3,
        kind === SHARD ? 26 : 34,
      );
    }
  }

  private ring(kind: number, color: string, x: number, y: number, z: number, from: number, to: number, span: number, width: number, delay = 0): void {
    const r = this.rings;
    let slot = 0;
    let oldest = -1;
    for (let i = 0; i < RINGS; i++) {
      const o = i * RING_STRIDE;
      if (r[o + R_SPAN] <= 0) {
        slot = i;
        break;
      }
      // Свободных нет — заменяем кольцо, которому осталось меньше всего.
      const done = r[o + R_AGE] / r[o + R_SPAN];
      if (done > oldest) {
        oldest = done;
        slot = i;
      }
    }
    const o = slot * RING_STRIDE;
    r[o + R_X] = x;
    r[o + R_Y] = y;
    r[o + R_Z] = z;
    r[o + R_FROM] = from;
    r[o + R_TO] = to;
    r[o + R_AGE] = -delay;
    r[o + R_SPAN] = span;
    r[o + R_WIDTH] = width;
    r[o + R_COLOR] = this.colorId(color);
    r[o + R_KIND] = kind;
  }

  /** Всплывающая надпись над точкой мира; lift — начальный подъём в CSS-пикселях. */
  private label(view: View, text: string, color: string, px: number, x: number, y: number, z: number, span: number, lift = 0): void {
    let slot = this.labels[0];
    for (const label of this.labels) {
      if (!label.sprite) {
        slot = label;
        break;
      }
      if (label.age / label.span > slot.age / slot.span) slot = label;
    }
    slot.sprite = view.sprites.text(text, color, px);
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.lift = lift;
    slot.age = 0;
    slot.span = span;
    this.settleLabels(view);
  }

  /**
   * Развести надписи, чтобы они не накладывались: из каждой пересекающейся пары
   * старшая уступает место и поднимается над младшей. Вызывается при появлении
   * новой надписи, не каждый кадр.
   */
  private settleLabels(view: View): void {
    const labels = this.labels;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const young of labels) {
        if (!young.sprite) continue;
        const a = project(view.cam, young.x, young.y, young.z, this.p);
        const ax = a.x;
        const ay = a.y - young.lift;
        for (const old of labels) {
          if (!old.sprite || old === young || old.age <= young.age) continue;
          const b = project(view.cam, old.x, old.y, old.z, this.q);
          // Спрайт шире и выше текста на поля свечения — сравниваем по самому тексту.
          const reachX = (young.sprite.w + old.sprite.w) * 0.36;
          const reachY = (young.sprite.h + old.sprite.h) * 0.2;
          const gap = ay - (b.y - old.lift);
          if (Math.abs(b.x - ax) >= reachX || Math.abs(gap) >= reachY) continue;
          old.lift += reachY + gap;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /** Размер шрифта надписей под экран: крупнее на мониторе, компактнее на телефоне. */
  private static fontPx(view: View, scale: number): number {
    return Math.round(clamp(12 + 10 * view.line, 14, 24) * scale);
  }

  // ─── События симуляции ────────────────────────────────────────────────────

  onEvent(e: SimEvent, state: SimState, view: View): void {
    const colors = view.colors;
    const shipX = state.player.x;
    const back = view.speed * 0.22;
    switch (e.type) {
      case 'collect': {
        const color = e.rare ? colors.crystalRare : colors.crystal;
        this.burst(PIXEL, color, e.rare ? 32 : 22, e.x, PICKUP_Y, 0, e.rare ? 66 : 50, 0.8, 0.8, 0.35, back);
        this.burst(PIXEL, '#ffffff', e.rare ? 12 : 7, e.x, PICKUP_Y, 0, 32, 0.5, 0.55, 0.35, back);
        this.ring(RING_FACING, color, e.x, PICKUP_Y, 0, 1.5, e.rare ? 15 : 10, 0.42, 1.1);
        this.ring(RING_GLOW, color, e.x, PICKUP_Y, 0, e.rare ? 8 : 5, e.rare ? 12 : 7, 0.26, 0);
        if (e.rare) this.ring(RING_FACING, '#ffffff', e.x, PICKUP_Y, 0, 1, 21, 0.6, 0.7, 0.06);
        this.label(view, `+${e.points}`, color, Particles.fontPx(view, e.rare ? 1.1 : 0.85), e.x, PICKUP_Y + 3, 0, e.rare ? 1 : 0.75);
        break;
      }
      case 'miss':
        this.burst(PIXEL, colors.sceneryFar, 7, e.x, 2.5, -7, 14, 0.5, 0.45, 0, back);
        break;
      case 'comboUp':
        this.ring(RING_ROAD, colors.accent3, shipX, 0.2, 0, 4, 20 + e.multiplier * 2, 0.5, 1);
        this.burst(PIXEL, colors.accent3, 8 + e.multiplier, shipX, 3, 0, 34, 0.7, 0.5, 1, 0);
        break;
      case 'comboBreak':
        this.ring(RING_ROAD, colors.laser, shipX, 0.2, 0, 26, 5, 0.38, 1.2);
        this.burst(PIXEL, colors.laser, 6 + e.lost * 2, shipX, 3, 0, 26, 0.6, 0.5, 0.2, back);
        break;
      case 'overdrive':
        if (!e.on) break;
        this.ring(RING_ROAD, colors.accent3, shipX, 0.2, 0, 4, 64, 0.75, 1.5);
        this.ring(RING_ROAD, '#ffffff', shipX, 0.2, 0, 4, 46, 0.6, 1, 0.08);
        this.ring(RING_GLOW, colors.accent3, shipX, SHIP_HOVER, 0, 10, 18, 0.4, 0);
        this.burst(PIXEL, colors.accent3, 42, shipX, 3, 0, 78, 1, 0.65, 0.8, 0);
        break;
      case 'dodge': {
        if (!e.near) break;
        // Искры летят от препятствия в сторону корабля.
        const side = shipX >= e.x ? 1 : -1;
        const id = this.colorId(colors.accent3);
        const hot = this.colorId('#ffffff');
        for (let i = 0; i < 16; i++) {
          const v = 30 + 70 * Math.random();
          this.spawn(SPARK, i % 3 === 0 ? hot : id, e.x, 1 + 3 * Math.random(), 0, side * v * (0.3 + 0.7 * Math.random()), v * (0.1 + 0.5 * Math.random()), -back - 30 * Math.random(), 0.3 + 0.3 * Math.random(), 0.5, 3.2, 40);
        }
        this.ring(RING_FACING, colors.accent3, e.x, 2.5, 0, 1, 7, 0.3, 0.9);
        // Надпись — сбоку от корабля, с той стороны, где нет препятствия; счёт сфер над кораблём она не закрывает.
        const px = Particles.fontPx(view, 0.8);
        this.label(view, 'NEAR MISS', colors.accent3, px, shipX + side * 10, 2, 0, 0.9, px * 1.2);
        this.label(view, `+${e.points}`, '#ffffff', Particles.fontPx(view, 0.68), shipX + side * 10, 2, 0, 0.9);
        break;
      }
      case 'shieldBreak': {
        // Щит разлетается осколками, препятствие — в пыль.
        const debris = obstacleColor(colors, e.kind);
        this.burst(SHARD, view.hull, 26, e.x, SHIP_HOVER + 1, 0, 70, 1.1, 2.6, 0.45, back * 0.5);
        this.burst(PIXEL, view.hull, 24, e.x, SHIP_HOVER + 1, 0, 60, 0.9, 0.6, 0.45, back * 0.5);
        this.burst(PIXEL, debris, 34, e.x, 3.5, 2, 74, 1, 0.75, 0.6, back);
        this.burst(SHARD, debris, 12, e.x, 3.5, 2, 58, 1.1, 2.4, 0.6, back);
        this.ring(RING_FACING, view.hull, e.x, SHIP_HOVER, 0, 7, 30, 0.55, 1.6);
        this.ring(RING_ROAD, '#ffffff', e.x, 0.2, 0, 3, 44, 0.5, 1.2, 0.05);
        this.ring(RING_GLOW, view.hull, e.x, SHIP_HOVER, 0, 12, 20, 0.35, 0);
        break;
      }
      case 'levelUp': {
        // Салют с бортиков по обе стороны от корабля.
        const id = this.colorId(view.gridColor);
        for (let i = 0; i < 28; i++) {
          const side = i % 2 === 0 ? 0 : 100;
          this.spawn(PIXEL, id, side, 0.5, 40 * Math.random(), (side === 0 ? 1 : -1) * 22 * Math.random(), 30 + 40 * Math.random(), -back, 0.6 + 0.6 * Math.random(), 0.55, 1.6, 44);
        }
        break;
      }
      case 'newRecord':
        this.ring(RING_ROAD, colors.accent3, shipX, 0.2, 0, 4, 54, 0.8, 1.5);
        this.ring(RING_ROAD, colors.accent, shipX, 0.2, 0, 4, 54, 0.8, 1.2, 0.14);
        this.ring(RING_ROAD, colors.accent2, shipX, 0.2, 0, 4, 54, 0.8, 1, 0.28);
        this.burst(PIXEL, colors.accent3, 34, shipX, 3, 0, 84, 1.25, 0.7, 1, 0);
        this.burst(PIXEL, colors.accent, 22, shipX, 3, 0, 70, 1.25, 0.6, 1, 0);
        break;
      case 'death': {
        const cause = obstacleColor(colors, e.kind);
        const y = SHIP_HOVER + 1;
        this.burst(PIXEL, view.hull, 64, e.x, y, 0, 96, 1.5, 0.85, 0.5, back * 0.3);
        this.burst(PIXEL, '#ffffff', 30, e.x, y, 0, 124, 1.1, 0.6, 0.5, back * 0.3);
        this.burst(PIXEL, colors.trail, 34, e.x, y, 0, 70, 1.7, 0.95, 0.5, back * 0.3);
        this.burst(PIXEL, cause, 30, e.x, y, 1, 82, 1.4, 0.8, 0.6, back * 0.3);
        this.burst(SPARK, '#ffffff', 26, e.x, y, 0, 150, 0.7, 0.6, 0.3, 0);
        this.burst(SHARD, view.hull, 16, e.x, y, 0, 62, 1.9, 3.4, 0.55, back * 0.3);
        this.ring(RING_GLOW, '#ffffff', e.x, y, 0, 14, 26, 0.5, 0);
        this.ring(RING_GLOW, view.hull, e.x, y, 0, 18, 34, 0.9, 0);
        this.ring(RING_ROAD, '#ffffff', e.x, 0.2, 0, 3, 74, 0.7, 2);
        this.ring(RING_ROAD, view.hull, e.x, 0.2, 0, 3, 96, 1, 1.5, 0.1);
        this.ring(RING_ROAD, cause, e.x, 0.2, 0, 3, 120, 1.3, 1.1, 0.22);
        this.ring(RING_FACING, view.hull, e.x, y, 0, 2, 38, 0.6, 1.6);
        break;
      }
      default:
        break;
    }
  }

  /** Шлейф: частицы срываются с сопел и уносятся дорогой к зрителю. */
  trail(view: View): void {
    const { state, colors } = view;
    if (view.dt <= 0 || !state.player.alive) return;
    const geo = SHIP_GEOMETRY[view.skin.shape];
    this.trailDebt += view.dt * (view.reduced ? 45 : 120 + 70 * view.overdrive);
    const main = this.colorId(colors.trail);
    const hot = this.colorId(view.hull);
    // Сопло на экране ниже центра корабля; в мире это чуть «позади» линии удара.
    const depth = (SHIP_SIZE * Ship.tilt(view)) / view.flat;
    const bank = state.player.bank;
    while (this.trailDebt >= 1) {
      this.trailDebt -= 1;
      const e = geo.engines[Math.floor(Math.random() * geo.engines.length)];
      const jitter = Math.random() - 0.5;
      this.spawn(
        PIXEL,
        Math.random() < 0.25 ? hot : main,
        view.shipX + e[0] * SHIP_SIZE + jitter * 1.4,
        SHIP_HOVER * 0.7,
        -e[1] * depth - Math.random() * 2,
        -bank * 26 + jitter * 16,
        3 + 10 * Math.random(),
        -view.speed * (0.42 + 0.2 * Math.random()),
        0.34 + 0.34 * Math.random(),
        0.34 + 0.4 * Math.random(),
        1.1,
        6,
      );
    }
  }

  // ─── Кадр ─────────────────────────────────────────────────────────────────

  update(dt: number): void {
    if (dt <= 0) return;
    const d = this.data;
    let i = 0;
    while (i < this.count) {
      const o = i * STRIDE;
      d[o + LIFE] -= dt;
      if (d[o + LIFE] <= 0 || d[o + Z] < Z_BEHIND) {
        // Место умершей занимает последняя — массив остаётся плотным.
        this.count -= 1;
        d.copyWithin(o, this.count * STRIDE, this.count * STRIDE + STRIDE);
        continue;
      }
      const keep = Math.exp(-d[o + DRAG] * dt);
      d[o + VX] *= keep;
      d[o + VY] = d[o + VY] * keep - d[o + GRAVITY] * dt;
      d[o + VZ] *= keep;
      d[o + X] += d[o + VX] * dt;
      d[o + Y] += d[o + VY] * dt;
      d[o + Z] += d[o + VZ] * dt;
      if (d[o + Y] < 0) {
        // Отскок от полотна с потерей энергии.
        d[o + Y] = -d[o + Y] * 0.4;
        d[o + VY] = -d[o + VY] * 0.42;
      }
      i += 1;
    }
    const r = this.rings;
    for (let k = 0; k < RINGS; k++) {
      const o = k * RING_STRIDE;
      if (r[o + R_SPAN] <= 0) continue;
      r[o + R_AGE] += dt;
      if (r[o + R_AGE] >= r[o + R_SPAN]) r[o + R_SPAN] = 0;
    }
    for (const label of this.labels) {
      if (!label.sprite) continue;
      label.age += dt;
      // Всплывает на полторы своей высоты, замедляясь.
      label.lift += label.sprite.h * 1.1 * (dt / label.span) * (1.6 - 1.2 * (label.age / label.span));
      if (label.age >= label.span) label.sprite = null;
    }
  }

  draw(view: View): void {
    const ctx = view.ctx;
    ctx.globalCompositeOperation = 'source-over';
    this.drawRings(view);
    this.drawStreaks(view);
    this.drawLabels(view);
    ctx.globalCompositeOperation = 'lighter';
    this.drawPixels(view);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Пиксели рисуются в координатах холста: ровные квадраты дешевле повёрнутых. */
  private drawPixels(view: View): void {
    const { ctx, cam } = view;
    const d = this.data;
    const n = this.count;
    const px = ((view.kx + view.ky) / 2) * view.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let c = 0; c <= this.colors.length; c++) {
      // Последний проход — белая сердцевина молодых частиц: они «остывают» до своего цвета.
      const white = c === this.colors.length;
      let styled = false;
      for (let i = 0; i < n; i++) {
        const o = i * STRIDE;
        if (d[o + KIND] !== PIXEL || (!white && d[o + COLOR] !== c)) continue;
        const f = d[o + LIFE] / d[o + SPAN];
        if (white && f < 0.6) continue;
        const p = project(cam, d[o + X], d[o + Y], d[o + Z], this.p);
        const x = devX(view, p.x, p.y);
        const y = devY(view, p.y);
        const size = Math.max(1, d[o + SIZE] * p.scale * px * (0.35 + 0.65 * f));
        if (!styled) {
          ctx.fillStyle = white ? '#ffffff' : this.colors[c];
          styled = true;
        }
        // Квадраты встают на целые пиксели: так их заливка идёт по быстрому пути.
        if (white) {
          const inner = Math.max(1, Math.round(size * 0.6));
          ctx.globalAlpha = (f - 0.6) * 2.2;
          ctx.fillRect(Math.round(x - inner / 2), Math.round(y - inner / 2), inner, inner);
          continue;
        }
        const a = Math.min(1, f * 1.8);
        const side = Math.round(size);
        if (f > 0.45) {
          // Ореол — только у молодых, ещё ярких частиц.
          const wide = side * 2 + 2;
          ctx.globalAlpha = a * 0.16;
          ctx.fillRect(Math.round(x - wide / 2), Math.round(y - wide / 2), wide, wide);
        }
        ctx.globalAlpha = a;
        ctx.fillRect(Math.round(x - side / 2), Math.round(y - side / 2), side, side);
      }
    }
  }

  /** Искры и осколки — отрезки, по одному пути на цвет. */
  private drawStreaks(view: View): void {
    const { ctx, cam } = view;
    const d = this.data;
    const n = this.count;
    useWorld(view);
    ctx.lineCap = 'round';
    for (let c = 0; c < this.colors.length; c++) {
      let open = false;
      for (let i = 0; i < n; i++) {
        const o = i * STRIDE;
        const kind = d[o + KIND];
        if (kind === PIXEL || d[o + COLOR] !== c) continue;
        if (!open) {
          ctx.beginPath();
          open = true;
        }
        const f = d[o + LIFE] / d[o + SPAN];
        const p = project(cam, d[o + X], d[o + Y], d[o + Z], this.p);
        if (kind === SPARK) {
          // Штрих вдоль скорости: чем быстрее искра, тем он длиннее.
          const q = project(cam, d[o + X] - d[o + VX] * 0.04, d[o + Y] - d[o + VY] * 0.04, d[o + Z] - d[o + VZ] * 0.04, this.q);
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
        } else {
          const a = d[o + SPIN] + (1 - f) * 9 * (d[o + SPIN] > Math.PI ? 1 : -1);
          const len = d[o + SIZE] * p.scale * 0.5 * (0.4 + 0.6 * f);
          const dx = Math.cos(a) * len;
          const dy = Math.sin(a) * len;
          ctx.moveTo(p.x - dx, p.y - dy);
          ctx.lineTo(p.x + dx, p.y + dy);
        }
      }
      if (!open) continue;
      ctx.strokeStyle = this.colors[c];
      ctx.lineWidth = Math.max(1.5, 4.2 * view.line);
      ctx.globalAlpha = 0.25;
      ctx.stroke();
      ctx.lineWidth = Math.max(0.9, 1.5 * view.line);
      ctx.globalAlpha = 0.95;
      ctx.stroke();
    }
  }

  private drawRings(view: View): void {
    const { ctx, cam } = view;
    const r = this.rings;
    useWorld(view);
    for (let k = 0; k < RINGS; k++) {
      const o = k * RING_STRIDE;
      if (r[o + R_SPAN] <= 0 || r[o + R_AGE] < 0) continue;
      const f = r[o + R_AGE] / r[o + R_SPAN];
      const p = project(cam, r[o + R_X], r[o + R_Y], r[o + R_Z], this.p);
      const radius = lerp(r[o + R_FROM], r[o + R_TO], easeOutCubic(f)) * p.scale;
      if (radius <= 0.5) continue;
      const fade = (1 - f) * (1 - f);
      const color = this.colors[r[o + R_COLOR]] ?? '#ffffff';
      const kind = r[o + R_KIND];
      if (kind === RING_GLOW) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = fade;
        view.sprites.glow(view, color, true, p.x, p.y, radius);
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      ctx.beginPath();
      if (kind === RING_ROAD) ctx.ellipse(p.x, p.y, radius, radius * view.flat * (p.scale / cam.unit), 0, 0, TAU);
      else ctx.arc(p.x, p.y, radius, 0, TAU);
      // Один штрих без ореола: большое кольцо — самый дорогой контур в кадре.
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, r[o + R_WIDTH] * p.scale * 0.42 * (1 - 0.6 * f));
      ctx.globalAlpha = fade;
      ctx.stroke();
    }
  }

  private drawLabels(view: View): void {
    const { ctx, cam } = view;
    for (const label of this.labels) {
      const sprite = label.sprite;
      if (!sprite) continue;
      const f = label.age / label.span;
      const p = project(cam, label.x, label.y, label.z, this.p);
      const pop = view.reduced ? 1 : easeOutBack(Math.min(1, label.age / 0.16));
      // Надпись не выходит за края холста.
      const x = clamp(p.x, sprite.w / 2 - sprite.h * 0.3, cam.cssW - sprite.w / 2 + sprite.h * 0.3);
      const y = p.y - label.lift;
      ctx.globalAlpha = clamp((1 - f) * 2.6, 0, 1);
      if (pop === 1) {
        // Устоявшаяся надпись ставится на целые пиксели холста — без пересчёта спрайта.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(sprite.canvas, Math.round(devX(view, x, y) - sprite.canvas.width / 2), Math.round(devY(view, y) - sprite.canvas.height / 2));
      } else {
        useWorld(view);
        ctx.drawImage(sprite.canvas, x - (sprite.w * pop) / 2, y - (sprite.h * pop) / 2, sprite.w * pop, sprite.h * pop);
      }
    }
  }

  /** OVERDRIVE: светящиеся штрихи проносятся по краям экрана мимо камеры. */
  drawSpeedLines(view: View): void {
    if (view.overdrive < 0.02 || view.reduced) return;
    const { ctx, cam, colors } = view;
    useWorld(view);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < SPEED_LINES; i++) {
      const hx = hash01(i * 3 + 1);
      const hy = hash01(i * 3 + 2);
      const hp = hash01(i * 3 + 3);
      const side = i % 2 === 0 ? 1 : -1;
      const x = 50 + side * (64 + 170 * hx);
      const y = 2 + 46 * hy * hy;
      const cycle = (view.now * (1.5 + hp) + hp * 7) % 1;
      const head = 330 - cycle * 450;
      const p = project(cam, x, y, head, this.p);
      const q = project(cam, x, y, head + 40 + 70 * hx, this.q);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    // Один проход: длинные косые штрихи — дорогая фигура, ореол им не нужен.
    ctx.strokeStyle = this.speedTint(colors.accent3);
    ctx.lineWidth = Math.max(1, 1.6 * view.line);
    ctx.globalAlpha = 0.7 * view.overdrive;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Цвет скоростных линий: акцент темы, выбеленный наполовину. */
  private speedTint(accent: string): string {
    if (this.tintOf !== accent) {
      this.tintOf = accent;
      this.tint = lighten(accent, 0.55);
    }
    return this.tint;
  }
}
