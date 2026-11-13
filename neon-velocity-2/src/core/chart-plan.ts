/**
 * Композитор трека — «дизайнер уровней». Трек пишется как музыка, фразами:
 * уровень скорости — это восемь тактов со своей драматургией
 * (вступление → развитие → пик → передышка → разгон к дропу).
 *
 * На каждый такт композитор:
 *  1) продлевает замысел линии мелодии (Contour);
 *  2) раздаёт такту бюджет препятствий по кривой плотности уровня и выбирает
 *     форму — сочетание именованных паттернов на ритмической сетке;
 *  3) исполняет удары строго в порядке прилёта — каждый проходит проверку
 *     коридора честности;
 *  4) прокладывает через получившийся такт идеальную линию и нанизывает на неё
 *     цепочку сфер.
 *
 * Случайность такта — отдельный поток root.fork(bar); всё остальное состояние
 * (коридор, линия, план уровня) зависит только от предыдущих тактов.
 */
import { Corridor, type CorridorStats } from './chart-corridor';
import { Contour, LINE_MAX, LINE_MIN, MelodyLine } from './chart-melody';
import {
  barrier,
  dropGate,
  funnel,
  kindWeight,
  laserGate,
  MAX_OBSTACLES_PER_BAR,
  MAX_ROLL,
  pair,
  roll,
  sawWall,
  single,
  slalom,
  stairs,
  Stage,
  syncopation,
  threatens,
} from './chart-patterns';
import { GAME, OBSTACLES } from './config';
import { clamp } from './math';
import { createRng, type Rng } from './rng';
import { barInLevel, barStartTick, levelAtTick, TICK_RATE, TICKS_PER_BAR, TICKS_PER_LEVEL, TICKS_PER_STEP } from './timing';
import type { ChartItem, ChartOptions, CrystalSpec, ObstacleKind, ObstacleSpec } from './types';

// ─── Драматургия уровня ─────────────────────────────────────────────────────

export type Role = 'intro' | 'develop' | 'peak' | 'breather' | 'buildup';

/** Роль каждого из восьми тактов уровня. */
export const BAR_ROLES: readonly Role[] = ['intro', 'intro', 'develop', 'develop', 'peak', 'peak', 'breather', 'buildup'];

export const MAX_CRYSTALS_PER_BAR = 16;

/** Целевая плотность уровня, препятствий в секунду: ≈1 на первом, ≈1.9 на шестом, ≈2.8 с двенадцатого. */
export function densityForLevel(level: number): number {
  return Math.min(1.02 + 0.175 * (Math.max(1, level) - 1), 2.9);
}

/** Доля бюджета уровня, которая достаётся такту с этой ролью. */
const ROLE_SHARE: Record<Role, number> = { intro: 0.9, develop: 1.12, peak: 1.42, breather: 0.1, buildup: 1.2 };
/** Сколько непоставленных препятствий такт может передать следующему. */
const MAX_CARRY = 2;
/** С какого уровня удары встают на шестнадцатые (нечётные шаги сетки). */
const SIXTEENTH_LEVEL = 5;
/** После ворот дропа такту дают отдышаться: следующие удары не раньше этого шага. */
const AFTER_DROP_STEP = 6;
/** Ворота дропа не ставятся у самого бортика. */
const DROP_MIN = 26;
const DROP_MAX = 74;
/** Уровень, по которому берутся параметры объектов фоновой сцены меню. */
const ATTRACT_LEVEL = 3;
const LEVEL_SALT = 0x4c56;
/** Ранний «затакт»: за сколько шагов до удара сфера уводит игрока из-под препятствия. */
const PICKUP_LEAD = 2;
/** За какое время до и после удара следить, не подходит ли линия мелодии к полосе препятствия, тики. */
const WATCH_BEFORE = TICKS_PER_BAR / 2;
const WATCH_AFTER = TICKS_PER_BAR;

// ─── Ритмы ──────────────────────────────────────────────────────────────────

