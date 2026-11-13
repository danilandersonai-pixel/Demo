/**
 * Рендер игры на Canvas 2D. Этот файл — дирижёр: считает время кадра, ритм и
 * камеру (тряска, крен, удар масштаба), превращает события симуляции в
 * косметику и вызывает слои по порядку от дальних к ближним:
 *
 *   небо → ближний план горизонта → земля → дорога → блики и метки прилёта →
 *   объекты перед кораблём → корабль → объекты за кораблём → частицы → вспышка
 *
 * Мир рисуется в момент t = state.tick − 1 + alpha: положения объектов берутся
 * из чистых функций motion.ts, корабль — интерполяцией prevX → x, поэтому
 * движение гладкое при любой частоте кадров. Симуляцию рендер только читает.
 */
import { approachTicksForLevel, GAME, shipColors, SKINS, THEMES } from '../core/config';
import { clamp, damp, lerp, mixColor, smoothstep } from '../core/math';
import { speedPerTick } from '../core/motion';
import { beatInBar, beatPhase, TICK_DT, TICK_RATE } from '../core/timing';
import type { SimEvent, SimState, Skin, Theme } from '../core/types';
import { Backdrop } from './backdrop';
import { CAMERA_D, makeCamera, project, type Camera, type Projected } from './camera';
import { Objects } from './objects';
import { Particles } from './particles';
import { Road } from './road';
import { Scenery } from './scenery';
import { SHIP_HOVER, Ship } from './ship';
import { BLEED, CANVAS_FONT, lineScale, Sprites, type View } from './view';

export interface RenderFrame {
  state: SimState;
  /** Доля тика 0..1: рендер рисует мир в момент state.tick − 1 + alpha (интерполяция между тиками). */
  alpha: number;
  theme: Theme;
  skin: Skin;
  /** Реальное время, сек — для косметических анимаций, не связанных с тиками. */
  now: number;
  /** Игра на паузе: кадр статичен. */
  paused: boolean;
  /** Тряска камеры включена в настройках. */
  shake: boolean;
  /** Пользователь просит меньше движения: без тряски, рывков камеры и вспышек. */
  reducedMotion: boolean;
}

/** Больше пикселей холст не получает: на 4K-экране плотность снижается, а не кадровая частота. */
const MAX_PIXELS = 4.2e6;
/** Наибольший крен мира вслед за кораблём: сдвиг вбок на пиксель высоты (≈ 0.5°). */
const ROLL_MAX = 0.008;
/** Сколько клиньев сетки следующего уровня запекается за кадр. */
const LANES_PER_FRAME = 3;
/** Прибавка масштаба дороги в момент дропа. */
const PUNCH_ZOOM = 0.055;
/** Переход цвета сетки между уровнями, сек. */
const GRID_FADE = 1;
/** Скачок времени больше этого — не кадр, а смена сцены, тики. */
const CUT_TICKS = 96;
/** Период, на который сворачивается пройденный путь (кратен шагам сетки и столбиков). */
const SCROLL_WRAP = 300;

/** Что было нарисовано последним кадром паузы — чтобы не рисовать его снова. */
interface Frozen {
  valid: boolean;
  tick: number;
  alpha: number;
  theme: Theme | null;
  skin: Skin | null;
  reduced: boolean;
}

export class Renderer {
  camera: Camera;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sprites = new Sprites();
  private readonly backdrop = new Backdrop();
  private readonly scenery = new Scenery();
  private readonly road = new Road();
  private readonly objects = new Objects();
  private readonly ship = new Ship();
  private readonly particles = new Particles();
  private readonly p: Projected = { x: 0, y: 0, scale: 0 };
  private view: View | null = null;

  /** Пикселей холста на CSS-пиксель. */
  private kx = 1;
  private ky = 1;
  private layersDirty = true;
  private builtTheme: Theme | null = null;

  /** Время прошлого кадра: мировое (тики) и реальное (сек); NaN — кадра ещё не было. */
  private prevT = NaN;
  private prevNow = NaN;
  private prevSeed = NaN;
  private scroll = 0;
  private speed = speedPerTick(GAME.approach.base) * TICK_RATE;

  private gridFrom = '';
  private gridTo = '';
  private gridColor = '';
  private gridFade = 1;

