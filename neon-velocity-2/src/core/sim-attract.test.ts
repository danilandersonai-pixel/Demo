/**
 * Тесты фоновой сцены меню. Генератор трека подменён: сцена получает простой
 * трек с полосой (или пустой), поэтому поведение автопилота проверяется
 * независимо от настоящего генератора.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contactAt } from './collision';
import { BASE_SIM_LOADOUT, GAME, WORLD } from './config';
import { Simulation } from './sim';
import { laneChart, ROAD_CENTER } from './sim-fixtures';
import { SHIP_MAX_X, SHIP_MIN_X } from './sim-ship';
import { EMPTY_CHART, findBadNumber, IDLE } from './testkit';
import { TICK_RATE, TICKS_PER_BAR, TICKS_PER_BEAT, TICKS_PER_LEVEL } from './timing';
import type { ChartOptions, ChartSource, SimState } from './types';

const chartgen = vi.hoisted(() => ({
  calls: [] as { seed: number; options: ChartOptions }[],
  make: (_seed: number, _options: ChartOptions): ChartSource => ({ bar: () => [] }),
}));

vi.mock('./chartgen', () => ({
  createChart: (seed: number, options: ChartOptions): ChartSource => {
    chartgen.calls.push({ seed, options });
    return chartgen.make(seed, options);
  },
}));

/** Редкий трек в духе фоновой сцены: до трёх препятствий на такт, ворота, зигзаги, цепочки сфер. */
function sparse(seed: number): ChartSource {
  return laneChart(seed, { obstacles: () => 3, crystals: 6, fixedLevel: 3, laserChance: 0.3 });
}

/** То же, но без сфер и с резкими сменами полосы: автопилот находит дорогу только по препятствиям. */
function bare(seed: number): ChartSource {
  return laneChart(seed, { obstacles: () => 3, crystals: 0, fixedLevel: 3, laserChance: 0.3, laneStep: 40 });
}

interface Flight {
  /** Наименьший зазор между хитбоксами корабля и препятствий за полёт. */
  minClear: number;
  taken: number;
  missed: number;
  maxSpeed: number;
  maxAccel: number;
  minX: number;
  maxX: number;
  eventTypes: Set<string>;
  trace: number[];
}

function fly(sim: Simulation, ticks: number): Flight {
  const s: SimState = sim.state;
  const contact = { inRange: false, clear: Infinity };
  const taken = new Set<number>();
  const missed = new Set<number>();
  const flight: Flight = { minClear: Infinity, taken: 0, missed: 0, maxSpeed: 0, maxAccel: 0, minX: Infinity, maxX: -Infinity, eventTypes: new Set(), trace: [] };
  let prevVx = s.player.vx;
  for (let i = 0; i < ticks; i++) {
    sim.step(IDLE);
    for (const e of sim.drainEvents()) flight.eventTypes.add(e.type);
    const p = s.player;
    for (const o of s.obstacles) {
      contactAt(o, s.tick - 0.5, (p.prevX + p.x) / 2, contact);
      if (contact.inRange) flight.minClear = Math.min(flight.minClear, contact.clear);
      contactAt(o, s.tick, p.x, contact);
      if (contact.inRange) flight.minClear = Math.min(flight.minClear, contact.clear);
    }
    for (const c of s.crystals) {
      if (c.state === 'taken') taken.add(c.id);
      else if (c.state === 'missed') missed.add(c.id);
    }
    flight.maxSpeed = Math.max(flight.maxSpeed, Math.abs(p.vx));
    flight.maxAccel = Math.max(flight.maxAccel, Math.abs(p.vx - prevVx) * TICK_RATE);
    prevVx = p.vx;
    flight.minX = Math.min(flight.minX, p.x);
    flight.maxX = Math.max(flight.maxX, p.x);
    flight.trace.push(p.x);
  }
  flight.taken = taken.size;
  flight.missed = missed.size;
  return flight;
}

beforeEach(() => {
  chartgen.calls.length = 0;
  chartgen.make = () => EMPTY_CHART;
});

describe('какой трек запрашивает симуляция', () => {
  it('фоновая сцена — attract-трек с базовым шансом редкой сферы; забег — трек по снаряжению', () => {
    const sim = new Simulation();
    expect(chartgen.calls).toHaveLength(0);
    sim.startAttract(42);
    expect(chartgen.calls).toEqual([{ seed: 42, options: { rareChance: GAME.crystal.rareChance, attract: true } }]);
    sim.startRun(7, { ...BASE_SIM_LOADOUT, rareChance: 0.18 });
    expect(chartgen.calls[1]).toEqual({ seed: 7, options: { rareChance: 0.18 } });
    // Свой трек — генератор не трогаем.
    sim.startRun(8, BASE_SIM_LOADOUT, EMPTY_CHART);
    expect(chartgen.calls).toHaveLength(2);
  });
});