/** Готовые ритмические рисунки по числу ударов в такте (шаги — шестнадцатые, 0…15). */
const RHYTHMS: readonly (readonly (readonly number[])[])[] = [
  [],
  [[8], [4], [12], [6]],
  [[0, 8], [4, 12], [4, 10], [2, 10], [0, 6], [6, 12]],
  [[0, 6, 12], [0, 4, 8], [4, 8, 12], [0, 8, 12], [2, 8, 14], [4, 10, 14]],
  [[0, 4, 8, 12], [0, 6, 8, 14], [0, 4, 8, 10], [2, 6, 10, 14], [0, 3, 6, 12], [0, 6, 10, 12]],
  [[0, 4, 8, 10, 12], [0, 3, 6, 8, 12], [0, 4, 6, 8, 12], [0, 4, 8, 12, 14], [0, 3, 6, 10, 13], [2, 6, 8, 12, 14]],
  [[0, 3, 6, 8, 11, 14], [0, 4, 6, 8, 12, 14], [0, 2, 4, 8, 10, 12], [0, 2, 6, 8, 10, 14]],
  [[0, 2, 4, 6, 8, 10, 12], [0, 2, 4, 8, 10, 12, 14], [0, 3, 6, 8, 10, 12, 14], [0, 2, 4, 6, 8, 11, 14]],
  [[0, 2, 4, 6, 8, 10, 12, 14], [0, 3, 6, 8, 10, 11, 12, 14]],
];

const ALL_STEPS = Array.from({ length: 16 }, (_, step) => step);

/** Музыкальный вес шага: сильные доли, слабые доли, восьмые, шестнадцатые. */
function accent(step: number): number {
  return step % 8 === 0 ? 10 : step % 4 === 0 ? 7 : step % 2 === 0 ? 4 : 1.5;
}

/** Ритм из count ударов на разрешённых шагах: готовый рисунок, а если ни один не подходит — по весам долей. */
function rhythm(rng: Rng, count: number, level: number, allowed: (step: number) => boolean): number[] {
  const usable = (step: number) => allowed(step) && (step % 2 === 0 || level >= SIXTEENTH_LEVEL);
  const templates = (RHYTHMS[count] ?? []).filter((template) => template.every(usable));
  if (templates.length > 0) return [...rng.pick(templates)];
  const pool = ALL_STEPS.filter(usable);
  const steps: number[] = [];
  while (steps.length < count && pool.length > 0) {
    const step = rng.weighted(pool, accent);
    steps.push(step);
    pool.splice(pool.indexOf(step), 1);
  }
  return steps.sort((a, b) => a - b);
}

// ─── Цепочки сфер ───────────────────────────────────────────────────────────

/** Первый такт забега: две пустые доли, затем первая фраза мелодии. */
const OPENING_CHAIN: readonly number[] = [8, 10, 12, 14];

/** Рисунки цепочек по ролям: восьмые, в передышке и на пике — с пробежками шестнадцатых. */
const CHAINS: Record<Role, readonly (readonly number[])[]> = {
  intro: [
    [0, 2, 4, 6, 8, 10],
    [4, 6, 8, 10, 12, 14],
    [2, 4, 6, 8, 10, 12, 14],
    [0, 2, 4, 6, 8, 10, 12, 14],
  ],
  develop: [
    [0, 2, 4, 6],
    [8, 10, 12, 14],
    [4, 6, 8, 10, 12],
    [0, 2, 4, 6, 8],
    [6, 8, 10, 12, 14],
  ],
  peak: [
    [2, 4, 6, 8],
    [6, 8, 10, 12],
    [0, 2, 4, 6],
    [8, 10, 12, 14],
    [8, 9, 10, 11, 12, 13],
  ],
  breather: [
    [0, 2, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15],
    [0, 1, 2, 3, 4, 6, 8, 10, 12, 13, 14, 15],
    [0, 2, 4, 5, 6, 7, 8, 10, 12, 13, 14, 15],
    [0, 2, 4, 6, 8, 10, 12, 13, 14, 15],
  ],
  buildup: [
    [0, 2, 4, 6],
    [2, 4, 6, 8, 10],
    [6, 8, 10, 12, 14],
    [4, 6, 8, 10],
  ],
};

// ─── Формы тактов ───────────────────────────────────────────────────────────

type FormId = 'scatter' | 'gate' | 'stairs' | 'pairs' | 'barrier' | 'slalom' | 'sync' | 'wall' | 'stairsDuo' | 'portals' | 'roll' | 'funnel' | 'rest';

interface FormContext {
  stage: Stage;
  rng: Rng;
  /** Сколько препятствий форма должна поставить. */
  budget: number;
  /** Первый шаг, с которого можно ставить удары. */
  from: number;
  /** Точка будущих ворот дропа (нужна разгону). */
  gateX: number;
}

