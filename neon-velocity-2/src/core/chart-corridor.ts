/**
 * Коридор честности — «совесть» генератора трека.
 *
 * Пока генератор расставляет объекты, коридор ведёт волны достижимых позиций
 * корабля на сетке verifyChart (клетка 1 ед., срез 4 тика, скорость
 * GAME.fairness.assumedSpeed), но строже неё — так, чтобы путь по клеткам был
 * настоящим путём корабля, а не только пометкой на сетке:
 *
 *  • клетка среза занята, если корабль задел бы препятствие в любой из двух
 *    проб каждого тика среза (t − 0.5 и t) — ровно как их берёт симуляция;
 *  • ход из клетки в клетку за срез требует, чтобы были свободны все клетки
 *    между ними: корабль не срезает угол сквозь препятствие.
 * Всё, что проходит такую проверку, заведомо проходит и verifyChart.
 *
 * Волн две:
 *  • свободная полоса — где вообще может быть корабль, не разбившись;
 *  • золотая полоса — где может быть корабль, собравший ВСЕ сферы подряд и
 *    при этом летящий спокойно: вдвое медленнее расчётной скорости
 *    (GOLD_REACH), на расстоянии зоны сферы от препятствий (GOLD_PAD) и
 *    уходя из-под каждого удара заранее (SHADOW_ROWS). Она ведётся по оси
 *    дорожки шириной MIN_GOLD_RUN клеток, так что идеальный путь — не нитка
 *    в одну клетку, а дорожка, на которую ложатся сферы.
 *
 * Группа препятствий принимается, только если после неё:
 *  1) в каждом срезе остаётся «живой» проход не уже GAME.fairness.minGap
 *     («живой» — достижим из прошлого и не ведёт в тупик);
 *  2) ни одна позиция, которая была живой в момент, когда группа появилась
 *     из дымки, не стала смертельной — игрока нельзя поймать тем, чего он
 *     ещё не видел (на это правило опирается бот planMove: он держится живых
 *     позиций и потому не гибнет на честном треке);
 *  3) идеальное комбо остаётся возможным;
 *  4) уже поставленные сферы по-прежнему можно взять, не задев препятствие.
 * Иначе состояние откатывается, и паттерн чинит себя или отказывается.
 *
 * Строки волн — битовые (клетка = бит), а после каждой правки пересчитываются
 * только затронутые срезы, поэтому проверка кандидата стоит микросекунды и
 * генерация такта не даёт рывка кадра.
 */
import { CELL, CELLS, cellOf, cellX, gateCells, solidCells, type Span } from './chart-probe';
import { contactAt, dangerWindow, type Contact } from './collision';
import { GAME } from './config';
import { TICK_DT, TICKS_PER_BAR } from './timing';
import type { Obstacle } from './types';

// ─── Сетка (совпадает с verifyChart и planMove в bot.ts) ────────────────────

export { CELL, CELLS, cellOf, cellX, type Span } from './chart-probe';

/** Длина среза, тики. */
export const SLICE = 4;
/** Клеток за срез на расчётной скорости — с округлением вниз, как у verifyChart. */
export const REACH = Math.floor((GAME.fairness.assumedSpeed * SLICE * TICK_DT) / CELL);
/**
 * Клеток за срез у идеальной линии — половина расчётной скорости: мелодию
 * можно сыграть спокойным манёвром, без рывков на пределе.
 */
export const GOLD_REACH = Math.max(1, Math.floor(REACH / 2));
/** Запас вокруг препятствий, с которым трек обязан быть проходим (тот же, что у verifyChart по умолчанию). */
export const MARGIN = 1;
/**
 * Минимальная длина живого прохода в клетках. n клеток подряд — это проход
 * не уже (n − 1)·CELL + 2·(радиус + запас) между хитбоксами, поэтому +1.
 */
export const MIN_FREE_RUN = Math.ceil((GAME.fairness.minGap - 2 * GAME.player.radius - 2 * MARGIN) / CELL) + 1;
/**
 * Минимальная ширина золотой полосы, клетки (нечётная). Полоса ведётся по
 * своей оси: клетка золотой волны — центр дорожки такой ширины, поэтому
 * непустая волна означает сквозную дорожку, а не просто «где-то есть место».
 */
