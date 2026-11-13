/**
 * Сетка долей в шкале звукового контекста.
 *
 * Симуляция сообщает тик события и то, как давно (по своим часам) оно случилось.
 * Отсюда «измеренный» момент события: ctx.currentTime + LATENCY − late. У него
 * есть дрожание — кадры и квант currentTime, — поэтому доли не ставятся прямо в
 * измеренный момент. Первая доля привязывает сетку (время тика 0), дальше каждая
 * доля встаёт ровно в сетку, а сама сетка подтягивается к измерениям не быстрее
 * MAX_SLEW за долю. Так соседние доли всегда отстоят на 0.46875 с ± полмиллисекунды,
 * а медленный уход часов звука от часов кадра отрабатывается незаметно.
 *
 * Если измерение ушло дальше LOCK_WINDOW (пауза, провал кадров, замедление при
 * гибели) — это уже не дрожание, сетка привязывается заново.
 */
import { clamp } from '../core/math';
import { TICK_DT } from '../core/timing';

/** Опережение планирования, сек: запас на дрожание кадров и на шаги внутри доли. */
export const LATENCY = 0.06;
/**
 * Окно захвата: измерение дальше от сетки — новая привязка. Внутри окна сетка лишь
 * плавно подтягивается, так что после короткого провала кадров музыка не спотыкается,
 * а расхождение со звуком до 40 мс глазом не заметно.
 */
export const LOCK_WINDOW = 0.04;
/** Наибольший сдвиг сетки за одну долю, сек. */
export const MAX_SLEW = 0.0005;
/** Доля ошибки, которую сетка отрабатывает за одну долю (до предела MAX_SLEW). */
const SLEW_GAIN = 0.05;

/** Измеренный момент события в шкале контекста. late — секунды, обрезается до разумного. */
export function measuredTime(now: number, late: number): number {
  return now + LATENCY - (Number.isFinite(late) ? clamp(late, 0, 0.25) : 0);
}

export class BeatGrid {
  /** Время контекста, соответствующее тику 0. */
  private anchor = 0;
  private locked = false;

  get isLocked(): boolean {
    return this.locked;
  }

  /** Забыть привязку: следующая доля привяжет сетку заново. */
  reset(): void {
    this.locked = false;
  }

  /** Доля с тиком tick измерена в момент measured — вернуть её место в сетке, подстроив сетку. */
  sync(tick: number, measured: number): number {
    if (this.locked) {
      const err = measured - (this.anchor + tick * TICK_DT);
      if (Math.abs(err) <= LOCK_WINDOW) {
        this.anchor += clamp(err * SLEW_GAIN, -MAX_SLEW, MAX_SLEW);
        return this.anchor + tick * TICK_DT;
      }
    }
    this.anchor = measured - tick * TICK_DT;
    this.locked = true;
    return measured;
  }

  /**
   * Момент тика target по сетке — без её подстройки. Событие с тиком tick измерено в момент
   * measured: пока сетка не привязана или расходится с этим измерением, момент отсчитывается
   * от самого измерения.
   */
  at(tick: number, measured: number, target: number = tick): number {
    if (this.locked && Math.abs(measured - (this.anchor + tick * TICK_DT)) <= LOCK_WINDOW) {
      return this.anchor + target * TICK_DT;
    }
    return measured + (target - tick) * TICK_DT;
  }
}