/** Удар: шаг сетки и действие. Удары такта исполняются по возрастанию шага — в порядке прилёта. */
interface Hit {
  step: number;
  run: () => void;
}

type Form = (ctx: FormContext) => Hit[];

/** Одиночные объекты на ритме из count ударов. */
function singles(ctx: FormContext, count: number, allowed: (step: number) => boolean): Hit[] {
  const { stage, rng } = ctx;
  return rhythm(rng, count, stage.level, (step) => step >= ctx.from && allowed(step)).map((step) => ({ step, run: () => void single(stage, step) }));
}

const FORMS: Record<FormId, Form> = {
  /** Россыпь одиночных объектов; на сильной доле иногда — пара или лазерные ворота. */
  scatter(ctx) {
    const { stage, rng, budget } = ctx;
    const withPair = stage.level >= 3 && budget >= 3 && rng.chance(0.4);
    const solid = kindWeight('cube', stage.level) + kindWeight('saw', stage.level);
    const laser = kindWeight('laser', stage.level);
    const withGate = rng.chance(laser / (solid + laser));
    const steps = rhythm(rng, withPair ? budget - 1 : budget, stage.level, (step) => step >= ctx.from);
    const strong = steps.filter((step) => step % 4 === 0);
    const pairStep = withPair && strong.length > 0 ? rng.pick(strong) : -1;
    const gateSteps = strong.filter((step) => step !== pairStep);
    const gateStep = withGate && gateSteps.length > 0 ? rng.pick(gateSteps) : -1;
    return steps.map((step) => ({
      step,
      run: () => {
        if (step === pairStep) pair(stage, step);
        else if (step !== gateStep || laserGate(stage, step) === 0) single(stage, step);
      },
    }));
  },

  /** Лазерные ворота на сильной доле и одиночные объекты поодаль от них. */
  gate(ctx) {
    const { stage, rng, budget } = ctx;
    if (budget < 1) return [];
    const gateStep = rng.pick([8, 8, 4, 12].filter((step) => step >= ctx.from));
    const rest = singles(ctx, budget - 1, (step) => Math.abs(step - gateStep) >= 4);
    return [...rest, { step: gateStep, run: () => void laserGate(stage, gateStep) }];
  },

  /** «Лесенка» по восьмым и одиночные объекты вне её. */
  stairs(ctx) {
    const { stage, rng, budget } = ctx;
    const count = Math.min(budget, stage.level >= 3 ? 4 : 3);
    const starts = [0, 2, 8].filter((step) => step >= ctx.from && step + 2 * (count - 1) <= 14);
    if (count < 3 || starts.length === 0) return FORMS.scatter(ctx);
    const start = rng.pick(starts);
    const end = start + 2 * (count - 1);
    const rest = singles(ctx, budget - count, (step) => step < start - 2 || step > end + 2);
    return [...rest, { step: start, run: () => void stairs(stage, start, count) }];
  },

  /** Пары с проходом на долях. */
  pairs(ctx) {
    const { stage, rng, budget } = ctx;
    if (budget < 2) return FORMS.scatter(ctx);
    const count = clamp(Math.floor(budget / 2), 1, 3);
    const steps = rhythm(rng, count, stage.level, (step) => step % 4 === 0 && step >= ctx.from);
    const rest = singles(ctx, budget - 2 * steps.length, (step) => steps.every((at) => Math.abs(step - at) >= 3));
    return [...rest, ...steps.map((step) => ({ step, run: () => void pair(stage, step) }))];
  },

  /** Барьер из пил поперёк линии мелодии. */
  barrier(ctx) {
    const { stage, rng, budget } = ctx;
    if (budget < 2) return FORMS.scatter(ctx);
    const size = Math.min(3, budget);
    const at = rng.pick([4, 8, 12].filter((step) => step >= ctx.from));
    const rest = singles(ctx, budget - size, (step) => Math.abs(step - at) >= 4);
    return [...rest, { step: at, run: () => void barrier(stage, at, size) }];
  },

  /** Слалом: по долям, а когда бюджет больше — по восьмым. */
  slalom(ctx) {
    const { stage, rng, budget } = ctx;
    const stride = budget <= 4 ? 4 : 2;
    const first = Math.ceil(ctx.from / stride) * stride;
    const last = stride === 4 ? 12 : 14;
    const count = Math.min(budget, Math.floor((last - first) / stride) + 1);
    if (count < 3) return FORMS.scatter(ctx);
    const start = first + stride * rng.int(0, Math.floor((last - first) / stride) + 1 - count);
    const steps = Array.from({ length: count }, (_, i) => start + stride * i);
    return [{ step: start, run: () => void slalom(stage, steps, { kind: rng.chance(0.25) ? 'saw' : 'cube' }) }];
  },

  /** Синкопы на шестнадцатых. */
  sync(ctx) {
    const { stage, budget } = ctx;
    if (budget < 4) return FORMS.scatter(ctx);
    return [{ step: ctx.from, run: () => void syncopation(stage, Math.min(budget, 6), ctx.from) }];
  },

  /** Стена из пил с окном (при большом бюджете — две), перед ней и после — одиночные объекты. */
  wall(ctx) {
    const { stage, budget } = ctx;
    if (budget < 5 || ctx.from > 0) return FORMS.slalom(ctx);
    const walls = budget >= 10 ? [4, 12] : [8];
    const extra = budget >= 10 ? [0, 8] : [0, 4, 14];
    const hits: Hit[] = walls.map((step) => ({ step, run: () => void sawWall(stage, step) }));
    for (const step of extra.slice(0, budget - 5 * walls.length)) hits.push({ step, run: () => void single(stage, step) });
    return hits;
  },

  /** Две лесенки навстречу друг другу — «зубцы». */
  stairsDuo(ctx) {
    const { stage, rng, budget } = ctx;
    if (budget < 5 || ctx.from > 0) return FORMS.stairs(ctx);
    const direction = rng.chance(0.5) ? 1 : -1;
    const first = Math.min(4, Math.ceil(budget / 2));
    const second = Math.min(4, Math.floor(budget / 2));
    return [
      { step: 0, run: () => void stairs(stage, 0, first, direction) },
      { step: 8, run: () => void stairs(stage, 8, second, direction === 1 ? -1 : 1) },
    ];
  },

  /** «Порталы»: пары на долях, проходы которых стоят по разные стороны от линии. */
  portals(ctx) {
    const { stage, rng, budget } = ctx;
    if (budget < 4 || ctx.from > 0) return FORMS.pairs(ctx);
    const count = Math.min(4, Math.floor(budget / 2));
    const steps = count === 2 ? rng.pick([[0, 8], [4, 12]]) : count === 3 ? [0, 6, 12] : [0, 4, 8, 12];
    const swing = rng.range(6, 11);
    let side = rng.chance(0.5) ? 1 : -1;
    return steps.map((step) => {
      const offset = side * swing;
      side = -side;
      return { step, run: () => void pair(stage, step, { center: stage.line(stage.tickOf(step)) + offset, sway: 'never' }) };
    });
  },

  /** Разгон к дропу: нарастающий ряд и столбы у будущих ворот. */
  roll(ctx) {
    const { stage, budget } = ctx;
    return [{ step: 0, run: () => void roll(stage, Math.min(budget, MAX_ROLL), ctx.gateX) }];
  },

  /** Разгон к дропу: сходящийся коридор из пар. */
  funnel(ctx) {
    const { stage, budget } = ctx;
    if (budget < 6) return FORMS.roll(ctx);
    return [{ step: 0, run: () => void funnel(stage, ctx.gateX, clamp(Math.floor(budget / 2), 3, 4)) }];
  },

  /** Передышка: разве что один-два объекта в стороне от змейки сфер. */
  rest(ctx) {
    const { stage, budget } = ctx;
    const steps = budget >= 2 ? [4, 12] : budget === 1 ? [8] : [];
    return steps.map((step) => ({ step, run: () => void single(stage, step, { aim: 'far' }) }));
  },
};