export const MIN_GOLD_RUN = 3;
const LANE_HALF = (MIN_GOLD_RUN - 1) / 2;
/**
 * Полуширина зоны сферы в золотой полосе, клетки. Уже настоящей зоны подбора:
 * корабль, стоящий в зоне на своём срезе, в тик прилёта гарантированно дотянется.
 */
export const ZONE_CELLS = 3;
/**
 * Упреждение: за столько срезов до удара идеальная линия уже обязана выйти из
 * полосы препятствия. Сферы ведут игрока в сторону заранее, а не в последний
 * миг: нота за восьмую до удара всегда лежит уже на безопасной стороне.
 */
export const SHADOW_ROWS = 7;
/**
 * Идеальная линия держится от полосы препятствия на расстоянии зоны сферы:
 * где бы в зоне игрок ни взял сферу, он не окажется под ударом.
 */
export const GOLD_PAD = ZONE_CELLS;
/** Сфера не ставится ближе этого зазора к хитбоксу препятствия. */
export const CRYSTAL_CLEAR = 1.5;
/** Сколько тиков до и после прилёта сферы её точка должна быть чистой. */
const CRYSTAL_TICKS = 6;

const ROWS_PER_BAR = TICKS_PER_BAR / SLICE;
/** Срезов позади начала такта: до момента появления самого раннего объекта такта. */
const BACK_ROWS = Math.ceil(GAME.approach.base / SLICE) + 5;
/** Срезов после конца такта: туда дотягиваются окна опасности его последних объектов. */
const FRONT_ROWS = 4;
const ROWS = BACK_ROWS + ROWS_PER_BAR + FRONT_ROWS + 1;
export const WORDS = Math.ceil(CELLS / 32);
const TAIL_BITS = CELLS - (WORDS - 1) * 32;
const TAIL_MASK = TAIL_BITS === 32 ? 0xffffffff : 2 ** TAIL_BITS - 1;
/** Слов в одной плоскости сетки (все срезы окна). */
const PLANE = ROWS * WORDS;

/** Срез, в который попадает тик (как у verifyChart: срез k отвечает за тики (4k − 4, 4k]). */
export function rowOf(tick: number): number {
  return Math.ceil(tick / SLICE);
}

export type RejectReason = 'width' | 'reveal' | 'gold' | 'crystal' | 'order' | 'window';

export interface CorridorStats {
  /** Принятые группы препятствий и причины отказов. */
  placed: number;
  rejected: Record<RejectReason, number>;
  crystals: number;
  crystalsRejected: number;
  /** Самый узкий живой проход свободной и золотой полос за весь трек, клетки. */
  narrowestFree: number;
  narrowestGold: number;
  /** Наименьшее число достижимых клеток в срезе (не больше minReachable у verifyChart). */
  narrowestReach: number;
}

// ─── Битовые строки ─────────────────────────────────────────────────────────

/** Поставить биты lo…hi строки. */
function setBits(rows: Uint32Array, o: number, lo: number, hi: number): void {
  for (let w = lo >> 5; w <= hi >> 5; w++) {
    const from = Math.max(lo, w * 32) - w * 32;
    const count = Math.min(hi, w * 32 + 31) - w * 32 - from + 1;
    rows[o + w] |= (2 ** count - 1) * 2 ** from;
  }
}

/** Расширить строку на cells клеток в обе стороны (на месте). */
function widen(rows: Uint32Array, o: number, cells: number): void {
  for (let pass = 0; pass < cells; pass++) {
    let prev = 0;
    for (let w = 0; w < WORDS; w++) {
      const cur = rows[o + w];
      const next = w + 1 < WORDS ? rows[o + w + 1] : 0;
      rows[o + w] = cur | (cur << 1) | (prev >>> 31) | (cur >>> 1) | (next << 31);
      prev = cur;
    }
    rows[o + WORDS - 1] &= TAIL_MASK;
  }
}

/**
 * Ход корабля за срез: строка расширяется на reach клеток, не заходя в занятые
 * клетки строки blocked (на месте). Так клетка достижима, только если свободен
 * весь путь до неё.
 */
