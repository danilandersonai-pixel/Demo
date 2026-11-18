/**
 * Бот-планировщик как свидетель честности трека: на треке генератора он не
 * гибнет ни на своей скорости, ни на расчётной скорости честности, а на
 * трудных сценах-сценариях ведёт себя как аккуратный игрок.
 */
import { describe, expect, it } from 'vitest';
import { planMove, type BotOptions } from './bot';
import { contactAt } from './collision';
import { BASE_SIM_LOADOUT, GAME, WORLD } from './config';
import { Simulation } from './sim';
import { holdAt, scriptedChart } from './testkit';
import { TICK_DT, TICKS_PER_LEVEL, TICKS_PER_STEP } from './timing';
import type { ChartItem, ChartSource, CrystalSpec, InputFrame, ObstacleSpec, SimState } from './types';

interface Run {
  sim: Simulation;
  /** Тик гибели или −1. */
  death: number;
  collected: number;
  missed: number;
  /** Наименьший зазор с препятствиями за забег — в обеих пробах столкновения, как их берёт симуляция. */
  minClear: number;
  /** Наибольший сдвиг корабля за тик. */
  maxStep: number;
}

function play(seed: number, untilTick: number, input: (state: SimState) => InputFrame, chart?: ChartSource): Run {
  const sim = new Simulation();
  sim.startRun(seed, BASE_SIM_LOADOUT, chart);
  const run: Run = { sim, death: -1, collected: 0, missed: 0, minClear: Infinity, maxStep: 0 };
  const s = sim.state;
  const contact = { inRange: false, clear: Infinity };
  while (s.tick < untilTick && run.death < 0) {
    sim.step(input(s));
    run.maxStep = Math.max(run.maxStep, Math.abs(s.player.x - s.player.prevX));
    if (s.tick > 0) {
      for (const o of s.obstacles) {
        if (contactAt(o, s.tick, s.player.x, contact).inRange) run.minClear = Math.min(run.minClear, contact.clear);
        if (contactAt(o, s.tick - 0.5, (s.player.x + s.player.prevX) / 2, contact).inRange) run.minClear = Math.min(run.minClear, contact.clear);
      }
    }
    for (const e of sim.drainEvents()) {
      if (e.type === 'death') run.death = e.tick;
      else if (e.type === 'collect') run.collected += 1;
      else if (e.type === 'miss') run.missed += 1;
    }
  }
  return run;
}

function bot(options?: BotOptions): (state: SimState) => InputFrame {
  return (state) => planMove(state, options);
}

function cube(arriveTick: number, x: number, halfW = 6): ObstacleSpec {
  return { kind: 'cube', arriveTick, x, sway: null, halfW, yaw0: 0.6, yawRate: 0.012 };
}

function saw(arriveTick: number, x: number, halfW = 8): ObstacleSpec {
  return { kind: 'saw', arriveTick, x, sway: null, halfW, yaw0: 0, yawRate: 0.08 };
}

function crystal(arriveTick: number, x: number): CrystalSpec {
  return { kind: 'crystal', arriveTick, x, sway: null, rare: false };
}

/** Первый тик такта на сетке шестнадцатых внутри уровня level. */
function tickAt(level: number, step: number): number {
  return (level - 1) * TICKS_PER_LEVEL + step * TICKS_PER_STEP;
}

const CENTER = WORLD.roadW / 2;

// ─── На треке генератора ────────────────────────────────────────────────────

describe('бот на треке генератора', () => {
  it.each([21, 22, 23])('с настройками по умолчанию проходит 12 уровней и собирает сферы (зерно %i)', (seed) => {
    const run = play(seed, 12 * TICKS_PER_LEVEL, bot());
    expect(run.death).toBe(-1);
    expect(run.sim.state.level).toBe(13);
    expect(run.collected / (run.collected + run.missed)).toBeGreaterThan(0.97);
    expect(run.sim.state.maxMultiplier).toBe(GAME.combo.maxMultiplier);
    // Запас по умолчанию 1.2 — цель, а не гарантия; но вплотную бот не проходит.
    expect(run.minClear).toBeGreaterThan(0.6);
    expect(run.maxStep).toBeLessThanOrEqual(110 * TICK_DT + 1e-9);
  });

  it.each([31, 32, 33])('на расчётной скорости честности проходит 10 уровней и собирает сферы (зерно %i)', (seed) => {
    const speed = GAME.fairness.assumedSpeed;
    const run = play(seed, 10 * TICKS_PER_LEVEL, bot({ speed }));
    expect(run.death).toBe(-1);
    expect(run.collected / (run.collected + run.missed)).toBeGreaterThan(0.95);
    expect(run.minClear).toBeGreaterThan(0.6);
    expect(run.maxStep).toBeLessThanOrEqual(speed * TICK_DT + 1e-9);
  });

  it('без сбора сфер просто выживает, почти не двигаясь без нужды', () => {
    const lazy = play(41, 4 * TICKS_PER_LEVEL, bot({ crystals: false }));
    const eager = play(41, 4 * TICKS_PER_LEVEL, bot());
    expect(lazy.death).toBe(-1);
    expect(eager.death).toBe(-1);
    expect(lazy.collected).toBeLessThan(eager.collected);
    expect(eager.collected / (eager.collected + eager.missed)).toBeGreaterThan(0.97);
  });

  it('один и тот же забег дважды — одно и то же (кэш следов препятствий на ответ не влияет)', () => {
    const a = play(51, 2 * TICKS_PER_LEVEL, bot({ margin: 0.8 }));
    const b = play(51, 2 * TICKS_PER_LEVEL, bot({ margin: 0.8 }));
    expect(JSON.stringify(a.sim.state)).toBe(JSON.stringify(b.sim.state));
    // Чередование запасов сбрасывает кэш, но не меняет решений.
    const sim = new Simulation();
    sim.startRun(51, BASE_SIM_LOADOUT);
    while (sim.state.tick < 2 * TICKS_PER_LEVEL) {
      planMove(sim.state, { margin: 1.5 });
      sim.step(planMove(sim.state, { margin: 0.8 }));
    }
    expect(sim.state.player.x).toBe(a.sim.state.player.x);
    expect(sim.state.score).toBe(a.sim.state.score);
  });
});

