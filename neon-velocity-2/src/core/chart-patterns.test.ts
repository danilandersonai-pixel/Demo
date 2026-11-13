/**
 * Тесты кирпичиков генератора: проба препятствия, коридор честности и
 * именованные паттерны — каждый по отдельности, на пустой дороге.
 */
import { describe, expect, it } from 'vitest';
import { CELL, cellX, Corridor, CRYSTAL_CLEAR, MARGIN, MIN_FREE_RUN, REACH, rowOf, SLICE } from './chart-corridor';
import { Contour } from './chart-melody';
import {
  barrier,
  dropGate,
  fitSway,
  funnel,
  kindWeight,
  laserGate,
  MAX_OBSTACLES_PER_BAR,
  pair,
  reachOf,
  roll,
  sawWall,
  single,
  slalom,
  Stage,
  stairs,
  syncopation,
} from './chart-patterns';
import { CELLS, gateCells, solidCells, type Span } from './chart-probe';
import { contactAt, dangerWindow } from './collision';
import { GAME, laserHalfGapForLevel, OBSTACLES, swayAmp, WORLD } from './config';
import { approachFor, makeObstacle } from './entities';
import { swayOffset } from './motion';
import { createRng } from './rng';
import { barStartTick, TICKS_PER_BAR, TICKS_PER_EIGHTH, TICKS_PER_LEVEL, TICKS_PER_STEP } from './timing';
import type { Obstacle, ObstacleSpec, Sway } from './types';

const ROAD = WORLD.roadW;
const CENTER = ROAD / 2;

/** Третий такт уровня: достаточно далеко от начала, чтобы окно коридора уже скользило. */
function barOfLevel(level: number): number {
  return (level - 1) * 8 + 2;
}

/** Коридор, доведённый до такта bar по пустой дороге, и ровная линия мелодии по центру. */
function emptyRoad(bar: number): { corridor: Corridor; contour: Contour } {
  const corridor = new Corridor();
  const contour = new Contour();
  for (let b = 0; b <= bar; b++) {
    corridor.advance(barStartTick(b));
    contour.extend(CENTER, CENTER);
  }
  return { corridor, contour };
}

function stageAt(level: number, seed = 1): Stage {
  const bar = barOfLevel(level);
  const { corridor, contour } = emptyRoad(bar);
  return new Stage(createRng(seed), corridor, contour, barStartTick(bar), level);
}

function body(spec: ObstacleSpec): Obstacle {
  return makeObstacle(spec, 0);
}

function cubeSpec(arriveTick: number, x: number, halfW = 5.5): ObstacleSpec {
  return { kind: 'cube', arriveTick, x, sway: null, halfW, yaw0: 0.4, yawRate: 0.01 };
}

function sawSpec(arriveTick: number, x: number, halfW = 8): ObstacleSpec {
  return { kind: 'saw', arriveTick, x, sway: null, halfW, yaw0: 0, yawRate: 0.08 };
}

/** Ряд сомкнутых пил, закрывающий дорогу от from до to. */
function sawRow(arriveTick: number, from: number, to: number): Obstacle[] {
  const out: Obstacle[] = [];
  for (let x = from + 8; x - 8 < to; x += 14) out.push(body(sawSpec(arriveTick, Math.min(x, ROAD - 8))));
  return out;
}

