/**
 * Приёмочные тесты генератора трека: сетка ритма, рост сложности, честность.
 * Это контракт — файл не меняется при реализации.
 */
import { describe, expect, it } from 'vitest';
import { collectObstacles, verifyChart } from './bot';
import { createChart } from './chartgen';
import { contactAt, dangerWindow } from './collision';
import { GAME, laserHalfGapForLevel, OBSTACLES, swayAmp, WORLD } from './config';
import { isObstacleSpec, makeObstacle } from './entities';
import { swayOffset } from './motion';
import { floorDiv, isOnGrid, levelAtTick, TICK_RATE, TICKS_PER_BAR, TICKS_PER_BEAT } from './timing';
import type { ChartItem, ChartOptions, CrystalSpec, ObstacleSpec } from './types';

const SEEDS = [1, 2, 3, 4, 5, 6];
/** 15 уровней скорости. */
const BARS = 120;
const OPTIONS: ChartOptions = { rareChance: GAME.crystal.rareChance };

function bars(seed: number, count = BARS, options: ChartOptions = OPTIONS): ChartItem[][] {
  const chart = createChart(seed, options);
  return Array.from({ length: count }, (_, b) => chart.bar(b));
}

function obstaclesOf(items: ChartItem[]): ObstacleSpec[] {
  return items.filter(isObstacleSpec);
}

function crystalsOf(items: ChartItem[]): CrystalSpec[] {
  return items.filter((i): i is CrystalSpec => i.kind === 'crystal');
}

describe.each(SEEDS)('трек, зерно %i', (seed) => {
  const perBar = bars(seed);
  const all = perBar.flat();
  const obstacles = obstaclesOf(all);
  const crystals = crystalsOf(all);

  it('каждый объект лежит в своём такте и на сетке шестнадцатых', () => {
    perBar.forEach((items, b) => {
      for (const item of items) {
        expect(floorDiv(item.arriveTick, TICKS_PER_BAR)).toBe(b);
        expect(isOnGrid(item.arriveTick)).toBe(true);
      }
    });
  });

  it('старт щадящий: первые две доли пусты, первый такт — без препятствий', () => {
    for (const item of perBar[0]) expect(item.arriveTick).toBeGreaterThanOrEqual(2 * TICKS_PER_BEAT);
    for (let b = 0; b < GAME.firstObstacleBar; b++) expect(obstaclesOf(perBar[b])).toHaveLength(0);
    expect(crystalsOf(perBar[0]).length).toBeGreaterThan(0);
  });

  it('на 1-м уровне нет лазеров и зигзагов; со 2-го появляется и то, и другое', () => {
    for (const o of obstacles) {
      const level = levelAtTick(o.arriveTick);
      if (level < OBSTACLES.laser.minLevel) expect(o.kind).not.toBe('laser');
      if (level < GAME.sway.startLevel) expect(o.sway).toBeNull();
    }
    const firstThreeLevels = obstacles.filter((o) => levelAtTick(o.arriveTick) <= 3);
    expect(new Set(firstThreeLevels.map((o) => o.kind))).toEqual(new Set(['cube', 'saw', 'laser']));
    expect(obstacles.some((o) => o.sway !== null && levelAtTick(o.arriveTick) <= 3)).toBe(true);
  });

  it('размеры и параметры в пределах пресетов, объекты не вылезают за дорогу', () => {
    for (const o of obstacles) {
      const level = levelAtTick(o.arriveTick);
      const preset = OBSTACLES[o.kind];
      if (o.kind === 'laser') {
        expect(o.halfW).toBeGreaterThanOrEqual(laserHalfGapForLevel(level) - 1e-9);
        expect(o.halfW).toBeLessThanOrEqual(22);
      } else {
        expect(o.halfW).toBeGreaterThanOrEqual(preset.sizeMin - 1e-9);
        expect(o.halfW).toBeLessThanOrEqual(preset.sizeMax + 1e-9);
      }
      if (o.kind === 'cube') {
        expect(Math.abs(o.yawRate ?? 0)).toBeLessThanOrEqual(preset.spinMax / TICK_RATE + 1e-9);
      }
      if (o.sway) {
        expect(o.sway.amp).toBeGreaterThan(0);
        expect(o.sway.amp).toBeLessThanOrEqual(swayAmp(level) + 1e-9);
        expect(o.sway.periodTicks).toBeGreaterThanOrEqual(GAME.sway.periodMin);
      }
      // Весь путь от появления до ухода за корабль объект целиком на дороге (для laser — проход).
      const body = makeObstacle(o, 1);
      for (let t = body.spawnTick; t <= o.arriveTick + 30; t += 5) {
        const x = o.x + swayOffset(o.sway, o.arriveTick, t);
        expect(x - o.halfW).toBeGreaterThanOrEqual(-0.01);
        expect(x + o.halfW).toBeLessThanOrEqual(WORLD.roadW + 0.01);
      }
    }
    for (const c of crystals) {
      expect(c.x).toBeGreaterThanOrEqual(GAME.player.edge);
      expect(c.x).toBeLessThanOrEqual(WORLD.roadW - GAME.player.edge);
    }
  });

  it('плотность: трек не пустой, не перегружен и сложнее с каждым уровнем', () => {
    const perLevel = (level: number) => obstacles.filter((o) => levelAtTick(o.arriveTick) === level).length;
    for (let level = 1; level <= 15; level++) {
      expect(perLevel(level)).toBeGreaterThanOrEqual(8);
      expect(crystals.filter((c) => levelAtTick(c.arriveTick) === level).length).toBeGreaterThanOrEqual(12);
    }
    expect(perLevel(6)).toBeGreaterThan(perLevel(1));
    expect(perLevel(12)).toBeGreaterThan(perLevel(3));
    for (const items of perBar) {
      expect(obstaclesOf(items).length).toBeLessThanOrEqual(12);
      expect(crystalsOf(items).length).toBeLessThanOrEqual(16);
    }
  });

  it('трек проходим кораблём на 55 % предельной скорости с запасом', () => {
    const result = verifyChart(createChart(seed, OPTIONS), { bars: BARS });
    expect(result.failTick).toBeNull();
    expect(result.ok).toBe(true);
    // Самое узкое место всё равно шире корабля.
    expect(result.minReachable).toBeGreaterThanOrEqual(3);
  });

  it('каждую сферу можно взять, не разбившись', () => {
    const bodies = collectObstacles(createChart(seed, OPTIONS), BARS);
    const contact = { inRange: false, clear: Infinity };
    for (const c of crystals) {
      for (const o of bodies) {
        if (Math.abs(o.arriveTick - c.arriveTick) > 60) continue;
        const w = dangerWindow(o);
        const from = Math.max(w.from, c.arriveTick - 4);
        const to = Math.min(w.to, c.arriveTick + 4);
        for (let t = from; t <= to; t++) {
          contactAt(o, t, c.x, contact);
          if (contact.inRange && contact.clear < 0.5) {
            throw new Error(`сфера (тик ${c.arriveTick}, x ${c.x.toFixed(1)}) стоит в препятствии ${o.kind} (тик ${o.arriveTick})`);
          }
        }
      }
    }
  });
});

