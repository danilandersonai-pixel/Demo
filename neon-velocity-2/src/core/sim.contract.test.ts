/**
 * Приёмочные тесты симуляции. Это контракт: правила игры записаны здесь в
 * проверяемом виде. Файл не меняется при реализации — если тест кажется
 * неверным, об этом нужно сообщить, а не править его.
 */
import { describe, expect, it } from 'vitest';
import { planMove } from './bot';
import { depthReach } from './collision';
import { BASE_SIM_LOADOUT, GAME, speedMultForLevel, WORLD } from './config';
import { pickupReach } from './motion';
import { Simulation } from './sim';
import { EMPTY_CHART, eventsOf, findBadNumber, holdAt, IDLE, runUntil, scriptedChart } from './testkit';
import { LEAD_IN_TICKS, TICK_RATE, TICKS_PER_BEAT, TICKS_PER_LEVEL } from './timing';
import type { ChartItem, CrystalSpec, ObstacleSpec, SimLoadout } from './types';

const BASE = BASE_SIM_LOADOUT;
const CENTER = WORLD.roadW / 2;
const APPROACH_L1 = GAME.approach.base;

function crystal(arriveTick: number, x = CENTER, rare = false): CrystalSpec {
  return { kind: 'crystal', arriveTick, x, sway: null, rare };
}

function cube(arriveTick: number, x = CENTER, halfW = 5): ObstacleSpec {
  return { kind: 'cube', arriveTick, x, sway: null, halfW, yaw0: 0, yawRate: 0 };
}

function run(items: ChartItem[], loadout: SimLoadout = BASE, seed = 1): Simulation {
  const sim = new Simulation();
  sim.startRun(seed, loadout, scriptedChart(items));
  return sim;
}

/** Сколько тиков до и после arriveTick объект с такой половиной глубины может взаимодействовать с кораблём. */
function windowTicks(reach: number, approachTicks = APPROACH_L1): number {
  return Math.ceil((reach * approachTicks) / WORLD.zFar) + 1;
}

/** Очки за прожитые доли к тику tick на 1-м уровне с множителем x1. */
function survival(tick: number): number {
  return Math.floor(tick / TICKS_PER_BEAT) * GAME.score.perBeat;
}

describe('вступление и ритм', () => {
  it('забег начинается с такта READY, GO приходится на тик 0', () => {
    const sim = new Simulation();
    sim.startRun(7, BASE, EMPTY_CHART);
    expect(sim.state.tick).toBe(-LEAD_IN_TICKS);
    expect(sim.state.mode).toBe('ready');
    expect(sim.state.seed).toBe(7);
    expect(sim.state.player.x).toBe(CENTER);
    expect(sim.state.player.alive).toBe(true);

    const before = runUntil(sim, -1);
    expect(sim.state.mode).toBe('ready');
    expect(eventsOf(before, 'ready').map((e) => e.tick)).toEqual([-LEAD_IN_TICKS]);
    expect(eventsOf(before, 'go')).toHaveLength(0);

    const after = runUntil(sim, 240);
    expect(eventsOf(after, 'go').map((e) => e.tick)).toEqual([0]);
    expect(sim.state.mode).toBe('playing');

    const beats = eventsOf([...before, ...after], 'beat');
    expect(beats.map((b) => b.tick)).toEqual([-240, -180, -120, -60, 0, 60, 120, 180, 240]);
    expect(beats.map((b) => b.beat)).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4]);
    expect(beats.map((b) => b.beatInBar)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0]);
    expect(beats.map((b) => b.bar)).toEqual([-1, -1, -1, -1, 0, 0, 0, 0, 1]);
    expect(beats.every((b) => b.level === 1)).toBe(true);
  });

  it('уровень скорости растёт ровно каждые 1920 тиков (15 секунд)', () => {
    const sim = new Simulation();
    sim.startRun(1, BASE, EMPTY_CHART);
    const events = runUntil(sim, TICKS_PER_LEVEL * 3 + 10);
    const ups = eventsOf(events, 'levelUp');
    expect(ups.map((e) => e.tick)).toEqual([1920, 3840, 5760]);
    expect(ups.map((e) => e.level)).toEqual([2, 3, 4]);
    for (const e of ups) expect(e.speedMult).toBeCloseTo(speedMultForLevel(e.level), 9);
    expect(sim.state.level).toBe(4);
    expect(sim.state.speedMult).toBeCloseTo(speedMultForLevel(4), 9);
    expect(sim.state.levelProgress).toBeCloseTo(10 / TICKS_PER_LEVEL, 9);
    expect(sim.state.mode).toBe('playing');
  });

  it('за каждую прожитую долю начисляются очки: perBeat × уровень × множитель', () => {
    const sim = new Simulation();
    sim.startRun(1, BASE, EMPTY_CHART);
    runUntil(sim, 240);
    expect(sim.state.score).toBe(4 * GAME.score.perBeat);
    runUntil(sim, TICKS_PER_LEVEL + 60);
    // Доли 60…1860 идут на 1-м уровне (31 шт.), доли 1920 и 1980 — уже на 2-м.
    expect(sim.state.score).toBe(31 * GAME.score.perBeat + 2 * 2 * GAME.score.perBeat);
  });
});