// ─── Сцены-сценарии ─────────────────────────────────────────────────────────

describe('бот в трудных сценах', () => {
  it('объект прямо в лоб: уходит заранее на любом уровне, из любой точки, с эскортом сфер и без', () => {
    let scenes = 0;
    for (const level of [1, 5, 10, 17]) {
      for (const kind of ['cube', 'saw'] as const) {
        for (const startX of [12.3, CENTER, 61.7, 90]) {
          for (const offset of [-4, 0, 3]) {
            for (const escort of [false, true]) {
              const arrive = tickAt(level, 40 + scenes % 4);
              const x = Math.min(92, Math.max(8, startX + offset));
              const items: ChartItem[] = [kind === 'cube' ? cube(arrive, x, 6.5) : saw(arrive, x)];
              // Сфера сбоку от объекта за восьмую до удара — соблазн задержаться.
              if (escort) items.push(crystal(arrive - 30, x < CENTER ? x + 16 : x - 16));
              const run = play(1, arrive + 40, (state) => (state.tick < arrive - 420 ? holdAt(startX) : planMove(state)), scriptedChart(items));
              expect(run.death, `${kind} L${level} от ${startX} со сдвигом ${offset}`).toBe(-1);
              expect(run.minClear).toBeGreaterThan(1);
              if (escort) expect(run.collected).toBe(1);
              scenes += 1;
            }
          }
        }
      }
    }
    expect(scenes).toBe(192);
  });

  it('не срезает угол: в проход между двумя препятствиями «лесенкой» идёт только когда он открыт', () => {
    // Два широких ряда пил с проходами по разные стороны дороги, через две доли друг от друга.
    for (const level of [4, 9, 14]) {
      const first = tickAt(level, 32);
      const second = first + 120;
      const items: ChartItem[] = [
        saw(first, 8), saw(first, 22), saw(first, 36), saw(first, 50),
        saw(second, 92), saw(second, 78), saw(second, 64), saw(second, 50),
      ];
      const run = play(1, second + 40, (state) => (state.tick < first - 420 ? holdAt(20) : planMove(state)), scriptedChart(items));
      expect(run.death, `уровень ${level}`).toBe(-1);
      expect(run.minClear).toBeGreaterThan(0.6);
      expect(run.sim.state.dodged).toBe(8);
    }
  });

  it('проба на полтика: тонкая пила на предельной скорости не задевает корабль между тиками', () => {
    // За тик пила пролетает 4 единицы при толщине 2.4: целые тики могут «перешагнуть» касание.
    for (let shift = 0; shift < 12; shift++) {
      const arrive = tickAt(18, 20 + shift);
      const items: ChartItem[] = [saw(arrive, CENTER + shift * 0.37, 5 + (shift % 4)), crystal(arrive, CENTER + shift * 0.37 + 14)];
      const run = play(1, arrive + 30, (state) => (state.tick < arrive - 130 ? holdAt(CENTER) : planMove(state, { margin: 0.6 })), scriptedChart(items));
      expect(run.death, `сдвиг ${shift}`).toBe(-1);
      expect(run.minClear).toBeGreaterThan(0);
    }
  });

  it('держит запас, когда места хватает, и жертвует им, когда иначе не пройти', () => {
    const arrive = tickAt(3, 40);
    // Свободная дорога и один куб: запас 3 единицы выдерживается с точностью до половины клетки.
    const roomy = play(1, arrive + 40, (state) => (state.tick < arrive - 300 ? holdAt(CENTER) : planMove(state, { margin: 3 })), scriptedChart([cube(arrive, CENTER)]));
    expect(roomy.death).toBe(-1);
    expect(roomy.minClear).toBeGreaterThan(2.5);
    // Проход между пилами уже, чем корабль плюс два запаса по 3: бот всё равно проходит — по середине.
    const narrow: ChartItem[] = [saw(arrive, 0 + 8), saw(arrive, 22), saw(arrive, 36), saw(arrive, 59), saw(arrive, 73), saw(arrive, 87), saw(arrive, 95)];
    const tight = play(1, arrive + 40, bot({ margin: 3 }), scriptedChart(narrow));
    expect(tight.death).toBe(-1);
    expect(tight.minClear).toBeGreaterThan(0.6);
    expect(tight.minClear).toBeLessThan(3);
    expect(Math.abs(tight.sim.state.player.x - 47.5)).toBeLessThan(2.5);
  });

  it('включается посреди среза и из любого положения корабля', () => {
    const arrive = tickAt(6, 24);
    for (const offset of [1, 2, 3]) {
      for (const x of [33.37, 50.5, 71.93]) {
        const from = arrive - 121 - offset;
        const run = play(1, arrive + 30, (state) => (state.tick < from ? holdAt(x) : planMove(state)), scriptedChart([cube(arrive, x + 1.5), saw(arrive + 30, x - 12)]));
        expect(run.death, `старт за ${121 + offset} тиков из ${x}`).toBe(-1);
        expect(run.minClear).toBeGreaterThan(0.6);
      }
    }
  });

  it('из безвыходной сцены выдаёт осмысленный ввод: без NaN, в пределах дороги, и тянет время', () => {
    const arrive = tickAt(2, 16);
    const wall: ChartItem[] = [0, 1, 2, 3, 4, 5, 6].map((i) => saw(arrive, 8 + i * 14));
    const sim = new Simulation();
    sim.startRun(1, BASE_SIM_LOADOUT, scriptedChart(wall));
    let death = -1;
    while (sim.state.tick < arrive + 30 && death < 0) {
      const input = planMove(sim.state);
      expect(input.source).toBe('pointer');
      expect(Number.isFinite(input.pointerX)).toBe(true);
      expect(Math.abs((input.pointerX ?? 0) - sim.state.player.x)).toBeLessThanOrEqual(110 / GAME.player.pointerFollow + 1e-9);
      sim.step(input);
      for (const e of sim.drainEvents()) if (e.type === 'death') death = e.tick;
    }
    // Стена без окна: гибель неизбежна, но не раньше, чем стена долетит.
    expect(death).toBeGreaterThanOrEqual(arrive - 12);
  });

  it('пустая дорога: стоит на месте, а к далёкой сфере идёт ровно, не быстрее своей скорости', () => {
    const idle = play(1, 600, bot(), scriptedChart([]));
    expect(idle.maxStep).toBe(0);
    expect(idle.sim.state.player.x).toBe(CENTER);
    const far = play(1, 700, bot({ speed: 60 }), scriptedChart([crystal(600, 86)]));
    expect(far.collected).toBe(1);
    expect(far.maxStep).toBeLessThanOrEqual(60 * TICK_DT + 1e-9);
    expect(far.maxStep).toBeGreaterThan(0);
  });

  it('горизонт планирования настраивается: близорукий бот видит только ближние объекты', () => {
    const arrive = tickAt(1, 32);
    const items: ChartItem[] = [crystal(arrive, 80)];
    const sim = new Simulation();
    sim.startRun(1, BASE_SIM_LOADOUT, scriptedChart(items));
    while (sim.state.tick < arrive - 200) sim.step(holdAt(CENTER));
    // Сфера уже на дороге (до неё 200 тиков), но за горизонтом в 100 тиков бот её не замечает.
    expect(sim.state.crystals).toHaveLength(1);
    expect(planMove(sim.state, { horizonTicks: 100 }).pointerX).toBe(CENTER);
    expect(planMove(sim.state, { horizonTicks: 320 }).pointerX).toBeGreaterThan(CENTER);
  });
});

// ─── Цена вызова ────────────────────────────────────────────────────────────

describe('цена вызова planMove', () => {
  it('планировщик достаточно дёшев, чтобы работать каждый тик', () => {
    // Сторож от регресса на порядок: порог щедрый, машина с тестами бывает занята.
    const sim = new Simulation();
    sim.startRun(61, BASE_SIM_LOADOUT);
    let calls = 0;
    const from = performance.now();
    while (sim.state.tick < 2 * TICKS_PER_LEVEL) {
      sim.step(planMove(sim.state));
      calls += 1;
    }
    const perCall = (performance.now() - from) / calls;
    expect(sim.state.player.alive).toBe(true);
    expect(perCall).toBeLessThan(1.5);
  });
});