function travel(rows: Uint32Array, o: number, blocked: Uint32Array, b: number, reach: number): void {
  for (let pass = 0; pass < reach; pass++) {
    let prev = 0;
    for (let w = 0; w < WORDS; w++) {
      const cur = rows[o + w];
      const next = w + 1 < WORDS ? rows[o + w + 1] : 0;
      rows[o + w] = (cur | (cur << 1) | (prev >>> 31) | (cur >>> 1) | (next << 31)) & ~blocked[b + w];
      prev = cur;
    }
    rows[o + WORDS - 1] &= TAIL_MASK;
  }
}

const runScratch = new Uint32Array(WORDS);

/** В строке есть n занятых бит подряд. Удвоением: бит i выживает, пока заняты i…i+len−1. */
function hasRun(rows: Uint32Array, o: number, n: number): boolean {
  const m = runScratch;
  for (let w = 0; w < WORDS; w++) m[w] = rows[o + w];
  let len = 1;
  while (len < n) {
    const step = Math.min(len, n - len, 31);
    for (let w = 0; w < WORDS; w++) {
      const next = w + 1 < WORDS ? m[w + 1] : 0;
      m[w] &= (m[w] >>> step) | (next << (32 - step));
    }
    len += step;
  }
  for (let w = 0; w < WORDS; w++) if (m[w] !== 0) return true;
  return false;
}

/** Длина самой длинной серии занятых бит. */
function longestRun(rows: Uint32Array, o: number): number {
  const m = runScratch;
  for (let w = 0; w < WORDS; w++) m[w] = rows[o + w];
  for (let length = 0; ; length++) {
    let any = 0;
    for (let w = 0; w < WORDS; w++) {
      any |= m[w];
      m[w] &= (m[w] >>> 1) | ((w + 1 < WORDS ? m[w + 1] : 0) << 31);
    }
    if (any === 0) return length;
  }
}

function countBits(rows: Uint32Array, o: number): number {
  let count = 0;
  for (let w = 0; w < WORDS; w++) {
    let v = rows[o + w];
    v -= (v >>> 1) & 0x55555555;
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    count += Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
  }
  return count;
}

/** Номер младшего занятого бита; −1 — строка пуста. */
function lowestBit(rows: Uint32Array, o: number): number {
  for (let w = 0; w < WORDS; w++) {
    const v = rows[o + w];
    if (v !== 0) return w * 32 + 31 - Math.clz32(v & -v);
  }
  return -1;
}

/** Номер старшего занятого бита; −1 — строка пуста. */
function highestBit(rows: Uint32Array, o: number): number {
  for (let w = WORDS - 1; w >= 0; w--) {
    const v = rows[o + w];
    if (v !== 0) return w * 32 + 31 - Math.clz32(v);
  }
  return -1;
}

// ─── Коридор ────────────────────────────────────────────────────────────────

/**
 * Полоса коридора: три плоскости общей сетки (занятые клетки, волна
 * достижимых и «живые» клетки) и ход корабля за срез.
 */
interface Layer {
  blocked: number;
  wave: number;
  alive: number;
  reach: number;
  /** Срезы, в которых волна менялась после последнего пересчёта живых клеток (пусто, если lo > hi). */
  dirtyLo: number;
  dirtyHi: number;
}

function layer(index: number, reach: number): Layer {
  return { blocked: index * 3 * PLANE, wave: (index * 3 + 1) * PLANE, alive: (index * 3 + 2) * PLANE, reach, dirtyLo: Infinity, dirtyHi: -Infinity };
}

const contact: Contact = { inRange: false, clear: Infinity };

export class Corridor {
  readonly stats: CorridorStats = {
    placed: 0,
    rejected: { width: 0, reveal: 0, gold: 0, crystal: 0, order: 0, window: 0 },
    crystals: 0,
    crystalsRejected: 0,
    narrowestFree: CELLS,
    narrowestGold: CELLS,
    narrowestReach: CELLS,
  };

