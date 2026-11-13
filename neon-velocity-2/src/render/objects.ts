/**
 * Объекты на дороге: каркасные кубы, пилы, лазерные ворота и кристаллы-сферы,
 * их блики на полотне и метки прилёта на линии удара. Всё проецируется через
 * camera.ts из тех же чистых функций движения, что и в симуляции, — нарисованное
 * совпадает с хитбоксами.
 *
 * Свечение — двойной штрих (широкий тусклый + узкая яркая сердцевина) и
 * спрайты ореолов; shadowBlur в кадре не используется. Штрихи идут обычным
 * наложением (на тёмной сцене оно неотличимо от сложения, а растеризуется
 * втрое быстрее), режим 'lighter' оставлен спрайтам и бликам.
 */
import { GAME, WORLD } from '../core/config';
import { clamp, darken, lighten, mixColor, smoothstep, TAU } from '../core/math';
import { crystalRadius, crystalX, depthAt, obstacleX, yawAt } from '../core/motion';
import { mod } from '../core/timing';
import type { Crystal, Obstacle, ThemeColors } from '../core/types';
import { depthScale, project, type Projected } from './camera';
import { blit, hash01, useWorld, type View } from './view';

/** Объекты проявляются из дымки на дальних 15 % пути. */
const FADE_FROM = WORLD.zFar * 0.85;
/** Дальше этой глубины блик на полотне не рисуется. */
const GLINT_FAR = WORLD.zFar * 0.7;
/** Ближе этого объект уже за нижним краем экрана. */
const Z_GONE = -62;
/** Высота луча ворот и стоек, единицы мира. */
const BEAM_Y = 2.6;
const GATE_POST_Y = 6.4;
const GATE_POST_X = 1.6;
/** Высота, на которой парит кристалл. */
const HOVER = 4.6;
/** Нарисованный кристалл чуть крупнее радиуса подбора — так он читается издалека. */
const CRYSTAL_DRAW = 1.3;
const SAW_TEETH = 12;
/** Метка прилёта: половина толщины полосы на линии удара, единицы мира. */
const MARK_DEPTH = 1.15;
/** Сколько точек в пунктире траектории зигзага. */
const PATH_STEPS = 12;
const DASH: number[] = [5, 6];
const NO_DASH: number[] = [];
/** Объекты мельче этого масштаба рисуются упрощённо: деталей там не видно. */
const LOD_NEAR = 0.42;
/** А мельче этого — совсем схематично. */
const LOD_FAR = 0.3;

interface Palette {
  cube: string;
  cubeCore: string;
  cubeBody: string;
  cubeTop: string;
  saw: string;
  sawCore: string;
  sawBody: string;
  laser: string;
  laserCore: string;
  safe: string;
  safeCore: string;
  crystal: string;
  crystalCore: string;
  crystalBody: string;
  rare: string;
  rareCore: string;
  rareBody: string;
}

function makePalette(c: ThemeColors): Palette {
  return {
    cube: c.cube,
    cubeCore: lighten(c.cube, 0.55),
    cubeBody: mixColor(c.bg, c.cube, 0.2),
    cubeTop: mixColor(c.bg, c.cube, 0.5),
    saw: c.saw,
    sawCore: lighten(c.saw, 0.55),
    sawBody: mixColor(c.bg, c.saw, 0.16),
    laser: c.laser,
    laserCore: lighten(c.laser, 0.82),
    // Проход в воротах — почти белый: «чисто» читается в любой теме, даже где бортик и луч близки по тону.
    safe: lighten(c.rail, 0.5),
    safeCore: '#ffffff',
    crystal: c.crystal,
    crystalCore: lighten(c.crystal, 0.7),
    crystalBody: darken(c.crystal, 0.35),
    rare: c.crystalRare,
    rareCore: lighten(c.crystalRare, 0.7),
    rareBody: darken(c.crystalRare, 0.3),
  };
}

