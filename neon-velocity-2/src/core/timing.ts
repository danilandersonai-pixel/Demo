/**
 * Единая временная сетка игры. Симуляция идёт фиксированными тиками, а частота
 * подобрана под темп музыки: 128 тиков в секунду при 128 ударах в минуту дают
 * ровно 60 тиков на долю. Поэтому всё — прилёт препятствий, ноты, смена уровня —
 * считается в целых тиках и не «уплывает» даже за часовой забег.
 *
 * Отсчёт забега: tick = -LEAD_IN_TICKS в момент старта (такт вступления
 * READY), tick = 0 — команда GO и первая доля первого такта. Уровень скорости
 * длится 8 тактов = 1920 тиков = ровно 15 секунд, так что новый уровень всегда
 * приходится на сильную долю — музыкальный «дроп».
 */

/** Тиков симуляции в секунду. */
export const TICK_RATE = 128;
/** Длительность тика, сек. */
export const TICK_DT = 1 / TICK_RATE;
/** Темп музыки, ударов в минуту. */
export const BPM = 128;

/** Шестнадцатая нота. */
export const TICKS_PER_STEP = 15;
/** Восьмая нота. */
export const TICKS_PER_EIGHTH = 30;
/** Доля (четверть). */
export const TICKS_PER_BEAT = 60;
export const BEATS_PER_BAR = 4;
export const TICKS_PER_BAR = TICKS_PER_BEAT * BEATS_PER_BAR; // 240
export const BARS_PER_LEVEL = 8;
/** Уровень скорости: 8 тактов = 15.000 с. */
export const TICKS_PER_LEVEL = TICKS_PER_BAR * BARS_PER_LEVEL; // 1920
/** Вступление перед GO: один такт (READY и отсчёт). */
export const LEAD_IN_TICKS = TICKS_PER_BAR;

export function ticksToSeconds(ticks: number): number {
  return ticks * TICK_DT;
}

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICK_RATE);
}

/** Целочисленное деление с округлением вниз (корректно и для отрицательных тиков вступления). */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Остаток 0..b-1 (корректно и для отрицательных a). */
export function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/** Уровень скорости для тика забега: 1 во вступлении и первые 15 с, затем +1 каждые 15 с. */
export function levelAtTick(tick: number): number {
  return 1 + Math.max(0, floorDiv(tick, TICKS_PER_LEVEL));
}

/** 0..1 — прогресс текущего уровня. */
export function levelProgressAtTick(tick: number): number {
  return tick <= 0 ? 0 : mod(tick, TICKS_PER_LEVEL) / TICKS_PER_LEVEL;
}

/** Номер такта от GO (во вступлении −1). */
export function barAtTick(tick: number): number {
  return floorDiv(tick, TICKS_PER_BAR);
}

/** Первый тик такта. */
export function barStartTick(bar: number): number {
  return bar * TICKS_PER_BAR;
}

/** Номер доли от GO (во вступлении −4…−1). */
export function beatAtTick(tick: number): number {
  return floorDiv(tick, TICKS_PER_BEAT);
}

/** Доля внутри такта: 0..3. */
export function beatInBar(tick: number): number {
  return mod(beatAtTick(tick), BEATS_PER_BAR);
}

/** Такт внутри уровня: 0..7. */
export function barInLevel(bar: number): number {
  return mod(bar, BARS_PER_LEVEL);
}

/** 0..1 — фаза внутри доли для дробного тика (0 — сам удар). */
export function beatPhase(tick: number): number {
  return mod(tick, TICKS_PER_BEAT) / TICKS_PER_BEAT;
}

/** Тик стоит на сетке шестнадцатых. */
export function isOnGrid(tick: number): boolean {
  return mod(tick, TICKS_PER_STEP) === 0;
}