/** Края хитбокса по x (у куба — худший поворот). */
function extent(spec: ObstacleSpec): Span {
  return { lo: spec.x - reachOf(spec), hi: spec.x + reachOf(spec) };
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

// ─── Проба препятствия ──────────────────────────────────────────────────────

describe('проба препятствия', () => {
  it('занятые клетки совпадают с перебором через contactAt — для любого вида, поворота, зигзага и запаса', () => {
    const rng = createRng(2026);
    const span: Span = { lo: 0, hi: 0 };
    const contact = { inRange: false, clear: Infinity };
    let withCells = 0;
    for (let n = 0; n < 1500; n++) {
      const kind = rng.pick(['cube', 'saw', 'laser'] as const);
      const margin = [0.6, 0.8, 1, 1.2, 1.5][n % 5];
      const arriveTick = rng.int(0, 19) * TICKS_PER_LEVEL + rng.int(0, 127) * TICKS_PER_STEP;
      const halfW = kind === 'cube' ? rng.range(4.5, 6.5) : kind === 'saw' ? rng.range(5, 8) : rng.range(9.5, 22);
      const sway: Sway | null = rng.chance(0.5) ? { amp: rng.range(3, 26), periodTicks: rng.int(120, 330), phase: rng.range(0, 6.28) } : null;
      const o = body({ kind, arriveTick, x: rng.range(halfW, ROAD - halfW), halfW, sway, yaw0: rng.range(0, 6.28), yawRate: rng.range(-2.4, 2.4) / 128 });
      const w = dangerWindow(o);
      for (let time = w.from - 1; time <= w.to + 1; time += 0.5) {
        // Перебор: клетки, где зазор меньше запаса (для лазера — где запас соблюдён).
        let lo = CELLS;
        let hi = -1;
        let count = 0;
        let inRange = false;
        for (let i = 0; i < CELLS; i++) {
          contactAt(o, time, cellX(i), contact);
          inRange = contact.inRange;
          if (!contact.inRange || contact.clear < margin === (kind === 'laser')) continue;
          if (lo === CELLS) lo = i;
          hi = i;
          count += 1;
        }
        if (kind === 'laser') {
          expect(gateCells(o, time, margin, span)).toBe(inRange);
          if (!inRange) continue;
          if (count === 0) expect(span.lo).toBeGreaterThan(span.hi);
          else expect([span.lo, span.hi, span.hi - span.lo + 1]).toEqual([lo, hi, count]);
          withCells += 1;
        } else {
          const found = solidCells(o, time, margin, span);
          expect(found).toBe(count > 0);
          if (!found) continue;
          // Занятые клетки — один сплошной отрезок.
          expect([span.lo, span.hi, span.hi - span.lo + 1]).toEqual([lo, hi, count]);
          withCells += 1;
        }
      }
    }
    expect(withCells).toBeGreaterThan(5000);
  });
});

// ─── Коридор ────────────────────────────────────────────────────────────────

describe('коридор честности', () => {
  it('сетка та же, что у verifyChart', () => {
    expect(CELL).toBe(1);
    expect(SLICE).toBe(4);
    expect(CELLS).toBe(91);
    expect(MARGIN).toBe(1);
    expect(REACH).toBe(2);
    // Живой проход из MIN_FREE_RUN клеток — это не меньше minGap между хитбоксами.
    expect((MIN_FREE_RUN - 1) * CELL + 2 * (GAME.player.radius + MARGIN)).toBeGreaterThanOrEqual(GAME.fairness.minGap);
  });

  it('принимает одиночное препятствие и отвергает стену без окна, не меняя состояние', () => {
    const bar = barOfLevel(3);
    const { corridor } = emptyRoad(bar);
    const tick = barStartTick(bar) + 8 * TICKS_PER_STEP;
    expect(corridor.place(sawRow(tick, 0, ROAD))).toBe(false);
    expect(corridor.stats.rejected.width).toBe(1);
    expect(corridor.stats.placed).toBe(0);
    // После отказа дорога по-прежнему пуста: то же препятствие, что прошло бы на чистой дороге, проходит.
    expect(corridor.place([body(cubeSpec(tick, CENTER))])).toBe(true);
    expect(corridor.stats.placed).toBe(1);
  });

  it('стена с окном проходит, если окно не уже минимального прохода', () => {
    const bar = barOfLevel(3);
    const tick = barStartTick(bar) + 8 * TICKS_PER_STEP;
    const wall = (window: number) => [...sawRow(tick, 0, CENTER - window / 2), ...sawRow(tick, CENTER + window / 2, ROAD)];
    // Окно между центрами крайних пил шире на их общий «недокрытый» край, поэтому берём с запасом в обе стороны.
    expect(emptyRoad(bar).corridor.place(wall(GAME.fairness.minGap + 8))).toBe(true);
    const tight = emptyRoad(bar).corridor;
    expect(tight.place(wall(GAME.fairness.minGap - 6))).toBe(false);
    expect(tight.stats.rejected.width).toBe(1);
  });

  it('не ловит тем, чего ещё не видно: широкая стена на пределе скорости отвергается, на 1-м уровне — нет', () => {
    // Две трети дороги закрыты. На пределе скорости от появления до удара 100 тиков — от левого бортика не успеть.
    const fast = barOfLevel(18);
    const fastRoad = emptyRoad(fast).corridor;
    expect(approachFor(barStartTick(fast))).toBe(GAME.approach.min);
    expect(fastRoad.place(sawRow(barStartTick(fast) + 8 * TICKS_PER_STEP, 0, 62))).toBe(false);
    expect(fastRoad.stats.rejected.reveal).toBe(1);
    // На 1-м уровне объект виден 300 тиков — времени хватает из любой точки.
    const slow = barOfLevel(1);
    expect(emptyRoad(slow).corridor.place(sawRow(barStartTick(slow) + 8 * TICKS_PER_STEP, 0, 62))).toBe(true);
  });

  it('группы принимаются только в порядке прилёта и только внутри открытого окна', () => {
    const bar = barOfLevel(4);
    const { corridor } = emptyRoad(bar);
    const start = barStartTick(bar);
    expect(corridor.place([body(cubeSpec(start + 120, 30))])).toBe(true);
    expect(corridor.place([body(cubeSpec(start + 60, 70))])).toBe(false);
    expect(corridor.stats.rejected.order).toBe(1);
    expect(corridor.place([body(cubeSpec(start + 3 * TICKS_PER_BAR, 70))])).toBe(false);
    expect(corridor.stats.rejected.window).toBe(1);
  });

  it('сфера: не в препятствии, достижима от предыдущей, а цепочка разом даёт то же, что по одной', () => {
    const bar = barOfLevel(2);
    const start = barStartTick(bar);
    const { corridor } = emptyRoad(bar);
    expect(corridor.place([body(cubeSpec(start + 120, 30))])).toBe(true);
    // Прямо в кубе и вплотную к нему — нельзя.
    expect(corridor.addCrystal(start + 120, 30)).toBe(false);
    expect(corridor.addCrystal(start + 120, 30 + reachOf(cubeSpec(0, 0)) + GAME.player.radius + CRYSTAL_CLEAR - 1.5)).toBe(false);
    expect(corridor.addCrystal(start + 30, CENTER)).toBe(true);
    // Через восьмую долю на другом краю дороги: идеальная линия туда не успевает.
    expect(corridor.addCrystal(start + 60, CENTER + 30)).toBe(false);
    expect(corridor.addCrystal(start + 60, CENTER + 4)).toBe(true);
    // Раньше уже поставленной — нельзя.
    expect(corridor.addCrystal(start + 45, CENTER)).toBe(false);
    expect(corridor.stats.crystals).toBe(2);
    expect(corridor.stats.crystalsRejected).toBe(4);

    const ticks = [start + 30, start + 60, start + 90, start + 120];
    const xs = [CENTER, CENTER + 4, CENTER + 8, CENTER + 12];
    const batch = emptyRoad(bar).corridor;
    const single = emptyRoad(bar).corridor;
    expect(batch.addCrystals(ticks, xs)).toBe(true);
    for (let i = 0; i < ticks.length; i++) expect(single.addCrystal(ticks[i], xs[i])).toBe(true);
    for (let tick = start; tick < start + TICKS_PER_BAR; tick += SLICE) {
      for (const x of [20, CENTER, CENTER + 6, 80]) expect(batch.goldClamp(tick, x)).toBe(single.goldClamp(tick, x));
    }
    // Цепочка с недостижимой сферой не принимается и ничего не меняет.
    const broken = emptyRoad(bar).corridor;
    expect(broken.addCrystals([start + 30, start + 45], [20, 80])).toBe(false);
    expect(broken.stats.crystals).toBe(0);
    expect(broken.goldClamp(start + 30, 80)).toBe(80);
  });

  it('препятствие, которое срывает идеальное комбо, отвергается', () => {
    const bar = barOfLevel(2);
    const start = barStartTick(bar);
    const { corridor } = emptyRoad(bar);
    expect(corridor.addCrystal(start + 60, CENTER)).toBe(true);
    // Куб прилетает через шестнадцатую прямо туда, где только что была сфера.
    expect(corridor.place([body(cubeSpec(start + 75, CENTER))])).toBe(false);
    expect(corridor.stats.rejected.gold + corridor.stats.rejected.crystal).toBe(1);
    // В стороне от линии тот же куб никому не мешает.
    expect(corridor.place([body(cubeSpec(start + 75, CENTER + 30))])).toBe(true);
  });

  it('золотая полоса сходится к сфере и расходится после неё', () => {
    const bar = barOfLevel(2);
    const start = barStartTick(bar);
    const { corridor } = emptyRoad(bar);
    expect(corridor.addCrystal(start + 120, 40)).toBe(true);
    const at = rowOf(start + 120) * SLICE;
    // В срезе сферы идеальная линия — в её зоне; чем дальше по времени, тем свободнее.
    expect(Math.abs(corridor.goldClamp(at, 90) - 40)).toBeLessThanOrEqual(3);
    expect(Math.abs(corridor.goldClamp(at + 40, 90) - 40)).toBeLessThanOrEqual(3 + 10);
    expect(Math.abs(corridor.goldClamp(at - 40, 90) - 40)).toBeLessThanOrEqual(3 + 10);
    expect(corridor.goldClamp(at + 120, 62)).toBe(62);
  });

  it('проход ворот ставится туда, куда успеют все', () => {
    const bar = barOfLevel(18);
    const start = barStartTick(bar);
    const { corridor } = emptyRoad(bar);
    const tick = start + 120;
    const band = corridor.gateBand(tick, tick - approachFor(tick), 8);
    expect(band).not.toBeNull();
    // За 100 тиков честный игрок проходит 50 клеток: от любого бортика достижима только середина дороги.
    expect(band!.lo).toBeGreaterThan(30);
    expect(band!.hi).toBeLessThan(70);
    expect(band!.lo).toBeLessThanOrEqual(CENTER);
    expect(band!.hi).toBeGreaterThanOrEqual(CENTER);
  });
});

// ─── Паттерны ───────────────────────────────────────────────────────────────

describe('паттерны', () => {
  it('веса видов препятствий — из пресетов: лазер появляется со 2-го уровня и учащается', () => {
    expect(kindWeight('laser', 1)).toBe(0);
    expect(kindWeight('laser', 2)).toBe(OBSTACLES.laser.weight);
    expect(kindWeight('laser', 9)).toBeGreaterThan(kindWeight('laser', 2));
    expect(kindWeight('cube', 1)).toBe(OBSTACLES.cube.weight);
    expect(kindWeight('saw', 8)).toBeGreaterThan(kindWeight('saw', 1));
  });

  it.each(SEEDS)('одиночный объект: в долю, по пресету, на дороге (зерно %i)', (seed) => {
    const stage = stageAt(4, seed);
    expect(single(stage, 6)).toBe(1);
    expect(single(stage, 12, { kind: 'saw', sway: 'never' })).toBe(1);
    const [first, second] = stage.obstacles;
    expect(first.arriveTick).toBe(stage.tickOf(6));
    expect(['cube', 'saw']).toContain(first.kind);
    expect(second).toMatchObject({ kind: 'saw', sway: null, arriveTick: stage.tickOf(12) });
    for (const spec of stage.obstacles) {
      const preset = OBSTACLES[spec.kind];
      expect(spec.halfW).toBeGreaterThanOrEqual(preset.sizeMin);
      expect(spec.halfW).toBeLessThanOrEqual(preset.sizeMax);
      expect(spec.x - spec.halfW).toBeGreaterThanOrEqual(0);
      expect(spec.x + spec.halfW).toBeLessThanOrEqual(ROAD);
    }
    // На 1-м уровне зигзага нет, даже когда уровень «должен» его показать.
    const calm = stageAt(1, seed);
    calm.wantSway = true;
    expect(single(calm, 8)).toBe(1);
    expect(calm.obstacles[0].sway).toBeNull();
  });

  it('одиночный объект закрывает «долги» уровня: зигзаг и недостающий вид', () => {
    for (const seed of SEEDS) {
      const stage = stageAt(5, seed);
      stage.wantSway = true;
      stage.wantKind = 'saw';
      expect(single(stage, 8, { aim: 'side' })).toBe(1);
      expect(stage.obstacles[0].kind).toBe('saw');
      expect(stage.wantKind).toBeNull();
      if (stage.obstacles[0].sway) expect(stage.wantSway).toBe(false);
    }
  });

  it.each(SEEDS)('пара: два объекта в один тик, проход не уже минимального, линия идёт в проход (зерно %i)', (seed) => {
    const stage = stageAt(6, seed);
    expect(pair(stage, 4, { sway: 'never' })).toBe(2);
    const [left, right] = stage.obstacles;
    expect(left.arriveTick).toBe(stage.tickOf(4));
    expect(right.arriveTick).toBe(left.arriveTick);
    const gap = extent(right).lo - extent(left).hi;
    expect(gap).toBeGreaterThanOrEqual(GAME.fairness.minGap);
    expect(gap).toBeLessThan(45);
    expect(stage.lures).toHaveLength(1);
    expect(stage.lures[0].x).toBeCloseTo((extent(right).lo + extent(left).hi) / 2, 6);
  });

  it.each(SEEDS)('лесенка: мелкие кубы по восьмым шагают в одну сторону (зерно %i)', (seed) => {
    const stage = stageAt(3, seed);
    expect(stairs(stage, 2, 4)).toBe(4);
    const steps = stage.obstacles;
    const direction = Math.sign(steps[1].x - steps[0].x);
    expect(direction).not.toBe(0);
    steps.forEach((spec, i) => {
      expect(spec.kind).toBe('cube');
      expect(spec.arriveTick).toBe(stage.tickOf(2) + i * TICKS_PER_EIGHTH);
      expect(spec.halfW).toBeLessThanOrEqual(OBSTACLES.cube.sizeMin + 0.35 * (OBSTACLES.cube.sizeMax - OBSTACLES.cube.sizeMin) + 1e-9);
      if (i > 0) expect(Math.sign(spec.x - steps[i - 1].x)).toBe(direction);
    });
    // Лесенка качается только целиком: зигзаг у ступеней общий.
    const swayed = steps.filter((spec) => spec.sway !== null);
    for (const spec of swayed) expect(spec.sway).toBe(swayed[0].sway);
  });

  it('лесенку можно направить, и она помещается на дороге', () => {
    for (const direction of [1, -1] as const) {
      const stage = stageAt(4, 3);
      expect(stairs(stage, 0, 4, direction)).toBeGreaterThanOrEqual(3);
      const xs = stage.obstacles.map((spec) => spec.x);
      expect(Math.sign(xs[xs.length - 1] - xs[0])).toBe(direction);
    }
  });

  it.each(SEEDS)('барьер: сомкнутые пилы в один тик перекрывают линию мелодии (зерно %i)', (seed) => {
    const stage = stageAt(5, seed);
    const placed = barrier(stage, 8, 3);
    expect(placed).toBeGreaterThanOrEqual(2);
    const saws = [...stage.obstacles].sort((a, b) => a.x - b.x);
    for (const saw of saws) expect(saw).toMatchObject({ kind: 'saw', arriveTick: stage.tickOf(8), sway: null });
    // Между соседними пилами корабль не проходит.
    for (let i = 1; i < saws.length; i++) expect(extent(saws[i]).lo - extent(saws[i - 1]).hi).toBeLessThan(2 * GAME.player.radius);
    expect(extent(saws[0]).lo).toBeLessThan(CENTER);
    expect(extent(saws[saws.length - 1]).hi).toBeGreaterThan(CENTER);
  });

  it.each(SEEDS)('стена из пил: закрыта вся дорога, кроме одного окна (зерно %i)', (seed) => {
    const stage = stageAt(4, seed);
    const placed = sawWall(stage, 8);
    expect(placed).toBeGreaterThanOrEqual(3);
    expect(placed).toBeLessThanOrEqual(MAX_OBSTACLES_PER_BAR);
    const saws = [...stage.obstacles].sort((a, b) => a.x - b.x);
    // Проходы: от бортика до первой пилы, между пилами, от последней пилы до бортика.
    const edges = [0, ...saws.flatMap((saw) => [extent(saw).lo, extent(saw).hi]), ROAD];
    const gaps: number[] = [];
    for (let i = 0; i < edges.length; i += 2) gaps.push(edges[i + 1] - edges[i]);
    const open = gaps.filter((gap) => gap >= 2 * GAME.player.radius);
    expect(open).toHaveLength(1);
    expect(open[0]).toBeGreaterThanOrEqual(GAME.fairness.minGap);
    for (const saw of saws) expect(saw).toMatchObject({ kind: 'saw', arriveTick: stage.tickOf(8), sway: null });
    // Линию мелодии манит середина окна.
    const window = gaps.indexOf(open[0]);
    expect(stage.lures[0].x).toBeGreaterThan(edges[2 * window]);
    expect(stage.lures[0].x).toBeLessThan(edges[2 * window + 1]);
  });

  it.each(SEEDS)('лазерные ворота: проход по уровню, целиком на дороге (зерно %i)', (seed) => {
    for (const level of [2, 6, 12]) {
      const stage = stageAt(level, seed);
      expect(laserGate(stage, 8)).toBe(1);
      const gate = stage.obstacles[0];
      expect(gate.kind).toBe('laser');
      expect(gate.halfW).toBeGreaterThanOrEqual(laserHalfGapForLevel(level));
      expect(gate.halfW).toBeLessThanOrEqual(22);
      expect(gate.x - gate.halfW).toBeGreaterThanOrEqual(0);
      expect(gate.x + gate.halfW).toBeLessThanOrEqual(ROAD);
      expect(stage.lures[0]).toEqual({ tick: stage.tickOf(8), x: gate.x });
    }
    const centered = stageAt(8, seed);
    expect(laserGate(centered, 4, { center: 42, sway: 'never' })).toBe(1);
    expect(centered.obstacles[0]).toMatchObject({ x: 42, sway: null });
  });

  it.each(SEEDS)('слалом: столбы встают по очереди слева и справа от линии (зерно %i)', (seed) => {
    const stage = stageAt(6, seed);
    expect(slalom(stage, [0, 4, 8, 12])).toBe(4);
    const sides = stage.obstacles.map((spec) => Math.sign(spec.x - CENTER));
    for (let i = 1; i < sides.length; i++) expect(sides[i]).toBe(-sides[i - 1]);
    for (const spec of stage.obstacles) {
      // Столб стоит сбоку от линии: корабль на оси слалома его не задевает.
      expect(Math.abs(spec.x - CENTER)).toBeGreaterThan(reachOf(spec) + GAME.player.radius + MARGIN);
      expect(Math.abs(spec.x - CENTER)).toBeLessThan(reachOf(spec) + GAME.player.radius + MARGIN + 8);
    }
  });

  it.each(SEEDS)('синкопы: ряд мелких кубов с ударами на шестнадцатых (зерно %i)', (seed) => {
    const stage = stageAt(8, seed);
    const placed = syncopation(stage, 6);
    expect(placed).toBeGreaterThanOrEqual(4);
    const steps = stage.obstacles.map((spec) => (spec.arriveTick - stage.barStart) / TICKS_PER_STEP);
    expect(steps.some((step) => step % 2 === 1)).toBe(true);
    for (const spec of stage.obstacles) expect(spec.kind).toBe('cube');
  });

  it.each(SEEDS)('разгон: удары учащаются к концу такта, последние — столбы у будущих ворот (зерно %i)', (seed) => {
    const level = 7;
    const stage = stageAt(level, seed);
    const gateX = 44;
    expect(roll(stage, 6, gateX)).toBeGreaterThanOrEqual(5);
    const steps = stage.obstacles.map((spec) => (spec.arriveTick - stage.barStart) / TICKS_PER_STEP);
    const gaps = steps.slice(1).map((step, i) => step - steps[i]);
    expect(gaps[gaps.length - 1]).toBeLessThanOrEqual(gaps[0]);
    expect(Math.max(...steps)).toBeGreaterThanOrEqual(12);
    // Проход между столбами не уже ворот следующего уровня.
    const pillars = stage.obstacles.filter((spec) => (spec.arriveTick - stage.barStart) / TICKS_PER_STEP >= 12);
    for (const pillar of pillars) expect(Math.abs(pillar.x - gateX) - reachOf(pillar)).toBeGreaterThanOrEqual(laserHalfGapForLevel(level + 1));
  });

  it.each(SEEDS)('воронка: пары на долях сходятся к точке ворот (зерно %i)', (seed) => {
    const stage = stageAt(6, seed);
    const gateX = 56;
    const placed = funnel(stage, gateX, 4);
    expect(placed).toBeGreaterThanOrEqual(6);
    const byTick = new Map<number, ObstacleSpec[]>();
    for (const spec of stage.obstacles) byTick.set(spec.arriveTick, [...(byTick.get(spec.arriveTick) ?? []), spec]);
    const gaps = [...byTick.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, walls]) => walls.length === 2)
      .map(([, walls]) => Math.abs(walls[0].x - walls[1].x) - reachOf(walls[0]) - reachOf(walls[1]));
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
    expect(gaps[gaps.length - 1]).toBeGreaterThanOrEqual(2 * laserHalfGapForLevel(7));
    expect(stage.lures[stage.lures.length - 1].x).toBeCloseTo(gateX, 6);
  });

  it('ворота дропа: на сильной доле, в обещанной точке, без зигзага', () => {
    for (const seed of SEEDS) {
      const gate = stageAt(5, seed);
      expect(dropGate(gate, 40, false)).toBe(1);
      expect(gate.obstacles[0]).toMatchObject({ kind: 'laser', arriveTick: gate.barStart, x: 40, sway: null });
      const portal = stageAt(5, seed);
      expect(dropGate(portal, 40, true)).toBe(2);
      for (const saw of portal.obstacles) expect(saw).toMatchObject({ kind: 'saw', arriveTick: portal.barStart, sway: null, halfW: OBSTACLES.saw.sizeMax });
      expect((portal.obstacles[0].x + portal.obstacles[1].x) / 2).toBeCloseTo(40, 6);
    }
  });

  it('в такт не помещается больше 12 препятствий', () => {
    const stage = stageAt(12, 5);
    let placed = 0;
    for (let step = 0; step < 16; step++) placed += single(stage, step, { aim: 'far', sway: 'never' });
    expect(placed).toBeLessThanOrEqual(MAX_OBSTACLES_PER_BAR);
    expect(stage.obstacles).toHaveLength(placed);
    expect(stage.put([cubeSpec(stage.tickOf(15), 20), cubeSpec(stage.tickOf(15), 80)])).toBe(placed + 2 <= MAX_OBSTACLES_PER_BAR);
  });

  it('фоновая сцена: объекты считаются с подлётом 1-го уровня, каким бы поздним ни был такт', () => {
    const bar = barOfLevel(18);
    const { corridor, contour } = emptyRoad(bar);
    const stage = new Stage(createRng(1), corridor, contour, barStartTick(bar), 3, GAME.approach.base);
    expect(stage.approachOf(stage.tickOf(8))).toBe(GAME.approach.base);
    // Та же стена, что на предельной скорости ловила бы игрока, при медленном подлёте честна.
    expect(stage.put([sawSpec(stage.tickOf(8), 8), sawSpec(stage.tickOf(8), 22), sawSpec(stage.tickOf(8), 36), sawSpec(stage.tickOf(8), 50)])).toBe(true);
  });
});

