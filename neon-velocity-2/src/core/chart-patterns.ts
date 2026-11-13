/**
 * Библиотека паттернов трека. Паттерн — именованная фигура из препятствий
 * («пара с проходом», «лесенка», «стена с окном» …), которую уровень ставит на
 * сетку шестнадцатых. Паттерны не решают, честны ли они сами: каждая группа
 * объектов предъявляется коридору (Stage.put → Corridor.place), и при отказе
 * паттерн чинит себя — снимает зигзаг, уменьшает объект, расширяет проход,
 * сдвигается — либо уступает место более простой фигуре.
 *
 * Все функции возвращают число поставленных препятствий.
 */
import { CELL, GOLD_PAD, MARGIN, type Corridor } from './chart-corridor';
import type { Contour, Lure } from './chart-melody';
import { GAME, laserHalfGapForLevel, OBSTACLES, swayAmp, swayChance, swayPeriodTicks, WORLD } from './config';
import { approachFor, makeObstacle } from './entities';
import { clamp, lerp, TAU } from './math';
import type { Rng } from './rng';
import { TICK_RATE, TICKS_PER_EIGHTH, TICKS_PER_STEP } from './timing';
import type { Obstacle, ObstacleKind, ObstacleSpec, Sway } from './types';

export const MAX_OBSTACLES_PER_BAR = 12;

const ROAD = WORLD.roadW;
const SHIP = GAME.player.radius;
/** Верхняя граница половины прохода лазерных ворот (шире — уже не препятствие). */
const LASER_HALF_MAX = 22;
/** Зигзаг с меньшей амплитудой не читается — проще лететь прямо. */
const MIN_SWAY_AMP = 3;
/** Какую долю свободного места до бортика занимает урезанный зигзаг. */
const FIT_INSET = 0.98;
/**
 * Доля шанса зигзага у фигур, где он спорит с замыслом: пара качается целиком,
 * проход ворот уезжает из-под корабля, столбы слалома и ступени лесенки стоят
 * в расчёте на ровный коридор. Одиночный объект берёт шанс уровня полностью.
 */
const PAIR_SWAY = 0.8;
const GATE_SWAY = 0.6;
const STAIRS_SWAY = 0.6;
const POST_SWAY = 0.5;
/** Шаг между центрами пил в стене относительно диаметра: диски слегка перекрываются. */
const WALL_PITCH = 0.94;

/** Вес выбора вида препятствия на уровне (0 — ещё не появляется). */
export function kindWeight(kind: ObstacleKind, level: number): number {
  const preset = OBSTACLES[kind];
  return level < preset.minLevel ? 0 : preset.weight + preset.weightPerLevel * (level - preset.minLevel);
}

/** Худшая полуширина хитбокса по X (куб — с учётом поворота). */
export function reachOf(spec: Pick<ObstacleSpec, 'kind' | 'halfW'>): number {
  return spec.kind === 'cube' ? spec.halfW * GAME.hitbox.cube * Math.SQRT2 : spec.halfW * GAME.hitbox.saw;
}

/** Ближе этого к центру объекта корабль не проходит (с запасом честности). */
function blockOf(spec: Pick<ObstacleSpec, 'kind' | 'halfW'>): number {
  return reachOf(spec) + SHIP + MARGIN;
}

/** Объект заденет корабль, который ждёт его в точке x (с запасом в пару корпусов). */
export function threatens(spec: ObstacleSpec, x: number): boolean {
  const pad = SHIP + 0.5;
  if (spec.kind === 'laser') return Math.abs(x - spec.x) > spec.halfW - SHIP * GAME.hitbox.laserPlayer - MARGIN - pad;
  return Math.abs(x - spec.x) < blockOf(spec) + pad;
}

/** Есть ли на отрезке углов [from, to] точка peak + 2πk (там синус достигает экстремума). */
function passesPeak(from: number, to: number, peak: number): boolean {
  return Math.floor((to - peak) / TAU) > Math.floor((from - peak) / TAU) || (from - peak) % TAU === 0;
}

