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
 * задел бы препятствие в ЛЮБОЙ тик этого среза. Планировщик строже проверки:
 * он учитывает и пробу столкновения на полтика, и клетки, через которые
 * корабль проезжает внутри среза (см. комментарий перед planMove).
 */
import { gateCells, solidCells, type Span } from './chart-probe';
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

/**
 * Модель планировщика — та же сетка, что у verifyObstacles, но без её допущений:
 *  • срезы привязаны к абсолютному времени (границы — тики, кратные SLICE), а
 *    не к текущему тику: план не «плывёт» от вызова к вызову, и корабль
 *    приходит в центр клетки ровно на границе среза;
 *  • клетка среза занята, если корабль задел бы препятствие в любой из двух
 *    проб каждого тика среза (t − 0.5 и t) — как их берёт симуляция (сами
 *    клетки считает chart-probe.ts — та же проба, что у коридора генератора);
 *  • ход из клетки i в клетку j за срез требует, чтобы были свободны ВСЕ клетки
 *    между ними: корабль не срезает угол сквозь препятствие.
 * Раз корабль едет между центрами клеток с постоянной скоростью, в любой пробе
 * он не дальше половины клетки от проверенной точки — поэтому жёсткий запас
 * HARD_MARGIN больше половины клетки, и найденный путь безопасен на самом деле.
 */
const HARD_MARGIN = 0.6;
/** Запас и ход «честного» игрока — те же, с какими трек проверяет verifyObstacles. */
const FAIR_MARGIN = 1;
const FAIR_STEP = cellsPerSlice(GAME.fairness.assumedSpeed);
const WORDS = Math.ceil(CELLS / 32);
const TAIL_MASK = CELLS % 32 === 0 ? 0xffffffff : 2 ** (CELLS % 32) - 1;

// Цена пути. Порядок величин задаёт приоритеты: выжить → не покидать позиции,
// из которых трек проходим на расчётной скорости → держать запас → сферы → плавность.
/** За срез вне «честно живых» клеток: оттуда новое препятствие может запереть. */
const OFF_FAIR_COST = 1000;
/** За срез ближе запаса margin к препятствию. */
const NEAR_COST = 25;
const CRYSTAL_GAIN = 1;
const RARE_GAIN = 5;
/** Ход на d клеток за срез: выпуклая цена — манёвр начинается заранее и идёт ровно, без рывка в последний миг. */
const MOVE_LINEAR = 0.004;
const MOVE_SQUARE = 0.003;
/** Гибель в срезе k: чем позже, тем «лучше» — безвыходный план тянет время до последнего. */
const DEAD = -1e12;
const DEAD_STEP = 1e6;
const DEAD_LIMIT = -1e9;
/** Доля зоны подбора, в которую бот целится (запас на неточность). */
const PICKUP_AIM = 0.55;
/** Погрешность положения корабля, пришедшего в центр клетки. */
const SNAP = 1e-6;
/** Цены путей, которые отличаются меньше чем на это, считаются равными. */
const TIE = 1e-9;

/**
 * След препятствия на сетке: по срезам его окна опасности — отрезки клеток для
 * трёх запасов (жёсткий, честный, запас бота). У куба и пилы отрезок — занятые
 * клетки, у лазера — свободные (проход). След зависит только от самого
 * препятствия, поэтому считается один раз за его жизнь.
 */
interface Footprint {
  arriveTick: number;
  approachTicks: number;
  x: number;
  halfW: number;
  yaw0: number;
  yawRate: number;
  sway: Obstacle['sway'];
  soft: number;
  laser: boolean;
  firstRow: number;
  rows: number;
  /** На срез шесть чисел: [lo, hi] для каждого из трёх запасов; lo > hi — отрезок пуст. */
  spans: Int16Array;
}

const footprints = new WeakMap<Obstacle, Footprint>();
const probe: Span = { lo: 0, hi: 0 };