  /** Скользящее окно срезов [base, frontier]: строка r каждой плоскости отвечает срезу base + r. */
  private readonly grid = new Uint32Array(6 * PLANE);
  private readonly undo = new Uint32Array(6 * PLANE);
  private readonly free = layer(0, REACH);
  private readonly gold = layer(1, GOLD_REACH);
  private readonly revealBefore = new Uint32Array(WORDS * 2);
  private readonly lane = new Uint32Array(WORDS);
  private readonly fresh = new Uint32Array(WORDS);
  /** Клетки, перекрытые одним препятствием, по срезам его окна опасности. */
  private own = new Uint32Array(8 * WORDS);
  private base = 0;
  private frontier = -1;
  /** Недавние препятствия (с окнами опасности) и сферы — для взаимной проверки зазоров. */
  private bodies: Obstacle[] = [];
  private bodyFrom: number[] = [];
  private bodyTo: number[] = [];
  /** Окна опасности группы, которую сейчас ставят. */
  private readonly groupFrom: number[] = [];
  private readonly groupTo: number[] = [];
  private readonly span: Span = { lo: 0, hi: 0 };
  private crystalTicks: number[] = [];
  private crystalXs: number[] = [];
  private lastArrive = -Infinity;
  private lastCrystal = -Infinity;

  /** Начать такт: сдвинуть окно и продлить волны до его конца. Такты идут строго по порядку. */
  advance(barStart: number): void {
    const startRow = barStart / SLICE;
    const base = Math.max(0, startRow - BACK_ROWS);
    const shift = base - this.base;
    if (shift > 0) {
      this.refresh();
      this.retire(Math.min(shift, this.frontier - this.base + 1));
      const g = this.grid;
      for (let plane = 0; plane < g.length; plane += PLANE) {
        g.copyWithin(plane, plane + shift * WORDS, plane + PLANE);
        g.fill(0, plane + PLANE - shift * WORDS, plane + PLANE);
      }
      this.base = base;
    }
    const from = this.frontier + 1;
    this.frontier = startRow + ROWS_PER_BAR + FRONT_ROWS;
    // Ось дорожки не подходит к бортику ближе её полуширины.
    for (let row = from; row <= this.frontier; row++) {
      const o = this.gold.blocked + (row - this.base) * WORDS;
      setBits(this.grid, o, 0, LANE_HALF - 1);
      setBits(this.grid, o, CELLS - LANE_HALF, CELLS - 1);
    }
    this.forward(this.free, from, this.frontier);
    this.forward(this.gold, from, this.frontier);
    // Сферы ставятся на такт позже препятствий, поэтому помним три такта.
    const horizon = barStart - 3 * TICKS_PER_BAR;
    let kept = 0;
    for (let i = 0; i < this.bodies.length; i++) {
      if (this.bodies[i].arriveTick < horizon) continue;
      this.bodies[kept] = this.bodies[i];
      this.bodyFrom[kept] = this.bodyFrom[i];
      this.bodyTo[kept++] = this.bodyTo[i];
    }
    this.bodies.length = this.bodyFrom.length = this.bodyTo.length = kept;
    kept = 0;
    for (let i = 0; i < this.crystalTicks.length; i++) {
      if (this.crystalTicks[i] < horizon) continue;
      this.crystalTicks[kept] = this.crystalTicks[i];
      this.crystalXs[kept++] = this.crystalXs[i];
    }
    this.crystalTicks.length = this.crystalXs.length = kept;
  }

