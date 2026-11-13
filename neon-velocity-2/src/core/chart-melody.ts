/**
 * Линия мелодии. Сферы трека — это ноты, которые «играет» игрок, поэтому они
 * не разбрасываются случайно, а нанизываются на одну плавную линию:
 *
 *  • Contour — замысел: опорные точки каждые полтакта, между ними плавная дуга.
 *    Препятствия целятся в эту линию, чтобы игроку было от чего уклоняться.
 *  • MelodyLine — исполнение: траектория идеального прохождения через уже
 *    расставленные препятствия. Она ищется динамическим программированием по
 *    золотой полосе коридора: держится замысла, обходит препятствия с запасом
 *    и заранее, не дёргается и идёт не быстрее половины расчётной скорости. Паттерны могут
 *    поставить «манок» — точку, через которую линия обязана стремиться пройти
 *    (центр ворот, просвет слалома).
 *
 * Раз все сферы такта лежат на одной допустимой траектории, соседние сферы
 * цепочки заведомо достижимы друг за другом.
 */
import { CELLS, cellX, GOLD_REACH, rowOf, SLICE, type Corridor } from './chart-corridor';
import { WORLD } from './config';
import { clamp, easeInOutSine, lerp } from './math';
import { TICKS_PER_BAR } from './timing';

/** Линия не подходит к бортикам ближе этого: сферам и кораблю нужен запас. */
export const LINE_MIN = 14;
export const LINE_MAX = WORLD.roadW - LINE_MIN;

const HALF_BAR = TICKS_PER_BAR / 2;
/** Сколько опорных точек хранить (три такта назад хватает любому запросу). */
const KEEP_POINTS = 7;

/** Замысел линии: плавная кривая через опорные точки на границах полутактов. */
export class Contour {
  private points: number[] = [WORLD.roadW / 2];
  /** Номер полутакта первой хранимой точки. */
  private origin = 0;

  /** Последняя опорная точка — начало следующего такта. */
  get end(): number {
    return this.points[this.points.length - 1];
  }

  /** Продлить линию на такт: X в его середине и в конце. */
  extend(mid: number, end: number): void {
    this.points.push(clamp(mid, LINE_MIN, LINE_MAX), clamp(end, LINE_MIN, LINE_MAX));
    while (this.points.length > KEEP_POINTS) {
      this.points.shift();
      this.origin += 1;
    }
  }

  at(tick: number): number {
    const last = this.points.length - 1;
    if (last === 0) return this.points[0];
    const index = clamp(Math.floor(tick / HALF_BAR) - this.origin, 0, last - 1);
    const u = (tick - (this.origin + index) * HALF_BAR) / HALF_BAR;
    return lerp(this.points[index], this.points[index + 1], easeInOutSine(u));
  }
}

/** Точка, к которой линия должна прижаться (проход в паттерне). */
export interface Lure {
  tick: number;
  x: number;
}

// Веса траектории — чистая эстетика линии, на честность не влияют.
/** Насколько манок сильнее замысла. */
const LURE_WEIGHT = 7;
/** Штраф за близость к препятствию по числу клеток до него (индекс 0 не используется). */
const NEAR_COST = [0, 4, 2, 0.8, 0.25];
/** С какого среза до начала такта искать линию, если последняя сфера была давно. */
const LEAD_ROWS = 8;
/** Сглаживание готовой траектории, срезов в каждую сторону. */
const SMOOTH_ROWS = 2;
const UNREACHABLE = 1e9;

function moveCost(cells: number): number {
  // Выпуклый: один быстрый рывок дороже двух спокойных шагов.
  return 0.2 * cells + 0.5 * cells * (cells - 1);
}

const MOVE_COST = Array.from({ length: GOLD_REACH + 1 }, (_, cells) => moveCost(cells));

export class MelodyLine {
  private cost = new Float32Array(0);
  private back = new Int8Array(0);
  private path = new Float32Array(0);
  private targetX = new Float32Array(0);
  private targetW = new Float32Array(0);
  private readonly open = new Uint8Array(CELLS);
  private readonly obstacle = new Uint8Array(CELLS);
  private readonly near = new Float32Array(CELLS);
  private firstRow = 0;
  private rows = 0;

