/**
 * Рендер игры на Canvas 2D. Никакого React: каждый кадр GameCanvas зовёт
 * render(state), а рендер только читает состояние движка.
 *
 * Слои кадра:
 *   1. кэш фона (небо, звёзды, солнце, горы, пол) — один блит;
 *   2. мерцание звёзд, дыхание солнца в такт, перспективная сетка, туман,
 *      линия горизонта, рельсы;
 *   3. мир в трансформе поля (+ тряска): полосы скорости, сферы, препятствия,
 *      частицы, корабль, всплывающий текст;
 *   4. вспышка и приглушение на паузе (виньетка запечена в кэш фона).
 * Свечение — двойными/тройными штрихами и спрайтами в режиме 'lighter',
 * shadowBlur используется только при построении кэшей.
 */
import { GAME } from './config';
import { clamp, TAU } from './math';
import { BackgroundCache, drawTwinkles, horizonOf, type Horizon } from './render/background';
import { drawCrystals } from './render/crystals';
import { drawFlash, drawFloaters, drawParticles, drawPausedTint } from './render/effects';
import { createFrameInfo } from './render/frame';
import { GridPainter } from './render/grid';
import { drawObstacles } from './render/obstacles';
import { paletteFor, shipPaletteFor } from './render/palette';
import { drawShip } from './render/ship';
import { drawSprite, SpriteCache } from './render/sprites';
import type { GameState, Skin, Theme, Viewport } from './types';
import { heightFactor } from './viewport';

export interface RenderOptions {
  /** Тряска экрана включена в настройках. */
  shake: boolean;
  /** Игра на паузе: кадр статичен, можно приглушить сцену. */
  paused: boolean;
}

/** Запас вокруг видимой области мира: ореолы не обрезаются на кромке. */
const CULL_PAD = 6;
/** Самый длинный кадр, который учитывается в плавных переходах (сек). */
const MAX_DT = 0.1;
/**
 * Страховка от нехватки видеопамяти: если сам render() (запись команд, без GPU)
 * стабильно дольше SLOW_RENDER_MS, браузер, скорее всего, выгрузил большие кэши
 * из видеопамяти и перегружает их каждый кадр. Тогда бюджет пикселей кэшей
 * уменьшается вдвое (не больше MAX_QUALITY_STEPS раз) — картинка чуть мягче, зато плавно.
 */
const SLOW_RENDER_MS = 8;
const SLOW_FRAMES_TO_DOWNGRADE = 45;
const MAX_QUALITY_STEPS = 2;

interface ViewportKey {
  cssW: number;
  cssH: number;
  dpr: number;
  fieldX: number;
  fieldW: number;
}

function sameViewport(a: ViewportKey, b: Viewport): boolean {
  return a.cssW === b.cssW && a.cssH === b.cssH && a.dpr === b.dpr && a.fieldX === b.fieldX && a.fieldW === b.fieldW;
}

