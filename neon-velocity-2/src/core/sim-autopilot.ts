/**
 * Автопилот фоновой сцены меню. Столкновений в attract нет, поэтому задача
 * автопилота — красота: корабль плавно обходит препятствия с запасом на свой
 * нарисованный размер, собирает цепочки сфер, а когда дорога пуста — покачивается
 * из стороны в сторону в ритме тактов.
 *
 * Две части:
 *  • план — динамическое программирование по сетке «клетка × срез времени»
 *    (идея та же, что у бота planMove, но сетка грубее, а вместо запретов —
 *    штрафы: путь находится всегда, даже если трек оставил слишком узкую щель);
 *  • ведение — критически задемпфированная пружина тянет корабль к точке плана
 *    чуть впереди по времени. Ломаная плана превращается в гладкую траекторию,
 *    а упреждение убирает отставание на прямых участках.
 *
 * Всё детерминировано; после создания память не выделяется.
 */
import { depthReach } from './collision';
import { WORLD } from './config';
import { clamp, TAU } from './math';
import { crystalBaseX, obstacleX, pickupReach } from './motion';
import { SHIP_SIZE } from './shipGeometry';
import { moveShip, SHIP_MAX_X, SHIP_MIN_X } from './sim-ship';
import { TICK_DT, TICKS_PER_BAR, TICKS_PER_BEAT } from './timing';
import type { Crystal, Obstacle, SimState } from './types';

// ─── Сетка плана ────────────────────────────────────────────────────────────

/** Ширина клетки, единицы дороги. */
const CELL = 1.5;
const CELLS = Math.floor((SHIP_MAX_X - SHIP_MIN_X) / CELL) + 1;
/** Длина среза, тики. */
const SLICE = 6;
/** Горизонт: 54 среза = 324 тика — вся видимая дорога на скорости фоновой сцены. */
const SLICES = 54;
/** Клеток за срез: 3 × 1.5 ед. за 6 тиков = 96 ед/с — предел; обычно хватает трети. */
const MAX_SHIFT = 3;
/** План пересчитывается раз в долю: новые объекты появляются только у горизонта, спешить некуда. */
const REPLAN_TICKS = TICKS_PER_BEAT;

// ─── Вкус плана (косметика: на правила игры не влияет) ──────────────────────

/** Зазор «центр корабля — край препятствия», при котором нарисованный корабль его касается. */
const TOUCH_CLEAR = SHIP_SIZE;
/** С этого зазора корабль перестаёт сторониться препятствия. */
const COMFORT_CLEAR = TOUCH_CLEAR + 4;
/** Штраф за срез в касании (растёт вглубь — так из двух зол выбирается меньшее). */
const TOUCH_COST = 50;
const TOUCH_SLOPE = 5;
/** Штраф за срез вплотную к препятствию; линейно спадает до нуля к COMFORT_CLEAR. */
const CROWD_COST = 0.25;
/** Запас по глубине: нарисованные корабль и объект длиннее своих хитбоксов. */
const DEPTH_PAD = 5;
/**
 * Пружина начинает поворот раньше плана и заканчивает позже — на время упреждения.
 * Поэтому безопасное место нужно занять заранее и не покидать сразу; за эти
 * «поля» вокруг пролёта штраф слабее, чем за сам пролёт.
 */
const SETTLE_WEIGHT = 0.1;
/** Ценность редкой сферы относительно обычной. */
const RARE_WORTH = 3;
/** Доля зоны подбора, в которую целится план (остальное — запас на сглаживание). */
const AIM = 0.55;
/** На краю этой зоны сфера ценится на столько меньше: корабль берёт сферы серединой, а не боком. */
const OFF_CENTER_LOSS = 0.4;
/**
 * Цена сдвига на клетку за срез; растёт с квадратом сдвига. Корабль не ёрзает ради
 * мелочей и начинает манёвр заранее, а не рывком в последний момент.
 */
const MOVE_COST = 0.012;
/** Покачивание на пустой дороге: синус с периодом 4 такта. */
const WEAVE_AMP = 16;
const WEAVE_PERIOD = 4 * TICKS_PER_BAR;
/** Цена отклонения от линии покачивания за единицу и срез — много меньше одной сферы. */
const WEAVE_COST = 0.0012;

// ─── Ведение ────────────────────────────────────────────────────────────────

