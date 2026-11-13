/**
 * Коридор честности — «совесть» генератора трека.
 *
 * Пока генератор расставляет объекты, коридор ведёт две волны достижимых
 * позиций корабля на той же сетке, что и verifyChart (клетка 1 ед., срез
 * 4 тика, скорость GAME.fairness.assumedSpeed):
 *
 *  • свободная полоса — где вообще может быть корабль, не разбившись;
 *  • золотая полоса — где может быть корабль, собравший ВСЕ сферы подряд и
 *    при этом летящий спокойно: вдвое медленнее расчётной скорости
 *    (GOLD_REACH), на расстоянии зоны сферы от препятствий (GOLD_PAD) и
 *    уходя из-под каждого удара заранее (SHADOW_ROWS). По ней ложатся сферы.
 *
 * Группа препятствий принимается, только если после неё:
 *  1) в каждом срезе остаётся «живой» проход не уже GAME.fairness.minGap
 *     («живой» — достижим из прошлого и не ведёт в тупик);
 *  2) ни одна позиция, которая была живой в момент, когда группа появилась
 *     из дымки, не стала смертельной — игрока нельзя поймать тем, чего он
 *     ещё не видел;
 *  3) идеальное комбо остаётся возможным;
 *  4) уже поставленные сферы по-прежнему можно взять, не задев препятствие.
 * Иначе состояние откатывается, и паттерн чинит себя или отказывается.
 *
 * Строки волн — битовые (клетка = бит), поэтому проверка кандидата стоит
 * десятки микросекунд и генерация такта не даёт рывка кадра.
 */
import { contactAt, dangerWindow, type Contact } from './collision';
import { GAME, WORLD } from './config';
import { obstacleX } from './motion';
import { TICK_DT, TICKS_PER_BAR } from './timing';
import type { Obstacle } from './types';

// ─── Сетка (совпадает с verifyChart в bot.ts) ───────────────────────────────

/** Ширина клетки, единицы дороги. */
export const CELL = 1;
/** Длина среза, тики. */
export const SLICE = 4;
/** Клеток поперёк дороги (центр корабля ходит от edge до roadW − edge). */
export const CELLS = Math.floor((WORLD.roadW - 2 * GAME.player.edge) / CELL) + 1;
/** Клеток за срез на расчётной скорости — с округлением вниз, как у verifyChart. */
export const REACH = Math.floor((GAME.fairness.assumedSpeed * SLICE * TICK_DT) / CELL);
/**
 * Клеток за срез у идеальной линии — половина расчётной скорости: мелодию
 * можно сыграть спокойным манёвром, без рывков на пределе.
 */
export const GOLD_REACH = Math.max(1, Math.floor(REACH / 2));
/** Запас вокруг препятствий, с которым трек обязан быть проходим. */
export const MARGIN = 1;
/**
 * Минимальная длина живого прохода в клетках. n клеток подряд — это проход
 * не уже (n − 1)·CELL + 2·(радиус + запас) между хитбоксами, поэтому +1.
 */
export const MIN_FREE_RUN = Math.ceil((GAME.fairness.minGap - 2 * GAME.player.radius - 2 * MARGIN) / CELL) + 1;
/** Минимальная ширина золотой полосы, клетки. */
export const MIN_GOLD_RUN = 3;
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
const WORDS = Math.ceil(CELLS / 32);
const TAIL_BITS = CELLS - (WORDS - 1) * 32;
const TAIL_MASK = TAIL_BITS === 32 ? 0xffffffff : 2 ** TAIL_BITS - 1;

/** X центра клетки. */
export function cellX(cell: number): number {
  return GAME.player.edge + cell * CELL;
}

/** Ближайшая клетка к X (с зажимом в дорогу). */
export function cellOf(x: number): number {
  return Math.min(CELLS - 1, Math.max(0, Math.round((x - GAME.player.edge) / CELL)));
}

/** Срез, в который попадает тик (как у verifyChart: срез k отвечает за тики (4k − 4, 4k]). */
export function rowOf(tick: number): number {
  return Math.ceil(tick / SLICE);
}

/** Отрезок X центра корабля. */
export interface Span {
  lo: number;
  hi: number;
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
  /** Наименьшее число достижимых клеток в срезе (то же, что minReachable у verifyChart). */
  narrowestReach: number;
}

// ─── Битовые строки ─────────────────────────────────────────────────────────

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

