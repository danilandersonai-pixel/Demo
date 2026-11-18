/**
 * Тесты симуляции сверх приёмочных: крайние случаи правил, порядок событий,
 * повторное использование одного экземпляра, пределы и долгий забег.
 * Ожидаемые числа выводятся из config.ts, а не вписаны руками.
 */
import { describe, expect, it } from 'vitest';
import { planMove } from './bot';
import { contactAt, depthReach } from './collision';
import { approachTicksForLevel, BASE_SIM_LOADOUT, GAME, speedMultForLevel, WORLD } from './config';
import { approachFor, isObstacleSpec } from './entities';
import { crystalBaseX, crystalX, depthAt, pickupReach } from './motion';
import { createRng } from './rng';
import { Simulation } from './sim';
import { REQUEST_LEAD_TICKS } from './sim-feed';
import { crystalAt, cubeAt, followLane, keyboard, laneChart, laserAt, ROAD_CENTER, sawAt, spyChart } from './sim-fixtures';
import { SHIP_MAX_X, SHIP_MIN_X } from './sim-ship';
import { EMPTY_CHART, eventsOf, findBadNumber, holdAt, IDLE, runUntil, scriptedChart } from './testkit';
import { LEAD_IN_TICKS, TICK_RATE, TICKS_PER_BAR, TICKS_PER_BEAT, TICKS_PER_LEVEL } from './timing';
import type { ChartItem, ChartSource, InputFrame, SimEvent, SimLoadout, SimState } from './types';

const BASE = BASE_SIM_LOADOUT;
const CENTER = ROAD_CENTER;
const MAX = GAME.combo.maxMultiplier;
/** Сфер подряд до OVERDRIVE. */
const TO_OVERDRIVE = GAME.combo.step * (MAX - 1);

function run(items: ChartItem[], loadout: SimLoadout = BASE, seed = 1): Simulation {
  const sim = new Simulation();
  sim.startRun(seed, loadout, scriptedChart(items));
  return sim;
}

/** События одного тика по порядку. */
function at(events: SimEvent[], tick: number): SimEvent[] {
  return events.filter((e) => e.tick === tick);
}

function types(events: SimEvent[]): string[] {
  return events.map((e) => e.type);
}

/** Первый тик, на котором сфера с таким временем прилёта входит в зону подбора. */
function pickupTick(arriveTick: number, rare = false): number {
  return Math.ceil(arriveTick - (pickupReach(rare) * approachFor(arriveTick)) / WORLD.zFar);
}

/** Первый тик, на котором препятствие уже за кораблём (уклонение засчитано). */
function passTick(spec: ChartItem): number {
  if (!isObstacleSpec(spec)) throw new Error('нужно препятствие');
  const halfD = spec.kind === 'cube' ? spec.halfW : spec.kind === 'saw' ? 1.2 : 1;
  const ticks = (depthReach({ kind: spec.kind, halfW: spec.halfW, halfD }) * approachFor(spec.arriveTick)) / WORLD.zFar;
  return Math.floor(spec.arriveTick + ticks) + 1;
}

function score(base: number, multiplier = 1, overdrive = false, bonus = 0): number {
  return Math.round(base * multiplier * (overdrive ? GAME.combo.overdriveBonus : 1) * (1 + bonus));
}

/** Цепочка сфер по центру на восьмых, начиная с тика from. */
function chain(count: number, from = 300): ChartItem[] {
  return Array.from({ length: count }, (_, k) => crystalAt(from + 30 * k));
}

describe('очередь событий', () => {
  it('startRun кладёт ready и beat, drainEvents отдаёт массив в собственность', () => {
    const sim = new Simulation();
    sim.startRun(1, BASE, EMPTY_CHART);
    const first = sim.drainEvents();
    expect(first).toEqual([
      { type: 'ready', tick: -LEAD_IN_TICKS },
      { type: 'beat', tick: -LEAD_IN_TICKS, beat: -4, bar: -1, beatInBar: 0, level: 1 },
    ]);
    const empty = sim.drainEvents();
    expect(empty).toHaveLength(0);
    expect(Object.isFrozen(empty)).toBe(true);

    // Отданный массив не меняется, что бы ни происходило дальше.
    runUntil(sim, 300);
    sim.startRun(2, BASE, EMPTY_CHART);
    expect(first).toHaveLength(2);
    expect(types(first)).toEqual(['ready', 'beat']);
  });

  it('новый забег выбрасывает неразобранные события прошлого', () => {
    const sim = new Simulation();
    sim.startRun(1, BASE, EMPTY_CHART);
    for (let i = 0; i < 500; i++) sim.step(IDLE);
    sim.startRun(2, BASE, EMPTY_CHART);
    expect(types(sim.drainEvents())).toEqual(['ready', 'beat']);
    sim.startAttract(3);
    expect(sim.drainEvents()).toEqual([{ type: 'beat', tick: 0, beat: 0, bar: 0, beatInBar: 0, level: 1 }]);
  });
});