// ─── Зигзаг ─────────────────────────────────────────────────────────────────

describe('зигзаг', () => {
  it('подогнанный зигзаг держит объект на дороге весь полёт и не превышает размах уровня', () => {
    const rng = createRng(77);
    let fitted = 0;
    for (let n = 0; n < 600; n++) {
      const level = rng.int(2, 20);
      const arriveTick = (level - 1) * TICKS_PER_LEVEL + rng.int(0, 127) * TICKS_PER_STEP;
      const halfW = rng.range(4.5, 8);
      const spec = { arriveTick, x: rng.range(halfW, ROAD - halfW), halfW };
      const wanted: Sway = { amp: swayAmp(level) * rng.range(0.55, 1), periodTicks: rng.int(GAME.sway.periodMin, 340), phase: rng.range(0, 6.28) };
      const sway = fitSway(spec, wanted);
      if (!sway) continue;
      fitted += 1;
      expect(sway.amp).toBeLessThanOrEqual(wanted.amp);
      expect(sway.amp).toBeGreaterThanOrEqual(3);
      expect(sway).toMatchObject({ periodTicks: wanted.periodTicks, phase: wanted.phase });
      const approach = approachFor(arriveTick);
      for (let t = arriveTick - approach; t <= arriveTick + Math.ceil((WORLD.zBehind / WORLD.zFar) * approach); t++) {
        const x = spec.x + swayOffset(sway, arriveTick, t);
        expect(x - halfW).toBeGreaterThanOrEqual(-1e-9);
        expect(x + halfW).toBeLessThanOrEqual(ROAD + 1e-9);
      }
      // В момент прилёта объект ровно в своей точке.
      expect(swayOffset(sway, arriveTick, arriveTick)).toBe(0);
    }
    expect(fitted).toBeGreaterThan(300);
  });

  it('у самого бортика зигзагу нет места', () => {
    const spec = { arriveTick: 5 * TICKS_PER_LEVEL, x: 6, halfW: 6 };
    expect(fitSway(spec, { amp: 20, periodTicks: 200, phase: 0 })).toBeNull();
    expect(fitSway({ ...spec, x: ROAD - 6 }, { amp: 20, periodTicks: 200, phase: 1 })).toBeNull();
    expect(fitSway({ ...spec, x: CENTER }, { amp: 20, periodTicks: 200, phase: 0 })).toEqual({ amp: 20, periodTicks: 200, phase: 0 });
  });

  it('со 2-го уровня паттерны действительно качаются: одиночные, пары, ворота, лесенки и столбы слалома', () => {
    const swayed = { single: 0, pair: 0, gate: 0, stairs: 0, slalom: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      const level = 9;
      const one = stageAt(level, seed);
      single(one, 8);
      if (one.obstacles[0]?.sway) swayed.single += 1;
      const two = stageAt(level, seed);
      pair(two, 8);
      if (two.obstacles.length === 2 && two.obstacles[0].sway) {
        // Пара качается как целое — проход не меняется.
        expect(two.obstacles[1].sway).toBe(two.obstacles[0].sway);
        swayed.pair += 1;
      }
      const gate = stageAt(level, seed);
      laserGate(gate, 8);
      if (gate.obstacles[0]?.sway) swayed.gate += 1;
      const steps = stageAt(level, seed);
      stairs(steps, 0, 4);
      if (steps.obstacles.some((spec) => spec.sway)) swayed.stairs += 1;
      const posts = stageAt(level, seed);
      slalom(posts, [0, 4, 8, 12]);
      if (posts.obstacles.some((spec) => spec.sway)) swayed.slalom += 1;
    }
    for (const count of Object.values(swayed)) expect(count).toBeGreaterThan(4);
  });
});