/** Собственная частота пружины, рад/с: поворот занимает ~0.2 с. */
const OMEGA = 12;
/** Упреждение, равное запаздыванию пружины на равномерном движении (2/ω секунд). */
const LOOKAHEAD_TICKS = 2 / OMEGA / TICK_DT;
/** Предел ускорения, ед/с²: смена плана не дёргает корабль. */
const MAX_ACCEL = 1200;

function cellX(i: number): number {
  return SHIP_MIN_X + i * CELL;
}

function cellOf(x: number): number {
  return clamp(Math.round((x - SHIP_MIN_X) / CELL), 0, CELLS - 1);
}

function weaveX(tick: number): number {
  return WORLD.roadW / 2 + WEAVE_AMP * Math.sin((TAU * tick) / WEAVE_PERIOD);
}

/** Штраф за близость к препятствию при зазоре clear между центром корабля и его краем. */
function crowding(clear: number): number {
  if (clear >= COMFORT_CLEAR) return 0;
  if (clear >= TOUCH_CLEAR) return (CROWD_COST * (COMFORT_CLEAR - clear)) / (COMFORT_CLEAR - TOUCH_CLEAR);
  return TOUCH_COST + TOUCH_SLOPE * (TOUCH_CLEAR - clear);
}

export class Autopilot {
  /** gain[k·CELLS + i] — выгода стоять в клетке i в конце среза k. */
  private readonly gain = new Float64Array((SLICES + 1) * CELLS);
  /** value[k·CELLS + i] — лучшая суммарная выгода от среза k до горизонта. */
  private readonly value = new Float64Array((SLICES + 1) * CELLS);
  /** Найденный путь: X корабля в конце каждого среза (path[0] — в момент плана). */
  private readonly path = new Float64Array(SLICES + 1);
  private planTick = 0;
  private planned = false;

  /** Забыть план (новая сцена). */
  reset(): void {
    this.planned = false;
  }

  /** Один тик: при необходимости обновить план и сдвинуть корабль к нему. */
  drive(state: SimState): void {
    if (!this.planned || state.tick - this.planTick >= REPLAN_TICKS) this.plan(state);
    const p = state.player;
    const target = this.pathAt(state.tick + LOOKAHEAD_TICKS);
    const accel = OMEGA * OMEGA * (target - p.x) - 2 * OMEGA * p.vx;
    p.vx += clamp(accel, -MAX_ACCEL, MAX_ACCEL) * TICK_DT;
    moveShip(p);
  }

  /** Точка плана в момент tick (между срезами — линейно). */
  private pathAt(tick: number): number {
    const s = Math.max(0, (tick - this.planTick) / SLICE);
    const k = Math.floor(s);
    if (k >= SLICES) return this.path[SLICES];
    return this.path[k] + (this.path[k + 1] - this.path[k]) * (s - k);
  }

  private plan(state: SimState): void {
    const t0 = state.tick;
    this.planTick = t0;
    this.planned = true;
    this.gain.fill(0);
    for (let i = 0; i < state.obstacles.length; i++) this.markObstacle(state.obstacles[i], t0);
    for (let i = 0; i < state.crystals.length; i++) this.markCrystal(state.crystals[i], t0);
    this.solve(t0, state.player.x);
  }