/**
 * Подогнать зигзаг под дорогу: объект целиком остаётся на полотне весь полёт,
 * от появления до ухода за корабль. approach — время подлёта (по умолчанию —
 * по уровню прилёта). null — места для заметного зигзага нет.
 */
export function fitSway(spec: Pick<ObstacleSpec, 'arriveTick' | 'x' | 'halfW'>, sway: Sway, approach = approachFor(spec.arriveTick)): Sway | null {
  const tail = Math.max(Math.ceil((WORLD.zBehind / WORLD.zFar) * approach), TICKS_PER_EIGHTH);
  // Размах синуса за весь полёт — по углам его начала и конца, без перебора тиков.
  const from = sway.phase - (TAU * approach) / sway.periodTicks;
  const to = sway.phase + (TAU * tail) / sway.periodTicks;
  const rest = Math.sin(sway.phase);
  const top = passesPeak(from, to, Math.PI / 2) ? 1 : Math.max(Math.sin(from), Math.sin(to));
  const bottom = passesPeak(from, to, -Math.PI / 2) ? -1 : Math.min(Math.sin(from), Math.sin(to));
  const min = sway.amp * (bottom - rest);
  const max = sway.amp * (top - rest);
  let scale = 1;
  if (min < 0) scale = Math.min(scale, (spec.x - spec.halfW) / -min);
  if (max > 0) scale = Math.min(scale, (ROAD - spec.halfW - spec.x) / max);
  if (scale >= 1) return sway;
  // Урезанный размах — с небольшим отступом от бортика, чтобы объект его не касался.
  const amp = sway.amp * scale * FIT_INSET;
  return amp >= MIN_SWAY_AMP ? { ...sway, amp } : null;
}

// ─── Сцена такта ────────────────────────────────────────────────────────────

/** Всё, что нужно паттерну, чтобы поставить себя в такт. */
export class Stage {
  /** Принятые препятствия такта в порядке постановки. */
  readonly obstacles: ObstacleSpec[] = [];
  /** Точки, через которые паттерны просят провести линию мелодии. */
  readonly lures: Lure[] = [];
  /** Уровню ещё нужен зигзаг / вид препятствия: ближайший одиночный объект закрывает долг. */
  wantSway = false;
  wantKind: 'cube' | 'saw' | null = null;

  constructor(
    readonly rng: Rng,
    readonly corridor: Corridor,
    readonly contour: Contour,
    readonly barStart: number,
    /** Уровень, по которому берутся размеры, зигзаг и ширина проходов. */
    readonly level: number,
    /**
     * Время подлёта, одно на все объекты (фоновая сцена меню: там симуляция
     * не ускоряется). null — как в забеге, по уровню в момент прилёта.
     */
    readonly fixedApproach: number | null = null,
  ) {}

  tickOf(step: number): number {
    return this.barStart + step * TICKS_PER_STEP;
  }

  /** За сколько тиков объект, прилетающий в тик tick, проходит видимую дорогу. */
  approachOf(tick: number): number {
    return this.fixedApproach ?? approachFor(tick);
  }

  /** Где в этот тик ждать корабль, идущий по линии мелодии. */
  line(tick: number): number {
    return this.corridor.goldClamp(tick, this.contour.at(tick));
  }

  /** Предъявить группу одновременных препятствий коридору. */
  put(group: ObstacleSpec[]): boolean {
    if (group.length === 0 || this.obstacles.length + group.length > MAX_OBSTACLES_PER_BAR) return false;
    if (!this.corridor.place(group.map((spec) => this.body(spec)))) return false;
    for (const spec of group) this.obstacles.push(spec);
    return true;
  }

  lure(tick: number, x: number): void {
    this.lures.push({ tick, x });
  }

  /** Препятствие таким, каким его увидит симуляция. */
  private body(spec: ObstacleSpec): Obstacle {
    const body = makeObstacle(spec, 0);
    if (this.fixedApproach !== null) {
      body.approachTicks = this.fixedApproach;
      body.spawnTick = spec.arriveTick - this.fixedApproach;
    }
    return body;
  }