  /**
   * Поставить группу препятствий, которые появляются одновременно. Группы
   * подаются в порядке прилёта — на этом держится правило «не ловить тем,
   * чего не видно». false — группа нарушает честность, состояние не изменилось.
   */
  place(group: readonly Obstacle[]): boolean {
    if (group.length === 0) return true;
    let first = Infinity;
    let last = -Infinity;
    let arrive = Infinity;
    let spawn = Infinity;
    let clash = false;
    for (let n = 0; n < group.length; n++) {
      const o = group[n];
      const w = dangerWindow(o);
      this.groupFrom[n] = w.from;
      this.groupTo[n] = w.to;
      first = Math.min(first, rowOf(Math.max(w.from, 0)));
      last = Math.max(last, rowOf(w.to));
      arrive = Math.min(arrive, o.arriveTick);
      spawn = Math.min(spawn, o.spawnTick);
      for (let i = 0; i < this.crystalTicks.length && !clash; i++) {
        clash = !this.keepsClear(o, w.from, w.to, this.crystalTicks[i], this.crystalXs[i]);
      }
    }
    // Тень упреждения ложится на срезы перед окном опасности — они тоже меняются.
    first = Math.max(first - SHADOW_ROWS, 0);
    if (arrive < this.lastArrive) return this.reject('order');
    if (last > this.frontier || (this.base > 0 && first <= this.base)) return this.reject('window');
    if (clash) return this.reject('crystal');

    // Что было живым в момент появления группы (два соседних среза — время появления между ними).
    this.refresh();
    const g = this.grid;
    const reveal0 = this.clampRow(Math.floor(spawn / SLICE));
    const reveal1 = this.clampRow(Math.ceil(spawn / SLICE));
    const before0 = this.free.alive + (reveal0 - this.base) * WORDS;
    const before1 = this.free.alive + (reveal1 - this.base) * WORDS;
    for (let w = 0; w < WORDS; w++) {
      this.revealBefore[w] = g[before0 + w];
      this.revealBefore[WORDS + w] = g[before1 + w];
    }

    this.undo.set(g);
    for (let n = 0; n < group.length; n++) this.mark(group[n], this.groupFrom[n], this.groupTo[n]);
    const freeTop = this.forward(this.free, first, last);
    const goldTop = this.forward(this.gold, first, last);
    const freeLow = this.settle(this.free);
    const goldLow = this.settle(this.gold);

    let reason: RejectReason | null = null;
    if (!this.wide(this.free.alive, Math.max(reveal0, freeLow), freeTop, MIN_FREE_RUN)) reason = 'width';
    else if (!this.keeps(before0, 0) || !this.keeps(before1, WORDS)) reason = 'reveal';
    else if (!this.wide(this.gold.alive, goldLow, goldTop, 1)) reason = 'gold';
    if (reason) {
      g.set(this.undo);
      return this.reject(reason);
    }
    for (let n = 0; n < group.length; n++) {
      this.bodies.push(group[n]);
      this.bodyFrom.push(this.groupFrom[n]);
      this.bodyTo.push(this.groupTo[n]);
    }
    this.lastArrive = arrive;
    this.stats.placed += 1;
    return true;
  }

  /**
   * Поставить сферу: золотая полоса обязана пройти через её зону. false — сфера
   * слишком близко к препятствию или её нельзя взять, не сорвав идеальное комбо.
   */
  addCrystal(tick: number, x: number): boolean {
    if (!this.admits(tick, x, this.lastCrystal)) {
      this.stats.crystalsRejected += 1;
      return false;
    }
    this.refresh();
    this.undo.set(this.grid);
    const row = rowOf(tick);
    this.confine(row, x);
    if (!this.goldHolds(row, row)) {
      this.grid.set(this.undo);
      this.stats.crystalsRejected += 1;
      return false;
    }
    this.keepCrystal(tick, x);
    return true;
  }

  /**
   * Поставить цепочку сфер разом (тики по возрастанию) — одна проверка вместо
   * проверки на каждую сферу. true — приняты все. false — хотя бы одна не
   * проходит; состояние не изменилось, и сферы стоит предъявить по одной
   * через addCrystal: результат будет тот же, что без этой попытки.
   */
  addCrystals(ticks: readonly number[], xs: readonly number[]): boolean {
    if (ticks.length === 0) return true;
    let last = this.lastCrystal;
    for (let i = 0; i < ticks.length; i++) {
      if (!this.admits(ticks[i], xs[i], last)) return false;
      last = ticks[i];
    }
    this.refresh();
    this.undo.set(this.grid);
    for (let i = 0; i < ticks.length; i++) this.confine(rowOf(ticks[i]), xs[i]);
    if (!this.goldHolds(rowOf(ticks[0]), rowOf(last))) {
      this.grid.set(this.undo);
      return false;
    }
    for (let i = 0; i < ticks.length; i++) this.keepCrystal(ticks[i], xs[i]);
    return true;
  }

  // ─── Запросы паттернов ────────────────────────────────────────────────────

