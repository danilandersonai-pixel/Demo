/**
 * Проверка честности трека и бот-планировщик.
 *
 *  • verifyChart — доказывает, что трек проходим: «волна» достижимых позиций
 *    корабля, который движется не быстрее заданной скорости, ни разу не
 *    обрывается. Проверка консервативная: если она прошла, путь точно есть.
 *  • planMove — бот, который играет по состоянию симуляции: динамическим
 *    программированием ищет безопасный путь на несколько секунд вперёд и по
 *    дороге собирает сферы. Нужен тестам, инструментам баланса и e2e-прогону.
 *
 * Оба работают на сетке: дорога режется на клетки по CELL единиц, время — на
 * срезы по SLICE тиков. Клетка среза считается занятой, если корабль в ней
 * задел бы препятствие в ЛЮБОЙ тик этого среза.
 */
import { contactAt, dangerWindow, type Contact } from './collision';
import { GAME, WORLD } from './config';
import { isObstacleSpec, makeObstacle } from './entities';
import { crystalBaseX, pickupReach } from './motion';
import { TICK_DT, TICKS_PER_BAR } from './timing';
import type { ChartSource, InputFrame, Obstacle, SimState } from './types';

const CELL = 1;
const SLICE = 4;

const CELLS = Math.floor((WORLD.roadW - 2 * GAME.player.edge) / CELL) + 1;

function cellX(i: number): number {
  return GAME.player.edge + i * CELL;
}

function cellOf(x: number): number {
  return Math.min(CELLS - 1, Math.max(0, Math.round((x - GAME.player.edge) / CELL)));
}

/** Сколько клеток корабль проходит за срез на скорости speed (с округлением вниз — консервативно). */
function cellsPerSlice(speed: number): number {
  return Math.floor((speed * SLICE * TICK_DT) / CELL);
}

const contact: Contact = { inRange: false, clear: Infinity };

/** Отметить клетки, занятые препятствием, в срезах сетки, начинающейся с тика t0. */
function markBlocked(blocked: Uint8Array, slices: number, o: Obstacle, t0: number, margin: number): void {
  if (o.destroyed) return;
  const w = dangerWindow(o);
  const from = Math.max(w.from, t0);
  const to = Math.min(w.to, t0 + (slices - 1) * SLICE);
  for (let t = from; t <= to; t++) {
    const k = Math.ceil((t - t0) / SLICE);
    const row = k * CELLS;
    for (let i = 0; i < CELLS; i++) {
      if (blocked[row + i]) continue;
      contactAt(o, t, cellX(i), contact);
      if (contact.inRange && contact.clear < margin) blocked[row + i] = 1;
    }
  }
}

// ─── Проверка честности ─────────────────────────────────────────────────────

export interface VerifyOptions {
  /** Сколько тактов от GO проверять. */
  bars: number;
  /** Предельная скорость корабля, ед/с (по умолчанию GAME.fairness.assumedSpeed). */
  speed?: number;
  /** Запас вокруг препятствий, единицы (по умолчанию 1). */
  margin?: number;
}

export interface VerifyResult {
  ok: boolean;
  /** Тик, на котором безопасных позиций не осталось; null — трек проходим. */
  failTick: number | null;
  /** Самое узкое место: наименьшее число достижимых клеток за всю проверку. */
  minReachable: number;
  obstacles: number;
}

/** Собрать препятствия из тактов [0, bars) — в том же порядке, что запросит симуляция. */
export function collectObstacles(chart: ChartSource, bars: number): Obstacle[] {
  const out: Obstacle[] = [];
  for (let b = 0; b < bars; b++) {
    for (const item of chart.bar(b)) {
      if (isObstacleSpec(item)) out.push(makeObstacle(item, out.length + 1));
    }
  }
  return out;
}

/** Проходим ли набор препятствий кораблём со скоростью ≤ speed, стартующим из любой точки дороги. */
export function verifyObstacles(obstacles: Obstacle[], options: VerifyOptions): VerifyResult {
  const speed = options.speed ?? GAME.fairness.assumedSpeed;
  const margin = options.margin ?? 1;
  const reachPerSlice = cellsPerSlice(speed);
  const slices = Math.ceil((options.bars * TICKS_PER_BAR) / SLICE) + 1;
  const blocked = new Uint8Array(slices * CELLS);
  for (const o of obstacles) markBlocked(blocked, slices, o, 0, margin);

  let reach = new Uint8Array(CELLS).fill(1);
  let next = new Uint8Array(CELLS);
  let minReachable = CELLS;
  for (let k = 0; k < slices; k++) {
    const row = k * CELLS;
    let count = 0;
    next.fill(0);
    for (let i = 0; i < CELLS; i++) {
      if (blocked[row + i]) continue;
      // Клетка достижима, если в прошлом срезе корабль мог быть не дальше reachPerSlice клеток от неё.
      const lo = Math.max(0, i - reachPerSlice);
      const hi = Math.min(CELLS - 1, i + reachPerSlice);
      for (let j = lo; j <= hi; j++) {
        if (reach[j]) {
          next[i] = 1;
          count++;
          break;
        }
      }
    }
    if (count === 0) return { ok: false, failTick: k * SLICE, minReachable: 0, obstacles: obstacles.length };
    if (count < minReachable) minReachable = count;
    const swap = reach;
    reach = next;
    next = swap;
  }
  return { ok: true, failTick: null, minReachable, obstacles: obstacles.length };
}