function pickForm(rng: Rng, options: ReadonlyArray<readonly [FormId, number]>, exclude: FormId | null): FormId {
  return rng.weighted(
    options.filter(([id]) => id !== exclude),
    ([, weight]) => weight,
  )[0];
}

function developForms(level: number): ReadonlyArray<readonly [FormId, number]> {
  return [
    ['stairs', 3],
    ['pairs', 3],
    ['scatter', 1.5],
    ['barrier', level >= 2 ? kindWeight('saw', level) * 0.6 : 0],
    ['gate', level >= 3 ? kindWeight('laser', level) * 0.6 : 0],
  ];
}

function peakForms(level: number): ReadonlyArray<readonly [FormId, number]> {
  return [
    ['slalom', 5],
    ['stairsDuo', 3],
    ['portals', 3],
    ['wall', level >= 3 ? kindWeight('saw', level) * 0.7 : 0],
    ['sync', level >= SIXTEENTH_LEVEL ? 1.5 + 0.8 * (level - SIXTEENTH_LEVEL) : 0],
  ];
}

// ─── Фоновая сцена меню ─────────────────────────────────────────────────────

/** Четыре такта, которые повторяются по кругу: редкие объекты и короткие цепочки сфер. */
const ATTRACT_SCENES: ReadonlyArray<{ chain: readonly number[]; run: (stage: Stage) => void }> = [
  { chain: [0, 2, 4, 6], run: (stage) => void single(stage, 8, { aim: 'side' }) },
  { chain: [8, 10, 12, 14], run: (stage) => void pair(stage, 4) },
  {
    chain: [4, 6, 8],
    run: (stage) => {
      single(stage, 0, { kind: 'saw', aim: 'line' });
      single(stage, 10, { kind: 'cube', aim: 'side' });
    },
  },
  { chain: [4, 6, 8, 10, 12], run: (stage) => void laserGate(stage, 8) },
];

