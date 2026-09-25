/**
 * Частицы, всплывающий текст и полноэкранные эффекты (вспышка, пауза).
 * Частиц до GAME.particles.max за кадр — поэтому здесь нет ни одного shadowBlur,
 * ни одной новой строки цвета, а стиль меняется только при смене цвета.
 */
import { clamp, easeOutBack, TAU } from '../math';
import type { Floater, GameState, Viewport } from '../types';
import type { FrameInfo } from './frame';
import { drawSprite, type SpriteCache } from './sprites';
import { hotColor } from './util';

/** Цвет тёмной подложки текста (фон игры). */
const SHADE = '#05050a';
const FONT_FAMILY = '"Orbitron", "JetBrains Mono Variable", monospace';
const fontCache = new Map<number, string>();

/** Строка шрифта для размера (кэш по целому размеру — без аллокаций в кадре). */
function fontFor(size: number): string {
  const px = Math.max(6, Math.round(size));
  let font = fontCache.get(px);
  if (font === undefined) {
    font = `900 ${px}px ${FONT_FAMILY}`;
    fontCache.set(px, font);
  }
  return font;
}

export function drawParticles(ctx: CanvasRenderingContext2D, state: GameState, f: FrameInfo, sprites: SpriteCache): void {
  const list = state.particles;
  if (list.length === 0) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  let fill = '';
  let stroke = '';
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.life <= 0) continue;
    const reach = p.size * 2.5 + 4;
    if (p.x + reach < f.left || p.x - reach > f.right || p.y + reach < f.top || p.y - reach > f.bottom) continue;
    const k = p.maxLife > 0 ? clamp(p.life / p.maxLife, 0, 1) : 0;
    switch (p.shape) {
      case 'pixel': {
        // Квадратный «пиксель» с мягкой квадратной аурой — ретро-неон.
        if (fill !== p.color) {
          fill = p.color;
          ctx.fillStyle = fill;
        }
        const s = p.size;
        ctx.globalAlpha = k * 0.3;
        ctx.fillRect(p.x - s * 1.2, p.y - s * 1.2, s * 2.4, s * 2.4);
        ctx.globalAlpha = k;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        break;
      }
      case 'spark': {
        // Штрих вдоль скорости: длина — size, толщина тает с жизнью.
        if (stroke !== p.color) {
          stroke = p.color;
          ctx.strokeStyle = stroke;
        }
        const speed = Math.hypot(p.vx, p.vy);
        let dx = 0;
        let dy = 1;
        if (speed > 1e-3) {
          dx = p.vx / speed;
          dy = p.vy / speed;
        } else {
          dx = Math.cos(p.rotation);
          dy = Math.sin(p.rotation);
        }
        const len = p.size * (0.4 + 0.6 * k);
        ctx.globalAlpha = k;
        ctx.lineWidth = 0.6 + 1.2 * k;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - dx * len, p.y - dy * len);
        ctx.stroke();
        break;
      }
      case 'ring': {
        // Ударная волна: тонеет и гаснет по мере расширения.
        if (stroke !== p.color) {
          stroke = p.color;
          ctx.strokeStyle = stroke;
        }
        ctx.globalAlpha = k * 0.85;
        ctx.lineWidth = 0.7 + 3 * k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, TAU);
        ctx.stroke();
        break;
      }
      case 'glow': {
        ctx.globalAlpha = k * 0.85;
        drawSprite(ctx, sprites.glow(p.color), p.x, p.y, Math.max(0.5, p.size));
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'butt';
}

export function drawFloaters(ctx: CanvasRenderingContext2D, state: GameState, f: FrameInfo): void {
  const list = state.floaters;
  if (list.length === 0) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < list.length; i++) {
    const fl = list[i];
    if (fl.life <= 0 || fl.y < f.top || fl.y > f.bottom) continue;
    drawFloater(ctx, fl);
  }
  ctx.globalAlpha = 1;
}

function drawFloater(ctx: CanvasRenderingContext2D, fl: Floater): void {
  const age = fl.maxLife - fl.life;
  // Вылет с пружинкой в первые 0.18 с, затухание в последние 45 % жизни.
  const pop = 0.55 + 0.45 * easeOutBack(age / 0.18);
  const fade = fl.maxLife > 0 ? clamp(fl.life / (fl.maxLife * 0.45), 0, 1) : 0;
  if (fade <= 0) return;
  const size = fl.size * pop;
  ctx.font = fontFor(size);
  // Тёмная обводка снизу — текст читается и на ярком солнце, и на вспышках.
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = SHADE;
  ctx.lineWidth = size * 0.3;
  ctx.globalAlpha = 0.75 * fade;
  ctx.strokeText(fl.text, fl.x, fl.y);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = fl.color;
  ctx.lineWidth = size * 0.34;
  ctx.globalAlpha = 0.2 * fade;
  ctx.strokeText(fl.text, fl.x, fl.y);
  ctx.lineWidth = size * 0.13;
  ctx.globalAlpha = 0.65 * fade;
  ctx.strokeText(fl.text, fl.x, fl.y);
  ctx.fillStyle = hotColor(fl.color);
  ctx.globalAlpha = fade;
  ctx.fillText(fl.text, fl.x, fl.y);
}

/** Полноэкранная вспышка цвета flashColor (трансформ — CSS-пиксели). */
export function drawFlash(ctx: CanvasRenderingContext2D, state: GameState, vp: Viewport): void {
  const a = clamp(state.flash, 0, 1);
  if (a < 0.01) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = state.flashColor;
  ctx.globalAlpha = a * 0.55;
  ctx.fillRect(0, 0, vp.cssW, vp.cssH);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Пауза: кадр застывает приглушённым и почти обесцвеченным. */
export function drawPausedTint(ctx: CanvasRenderingContext2D, vp: Viewport, bg: string): void {
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = '#808080';
  ctx.globalAlpha = 0.7;
  ctx.fillRect(0, 0, vp.cssW, vp.cssH);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.42;
  ctx.fillRect(0, 0, vp.cssW, vp.cssH);
  ctx.globalAlpha = 1;
}