describe('автопилот фоновой сцены', () => {
  it.each([1, 2, 3, 4, 5, 6])('зерно %i: три минуты без единого касания, сферы собраны, движение плавное', (seed) => {
    chartgen.make = sparse;
    const sim = new Simulation();
    sim.startAttract(seed);
    const flight = fly(sim, 180 * TICK_RATE);

    // Не просто «не задел хитбокс», а прошёл с запасом на нарисованный размер корабля.
    expect(flight.minClear).toBeGreaterThan(2.5);
    expect(flight.taken + flight.missed).toBeGreaterThan(400);
    expect(flight.taken / (flight.taken + flight.missed)).toBeGreaterThan(0.95);
    // Неторопливо и без рывков: скорость заметно ниже игровой, ускорение ограничено.
    expect(flight.maxSpeed).toBeLessThan(100);
    expect(flight.maxAccel).toBeLessThanOrEqual(1200 + 1e-6);
    expect(flight.minX).toBeGreaterThanOrEqual(SHIP_MIN_X);
    expect(flight.maxX).toBeLessThanOrEqual(SHIP_MAX_X);
    expect(flight.maxX - flight.minX).toBeGreaterThan(20);

    expect([...flight.eventTypes]).toEqual(['beat']);
    expect(sim.state).toMatchObject({ mode: 'attract', level: 1, speedMult: 1, levelProgress: 0, score: 0, chain: 0, multiplier: 1, crystalsCollected: 0, runCrystals: 0, dodged: 0 });
    expect(sim.state.player.alive).toBe(true);
    expect(Math.abs(sim.state.player.bank)).toBeLessThanOrEqual(1);
    expect(sim.hud()).toMatchObject({ score: 0, crystals: 0, multiplier: 1 });
    expect(sim.result()).toBeNull();
    expect(findBadNumber(sim.state)).toBeNull();
  });

  it.each([1, 2, 3, 4])('зерно %i: без сфер обходит препятствия и ворота сам', (seed) => {
    chartgen.make = bare;
    const sim = new Simulation();
    sim.startAttract(seed);
    const flight = fly(sim, 180 * TICK_RATE);
    expect(flight.minClear).toBeGreaterThan(2.5);
    expect(flight.maxSpeed).toBeLessThan(100);
    expect(flight.maxAccel).toBeLessThanOrEqual(1200 + 1e-6);
  });

  it('пустая дорога: корабль покачивается вокруг центра с периодом в четыре такта', () => {
    const sim = new Simulation();
    sim.startAttract(1);
    const period = 4 * TICKS_PER_BAR;
    const flight = fly(sim, 3 * period);
    expect([...flight.eventTypes]).toEqual(['beat']);
    const lap = flight.trace.slice(period, 2 * period);
    const next = flight.trace.slice(2 * period, 3 * period);
    const max = Math.max(...lap);
    const min = Math.min(...lap);
    expect(max - ROAD_CENTER).toBeGreaterThan(10);
    expect(max - ROAD_CENTER).toBeLessThan(18);
    expect(max - ROAD_CENTER).toBeCloseTo(ROAD_CENTER - min, 0);
    // Установившееся движение повторяется из круга в круг.
    for (let i = 0; i < period; i += 37) expect(next[i]).toBeCloseTo(lap[i], 1);
    // Плавно: скорость и ускорение малы.
    expect(flight.maxSpeed).toBeLessThan(25);
    expect(flight.maxAccel).toBeLessThan(400);
  });

  it('симуляция до первого старта — та же пустая фоновая сцена', () => {
    const sim = new Simulation();
    expect(sim.state).toMatchObject({ mode: 'attract', tick: 0, level: 1, score: 0 });
    expect(sim.state.player.x).toBe(ROAD_CENTER);
    expect(sim.hud()).toMatchObject({ score: 0, highscore: 0, level: 1, elapsed: 0 });
    const flight = fly(sim, 600);
    expect([...flight.eventTypes]).toEqual(['beat']);
    expect(sim.state.tick).toBe(600);
    expect(flight.maxX - flight.minX).toBeGreaterThan(3);
    expect(chartgen.calls).toHaveLength(0);
  });

  it('одно зерно — одна и та же сцена, разные зёрна — разные', () => {
    chartgen.make = sparse;
    const flightOf = (seed: number): { trace: number[]; state: string } => {
      const sim = new Simulation();
      sim.startAttract(seed);
      const { trace } = fly(sim, 3000);
      return { trace, state: JSON.stringify(sim.state) };
    };
    const a = flightOf(5);
    const b = flightOf(5);
    expect(a.trace).toEqual(b.trace);
    expect(a.state).toBe(b.state);
    expect(flightOf(6).trace).not.toEqual(a.trace);
  });

  it('повторный startAttract начинает сцену заново, с центра', () => {
    chartgen.make = sparse;
    const sim = new Simulation();
    sim.startAttract(5);
    const first = fly(sim, 2000);
    sim.startAttract(5);
    expect(sim.state.tick).toBe(0);
    expect(sim.state.player).toMatchObject({ x: ROAD_CENTER, prevX: ROAD_CENTER, vx: 0, bank: 0 });
    expect(sim.drainEvents()).toEqual([{ type: 'beat', tick: 0, beat: 0, bar: 0, beatInBar: 0, level: 1 }]);
    expect(fly(sim, 2000).trace).toEqual(first.trace);
  });
});