// ─── Композитор ─────────────────────────────────────────────────────────────

/** План уровня: бюджет и форма каждого такта, плюс то, что уровень уже успел показать. */
interface LevelPlan {
  level: number;
  budgets: number[];
  forms: FormId[];
  carry: number;
  swayed: number;
  kinds: Record<ObstacleKind, number>;
}

/** Такт, в котором препятствия уже расставлены, а сферы ещё нет. */
interface Staged {
  stage: Stage;
  rng: Rng;
  /** Рисунок цепочки сфер (шаги сетки). */
  chain: readonly number[];
}

export class Composer {
  private readonly root: Rng;
  private readonly corridor = new Corridor();
  private readonly contour = new Contour();
  private readonly line = new MelodyLine();
  private plan: LevelPlan | null = null;
  /** Ворота дропа, обещанные разгоном прошлого такта. */
  private drop: { x: number; portal: boolean } | null = null;
  /** Куда сейчас «идёт» линия мелодии: −1 влево, 1 вправо. */
  private heading: number;
  /** Следующий такт: его препятствия ставятся на такт раньше сфер, чтобы линия мелодии видела их заранее. */
  private ahead: Staged | null = null;

  constructor(
    seed: number,
    private readonly options: ChartOptions,
  ) {
    this.root = createRng(seed);
    this.heading = this.root.fork(LEVEL_SALT).chance(0.5) ? 1 : -1;
  }

  get stats(): CorridorStats {
    return this.corridor.stats;
  }

  /** Сочинить такт. Такты запрашиваются строго по порядку, каждый один раз. */
  compose(bar: number): ChartItem[] {
    const current = this.ahead ?? this.stageBar(bar);
    this.ahead = this.stageBar(bar + 1);
    const crystals = this.layCrystals(current, this.ahead);
    const items: ChartItem[] = [...current.stage.obstacles, ...crystals];
    // Сортировка устойчивая: сферы идут по времени, и симуляция раздаёт им ноты по порядку.
    return items.sort((a, b) => a.arriveTick - b.arriveTick);
  }

  /** Расставить препятствия такта и выбрать рисунок его мелодии. */
  private stageBar(bar: number): Staged {
    const barStart = barStartTick(bar);
    const rng = this.root.fork(bar);
    this.corridor.advance(barStart);
    return this.options.attract ? this.stageAttract(bar, barStart, rng) : this.stageRun(bar, barStart, rng);
  }

