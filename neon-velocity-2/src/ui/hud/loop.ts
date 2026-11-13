/**
 * Чистая логика игрового цикла — без DOM, поэтому проверяется автотестами
 * (loop.test.ts): фиксированный шаг симуляции, огрубление снимка HUD и
 * мелкие правила хоста.
 */
import { TICK_RATE } from '../../core/timing';
import type { HudSnapshot, Loadout, RunResult } from '../../core/types';
import { plural } from '../kit/format';

/** Больше тиков за кадр симуляция не догоняет: остаток отбрасывается, игра замедляется, но не «прыгает». */
export const MAX_TICKS_PER_FRAME = 8;

/** Часы симуляции: сколько реального времени стоит тик (1, а в замедленном взрыве — меньше). */
export interface TickClock {
  readonly timeScale: number;
}

/**
 * Фиксированный шаг: время кадра копится в тиках, целые тики просчитываются,
 * дробный остаток остаётся — это alpha для интерполяции рендера.
 */
export class FixedStep {
  /** Доля тика 0..1, прошедшая после последнего просчитанного тика. */
  alpha = 0;

  reset(): void {
    this.alpha = 0;
  }

  /** Просчитать кадр длиной dt секунд; step() — ровно один тик. Возвращает число тиков. */
  advance(dt: number, clock: TickClock, step: () => void): number {
    let acc = this.alpha + Math.max(0, dt) * TICK_RATE * clock.timeScale;
    let stepped = 0;
    while (acc >= 1 && stepped < MAX_TICKS_PER_FRAME) {
      const scale = clock.timeScale;
      step();
      acc -= 1;
      stepped++;
      // Замедление началось (или кончилось) посреди кадра: остаток времени стоит уже по новому курсу.
      if (clock.timeScale !== scale && scale > 0) acc *= clock.timeScale / scale;
    }
    // Не успели за кадр — лишнее время отбрасывается, доля тика остаётся для интерполяции.
    if (acc >= 1) acc -= Math.floor(acc);
    this.alpha = acc;
    return stepped;
  }
}

/**
 * Полоса уровня и время в снимке HUD огрубляются: без этого снимок менялся бы на
 * каждой публикации и React перерисовывал HUD 30 раз в секунду ради доли пикселя.
 * 64 шага на уровень — восьмая нота.
 */
const LEVEL_STEPS = 64;
const ELAPSED_STEP = 0.5;

/** Подготовить снимок симуляции к публикации (меняет и возвращает тот же объект). */
export function coarsenHud(snapshot: HudSnapshot, fps: number, alive: boolean): HudSnapshot {
  snapshot.fps = fps;
  snapshot.levelProgress = Math.floor(snapshot.levelProgress * LEVEL_STEPS + 1e-9) / LEVEL_STEPS;
  snapshot.elapsed = Math.floor(snapshot.elapsed / ELAPSED_STEP + 1e-9) * ELAPSED_STEP;
  // После гибели симуляция OVERDRIVE не снимает — HUD гасит его сам.
  if (!alive) snapshot.overdrive = false;
  return snapshot;
}

/** Подпись SHIELD DOWN; сгоревший при том же ударе множитель дописывается сюда же. */
export function shieldNote(left: number, lost: number): string {
  const shield =
    left > 0
      ? `${plural(left, ['остался', 'осталось', 'осталось'])} ${left} ${plural(left, ['заряд', 'заряда', 'зарядов'])}`
      : 'щит принял удар';
  return lost >= 2 ? `${shield} · x${lost} сгорел` : shield;
}

/**
 * Снаряжение для забега, начатого сразу после сдачи брошенного («Заново» из
 * паузы). Сданный итог уже поднял рекорд в сохранении, но loadout в пропсах ещё
 * из рендера до этой записи — рекорд поднимается здесь так же, как в
 * progress.recordRun. Иначе новый забег весь сравнивался бы со старым рекордом.
 */
export function withBankedRecord(loadout: Loadout, banked: RunResult | null): Loadout {
  if (!banked) return loadout;
  const score = Math.max(0, Math.floor(banked.score));
  return score > loadout.highscore ? { ...loadout, highscore: score } : loadout;
}