  /** Срезы, в которых препятствие стоит на линии корабля, получают штраф вокруг него. */
  private markObstacle(o: Obstacle, t0: number): void {
    if (o.destroyed) return;
    const gain = this.gain;
    const span = ((depthReach(o) + DEPTH_PAD) * o.approachTicks) / WORLD.zFar;
    const passFrom = Math.ceil((o.arriveTick - span - t0) / SLICE);
    const passTo = Math.ceil((o.arriveTick + span - t0) / SLICE);
    const first = Math.max(1, Math.ceil((o.arriveTick - span - LOOKAHEAD_TICKS - t0) / SLICE));
    const last = Math.min(SLICES, Math.ceil((o.arriveTick + span + LOOKAHEAD_TICKS - t0) / SLICE));
    const laser = o.kind === 'laser';
    // Куб вращается: берём наибольший поперечный размер.
    const half = o.kind === 'cube' ? o.halfW * Math.SQRT2 : o.halfW;
    for (let k = first; k <= last; k++) {
      const weight = k >= passFrom && k <= passTo ? 1 : SETTLE_WEIGHT;
      // За срез объект успевает сместиться зигзагом — учитываем оба его положения.
      const xa = obstacleX(o, t0 + (k - 1) * SLICE);
      const xb = obstacleX(o, t0 + k * SLICE);
      const lo = Math.min(xa, xb);
      const hi = Math.max(xa, xb);
      const row = k * CELLS;
      if (laser) {
        // Луч опасен всюду, кроме прохода (за срез от прохода остаётся пересечение его положений).
        for (let i = 0; i < CELLS; i++) {
          const x = cellX(i);
          gain[row + i] -= weight * crowding(Math.min(x - (hi - half), lo + half - x));
        }
      } else {
        // Куб и пила мешают только рядом с собой.
        const from = Math.max(0, Math.ceil((lo - half - COMFORT_CLEAR - SHIP_MIN_X) / CELL));
        const to = Math.min(CELLS - 1, Math.floor((hi + half + COMFORT_CLEAR - SHIP_MIN_X) / CELL));
        for (let i = from; i <= to; i++) {
          const x = cellX(i);
          gain[row + i] -= weight * crowding(Math.max(lo - half - x, x - hi - half));
        }
      }
    }
  }

  /** Сфера делает выгодными клетки под собой в срезе прилёта и в срезе перед ним. */
  private markCrystal(c: Crystal, t0: number): void {
    if (c.state !== 'live') return;
    const k = Math.ceil((c.arriveTick - t0) / SLICE);
    if (k < 1 || k > SLICES) return;
    const gain = this.gain;
    const x = crystalBaseX(c, c.arriveTick);
    const reach = pickupReach(c.rare) * AIM;
    const from = Math.max(0, Math.ceil((x - reach - SHIP_MIN_X) / CELL));
    const to = Math.min(CELLS - 1, Math.floor((x + reach - SHIP_MIN_X) / CELL));
    const worth = (c.rare ? RARE_WORTH : 1) / 2;
    // Корабль должен быть на месте к началу и к концу среза — тогда сфера точно взята.
    const before = Math.max(1, k - 1) * CELLS;
    const row = k * CELLS;
    for (let i = from; i <= to; i++) {
      const share = worth * (1 - (OFF_CENTER_LOSS * Math.abs(cellX(i) - x)) / reach);
      gain[before + i] += share;
      gain[row + i] += share;
    }
  }

  /** Обратный проход считает ценность клеток, прямой — выбирает путь от корабля. */
  private solve(t0: number, startX: number): void {
    const { gain, value, path } = this;
    for (let k = SLICES; k >= 1; k--) {
      const row = k * CELLS;
      const lane = weaveX(t0 + k * SLICE);
      for (let i = 0; i < CELLS; i++) {
        let future = 0;
        if (k < SLICES) {
          const ahead = this.bestStep(k + 1, i);
          future = value[row + CELLS + ahead] - (ahead - i) * (ahead - i) * MOVE_COST;
        }
        value[row + i] = gain[row + i] - WEAVE_COST * Math.abs(cellX(i) - lane) + future;
      }
    }
    let i = cellOf(startX);
    path[0] = startX;
    for (let k = 1; k <= SLICES; k++) {
      i = this.bestStep(k, i);
      path[k] = cellX(i);
    }
    // Путь идёт по центрам клеток — «лесенкой». Два прохода фильтра 1-2-1 скругляют ступеньки.
    for (let pass = 0; pass < 2; pass++) {
      let prev = path[0];
      for (let k = 1; k < SLICES; k++) {
        const here = path[k];
        path[k] = (prev + 2 * here + path[k + 1]) / 4;
        prev = here;
      }
    }
  }

  /** Лучшая клетка среза k, достижимая из клетки i прошлого среза (при равенстве — ближайшая). */
  private bestStep(k: number, i: number): number {
    const value = this.value;
    const row = k * CELLS;
    let bestCell = i;
    let best = value[row + i];
    for (let shift = 1; shift <= MAX_SHIFT; shift++) {
      const cost = shift * shift * MOVE_COST;
      if (i - shift >= 0 && value[row + i - shift] - cost > best) {
        best = value[row + i - shift] - cost;
        bestCell = i - shift;
      }
      if (i + shift < CELLS && value[row + i + shift] - cost > best) {
        best = value[row + i + shift] - cost;
        bestCell = i + shift;
      }
    }
    return bestCell;
  }
}