  /** Куб или пила — по весам уровня (или тот, что уровню ещё нужен). */
  pickSolid(): 'cube' | 'saw' {
    return this.wantKind ?? this.rng.weighted(['cube', 'saw'] as const, (kind) => kindWeight(kind, this.level));
  }

  cube(tick: number, x: number, size: number): ObstacleSpec {
    return this.solid('cube', tick, x, size);
  }

  saw(tick: number, x: number, size: number): ObstacleSpec {
    return this.solid('saw', tick, x, size);
  }

  /** size 0…1 — от наименьшего до наибольшего размера пресета. */
  solid(kind: 'cube' | 'saw', tick: number, x: number, size: number): ObstacleSpec {
    const preset = OBSTACLES[kind];
    const halfW = lerp(preset.sizeMin, preset.sizeMax, clamp(size, 0, 1));
    const spin = (this.rng.range(preset.spinMin, preset.spinMax) / TICK_RATE) * (this.rng.chance(0.5) ? 1 : -1);
    return {
      kind,
      arriveTick: tick,
      x: clamp(x, halfW, ROAD - halfW),
      sway: null,
      halfW,
      yaw0: this.rng.range(0, TAU),
      yawRate: spin,
    };
  }

  /**
   * Жребий зигзага для фигуры: шанс уровня, умноженный на share (у фигур, где
   * зигзаг мешает замыслу, доля меньше). Жребий бросается всегда — рисунок
   * остального такта не должен зависеть от того, с какого уровня зигзаг разрешён.
   */
  rollSway(share: number): boolean {
    return this.rng.chance(swayChance(this.level) * share) && this.level >= GAME.sway.startLevel;
  }

  /** Зигзаг уровня, подогнанный под дорогу для всей группы сразу (группа качается как целое). */
  swing(group: ObstacleSpec[]): Sway | null {
    if (this.level < GAME.sway.startLevel) return null;
    const amp = swayAmp(this.level) * this.rng.range(0.55, 1);
    const periodTicks = Math.round(swayPeriodTicks(this.level) * this.rng.range(1, 1.2));
    const phase = this.rng.range(0, TAU);
    // Вторая попытка — зеркальная фаза: объект у бортика качается внутрь дороги.
    for (const tryPhase of [phase, phase + Math.PI]) {
      let sway: Sway | null = { amp, periodTicks, phase: tryPhase };
      for (const spec of group) {
        if (sway) sway = fitSway(spec, sway, this.approachOf(spec.arriveTick));
      }
      if (sway) return sway;
    }
    return null;
  }
}

// ─── Одиночные фигуры ───────────────────────────────────────────────────────

export interface SingleOptions {
  kind?: 'cube' | 'saw';
  /** line — прямо в линию мелодии; side — впритирку сбоку; far — в стороне, для давления. */
  aim?: 'line' | 'side' | 'far';
  /** Размер 0…1; по умолчанию случайный. */
  size?: number;
  /** Зигзаг: по шансу уровня, никогда или обязательно. */
  sway?: 'auto' | 'never';
}

/** Одиночный куб или пила. */
export function single(stage: Stage, step: number, options: SingleOptions = {}): number {
  const { rng } = stage;
  const tick = stage.tickOf(step);
  const kind = options.kind ?? stage.pickSolid();
  const aim = options.aim ?? (rng.chance(0.55) ? 'line' : 'side');
  const swayAllowed = options.sway !== 'never' && stage.level >= GAME.sway.startLevel;
  const wantSway = swayAllowed && (stage.wantSway || rng.chance(swayChance(stage.level)));
  const size = options.size ?? rng.next();
  const lineX = stage.line(tick);
  // Починка по нарастающей: без зигзага → меньше и с другой стороны → подальше от линии.
  for (let attempt = 0; attempt < 4; attempt++) {
    const mode = attempt === 3 ? 'far' : attempt === 2 ? 'side' : aim;
    let spec = stage.solid(kind, tick, lineX, attempt >= 2 ? size * 0.4 : size);
    const side = rng.chance(0.5) ? 1 : -1;
    let offset = rng.range(-3.5, 3.5);
    if (mode === 'side') offset = side * (blockOf(spec) + rng.range(0.4, 4.5));
    if (mode === 'far') offset = side * rng.range(18, 34);
    // Не помещается с этой стороны — зеркалим, а не прижимаем к линии.
    let x = lineX + offset;
    if (mode !== 'line' && (x < spec.halfW || x > ROAD - spec.halfW)) x = lineX - offset;
    spec = { ...spec, x: clamp(x, spec.halfW, ROAD - spec.halfW) };
    if (attempt === 0 && wantSway) spec = { ...spec, sway: stage.swing([spec]) };
    if (stage.put([spec])) {
      if (spec.sway) stage.wantSway = false;
      if (stage.wantKind === kind) stage.wantKind = null;
      return 1;
    }
  }
  return 0;
}

