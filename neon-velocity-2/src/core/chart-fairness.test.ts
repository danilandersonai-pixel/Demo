/**
 * Свойства готового трека на многих зёрнах: честность (в том числе по модели
 * строже verifyChart и независимой от самого генератора), сферы, кривая
 * плотности, драматургия уровня, детерминизм и цена одного такта.
 */
import { describe, expect, it } from 'vitest';
import { collectObstacles, verifyChart, verifyObstacles } from './bot';
import { CRYSTAL_CLEAR, GOLD_REACH, MARGIN, MIN_FREE_RUN, MIN_GOLD_RUN, REACH, SLICE, ZONE_CELLS } from './chart-corridor';
import { BAR_ROLES, densityForLevel, MAX_CRYSTALS_PER_BAR } from './chart-plan';
import { MAX_OBSTACLES_PER_BAR } from './chart-patterns';
import { CELL, CELLS, cellOf, cellX } from './chart-probe';
import { createChart, createInspectableChart } from './chartgen';
import { contactAt, dangerWindow } from './collision';
import { GAME, multiplierForChain, OBSTACLES, swayAmp, WORLD } from './config';
import { isObstacleSpec, makeObstacle } from './entities';
import { obstacleX, pickupReach, swayOffset } from './motion';
import { barInLevel, isOnGrid, levelAtTick, TICK_RATE, TICKS_PER_BAR, TICKS_PER_EIGHTH, TICKS_PER_LEVEL } from './timing';
import type { ChartItem, ChartOptions, CrystalSpec, Obstacle, ObstacleSpec } from './types';

const OPTIONS: ChartOptions = { rareChance: GAME.crystal.rareChance };
/** 20 уровней скорости. */
const BARS = 160;
const LEVELS = BARS / 8;

function barsOf(seed: number, count = BARS, options: ChartOptions = OPTIONS): ChartItem[][] {
  const chart = createChart(seed, options);
  return Array.from({ length: count }, (_, bar) => chart.bar(bar));
}

function obstaclesOf(items: readonly ChartItem[]): ObstacleSpec[] {
  return items.filter(isObstacleSpec);
}

function crystalsOf(items: readonly ChartItem[]): CrystalSpec[] {
  return items.filter((item): item is CrystalSpec => item.kind === 'crystal');
}

function range(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => from + i);
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ─── Честность ──────────────────────────────────────────────────────────────

describe.each([range(101, 10), range(111, 10), range(121, 10), range(131, 10), range(141, 10)])(
  'verifyChart на расчётной скорости с запасом 1 (зёрна %i…)',
  (...seeds) => {
    it('160 тактов проходимы, а самое узкое место не уже минимального прохода', () => {
      for (const seed of seeds) {
        const result = verifyChart(createChart(seed, OPTIONS), { bars: BARS, speed: GAME.fairness.assumedSpeed, margin: 1 });
        expect(result, `зерно ${seed}`).toMatchObject({ ok: true, failTick: null });
        expect(result.minReachable, `зерно ${seed}`).toBeGreaterThanOrEqual(MIN_FREE_RUN);
        expect(result.obstacles).toBeGreaterThan(500);
      }
    });
  },
);

/**
 * Независимая проверка по строгой модели: обе пробы столкновения каждого тика
 * (t − 0.5 и t), ход между клетками только через свободные клетки. Сетка
 * считается перебором через contactAt — без единой строчки из генератора.
 */
class StrictGrid {
  readonly rows: number;
  /** blocked[row · CELLS + cell] = 1, если корабль в клетке заденет препятствие в этом срезе (с запасом MARGIN). */
  readonly blocked: Uint8Array;

  constructor(obstacles: readonly Obstacle[], bars: number) {
    this.rows = (bars * TICKS_PER_BAR) / SLICE + 1;
    this.blocked = new Uint8Array(this.rows * CELLS);
    const contact = { inRange: false, clear: Infinity };
    for (const o of obstacles) {
      const w = dangerWindow(o);
      for (let t = Math.max(w.from, 0); t <= w.to; t++) {
        const row = Math.ceil(t / SLICE);
        if (row >= this.rows) break;
        for (const time of [t - 0.5, t]) {
          for (let i = 0; i < CELLS; i++) {
            contactAt(o, time, cellX(i), contact);
            if (contact.inRange && contact.clear < MARGIN) this.blocked[row * CELLS + i] = 1;
          }
        }
      }
    }
  }