/** dst = src, расширенная на reach клеток в обе стороны (ход корабля за срез). */
function dilate(src: Uint32Array, so: number, dst: Uint32Array, d: number, reach: number): void {
  for (let w = 0; w < WORDS; w++) dst[d + w] = src[so + w];
  widen(dst, d, reach);
}

const runScratch = new Uint32Array(WORDS);

/** В строке есть n занятых бит подряд (n ≤ 32). Удвоением: бит i выживает, пока заняты i…i+len−1. */
function hasRun(rows: Uint32Array, o: number, n: number): boolean {
  const m = runScratch;
  for (let w = 0; w < WORDS; w++) m[w] = rows[o + w];
  let len = 1;
  while (len < n) {
    const step = Math.min(len, n - len);
    for (let w = 0; w < WORDS; w++) {
      const next = w + 1 < WORDS ? m[w + 1] : 0;
      m[w] &= (m[w] >>> step) | (next << (32 - step));
    }
    len += step;
  }
  for (let w = 0; w < WORDS; w++) if (m[w] !== 0) return true;
  return false;
}

function bit(rows: Uint32Array, o: number, cell: number): number {
  return (rows[o + (cell >> 5)] >>> (cell & 31)) & 1;
}

function longestRun(rows: Uint32Array, o: number): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < CELLS; i++) {
    run = bit(rows, o, i) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

function countBits(rows: Uint32Array, o: number): number {
  let count = 0;
  for (let i = 0; i < CELLS; i++) count += bit(rows, o, i);
  return count;
}

function runsOf(rows: Uint32Array, o: number): Span[] {
  const out: Span[] = [];
  let start = -1;
  for (let i = 0; i <= CELLS; i++) {
    const on = i < CELLS && bit(rows, o, i) === 1;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push({ lo: cellX(start), hi: cellX(i - 1) });
      start = -1;
    }
  }
  return out;
}