/** Физическая ширина прохода между хитбоксами пары: с уровнем сужается до минимума честности. */
function gapFor(stage: Stage): number {
  return Math.max(GAME.fairness.minGap + 3, 31 - 1.1 * (stage.level - 1)) + stage.rng.range(0, 4);
}

export interface PairOptions {
  /** Центр прохода; по умолчанию — около линии мелодии. */
  center?: number;
  /** Ширина прохода между хитбоксами. */
  gap?: number;
  kind?: 'cube' | 'saw';
  size?: number;
  sway?: 'auto' | 'never';
}

/** Пара с проходом: два объекта в один тик, линия мелодии идёт между ними. */
export function pair(stage: Stage, step: number, options: PairOptions = {}): number {
  const { rng } = stage;
  const tick = stage.tickOf(step);
  const lineX = stage.line(tick);
  for (let attempt = 0; attempt < 3; attempt++) {
    const gap = (options.gap ?? gapFor(stage)) + attempt * 4;
    const kindL = options.kind ?? stage.pickSolid();
    const kindR = options.kind ?? (rng.chance(0.7) ? kindL : stage.pickSolid());
    const size = options.size ?? rng.next();
    const left = stage.solid(kindL, tick, 0, size);
    const right = stage.solid(kindR, tick, 0, options.size ?? rng.next());
    // Центр выбирается так, чтобы оба объекта целиком стояли на дороге.
    const minCenter = gap / 2 + reachOf(left) + left.halfW;
    const maxCenter = ROAD - gap / 2 - reachOf(right) - right.halfW;
    if (minCenter > maxCenter) continue;
    const wanted = options.center ?? lineX + rng.range(-12, 12) * (attempt === 0 ? 1 : 0.4);
    const center = clamp(wanted, minCenter, maxCenter);
    left.x = center - gap / 2 - reachOf(left);
    right.x = center + gap / 2 + reachOf(right);
    const group = [left, right];
    if (attempt === 0 && options.sway !== 'never' && stage.rollSway(PAIR_SWAY)) {
      const sway = stage.swing(group);
      for (const spec of group) spec.sway = sway;
    }
    if (stage.put(group)) {
      stage.lure(tick, center);
      return 2;
    }
  }
  return single(stage, step, { sway: 'never' });
}

/**
 * «Лесенка»: мелкие кубы по восьмым, шагающие поперёк дороги через линию
 * мелодии. direction — куда шагает (по умолчанию — куда больше места).
 */
export function stairs(stage: Stage, startStep: number, count: number, direction?: 1 | -1): number {
  const { rng } = stage;
  const lineX = stage.line(stage.tickOf(startStep));
  const rise = rng.range(9, 12.5);
  const lead = rise * rng.range(0.8, 1.6);
  const run = rise * (count - 1);
  const edge = OBSTACLES.cube.sizeMax;
  let dir = direction ?? (rng.chance(0.5) ? 1 : -1);
  // Лесенка должна уместиться на дороге целиком; иначе шагает в другую сторону.
  const fits = (d: number) => {
    const from = lineX - d * lead;
    const to = from + d * run;
    return Math.min(from, to) >= edge && Math.max(from, to) <= ROAD - edge;
  };
  if (!fits(dir) && fits(-dir)) dir = dir === 1 ? -1 : 1;
  const start = clamp(lineX - dir * lead, edge + (dir < 0 ? run : 0), ROAD - edge - (dir > 0 ? run : 0));
  const steps: ObstacleSpec[] = [];
  for (let i = 0; i < count; i++) {
    const x = clamp(start + dir * rise * i, edge, ROAD - edge);
    steps.push(stage.cube(stage.tickOf(startStep + i * 2), x, rng.range(0, 0.35)));
  }
  // Один зигзаг на все ступени: каждая повторяет его со сдвигом во времени, и лесенка идёт «змейкой».
  const sway = stage.rollSway(STAIRS_SWAY) ? stage.swing(steps) : null;
  let placed = 0;
  for (const spec of steps) {
    const swayed = sway !== null && stage.put([{ ...spec, sway }]);
    if (swayed || stage.put([spec]) || stage.put([stage.cube(spec.arriveTick, spec.x - dir * rise * 0.5, 0)])) placed += 1;
  }
  return placed;
}