describe('управление', () => {
  it('клавиатура разгоняет корабль до предела и упирается в край дороги', () => {
    const sim = new Simulation();
    sim.startRun(1, BASE, EMPTY_CHART);
    const right = { axis: 1, pointerX: null, source: 'keyboard' as const };
    runUntil(sim, -LEAD_IN_TICKS + 16, right);
    expect(sim.state.player.vx).toBeGreaterThan(0);
    expect(sim.state.player.vx).toBeLessThanOrEqual(GAME.player.maxSpeed + 1e-9);
    expect(sim.state.player.x).toBeGreaterThan(CENTER);
    const prev = sim.state.player.x;
    sim.step(right);
    expect(sim.state.player.prevX).toBe(prev);
    runUntil(sim, 0, right);
    expect(sim.state.player.x).toBeCloseTo(WORLD.roadW - GAME.player.edge, 9);
    expect(sim.state.player.bank).toBeGreaterThanOrEqual(-1);
    expect(sim.state.player.bank).toBeLessThanOrEqual(1);
  });

  it('указатель: скорость = (цель − x) · pointerFollow, не больше pointerMaxSpeed', () => {
    const sim = new Simulation();
    sim.startRun(1, BASE, EMPTY_CHART);
    sim.step(holdAt(80));
    // (80 − 50) · 16 = 480 > 280 → предел.
    expect(sim.state.player.vx).toBeCloseTo(GAME.player.pointerMaxSpeed, 9);
    expect(sim.state.player.x).toBeCloseTo(CENTER + GAME.player.pointerMaxSpeed / TICK_RATE, 9);
    runUntil(sim, 0, holdAt(80));
    expect(sim.state.player.x).toBeCloseTo(80, 3);
    runUntil(sim, 240, holdAt(-500));
    expect(sim.state.player.x).toBeCloseTo(GAME.player.edge, 9);
  });

  it('без ввода корабль стоит на месте', () => {
    const sim = new Simulation();
    sim.startRun(1, BASE, EMPTY_CHART);
    runUntil(sim, 240, IDLE);
    expect(sim.state.player.x).toBe(CENTER);
    expect(sim.state.player.vx).toBe(0);
  });
});