export class Objects {
  private palette: Palette | null = null;
  private paletteOf: ThemeColors | null = null;
  private readonly p: Projected = { x: 0, y: 0, scale: 0 };
  /** Вершины основания куба на экране и высоты верхних вершин. */
  private readonly bx = new Float64Array(4);
  private readonly by = new Float64Array(4);
  private readonly ty = new Float64Array(4);

  private colorsFor(view: View): Palette {
    if (!this.palette || this.paletteOf !== view.colors) {
      this.palette = makePalette(view.colors);
      this.paletteOf = view.colors;
    }
    return this.palette;
  }

  /** 0 у дальней границы, 1 после первых 15 % пути. */
  private static fadeIn(z: number): number {
    return 1 - smoothstep(FADE_FROM, WORLD.zFar, z);
  }

  // ─── Полотно: блики, траектории, метки прилёта ────────────────────────────

  drawGround(view: View): void {
    const { ctx, state } = view;
    const pal = this.colorsFor(view);
    useWorld(view);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = state.crystals.length - 1; i >= 0; i--) {
      const c = state.crystals[i];
      if (c.state !== 'live') continue;
      const z = depthAt(c.arriveTick, c.approachTicks, view.t);
      // Совсем вдали блик меньше пикселя.
      if (z > GLINT_FAR || z < Z_GONE) continue;
      const p = project(view.cam, crystalX(c, view.t, view.alpha), 0, z, this.p);
      const r = crystalRadius(c.rare) * 1.7 * p.scale;
      ctx.globalAlpha = 0.42;
      blit(ctx, view.sprites.halo(c.rare ? pal.rare : pal.crystal), p.x, p.y, r, Math.max(1, r * view.flat * depthScale(z) * 1.5));
    }

    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      if (o.destroyed) continue;
      const z = depthAt(o.arriveTick, o.approachTicks, view.t);
      if (o.kind === 'laser' || z > GLINT_FAR || z < Z_GONE) continue;
      const p = project(view.cam, obstacleX(o, view.t), 0, z, this.p);
      const r = o.halfW * 1.75 * p.scale;
      ctx.globalAlpha = 0.4;
      blit(ctx, view.sprites.halo(o.kind === 'cube' ? pal.cube : pal.saw), p.x, p.y, r, Math.max(1, r * view.flat * depthScale(z) * 1.6));
    }

    ctx.globalCompositeOperation = 'source-over';
    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      if (o.destroyed || o.resolved) continue;
      const z = depthAt(o.arriveTick, o.approachTicks, view.t);
      if (z > WORLD.zFar || z <= 0) continue;
      const color = o.kind === 'cube' ? pal.cube : o.kind === 'saw' ? pal.saw : pal.laser;
      if (o.sway) this.swayPath(view, o, z, Objects.fadeIn(z), color);
      this.marker(view, o, z, pal, color);
    }
    ctx.globalAlpha = 1;
  }

  /** Пунктир по полотну: путь, которым «виляющий» объект придёт к своей метке. */
  private swayPath(view: View, o: Obstacle, z: number, fade: number, color: string): void {
    const { ctx, cam } = view;
    const near = 1 - z / WORLD.zFar;
    ctx.beginPath();
    for (let k = 0; k <= PATH_STEPS; k++) {
      const tk = view.t + ((o.arriveTick - view.t) * k) / PATH_STEPS;
      const p = project(cam, obstacleX(o, tk), 0, depthAt(o.arriveTick, o.approachTicks, tk), this.p);
      if (k === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.setLineDash(DASH);
    // Штрихи бегут к кораблю вместе с объектом.
    ctx.lineDashOffset = view.reduced ? 0 : view.t * 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.1, 1.8 * view.line);
    ctx.globalAlpha = fade * (0.34 + 0.5 * near);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
  }

  /**
   * Метка прилёта на линии удара: полоса шириной в хитбокс там, где объект
   * окажется, пересекая корабль. Для ворот — подсвеченный проход между
   * двумя «запретными» полосами. Яркость растёт по мере приближения.
   */
  private marker(view: View, o: Obstacle, z: number, pal: Palette, color: string): void {
    const { ctx, cam } = view;
    const near = 1 - z / WORLD.zFar;
    let power = smoothstep(0.18, 0.95, near);
    if (power <= 0.01) return;
    // Последние мгновения перед прилётом метка мигает.
    const ticksLeft = o.arriveTick - view.t;
    if (ticksLeft < 36 && !view.reduced) power *= 0.72 + 0.28 * Math.cos(ticksLeft * 0.55);
    const zs0 = depthScale(MARK_DEPTH);
    const zs1 = depthScale(-MARK_DEPTH);
    const y0 = cam.horizonY + view.span * zs0;
    const y1 = cam.horizonY + view.span * zs1;
    const mid = WORLD.roadW / 2;

    if (o.kind === 'laser') {
      const gl = o.x - o.halfW;
      const gr = o.x + o.halfW;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.1 + 0.42 * power;
      ctx.beginPath();
      this.strip(ctx, cam.cx, cam.unit, 0 - mid, gl - mid, y0, y1, zs0, zs1);
      this.strip(ctx, cam.cx, cam.unit, gr - mid, WORLD.roadW - mid, y0, y1, zs0, zs1);
      ctx.fill();
      // Проход: скобы по краям и мягкая подсветка между ними.
      const xl = cam.cx + (gl - mid) * cam.unit;
      const xr = cam.cx + (gr - mid) * cam.unit;
      const tick = (2.2 + 1.6 * power) * cam.unit;
      const arm = Math.min(o.halfW * 0.45, 3.2) * cam.unit;
      ctx.fillStyle = pal.safe;
      ctx.globalAlpha = 0.05 + 0.13 * power;
      ctx.fillRect(xl, cam.lineY - tick, xr - xl, tick);
      ctx.beginPath();
      ctx.moveTo(xl + arm, cam.lineY - tick);
      ctx.lineTo(xl, cam.lineY - tick);
      ctx.lineTo(xl, cam.lineY);
      ctx.moveTo(xr - arm, cam.lineY - tick);
      ctx.lineTo(xr, cam.lineY - tick);
      ctx.lineTo(xr, cam.lineY);
      this.glowStroke(ctx, pal.safe, pal.safeCore, (1.4 + 1.2 * power) * view.line, 0.25 + 0.75 * power);
      return;
    }

    // Проекция хитбокса на линию: у куба — повёрнутый квадрат в момент прилёта.
    const half =
      o.kind === 'cube'
        ? o.halfW * GAME.hitbox.cube * (Math.abs(Math.cos(o.yaw0)) + Math.abs(Math.sin(o.yaw0)))
        : o.halfW * GAME.hitbox.saw;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.2 + 0.7 * power;
    ctx.beginPath();
    this.strip(ctx, cam.cx, cam.unit, o.x - half - mid, o.x + half - mid, y0, y1, zs0, zs1);
    ctx.fill();
    const xl = cam.cx + (o.x - half - mid) * cam.unit;
    const xr = cam.cx + (o.x + half - mid) * cam.unit;
    const tick = (1.2 + 2.2 * power) * cam.unit;
    ctx.beginPath();
    ctx.moveTo(xl, cam.lineY - tick);
    ctx.lineTo(xl, cam.lineY);
    ctx.lineTo(xr, cam.lineY);
    ctx.lineTo(xr, cam.lineY - tick);
    this.glowStroke(ctx, color, o.kind === 'cube' ? pal.cubeCore : pal.sawCore, (1.2 + 1.3 * power) * view.line, 0.2 + 0.8 * power);
  }

  /** Плоская полоса на полотне между x0 и x1 (от оси дороги) на глубинах с масштабами s0, s1. */
  private strip(ctx: CanvasRenderingContext2D, cx: number, unit: number, x0: number, x1: number, y0: number, y1: number, s0: number, s1: number): void {
    ctx.moveTo(cx + x0 * unit * s0, y0);
    ctx.lineTo(cx + x1 * unit * s0, y0);
    ctx.lineTo(cx + x1 * unit * s1, y1);
    ctx.lineTo(cx + x0 * unit * s1, y1);
    ctx.closePath();
  }

  /** Неоновая линия по текущему пути: широкий ореол и яркая сердцевина. */
  private glowStroke(ctx: CanvasRenderingContext2D, color: string, core: string, width: number, alpha: number): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * 3.4;
    ctx.globalAlpha = alpha * 0.28;
    ctx.stroke();
    ctx.strokeStyle = core;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.stroke();
  }

  // ─── Объекты от дальних к ближним ─────────────────────────────────────────

  /**
   * Нарисовать объекты с глубиной в [zMin, zMax), от дальних к ближним. Оба
   * массива симуляции упорядочены по прилёту, поэтому сортировка не нужна —
   * достаточно слить их с конца.
   */
  drawRange(view: View, zMin: number, zMax: number): void {
    const { ctx, state } = view;
    const pal = this.colorsFor(view);
    useWorld(view);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const obstacles = state.obstacles;
    const crystals = state.crystals;
    let i = obstacles.length - 1;
    let j = crystals.length - 1;
    while (i >= 0 || j >= 0) {
      const zo = i >= 0 ? depthAt(obstacles[i].arriveTick, obstacles[i].approachTicks, view.t) : -Infinity;
      const zc = j >= 0 ? depthAt(crystals[j].arriveTick, crystals[j].approachTicks, view.t) : -Infinity;
      if (zo >= zc) {
        const o = obstacles[i--];
        if (o.destroyed || zo < zMin || zo >= zMax || zo > WORLD.zFar || zo < Z_GONE) continue;
        const fade = Objects.fadeIn(zo);
        if (o.kind === 'cube') this.cube(view, o, zo, fade, pal);
        else if (o.kind === 'saw') this.saw(view, o, zo, fade, pal);
        else this.laser(view, o, zo, fade, pal);
      } else {
        const c = crystals[j--];
        if (c.state === 'taken' || zc < zMin || zc >= zMax || zc > WORLD.zFar || zc < Z_GONE) continue;
        this.crystal(view, c, zc, Objects.fadeIn(zc), pal);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Настоящий каркасный куб: 8 вершин через project, основание совпадает с хитбоксом. */
  private cube(view: View, o: Obstacle, z: number, fade: number, pal: Palette): void {
    const { ctx, cam } = view;
    const { bx, by, ty } = this;
    const h = o.halfW;
    const yaw = yawAt(o, view.t);
    const c = Math.cos(yaw) * h;
    const s = Math.sin(yaw) * h;
    const ox = obstacleX(o, view.t);
    for (let k = 0; k < 4; k++) {
      // Углы квадрата (±h, ±h), повёрнутые на yaw.
      const lx = k === 0 || k === 3 ? 1 : -1;
      const lz = k < 2 ? 1 : -1;
      const p = project(cam, ox + lx * c - lz * s, 0, z + lx * s + lz * c, this.p);
      bx[k] = p.x;
      by[k] = p.y;
      ty[k] = p.y - 2 * h * p.scale;
    }
    const near = depthScale(z);

    ctx.globalCompositeOperation = 'source-over';
    if (near > LOD_NEAR) {
      // Тело: тёмные грани скрывают сетку за кубом, иначе каркас теряется на ней.
      ctx.fillStyle = pal.cubeBody;
      ctx.globalAlpha = fade * 0.8;
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const n = (k + 1) & 3;
        // Все грани обходятся в одну сторону — заливка объединяет их, а не вычитает.
        const a = bx[n] >= bx[k] ? k : n;
        const b = a === k ? n : k;
        ctx.moveTo(bx[a], by[a]);
        ctx.lineTo(bx[b], by[b]);
        ctx.lineTo(bx[b], ty[b]);
        ctx.lineTo(bx[a], ty[a]);
        ctx.closePath();
      }
      ctx.fill();
      // Верхняя грань светлее: куб читается как объём.
      ctx.beginPath();
      ctx.moveTo(bx[0], ty[0]);
      for (let k = 1; k < 4; k++) ctx.lineTo(bx[k], ty[k]);
      ctx.closePath();
      ctx.fillStyle = pal.cubeTop;
      ctx.globalAlpha = fade * (0.7 + 0.3 * view.beat);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(bx[0], by[0]);
    for (let k = 1; k < 4; k++) ctx.lineTo(bx[k], by[k]);
    ctx.closePath();
    ctx.moveTo(bx[0], ty[0]);
    for (let k = 1; k < 4; k++) ctx.lineTo(bx[k], ty[k]);
    ctx.closePath();
    for (let k = 0; k < 4; k++) {
      ctx.moveTo(bx[k], by[k]);
      ctx.lineTo(bx[k], ty[k]);
    }
    if (near > LOD_NEAR) {
      this.glowStroke(ctx, pal.cube, pal.cubeCore, Math.max(0.9, 2.3 * near * view.line), fade);
    } else {
      // Вдали ореол штриха тоньше пары пикселей — хватает яркой сердцевины.
      ctx.strokeStyle = pal.cubeCore;
      ctx.lineWidth = Math.max(0.9, 2.3 * near * view.line);
      ctx.globalAlpha = fade;
      ctx.stroke();
    }
  }

  /** Пила: диск поперёк дороги, наполовину утопленный в полотно, с зубьями и искрами. */
  private saw(view: View, o: Obstacle, z: number, fade: number, pal: Palette): void {
    const { ctx, cam } = view;
    const p = project(cam, obstacleX(o, view.t), 0, z, this.p);
    const x = p.x;
    const y = p.y;
    const r = o.halfW * p.scale;
    const near = depthScale(z);
    // Пила без заданного вращения всё равно крутится — в сторону, зависящую от id.
    const dir = o.yawRate !== 0 ? Math.sign(o.yawRate) : o.id % 2 === 0 ? 1 : -1;
    const angle = o.yawRate !== 0 ? yawAt(o, view.t) : view.t * 0.085 * dir;
    const pitch = TAU / SAW_TEETH;
    const lead = mod(angle, pitch);
    const inner = 0.83;
    const r0 = r * (inner + (1 - inner) * (lead / pitch));

    // Зубчатая кромка над дорогой: от правой точки касания к левой.
    ctx.beginPath();
    ctx.moveTo(x + r0, y);
    for (let a = pitch - lead; a < Math.PI; a += pitch) {
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      ctx.lineTo(x + r * ca, y - r * sa);
      ctx.lineTo(x + r * inner * ca, y - r * inner * sa);
    }
    ctx.lineTo(x - r0, y);
    ctx.closePath();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = pal.sawBody;
    ctx.globalAlpha = fade * 0.9;
    ctx.fill();
    if (near > LOD_NEAR) {
      this.glowStroke(ctx, pal.saw, pal.sawCore, Math.max(0.9, 2.1 * near * view.line), fade);
    } else {
      ctx.strokeStyle = pal.sawCore;
      ctx.lineWidth = Math.max(0.9, 2.1 * near * view.line);
      ctx.globalAlpha = fade;
      ctx.stroke();
    }

    // Диск: кольцо, ступица и вращающиеся прорези.
    if (near > LOD_NEAR) {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.64, Math.PI, TAU);
      ctx.moveTo(x - r * 0.2, y);
      ctx.arc(x, y, r * 0.2, Math.PI, TAU);
      for (let k = 0; k < 4; k++) {
        const a = mod(angle + (k * TAU) / 4, TAU);
        const sa = Math.sin(a);
        if (sa < 0.08) continue;
        const ca = Math.cos(a);
        ctx.moveTo(x + r * 0.28 * ca, y - r * 0.28 * sa);
        ctx.lineTo(x + r * 0.56 * ca, y - r * 0.56 * sa);
      }
      ctx.strokeStyle = pal.sawCore;
      ctx.lineWidth = Math.max(0.8, 1.3 * near * view.line);
      ctx.globalAlpha = fade * 0.75;
      ctx.stroke();
    }

    // Раскалённая прорезь в полотне.
    ctx.beginPath();
    ctx.moveTo(x - r * 1.08, y);
    ctx.lineTo(x + r * 1.08, y);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(0.8, 1.7 * near * view.line);
    ctx.globalAlpha = fade * 0.9;
    ctx.stroke();

    if (near > LOD_FAR) {
      // Искры из-под зубьев: летят вверх и в сторону вращения, по дуге.
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const side = k < 4 ? 1 : -1;
        const seed = o.id * 16 + k;
        const life = view.reduced ? hash01(seed) : mod(view.t * (0.045 + 0.03 * hash01(seed + 5)) + hash01(seed), 1);
        const lift = 0.5 + 1.1 * hash01(seed + 9);
        const reach = r * (0.25 + 0.9 * life);
        const lean = side * 0.45 + dir * 0.35;
        const sx = x + side * r + lean * reach;
        const sy = y - reach * lift * (1 - 0.6 * life);
        const len = r * 0.22 * (1 - life);
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - lean * len, sy + len * lift);
      }
      ctx.lineWidth = Math.max(0.8, 1.4 * near * view.line);
      ctx.globalAlpha = fade * 0.85;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = fade * 0.9;
    view.sprites.glow(view, pal.saw, true, x - r, y, r * 0.42);
    view.sprites.glow(view, pal.saw, true, x + r, y, r * 0.42);
  }

  /** Лазерные ворота: стойки-излучатели, луч с ярким ядром и размеченный проход. */
  private laser(view: View, o: Obstacle, z: number, fade: number, pal: Palette): void {
    const { ctx, cam } = view;
    const road = project(cam, WORLD.roadW / 2, 0, z, this.p);
    const scale = road.scale;
    const yRoad = road.y;
    const near = depthScale(z);
    const gx = obstacleX(o, view.t);
    const xl = road.x - (WORLD.roadW / 2 + GATE_POST_X) * scale;
    const xr = road.x + (WORLD.roadW / 2 + GATE_POST_X) * scale;
    const gl = road.x + (gx - o.halfW - WORLD.roadW / 2) * scale;
    const gr = road.x + (gx + o.halfW - WORLD.roadW / 2) * scale;
    const yBeam = yRoad - BEAM_Y * scale;
    const yTop = yRoad - GATE_POST_Y * scale;
    const flicker = view.reduced ? 1 : 0.88 + 0.12 * Math.sin(view.now * 47 + o.id * 1.7);

    ctx.globalCompositeOperation = 'source-over';
    // Завеса под лучом и отсвет на полотне: ворота читаются как стена, а не как нить.
    ctx.fillStyle = pal.laser;
    ctx.globalAlpha = fade * 0.13;
    ctx.fillRect(xl, yBeam, gl - xl, yRoad - yBeam);
    ctx.fillRect(gr, yBeam, xr - gr, yRoad - yBeam);
    const glint = Math.max(1, 1.1 * scale);
    ctx.globalAlpha = fade * 0.3;
    ctx.fillRect(xl, yRoad - glint / 2, gl - xl, glint);
    ctx.fillRect(gr, yRoad - glint / 2, xr - gr, glint);

    // Подсветка прохода на полотне.
    const depth = 7;
    const s0 = depthScale(z + depth);
    const s1 = depthScale(z - depth);
    ctx.fillStyle = pal.safe;
    ctx.globalAlpha = fade * (0.1 + 0.08 * view.beat);
    ctx.beginPath();
    this.strip(
      ctx,
      cam.cx,
      cam.unit,
      gx - o.halfW - WORLD.roadW / 2,
      gx + o.halfW - WORLD.roadW / 2,
      cam.horizonY + view.span * s0,
      cam.horizonY + view.span * s1,
      s0,
      s1,
    );
    ctx.fill();

    // Луч: ореол, цвет, раскалённое ядро.
    ctx.beginPath();
    ctx.moveTo(xl, yBeam);
    ctx.lineTo(gl, yBeam);
    ctx.moveTo(gr, yBeam);
    ctx.lineTo(xr, yBeam);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = pal.laser;
    ctx.lineWidth = Math.max(2.4, 11 * near * view.line);
    ctx.globalAlpha = fade * 0.26 * flicker;
    ctx.stroke();
    ctx.lineWidth = Math.max(1.4, 4.6 * near * view.line);
    ctx.globalAlpha = fade * 0.8 * flicker;
    ctx.stroke();
    ctx.strokeStyle = pal.laserCore;
    ctx.lineWidth = Math.max(0.8, 1.7 * near * view.line);
    ctx.globalAlpha = fade;
    ctx.stroke();
    ctx.lineCap = 'round';

    // Стойки-излучатели по краям дороги.
    ctx.beginPath();
    ctx.moveTo(xl, yRoad);
    ctx.lineTo(xl, yTop);
    ctx.moveTo(xr, yRoad);
    ctx.lineTo(xr, yTop);
    this.glowStroke(ctx, pal.laser, pal.laserCore, Math.max(1, 2.6 * near * view.line), fade);

    // Скобы прохода: «сюда можно».
    const arm = Math.min(o.halfW * 0.4, 3) * scale;
    const yBracket = yRoad - (BEAM_Y + 2.4) * scale;
    ctx.beginPath();
    ctx.moveTo(gl + arm, yBracket);
    ctx.lineTo(gl, yBracket);
    ctx.lineTo(gl, yRoad);
    ctx.lineTo(gl + arm, yRoad);
    ctx.moveTo(gr - arm, yBracket);
    ctx.lineTo(gr, yBracket);
    ctx.lineTo(gr, yRoad);
    ctx.lineTo(gr - arm, yRoad);
    this.glowStroke(ctx, pal.safe, pal.safeCore, Math.max(0.9, 2 * near * view.line), fade);

    // Огни излучателей и срезы луча у прохода.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = fade;
    view.sprites.glow(view, pal.laser, true, xl, yBeam, 2.3 * scale * flicker);
    view.sprites.glow(view, pal.laser, true, xr, yBeam, 2.3 * scale * flicker);
    view.sprites.glow(view, pal.laser, true, gl, yBeam, 1.5 * scale * flicker);
    view.sprites.glow(view, pal.laser, true, gr, yBeam, 1.5 * scale * flicker);
  }

  /** Сфера — гранёный кристалл: бипирамида с вращающимся «экватором», ядро и ореол. */
  private crystal(view: View, c: Crystal, z: number, fade: number, pal: Palette): void {
    const { ctx, cam } = view;
    const live = c.state === 'live';
    const bob = view.reduced ? 0 : 0.45 * Math.sin(view.now * 2.6 + c.id * 1.3);
    const p = project(cam, crystalX(c, view.t, view.alpha), HOVER + bob, z, this.p);
    const x = p.x;
    const y = p.y;
    const r = crystalRadius(c.rare) * CRYSTAL_DRAW * p.scale * (1 + 0.08 * view.beat);
    const near = depthScale(z);
    const color = c.rare ? pal.rare : pal.crystal;
    const core = c.rare ? pal.rareCore : pal.crystalCore;
    // Упущенная сфера гаснет и уходит за корабль.
    const alpha = live ? fade : fade * 0.3;

    ctx.globalCompositeOperation = 'source-over';
    if (live && (c.pull !== 0 || c.prevPull !== 0)) this.magnetArc(view, x, y, alpha);

    const top = y - r * 1.28;
    const bottom = y + r * 1.28;
    const wide = r * 0.86;
    const tilt = r * 0.26;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + wide, y);
    ctx.lineTo(x, bottom);
    ctx.lineTo(x - wide, y);
    ctx.closePath();
    if (near <= LOD_NEAR) {
      // Вдали граней не разглядеть — хватает светлого силуэта и свечения.
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha * 0.85;
      ctx.fill();
    } else {
      ctx.fillStyle = c.rare ? pal.rareBody : pal.crystalBody;
      ctx.globalAlpha = alpha * 0.6;
      ctx.fill();
      // Свечение кристаллу даёт спрайт ядра, поэтому грани обводятся одним штрихом.
      ctx.strokeStyle = core;
      ctx.lineWidth = Math.max(0.8, (c.rare ? 1.9 : 1.6) * near * view.line);
      ctx.globalAlpha = alpha;
      // Грани: вершина и низ соединены с четырьмя точками вращающегося экватора,
      // сам экватор — ломаная через них (кривые растеризатору обходятся дороже).
      const spin = view.reduced ? c.id : view.now * (c.rare ? 2.6 : 1.9) + c.id * 0.9;
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      let frontX = x;
      let frontY = y;
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        // Поворот на четверть оборота: (cos, sin) → (−sin, cos).
        const ca = k === 0 ? cs : k === 1 ? -sn : k === 2 ? -cs : sn;
        const sa = k === 0 ? sn : k === 1 ? cs : k === 2 ? -sn : -cs;
        const ex = x + ca * wide;
        const ey = y + sa * tilt;
        if (k === 0) ctx.moveTo(ex, ey);
        else ctx.lineTo(ex, ey);
        if (ey > frontY) {
          frontX = ex;
          frontY = ey;
        }
      }
      ctx.closePath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + cs * wide, y + sn * tilt);
      ctx.lineTo(x, bottom);
      ctx.lineTo(x - cs * wide, y - sn * tilt);
      ctx.closePath();
      ctx.moveTo(x, top);
      ctx.lineTo(x - sn * wide, y + cs * tilt);
      ctx.lineTo(x, bottom);
      ctx.lineTo(x + sn * wide, y - cs * tilt);
      ctx.closePath();
      ctx.stroke();
      if (live) {
        // Блик на ближней грани.
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(frontX, frontY);
        ctx.lineTo(x, y + tilt * 0.4);
        ctx.closePath();
        ctx.fillStyle = core;
        ctx.globalAlpha = alpha * 0.34;
        ctx.fill();
      }
    }
    if (!live) return;

    if (c.rare) {
      // Редкая сфера: вращающаяся четырёхлучевая звезда-блик.
      const ray = r * (2.5 + 0.5 * view.beat);
      const a = view.reduced ? 0.4 : view.now * 1.3 + c.id;
      const cs = Math.cos(a) * ray;
      const sn = Math.sin(a) * ray;
      ctx.beginPath();
      ctx.moveTo(x - cs, y - sn);
      ctx.lineTo(x + cs, y + sn);
      ctx.moveTo(x + sn, y - cs);
      ctx.lineTo(x - sn, y + cs);
      ctx.strokeStyle = core;
      ctx.lineWidth = Math.max(0.8, 1.3 * near * view.line);
      ctx.globalAlpha = alpha * 0.8;
      ctx.stroke();
    }
    // Горячее ядро с ореолом — один спрайт: белый центр, цветное свечение вокруг, пульс в долю.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    view.sprites.glow(view, color, true, x, y, r * (c.rare ? 2.3 : 1.9) * (1 + 0.2 * view.beat));
  }

  /** Дуга поля от корабля к сфере, которую тянет магнит. */
  private magnetArc(view: View, x: number, y: number, alpha: number): void {
    const { ctx } = view;
    const dx = x - view.shipSx;
    const dy = y - view.shipSy;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    // Дуга выгибается вбок и подрагивает, как разряд.
    const wobble = view.reduced ? 0.18 : 0.18 + 0.1 * Math.sin(view.now * 23 + x * 0.05);
    const side = dx >= 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(view.shipSx, view.shipSy);
    ctx.quadraticCurveTo(view.shipSx + dx * 0.5 + side * dy * wobble, view.shipSy + dy * 0.5 - Math.abs(dx) * wobble - dist * 0.12, x, y);
    this.glowStroke(ctx, view.hull, view.shipCore, Math.max(0.9, 1.5 * view.line), alpha * clamp(1.4 - dist / (view.span * 0.6), 0.25, 1));
  }
}