/** Барьер: ряд из сомкнутых пил, перекрывающий линию мелодии, — его обходят сбоку. */
export function barrier(stage: Stage, step: number, count: number): number {
  const { rng } = stage;
  const tick = stage.tickOf(step);
  const lineX = stage.line(tick);
  for (let attempt = 0; attempt < 3; attempt++) {
    const saws = Math.max(2, count - (attempt === 2 ? 1 : 0));
    const halfW = lerp(OBSTACLES.saw.sizeMin + 1, OBSTACLES.saw.sizeMax, rng.next());
    const pitch = 2 * halfW * WALL_PITCH;
    const width = pitch * (saws - 1) + 2 * halfW;
    const center = clamp(lineX + rng.range(-0.3, 0.3) * width, width / 2, ROAD - width / 2);
    const size = (halfW - OBSTACLES.saw.sizeMin) / (OBSTACLES.saw.sizeMax - OBSTACLES.saw.sizeMin);
    const group: ObstacleSpec[] = [];
    for (let i = 0; i < saws; i++) group.push(stage.saw(tick, center - width / 2 + halfW + pitch * i, size));
    if (stage.put(group)) return saws;
  }
  return single(stage, step, { kind: 'saw', aim: 'line', sway: 'never' });
}

/** Заполнить отрезок дороги [from, to] сомкнутыми пилами. */
function fillSaws(stage: Stage, tick: number, from: number, to: number, out: ObstacleSpec[]): void {
  const preset = OBSTACLES.saw;
  const length = to - from;
  if (length < 2 * preset.sizeMin) return;
  // n пил радиуса h с перекрытием занимают h·(2 + 2·pitch·(n − 1)).
  const count = Math.max(1, Math.ceil((length / preset.sizeMax - 2) / (2 * WALL_PITCH) + 1));
  // Если пилы вышли бы меньше пресета, они остаются минимальными и просто перекрываются сильнее.
  const halfW = Math.max(preset.sizeMin, length / (2 + 2 * WALL_PITCH * (count - 1)));
  const pitch = count > 1 ? (length - 2 * halfW) / (count - 1) : 0;
  const size = (halfW - preset.sizeMin) / (preset.sizeMax - preset.sizeMin);
  for (let i = 0; i < count; i++) out.push(stage.saw(tick, from + halfW + pitch * i, size));
}

export interface WallOptions {
  /** Центр окна; по умолчанию — со сдвигом от линии мелодии. */
  center?: number;
}