  /** Ближайшая к x точка, где в тик tick может быть корабль, идущий на идеальное комбо (сам x, если такой точки нет). */
  goldClamp(tick: number, x: number): number {
    this.refresh();
    const o = this.gold.alive + this.offsetOf(rowOf(tick));
    const lo = lowestBit(this.grid, o);
    return lo < 0 ? x : Math.min(Math.max(x, cellX(lo)), cellX(highestBit(this.grid, o)));
  }

  /**
   * Куда можно поставить центр обязательного прохода (ворота, окно в стене),
   * чтобы до него успели из любой живой точки на момент появления. half —
   * полуширина прохода для центра корабля. null — такого места нет.
   */
  gateBand(arriveTick: number, spawnTick: number, half: number): Span | null {
    this.refresh();
    const revealRow = this.clampRow(Math.ceil(spawnTick / SLICE));
    const o = this.free.alive + (revealRow - this.base) * WORDS;
    const leftmost = lowestBit(this.grid, o);
    if (leftmost < 0) return null;
    // Запас в несколько клеток: проход должен быть достижим не «впритык».
    const reach = Math.max(0, (rowOf(arriveTick) - revealRow) * REACH * CELL - 4);
    const lo = cellX(highestBit(this.grid, o)) - reach - half;
    const hi = cellX(leftmost) + reach + half;
    return lo <= hi ? { lo, hi } : null;
  }

  // ─── Доступ для линии мелодии ─────────────────────────────────────────────

  get firstRow(): number {
    return this.base;
  }

  get lastRow(): number {
    return this.frontier;
  }

  /** Срез последней поставленной сферы (−Infinity, если сфер ещё не было). */
  get lastCrystalRow(): number {
    return rowOf(this.lastCrystal);
  }

  /** Слово word битовой строки среза row: оси дорожек, живые для идеального комбо. */
  goldAliveWord(row: number, word: number): number {
    return this.grid[this.gold.alive + this.offsetOf(row) + word];
  }

  /** Клетки, закрытые для идеального комбо (препятствие с отступом, его тень или чужая зона сферы). */
  goldBlockedWord(row: number, word: number): number {
    return this.grid[this.gold.blocked + this.offsetOf(row) + word];
  }

  /** Клетки, которые в срезе row перекрывает препятствие (с запасом MARGIN). */
  blockedWord(row: number, word: number): number {
    return this.grid[this.free.blocked + this.offsetOf(row) + word];
  }

  /** Привести живые клетки в соответствие с волнами (вызывается перед чтением слов). */
  refresh(): void {
    this.settle(this.free);
    this.settle(this.gold);
  }

  // ─── Внутреннее ───────────────────────────────────────────────────────────

  private reject(reason: RejectReason): false {
    this.stats.rejected[reason] += 1;
    return false;
  }

  private clampRow(row: number): number {
    return Math.min(this.frontier, Math.max(this.base, row));
  }

  private offsetOf(row: number): number {
    return (this.clampRow(row) - this.base) * WORDS;
  }

  /** Все клетки, живые до постановки группы, остались живыми. */
  private keeps(alive: number, before: number): boolean {
    for (let w = 0; w < WORDS; w++) if ((this.revealBefore[before + w] & ~this.grid[alive + w]) !== 0) return false;
    return true;
  }

  /** В каждом срезе от fromRow до toRow есть серия живых клеток не короче minRun. */
  private wide(alive: number, fromRow: number, toRow: number, minRun: number): boolean {
    for (let row = Math.max(fromRow, this.base); row <= toRow; row++) {
      if (!hasRun(this.grid, alive + (row - this.base) * WORDS, minRun)) return false;
    }
    return true;
  }

  /** Сферу в точке (tick, x) вообще можно рассматривать: она в окне, позже прошлой сферы и не вплотную к препятствию. */
  private admits(tick: number, x: number, lastCrystal: number): boolean {
    const row = rowOf(tick);
    if (tick <= lastCrystal || row > this.frontier || (this.base > 0 && row <= this.base)) return false;
    for (let i = 0; i < this.bodies.length; i++) {
      if (!this.keepsClear(this.bodies[i], this.bodyFrom[i], this.bodyTo[i], tick, x)) return false;
    }
    return true;
  }