// ─── Коридор ────────────────────────────────────────────────────────────────

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

  // Скользящее окно срезов [base, frontier]: строка r отвечает срезу base + r.
  private readonly freeBlocked = new Uint32Array(ROWS * WORDS);
  private readonly freeWave = new Uint32Array(ROWS * WORDS);
  private readonly goldBlocked = new Uint32Array(ROWS * WORDS);
  private readonly goldWave = new Uint32Array(ROWS * WORDS);
  /** Живые клетки: достижимы и не ведут в тупик (пересчитываются лениво). */
  private readonly freeAlive = new Uint32Array(ROWS * WORDS);
  private readonly goldAlive = new Uint32Array(ROWS * WORDS);
  private readonly undo = new Uint32Array(ROWS * WORDS * 4);
  private readonly revealBefore = new Uint32Array(WORDS * 2);
  private readonly lane = new Uint32Array(WORDS);
  /** Клетки, перекрытые одним препятствием, по срезам его окна опасности. */
  private own = new Uint32Array(8 * WORDS);
  private base = 0;
  private frontier = -1;
  private freeDirty = true;
  private goldDirty = true;
  /** Недавние препятствия и сферы — для взаимной проверки зазоров. */
  private bodies: Obstacle[] = [];
  private crystals: Array<{ tick: number; x: number }> = [];
  private lastArrive = -Infinity;
  private lastCrystal = -Infinity;

  /** Начать такт: сдвинуть окно и продлить волны до его конца. Такты идут строго по порядку. */
  advance(barStart: number): void {
    const startRow = barStart / SLICE;
    const base = Math.max(0, startRow - BACK_ROWS);
    const shift = base - this.base;
    if (shift > 0) {
      this.retire(Math.min(shift, this.frontier - this.base + 1));
      for (const rows of [this.freeBlocked, this.freeWave, this.goldBlocked, this.goldWave]) {
        rows.copyWithin(0, shift * WORDS);
      }
      this.freeBlocked.fill(0, (ROWS - shift) * WORDS);
      this.goldBlocked.fill(0, (ROWS - shift) * WORDS);
      this.base = base;
    }
    const from = this.frontier + 1;
    this.frontier = startRow + ROWS_PER_BAR + FRONT_ROWS;
    this.recompute(this.freeBlocked, this.freeWave, from, REACH);
    this.recompute(this.goldBlocked, this.goldWave, from, GOLD_REACH);
    this.freeDirty = this.goldDirty = true;
    // Сферы ставятся на такт позже препятствий, поэтому помним три такта.
    const horizon = barStart - 3 * TICKS_PER_BAR;
    this.bodies = this.bodies.filter((o) => o.arriveTick >= horizon);
    this.crystals = this.crystals.filter((c) => c.tick >= horizon);
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
    for (const o of group) {
      const w = dangerWindow(o);
      first = Math.min(first, rowOf(Math.max(w.from, 0)));
      last = Math.max(last, rowOf(w.to));
      arrive = Math.min(arrive, o.arriveTick);
      spawn = Math.min(spawn, o.spawnTick);
    }
    // Тень упреждения ложится на срезы перед окном опасности — они тоже меняются.
    first = Math.max(first - SHADOW_ROWS, 0);
    if (arrive < this.lastArrive) return this.reject('order');
    if (last > this.frontier || (this.base > 0 && first <= this.base)) return this.reject('window');
    for (const o of group) {
      for (const c of this.crystals) if (!this.keepsClear(o, c.tick, c.x)) return this.reject('crystal');
    }

    // Что было живым в момент появления группы (два соседних среза — время появления между ними).
    this.refresh();
    const reveal0 = this.clampRow(Math.floor(spawn / SLICE));
    const reveal1 = this.clampRow(Math.ceil(spawn / SLICE));
    this.copyRow(this.freeAlive, reveal0, this.revealBefore, 0);
    this.copyRow(this.freeAlive, reveal1, this.revealBefore, WORDS);

    this.snapshot(first);
    for (const o of group) this.mark(o);
    this.recompute(this.freeBlocked, this.freeWave, first, REACH);
    this.recompute(this.goldBlocked, this.goldWave, first, GOLD_REACH);
    this.freeDirty = this.goldDirty = true;
    this.refresh();

    let reason: RejectReason | null = null;
    if (!this.wideEnough(this.freeAlive, reveal0, MIN_FREE_RUN)) reason = 'width';
    else if (!this.keeps(reveal0, 0) || !this.keeps(reveal1, WORDS)) reason = 'reveal';
    else if (!this.wideEnough(this.goldAlive, this.base, MIN_GOLD_RUN)) reason = 'gold';
    if (reason) {
      this.rollback(first);
      return this.reject(reason);
    }
    for (const o of group) this.bodies.push(o);
    this.lastArrive = arrive;
    this.stats.placed += 1;
    return true;
  }

  /**
   * Поставить сферу: золотая полоса обязана пройти через её зону. false — сфера
   * слишком близко к препятствию или её нельзя взять, не сорвав идеальное комбо.
   */
  addCrystal(tick: number, x: number): boolean {
    const row = rowOf(tick);
    const outside = row > this.frontier || (this.base > 0 && row <= this.base);
    if (outside || tick <= this.lastCrystal || !this.crystalClear(tick, x)) {
      this.stats.crystalsRejected += 1;
      return false;
    }
    this.snapshot(row);
    const o = (row - this.base) * WORDS;
    const center = cellOf(x);
    for (let w = 0; w < WORDS; w++) {
      let keep = 0;
      for (let i = Math.max(center - ZONE_CELLS, w * 32); i <= Math.min(center + ZONE_CELLS, w * 32 + 31); i++) {
        keep |= 1 << (i & 31);
      }
      this.goldBlocked[o + w] |= ~keep;
    }
    this.recompute(this.goldBlocked, this.goldWave, row, GOLD_REACH);
    this.goldDirty = true;
    this.refresh();
    if (!this.wideEnough(this.goldAlive, this.base, MIN_GOLD_RUN)) {
      this.rollback(row);
      this.stats.crystalsRejected += 1;
      return false;
    }
    this.crystals.push({ tick, x });
    this.lastCrystal = tick;
    this.stats.crystals += 1;
    return true;
  }

  /** Точка (tick, x) не ближе CRYSTAL_CLEAR к любому из недавних препятствий. */
  crystalClear(tick: number, x: number): boolean {
    for (const o of this.bodies) if (!this.keepsClear(o, tick, x)) return false;
    return true;
  }

  // ─── Запросы паттернов ────────────────────────────────────────────────────

  /** Живые проходы свободной полосы в тик tick. */
  freeRuns(tick: number): Span[] {
    this.refresh();
    return runsOf(this.freeAlive, this.offsetOf(rowOf(tick)));
  }

  /** Где в тик tick может быть корабль, идущий на идеальное комбо; null — нигде. */
  goldHull(tick: number): Span | null {
    this.refresh();
    const runs = runsOf(this.goldAlive, this.offsetOf(rowOf(tick)));
    return runs.length === 0 ? null : { lo: runs[0].lo, hi: runs[runs.length - 1].hi };
  }

  /**
   * Куда можно поставить центр обязательного прохода (ворота, окно в стене),
   * чтобы до него успели из любой живой точки на момент появления. half —
   * полуширина прохода для центра корабля. null — такого места нет.
   */
  gateBand(arriveTick: number, spawnTick: number, half: number): Span | null {
    this.refresh();
    const revealRow = this.clampRow(Math.ceil(spawnTick / SLICE));
    const runs = runsOf(this.freeAlive, (revealRow - this.base) * WORDS);
    if (runs.length === 0) return null;
    // Запас в несколько клеток: проход должен быть достижим не «впритык».
    const travel = Math.max(0, (rowOf(arriveTick) - revealRow) * REACH * CELL - 4);
    const lo = runs[runs.length - 1].hi - travel - half;
    const hi = runs[0].lo + travel + half;
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

  /** out[i] = 1, если клетка i среза row живая для идеального комбо. */
  readGold(row: number, out: Uint8Array): void {
    this.refresh();
    const o = this.offsetOf(row);
    for (let i = 0; i < CELLS; i++) out[i] = bit(this.goldAlive, o, i);
  }

  /** out[i] = 1, если клетку i среза row перекрывает препятствие (с запасом MARGIN). */
  readObstacles(row: number, out: Uint8Array): void {
    const o = this.offsetOf(row);
    for (let i = 0; i < CELLS; i++) out[i] = bit(this.freeBlocked, o, i);
  }

  /** Число достижимых клеток в срезе тика tick (для сверки с verifyChart). */
  reachCount(tick: number): number {
    return countBits(this.freeWave, this.offsetOf(rowOf(tick)));
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

  private copyRow(src: Uint32Array, row: number, dst: Uint32Array, d: number): void {
    const o = (row - this.base) * WORDS;
    for (let w = 0; w < WORDS; w++) dst[d + w] = src[o + w];
  }

  /** Все клетки, живые до постановки группы, остались живыми. */
  private keeps(row: number, d: number): boolean {
    const o = (row - this.base) * WORDS;
    for (let w = 0; w < WORDS; w++) if ((this.revealBefore[d + w] & ~this.freeAlive[o + w]) !== 0) return false;
    return true;
  }

  private wideEnough(alive: Uint32Array, fromRow: number, minRun: number): boolean {
    for (let row = fromRow; row <= this.frontier; row++) {
      if (!hasRun(alive, (row - this.base) * WORDS, minRun)) return false;
    }
    return true;
  }

  private keepsClear(o: Obstacle, tick: number, x: number): boolean {
    const w = dangerWindow(o);
    const from = Math.max(w.from, tick - CRYSTAL_TICKS);
    const to = Math.min(w.to, tick + CRYSTAL_TICKS);
    for (let t = from; t <= to; t++) {
      contactAt(o, t, x, contact);
      if (contact.inRange && contact.clear < CRYSTAL_CLEAR) return false;
    }
    return true;
  }

  /**
   * Отметить клетки, которые препятствие перекрывает. Свободная полоса — тем же
   * правилом, что verifyChart. Золотая — строже: полоса шире на GOLD_PAD и
   * закрыта заранее, за SHADOW_ROWS срезов до удара.
   */
  private mark(o: Obstacle): void {
    const w = dangerWindow(o);
    const fromTick = Math.max(w.from, 0);
    const firstRow = rowOf(fromTick);
    const rows = rowOf(w.to) - firstRow + 1;
    if (this.own.length < rows * WORDS) this.own = new Uint32Array(rows * WORDS);
    const own = this.own.fill(0, 0, rows * WORDS);
    // Дальше этого от центра объект заведомо не достаёт (у куба — с учётом поворота).
    const extent = o.kind === 'cube' ? o.halfW * GAME.hitbox.cube * Math.SQRT2 : o.halfW * GAME.hitbox.saw;
    const span = extent + GAME.player.radius + MARGIN + CELL;
    for (let t = fromTick; t <= w.to; t++) {
      const row = (rowOf(t) - firstRow) * WORDS;
      let lo = 0;
      let hi = CELLS - 1;
      if (o.kind !== 'laser') {
        const ox = obstacleX(o, t);
        lo = cellOf(ox - span);
        hi = cellOf(ox + span);
      }
      for (let i = lo; i <= hi; i++) {
        contactAt(o, t, cellX(i), contact);
        if (contact.inRange && contact.clear < MARGIN) own[row + (i >> 5)] |= 1 << (i & 31);
      }
    }
    const lane = this.lane.fill(0);
    for (let r = 0; r < rows; r++) {
      const src = r * WORDS;
      const dst = (firstRow + r - this.base) * WORDS;
      for (let k = 0; k < WORDS; k++) this.freeBlocked[dst + k] |= own[src + k];
      widen(own, src, GOLD_PAD);
      for (let k = 0; k < WORDS; k++) {
        this.goldBlocked[dst + k] |= own[src + k];
        lane[k] |= own[src + k];
      }
    }
    for (let row = Math.max(firstRow - SHADOW_ROWS, 0); row < firstRow; row++) {
      const dst = (row - this.base) * WORDS;
      for (let k = 0; k < WORDS; k++) this.goldBlocked[dst + k] |= lane[k];
    }
  }

  /** Волна вперёд: срез достижим из соседних клеток прошлого среза, если не перекрыт. */
  private recompute(blocked: Uint32Array, wave: Uint32Array, fromRow: number, reach: number): void {
    for (let row = Math.max(fromRow, this.base); row <= this.frontier; row++) {
      const o = (row - this.base) * WORDS;
      if (row === 0) {
        // Старт забега: корабль может быть где угодно (как у verifyChart).
        for (let w = 0; w < WORDS; w++) wave[o + w] = 0xffffffff;
        wave[o + WORDS - 1] = TAIL_MASK;
      } else if (o === 0) {
        continue;
      } else {
        dilate(wave, o - WORDS, wave, o, reach);
      }
      for (let w = 0; w < WORDS; w++) wave[o + w] &= ~blocked[o + w];
    }
  }

  /** Волна назад от края окна: живые клетки = достижимые, из которых есть путь дальше. */
  private refresh(): void {
    if (this.freeDirty) {
      this.alivePass(this.freeWave, this.freeAlive, REACH);
      this.freeDirty = false;
    }
    if (this.goldDirty) {
      this.alivePass(this.goldWave, this.goldAlive, GOLD_REACH);
      this.goldDirty = false;
    }
  }

  private alivePass(wave: Uint32Array, alive: Uint32Array, reach: number): void {
    const lastOffset = (this.frontier - this.base) * WORDS;
    for (let w = 0; w < WORDS; w++) alive[lastOffset + w] = wave[lastOffset + w];
    for (let o = lastOffset - WORDS; o >= 0; o -= WORDS) {
      dilate(alive, o + WORDS, alive, o, reach);
      for (let w = 0; w < WORDS; w++) alive[o + w] &= wave[o + w];
    }
  }

  private snapshot(fromRow: number): void {
    const from = (fromRow - this.base) * WORDS;
    const size = (this.frontier - fromRow + 1) * WORDS;
    this.undo.set(this.freeBlocked.subarray(from, from + size), 0);
    this.undo.set(this.freeWave.subarray(from, from + size), size);
    this.undo.set(this.goldBlocked.subarray(from, from + size), size * 2);
    this.undo.set(this.goldWave.subarray(from, from + size), size * 3);
  }

  private rollback(fromRow: number): void {
    const from = (fromRow - this.base) * WORDS;
    const size = (this.frontier - fromRow + 1) * WORDS;
    this.freeBlocked.set(this.undo.subarray(0, size), from);
    this.freeWave.set(this.undo.subarray(size, size * 2), from);
    this.goldBlocked.set(this.undo.subarray(size * 2, size * 3), from);
    this.goldWave.set(this.undo.subarray(size * 3, size * 4), from);
    this.freeDirty = this.goldDirty = true;
  }

  /** Срезы уходят из окна навсегда — запомнить, насколько узко в них было. */
  private retire(rows: number): void {
    this.refresh();
    const s = this.stats;
    for (let r = 0; r < rows; r++) {
      const o = r * WORDS;
      s.narrowestFree = Math.min(s.narrowestFree, longestRun(this.freeAlive, o));
      s.narrowestGold = Math.min(s.narrowestGold, longestRun(this.goldAlive, o));
      s.narrowestReach = Math.min(s.narrowestReach, countBits(this.freeWave, o));
    }
  }
}