/** «Стена» из пил во всю дорогу с одним окном. */
export function sawWall(stage: Stage, step: number, options: WallOptions = {}): number {
  const { rng, corridor } = stage;
  const tick = stage.tickOf(step);
  const lineX = stage.line(tick);
  const minFill = 2 * OBSTACLES.saw.sizeMin;
  for (let attempt = 0; attempt < 3; attempt++) {
    const window = Math.max(GAME.fairness.minGap + 3.5, 33 - 1.2 * (stage.level - 1)) + rng.range(0, 3) + attempt * 5;
    const band = corridor.gateBand(tick, tick - stage.approachOf(tick), window / 2 - SHIP - MARGIN);
    if (!band) continue;
    const lo = Math.max(band.lo, window / 2);
    const hi = Math.min(band.hi, ROAD - window / 2);
    if (lo > hi) continue;
    const shift = attempt === 0 ? rng.range(-22, 22) : 0;
    let from = clamp(options.center ?? lineX + shift, lo, hi) - window / 2;
    // Узкую щель у бортика пилой не закрыть: окно либо вплотную к краю, либо оставляет место под пилу.
    if (from < minFill) from = from < minFill / 2 ? 0 : minFill;
    if (ROAD - from - window < minFill) from = ROAD - from - window < minFill / 2 ? ROAD - window : ROAD - window - minFill;
    const group: ObstacleSpec[] = [];
    fillSaws(stage, tick, 0, from, group);
    fillSaws(stage, tick, from + window, ROAD, group);
    if (stage.put(group)) {
      stage.lure(tick, from + window / 2);
      return group.length;
    }
  }
  return barrier(stage, step, 2);
}

export interface GateOptions {
  /** Центр прохода; по умолчанию — со сдвигом от линии мелодии. */
  center?: number;
  sway?: 'auto' | 'never';
}

/** Лазерные ворота: луч во всю дорогу с одним проходом. */
export function laserGate(stage: Stage, step: number, options: GateOptions = {}): number {
  const { rng, corridor } = stage;
  const tick = stage.tickOf(step);
  const lineX = stage.line(tick);
  const swayAllowed = options.sway !== 'never' && stage.level >= GAME.sway.startLevel;
  for (let attempt = 0; attempt < 4; attempt++) {
    const halfW = Math.min(LASER_HALF_MAX, laserHalfGapForLevel(stage.level) + rng.range(0.5, 3) + attempt * 2);
    const pass = halfW - SHIP * GAME.hitbox.laserPlayer - MARGIN;
    const band = corridor.gateBand(tick, tick - stage.approachOf(tick), pass);
    if (!band) continue;
    const lo = Math.max(band.lo, halfW);
    const hi = Math.min(band.hi, ROAD - halfW);
    if (lo > hi) continue;
    const shift = attempt === 0 ? rng.range(-18, 18) : 0;
    let spec: ObstacleSpec = { kind: 'laser', arriveTick: tick, x: clamp(options.center ?? lineX + shift, lo, hi), sway: null, halfW };
    if (attempt === 0 && swayAllowed && stage.rollSway(GATE_SWAY)) spec = { ...spec, sway: stage.swing([spec]) };
    if (stage.put([spec])) {
      stage.lure(tick, spec.x);
      return 1;
    }
  }
  return 0;
}

// ─── Ряды ───────────────────────────────────────────────────────────────────

export interface SlalomOptions {
  kind?: 'cube' | 'saw';
}

/**
 * «Слалом»: столбы встают по очереди слева и справа от линии мелодии, образуя
 * тесный извилистый коридор. Идеальная линия идёт по его оси; чуть в сторону —
 * и каждый столб пролетает впритирку.
 */
export function slalom(stage: Stage, steps: readonly number[], options: SlalomOptions = {}): number {
  const { rng } = stage;
  const kind = options.kind ?? 'cube';
  let side = rng.chance(0.5) ? 1 : -1;
  let placed = 0;
  for (const step of steps) {
    const tick = stage.tickOf(step);
    const lineX = stage.line(tick);
    const spec = stage.solid(kind, tick, lineX, rng.range(0, 0.4));
    // Полуширина коридора для центра корабля: чуть шире зоны сферы.
    const x = lineX + side * (blockOf(spec) + GOLD_PAD * CELL + rng.range(1, 3));
    const sways = stage.rollSway(POST_SWAY);
    if (x >= spec.halfW && x <= ROAD - spec.halfW) {
      const post = { ...spec, x };
      const swayed = sways && stage.put([{ ...post, sway: stage.swing([post]) }]);
      if (swayed || stage.put([post])) placed += 1;
    }
    side = -side;
  }
  return placed;
}

/** Синкопы на шестнадцатых: ритмы «3+3+2» и «три против четырёх». */
const SYNCOPATIONS: readonly (readonly number[])[] = [
  [0, 3, 6, 8, 11, 14],
  [0, 3, 6, 9, 12, 15],
  [2, 5, 8, 11, 14],
  [0, 3, 6, 10, 13],
];