  private stageRun(bar: number, barStart: number, rng: Rng): Staged {
    const level = levelAtTick(barStart);
    const slot = barInLevel(bar);
    const role = BAR_ROLES[slot];
    if (!this.plan || this.plan.level !== level) this.plan = this.planLevel(level);
    const plan = this.plan;
    const gateX = this.shapeLine(rng, role, bar);
    const stage = new Stage(rng, this.corridor, this.contour, barStart, level);

    if (bar >= GAME.firstObstacleBar) {
      const planned = Math.min(plan.budgets[slot] + plan.carry, MAX_OBSTACLES_PER_BAR - 1);
      let budget = planned;
      let from = 0;
      const hits: Hit[] = [];
      const drop = this.drop;
      this.drop = null;
      if (drop) {
        hits.push({ step: 0, run: () => void dropGate(stage, drop.x, drop.portal) });
        budget -= drop.portal ? 2 : 1;
        from = AFTER_DROP_STEP;
      }
      // Обязательная программа уровня: зигзаг, оба вида «твёрдых» объектов и лазерные ворота.
      stage.wantSway = level >= GAME.sway.startLevel && plan.swayed === 0 && slot >= 2;
      if (slot >= 3) stage.wantKind = plan.kinds.saw === 0 ? 'saw' : plan.kinds.cube === 0 ? 'cube' : null;
      const owesLaser = level >= OBSTACLES.laser.minLevel && plan.kinds.laser === 0 && (role === 'develop' || role === 'peak');
      const form = owesLaser ? 'gate' : plan.forms[slot];
      hits.push(...FORMS[form]({ stage, rng, budget: Math.max(0, budget), from, gateX }));
      hits.sort((a, b) => a.step - b.step);
      for (const hit of hits) hit.run();

      if (role === 'buildup') this.drop = { x: gateX, portal: level + 1 >= 3 && rng.chance(0.3) };
      if (role !== 'breather') plan.carry = clamp(planned - stage.obstacles.length, 0, MAX_CARRY);
      for (const spec of stage.obstacles) {
        plan.kinds[spec.kind] += 1;
        if (spec.sway) plan.swayed += 1;
      }
    }
    return { stage, rng, chain: bar === 0 ? OPENING_CHAIN : rng.pick(CHAINS[role]) };
  }

  private stageAttract(bar: number, barStart: number, rng: Rng): Staged {
    const mid = this.leg(rng, this.contour.end, 6, 18, rng.chance(0.6));
    this.contour.extend(mid, this.leg(rng, mid, 6, 18, rng.chance(0.6)));
    const stage = new Stage(rng, this.corridor, this.contour, barStart, ATTRACT_LEVEL);
    const scene = ATTRACT_SCENES[bar % ATTRACT_SCENES.length];
    if (bar >= GAME.firstObstacleBar) scene.run(stage);
    return { stage, rng, chain: bar === 0 ? OPENING_CHAIN : scene.chain };
  }

  /** Бюджеты и формы тактов уровня. Зависит только от зерна и номера уровня. */
  private planLevel(level: number): LevelPlan {
    const rng = this.root.fork(LEVEL_SALT + level);
    const total = (densityForLevel(level) * TICKS_PER_LEVEL) / TICK_RATE;
    // В первом уровне такты до firstObstacleBar пусты — их доля достаётся остальным.
    const shares = BAR_ROLES.map((role, slot) => (level === 1 && slot < GAME.firstObstacleBar ? 0 : ROLE_SHARE[role]));
    const sum = shares.reduce((a, b) => a + b, 0);
    // Дробные бюджеты округляются с переносом остатка: сумма по уровню сходится с целью.
    let rest = rng.next();
    const budgets = shares.map((share) => {
      rest += (total * share) / sum;
      const whole = Math.floor(rest);
      rest -= whole;
      return whole;
    });

    const develop = level >= OBSTACLES.laser.minLevel ? 'gate' : pickForm(rng, developForms(level), null);
    const peak = pickForm(rng, peakForms(level), null);
    const forms: FormId[] = [
      'scatter',
      'scatter',
      develop,
      pickForm(rng, developForms(level), develop),
      peak,
      // Второй такт пика либо повторяет первый (фраза и её ответ), либо контрастирует.
      rng.chance(0.45) ? peak : pickForm(rng, peakForms(level), peak),
      'rest',
      level >= 3 && rng.chance(0.5) ? 'funnel' : 'roll',
    ];
    return { level, budgets, forms, carry: 0, swayed: 0, kinds: { cube: 0, saw: 0, laser: 0 } };
  }