  /** Закрыть для идеального прохождения всё в срезе row, кроме зоны сферы в точке x. */
  private confine(row: number, x: number): void {
    const g = this.grid;
    const zone = this.fresh.fill(0);
    const center = cellOf(x);
    // Вся дорожка, а не только её ось, обязана лежать в зоне сферы.
    setBits(zone, 0, Math.max(0, center - ZONE_CELLS + LANE_HALF), Math.min(CELLS - 1, center + ZONE_CELLS - LANE_HALF));
    const o = this.gold.blocked + (row - this.base) * WORDS;
    for (let w = 0; w < WORDS; w++) g[o + w] |= ~zone[w];
    g[o + WORDS - 1] &= TAIL_MASK;
  }

  /** После правок занятости в срезах [fromRow, toRow] золотая полоса всё ещё нигде не уже минимума. */
  private goldHolds(fromRow: number, toRow: number): boolean {
    const top = this.forward(this.gold, fromRow, toRow);
    const low = this.settle(this.gold);
    return this.wide(this.gold.alive, low, top, 1);
  }

  private keepCrystal(tick: number, x: number): void {
    this.crystalTicks.push(tick);
    this.crystalXs.push(x);
    this.lastCrystal = tick;
    this.stats.crystals += 1;
  }

  /** Препятствие с окном опасности [windowFrom, windowTo] не подходит к точке (tick, x) ближе CRYSTAL_CLEAR. */
  private keepsClear(o: Obstacle, windowFrom: number, windowTo: number, tick: number, x: number): boolean {
    const from = Math.max(windowFrom, tick - CRYSTAL_TICKS);
    const to = Math.min(windowTo, tick + CRYSTAL_TICKS);
    for (let t = from; t <= to; t++) {
      contactAt(o, t, x, contact);
      if (contact.inRange && contact.clear < CRYSTAL_CLEAR) return false;
    }
    return true;
  }

  /**
   * Отметить клетки, которые препятствие перекрывает в обеих пробах каждого
   * тика своего окна опасности. Свободная полоса получает сами клетки,
   * золотая — строже: шире на GOLD_PAD и закрыта заранее, за SHADOW_ROWS
   * срезов до удара.
   */
  private mark(o: Obstacle, windowFrom: number, windowTo: number): void {
    const fromTick = Math.max(windowFrom, 0);
    const firstRow = rowOf(fromTick);
    const rows = rowOf(windowTo) - firstRow + 1;
    if (this.own.length < rows * WORDS) this.own = new Uint32Array(rows * WORDS);
    const own = this.own.fill(0, 0, rows * WORDS);
    const span = this.span;
    const laser = o.kind === 'laser';
    for (let t = fromTick; t <= windowTo; t++) {
      const row = (rowOf(t) - firstRow) * WORDS;
      for (let probe = 0; probe < 2; probe++) {
        const time = t - probe * 0.5;
        if (!laser) {
          if (solidCells(o, time, MARGIN, span)) setBits(own, row, span.lo, span.hi);
        } else if (gateCells(o, time, MARGIN, span)) {
          // Занято всё, кроме прохода.
          if (span.lo > span.hi) setBits(own, row, 0, CELLS - 1);
          else {
            if (span.lo > 0) setBits(own, row, 0, span.lo - 1);
            if (span.hi < CELLS - 1) setBits(own, row, span.hi + 1, CELLS - 1);
          }
        }
      }
    }
    const g = this.grid;
    const lane = this.lane.fill(0);
    for (let r = 0; r < rows; r++) {
      const src = r * WORDS;
      const dst = (firstRow + r - this.base) * WORDS;
      for (let k = 0; k < WORDS; k++) g[this.free.blocked + dst + k] |= own[src + k];
      widen(own, src, GOLD_PAD + LANE_HALF);
      for (let k = 0; k < WORDS; k++) {
        g[this.gold.blocked + dst + k] |= own[src + k];
        lane[k] |= own[src + k];
      }
    }
    for (let row = Math.max(firstRow - SHADOW_ROWS, 0); row < firstRow; row++) {
      const dst = this.gold.blocked + (row - this.base) * WORDS;
      for (let k = 0; k < WORDS; k++) g[dst + k] |= lane[k];
    }
  }