/** Проходим ли трек (см. verifyObstacles). */
export function verifyChart(chart: ChartSource, options: VerifyOptions): VerifyResult {
  return verifyObstacles(collectObstacles(chart, options.bars), options);
}

// ─── Бот-планировщик ────────────────────────────────────────────────────────

export interface BotOptions {
  /** Предельная скорость бота, ед/с (по умолчанию 110 — уверенный, но не идеальный игрок). */
  speed?: number;
  /** Запас вокруг препятствий, единицы (по умолчанию 1.2). */
  margin?: number;
  /** Собирать сферы (по умолчанию да). */
  crystals?: boolean;
  /** Насколько далеко смотреть, тики (по умолчанию 320 — весь видимый участок дороги). */
  horizonTicks?: number;
}

const NEG = -1e9;
let bufBlocked = new Uint8Array(0);
let bufReward = new Float32Array(0);
let bufValue = new Float32Array(0);

/**
 * Ход бота на текущий тик: ввод «указателем», который ведёт корабль по
 * найденному пути. Симуляция двигает корабль к pointerX со скоростью
 * (pointerX − x)·pointerFollow, поэтому бот задаёт цель так, чтобы получить
 * ровно нужную скорость.
 */
export function planMove(state: SimState, options: BotOptions = {}): InputFrame {
  const speed = options.speed ?? 110;
  const margin = options.margin ?? 1.2;
  const wantCrystals = options.crystals ?? true;
  const slices = Math.ceil((options.horizonTicks ?? 320) / SLICE) + 1;
  const size = slices * CELLS;
  if (bufBlocked.length < size) {
    bufBlocked = new Uint8Array(size);
    bufReward = new Float32Array(size);
    bufValue = new Float32Array(size);
  }
  const blocked = bufBlocked.fill(0, 0, size);
  const reward = bufReward.fill(0, 0, size);
  const value = bufValue;
  const t0 = state.tick;

  for (const o of state.obstacles) markBlocked(blocked, slices, o, t0, margin);

  if (wantCrystals) {
    for (const c of state.crystals) {
      if (c.state !== 'live') continue;
      const k = Math.ceil((c.arriveTick - t0) / SLICE);
      if (k < 0 || k >= slices) continue;
      const cx = crystalBaseX(c, c.arriveTick) + c.pull;
      // Целимся в середину зоны подбора, чтобы запаса хватило на неточность.
      const reach = pickupReach(c.rare) * 0.55;
      const gain = c.rare ? 5 : 1;
      const lo = cellOf(cx - reach);
      const hi = cellOf(cx + reach);
      for (let i = lo; i <= hi; i++) {
        if (Math.abs(cellX(i) - cx) <= reach) reward[k * CELLS + i] += gain;
      }
    }
  }

  const step = Math.max(1, cellsPerSlice(speed));
  // Обратный проход: value[k][i] — лучшая награда, если стоять в клетке i в срезе k и выжить до горизонта.
  for (let k = slices - 1; k >= 0; k--) {
    const row = k * CELLS;
    for (let i = 0; i < CELLS; i++) {
      if (blocked[row + i]) {
        value[row + i] = NEG;
        continue;
      }
      let best = 0;
      if (k < slices - 1) {
        best = NEG;
        const lo = Math.max(0, i - step);
        const hi = Math.min(CELLS - 1, i + step);
        const nextRow = row + CELLS;
        for (let j = lo; j <= hi; j++) {
          // Маленький штраф за движение: бот не дёргается без причины.
          const v = value[nextRow + j] - Math.abs(j - i) * 0.002;
          if (v > best) best = v;
        }
      }
      value[row + i] = best <= NEG / 2 ? NEG : best + reward[row + i] + 0.01;
    }
  }

  const here = cellOf(state.player.x);
  const lo = Math.max(0, here - step);
  const hi = Math.min(CELLS - 1, here + step);
  let target = here;
  let bestValue = NEG * 2;
  for (let j = lo; j <= hi; j++) {
    const v = value[CELLS + j] - Math.abs(j - here) * 0.002;
    if (v > bestValue) {
      bestValue = v;
      target = j;
    }
  }

  const dt = SLICE * TICK_DT;
  const wanted = Math.max(-speed, Math.min(speed, (cellX(target) - state.player.x) / dt));
  return { axis: 0, pointerX: state.player.x + wanted / GAME.player.pointerFollow, source: 'pointer' };
}