  /** Продлить замысел линии на такт. Возвращает точку ворот дропа (нужна только разгону). */
  private shapeLine(rng: Rng, role: Role, bar: number): number {
    const from = this.contour.end;
    if (bar === 0) {
      // Первые две доли забега пусты — линия ждёт в центре.
      this.contour.extend(from, this.leg(rng, from, 8, 16, false));
    } else if (role === 'breather') {
      // Передышка — широкая ровная «змейка».
      const mid = this.leg(rng, from, 16, 26, true);
      this.contour.extend(mid, this.leg(rng, mid, 18, 28, true));
    } else if (role === 'buildup') {
      const gateX = clamp(from + rng.range(-22, 22), DROP_MIN, DROP_MAX);
      this.contour.extend((from + gateX) / 2 + rng.range(-8, 8), gateX);
    } else {
      const mid = this.leg(rng, from, 8, 22, rng.chance(0.6));
      this.contour.extend(mid, this.leg(rng, mid, 8, 22, rng.chance(0.6)));
    }
    return this.contour.end;
  }

  /** Следующая опорная точка линии: шаг в текущую сторону (turn — сначала развернуться), с отражением от краёв. */
  private leg(rng: Rng, from: number, min: number, max: number, turn: boolean): number {
    if (turn) this.heading = -this.heading;
    let to = from + this.heading * rng.range(min, max);
    if (to < LINE_MIN || to > LINE_MAX) {
      this.heading = -this.heading;
      to = from + this.heading * rng.range(min, max);
    }
    return clamp(to, LINE_MIN, LINE_MAX);
  }

  /**
   * Нанизать сферы такта на идеальную линию. Линия прокладывается через
   * препятствия этого и следующего тактов, так что мелодия заранее уводит от
   * того, что прилетит за тактовой чертой.
   */
  private layCrystals(current: Staged, next: Staged): CrystalSpec[] {
    const { stage, rng } = current;
    const crystals: CrystalSpec[] = [];
    const lures = [...stage.lures, ...next.stage.lures];
    if (!this.line.trace(this.corridor, this.contour, lures, stage.barStart)) return crystals;
    for (const step of this.melodySteps(current, next)) {
      const tick = stage.tickOf(step);
      const x = this.line.at(tick);
      // Жребий бросается всегда: рисунок трека не должен зависеть от шанса редкой сферы.
      const rare = rng.chance(this.options.rareChance);
      if (x === null || !this.corridor.addCrystal(tick, x)) continue;
      crystals.push({ kind: 'crystal', arriveTick: tick, x, sway: null, rare });
    }
    return crystals;
  }

  /**
   * Шаги сфер такта: цепочка плюс «затакты» — ноты-подсказки перед ударами.
   * Если линия мелодии проходит мимо препятствия вплотную или пересекает его
   * полосу, за шестнадцатую до удара ставится сфера: она лежит уже на
   * безопасной стороне и удерживает там, пока объект не пролетит. Если линии
   * пришлось уходить из-под удара, ещё одна сфера раньше показывает, куда.
   */
  private melodySteps(current: Staged, next: Staged): number[] {
    const { stage } = current;
    const steps = new Set(current.chain);
    const add = (step: number) => {
      if (step >= 0 && step < 16 && steps.size < MAX_CRYSTALS_PER_BAR) steps.add(step);
    };
    // Удары этого такта и начала следующего: их затакты попадают в этот такт.
    const hits = [...stage.obstacles, ...next.stage.obstacles]
      .map((spec) => ({ spec, step: (spec.arriveTick - stage.barStart) / TICKS_PER_STEP }))
      .filter((hit) => hit.step >= 1 && hit.step <= 16 + PICKUP_LEAD)
      .sort((a, b) => a.step - b.step);
    for (const { spec, step } of hits) {
      const tick = spec.arriveTick;
      if (!this.lineNear(spec, tick - WATCH_BEFORE, tick + WATCH_AFTER)) continue;
      add(step - 1);
      if (this.lineNear(spec, tick - WATCH_BEFORE, tick - PICKUP_LEAD * TICKS_PER_STEP)) add(step - PICKUP_LEAD);
    }
    return [...steps].sort((a, b) => a - b);
  }

  /** Линия мелодии в этом промежутке времени заходит в полосу препятствия (или проходит вплотную). */
  private lineNear(spec: ObstacleSpec, fromTick: number, toTick: number): boolean {
    for (let tick = fromTick; tick <= toTick; tick += TICKS_PER_STEP) {
      const x = this.line.at(tick);
      if (x !== null && threatens(spec, x)) return true;
    }
    return false;
  }
}
