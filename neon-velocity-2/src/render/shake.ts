/**
 * Тряска камеры: сдвиг кадра по «травме» (GAME.shake). Чистая математика без
 * холста — её же проверяют тесты: каждое событие обязано сдвигать картинку
 * хотя бы на пиксель устройства, а новый уровень — быть слабее столкновения.
 */
import { GAME } from '../core/config';
import { clamp } from '../core/math';
import type { Camera } from './camera';

/** Травма ниже этой уже ничего не сдвигает. */
export const SHAKE_FLOOR = 0.002;

export interface ShakeOffset {
  x: number;
  y: number;
}

/** Размах тряски, CSS-пиксели: квадрат травмы; на телефоне та же тряска в пикселях была бы вдвое «громче». */
export function shakeAmplitude(trauma: number, cam: Camera): number {
  return trauma * trauma * GAME.shake.maxOffset * clamp(Math.min(cam.cssW, cam.cssH) / 720, 0.5, 1);
}

/** Сдвиг кадра в момент now (реальное время, сек), CSS-пиксели: по две несоизмеримые синусоиды на ось. */
export function shakeOffset(trauma: number, cam: Camera, now: number, out: ShakeOffset): ShakeOffset {
  if (trauma <= SHAKE_FLOOR) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const amp = shakeAmplitude(trauma, cam);
  out.x = amp * 0.5 * (Math.sin(now * 91.7) + Math.sin(now * 57.3 + 1.3));
  out.y = amp * 0.5 * (Math.sin(now * 83.1 + 2.1) + Math.sin(now * 49.9 + 0.7));
  return out;
}