describe('порядок событий внутри тика', () => {
  it('GO раньше доли; новый уровень раньше доли; рекорд за долю — после неё', () => {
    const sim = new Simulation();
    // К тику 1860 набегает 31 доля × 5 = 155 очков; доля 1920 уже на 2-м уровне даёт 10.
    sim.startRun(1, { ...BASE, highscore: 160 }, EMPTY_CHART);
    const events = runUntil(sim, TICKS_PER_LEVEL);
    expect(types(at(events, 0))).toEqual(['go', 'beat']);
    expect(at(events, TICKS_PER_LEVEL)).toEqual([
      { type: 'levelUp', tick: TICKS_PER_LEVEL, level: 2, speedMult: speedMultForLevel(2) },
      { type: 'beat', tick: TICKS_PER_LEVEL, beat: 32, bar: 8, beatInBar: 0, level: 2 },
      { type: 'newRecord', tick: TICKS_PER_LEVEL, score: 31 * GAME.score.perBeat + 2 * GAME.score.perBeat },
    ]);
  });

  it('доля → сфера (comboUp, collect, newRecord) → уклонение — всё на одном тике', () => {
    // Четвёртая сфера цепочки берётся на тике 540 (доля), большой куб в стороне уходит за корабль тогда же.
    const fourth = crystalAt(544);
    const cube = cubeAt(529, 15, 9);
    expect(pickupTick(fourth.arriveTick)).toBe(540);
    expect(passTick(cube)).toBe(540);
    const sim = run([...chain(3), fourth, cube], { ...BASE, highscore: 400 });
    const events = runUntil(sim, 560);

    const before = 8 * GAME.score.perBeat + 3 * GAME.score.crystal; // доли 60…480 и три сферы
    const afterBeat = before + GAME.score.perBeat;
    const afterCollect = afterBeat + score(GAME.score.crystal, 2);
    expect(at(events, 540)).toEqual([
      { type: 'beat', tick: 540, beat: 9, bar: 2, beatInBar: 1, level: 1 },
      { type: 'comboUp', tick: 540, multiplier: 2 },
      { type: 'collect', tick: 540, x: CENTER, rare: false, chain: 4, multiplier: 2, note: 3, points: score(GAME.score.crystal, 2) },
      { type: 'newRecord', tick: 540, score: afterCollect },
      // x уклонения — ближняя к кораблю грань куба.
      { type: 'dodge', tick: 540, x: expect.closeTo(15 + 9 * GAME.hitbox.cube, 9), kind: 'cube', near: false, points: score(GAME.score.dodge, 2) },
    ]);
    expect(sim.state.score).toBe(afterCollect + score(GAME.score.dodge, 2));
    expect(eventsOf(events, 'newRecord')).toHaveLength(1);
  });

  it('сфера, включившая OVERDRIVE: comboUp → overdrive → collect, очки уже удвоены', () => {
    const sim = run(chain(TO_OVERDRIVE + 1));
    const events = runUntil(sim, 300 + 30 * (TO_OVERDRIVE + 2));
    const collects = eventsOf(events, 'collect');
    const tick = collects[TO_OVERDRIVE - 1].tick;
    expect(at(events, tick)).toEqual([
      { type: 'comboUp', tick, multiplier: MAX },
      { type: 'overdrive', tick, on: true },
      expect.objectContaining({ type: 'collect', chain: TO_OVERDRIVE, multiplier: MAX, points: score(GAME.score.crystal, MAX, true) }),
    ]);
    // Дальше множитель не растёт и повторных comboUp / overdrive нет.
    expect(eventsOf(events, 'comboUp').map((e) => e.multiplier)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(eventsOf(events, 'overdrive')).toHaveLength(1);
    expect(sim.hud().chainProgress).toBe(1);
    expect(sim.state.overdrive).toBe(true);
  });

  it('пропуск в OVERDRIVE: miss → comboBreak → overdrive(off)', () => {
    const lost = crystalAt(300 + 30 * (TO_OVERDRIVE + 1), 20);
    const sim = run([...chain(TO_OVERDRIVE), lost]);
    const events = runUntil(sim, lost.arriveTick + 40);
    const miss = eventsOf(events, 'miss')[0];
    expect(miss.tick).toBe(lost.arriveTick + 5);
    expect(at(events, miss.tick)).toEqual([
      { type: 'miss', tick: miss.tick, x: 20 },
      { type: 'comboBreak', tick: miss.tick, reason: 'miss', lost: MAX },
      { type: 'overdrive', tick: miss.tick, on: false },
    ]);
  });

  it('щит в OVERDRIVE: shieldBreak → comboBreak(hit) → overdrive(off), дальше очки без множителя', () => {
    const cube = cubeAt(300 + 30 * TO_OVERDRIVE + 60);
    const after = crystalAt(cube.arriveTick + 240);
    const sim = run([...chain(TO_OVERDRIVE), cube, after], { ...BASE, shieldCharges: 1 });
    const events = runUntil(sim, after.arriveTick + 30);
    const hit = eventsOf(events, 'shieldBreak')[0];
    expect(at(events, hit.tick)).toEqual([
      { type: 'shieldBreak', tick: hit.tick, x: CENTER, kind: 'cube', left: 0 },
      { type: 'comboBreak', tick: hit.tick, reason: 'hit', lost: MAX },
      { type: 'overdrive', tick: hit.tick, on: false },
    ]);
    expect(eventsOf(events, 'overdrive').map((e) => e.on)).toEqual([true, false]);
    expect(eventsOf(events, 'death')).toHaveLength(0);
    // Разбитый куб не засчитывается как уклонение.
    expect(eventsOf(events, 'dodge')).toHaveLength(0);
    const last = eventsOf(events, 'collect').at(-1)!;
    expect(last).toMatchObject({ chain: 1, multiplier: 1, points: GAME.score.crystal });
    expect(sim.state.maxMultiplier).toBe(MAX);
    expect(sim.state.maxChain).toBe(TO_OVERDRIVE);
  });

  it('удар без набранной цепочки не даёт comboBreak', () => {
    const sim = run([cubeAt(480)], { ...BASE, shieldCharges: 2 });
    const events = runUntil(sim, 500);
    expect(types(events.filter((e) => e.type !== 'beat' && e.type !== 'ready' && e.type !== 'go'))).toEqual(['shieldBreak']);
    expect(eventsOf(events, 'shieldBreak')[0].left).toBe(1);
  });
});

describe('вступление', () => {
  it('до GO ничего не считается: сфера и куб у самой линии старта срабатывают на тике 0', () => {
    // Оба объекта входят в зону корабля ещё во время READY.
    const sim = run([crystalAt(2), cubeAt(3)]);
    const before = runUntil(sim, -1);
    expect(types(before).filter((t) => t !== 'beat')).toEqual(['ready']);
    expect(sim.state.crystals[0].state).toBe('live');
    expect(sim.state.player.alive).toBe(true);
    sim.step(IDLE);
    expect(sim.drainEvents()).toEqual([
      { type: 'go', tick: 0 },
      { type: 'beat', tick: 0, beat: 0, bar: 0, beatInBar: 0, level: 1 },
      { type: 'collect', tick: 0, x: CENTER, rare: false, chain: 1, multiplier: 1, note: 0, points: GAME.score.crystal },
      { type: 'death', tick: 0, x: CENTER, kind: 'cube' },
    ]);
    // Забег на нулевом тике записывать незачем — но очки за сферу уже есть.
    expect(sim.abandon()).toBeNull();
    expect(sim.state.score).toBe(GAME.score.crystal);
  });

  it('во вступлении корабль уже слушается управления', () => {
    const sim = new Simulation();
    sim.startRun(1, BASE, EMPTY_CHART);
    runUntil(sim, -200, holdAt(70));
    expect(sim.state.mode).toBe('ready');
    expect(sim.state.player.x).toBeGreaterThan(CENTER + 10);
    expect(sim.state.score).toBe(0);
  });
});

describe('каждое событие — ровно один раз', () => {
  it('пять уровней по полосе: число событий сходится с треком', () => {
    // Трек конечный: 40 тактов, дальше пусто — к концу прогона всё, что было на дороге, пролетело.
    const BARS = (TICKS_PER_LEVEL * 5) / TICKS_PER_BAR;
    const source = laneChart(21, { crystalsOnLane: 0.7 });
    const chart: ChartSource = { bar: (b) => (b < BARS ? source.bar(b) : []) };
    const sim = new Simulation();
    sim.startRun(21, BASE, chart);
    const events = runUntil(sim, (BARS + 2) * TICKS_PER_BAR, followLane(source));

    const all = Array.from({ length: BARS }, (_, b) => laneChart(21, { crystalsOnLane: 0.7 }).bar(b)).flat();
    const obstacles = all.filter(isObstacleSpec);
    const crystals = all.filter((i) => !isObstacleSpec(i));
    expect(obstacles.length).toBeGreaterThan(150);
    expect(crystals.length).toBeGreaterThan(300);

    expect(eventsOf(events, 'death')).toHaveLength(0);
    expect(eventsOf(events, 'ready')).toHaveLength(1);
    expect(eventsOf(events, 'go')).toHaveLength(1);
    expect(eventsOf(events, 'levelUp').map((e) => e.level)).toEqual([2, 3, 4, 5, 6]);
    expect(eventsOf(events, 'dodge')).toHaveLength(obstacles.length);
    const collects = eventsOf(events, 'collect');
    const misses = eventsOf(events, 'miss');
    expect(collects.length + misses.length).toBe(crystals.length);
    // Каждая сфера даёт ровно одно событие: ноты не повторяются и идут по порядку прилёта.
    const notes = collects.map((e) => e.note);
    expect(new Set(notes).size).toBe(notes.length);
    expect([...notes].sort((a, b) => a - b)).toEqual(notes);
    expect(collects.length).toBeGreaterThan(crystals.length * 0.6);
    expect(misses.length).toBeGreaterThan(0);
    expect(sim.state.obstacles).toHaveLength(0);
    expect(sim.state.crystals).toHaveLength(0);
    // Счётчики состояния совпадают с событиями.
    expect(sim.state.dodged).toBe(obstacles.length);
    expect(sim.state.crystalsCollected).toBe(collects.length);
    expect(sim.state.nearMisses).toBe(eventsOf(events, 'dodge').filter((e) => e.near).length);
    expect(sim.state.score).toBe([...collects, ...eventsOf(events, 'dodge')].reduce((sum, e) => sum + e.points, 0) + beatPoints(events));
    expect(eventsOf(events, 'comboBreak').length).toBeGreaterThan(0);
    expect(eventsOf(events, 'comboBreak').length).toBeLessThanOrEqual(misses.length);
    // OVERDRIVE включается и выключается строго по очереди.
    const overdrive = eventsOf(events, 'overdrive').map((e) => e.on);
    overdrive.forEach((on, i) => expect(on).toBe(i % 2 === 0));
  });

  /** Очки за доли, восстановленные по событиям: множитель меняют только comboUp / comboBreak / overdrive. */
  function beatPoints(events: SimEvent[]): number {
    let multiplier = 1;
    let overdrive = false;
    let total = 0;
    let playing = false;
    for (const e of events) {
      if (e.type === 'go') playing = true;
      else if (e.type === 'comboUp') multiplier = e.multiplier;
      else if (e.type === 'comboBreak') multiplier = 1;
      else if (e.type === 'overdrive') overdrive = e.on;
      else if (e.type === 'beat' && playing && e.tick > 0) total += score(GAME.score.perBeat * e.level, multiplier, overdrive);
    }
    return total;
  }
});

describe('брошенный и завершённый забег', () => {
  it('abandon() во время взрыва отдаёт итог на момент гибели и отменяет gameOver', () => {
    const sim = run([crystalAt(300), cubeAt(480)]);
    const events = runUntil(sim, 490);
    const death = eventsOf(events, 'death')[0];
    expect(sim.state.mode).toBe('dying');
    expect(sim.state.tick).toBeGreaterThan(death.tick);

    const result = sim.abandon();
    expect(result).toEqual({
      score: GAME.score.crystal + Math.floor(death.tick / TICKS_PER_BEAT) * GAME.score.perBeat,
      level: 1,
      speedMult: 1,
      crystals: 1,
      crystalsCollected: 1,
      maxMultiplier: 1,
      maxChain: 1,
      nearMisses: 0,
      dodged: 0,
      duration: death.tick / TICK_RATE,
      newRecord: false,
      seed: 1,
    });
    expect(sim.state.mode).toBe('over');
    expect(sim.state.timeScale).toBe(1);
    expect(sim.state.player.alive).toBe(false);
    expect(sim.result()).toBeNull();
    expect(sim.abandon()).toBeNull();

    const tail = runUntil(sim, death.tick + GAME.death.ticks + 300);
    expect(types(tail).every((t) => t === 'beat')).toBe(true);
    expect(sim.result()).toBeNull();
    expect(sim.state.score).toBe(result!.score);
    expect(sim.hud().elapsed).toBe(death.tick / TICK_RATE);
  });

  it('гибель без единого очка: abandon() возвращает null, но забег закрыт', () => {
    const sim = run([cubeAt(30)]);
    const events = runUntil(sim, 40);
    expect(eventsOf(events, 'death')).toHaveLength(1);
    expect(sim.state.score).toBe(0);
    expect(sim.abandon()).toBeNull();
    expect(sim.state.mode).toBe('over');
    expect(eventsOf(runUntil(sim, 400), 'gameOver')).toHaveLength(0);
  });

  it('abandon() во вступлении закрывает забег без итога', () => {
    const sim = new Simulation();
    sim.startRun(1, BASE, EMPTY_CHART);
    runUntil(sim, -100);
    expect(sim.abandon()).toBeNull();
    expect(sim.state.mode).toBe('over');
    const events = runUntil(sim, 300);
    // Забег закрыт: GO не будет, корабль не слушается, очки не идут.
    expect(types(events).every((t) => t === 'beat')).toBe(true);
    expect(sim.state.score).toBe(0);
    expect(sim.hud().elapsed).toBe(0);
  });

  it('abandon() в фоновой сцене и до первого старта ничего не делает', () => {
    const sim = new Simulation();
    expect(sim.state.mode).toBe('attract');
    expect(sim.abandon()).toBeNull();
    expect(sim.result()).toBeNull();
    sim.startAttract(1);
    for (let i = 0; i < 100; i++) sim.step(IDLE);
    expect(sim.abandon()).toBeNull();
    expect(sim.state.mode).toBe('attract');
  });

  it('после гибели уровень, время и счёт замирают; итог совпадает с HUD', () => {
    // Гибель за несколько тиков до смены уровня: взрыв пересекает границу, но levelUp уже не случается.
    const cube = cubeAt(TICKS_PER_LEVEL - 15);
    const sim = run([cube]);
    const events = runUntil(sim, TICKS_PER_LEVEL + 400, holdAt(CENTER));
    const death = eventsOf(events, 'death')[0];
    expect(death.tick).toBeLessThan(TICKS_PER_LEVEL);
    expect(death.tick + GAME.death.ticks).toBeGreaterThan(TICKS_PER_LEVEL);
    expect(eventsOf(events, 'levelUp')).toHaveLength(0);
    expect(eventsOf(events, 'beat').every((b) => b.level === 1)).toBe(true);
    const over = eventsOf(events, 'gameOver')[0];
    expect(over.result).toMatchObject({ level: 1, speedMult: 1, duration: death.tick / TICK_RATE });
    expect(over.result.score).toBe(Math.floor(death.tick / TICKS_PER_BEAT) * GAME.score.perBeat);
    const hud = sim.hud();
    expect(hud).toMatchObject({ score: over.result.score, level: 1, speedMult: 1, elapsed: death.tick / TICK_RATE });
    expect(hud.levelProgress).toBeCloseTo(death.tick / TICKS_PER_LEVEL, 9);
    expect(sim.state.tick).toBe(TICKS_PER_LEVEL + 400);
    // После конца забега корабль не управляется.
    const x = sim.state.player.x;
    runUntil(sim, sim.state.tick + 50, holdAt(90));
    expect(sim.state.player.x).toBe(x);
    expect(sim.state.player.prevX).toBe(x);
    expect(sim.state.player.vx).toBe(0);
  });

  it('во время взрыва корабль не управляется, мир летит, сферы и уклонения не считаются', () => {
    const sim = run([crystalAt(300), cubeAt(480), crystalAt(490), cubeAt(495, 20)]);
    const events = runUntil(sim, 480 + GAME.death.ticks - 10, holdAt(CENTER));
    const death = eventsOf(events, 'death')[0];
    const after = events.filter((e) => e.tick > death.tick);
    expect(types(after).every((t) => t === 'beat')).toBe(true);
    expect(sim.state.mode).toBe('dying');
    expect(sim.state.crystals.find((c) => c.arriveTick === 490)?.state).toBe('live');
    expect(sim.state.obstacles.find((o) => o.arriveTick === 495)?.resolved).toBe(false);
    expect(sim.state.dodged).toBe(0);
  });
});

describe('один экземпляр на много сцен', () => {
  const loadoutA: SimLoadout = { ...BASE, shieldCharges: 1, magnetRadius: GAME.magnet.radius, scoreBonus: 0.1, crystalYield: 1.4, highscore: 50 };
  const loadoutB: SimLoadout = { ...BASE, highscore: 5000 };
  const itemsA: ChartItem[] = [...chain(6), cubeAt(540), cubeAt(900), crystalAt(700, 60), laserAt(1100, 20)];
  const itemsB: ChartItem[] = [...chain(5, 360), sawAt(700, 30), cubeAt(1000, 70, 6, { amp: 9, periodTicks: 240, phase: 1 }), crystalAt(1200, 30, true)];

  function wiggle(state: SimState): InputFrame {
    return holdAt(CENTER + 18 * Math.sin(state.tick / 40));
  }

  function expectSameRun(reused: Simulation, fresh: Simulation): void {
    expect(JSON.stringify(reused.state)).toBe(JSON.stringify(fresh.state));
    expect(reused.drainEvents()).toEqual(fresh.drainEvents());
    expect(reused.hud()).toEqual(fresh.hud());
    expect(reused.result()).toBeNull();
    while (fresh.state.tick < 1600) {
      reused.step(wiggle(reused.state));
      fresh.step(wiggle(fresh.state));
      expect(reused.drainEvents()).toEqual(fresh.drainEvents());
      if (fresh.state.tick % 97 === 0) expect(JSON.stringify(reused.state)).toBe(JSON.stringify(fresh.state));
    }
    expect(JSON.stringify(reused.state)).toBe(JSON.stringify(fresh.state));
    expect(reused.hud()).toEqual(fresh.hud());
    expect(reused.result()).toEqual(fresh.result());
  }

  it('второй startRun после Game Over не оставляет следов первого забега', () => {
    const reused = new Simulation();
    const state = reused.state;
    reused.startRun(5, loadoutA, scriptedChart(itemsA));
    const first = runUntil(reused, 1500);
    expect(eventsOf(first, 'shieldBreak')).toHaveLength(1);
    expect(eventsOf(first, 'gameOver')).toHaveLength(1);
    expect(eventsOf(first, 'newRecord')).toHaveLength(1);
    expect(reused.result()).not.toBeNull();
    for (let i = 0; i < 30; i++) reused.step(IDLE); // неразобранные события остаются в очереди

    reused.startRun(9, loadoutB, scriptedChart(itemsB));
    const fresh = new Simulation();
    fresh.startRun(9, loadoutB, scriptedChart(itemsB));
    // Объект состояния тот же самый — ссылку можно держать между забегами.
    expect(reused.state).toBe(state);
    expectSameRun(reused, fresh);
  });

  it('забег → фоновая сцена → забег', () => {
    const reused = new Simulation();
    reused.startRun(5, loadoutA, scriptedChart(itemsA));
    runUntil(reused, 520, wiggle);
    expect(reused.state.mode).toBe('playing');
    expect(reused.abandon()).not.toBeNull();

    reused.startAttract(77);
    expect(reused.state).toMatchObject({
      mode: 'attract',
      seed: 77,
      tick: 0,
      timeScale: 1,
      level: 1,
      speedMult: 1,
      score: 0,
      chain: 0,
      multiplier: 1,
      overdrive: false,
      runCrystals: 0,
      crystalsCollected: 0,
      dodged: 0,
      nearMisses: 0,
      maxMultiplier: 1,
      maxChain: 0,
      magnetRadius: 0,
      highscore: 0,
      newRecord: false,
    });
    expect(reused.state.player).toEqual({ x: CENTER, prevX: CENTER, vx: 0, bank: 0, alive: true, shield: 0, shieldMax: 0, invulnTicks: 0 });
    expect(reused.result()).toBeNull();
    for (let i = 0; i < 2000; i++) reused.step(IDLE);
    expect(types(reused.drainEvents()).every((t) => t === 'beat')).toBe(true);

    reused.startRun(9, loadoutB, scriptedChart(itemsB));
    const fresh = new Simulation();
    fresh.startRun(9, loadoutB, scriptedChart(itemsB));
    expectSameRun(reused, fresh);
  });

  it('одна и та же клавиатурная партия на двух экземплярах совпадает до бита', () => {
    const play = (): { state: string; events: string } => {
      const chart = laneChart(8);
      const rng = createRng(123);
      const sim = new Simulation();
      sim.startRun(8, { ...BASE, shieldCharges: 2, magnetRadius: 20 }, chart);
      let axis = 0;
      const events = runUntil(sim, 4000, () => {
        if (rng.chance(0.03)) axis = rng.int(-1, 1);
        return keyboard(axis);
      });
      return { state: JSON.stringify(sim.state), events: JSON.stringify(events) };
    };
    const a = play();
    const b = play();
    expect(a.state).toBe(b.state);
    expect(a.events).toBe(b.events);
  });
});

describe('магнит', () => {
  const R = GAME.magnet.radius;
  const STEP = GAME.magnet.pullSpeed / TICK_RATE;
  const magnet: SimLoadout = { ...BASE, magnetRadius: R };

  it.each([
    { offset: 10, lands: 'под кораблём' },
    { offset: 11.5, lands: 'на подлёте' },
  ])('тянет не быстрее pullSpeed и только в окне leadTicks (сфера в $offset ед. — $lands)', ({ offset }) => {
    const sim = run([crystalAt(480, CENTER + offset)], magnet);
    let pullBefore = 0;
    let pulledTicks = 0;
    let collected: SimEvent | undefined;
    while (sim.state.tick < 520) {
      sim.step(IDLE);
      const tick = sim.state.tick;
      for (const e of sim.drainEvents()) if (e.type === 'collect') collected = e;
      const c = sim.state.crystals[0];
      if (!c) continue;
      // Поля интерполяции: prevPull — значение прошлого тика.
      expect(c.prevPull).toBe(pullBefore);
      expect(Math.abs(c.pull - c.prevPull)).toBeLessThanOrEqual(STEP + 1e-12);
      if (c.arriveTick - tick > GAME.magnet.leadTicks) expect(c.pull).toBe(0);
      if (c.pull !== c.prevPull) pulledTicks++;
      // Сфера справа от корабля: тянется только влево и не дальше самого корабля.
      expect(c.pull).toBeLessThanOrEqual(0);
      expect(crystalX(c, tick)).toBeGreaterThanOrEqual(sim.state.player.x);
      const base = crystalBaseX(c, tick);
      expect(crystalX(c, tick, 0)).toBe(base + c.prevPull);
      expect(crystalX(c, tick, 1)).toBe(base + c.pull);
      expect(crystalX(c, tick, 0.5)).toBeCloseTo(base + (c.prevPull + c.pull) / 2, 12);
      pullBefore = c.pull;
    }
    expect(pulledTicks).toBeGreaterThan(5);
    if (collected?.type !== 'collect') throw new Error('сфера не собрана');
    // В событии — X сферы уже с притяжением.
    expect(Math.abs(collected.x - CENTER)).toBeLessThanOrEqual(pickupReach(false));
    if (offset === 10) {
      // Ближнюю сферу магнит успевает подтянуть вплотную ещё до зоны подбора.
      expect(collected.x).toBe(CENTER);
      expect(collected.tick).toBe(pickupTick(480));
    } else {
      // Дальняя берётся на лету: она ещё не под кораблём и входит в зону подбора позже.
      expect(collected.x).toBeGreaterThan(CENTER + 1);
      expect(collected.tick).toBeGreaterThanOrEqual(pickupTick(480));
    }
  });

  it('сила спадает к краю поля: ближняя сфера сдвигается сильнее, дальняя — едва, за радиусом — никак', () => {
    const near = crystalAt(480, CENTER - R * 0.4);
    const far = crystalAt(480, CENTER + R * 0.95);
    const outside = crystalAt(480, CENTER + R + 0.5);
    const sim = run([near, far, outside], magnet);
    runUntil(sim, 480 - GAME.magnet.leadTicks - 1);
    expect(sim.state.crystals.map((c) => c.pull)).toEqual([0, 0, 0]);
    sim.step(IDLE);
    const [a, b, c] = sim.state.crystals;
    expect(a.pull).toBeGreaterThan(0);
    expect(a.pull).toBeLessThanOrEqual(STEP);
    expect(b.pull).toBeLessThan(0);
    expect(Math.abs(b.pull)).toBeLessThan(a.pull / 20);
    expect(c.pull).toBe(0);
    runUntil(sim, 520);
    expect(sim.state.crystals.map((k) => k.state)).toEqual(['taken', 'missed', 'missed']);
    // Сфера за радиусом так и не сдвинулась.
    expect(sim.state.crystals[2].pull).toBe(0);
  });

  it('корабль ушёл — сфера остаётся там, куда её дотянули; взятая сфера больше не двигается', () => {
    const sim = run([crystalAt(480, CENTER + 12), crystalAt(600)], magnet);
    runUntil(sim, 450);
    const dragged = sim.state.crystals[0];
    expect(dragged.pull).toBeLessThan(0);
    // Резко уводим корабль далеко влево: сфера выходит из поля.
    runUntil(sim, 470, holdAt(SHIP_MIN_X));
    const frozen = dragged.pull;
    runUntil(sim, 500, holdAt(SHIP_MIN_X));
    expect(dragged.pull).toBe(frozen);
    expect(dragged.prevPull).toBe(frozen);
    expect(dragged.state).toBe('missed');

    runUntil(sim, 596, holdAt(CENTER + 3));
    const second = sim.state.crystals.find((c) => c.arriveTick === 600)!;
    runUntil(sim, 620, holdAt(CENTER + 3));
    expect(second.state).toBe('taken');
    const pull = second.pull;
    runUntil(sim, 640, holdAt(CENTER - 10));
    expect(second.pull).toBe(pull);
    expect(second.prevPull).toBe(pull);
  });

  it('усиленное поле достаёт дальше, но не дальше своего радиуса', () => {
    const wide = { ...BASE, magnetRadius: R * 1.9 };
    const reachable = run([crystalAt(480, CENTER + 17)], wide);
    expect(eventsOf(runUntil(reachable, 520), 'collect')).toHaveLength(1);
    const base = run([crystalAt(480, CENTER + 17)], magnet);
    expect(eventsOf(runUntil(base, 520), 'collect')).toHaveLength(0);
    const beyond = run([crystalAt(480, CENTER + R * 1.9 + 1)], wide);
    expect(eventsOf(runUntil(beyond, 520), 'miss')).toHaveLength(1);
  });
});

describe('щит и неуязвимость', () => {
  it('препятствие, прошедшее сквозь неуязвимый корабль, — обычное уклонение без near miss', () => {
    const sim = run([cubeAt(480), cubeAt(540)], { ...BASE, shieldCharges: 1 });
    const events = runUntil(sim, 500);
    const [broken, ghost] = sim.state.obstacles;
    expect(broken).toMatchObject({ arriveTick: 480, destroyed: true, resolved: true });
    expect(ghost).toMatchObject({ arriveTick: 540, destroyed: false, resolved: false });
    events.push(...runUntil(sim, 560));
    expect(types(events.filter((e) => e.tick > 400 && e.type !== 'beat'))).toEqual(['shieldBreak', 'dodge']);
    const dodge = eventsOf(events, 'dodge')[0];
    expect(dodge).toMatchObject({ kind: 'cube', near: false, points: GAME.score.dodge });
    expect(dodge.tick).toBe(passTick(cubeAt(540)));
    expect(sim.state.dodged).toBe(1);
    expect(sim.state.nearMisses).toBe(0);
    expect(ghost).toMatchObject({ destroyed: false, resolved: true });
    // Отрицательный зазор — признак того, что объект прошёл сквозь корабль.
    expect(ghost.minClear).toBeLessThan(0);
  });

  it('пролёт впритирку во время неуязвимости остаётся near miss', () => {
    const beside = CENTER + 5 * GAME.hitbox.cube + GAME.player.radius + 1;
    const sim = run([cubeAt(480), cubeAt(540, beside)], { ...BASE, shieldCharges: 1 });
    const events = runUntil(sim, 560);
    expect(eventsOf(events, 'dodge')).toEqual([expect.objectContaining({ near: true, points: GAME.score.dodge + GAME.score.nearMiss })]);
    expect(sim.state.player.invulnTicks).toBeGreaterThan(0);
    expect(sim.state.nearMisses).toBe(1);
  });

  it('неуязвимость длится ровно invulnTicks тиков после удара', () => {
    // Луч на 1-м уровне опасен на тиках arrive−2…arrive+2; корабль стоит в луче.
    const beam = (arriveTick: number) => laserAt(arriveTick, 15, 8);
    const hitTick = 478;
    const last = hitTick + GAME.shield.invulnTicks;

    const spared = run([beam(480), beam(last - 3)], { ...BASE, shieldCharges: 1 });
    const sparedEvents: SimEvent[] = [];
    while (spared.state.tick < last + 20) {
      spared.step(IDLE);
      const tick = spared.state.tick;
      sparedEvents.push(...spared.drainEvents());
      if (tick >= hitTick) expect(spared.state.player.invulnTicks).toBe(Math.max(0, last - tick));
    }
    expect(eventsOf(sparedEvents, 'shieldBreak').map((e) => e.tick)).toEqual([hitTick]);
    expect(eventsOf(sparedEvents, 'death')).toHaveLength(0);
    expect(eventsOf(sparedEvents, 'dodge')).toEqual([expect.objectContaining({ kind: 'laser', near: false })]);

    // Тот же луч на тик позже: его последняя проба приходится на первый уязвимый тик.
    const caught = run([beam(480), beam(last - 2)], { ...BASE, shieldCharges: 1 });
    const deaths = eventsOf(runUntil(caught, last + 20), 'death');
    expect(deaths.map((e) => e.tick)).toEqual([last]);
  });

  it('два заряда щита прощают два удара; одновременные препятствия тратят один', () => {
    const sim = run([cubeAt(480, CENTER - 2), cubeAt(480, CENTER + 2), cubeAt(780), cubeAt(1080)], { ...BASE, shieldCharges: 2 });
    const events = runUntil(sim, 1100);
    expect(eventsOf(events, 'shieldBreak').map((e) => e.left)).toEqual([1, 0]);
    expect(eventsOf(events, 'death')).toHaveLength(1);
    expect(sim.state.player.shield).toBe(0);
    expect(sim.state.player.shieldMax).toBe(2);
  });
});

describe('столкновения на предельной скорости', () => {
  const LEVEL = 20;
  const START = (LEVEL - 1) * TICKS_PER_LEVEL;
  const GAP = { x: 20, halfW: 10 };
  /** Лучи с разной дробной фазой прилёта — реже, чем длится неуязвимость. */
  const offsets = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 0.999];
  const beams = offsets.map((f, k) => laserAt(START + 600 + k * 300 + f, GAP.x, GAP.halfW));

  it('на 20-м уровне объекты летят с предельной скоростью', () => {
    expect(approachTicksForLevel(LEVEL)).toBe(GAME.approach.min);
    expect(approachFor(beams[0].arriveTick)).toBe(GAME.approach.min);
    // За тик луч пролетает больше собственной зоны контакта — без промежуточной пробы не обойтись.
    expect(WORLD.zFar / GAME.approach.min).toBeGreaterThan(depthReach({ kind: 'laser', halfW: GAP.halfW, halfD: 1 }));
  });

  it('луч не проскакивает корабль ни при какой фазе прилёта', () => {
    const sim = run(beams, { ...BASE, shieldCharges: beams.length - 1 });
    const events = runUntil(sim, beams.at(-1)!.arriveTick + 100, holdAt(80));
    const breaks = eventsOf(events, 'shieldBreak');
    expect(breaks).toHaveLength(beams.length - 1);
    breaks.forEach((e, k) => {
      expect(e.kind).toBe('laser');
      expect(Math.abs(e.tick - beams[k].arriveTick)).toBeLessThanOrEqual(1);
    });
    const deaths = eventsOf(events, 'death');
    expect(deaths).toHaveLength(1);
    expect(Math.abs(deaths[0].tick - beams.at(-1)!.arriveTick)).toBeLessThanOrEqual(1);
    expect(eventsOf(events, 'dodge')).toHaveLength(0);
    expect(sim.state.level).toBe(LEVEL + Math.floor((deaths[0].tick - START) / TICKS_PER_LEVEL));
  });

  it('в проходе корабль цел при любой фазе', () => {
    const sim = run(beams);
    const events = runUntil(sim, beams.at(-1)!.arriveTick + 100, holdAt(GAP.x));
    expect(eventsOf(events, 'death')).toHaveLength(0);
    expect(eventsOf(events, 'dodge')).toHaveLength(beams.length);
    expect(sim.state.nearMisses).toBe(0);
  });

  it('пила и куб на предельной скорости тоже не проскакивают', () => {
    const items = offsets.flatMap((f, k) => [sawAt(START + 600 + k * 600 + f, 70, 5), cubeAt(START + 900 + k * 600 + f, 70, 4.5)]);
    const sim = run(items, { ...BASE, shieldCharges: items.length });
    const events = runUntil(sim, START + 600 + offsets.length * 600, holdAt(71.5));
    expect(eventsOf(events, 'shieldBreak')).toHaveLength(items.length);
    expect(eventsOf(events, 'death')).toHaveLength(0);
  });

  it('проба на полтика ловит корабль, который выскочил из прохода сразу за лучом', () => {
    const arrive = START + 600;
    const gate = laserAt(arrive, CENTER, 10);
    const speed = GAME.player.pointerMaxSpeed / TICK_RATE;
    // В момент прилёта корабль ещё в проходе, но уже летит к его краю на полной скорости.
    const xAtArrive = CENTER + 10 - GAME.player.radius * GAME.hitbox.laserPlayer - 0.42;
    const runUp = 20;
    const sim = run([gate]);
    runUntil(sim, arrive - runUp, holdAt(xAtArrive - runUp * speed));
    runUntil(sim, arrive, holdAt(1e6));
    expect(sim.state.player.x).toBeCloseTo(xAtArrive, 6);
    expect(sim.state.mode).toBe('playing');
    const body = sim.state.obstacles[0];
    expect(contactAt(body, arrive, sim.state.player.x).clear).toBeGreaterThan(0);

    sim.step(holdAt(1e6));
    // На целом тике луч уже вне досягаемости — столкновение увидела только промежуточная проба.
    expect(contactAt(body, arrive + 1, sim.state.player.x).inRange).toBe(false);
    const half = contactAt(body, arrive + 0.5, (sim.state.player.prevX + sim.state.player.x) / 2);
    expect(half.inRange && half.clear < 0).toBe(true);
    expect(sim.drainEvents().filter((e) => e.type === 'death')).toEqual([{ type: 'death', tick: arrive + 1, x: sim.state.player.x, kind: 'laser' }]);
  });
});