  /**
   * Проложить линию от последней сферы до конца видимого коридора.
   * false — идеального пути нет (тогда такт остаётся без сфер).
   */
  trace(corridor: Corridor, contour: Contour, lures: readonly Lure[], barStart: number): boolean {
    const first = Math.max(corridor.firstRow, corridor.lastCrystalRow, rowOf(barStart) - LEAD_ROWS);
    const rows = corridor.lastRow - first + 1;
    this.firstRow = first;
    this.rows = 0;
    if (rows <= 0) return false;
    this.reserve(rows);

    for (let r = 0; r < rows; r++) {
      this.targetX[r] = contour.at((first + r) * SLICE);
      this.targetW[r] = 1;
    }
    for (const lure of lures) {
      const center = rowOf(lure.tick) - first;
      for (let r = Math.max(0, center - 1); r <= Math.min(rows - 1, center + 1); r++) {
        this.targetX[r] = lure.x;
        this.targetW[r] = LURE_WEIGHT;
      }
    }

    const { cost, back, open, near } = this;
    for (let r = 0; r < rows; r++) {
      corridor.readGold(first + r, open);
      this.measureNear(corridor, first + r);
      const o = r * CELLS;
      const tx = this.targetX[r];
      const tw = this.targetW[r];
      for (let i = 0; i < CELLS; i++) {
        if (!open[i]) {
          cost[o + i] = UNREACHABLE;
          continue;
        }
        let best = 0;
        let from = 0;
        if (r > 0) {
          best = UNREACHABLE;
          const lo = Math.max(0, i - GOLD_REACH);
          const hi = Math.min(CELLS - 1, i + GOLD_REACH);
          for (let j = lo; j <= hi; j++) {
            const c = cost[o - CELLS + j] + MOVE_COST[Math.abs(i - j)];
            if (c < best) {
              best = c;
              from = j - i;
            }
          }
          if (best >= UNREACHABLE) {
            cost[o + i] = UNREACHABLE;
            continue;
          }
        }
        const off = (cellX(i) - tx) / 10;
        cost[o + i] = best + tw * off * off + near[i];
        back[o + i] = from;
      }
    }

    // Лучший конец и путь назад.
    const lastOffset = (rows - 1) * CELLS;
    let cell = -1;
    let bestCost = UNREACHABLE;
    for (let i = 0; i < CELLS; i++) {
      if (cost[lastOffset + i] < bestCost) {
        bestCost = cost[lastOffset + i];
        cell = i;
      }
    }
    if (cell < 0) return false;
    for (let r = rows - 1; r >= 0; r--) {
      this.targetX[r] = cellX(cell);
      cell += back[r * CELLS + cell];
    }
    // Сглаживание убирает «ступеньки» сетки; линия остаётся в пределах зоны сферы.
    for (let r = 0; r < rows; r++) {
      const lo = Math.max(0, r - SMOOTH_ROWS);
      const hi = Math.min(rows - 1, r + SMOOTH_ROWS);
      let sum = 0;
      for (let k = lo; k <= hi; k++) sum += this.targetX[k];
      this.path[r] = sum / (hi - lo + 1);
    }
    this.rows = rows;
    return true;
  }

  /** X линии в тик tick; null — линия туда не проложена. */
  at(tick: number): number | null {
    const r = rowOf(tick) - this.firstRow;
    return r >= 0 && r < this.rows ? this.path[r] : null;
  }

  private reserve(rows: number): void {
    if (this.path.length >= rows) return;
    this.cost = new Float32Array(rows * CELLS);
    this.back = new Int8Array(rows * CELLS);
    this.path = new Float32Array(rows);
    this.targetX = new Float32Array(rows);
    this.targetW = new Float32Array(rows);
  }

  /** near[i] — штраф клетки за соседство с препятствием в этом срезе. */
  private measureNear(corridor: Corridor, row: number): void {
    const { obstacle, near } = this;
    corridor.readObstacles(row, obstacle);
    const far = NEAR_COST.length;
    let distance = far;
    for (let i = 0; i < CELLS; i++) {
      distance = obstacle[i] ? 0 : Math.min(far, distance + 1);
      near[i] = distance;
    }
    distance = far;
    for (let i = CELLS - 1; i >= 0; i--) {
      distance = obstacle[i] ? 0 : Math.min(far, distance + 1);
      const d = Math.min(near[i], distance);
      near[i] = d > 0 && d < far ? NEAR_COST[d] : 0;
    }
  }
}