  /** Клетки следующего среза, достижимые из from ходом не больше reach клеток по свободным клеткам. */
  step(from: Uint8Array, row: number, reach: number, out: Uint8Array): void {
    out.fill(0);
    const o = row * CELLS;
    for (let i = 0; i < CELLS; i++) {
      if (!from[i] || this.blocked[o + i]) continue;
      out[i] = 1;
      for (let j = i + 1; j <= Math.min(CELLS - 1, i + reach) && !this.blocked[o + j]; j++) out[j] = 1;
      for (let j = i - 1; j >= Math.max(0, i - reach) && !this.blocked[o + j]; j--) out[j] = 1;
    }
  }

  /**
   * Живые клетки каждого среза: достижимы от старта и не ведут в тупик.
   * confine(row) может дополнительно ограничить срез (зона сферы).
   */
  alive(reach: number, confine: (row: number, cells: Uint8Array) => void = () => {}): Uint8Array {
    const wave = new Uint8Array(this.rows * CELLS);
    let current = new Uint8Array(CELLS);
    let next = new Uint8Array(CELLS);
    for (let i = 0; i < CELLS; i++) current[i] = this.blocked[i] ? 0 : 1;
    confine(0, current);
    wave.set(current, 0);
    for (let row = 1; row < this.rows; row++) {
      this.step(current, row, reach, next);
      confine(row, next);
      wave.set(next, row * CELLS);
      [current, next] = [next, current];
    }
    // Назад: клетка жива, если из неё есть ход в живую клетку следующего среза.
    const alive = wave.slice();
    for (let row = this.rows - 2; row >= 0; row--) {
      const o = row * CELLS;
      const ahead = o + CELLS;
      for (let i = 0; i < CELLS; i++) {
        if (!alive[o + i]) continue;
        let ok = false;
        if (!this.blocked[ahead + i]) {
          ok = alive[ahead + i] === 1;
          for (let j = i + 1; !ok && j <= Math.min(CELLS - 1, i + reach) && !this.blocked[ahead + j]; j++) ok = alive[ahead + j] === 1;
          for (let j = i - 1; !ok && j >= Math.max(0, i - reach) && !this.blocked[ahead + j]; j--) ok = alive[ahead + j] === 1;
        }
        if (!ok) alive[o + i] = 0;
      }
    }
    return alive;
  }
}