describe('мир фоновой сцены', () => {
  it('сцена сразу населена, но первые три доли — без препятствий', () => {
    // Объекты на каждой шестнадцатой с самого начала трека.
    chartgen.make = () => ({
      bar: (b) =>
        Array.from({ length: 16 }, (_, k) => [
          { kind: 'cube' as const, arriveTick: b * TICKS_PER_BAR + k * 15, x: 30, sway: null, halfW: 5 },
          { kind: 'crystal' as const, arriveTick: b * TICKS_PER_BAR + k * 15, x: 70, sway: null, rare: false },
        ]).flat(),
    });
    const sim = new Simulation();
    sim.startAttract(1);
    // Ещё до первого шага на дороге всё, что уже «в пути».
    expect(sim.state.crystals.length).toBeGreaterThan(10);
    expect(sim.state.obstacles.length).toBeGreaterThan(5);
    expect(Math.min(...sim.state.obstacles.map((o) => o.arriveTick))).toBe(3 * TICKS_PER_BEAT);
    expect(Math.min(...sim.state.crystals.map((c) => c.arriveTick))).toBe(15);
    for (const e of [...sim.state.obstacles, ...sim.state.crystals]) {
      expect(e.spawnTick).toBeLessThanOrEqual(0);
      expect(e.arriveTick - e.spawnTick).toBe(e.approachTicks);
    }
  });

  it('меню открыто полчаса: скорость и уровень не растут, состояние не распухает', () => {
    chartgen.make = sparse;
    const sim = new Simulation();
    sim.startAttract(9);
    const s = sim.state;
    const until = 30 * 60 * TICK_RATE;
    let maxObstacles = 0;
    let maxCrystals = 0;
    let beats = 0;
    while (s.tick < until) {
      sim.step(IDLE);
      for (const e of sim.drainEvents()) {
        expect(e.type).toBe('beat');
        if (e.type === 'beat') {
          expect(e.level).toBe(1);
          expect(e.tick).toBe(beats * TICKS_PER_BEAT);
          beats++;
        }
      }
      maxObstacles = Math.max(maxObstacles, s.obstacles.length);
      maxCrystals = Math.max(maxCrystals, s.crystals.length);
      if (s.tick % 9973 === 0) {
        // Все объекты летят со скоростью 1-го уровня, сколько бы ни прошло времени.
        for (const o of s.obstacles) expect(o.approachTicks).toBe(GAME.approach.base);
        for (const c of s.crystals) expect(c.approachTicks).toBe(GAME.approach.base);
        expect(findBadNumber(s)).toBeNull();
      }
    }
    expect(s.tick).toBe(until);
    expect(s.tick).toBeGreaterThan(100 * TICKS_PER_LEVEL);
    expect(s).toMatchObject({ mode: 'attract', level: 1, speedMult: 1, levelProgress: 0, score: 0, timeScale: 1 });
    // Доля нулевого тика (её кладёт сам startAttract) и все последующие.
    expect(beats).toBe(until / TICKS_PER_BEAT + 1);
    expect(maxObstacles).toBeGreaterThan(2);
    expect(maxObstacles).toBeLessThan(20);
    expect(maxCrystals).toBeLessThan(40);
    for (const o of s.obstacles) expect(o.arriveTick).toBeGreaterThan(until - TICKS_PER_BAR);
    expect(s.player.x).toBeGreaterThanOrEqual(SHIP_MIN_X);
    expect(s.player.x).toBeLessThanOrEqual(WORLD.roadW - SHIP_MIN_X);
  });

  it('сферы на пути корабля исчезают молча, пропущенные летят дальше', () => {
    chartgen.make = () => ({
      bar: (b) => [
        { kind: 'crystal', arriveTick: b * TICKS_PER_BAR + 120, x: ROAD_CENTER, sway: null, rare: false },
        { kind: 'crystal', arriveTick: b * TICKS_PER_BAR + 120, x: 6, sway: null, rare: false },
        { kind: 'crystal', arriveTick: b * TICKS_PER_BAR + 120, x: 94, sway: null, rare: true },
      ],
    });
    const sim = new Simulation();
    sim.startAttract(1);
    const flight = fly(sim, 20 * TICKS_PER_BAR);
    expect([...flight.eventTypes]).toEqual(['beat']);
    // Три сферы в ряд через всю дорогу: за раз берётся одна, остальные честно пропущены.
    expect(flight.taken).toBeGreaterThanOrEqual(19);
    expect(flight.missed).toBeGreaterThanOrEqual(38);
    expect(sim.state.crystalsCollected).toBe(0);
    expect(sim.state.score).toBe(0);
    expect(sim.state.chain).toBe(0);
  });
});