describe('генератор в целом', () => {
  it('детерминирован: одно зерно — один трек, разные зёрна — разные треки', () => {
    expect(JSON.stringify(bars(11, 40))).toBe(JSON.stringify(bars(11, 40)));
    expect(JSON.stringify(bars(11, 40))).not.toBe(JSON.stringify(bars(12, 40)));
  });

  it('доля редких сфер следует rareChance', () => {
    const count = (rareChance: number) => {
      let rare = 0;
      let total = 0;
      for (const seed of SEEDS) {
        for (const c of crystalsOf(bars(seed, 80, { rareChance }).flat())) {
          total++;
          if (c.rare) rare++;
        }
      }
      return rare / total;
    };
    const base = count(GAME.crystal.rareChance);
    expect(base).toBeGreaterThan(0.02);
    expect(base).toBeLessThan(0.14);
    expect(count(0.5)).toBeGreaterThan(0.3);
    expect(count(0)).toBe(0);
  });

  it('фоновый трек меню — редкий и без роста сложности', () => {
    const perBar = bars(5, 60, { rareChance: GAME.crystal.rareChance, attract: true });
    const all = perBar.flat();
    expect(obstaclesOf(all).length).toBeGreaterThan(10);
    expect(crystalsOf(all).length).toBeGreaterThan(10);
    for (const items of perBar) expect(obstaclesOf(items).length).toBeLessThanOrEqual(3);
    for (const item of all) expect(isOnGrid(item.arriveTick)).toBe(true);
  });
});