/** Синкопированный ряд мелких кубов на шестнадцатых (высокие уровни). */
export function syncopation(stage: Stage, count: number, fromStep = 0): number {
  const fitting = SYNCOPATIONS.map((rhythm) => rhythm.filter((step) => step >= fromStep)).filter((rhythm) => rhythm.length >= Math.min(count, 3));
  if (fitting.length === 0) return 0;
  const rhythm = stage.rng.pick(fitting);
  return slalom(stage, rhythm.slice(0, count));
}

/** Нарастающий ряд к сильной доле: чем ближе к дропу, тем чаще удары. */
const ROLLS: readonly (readonly number[])[] = [
  [],
  [12],
  [8, 12],
  [4, 8, 12],
  [0, 6, 10, 13],
  [0, 5, 9, 12, 14],
  [0, 4, 7, 10, 12, 14],
  [0, 4, 7, 9, 11, 13, 14],
];

export const MAX_ROLL = ROLLS.length - 1;

/**
 * Разгон к дропу: сначала слалом по нарастающему ритму, в конце — два «столба»
 * по сторонам от будущих ворот в точке gateX.
 */
export function roll(stage: Stage, count: number, gateX: number): number {
  const steps = ROLLS[clamp(count, 0, MAX_ROLL)];
  const pillars = Math.min(2, steps.length);
  let placed = slalom(stage, steps.slice(0, steps.length - pillars));
  let side = stage.rng.chance(0.5) ? 1 : -1;
  for (const step of steps.slice(steps.length - pillars)) {
    const tick = stage.tickOf(step);
    const spec = stage.cube(tick, gateX, stage.rng.range(0.2, 0.7));
    const offset = laserHalfGapForLevel(stage.level + 1) + 3 + reachOf(spec);
    const x = gateX + side * offset;
    const mirrored = gateX - side * offset;
    const fits = (at: number) => at >= spec.halfW && at <= ROAD - spec.halfW;
    if ((fits(x) && stage.put([{ ...spec, x }])) || (fits(mirrored) && stage.put([{ ...spec, x: mirrored }]))) {
      stage.lure(tick, gateX);
      placed += 1;
    }
    side = -side;
  }
  return placed;
}

/** «Воронка»: пары на долях сходятся к точке будущих ворот — коридор перед дропом. */
export function funnel(stage: Stage, gateX: number, pairs: number): number {
  const steps = [0, 4, 8, 12].slice(-pairs);
  const narrow = 2 * laserHalfGapForLevel(stage.level + 1) + 10;
  const wide = narrow + 26;
  const kind = stage.pickSolid();
  const from = stage.line(stage.tickOf(steps[0]));
  let placed = 0;
  for (let i = 0; i < steps.length; i++) {
    const tick = stage.tickOf(steps[i]);
    const u = steps.length > 1 ? i / (steps.length - 1) : 1;
    const center = lerp(from, gateX, (i + 1) / steps.length);
    const gap = lerp(wide, narrow, u);
    const group: ObstacleSpec[] = [];
    for (const side of [-1, 1]) {
      const spec = stage.solid(kind, tick, center, stage.rng.range(0.3, 0.8));
      const x = center + side * (gap / 2 + reachOf(spec));
      // У бортика стенке воронки места нет — с этой стороны её роль играет край дороги.
      if (x >= spec.halfW && x <= ROAD - spec.halfW) group.push({ ...spec, x });
    }
    if (stage.put(group)) {
      stage.lure(tick, center);
      placed += group.length;
    }
  }
  return placed;
}

/**
 * Финал разгона на сильной доле нового уровня: лазерные ворота или «портал»
 * из двух больших пил в точке gateX.
 */
export function dropGate(stage: Stage, gateX: number, portal: boolean): number {
  if (portal) return pair(stage, 0, { center: gateX, kind: 'saw', size: 1, sway: 'never' });
  return laserGate(stage, 0, { center: gateX, sway: 'never' }) || pair(stage, 0, { center: gateX, sway: 'never' });
}