function footprintOf(o: Obstacle, soft: number): Footprint {
  const known = footprints.get(o);
  if (
    known &&
    known.soft === soft &&
    known.arriveTick === o.arriveTick &&
    known.approachTicks === o.approachTicks &&
    known.x === o.x &&
    known.halfW === o.halfW &&
    known.yaw0 === o.yaw0 &&
    known.yawRate === o.yawRate &&
    known.sway === o.sway
  ) {
    return known;
  }

  const w = dangerWindow(o);
  const firstRow = Math.ceil(w.from / SLICE);
  const rows = Math.ceil(w.to / SLICE) - firstRow + 1;
  const laser = o.kind === 'laser';
  const spans = new Int16Array(rows * 6);
  // Куб и пила: отрезок занятых клеток растёт от пустого. Лазер: проход сужается от всей дороги.
  for (let i = 0; i < spans.length; i += 2) {
    spans[i] = laser ? 0 : CELLS;
    spans[i + 1] = laser ? CELLS - 1 : -1;
  }
  for (let t = w.from; t <= w.to; t++) {
    const row = (Math.ceil(t / SLICE) - firstRow) * 6;
    // Обе пробы столкновения этого тика: t − 0.5 и t.
    for (let half = 0; half < 2; half++) {
      const time = t - half * 0.5;
      for (let m = 0; m < 3; m++) {
        const margin = m === 0 ? HARD_MARGIN : m === 1 ? FAIR_MARGIN : soft;
        const s = row + m * 2;
        if (laser) {
          if (!gateCells(o, time, margin, probe)) break;
          if (probe.lo > spans[s]) spans[s] = probe.lo;
          if (probe.hi < spans[s + 1]) spans[s + 1] = probe.hi;
        } else if (solidCells(o, time, margin, probe)) {
          if (probe.lo < spans[s]) spans[s] = probe.lo;
          if (probe.hi > spans[s + 1]) spans[s + 1] = probe.hi;
        }
      }
    }
  }
  const made: Footprint = {
    arriveTick: o.arriveTick,
    approachTicks: o.approachTicks,
    x: o.x,
    halfW: o.halfW,
    yaw0: o.yaw0,
    yawRate: o.yawRate,
    sway: o.sway,
    soft,
    laser,
    firstRow,
    rows,
    spans,
  };
  footprints.set(o, made);
  return made;
}

/** Обнулить биты lo…hi битовой строки. */
function clearBits(rows: Uint32Array, o: number, lo: number, hi: number): void {
  for (let w = lo >> 5; w <= hi >> 5; w++) {
    const from = Math.max(lo, w * 32) - w * 32;
    const count = Math.min(hi, w * 32 + 31) - w * 32 - from + 1;
    rows[o + w] &= ~((2 ** count - 1) * 2 ** from);
  }
}

/** Ход на клетку в обе стороны, не выходя из свободных клеток free (на месте). */
function spread(rows: Uint32Array, o: number, free: Uint32Array, f: number): void {
  let prev = 0;
  for (let w = 0; w < WORDS; w++) {
    const cur = rows[o + w];
    const next = w + 1 < WORDS ? rows[o + w + 1] : 0;
    rows[o + w] = (cur | (cur << 1) | (prev >>> 31) | (cur >>> 1) | (next << 31)) & free[f + w];
    prev = cur;
  }
}

function moveCost(cells: number): number {
  return MOVE_LINEAR * cells + MOVE_SQUARE * cells * cells;
}

let bufBlocked = new Uint8Array(0);
let bufScore = new Float64Array(0);
let bufValue = new Float64Array(0);
let bufFairFree = new Uint32Array(0);
let bufFairAlive = new Uint32Array(0);
const seen: Footprint[] = [];
const moveCosts: number[] = [];

/**
 * Ход бота на текущий тик: ввод «указателем», который ведёт корабль по
 * найденному пути. Симуляция двигает корабль к pointerX со скоростью
 * (pointerX − x)·pointerFollow, поэтому бот задаёт цель так, чтобы получить
 * ровно нужную скорость и прийти в выбранную клетку точно к границе среза.
 *
 * Путь ищется динамическим программированием по срезам до горизонта. Жёстко
 * запрещено только столкновение (запас HARD_MARGIN); остальное — цена: бот
 * держится позиций, из которых видимый участок проходим на расчётной скорости
 * честности (честный трек никогда не делает такую позицию гибельной, когда
 * из дымки появляется новое препятствие), соблюдает запас margin, где это
 * возможно, и по дороге собирает сферы.
 */