function longestRun(cells: Uint8Array, row: number): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < CELLS; i++) {
    run = cells[row * CELLS + i] ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

describe.each([7, 23, 58, 304, 911, 4242])('строгая модель, зерно %i', (seed) => {
  const bars = 104;
  // Два такта сверх проверяемых: волна назад не должна «видеть» искусственный конец трека.
  const perBar = barsOf(seed, bars + 2);
  const all = perBar.flat();
  const grid = new StrictGrid(
    obstaclesOf(all).map((spec, i) => makeObstacle(spec, i + 1)),
    bars + 2,
  );
  const checkedRows = (bars * TICKS_PER_BAR) / SLICE;

  it('живой проход на расчётной скорости нигде не уже GAME.fairness.minGap', () => {
    const alive = grid.alive(REACH);
    let narrowest = CELLS;
    for (let row = 0; row < checkedRows; row++) narrowest = Math.min(narrowest, longestRun(alive, row));
    expect(narrowest).toBeGreaterThanOrEqual(MIN_FREE_RUN);
    // n живых клеток подряд — это (n − 1) единиц хода центра плюс корабль с запасом по обе стороны.
    expect((narrowest - 1) * CELL + 2 * (GAME.player.radius + MARGIN)).toBeGreaterThanOrEqual(GAME.fairness.minGap);
  });

  it('новое препятствие не делает гибельной позицию, которая была живой в момент его появления', () => {
    // Группы появляются в порядке прилёта; проверяем каждую десятую, чтобы тест оставался быстрым.
    const bodies = obstaclesOf(all).map((spec, i) => makeObstacle(spec, i + 1));
    const groups = [...new Set(bodies.map((o) => o.arriveTick))].filter((tick) => tick < bars * TICKS_PER_BAR);
    let checked = 0;
    for (let g = 5; g < groups.length; g += 10) {
      const arrive = groups[g];
      const spawn = Math.min(...bodies.filter((o) => o.arriveTick === arrive).map((o) => o.spawnTick));
      // Окно: от появления группы до её ухода за корабль; позже она ни на что не влияет, а всё, что
      // пролетело за два такта до её появления, уже не меняет ни достижимых, ни живых позиций.
      const fromRow = Math.max(0, Math.floor(spawn / SLICE));
      const toBars = Math.ceil((arrive + 40) / TICKS_PER_BAR) + 1;
      const recent = bodies.filter((o) => o.arriveTick >= spawn - 2 * TICKS_PER_BAR && o.arriveTick <= arrive);
      const before = new StrictGrid(recent.filter((o) => o.arriveTick < arrive), toBars).alive(REACH);
      const after = new StrictGrid(recent, toBars).alive(REACH);
      for (const row of [fromRow, Math.ceil(spawn / SLICE)]) {
        for (let i = 0; i < CELLS; i++) {
          if (before[row * CELLS + i] && !after[row * CELLS + i]) {
            throw new Error(`зерно ${seed}: группа с прилётом ${arrive} запирает клетку ${i} среза ${row}`);
          }
        }
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('все сферы можно взять подряд спокойным манёвром, ни разу не задев препятствие', () => {
    // Идеальная линия: половина расчётной скорости, в срезе каждой сферы — в её зоне подбора (с запасом на
    // движение внутри среза).
    const zones = new Map<number, CrystalSpec>();
    for (const c of crystalsOf(all)) zones.set(Math.ceil(c.arriveTick / SLICE), c);
    const slack = GOLD_REACH * CELL + CELL / 2;
    const alive = grid.alive(GOLD_REACH, (row, cells) => {
      const c = zones.get(row);
      if (!c) return;
      for (let i = 0; i < CELLS; i++) if (Math.abs(cellX(i) - c.x) > pickupReach(c.rare) - slack) cells[i] = 0;
    });
    for (let row = 0; row < checkedRows; row++) {
      if (longestRun(alive, row) === 0) throw new Error(`зерно ${seed}: идеальная линия рвётся в срезе ${row} (тик ${row * SLICE})`);
    }
    expect(zones.size).toBeGreaterThan(600);
  });

  it('соседние сферы достижимы друг за другом, и ни одна не стоит вплотную к препятствию', () => {
    const crystals = crystalsOf(all);
    for (let i = 1; i < crystals.length; i++) {
      const ticks = crystals[i].arriveTick - crystals[i - 1].arriveTick;
      expect(ticks).toBeGreaterThan(0);
      // Линия мелодии идёт не быстрее GOLD_REACH клеток за срез; сфера лежит в пределах зоны от линии.
      const reach = (ticks / SLICE) * GOLD_REACH * CELL + 2 * ZONE_CELLS * CELL;
      expect(Math.abs(crystals[i].x - crystals[i - 1].x)).toBeLessThanOrEqual(reach);
    }
    const bodies = collectObstacles(createChart(seed, OPTIONS), bars + 2);
    const contact = { inRange: false, clear: Infinity };
    for (const c of crystals) {
      for (const o of bodies) {
        if (Math.abs(o.arriveTick - c.arriveTick) > 40) continue;
        for (let t = c.arriveTick - 6; t <= c.arriveTick + 6; t += 0.5) {
          contactAt(o, t, c.x, contact);
          if (contact.inRange && contact.clear < CRYSTAL_CLEAR - 0.5) {
            throw new Error(`сфера (тик ${c.arriveTick}, x ${c.x.toFixed(1)}) в ${contact.clear.toFixed(2)} от ${o.kind} (тик ${o.arriveTick})`);
          }
        }
      }
    }
  });

  it('объект целиком на дороге каждый тик полёта — от появления до ухода за корабль', () => {
    for (const spec of obstaclesOf(all)) {
      const o = makeObstacle(spec, 1);
      // Без зигзага объект летит по прямой — хватит одного тика.
      const gone = spec.sway ? spec.arriveTick + Math.ceil((WORLD.zBehind / WORLD.zFar) * o.approachTicks) : o.spawnTick;
      for (let t = o.spawnTick; t <= gone; t++) {
        const x = spec.x + swayOffset(spec.sway, spec.arriveTick, t);
        expect(x - spec.halfW).toBeGreaterThanOrEqual(-1e-6);
        expect(x + spec.halfW).toBeLessThanOrEqual(WORLD.roadW + 1e-6);
        // Зажим в дорогу в motion.ts ни разу не срабатывает: объект летит так, как задумано.
        expect(obstacleX(o, t)).toBeCloseTo(x, 9);
      }
      if (spec.sway) expect(spec.sway.amp).toBeLessThanOrEqual(swayAmp(levelAtTick(spec.arriveTick)) + 1e-9);
    }
  });
});

describe('коридор генератора', () => {
  it('его собственная статистика сходится с проверками: ни тупиков, ни узких мест, ни отвергнутых сфер', () => {
    for (const seed of [5, 50, 500, 5000]) {
      const chart = createInspectableChart(seed, OPTIONS);
      for (let bar = 0; bar < BARS + 2; bar++) chart.bar(bar);
      const stats = chart.stats();
      expect(stats.narrowestFree).toBeGreaterThanOrEqual(MIN_FREE_RUN);
      expect(stats.narrowestGold).toBeGreaterThanOrEqual(MIN_GOLD_RUN);
      // verifyChart мягче коридора, поэтому достижимых клеток у него не меньше.
      const verified = verifyChart(createChart(seed, OPTIONS), { bars: BARS });
      expect(verified.minReachable).toBeGreaterThanOrEqual(stats.narrowestReach);
      expect(stats.crystals).toBeGreaterThan(1000);
      expect(stats.crystalsRejected).toBeLessThanOrEqual(stats.crystals / 100);
      expect(stats.rejected.order + stats.rejected.window).toBe(0);
    }
  });

  it('трек проходим и медленнее расчётной скорости — на тех 64 ед/с, что на самом деле заложены в сетку', () => {
    const bodies = collectObstacles(createChart(9, OPTIONS), 80);
    expect(verifyObstacles(bodies, { bars: 80, speed: (REACH * CELL * TICK_RATE) / SLICE, margin: 1 }).ok).toBe(true);
  });
});

// ─── Кривая сложности и драматургия ─────────────────────────────────────────

describe('плотность и драматургия уровня', () => {
  const SEEDS = range(201, 20);
  const charts = SEEDS.map((seed) => barsOf(seed));
  /** obstacles[seed][level − 1], crystals[seed][level − 1] */
  const obstacles = charts.map((perBar) => range(0, LEVELS).map((l) => perBar.slice(l * 8, l * 8 + 8).reduce((n, items) => n + obstaclesOf(items).length, 0)));
  const crystals = charts.map((perBar) => range(0, LEVELS).map((l) => perBar.slice(l * 8, l * 8 + 8).reduce((n, items) => n + crystalsOf(items).length, 0)));
  const perSecond = (level: number) => mean(obstacles.map((levels) => levels[level - 1])) / (TICKS_PER_LEVEL / TICK_RATE);

  it('препятствий в секунду: ≈1 на 1-м уровне, ≈1.9 на 6-м, ≈2.8 с 12-го — и не больше 12 в такте', () => {
    expect(perSecond(1)).toBeGreaterThanOrEqual(0.8);
    expect(perSecond(1)).toBeLessThanOrEqual(1.2);
    expect(perSecond(6)).toBeGreaterThanOrEqual(1.6);
    expect(perSecond(6)).toBeLessThanOrEqual(2.2);
    for (let level = 12; level <= LEVELS; level++) {
      expect(perSecond(level)).toBeGreaterThanOrEqual(2.4);
      expect(perSecond(level)).toBeLessThanOrEqual(3.2);
    }
    // Рост до плато ровный: каждый уровень плотнее предыдущего и близок к замыслу.
    for (let level = 2; level <= 11; level++) expect(perSecond(level)).toBeGreaterThan(perSecond(level - 1));
    for (let level = 1; level <= LEVELS; level++) expect(Math.abs(perSecond(level) - densityForLevel(level))).toBeLessThan(0.2);
    // И у отдельного зерна разброс невелик.
    for (const levels of obstacles) {
      levels.forEach((count, l) => {
        const rate = count / (TICKS_PER_LEVEL / TICK_RATE);
        expect(Math.abs(rate - densityForLevel(l + 1))).toBeLessThan(0.55);
      });
    }
    for (const perBar of charts) {
      for (const items of perBar) {
        expect(obstaclesOf(items).length).toBeLessThanOrEqual(MAX_OBSTACLES_PER_BAR);
        expect(crystalsOf(items).length).toBeLessThanOrEqual(MAX_CRYSTALS_PER_BAR);
      }
    }
  });

  it('сфер хватает на x8 на каждом уровне, и ни один такт не остаётся без мелодии', () => {
    const forMax = GAME.combo.step * (GAME.combo.maxMultiplier - 1);
    expect(multiplierForChain(forMax)).toBe(GAME.combo.maxMultiplier);
    for (const levels of crystals) for (const count of levels) expect(count).toBeGreaterThanOrEqual(forMax + 12);
    for (const perBar of charts) {
      for (const items of perBar) expect(crystalsOf(items).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('с первого же такта после вступления есть от чего уклоняться', () => {
    for (const perBar of charts) {
      expect(obstaclesOf(perBar[0])).toHaveLength(0);
      expect(obstaclesOf(perBar[GAME.firstObstacleBar]).length).toBeGreaterThanOrEqual(1);
      // Весь первый уровень: ни одного пустого такта, кроме передышки.
      for (let bar = GAME.firstObstacleBar; bar < 8; bar++) {
        if (BAR_ROLES[bar] !== 'breather') expect(obstaclesOf(perBar[bar]).length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('передышка — награда: почти без препятствий и самая длинная цепочка сфер уровня', () => {
    const byRole = { intro: [] as number[], develop: [] as number[], peak: [] as number[], breather: [] as number[], buildup: [] as number[] };
    const crystalsByRole = { intro: [] as number[], develop: [] as number[], peak: [] as number[], breather: [] as number[], buildup: [] as number[] };
    for (const perBar of charts) {
      perBar.forEach((items, bar) => {
        if (bar < 8) return;
        const role = BAR_ROLES[barInLevel(bar)];
        byRole[role].push(obstaclesOf(items).length);
        crystalsByRole[role].push(crystalsOf(items).length);
        if (role === 'breather') {
          expect(obstaclesOf(items).length).toBeLessThanOrEqual(2);
          expect(crystalsOf(items).length).toBeGreaterThanOrEqual(8);
        }
      });
    }
    // Драматургия: вступление → развитие → пик, затем выдох и разгон.
    expect(mean(byRole.intro)).toBeLessThan(mean(byRole.develop));
    expect(mean(byRole.develop)).toBeLessThan(mean(byRole.peak));
    expect(mean(byRole.breather)).toBeLessThan(mean(byRole.intro) / 2);
    expect(mean(byRole.buildup)).toBeGreaterThan(mean(byRole.intro));
    for (const role of ['intro', 'develop', 'peak', 'buildup'] as const) {
      expect(mean(crystalsByRole.breather)).toBeGreaterThan(mean(crystalsByRole[role]) + 1.5);
    }
  });

  it('новый уровень открывается на сильной доле: ворота или портал там, куда вёл разгон', () => {
    let drops = 0;
    let total = 0;
    for (const perBar of charts) {
      for (let level = 2; level <= LEVELS; level++) {
        const first = obstaclesOf(perBar[(level - 1) * 8]).filter((o) => o.arriveTick === (level - 1) * TICKS_PER_LEVEL);
        total += 1;
        if (first.some((o) => o.kind === 'laser') || first.length === 2) drops += 1;
      }
    }
    expect(drops / total).toBeGreaterThan(0.9);
  });

  it('виды препятствий и зигзаг приходят по уровням: лазеры и зигзаг — со 2-го, шестнадцатые — на высоких', () => {
    const count = (level: number, test: (o: ObstacleSpec) => boolean) => {
      let hits = 0;
      let total = 0;
      for (const perBar of charts) {
        for (const o of obstaclesOf(perBar.slice((level - 1) * 8, level * 8).flat())) {
          total += 1;
          if (test(o)) hits += 1;
        }
      }
      return hits / total;
    };
    const swayed = (o: ObstacleSpec) => o.sway !== null;
    const offEighth = (o: ObstacleSpec) => o.arriveTick % TICKS_PER_EIGHTH !== 0;
    expect(count(1, swayed)).toBe(0);
    expect(count(1, (o) => o.kind === 'laser')).toBe(0);
    expect(count(2, swayed)).toBeGreaterThan(0.1);
    expect(count(6, swayed)).toBeGreaterThan(count(2, swayed));
    expect(count(12, swayed)).toBeGreaterThan(0.3);
    for (let level = 2; level <= LEVELS; level++) expect(count(level, (o) => o.kind === 'laser')).toBeGreaterThan(0.03);
    // Пилы с уровнем учащаются (вес растёт), кубы остаются основой.
    expect(count(12, (o) => o.kind === 'saw')).toBeGreaterThan(count(2, (o) => o.kind === 'saw') + 0.1);
    expect(count(12, (o) => o.kind === 'cube')).toBeGreaterThan(0.3);
    for (let level = 1; level <= 3; level++) expect(count(level, offEighth)).toBeLessThan(0.02);
    for (let level = 8; level <= LEVELS; level++) expect(count(level, offEighth)).toBeGreaterThan(0.05);
    // Размеры — в пределах пресетов.
    for (const perBar of charts.slice(0, 4)) {
      for (const o of obstaclesOf(perBar.flat())) {
        if (o.kind === 'laser') continue;
        expect(o.halfW).toBeGreaterThanOrEqual(OBSTACLES[o.kind].sizeMin - 1e-9);
        expect(o.halfW).toBeLessThanOrEqual(OBSTACLES[o.kind].sizeMax + 1e-9);
      }
    }
  });

  it('сферы лежат на восьмых и шестнадцатых, в пределах хода корабля, а линия мелодии плавная', () => {
    let jumps = 0;
    let pairs = 0;
    for (const perBar of charts.slice(0, 6)) {
      const all = crystalsOf(perBar.flat());
      for (const c of all) {
        expect(isOnGrid(c.arriveTick)).toBe(true);
        expect(c.sway).toBeNull();
        expect(cellOf(c.x)).toBeGreaterThanOrEqual(1);
        expect(cellOf(c.x)).toBeLessThanOrEqual(CELLS - 2);
      }
      for (let i = 1; i < all.length; i++) {
        const ticks = all[i].arriveTick - all[i - 1].arriveTick;
        if (ticks > TICKS_PER_EIGHTH) continue;
        pairs += 1;
        // Соседние ноты цепочки: шаг в сторону больше корпуса корабля — редкость.
        if (Math.abs(all[i].x - all[i - 1].x) > 2 * GAME.player.radius + 1) jumps += 1;
      }
    }
    expect(pairs).toBeGreaterThan(3000);
    expect(jumps / pairs).toBeLessThan(0.25);
  });
});

// ─── Детерминизм ────────────────────────────────────────────────────────────

describe('детерминизм', () => {
  it('такты, запрошенные по порядку по одному разу, одинаковы от запуска к запуску', () => {
    for (const seed of [3, 77, 123456789, 0xffffffff]) {
      expect(JSON.stringify(barsOf(seed, 48))).toBe(JSON.stringify(barsOf(seed, 48)));
    }
    expect(JSON.stringify(barsOf(3, 24))).not.toBe(JSON.stringify(barsOf(4, 24)));
  });

  it('повторный запрос такта, пропуск вперёд и возврат к давно забытому такту дают тот же трек', () => {
    const inOrder = barsOf(31, 40);
    const chart = createChart(31, OPTIONS);
    // Пропуск вперёд: такты 0…19 сочиняются по дороге.
    expect(chart.bar(20)).toEqual(inOrder[20]);
    expect(chart.bar(21)).toEqual(inOrder[21]);
    // Повтор недавнего такта.
    expect(chart.bar(20)).toEqual(inOrder[20]);
    expect(chart.bar(16)).toEqual(inOrder[16]);
    // Давно забытый такт: трек сочиняется заново с начала.
    expect(chart.bar(2)).toEqual(inOrder[2]);
    expect(chart.bar(39)).toEqual(inOrder[39]);
  });

  it('отдаёт свежий массив в порядке прилёта и не боится негодных номеров', () => {
    const chart = createChart(8, OPTIONS);
    const first = chart.bar(5);
    expect(first.length).toBeGreaterThan(3);
    for (let i = 1; i < first.length; i++) expect(first[i].arriveTick).toBeGreaterThanOrEqual(first[i - 1].arriveTick);
    first.length = 0;
    expect(chart.bar(5).length).toBeGreaterThan(3);
    expect(chart.bar(-1)).toEqual([]);
    expect(chart.bar(2.5)).toEqual([]);
    expect(chart.bar(Number.NaN)).toEqual([]);
  });

  it('шанс редкой сферы меняет только сами редкие сферы, но не рисунок трека', () => {
    const plain = barsOf(64, 40, { rareChance: 0 }).flat();
    const lucky = barsOf(64, 40, { rareChance: 0.5 }).flat();
    expect(lucky.map((item) => [item.kind, item.arriveTick, item.x])).toEqual(plain.map((item) => [item.kind, item.arriveTick, item.x]));
    expect(crystalsOf(plain).some((c) => c.rare)).toBe(false);
    const share = crystalsOf(lucky).filter((c) => c.rare).length / crystalsOf(lucky).length;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });

  it('зёрна — любые числа: дробные, отрицательные и огромные дают обычный честный трек', () => {
    for (const seed of [0, -17, 3.7, 2 ** 40 + 5]) {
      const perBar = barsOf(seed, 24);
      expect(obstaclesOf(perBar.flat()).length).toBeGreaterThan(40);
      expect(verifyChart(createChart(seed, OPTIONS), { bars: 24 }).ok).toBe(true);
    }
  });
});

// ─── Фоновая сцена меню ─────────────────────────────────────────────────────

describe('фоновый трек меню', () => {
  const ATTRACT: ChartOptions = { rareChance: GAME.crystal.rareChance, attract: true };

  it('редкий декоративный цикл: не больше трёх препятствий в такте, всех видов, без роста сложности', () => {
    for (const seed of [1, 2, 3]) {
      const perBar = barsOf(seed, 400, ATTRACT);
      const perBarCount = perBar.map((items) => obstaclesOf(items).length);
      expect(Math.max(...perBarCount)).toBeLessThanOrEqual(3);
      const early = obstaclesOf(perBar.slice(8, 108).flat());
      const late = obstaclesOf(perBar.slice(300, 400).flat());
      // Через 12 минут меню сцена та же, что в первую минуту.
      expect(Math.abs(late.length - early.length)).toBeLessThanOrEqual(8);
      expect(early.length / 100).toBeGreaterThan(0.8);
      expect(early.length / 100).toBeLessThan(2);
      expect(new Set(late.map((o) => o.kind))).toEqual(new Set(['cube', 'saw', 'laser']));
      expect(mean(perBar.slice(8).map((items) => crystalsOf(items).length))).toBeGreaterThan(3);
      for (const item of perBar.flat()) expect(isOnGrid(item.arriveTick)).toBe(true);
      for (const o of late) if (o.sway) expect(o.sway.amp).toBeLessThanOrEqual(swayAmp(3) + 1e-9);
    }
  });

  it('объекты остаются на дороге при подлёте 1-го уровня, с которым их показывает меню', () => {
    const perBar = barsOf(4, 400, ATTRACT);
    for (const spec of obstaclesOf(perBar.slice(300).flat())) {
      for (let t = spec.arriveTick - GAME.approach.base; t <= spec.arriveTick + 60; t++) {
        const x = spec.x + swayOffset(spec.sway, spec.arriveTick, t);
        expect(x - spec.halfW).toBeGreaterThanOrEqual(-1e-6);
        expect(x + spec.halfW).toBeLessThanOrEqual(WORLD.roadW + 1e-6);
      }
    }
  });
});

// ─── Цена такта ─────────────────────────────────────────────────────────────

describe('цена такта', () => {
  it('chart.bar() укладывается в бюджет кадра с большим запасом', () => {
    // Симуляция вызывает bar() внутри шага раз в такт. Порог щедрый (машина с тестами бывает занята):
    // сторож от регресса на порядок, а не замер. Берётся лучшее из трёх проходов по каждому такту.
    const seeds = [11, 12, 13];
    const warm = createChart(10, OPTIONS);
    for (let bar = 0; bar < 120; bar++) warm.bar(bar);
    const best = new Float64Array(seeds.length * BARS).fill(Infinity);
    for (let round = 0; round < 3; round++) {
      seeds.forEach((seed, s) => {
        const chart = createChart(seed, OPTIONS);
        for (let bar = 0; bar < BARS; bar++) {
          const from = performance.now();
          chart.bar(bar);
          const ms = performance.now() - from;
          if (ms < best[s * BARS + bar]) best[s * BARS + bar] = ms;
        }
      });
    }
    expect(mean([...best])).toBeLessThan(1);
    expect(Math.max(...best)).toBeLessThan(3);
  });
});