  /**
   * Волна вперёд от среза fromRow: клетка достижима, если до неё есть свободный
   * путь из достижимой клетки прошлого среза. Занятость менялась только в
   * срезах до untilRow — дальше пересчёт идёт, пока волна ещё меняется.
   * Возвращает последний изменившийся срез.
   */
  private forward(l: Layer, fromRow: number, untilRow: number): number {
    const g = this.grid;
    const fresh = this.fresh;
    const start = Math.max(fromRow, this.base);
    let top = start - 1;
    for (let row = start; row <= this.frontier; row++) {
      const r = (row - this.base) * WORDS;
      if (row === 0) {
        // Старт забега: корабль может быть где угодно (как у verifyChart).
        for (let w = 0; w < WORDS; w++) fresh[w] = ~g[l.blocked + w];
        fresh[WORDS - 1] &= TAIL_MASK;
      } else if (r === 0) {
        // Срез на краю окна: его прошлое уже забыто, волна в нём осталась прежней.
        continue;
      } else {
        for (let w = 0; w < WORDS; w++) fresh[w] = g[l.wave + r - WORDS + w] & ~g[l.blocked + r + w];
        travel(fresh, 0, g, l.blocked + r, l.reach);
      }
      let changed = false;
      for (let w = 0; w < WORDS; w++) {
        if (g[l.wave + r + w] !== fresh[w]) {
          g[l.wave + r + w] = fresh[w];
          changed = true;
        }
      }
      if (changed) top = row;
      else if (row > untilRow) break;
    }
    if (top >= start) {
      l.dirtyLo = Math.min(l.dirtyLo, start);
      l.dirtyHi = Math.max(l.dirtyHi, top);
    }
    return top;
  }

  /**
   * Волна назад: живые клетки = достижимые, из которых есть путь дальше.
   * Пересчитывает срезы, где менялась волна, и более ранние — пока те ещё
   * меняются. Возвращает самый ранний изменившийся срез (Infinity — ничего).
   */
  private settle(l: Layer): number {
    if (l.dirtyLo > l.dirtyHi) return Infinity;
    const g = this.grid;
    const fresh = this.fresh;
    const lo = l.dirtyLo;
    let low = Infinity;
    for (let row = l.dirtyHi; row >= this.base; row--) {
      const r = (row - this.base) * WORDS;
      if (row === this.frontier) {
        for (let w = 0; w < WORDS; w++) fresh[w] = g[l.wave + r + w];
      } else {
        for (let w = 0; w < WORDS; w++) fresh[w] = g[l.alive + r + WORDS + w];
        travel(fresh, 0, g, l.blocked + r + WORDS, l.reach);
        for (let w = 0; w < WORDS; w++) fresh[w] &= g[l.wave + r + w];
      }
      let changed = false;
      for (let w = 0; w < WORDS; w++) {
        if (g[l.alive + r + w] !== fresh[w]) {
          g[l.alive + r + w] = fresh[w];
          changed = true;
        }
      }
      if (changed) low = row;
      else if (row < lo) break;
    }
    l.dirtyLo = Infinity;
    l.dirtyHi = -Infinity;
    return low;
  }

  /** Срезы уходят из окна навсегда — запомнить, насколько узко в них было. */
  private retire(rows: number): void {
    const g = this.grid;
    const s = this.stats;
    for (let r = 0; r < rows; r++) {
      const o = r * WORDS;
      if (!hasRun(g, this.free.alive + o, s.narrowestFree)) s.narrowestFree = longestRun(g, this.free.alive + o);
      // Серия осей длиной n — это дорожка шириной n + 2·LANE_HALF клеток.
      const lane = Math.max(1, s.narrowestGold - 2 * LANE_HALF);
      if (!hasRun(g, this.gold.alive + o, lane)) {
        const axes = longestRun(g, this.gold.alive + o);
        s.narrowestGold = axes > 0 ? axes + 2 * LANE_HALF : 0;
      }
      s.narrowestReach = Math.min(s.narrowestReach, countBits(g, this.free.wave + o));
    }
  }
}