  private trauma = 0;
  private punch = 0;
  private roll = 0;
  private overdrive = 0;
  private flash = 0;
  private flashColor = '#ffffff';
  private readonly frozen: Frozen = { valid: false, tick: 0, alpha: 0, theme: null, skin: null, reduced: false };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Задник закрывает весь холст каждый кадр, прозрачность не нужна — так браузеру дешевле.
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.camera = makeCamera(1, 1, 1);
    // Надписи на холсте ждут шрифт: до загрузки спрайты рисуются запасным и потом пересоздаются.
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts
        .load(`900 20px ${CANVAS_FONT}`)
        .then(() => this.dropTexts())
        .catch(() => undefined);
    }
  }

  private dropTexts(): void {
    this.sprites.clearTexts();
    this.particles.dropLabels();
    this.frozen.valid = false;
  }

  /** Новый размер холста; возвращает актуальную камеру (она же нужна вводу). */
  resize(cssW: number, cssH: number, dpr: number): Camera {
    const cam = makeCamera(cssW, cssH, dpr);
    this.camera = cam;
    const ratio = Math.max(1, Math.min(cam.dpr, Math.sqrt(MAX_PIXELS / (cam.cssW * cam.cssH))));
    const width = Math.max(1, Math.round(cam.cssW * ratio));
    const height = Math.max(1, Math.round(cam.cssH * ratio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.kx = width / cam.cssW;
    this.ky = height / cam.cssH;
    this.layersDirty = true;
    this.frozen.valid = false;
    return cam;
  }

  /** Событие симуляции: частицы, вспышки, тряска — вся косметика живёт в рендере. */
  onEvent(event: SimEvent, state: SimState): void {
    if (!this.ctx) return;
    const view = this.viewFor(state);
    const colors = view.colors;
    this.particles.onEvent(event, state, view);
    switch (event.type) {
      case 'go':
        this.road.wave(colors.rail, 0.7);
        break;
      case 'levelUp': {
        const color = colors.grid[(event.level - 1) % colors.grid.length];
        this.road.wave(color, 1);
        this.trauma = Math.max(this.trauma, GAME.shake.levelUp);
        this.punch = 1;
        this.flashWith(color, 0.3);
        break;
      }
      case 'dodge':
        if (event.near) this.trauma = Math.max(this.trauma, GAME.shake.nearMiss);
        break;
      case 'overdrive':
        if (event.on) {
          this.road.wave(colors.accent3, 0.9);
          this.flashWith(colors.accent3, 0.34);
        }
        break;
      case 'newRecord':
        this.road.wave(colors.accent3, 1);
        break;
      case 'shieldBreak':
        this.trauma = Math.max(this.trauma, GAME.shake.shield);
        this.flashWith(view.hull, 0.5);
        break;
      case 'death':
        this.trauma = Math.max(this.trauma, GAME.shake.hit);
        this.flashWith('#ffffff', 0.85);
        break;
      default:
        break;
    }
  }

  private flashWith(color: string, power: number): void {
    if (power < this.flash) return;
    this.flash = power;
    this.flashColor = color;
  }

  /** Сбросить косметику (частицы, тряску) перед новым забегом или сценой. */
  reset(): void {
    this.particles.clear();
    this.road.reset();
    this.trauma = 0;
    this.punch = 0;
    this.flash = 0;
    this.roll = 0;
    // Следующий кадр начнёт сцену заново: без переходов и с появлением корабля.
    this.prevT = NaN;
    this.frozen.valid = false;
  }

  /** Общие данные кадра создаются один раз; до первого кадра в них тема и корабль по умолчанию. */
  private viewFor(state: SimState): View {
    if (this.view) return this.view;
    const ctx = this.ctx as CanvasRenderingContext2D;
    const theme = THEMES.cyberpunk;
    const skin = SKINS.core;
    const ship = shipColors(skin, theme);
    const view: View = {
      ctx,
      cam: this.camera,
      state,
      colors: theme.colors,
      skin,
      sprites: this.sprites,
      kx: 1,
      ky: 1,
      t: 0,
      alpha: 1,
      now: 0,
      dt: 0,
      beat: 0,
      downbeat: 0,
      shipX: state.player.x,
      shipSx: 0,
      shipSy: 0,
      hull: ship.hull,
      shipCore: ship.core,
      gridColor: theme.colors.grid[0],
      scroll: 0,
      speed: this.speed,
      overdrive: 0,
      reduced: false,
      line: 1,
      span: 1,
      flat: 0.3,
      ox: 0,
      oy: 0,
      zoom: 1,
      shear: 0,
    };
    this.view = view;
    return view;
  }

  /** Нарисовать кадр целиком. */
  render(frame: RenderFrame): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { state, theme, skin } = frame;
    const cam = this.camera;
    const frozen = this.frozen;
    if (frame.paused) {
      // Кадр паузы статичен: если ничего не изменилось, холст не трогаем — размытый
      // оверлей над ним не пересчитывается.
      if (frozen.valid && frozen.tick === state.tick && frozen.alpha === frame.alpha && frozen.theme === theme && frozen.skin === skin && frozen.reduced === frame.reducedMotion) {
        return;
      }
    } else {
      frozen.valid = false;
    }

    const rebuilt = this.layersDirty || this.builtTheme !== theme;
    if (rebuilt) this.buildLayers(theme, this.builtTheme !== theme);

    // ── Время ──
    const t = state.tick - 1 + frame.alpha;
    const first = Number.isNaN(this.prevT);
    const cut = first || state.seed !== this.prevSeed || t < this.prevT - 2 || t - this.prevT > CUT_TICKS;
    const dt = cut || frame.paused ? 0 : clamp(t - this.prevT, 0, 9) * TICK_DT;
    const realDt = frame.paused || Number.isNaN(this.prevNow) ? 0 : clamp(frame.now - this.prevNow, 0, 0.05);
    this.prevT = t;
    this.prevNow = frame.now;
    this.prevSeed = state.seed;
    if (cut) {
      this.ship.spawn();
      this.roll = 0;
    }

    const motion = !frame.reducedMotion;
    const targetSpeed = speedPerTick(approachTicksForLevel(state.level)) * TICK_RATE;
    this.speed = cut ? targetSpeed : damp(this.speed, targetSpeed, 4, dt);
    this.scroll = (this.scroll + this.speed * dt) % SCROLL_WRAP;

    // ── Цвет сетки: плавный переход между уровнями ──
    const grid = theme.colors.grid;
    const level = Math.max(1, state.level);
    const gridTarget = grid[(level - 1) % grid.length];
    if (cut || rebuilt || this.gridColor === '') {
      this.gridFrom = this.gridTo = this.gridColor = gridTarget;
      this.gridFade = 1;
      this.backdrop.showGrid(gridTarget);
    } else if (gridTarget !== this.gridTo) {
      // Прежний переход (если он ещё шёл) завершается сразу — слоёв земли только два.
      if (this.gridFade < 1) this.backdrop.commit();
      this.backdrop.fadeTo(gridTarget);
      this.gridFrom = this.gridColor;
      this.gridTo = gridTarget;
      this.gridFade = 0;
    }
    if (this.gridFade < 1) {
      this.gridFade = Math.min(1, this.gridFade + dt / GRID_FADE);
      if (this.gridFade >= 1) {
        this.gridColor = this.gridTo;
        this.backdrop.commit();
      } else {
        this.gridColor = mixColor(this.gridFrom, this.gridTo, smoothstep(0, 1, this.gridFade));
      }
    } else {
      // Пока уровень идёт, понемногу готовим землю с сеткой следующего.
      this.backdrop.prepare(grid[level % grid.length]);
      this.backdrop.bake(LANES_PER_FRAME);
    }

    // ── Косметика камеры (в реальном времени: замедление взрыва её не растягивает) ──
    const alive = state.player.alive;
    const overdriveTarget = state.overdrive && alive && state.mode === 'playing' ? 1 : 0;
    this.overdrive = cut ? overdriveTarget : damp(this.overdrive, overdriveTarget, 5, realDt);
    this.trauma = Math.max(0, this.trauma - GAME.shake.decay * realDt);
    this.punch = this.punch < 0.004 ? 0 : this.punch * Math.exp(-6.5 * realDt);
    this.flash = Math.max(0, this.flash - 2.6 * realDt);
    this.roll = damp(this.roll, motion && alive ? state.player.bank * ROLL_MAX : 0, 9, realDt);

    let shakeX = 0;
    let shakeY = 0;
    if (motion && frame.shake && this.trauma > 0.002) {
      // На телефоне та же тряска в пикселях была бы вдвое «громче».
      const amp = this.trauma * this.trauma * GAME.shake.maxOffset * clamp(Math.min(cam.cssW, cam.cssH) / 720, 0.5, 1);
      const n = frame.now;
      shakeX = amp * 0.5 * (Math.sin(n * 91.7) + Math.sin(n * 57.3 + 1.3));
      shakeY = amp * 0.5 * (Math.sin(n * 83.1 + 2.1) + Math.sin(n * 49.9 + 0.7));
    }
    // Слои-кэши сдвигаются на целые пиксели устройства и не шире своего запаса;
    // часть запаса по горизонтали уже занята креном.
    const lean = ROLL_MAX * (cam.cssH + BLEED - cam.horizonY);
    const limitX = Math.max(0, Math.floor((BLEED - lean) * this.kx) - 1);
    const limitY = Math.floor(BLEED * this.ky) - 1;
    const ox = clamp(Math.round(shakeX * this.kx), -limitX, limitX);
    const oy = clamp(Math.round(shakeY * this.ky), -limitY, limitY);

    // ── Общие данные кадра ──
    const view = this.viewFor(state);
    if (view.skin !== skin || view.colors !== theme.colors) {
      const ship = shipColors(skin, theme);
      view.hull = ship.hull;
      view.shipCore = ship.core;
    }
    const phase = beatPhase(t);
    const beat = (1 - phase) * (1 - phase);
    view.cam = cam;
    view.state = state;
    view.colors = theme.colors;
    view.skin = skin;
    view.kx = this.kx;
    view.ky = this.ky;
    view.t = t;
    view.alpha = frame.alpha;
    view.now = frame.now;
    view.dt = dt;
    view.beat = beat;
    view.downbeat = beatInBar(Math.floor(t)) === 0 ? beat : 0;
    view.gridColor = this.gridColor;
    view.scroll = this.scroll;
    view.speed = this.speed;
    view.overdrive = this.overdrive;
    view.reduced = frame.reducedMotion;
    view.line = lineScale(cam);
    view.span = cam.lineY - cam.horizonY;
    view.flat = view.span / (cam.unit * CAMERA_D);
    view.ox = ox;
    view.oy = oy;
    // Удар масштаба — вокруг точки схода: запечённые в землю продольные линии и
    // бортики — лучи из неё, поэтому с увеличенной дорогой они не расходятся.
    view.zoom = 1 + (motion ? this.punch * PUNCH_ZOOM : 0);
    view.shear = this.roll;
    view.shipX = lerp(state.player.prevX, state.player.x, frame.alpha);
    const at = project(cam, view.shipX, SHIP_HOVER, 0, this.p);
    view.shipSx = at.x;
    view.shipSy = at.y;

    // ── Частицы и волны живут в мировом времени ──
    this.road.update(dt);
    if (skin.perks.trail && state.mode !== 'over') this.particles.trail(view);
    this.particles.update(dt);

    // ── Слои ──
    this.backdrop.drawSky(view, ox, oy);
    this.scenery.draw(view, ox, oy);
    this.backdrop.drawGround(view, ox, oy, this.gridFade < 1 ? smoothstep(0, 1, this.gridFade) : 0);
    this.road.draw(view);
    this.objects.drawGround(view);
    this.objects.drawRange(view, 0, Infinity);
    this.ship.draw(view, realDt);
    this.objects.drawRange(view, -Infinity, 0);
    this.particles.draw(view);
    this.particles.drawSpeedLines(view);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (motion && this.flash > 0.01) {
      ctx.globalAlpha = Math.min(0.8, this.flash * this.flash * 1.1);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (frame.paused) {
      // Пауза: кадр слегка приглушён и запомнен.
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = theme.colors.bg;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      frozen.valid = true;
      frozen.tick = state.tick;
      frozen.alpha = frame.alpha;
      frozen.theme = theme;
      frozen.skin = skin;
      frozen.reduced = frame.reducedMotion;
    }
    ctx.globalAlpha = 1;
  }

  /** Кэш-слои зависят от темы и размера холста. */
  private buildLayers(theme: Theme, themeChanged: boolean): void {
    const cam = this.camera;
    // Горизонт у темы всегда один и тот же: зерно — от её имени.
    let seed = 2026;
    for (let i = 0; i < theme.id.length; i++) seed = (seed * 31 + theme.id.charCodeAt(i)) >>> 0;
    this.backdrop.build(cam, theme, this.kx, this.ky, seed);
    this.scenery.build(cam, theme, this.kx, this.ky, seed);
    if (themeChanged) {
      // У новой темы свои цвета: спрайты и частицы прежней больше не понадобятся.
      this.sprites.dispose();
      this.particles.clear();
    }
    this.sprites.setPixelScale(Math.max(this.kx, this.ky));
    this.particles.dropLabels();
    this.builtTheme = theme;
    this.layersDirty = false;
  }

  /** Освободить кэши и офскрин-холсты. Рендер остаётся рабочим: следующий кадр построит их заново. */
  dispose(): void {
    this.backdrop.dispose();
    this.scenery.dispose();
    this.sprites.dispose();
    this.particles.clear();
    this.road.reset();
    this.builtTheme = null;
    this.layersDirty = true;
    this.frozen.valid = false;
    this.prevT = NaN;
  }
}