describe('сферы и комбо', () => {
  it('сфера на пути корабля собирается в момент прилёта и даёт очки и валюту', () => {
    const sim = run([crystal(480)]);
    const events = runUntil(sim, 600);
    const collects = eventsOf(events, 'collect');
    expect(collects).toHaveLength(1);
    const w = windowTicks(pickupReach(false));
    expect(Math.abs(collects[0].tick - 480)).toBeLessThanOrEqual(w);
    expect(collects[0]).toMatchObject({ rare: false, chain: 1, multiplier: 1, note: 0, points: GAME.score.crystal });
    expect(collects[0].x).toBeCloseTo(CENTER, 6);
    expect(sim.state.crystalsCollected).toBe(1);
    expect(sim.state.runCrystals).toBeCloseTo(GAME.crystal.currency, 9);
    expect(sim.state.chain).toBe(1);
    expect(sim.state.score).toBe(GAME.score.crystal + survival(600));
    expect(eventsOf(events, 'miss')).toHaveLength(0);
  });

  it('каждые combo.step сфер подряд поднимают множитель, очки умножаются на него', () => {
    const items = Array.from({ length: 9 }, (_, k) => crystal(480 + 30 * k));
    const sim = run(items);
    const events = runUntil(sim, 480 + 30 * 9 + 60);
    const collects = eventsOf(events, 'collect');
    expect(collects.map((c) => c.chain)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(collects.map((c) => c.multiplier)).toEqual([1, 1, 1, 2, 2, 2, 2, 3, 3]);
    expect(collects.map((c) => c.points)).toEqual([100, 100, 100, 200, 200, 200, 200, 300, 300]);
    expect(collects.map((c) => c.note)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(eventsOf(events, 'comboUp').map((e) => e.multiplier)).toEqual([2, 3]);
    expect(sim.state.multiplier).toBe(3);
    expect(sim.state.maxMultiplier).toBe(3);
    expect(sim.state.maxChain).toBe(9);
  });

  it('пропущенная сфера сбрасывает комбо', () => {
    const sim = run([crystal(480), crystal(540, 20)]);
    const events = runUntil(sim, 700);
    expect(eventsOf(events, 'collect')).toHaveLength(1);
    const misses = eventsOf(events, 'miss');
    expect(misses).toHaveLength(1);
    expect(misses[0].tick).toBeGreaterThan(540);
    expect(misses[0].x).toBeCloseTo(20, 6);
    expect(eventsOf(events, 'comboBreak')).toEqual([{ type: 'comboBreak', tick: misses[0].tick, reason: 'miss', lost: 1 }]);
    expect(sim.state.chain).toBe(0);
    expect(sim.state.multiplier).toBe(1);
  });

  it('пропуск без набранной цепочки не считается срывом комбо', () => {
    const sim = run([crystal(480, 20)]);
    const events = runUntil(sim, 700);
    expect(eventsOf(events, 'miss')).toHaveLength(1);
    expect(eventsOf(events, 'comboBreak')).toHaveLength(0);
  });

  it('на максимальном множителе включается OVERDRIVE и удваивает очки', () => {
    const need = GAME.combo.step * (GAME.combo.maxMultiplier - 1); // 28
    const items: ChartItem[] = Array.from({ length: need + 1 }, (_, k) => crystal(480 + 30 * k));
    items.push(crystal(480 + 30 * (need + 2), 20)); // эту пропустим
    const sim = run(items);
    const events = runUntil(sim, 480 + 30 * (need + 6));
    const collects = eventsOf(events, 'collect');
    expect(collects).toHaveLength(need + 1);
    expect(collects[need - 1].multiplier).toBe(GAME.combo.maxMultiplier);
    const od = eventsOf(events, 'overdrive');
    expect(od.map((e) => e.on)).toEqual([true, false]);
    expect(od[0].tick).toBe(collects[need - 1].tick);
    // Сфера, взятая уже в OVERDRIVE: 100 × 8 × 2.
    expect(collects[need].points).toBe(GAME.score.crystal * GAME.combo.maxMultiplier * GAME.combo.overdriveBonus);
    const breaks = eventsOf(events, 'comboBreak');
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({ reason: 'miss', lost: GAME.combo.maxMultiplier });
    expect(od[1].tick).toBe(breaks[0].tick);
    expect(sim.state.overdrive).toBe(false);
    expect(sim.state.multiplier).toBe(1);
  });

  it('редкая сфера: больше очков и валюты; резонатор и бонус корабля учитываются', () => {
    const loadout: SimLoadout = { ...BASE, scoreBonus: 0.1, crystalYield: 1.4 };
    const sim = run([crystal(480), crystal(540, CENTER, true)], loadout);
    const events = runUntil(sim, 600);
    const collects = eventsOf(events, 'collect');
    expect(collects.map((c) => c.rare)).toEqual([false, true]);
    expect(collects.map((c) => c.points)).toEqual([110, 550]);
    expect(sim.state.runCrystals).toBeCloseTo((GAME.crystal.currency + GAME.crystal.rareCurrency) * 1.4, 9);
  });

  it('магнит притягивает сферу, до которой корабль сам не дотянулся бы', () => {
    const far = CENTER + 10;
    expect(10).toBeGreaterThan(pickupReach(false));
    const without = run([crystal(480, far)]);
    expect(eventsOf(runUntil(without, 700), 'collect')).toHaveLength(0);

    const withMagnet = run([crystal(480, far)], { ...BASE, magnetRadius: GAME.magnet.radius });
    const events = runUntil(withMagnet, 700);
    expect(eventsOf(events, 'collect')).toHaveLength(1);
    expect(eventsOf(events, 'miss')).toHaveLength(0);
  });

  it('магнит не достаёт сферы дальше своего радиуса', () => {
    const sim = run([crystal(480, CENTER + GAME.magnet.radius + 12)], { ...BASE, magnetRadius: GAME.magnet.radius });
    expect(eventsOf(runUntil(sim, 700), 'collect')).toHaveLength(0);
  });
});

describe('препятствия', () => {
  it('столкновение без щита: взрыв в замедлении, затем gameOver с итогом', () => {
    const sim = run([cube(480)]);
    const events = runUntil(sim, 470);
    expect(eventsOf(events, 'death')).toHaveLength(0);
    const more = runUntil(sim, 480);
    const deaths = eventsOf(more, 'death');
    expect(deaths).toHaveLength(1);
    const deathTick = deaths[0].tick;
    expect(deathTick).toBeGreaterThanOrEqual(480 - windowTicks(depthReach({ kind: 'cube', halfW: 5, halfD: 5 })));
    expect(deaths[0]).toMatchObject({ kind: 'cube' });
    expect(deaths[0].x).toBeCloseTo(CENTER, 6);
    expect(sim.state.mode).toBe('dying');
    expect(sim.state.timeScale).toBe(GAME.death.timeScale);
    expect(sim.state.player.alive).toBe(false);
    expect(sim.result()).toBeNull();

    const tail = runUntil(sim, deathTick + GAME.death.ticks + 200);
    const overs = eventsOf(tail, 'gameOver');
    expect(overs).toHaveLength(1);
    expect(overs[0].tick).toBe(deathTick + GAME.death.ticks);
    expect(sim.state.mode).toBe('over');
    expect(sim.state.timeScale).toBe(1);
    const result = overs[0].result;
    expect(sim.result()).toEqual(result);
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBe(survival(deathTick));
    expect(result).toMatchObject({ level: 1, crystals: 0, crystalsCollected: 0, newRecord: false, seed: 1, maxMultiplier: 1 });
    expect(result.duration).toBeCloseTo(deathTick / TICK_RATE, 6);
    // После конца забега очки не идут и забег нельзя «бросить» повторно.
    expect(sim.state.score).toBe(result.score);
    expect(sim.abandon()).toBeNull();
  });

  it('щит-призрак прощает ровно одно столкновение, затем даёт неуязвимость', () => {
    const sim = run([crystal(420), cube(480), cube(540), cube(780)], { ...BASE, shieldCharges: 1 });
    expect(sim.state.player.shield).toBe(1);
    expect(sim.state.player.shieldMax).toBe(1);
    const first = runUntil(sim, 500);
    const breaks = eventsOf(first, 'shieldBreak');
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({ kind: 'cube', left: 0 });
    expect(eventsOf(first, 'comboBreak')).toEqual([{ type: 'comboBreak', tick: breaks[0].tick, reason: 'hit', lost: 1 }]);
    expect(eventsOf(first, 'death')).toHaveLength(0);
    expect(sim.state.player.alive).toBe(true);
    expect(sim.state.player.shield).toBe(0);
    expect(sim.state.player.invulnTicks).toBeGreaterThan(0);
    expect(sim.state.player.invulnTicks).toBeLessThanOrEqual(GAME.shield.invulnTicks);
    expect(sim.state.chain).toBe(0);

    // Второй куб прилетает во время неуязвимости — корабль цел.
    const second = runUntil(sim, 700);
    expect(eventsOf(second, 'death')).toHaveLength(0);
    expect(eventsOf(second, 'shieldBreak')).toHaveLength(0);
    expect(sim.state.player.invulnTicks).toBe(0);

    // Третий — уже без щита и без неуязвимости.
    const third = runUntil(sim, 790);
    expect(eventsOf(third, 'death')).toHaveLength(1);
    expect(sim.state.mode).toBe('dying');
  });

  it('уклонение даёт очки; пролёт впритирку — near miss', () => {
    const half = 5 * GAME.hitbox.cube;
    const nearX = CENTER + half + GAME.player.radius + 1; // зазор 1 < nearMissClear
    const near = run([cube(480)]);
    const nearEvents = runUntil(near, 600, holdAt(nearX));
    const dodge = eventsOf(nearEvents, 'dodge');
    expect(dodge).toHaveLength(1);
    expect(dodge[0]).toMatchObject({ kind: 'cube', near: true, points: GAME.score.dodge + GAME.score.nearMiss });
    expect(dodge[0].tick).toBeGreaterThan(480);
    expect(near.state.nearMisses).toBe(1);
    expect(near.state.dodged).toBe(1);
    expect(near.state.mode).toBe('playing');

    const far = run([cube(480)]);
    const farEvents = runUntil(far, 600, holdAt(80));
    expect(eventsOf(farEvents, 'dodge')).toEqual([expect.objectContaining({ near: false, points: GAME.score.dodge })]);
    expect(far.state.nearMisses).toBe(0);
    expect(far.state.score).toBe(GAME.score.dodge + survival(600));
  });

  it('лазерные ворота: проход безопасен, луч — нет', () => {
    const laser: ObstacleSpec = { kind: 'laser', arriveTick: 480, x: 30, sway: null, halfW: 12 };
    const through = run([laser]);
    const ok = runUntil(through, 600, holdAt(30));
    expect(eventsOf(ok, 'death')).toHaveLength(0);
    expect(eventsOf(ok, 'dodge')).toEqual([expect.objectContaining({ kind: 'laser', near: false })]);

    const blocked = run([laser]);
    const bad = runUntil(blocked, 600, holdAt(60));
    expect(eventsOf(bad, 'death')).toEqual([expect.objectContaining({ kind: 'laser' })]);
  });

  it('пила: широкая по x, тонкая по глубине', () => {
    const saw: ObstacleSpec = { kind: 'saw', arriveTick: 480, x: CENTER, sway: null, halfW: 6 };
    const half = 6 * GAME.hitbox.saw;
    const safe = run([saw]);
    const ok = runUntil(safe, 600, holdAt(CENTER + half + GAME.player.radius + 3));
    expect(eventsOf(ok, 'death')).toHaveLength(0);
    expect(eventsOf(ok, 'dodge')).toEqual([expect.objectContaining({ kind: 'saw', near: false })]);

    const hit = run([saw]);
    const bad = runUntil(hit, 600, holdAt(CENTER + 5));
    const deaths = eventsOf(bad, 'death');
    expect(deaths).toEqual([expect.objectContaining({ kind: 'saw' })]);
    // Тонкий хитбокс: столкновение не раньше, чем пила почти дошла до линии корабля.
    expect(deaths[0].tick).toBeGreaterThanOrEqual(480 - windowTicks(depthReach({ kind: 'saw', halfW: 6, halfD: 1.2 })));
  });

  it('зигзаг: объект приходит в свою точку прилёта, а не туда, где был по дороге', () => {
    // В момент прилёта куб стоит в центре, но по пути уходит далеко вбок.
    const swaying: ObstacleSpec = { ...cube(480), sway: { amp: 20, periodTicks: 240, phase: 0 } };
    const sim = run([swaying]);
    const events = runUntil(sim, 480);
    expect(eventsOf(events, 'death')).toHaveLength(1);

    const dodged = run([swaying]);
    expect(eventsOf(runUntil(dodged, 600, holdAt(80)), 'death')).toHaveLength(0);
  });
});

describe('рекорд и итог', () => {
  it('NEW RECORD срабатывает один раз — когда счёт обгоняет прошлый рекорд', () => {
    const sim = run([crystal(480), crystal(510)], { ...BASE, highscore: 150 });
    expect(sim.state.highscore).toBe(150);
    const events = runUntil(sim, 1200);
    const records = eventsOf(events, 'newRecord');
    expect(records).toHaveLength(1);
    expect(records[0].score).toBeGreaterThan(150);
    expect(sim.state.newRecord).toBe(true);
    expect(sim.hud().newRecord).toBe(true);
    expect(sim.hud().highscore).toBe(sim.state.score);
  });

  it('без прошлого рекорда вспышки нет', () => {
    const sim = run([crystal(480), crystal(510)]);
    const events = runUntil(sim, 1200);
    expect(eventsOf(events, 'newRecord')).toHaveLength(0);
    expect(sim.state.newRecord).toBe(false);
  });

  it('равный счёт — ещё не рекорд', () => {
    // К тику 480 набегает 40 очков за доли, сфера даёт ещё 100 → ровно 140.
    const sim = run([crystal(480)], { ...BASE, highscore: 140 });
    const events = runUntil(sim, 500);
    expect(sim.state.score).toBe(140);
    expect(eventsOf(events, 'newRecord')).toHaveLength(0);
    const later = runUntil(sim, 540);
    expect(eventsOf(later, 'newRecord')).toHaveLength(1);
  });

  it('брошенный забег отдаёт итог один раз; пустой — не отдаёт', () => {
    const empty = new Simulation();
    empty.startRun(1, BASE, EMPTY_CHART);
    expect(empty.abandon()).toBeNull();
    runUntil(empty, 30);
    expect(empty.abandon()).toBeNull();

    const sim = run([crystal(480)]);
    runUntil(sim, 600);
    const result = sim.abandon();
    expect(result).not.toBeNull();
    expect(result).toMatchObject({ score: sim.state.score, crystals: 1, crystalsCollected: 1, level: 1, seed: 1, newRecord: false });
    expect(result!.duration).toBeCloseTo(600 / TICK_RATE, 6);
    expect(sim.state.mode).toBe('over');
    expect(sim.abandon()).toBeNull();
    expect(eventsOf(runUntil(sim, 900), 'gameOver')).toHaveLength(0);
  });

  it('HUD отражает состояние забега', () => {
    const sim = run([crystal(480), crystal(510)], { ...BASE, shieldCharges: 1, highscore: 1000 });
    runUntil(sim, 600);
    const hud = sim.hud();
    expect(hud).toMatchObject({
      score: sim.state.score,
      highscore: 1000,
      multiplier: 1,
      chain: 2,
      overdrive: false,
      level: 1,
      crystals: 2,
      shield: 1,
      shieldMax: 1,
      newRecord: false,
    });
    expect(hud.chainProgress).toBeCloseTo(2 / GAME.combo.step, 9);
    expect(hud.elapsed).toBeCloseTo(600 / TICK_RATE, 6);
    expect(hud.levelProgress).toBeCloseTo(600 / TICKS_PER_LEVEL, 9);
    expect(hud.speedMult).toBe(1);
  });
});

describe('фоновая сцена меню', () => {
  it('attract: корабль на автопилоте, без очков, столкновений и событий, кроме beat', () => {
    const sim = new Simulation();
    sim.startAttract(3);
    expect(sim.state.mode).toBe('attract');
    expect(sim.state.tick).toBe(0);
    let seenObjects = 0;
    let moved = false;
    const types = new Set<string>();
    for (let i = 0; i < 6000; i++) {
      sim.step(IDLE);
      for (const e of sim.drainEvents()) types.add(e.type);
      seenObjects = Math.max(seenObjects, sim.state.obstacles.length + sim.state.crystals.length);
      if (Math.abs(sim.state.player.x - CENTER) > 3) moved = true;
    }
    expect([...types]).toEqual(['beat']);
    expect(sim.state.mode).toBe('attract');
    expect(sim.state.score).toBe(0);
    expect(sim.state.player.alive).toBe(true);
    expect(seenObjects).toBeGreaterThan(0);
    expect(moved).toBe(true);
    expect(findBadNumber(sim.state)).toBeNull();
  });
});

describe('детерминизм и целый забег', () => {
  function play(seed: number, untilTick: number) {
    const sim = new Simulation();
    sim.startRun(seed, BASE);
    const events = runUntil(sim, untilTick, (state) => planMove(state, { margin: 0.8 }));
    return { sim, events };
  }

  it('одно зерно и один и тот же ввод дают один и тот же забег', () => {
    const a = play(42, 4000);
    const b = play(42, 4000);
    expect(JSON.stringify(a.sim.state)).toBe(JSON.stringify(b.sim.state));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    const c = play(43, 4000);
    expect(JSON.stringify(c.events)).not.toBe(JSON.stringify(a.events));
  });

  it.each([1, 2, 3, 4])('бот-планировщик проходит 5 уровней на зерне %i', (seed) => {
    const sim = new Simulation();
    sim.startRun(seed, BASE);
    const kinds = new Set<string>();
    let swayed = false;
    let maxObstacles = 0;
    let maxCrystals = 0;
    while (sim.state.tick < TICKS_PER_LEVEL * 5) {
      sim.step(planMove(sim.state, { margin: 0.8 }));
      for (const e of sim.drainEvents()) {
        if (e.type === 'death') throw new Error(`зерно ${seed}: бот погиб на тике ${e.tick} (${e.kind})`);
      }
      for (const o of sim.state.obstacles) {
        kinds.add(o.kind);
        if (o.sway) swayed = true;
      }
      maxObstacles = Math.max(maxObstacles, sim.state.obstacles.length);
      maxCrystals = Math.max(maxCrystals, sim.state.crystals.length);
    }
    expect(sim.state.mode).toBe('playing');
    expect(sim.state.level).toBe(6);
    expect([...kinds].sort()).toEqual(['cube', 'laser', 'saw']);
    expect(swayed).toBe(true);
    expect(maxObstacles).toBeLessThanOrEqual(GAME.limits.obstacles);
    expect(maxCrystals).toBeLessThanOrEqual(GAME.limits.crystals);
    expect(sim.state.maxMultiplier).toBeGreaterThanOrEqual(2);
    expect(sim.state.crystalsCollected).toBeGreaterThan(20);
    expect(findBadNumber(sim.state)).toBeNull();
    expect(Number.isInteger(sim.state.score)).toBe(true);
  });
});