export function planMove(state: SimState, options: BotOptions = {}): InputFrame {
  const speed = Math.min(Math.max(options.speed ?? 110, 0), GAME.player.pointerMaxSpeed);
  const soft = Math.max(options.margin ?? 1.2, HARD_MARGIN);
  const wantCrystals = options.crystals ?? true;
  const maxRows = Math.max(1, Math.ceil((options.horizonTicks ?? 320) / SLICE));
  const step = Math.max(1, cellsPerSlice(speed));
  const fairStep = Math.min(step, FAIR_STEP);
  const px = state.player.x;
  const t0 = state.tick;
  // Срез k (от нуля) покрывает тики (base + 4k − 4, base + 4k]; base — ближайшая граница впереди.
  const firstRow = Math.floor(t0 / SLICE) + 1;
  const left = firstRow * SLICE - t0;

  // Горизонт: дальше последнего видимого объекта дорога пуста и на выбор хода не влияет.
  let lastRow = firstRow;
  seen.length = 0;
  for (const o of state.obstacles) {
    if (o.destroyed) continue;
    const fp = footprintOf(o, soft);
    const end = fp.firstRow + fp.rows - 1;
    if (end < firstRow) continue;
    seen.push(fp);
    if (end > lastRow) lastRow = end;
  }
  if (wantCrystals) {
    for (const c of state.crystals) {
      if (c.state !== 'live') continue;
      const row = Math.ceil(c.arriveTick / SLICE);
      if (row > lastRow) lastRow = row;
    }
  }
  const rows = Math.min(maxRows, lastRow - firstRow + 1);
  const size = rows * CELLS;
  if (bufBlocked.length < size) {
    bufBlocked = new Uint8Array(size);
    bufScore = new Float64Array(size);
    bufValue = new Float64Array(size);
    bufFairFree = new Uint32Array(rows * WORDS);
    bufFairAlive = new Uint32Array(rows * WORDS);
  }
  const blocked = bufBlocked.fill(0, 0, size);
  const score = bufScore.fill(0, 0, size);
  const value = bufValue;
  const fairFree = bufFairFree.fill(0xffffffff, 0, rows * WORDS);
  const fairAlive = bufFairAlive;
  for (let k = 0; k < rows; k++) fairFree[k * WORDS + WORDS - 1] = TAIL_MASK;

  // Препятствия: жёсткий запрет, «честная» занятость и штраф за близость.
  for (const fp of seen) {
    const from = Math.max(fp.firstRow, firstRow);
    const to = Math.min(fp.firstRow + fp.rows - 1, firstRow + rows - 1);
    for (let row = from; row <= to; row++) {
      const s = (row - fp.firstRow) * 6;
      const k = row - firstRow;
      const cells = k * CELLS;
      const words = k * WORDS;
      const spans = fp.spans;
      if (fp.laser) {
        // Отрезки — свободный проход; занято всё, что снаружи.
        for (let i = 0; i < CELLS; i++) {
          if (i < spans[s] || i > spans[s + 1]) blocked[cells + i] = 1;
          if (i < spans[s + 4] || i > spans[s + 5]) score[cells + i] -= NEAR_COST;
        }
        if (spans[s + 2] > spans[s + 3]) {
          for (let w = 0; w < WORDS; w++) fairFree[words + w] = 0;
        } else {
          if (spans[s + 2] > 0) clearBits(fairFree, words, 0, spans[s + 2] - 1);
          if (spans[s + 3] < CELLS - 1) clearBits(fairFree, words, spans[s + 3] + 1, CELLS - 1);
        }
      } else {
        for (let i = spans[s]; i <= spans[s + 1]; i++) blocked[cells + i] = 1;
        for (let i = spans[s + 4]; i <= spans[s + 5]; i++) score[cells + i] -= NEAR_COST;
        if (spans[s + 2] <= spans[s + 3]) clearBits(fairFree, words, spans[s + 2], spans[s + 3]);
      }
    }
  }

  // Сферы: награда клеткам, из которых корабль на границе среза дотянется до сферы в тик её прилёта.
  if (wantCrystals) {
    for (const c of state.crystals) {
      if (c.state !== 'live') continue;
      const row = Math.ceil(c.arriveTick / SLICE);
      const k = row - firstRow;
      if (k < 0 || k >= rows) continue;
      const cx = crystalBaseX(c, c.arriveTick) + c.pull;
      const reach = pickupReach(c.rare);
      // Граница среза позже прилёта; если сфера к ней уже улетит за корабль, зона сужается на путь,
      // который корабль успеет пройти между последним тиком подбора и границей.
      const late = Math.max(0, row * SLICE - c.arriveTick - Math.floor((reach * c.approachTicks) / WORLD.zFar));
      const aim = Math.min(reach * PICKUP_AIM, reach - CELL / 2 - (step * CELL * late) / SLICE);
      const gain = c.rare ? RARE_GAIN : CRYSTAL_GAIN;
      for (let i = cellOf(cx - aim); i <= cellOf(cx + aim); i++) {
        if (Math.abs(cellX(i) - cx) <= aim) score[k * CELLS + i] += gain;
      }
    }
  }

  // «Честно живые» клетки: из них видимый участок проходим с запасом и ходом честного игрока.
  const lastWords = (rows - 1) * WORDS;
  for (let w = 0; w < WORDS; w++) fairAlive[lastWords + w] = fairFree[lastWords + w];
  for (let o = lastWords - WORDS; o >= 0; o -= WORDS) {
    for (let w = 0; w < WORDS; w++) fairAlive[o + w] = fairAlive[o + WORDS + w];
    for (let pass = 0; pass < fairStep; pass++) spread(fairAlive, o, fairFree, o + WORDS);
    for (let w = 0; w < WORDS; w++) fairAlive[o + w] &= fairFree[o + w];
  }

  while (moveCosts.length <= step) moveCosts.push(moveCost(moveCosts.length));

  // Обратный проход: value[k][i] — лучшая цена пути, если на границе среза k стоять в клетке i.
  for (let k = rows - 1; k >= 0; k--) {
    const row = k * CELLS;
    const next = row + CELLS;
    const words = k * WORDS;
    const final = k === rows - 1;
    for (let i = 0; i < CELLS; i++) {
      if (blocked[row + i]) {
        value[row + i] = DEAD + k * DEAD_STEP;
        continue;
      }
      let best = 0;
      if (!final) {
        if (blocked[next + i]) {
          // Клетка закрывается в следующем срезе раньше, чем корабль успеет её покинуть.
          value[row + i] = DEAD + (k + 1) * DEAD_STEP;
          continue;
        }
        best = value[next + i];
        for (let d = 1; d <= step; d++) {
          const j = i + d;
          if (j >= CELLS || blocked[next + j]) break;
          const v = value[next + j] - moveCosts[d];
          if (v > best) best = v;
        }
        for (let d = 1; d <= step; d++) {
          const j = i - d;
          if (j < 0 || blocked[next + j]) break;
          const v = value[next + j] - moveCosts[d];
          if (v > best) best = v;
        }
        if (best < DEAD_LIMIT) {
          value[row + i] = best;
          continue;
        }
      }
      const alive = (fairAlive[words + (i >> 5)] >>> (i & 31)) & 1;
      value[row + i] = best + score[row + i] - (alive ? 0 : OFF_FAIR_COST);
    }
  }

  // Первый ход — из настоящего положения корабля (оно может быть между клетками и посреди среза).
  // При равной цене выбирается ход подальше: из равноценных планов бот берёт тот, где манёвр начинается раньше.
  const reachNow = speed * left * TICK_DT + SNAP;
  const at = (px - GAME.player.edge) / CELL;
  const cellLo = Math.min(CELLS - 1, Math.max(0, Math.floor(at + SNAP)));
  const cellHi = Math.min(CELLS - 1, Math.max(0, Math.ceil(at - SNAP)));
  let target = -1;
  let bestValue = -Infinity;
  let bestDistance = 0;
  if (!blocked[cellLo] && !blocked[cellHi]) {
    for (let side = 1; side >= -1; side -= 2) {
      for (let j = side > 0 ? cellHi : cellLo; j >= 0 && j < CELLS && !blocked[j]; j += side) {
        const distance = (cellX(j) - px) * side;
        if (distance > reachNow) break;
        const v = value[j] - moveCost(Math.abs(distance) / CELL);
        if (v > bestValue + TIE || (v > bestValue - TIE && distance > bestDistance)) {
          bestValue = v;
          bestDistance = distance;
          target = j;
        }
      }
    }
  }
  if (target < 0) {
    // Корабль уже в занятой клетке (его сбили с плана): лучший из достижимых исходов без гарантий.
    target = cellOf(px);
    for (let j = 0; j < CELLS; j++) {
      const distance = Math.abs(cellX(j) - px);
      if (distance > reachNow) continue;
      const v = value[j] - moveCost(distance / CELL);
      if (v > bestValue) {
        bestValue = v;
        target = j;
      }
    }
  }

  const wanted = Math.max(-speed, Math.min(speed, (cellX(target) - px) / (left * TICK_DT)));
  return { axis: 0, pointerX: px + wanted / GAME.player.pointerFollow, source: 'pointer' };
}