/** Шрифт всплывашек должен быть готов к первому «+50», иначе мелькнёт запасной. */
function preloadFonts(): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  for (const weight of [700, 900]) {
    document.fonts.load(`${weight} 32px "Orbitron"`).catch(() => undefined);
  }
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sprites = new SpriteCache();
  private readonly background = new BackgroundCache();
  private readonly grid: GridPainter;
  private readonly frame = createFrameInfo();
  private readonly viewportKey: ViewportKey = { cssW: 0, cssH: 0, dpr: 0, fieldX: 0, fieldW: 0 };
  private horizon: Horizon | null = null;
  private lastNow = 0;
  private shakeX = 0;
  private shakeY = 0;
  private listening = false;
  /** Кадр паузы уже на холсте: пока сцена та же, повторно его не рисуем. */
  private pausedDrawn = false;
  private pausedTime = -1;
  private pausedTheme: Theme | null = null;
  private pausedSkin: Skin | null = null;
  private slowFrames = 0;
  private qualitySteps = 0;

  private readonly onContextRestored = (): void => {
    // Браузер вернул контекст пустым: кэши придётся построить заново.
    this.sprites.clear();
    this.background.invalidate();
    this.grid.reset();
    this.pausedDrawn = false;
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.grid = new GridPainter(this.sprites);
    this.listen();
    preloadFonts();
  }

  /** Выставить размер холста: canvas.width = cssW * dpr и т. д. */
  resize(viewport: Viewport): void {
    const k = this.viewportKey;
    k.cssW = viewport.cssW;
    k.cssH = viewport.cssH;
    k.dpr = viewport.dpr;
    k.fieldX = viewport.fieldX;
    k.fieldW = viewport.fieldW;
    const w = Math.max(1, Math.round(viewport.cssW * viewport.dpr));
    const h = Math.max(1, Math.round(viewport.cssH * viewport.dpr));
    // Присваивание width сбрасывает холст даже без изменения — только при реальной смене.
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.canvas.style.width = `${viewport.cssW}px`;
    this.canvas.style.height = `${viewport.cssH}px`;
    this.horizon = horizonOf(viewport);
    this.pausedDrawn = false;
  }

  /** Нарисовать кадр целиком. */
  render(state: GameState, options: RenderOptions): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const started = performance.now();
    this.listen();
    const vp = state.viewport;
    if (!this.horizon || !sameViewport(this.viewportKey, vp)) this.resize(vp);
    const h = this.horizon ?? horizonOf(vp);

    let dt = this.lastNow > 0 ? clamp((started - this.lastNow) / 1000, 0, MAX_DT) : 0;
    this.lastNow = started;

    if (options.paused) {
      if (this.pausedDrawn && this.pausedTime === state.time && this.pausedTheme === state.theme && this.pausedSkin === state.skin) {
        return;
      }
      dt = 0;
    } else {
      this.pausedDrawn = false;
      // Тряска: смещение shake² × maxOffset в случайную сторону каждый кадр.
      if (options.shake && state.shake > 0.001) {
        const mag = state.shake * state.shake * GAME.shake.maxOffset;
        const a = Math.random() * TAU;
        this.shakeX = Math.cos(a) * mag;
        this.shakeY = Math.sin(a) * mag;
      } else {
        this.shakeX = 0;
        this.shakeY = 0;
      }
    }
    const sx = this.shakeX;
    const sy = this.shakeY;

    const theme = state.theme;
    const pal = paletteFor(theme);
    const gridColors = theme.colors.grid;
    this.grid.update(gridColors[(Math.max(1, state.level) - 1) % gridColors.length], dt);
    this.background.ensure(ctx, vp, theme, pal, h);

    // Импульс доли: резкий удар и кубический спад.
    const beat = Math.pow(1 - clamp(state.beatPhase, 0, 1), 3);
    const levelPulse = clamp(state.levelUpPulse, 0, 1);
    const intensity = clamp(0.6 + 0.3 * beat + 0.9 * levelPulse, 0, 1);
    const dpr = vp.dpr;

    // ── 1–2. Фон и пол (CSS-пиксели) ───────────────────────────────────────
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.background.draw(ctx, vp);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawTwinkles(ctx, vp, h, state.time, this.sprites);

    // Солнце «дышит» в такт: постоянный ореол уже в кэше, здесь — только импульс.
    const sunPulse = 0.24 * beat + 0.45 * levelPulse;
    if (sunPulse > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = sunPulse;
      drawSprite(ctx, this.sprites.glow(theme.colors.sunBottom), h.cx, h.sunY, h.sunR * 1.55);
    }

    this.grid.drawFloor(ctx, vp, h, state, intensity, sx * 0.4, sy * 0.4);
    ctx.globalCompositeOperation = 'source-over';
    this.background.drawFog(ctx, vp, h);
    this.grid.drawHorizon(ctx, vp, h, intensity);
    this.grid.drawRails(ctx, vp, state, intensity, sx);

    // ── 3. Мир: трансформ поля + тряска ────────────────────────────────────
    const scale = vp.scale;
    const f = this.frame;
    f.left = (-vp.fieldX - sx) / scale - CULL_PAD;
    f.right = (vp.cssW - vp.fieldX - sx) / scale + CULL_PAD;
    f.top = -sy / scale - CULL_PAD;
    f.bottom = (vp.cssH - sy) / scale + CULL_PAD;
    f.vanishX = (h.cx - vp.fieldX) / scale;
    f.vanishY = h.hy / scale;
    f.time = state.time;
    f.beat = beat;
    f.heightFactor = heightFactor(vp);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (vp.fieldX + sx), dpr * sy);

    this.grid.drawStreaks(ctx, state, f.top, f.bottom);
    drawCrystals(ctx, state, f, pal, this.sprites);
    drawObstacles(ctx, state, f, pal, this.sprites);
    drawParticles(ctx, state, f, this.sprites);
    drawShip(ctx, state, f, pal, shipPaletteFor(state.skin, theme), this.sprites);
    drawFloaters(ctx, state, f);

    // ── 4. Экранные эффекты ────────────────────────────────────────────────
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFlash(ctx, state, vp);

    if (options.paused) {
      drawPausedTint(ctx, vp, pal.bg);
      this.pausedDrawn = true;
      this.pausedTime = state.time;
      this.pausedTheme = state.theme;
      this.pausedSkin = state.skin;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.watchCost(performance.now() - started);
  }

  /** Считать подряд идущие медленные кадры и при необходимости облегчить кэши. */
  private watchCost(ms: number): void {
    if (this.qualitySteps >= MAX_QUALITY_STEPS) return;
    if (ms <= SLOW_RENDER_MS) {
      // Одиночные рывки (перестройка кэша, сборка мусора) не в счёт.
      if (this.slowFrames > 0) this.slowFrames--;
      return;
    }
    if (++this.slowFrames < SLOW_FRAMES_TO_DOWNGRADE) return;
    this.slowFrames = 0;
    this.qualitySteps++;
    const quality = Math.pow(0.5, this.qualitySteps);
    this.background.setQuality(quality);
    this.grid.setQuality(quality);
  }

  /** Освободить кэши и офскрин-холсты. Рендер остаётся рабочим: кэши построятся заново. */
  dispose(): void {
    if (this.listening) {
      this.canvas.removeEventListener('contextrestored', this.onContextRestored);
      this.listening = false;
    }
    this.sprites.clear();
    this.background.dispose();
    this.grid.reset();
    this.pausedDrawn = false;
    this.lastNow = 0;
  }

  private listen(): void {
    if (this.listening) return;
    this.canvas.addEventListener('contextrestored', this.onContextRestored);
    this.listening = true;
  }
}
