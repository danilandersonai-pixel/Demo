/**
 * Чистая логика игрового цикла — без DOM, поэтому проверяется автотестами
 * (loop.test.ts): фиксированный шаг симуляции, огрубление снимка HUD и
 * мелкие правила хоста.
 */
import { RESUME_COUNT_IN_BEATS } from '../../core/config';
import { TICK_DT, TICK_RATE, TICKS_PER_BEAT } from '../../core/timing';
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

/** Длительность доли, сек. */
const BEAT_SECONDS = TICKS_PER_BEAT * TICK_DT;

/**
 * Отсчёт после паузы. Экран паузы закрылся, но мир стоит ещё RESUME_COUNT_IN_BEATS долей
 * настоящего времени: ни одного тика, на экране цифры «2», «1» — игрок успевает найти
 * корабль и вернуть к нему курсор. Тики идут дальше с того же места ровно в момент,
 * когда отсчёт кончился: остаток этого кадра достаётся симуляции.
 */
export class ResumeCountIn {
  /** Сколько секунд отсчёта осталось; 0 — отсчёт не идёт. */
  private left = 0;

  get active(): boolean {
    return this.left > 0;
  }

  /** Цифра на экране — сколько долей осталось (2, 1); 0 — отсчёт не идёт. */
  get count(): number {
    return this.left > 0 ? Math.ceil(this.left / BEAT_SECONDS - 1e-9) : 0;
  }

  start(): void {
    this.left = RESUME_COUNT_IN_BEATS * BEAT_SECONDS;
  }

  cancel(): void {
    this.left = 0;
  }

  /**
   * Прошло dt секунд настоящего времени. Возвращает время, доставшееся симуляции:
   * 0, пока отсчёт идёт, и остаток кадра в тот кадр, когда он кончился.
   */
  advance(dt: number): number {
    const step = Math.max(0, dt);
    if (this.left <= 0) return step;
    // Допуск на накопленную погрешность: кадр, попавший точно в конец, отсчёт и заканчивает.
    if (step < this.left - 1e-9) {
      this.left -= step;
      return 0;
    }
    const rest = Math.max(0, step - this.left);
    this.left = 0;
    return rest;
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
 * Рекорд, с которым сравнивается идущий забег. Симуляция помнит рекорд на момент
 * старта, а другая вкладка может поднять его посреди забега (событие storage →
 * loadout.highscore). NEW RECORD! и метка BEST сверяются с рекордом, который игра
 * показывает сейчас, — иначе баннер вспыхнул бы на счёте ниже настоящего рекорда.
 */
export class RecordWatch {
  /** Рекорд, который нужно обогнать; 0 — рекорда ещё нет, и первый забег баннером не отмечается. */
  record = 0;
  /** Счёт уже обогнал record. */
  beaten = false;

  /** Начало забега: рекорд из его снаряжения. */
  start(highscore: number): void {
    this.record = Math.max(0, highscore);
    this.beaten = false;
  }

  /**
   * Сверить счёт с рекордом; saved — рекорд в сохранении прямо сейчас. Возвращает побитый
   * рекорд в тот единственный кадр, когда счёт его обогнал, иначе null.
   */
  poll(score: number, saved: number): number | null {
    if (saved > this.record) {
      // Рекорд подняли со стороны: обгонять теперь нужно его, даже если прежний уже побит.
      this.record = saved;
      this.beaten = this.beaten && score > saved;
    }
    if (this.beaten || this.record <= 0 || score <= this.record) return null;
    this.beaten = true;
    return this.record;
  }

  /** Вписать рекорд в снимок HUD (меняет и возвращает тот же объект). */
  stamp(snapshot: HudSnapshot): HudSnapshot {
    snapshot.highscore = Math.max(this.record, snapshot.score);
    snapshot.newRecord = this.beaten;
    return snapshot;
  }
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