describe('подача трека', () => {
  it('такты запрашиваются строго по порядку, по одному разу и заранее', () => {
    const sim = new Simulation();
    const spy = spyChart(laneChart(3), () => sim.state.tick);
    sim.startRun(3, BASE, spy.chart);
    expect(spy.requests).toEqual([
      { bar: 0, tick: -LEAD_IN_TICKS },
      { bar: 1, tick: -LEAD_IN_TICKS },
    ]);
    const chart = laneChart(3);
    runUntil(sim, 3000, followLane(chart));
    expect(spy.requests.map((r) => r.bar)).toEqual(Array.from({ length: spy.requests.length }, (_, i) => i));
    for (const r of spy.requests.slice(2)) expect(r.tick).toBe(r.bar * TICKS_PER_BAR - REQUEST_LEAD_TICKS);
    expect(spy.requests.at(-1)!.bar).toBe(Math.floor((3000 + REQUEST_LEAD_TICKS) / TICKS_PER_BAR));
    // Запрос всегда раньше появления самого раннего объекта такта.
    expect(REQUEST_LEAD_TICKS).toBeGreaterThanOrEqual(GAME.approach.base + TICKS_PER_BAR);
  });

  it('во время взрыва такты ещё запрашиваются, после конца забега — нет', () => {
    const sim = new Simulation();
    const spy = spyChart(scriptedChart([cubeAt(650)]), () => sim.state.tick);
    sim.startRun(1, BASE, spy.chart);
    const events = runUntil(sim, 2000);
    const death = eventsOf(events, 'death')[0].tick;
    const over = eventsOf(events, 'gameOver')[0].tick;
    const barInDying = 5; // запрашивается на тике 660
    expect(barInDying * TICKS_PER_BAR - REQUEST_LEAD_TICKS).toBeGreaterThan(death);
    expect(barInDying * TICKS_PER_BAR - REQUEST_LEAD_TICKS).toBeLessThan(over);
    expect(spy.requests.at(-1)).toEqual({ bar: barInDying, tick: 660 });
  });

  it('объект появляется в состоянии ровно в spawnTick на дальней границе и исчезает за zBehind', () => {
    const late = cubeAt(TICKS_PER_LEVEL + 480, 20); // прилетает уже на 2-м уровне — летит быстрее
    const sim = run([cubeAt(480, 20), crystalAt(495, 80), late]);
    const approach = GAME.approach.base;
    runUntil(sim, 480 - approach - 1, holdAt(CENTER));
    expect(sim.state.obstacles).toHaveLength(0);
    sim.step(IDLE);
    expect(sim.state.obstacles).toHaveLength(1);
    const o = sim.state.obstacles[0];
    expect(o.spawnTick).toBe(sim.state.tick);
    expect(depthAt(o.arriveTick, o.approachTicks, sim.state.tick)).toBe(WORLD.zFar);
    expect(sim.state.crystals).toHaveLength(0);
    runUntil(sim, 495 - approach);
    expect(sim.state.crystals).toHaveLength(1);

    // z = −zBehind на (zBehind / zFar) · approach тиков позже прилёта.
    const gone = Math.floor((WORLD.zBehind * approach) / WORLD.zFar) + 1;
    runUntil(sim, 480 + gone - 1);
    expect(sim.state.obstacles).toHaveLength(1);
    sim.step(IDLE);
    expect(sim.state.obstacles).toHaveLength(0);
    // Пропущенная сфера летит дальше в состоянии missed, пока тоже не уйдёт за корабль.
    expect(sim.state.crystals[0].state).toBe('missed');
    runUntil(sim, 495 + gone);
    expect(sim.state.crystals).toHaveLength(0);

    const fast = approachTicksForLevel(2);
    expect(fast).toBeLessThan(approach);
    runUntil(sim, late.arriveTick - fast);
    expect(sim.state.obstacles).toHaveLength(1);
    expect(sim.state.obstacles[0]).toMatchObject({ approachTicks: fast, spawnTick: late.arriveTick - fast });
    expect(depthAt(late.arriveTick, fast, sim.state.tick)).toBe(WORLD.zFar);
  });

  it('взятая сфера остаётся в состоянии taken до ухода за корабль', () => {
    const sim = run([crystalAt(480)]);
    runUntil(sim, 485);
    expect(sim.state.crystals).toHaveLength(1);
    expect(sim.state.crystals[0].state).toBe('taken');
    runUntil(sim, 480 + 53);
    expect(sim.state.crystals).toHaveLength(0);
  });

  it('такт, отданный вперемешку: объекты, id и ноты идут в порядке прилёта, массив трека не трогается', () => {
    const shuffled: ChartItem[] = [crystalAt(700, 60), cubeAt(690, 10), crystalAt(640, 40), cubeAt(630, 90), crystalAt(670, 50), crystalAt(640, 45)];
    const snapshot = JSON.stringify(shuffled);
    const chart: ChartSource = { bar: (b) => (b === 2 ? shuffled : []) };
    const sim = new Simulation();
    sim.startRun(1, BASE, chart);
    runUntil(sim, 420);
    expect(JSON.stringify(shuffled)).toBe(snapshot);
    expect(sim.state.crystals.map((c) => [c.arriveTick, c.x, c.note])).toEqual([
      [640, 40, 0],
      [640, 45, 1],
      [670, 50, 2],
      [700, 60, 3],
    ]);
    expect(sim.state.obstacles.map((o) => o.arriveTick)).toEqual([630, 690]);
    const ids = [...sim.state.obstacles, ...sim.state.crystals].sort((a, b) => a.arriveTick - b.arriveTick || a.id - b.id).map((e) => e.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('объект с прошедшим или негодным временем прилёта не выпускается на дорогу', () => {
    const broken: ChartItem[] = [cubeAt(100), crystalAt(Number.NaN), cubeAt(Number.POSITIVE_INFINITY), crystalAt(-50), crystalAt(760, 30)];
    const chart: ChartSource = { bar: (b) => (b === 3 ? broken : []) }; // такт 3 запрашивается на тике 180
    const sim = new Simulation();
    sim.startRun(1, BASE, chart);
    const events = runUntil(sim, 900);
    expect(eventsOf(events, 'death')).toHaveLength(0);
    expect(eventsOf(events, 'miss')).toEqual([expect.objectContaining({ x: 30 })]);
    expect(sim.state.dodged).toBe(0);
    expect(findBadNumber(sim.state)).toBeNull();
  });

  it('поток объектов: на дороге никогда не больше GAME.limits', () => {
    const flood: ChartSource = {
      bar(b) {
        if (b < 1 || b > 6) return [];
        const items: ChartItem[] = [];
        for (let i = 0; i < 400; i++) items.push(cubeAt(b * TICKS_PER_BAR + (i * 7) % TICKS_PER_BAR, 6 + (i % 23), 4.5));
        for (let i = 0; i < 600; i++) items.push(crystalAt(b * TICKS_PER_BAR + (i * 11) % TICKS_PER_BAR, 60 + (i % 35), i % 50 === 0));
        return items;
      },
    };
    const sim = new Simulation();
    sim.startRun(1, { ...BASE, magnetRadius: GAME.magnet.radius }, flood);
    let maxObstacles = 0;
    let maxCrystals = 0;
    let deaths = 0;
    while (sim.state.tick < 8 * TICKS_PER_BAR) {
      sim.step(holdAt(48));
      for (const e of sim.drainEvents()) if (e.type === 'death') deaths++;
      maxObstacles = Math.max(maxObstacles, sim.state.obstacles.length);
      maxCrystals = Math.max(maxCrystals, sim.state.crystals.length);
      expect(sim.state.obstacles.length).toBeLessThanOrEqual(GAME.limits.obstacles);
      expect(sim.state.crystals.length).toBeLessThanOrEqual(GAME.limits.crystals);
    }
    expect(deaths).toBe(0);
    expect(maxObstacles).toBe(GAME.limits.obstacles);
    expect(maxCrystals).toBe(GAME.limits.crystals);
    expect(sim.state.dodged).toBeGreaterThan(GAME.limits.obstacles);
    expect(sim.state.crystalsCollected).toBeGreaterThan(0);
    expect(findBadNumber(sim.state)).toBeNull();
    // Поток кончился — дорога пустеет, ничего не застревает.
    runUntil(sim, 10 * TICKS_PER_BAR, holdAt(48));
    expect(sim.state.obstacles).toHaveLength(0);
    expect(sim.state.crystals).toHaveLength(0);
    expect(sim.state.mode).toBe('playing');
  });
});

describe('корабль', () => {
  const accel = GAME.player.accel / TICK_RATE;
  const keep = Math.exp(-GAME.player.friction / TICK_RATE);

  function fresh(): Simulation {
    const sim = new Simulation();
    sim.startRun(1, BASE, EMPTY_CHART);
    return sim;
  }

  it('клавиатура: точные формулы разгона, предела и торможения', () => {
    const sim = fresh();
    sim.step(keyboard(1));
    expect(sim.state.player.vx).toBeCloseTo(accel, 12);
    expect(sim.state.player.x).toBeCloseTo(CENTER + accel / TICK_RATE, 12);
    for (let i = 0; i < 20; i++) sim.step(keyboard(1));
    expect(sim.state.player.vx).toBe(GAME.player.maxSpeed);

    sim.step(keyboard(0));
    expect(sim.state.player.vx).toBeCloseTo(GAME.player.maxSpeed * keep, 12);
    const x = sim.state.player.x;
    sim.step(IDLE);
    expect(sim.state.player.vx).toBeCloseTo(GAME.player.maxSpeed * keep * keep, 12);
    expect(sim.state.player.x).toBeCloseTo(x + (GAME.player.maxSpeed * keep * keep) / TICK_RATE, 12);
    for (let i = 0; i < 200; i++) sim.step(keyboard(0));
    // Скорость гаснет до точного нуля, а не до бесконечно малой.
    expect(sim.state.player.vx).toBe(0);
    const rest = sim.state.player.x;
    sim.step(IDLE);
    expect(sim.state.player.x).toBe(rest);
    expect(sim.state.player.bank).toBeCloseTo(0, 3);
  });

  it('встречная клавиша тормозит ускорением, ось больше единицы не даёт форы', () => {
    const sim = fresh();
    for (let i = 0; i < 6; i++) sim.step(keyboard(1));
    const vx = sim.state.player.vx;
    sim.step(keyboard(-1));
    expect(sim.state.player.vx).toBeCloseTo(vx - accel, 12);
    const other = fresh();
    other.step(keyboard(5));
    expect(other.state.player.vx).toBeCloseTo(accel, 12);
  });

  it('указатель: шаг — ровно (цель − x) · pointerFollow · dt, пока не упрётся в предел', () => {
    const sim = fresh();
    let x = CENTER;
    for (let i = 0; i < 30; i++) {
      sim.step(holdAt(60));
      const vx = Math.min((60 - x) * GAME.player.pointerFollow, GAME.player.pointerMaxSpeed);
      x += vx / TICK_RATE;
      expect(sim.state.player.vx).toBeCloseTo(vx, 12);
      expect(sim.state.player.x).toBeCloseTo(x, 12);
      expect(sim.state.player.prevX).toBeCloseTo(x - vx / TICK_RATE, 12);
    }
    // Бот задаёт цель так, чтобы получить нужную скорость: формула обязана её вернуть.
    const wanted = -37;
    const from = sim.state.player.x;
    sim.step(holdAt(from + wanted / GAME.player.pointerFollow));
    expect(sim.state.player.vx).toBeCloseTo(wanted, 9);
  });

  it('у стены скорость обнуляется, а корабль не выходит за край ни на бит', () => {
    const sim = fresh();
    runUntil(sim, -100, holdAt(1e9));
    expect(sim.state.player.x).toBe(SHIP_MAX_X);
    expect(sim.state.player.vx).toBe(0);
    runUntil(sim, 100, keyboard(-1));
    expect(sim.state.player.x).toBe(SHIP_MIN_X);
    expect(sim.state.player.vx).toBe(0);
    expect(SHIP_MIN_X).toBe(GAME.player.edge);
    expect(SHIP_MAX_X).toBe(WORLD.roadW - GAME.player.edge);
    // От стены корабль отъезжает свободно.
    sim.step(keyboard(1));
    expect(sim.state.player.x).toBeGreaterThan(SHIP_MIN_X);
  });

  it('смена устройства: указатель без координаты и «нет ввода» ведут себя как отпущенные клавиши', () => {
    const sim = fresh();
    for (let i = 0; i < 10; i++) sim.step(holdAt(90));
    expect(sim.state.player.vx).toBe(GAME.player.pointerMaxSpeed);
    // После указателя клавиатурный предел скорости ниже — скорость сразу в него укладывается.
    sim.step({ axis: 0, pointerX: null, source: 'pointer' });
    expect(sim.state.player.vx).toBe(GAME.player.maxSpeed);
    sim.step({ axis: 1, pointerX: 20, source: 'none' });
    expect(sim.state.player.vx).toBeCloseTo(GAME.player.maxSpeed * keep, 12);
    // Клавиатура главнее оставшейся координаты указателя.
    sim.step({ axis: -1, pointerX: 90, source: 'keyboard' });
    expect(sim.state.player.vx).toBeCloseTo(GAME.player.maxSpeed * keep - accel, 12);
  });

  it('негодный ввод не портит состояние, крен всегда в [−1, 1]', () => {
    const sim = fresh();
    const rng = createRng(5);
    const junk = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e300, -1e300];
    while (sim.state.tick < 3000) {
      const roll = rng.next();
      const input: InputFrame =
        roll < 0.1
          ? { axis: rng.pick(junk), pointerX: rng.pick(junk), source: rng.pick(['keyboard', 'pointer', 'none'] as const) }
          : roll < 0.55
            ? holdAt(rng.range(-50, 150))
            : keyboard(rng.int(-1, 1));
      sim.step(input);
      const p = sim.state.player;
      expect(Number.isFinite(p.x) && Number.isFinite(p.vx) && Number.isFinite(p.bank)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(SHIP_MIN_X);
      expect(p.x).toBeLessThanOrEqual(SHIP_MAX_X);
      expect(Math.abs(p.bank)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.vx)).toBeLessThanOrEqual(GAME.player.pointerMaxSpeed);
    }
    expect(findBadNumber(sim.state)).toBeNull();
  });
});

describe('очки и валюта', () => {
  it('любое начисление — round(база × множитель × overdrive × (1 + бонус)), счёт целый', () => {
    const bonus = 0.15;
    const near = CENTER + 5 * GAME.hitbox.cube + GAME.player.radius + 1;
    const items = [...chain(TO_OVERDRIVE, 300), crystalAt(300 + 30 * TO_OVERDRIVE, CENTER, true), cubeAt(300 + 30 * TO_OVERDRIVE + 60, near), sawAt(300 + 30 * TO_OVERDRIVE + 120, 10)];
    const sim = run(items, { ...BASE, scoreBonus: bonus });
    const events = runUntil(sim, 300 + 30 * TO_OVERDRIVE + 180);
    const collects = eventsOf(events, 'collect');
    expect(collects[0].points).toBe(score(GAME.score.crystal, 1, false, bonus));
    expect(collects[4].points).toBe(score(GAME.score.crystal, 2, false, bonus));
    expect(collects.at(-1)).toMatchObject({ rare: true, points: score(GAME.score.rareCrystal, MAX, true, bonus) });
    const dodges = eventsOf(events, 'dodge');
    expect(dodges.map((d) => [d.kind, d.near, d.points])).toEqual([
      ['cube', true, score(GAME.score.dodge + GAME.score.nearMiss, MAX, true, bonus)],
      ['saw', false, score(GAME.score.dodge, MAX, true, bonus)],
    ]);
    // Проверяем, что округление действительно работает: 5 × 1.15 = 5.75 → 6.
    expect(score(GAME.score.perBeat, 1, false, bonus)).toBe(6);
    for (const e of [...collects, ...dodges]) expect(Number.isInteger(e.points)).toBe(true);
    expect(Number.isInteger(sim.state.score)).toBe(true);
  });

  it('кристаллы за забег: целая часть без потерь на округлении', () => {
    for (const [count, crystalYield, expected] of [
      [5, 1.2, 6],
      [15, 1.4, 21],
      [5, 1 + 0.2 * 3, 8],
      [35, 1.4, 49],
      [7, 1.2, 8],
    ] as const) {
      const sim = run(chain(count), { ...BASE, crystalYield });
      runUntil(sim, 300 + 30 * count + 30);
      expect(sim.state.crystalsCollected).toBe(count);
      expect(sim.state.runCrystals).toBeCloseTo(count * crystalYield, 9);
      expect(sim.hud().crystals).toBe(expected);
      expect(sim.abandon()!.crystals).toBe(expected);
    }
  });

  it('редкая сфера: крупнее зона подбора, больше валюты', () => {
    const offset = pickupReach(false) + 0.3;
    expect(offset).toBeLessThan(pickupReach(true));
    const sim = run([crystalAt(480, CENTER + offset), crystalAt(540, CENTER + offset, true)]);
    const events = runUntil(sim, 600);
    expect(eventsOf(events, 'miss')).toHaveLength(1);
    expect(eventsOf(events, 'collect')).toEqual([expect.objectContaining({ rare: true, chain: 1, note: 1 })]);
    expect(sim.state.runCrystals).toBe(GAME.crystal.rareCurrency);
  });

  it('HUD: полоска комбо, рекорд и новый объект на каждый вызов', () => {
    const sim = run(chain(6), { ...BASE, highscore: 300 });
    runUntil(sim, 330);
    expect(sim.hud()).toMatchObject({ chain: 2, multiplier: 1, chainProgress: 0.5, highscore: 300, newRecord: false, fps: 0 });
    runUntil(sim, 480);
    const hud = sim.hud();
    expect(hud).toMatchObject({ chain: 6, multiplier: 2, chainProgress: 0.5, newRecord: true });
    expect(hud.highscore).toBe(sim.state.score);
    expect(sim.hud()).not.toBe(hud);
    expect(sim.hud()).toEqual(hud);
  });
});

describe('долгий забег', () => {
  it('20 минут: уровни и доли строго по сетке, состояние не распухает и не портится', () => {
    const MINUTES = 20;
    const until = MINUTES * 60 * TICK_RATE;
    const chart = laneChart(11);
    const input = followLane(chart);
    const sim = new Simulation();
    sim.startRun(11, BASE, chart);
    const levelUps: number[] = [];
    let beats = 0;
    let lastBeat = -LEAD_IN_TICKS - TICKS_PER_BEAT;
    let maxObstacles = 0;
    let maxCrystals = 0;
    while (sim.state.tick < until) {
      sim.step(input(sim.state));
      const s = sim.state;
      for (const e of sim.drainEvents()) {
        if (e.type === 'levelUp') {
          levelUps.push(e.tick);
          expect(e.level).toBe(levelUps.length + 1);
          expect(e.speedMult).toBe(speedMultForLevel(e.level));
        } else if (e.type === 'beat') {
          expect(e.tick - lastBeat).toBe(TICKS_PER_BEAT);
          expect(e.tick % TICKS_PER_BEAT === 0).toBe(true);
          expect(e.level).toBe(1 + Math.max(0, Math.floor(e.tick / TICKS_PER_LEVEL)));
          lastBeat = e.tick;
          beats++;
        } else if (e.type === 'death' || e.type === 'shieldBreak') {
          throw new Error(`корабль на полосе задет на тике ${e.tick} (${e.kind})`);
        }
      }
      if (s.obstacles.length > maxObstacles) maxObstacles = s.obstacles.length;
      if (s.crystals.length > maxCrystals) maxCrystals = s.crystals.length;
      if (s.tick % 4801 === 0) expect(findBadNumber(s)).toBeNull();
    }
    const s = sim.state;
    expect(s.tick).toBe(until);
    expect(s.mode).toBe('playing');
    expect(levelUps).toEqual(Array.from({ length: until / TICKS_PER_LEVEL }, (_, k) => (k + 1) * TICKS_PER_LEVEL));
    // Доли вступления (−4…−1), доля GO и все доли забега.
    expect(beats).toBe(LEAD_IN_TICKS / TICKS_PER_BEAT + 1 + until / TICKS_PER_BEAT);
    expect(s.level).toBe(1 + until / TICKS_PER_LEVEL);
    expect(s.speedMult).toBe(GAME.approach.base / GAME.approach.min);
    expect(s.levelProgress).toBe(0);
    expect(sim.hud().elapsed).toBe(MINUTES * 60);
    expect(maxObstacles).toBeLessThanOrEqual(GAME.limits.obstacles);
    expect(maxCrystals).toBeLessThanOrEqual(GAME.limits.crystals);
    expect(maxObstacles).toBeGreaterThan(8);
    // Объекты на дороге — только свежие: никто не застрял с начала забега.
    for (const o of s.obstacles) expect(o.arriveTick).toBeGreaterThan(until - TICKS_PER_BAR);
    for (const c of s.crystals) expect(c.arriveTick).toBeGreaterThan(until - TICKS_PER_BAR);
    expect(s.overdrive).toBe(true);
    expect(s.crystalsCollected).toBeGreaterThan(MINUTES * 60);
    expect(Number.isSafeInteger(s.score)).toBe(true);
    expect(findBadNumber(s)).toBeNull();
  });

  it('бот-планировщик проходит трек с полосой на всех скоростях, включая предельную', () => {
    // Старт с 15-го уровня не предусмотрен, поэтому бот играет первые 4 уровня и отрезок на пределе скорости.
    const chart = laneChart(4);
    const sim = new Simulation();
    sim.startRun(4, BASE, chart);
    const lane = followLane(chart);
    const fastFrom = 19 * TICKS_PER_LEVEL;
    const input = (state: SimState): InputFrame =>
      state.tick < 4 * TICKS_PER_LEVEL || state.tick >= fastFrom ? planMove(state, { margin: 0.8 }) : lane(state);
    const events = runUntil(sim, fastFrom + TICKS_PER_LEVEL, input);
    expect(eventsOf(events, 'death')).toHaveLength(0);
    expect(sim.state.level).toBe(21);
    expect(sim.state.dodged).toBeGreaterThan(500);
    expect(sim.state.crystalsCollected).toBeGreaterThan(500);
  });
});

describe('фоновая сцена на настоящем треке', () => {
  it.each([1, 2, 3])('зерно %i: автопилот две минуты обходит препятствия и собирает сферы', (seed) => {
    const sim = new Simulation();
    sim.startAttract(seed);
    const s = sim.state;
    const contact = { inRange: false, clear: Infinity };
    const taken = new Set<number>();
    const missed = new Set<number>();
    const kinds = new Set<string>();
    let minClear = Infinity;
    for (let i = 0; i < 120 * TICK_RATE; i++) {
      sim.step(IDLE);
      for (const e of sim.drainEvents()) expect(e.type).toBe('beat');
      const p = s.player;
      for (const o of s.obstacles) {
        kinds.add(o.kind);
        expect(o.approachTicks).toBe(GAME.approach.base);
        contactAt(o, s.tick - 0.5, (p.prevX + p.x) / 2, contact);
        if (contact.inRange) minClear = Math.min(minClear, contact.clear);
        contactAt(o, s.tick, p.x, contact);
        if (contact.inRange) minClear = Math.min(minClear, contact.clear);
      }
      for (const c of s.crystals) {
        if (c.state === 'taken') taken.add(c.id);
        else if (c.state === 'missed') missed.add(c.id);
      }
    }
    expect(kinds.size).toBeGreaterThan(0);
    // Столкновений в фоновой сцене нет, поэтому пролёт сквозь препятствие был бы виден глазом.
    expect(minClear).toBeGreaterThan(1.5);
    expect(taken.size).toBeGreaterThan(50);
    expect(taken.size / (taken.size + missed.size)).toBeGreaterThan(0.8);
    expect(s).toMatchObject({ mode: 'attract', level: 1, speedMult: 1, score: 0 });
    expect(findBadNumber(s)).toBeNull();
  });
});
