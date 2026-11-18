/**
 * Ритмический генератор препятствий и сфер.
 *
 * Решение принимается на каждой доле, а объекты планируются так, чтобы они
 * пересекали линию корабля ровно на будущей доле (или полудоле): препятствия и
 * сферы «проходят» мимо игрока в такт бочке. Для этого объект появляется за
 * верхним краем экрана на такой высоте, откуда он долетит точно к нужной доле
 * (путь считается точно — см. engine-motion.ts).
 *
 * Честность проверяется по будущему, а не «на глаз»:
 * 1. Проходимость. Для каждого препятствия считается окно времени, когда его
 *    хитбокс перекрывает полосу корабля, и занятый им диапазон X в этом окне
 *    (с учётом зигзага). Затем множество позиций, куда корабль может успеть,
 *    протягивается по времени со скоростью FAIR_SPEED — это и есть «зазор
 *    между рядами, за который корабль успевает перелететь». Проход уже
 *    MIN_PASS (3.2 диаметра корабля) проходом не считается.
 * 2. Раздельность. Разные ряды не наезжают друг на друга по Y (у быстрых
 *    объектов своя скорость), лазер владеет своей полосой по Y целиком, а
 *    сферы не появляются внутри препятствий и рядом с ними.
 * Паттерн, который не проходит проверку, перестраивается (другие позиции,
 * меньше зигзаг, следующая доля) или пропускается — генератор никогда не
 * выпускает непроходимый ряд.
 */
import { hitboxExtent, obstacleExtent } from './collision';
import { GAME, OBSTACLES, WORLD_W, laserGapForLevel, zigzagAmp, zigzagChance, zigzagFreq } from './config';
import {
  type MotionModel,
  type SimCrystal,
  type SimObstacle,
  timeToTravel,
  travel,
  zigzagOffset,
  zigzagRange,
} from './engine-motion';
import { chance, clamp, lerp, rand, randInt, TAU, weightedPick } from './math';
import type { ObstacleKind, Zigzag } from './types';

/** Гарантированная ширина прохода: 3.2 диаметра хитбокса корабля. */
export const MIN_PASS = 3.2 * 2 * GAME.player.radius;
/**
 * Скорость смещения корабля, на которую рассчитана честность: заметно ниже
 * GAME.player.maxSpeed — запас на разгон, реакцию и неидеальное управление.
 */
export const FAIR_SPEED = GAME.player.maxSpeed * 0.6;
/** Запас к хитбоксам при проверке прохода, ед. */
const FAIR_MARGIN = 4;
/** На сколько выше верхнего края появляется объект, ед. */
const SPAWN_MARGIN = 24;
/** Дальше этой доли генератор не планирует. */
const MAX_SLOT = 18;
/** Сколько раз перестраивать паттерн, прежде чем пропустить долю. */
const ATTEMPTS = 6;
/** Минимальный просвет по Y между препятствиями разных рядов, ед. */
const ROW_GAP_Y = 14;
/** Лазер держит свою полосу по Y свободной от других препятствий на столько, ед. */
const LASER_BAND = 34;
/** Сфера не ближе этого к препятствию, ед. */
const CRYSTAL_CLEAR = 26;
/** Зигзаг меньше этого не заметен — не выдаём. */
const MIN_ZIGZAG_AMP = 12;
/** Сферы в цепочке идут восьмыми: через полдоли. */
const CHAIN_SPACING = 0.5;
const CHAIN_MIN = 3;
const CHAIN_MAX = 6;
/** Доля FAIR_SPEED, с которой корабль должен успевать между соседними сферами. */
const CHAIN_REACH = 0.7;
/** Меню показывает сцену «как на 3-м уровне»: лазеры и зигзаги, но редко. */
const ATTRACT_LEVEL = 3;

// ─── Паттерны ───────────────────────────────────────────────────────────────

type PatternId = 'single' | 'pair' | 'rain' | 'laser';

interface PatternDef {
  id: PatternId;
  /** Вес выбора на уровне level. */
  weight(level: number): number;
  /** Сколько долей генератор отдыхает после паттерна (плюс случайная пауза). */
  rest: number;
}

/** Вес вида препятствия из OBSTACLES: 0 до minLevel, дальше растёт с уровнем. */
function kindWeight(kind: ObstacleKind, level: number): number {
  const p = OBSTACLES[kind];
  return level < p.minLevel ? 0 : p.weight + p.weightPerLevel * (level - p.minLevel);
}

const PATTERNS: readonly PatternDef[] = [
  // Одиночный куб или пила.
  { id: 'single', weight: () => 4, rest: 0 },
  // Два препятствия с проходом между ними.
  { id: 'pair', weight: (l) => 1.3 + 0.35 * (l - 1), rest: 1 },
  // «Дождь»: три мелких куба лесенкой через полдоли.
  { id: 'rain', weight: (l) => 1 + 0.3 * (l - 1), rest: 1 },
  // Лазерная стена с проходом — вес и уровень появления из OBSTACLES.laser.
  { id: 'laser', weight: (l) => kindWeight('laser', l), rest: 1 },
];

const BODY_KINDS: readonly ObstacleKind[] = ['cube', 'saw'];

/** Шанс, что на свободной доле появится паттерн: растёт с уровнем, но не до 1. */
function spawnChance(level: number): number {
  return Math.min(0.72 + 0.03 * (level - 1), 0.92);
}

/** Случайная пауза после паттерна в долях: на первых уровнях чаще. */
function extraRest(level: number): number {
  if (level <= 1) return randInt(0, 1);
  if (level <= 3) return chance(0.4) ? 1 : 0;
  return chance(Math.max(0.1, 0.35 - 0.03 * (level - 4))) ? 1 : 0;
}

// ─── Контекст доли ──────────────────────────────────────────────────────────

/** Всё, что генератор знает о мире в момент доли. */
export interface BeatContext {
  mode: 'attract' | 'playing';
  level: number;
  motion: MotionModel;
  /** Секунды до следующей доли. */
  toNextBeat: number;
  /** Длительность доли сейчас и после смены темпа. */
  period: number;
  periodNext: number;
  /** Доли, начинающиеся в этот момент (сек от «сейчас») и позже, длятся periodNext. */
  periodSwitchAt: number;
  /** Y линии корабля. */
  playerY: number;
  /** Сколько ещё длится стартовая пауза (препятствия не должны показаться раньше). */
  graceLeft: number;
  /** Шанс редкой сферы (с учётом улучшений). */
  rareChance: number;
}

/** Куда генератор кладёт новые объекты. */
export interface SpawnerHost {
  readonly obstacles: SimObstacle[];
  readonly crystals: SimCrystal[];
  nextId(): number;
}

interface ObstacleDraft {
  kind: ObstacleKind;
  /** Базовый X (для лазера — центр прохода). */
  x: number;
  size: number;
  gapW: number;
  zigzag: Zigzag | null;
  /** Сдвиг прибытия относительно доли паттерна, в долях. */
  offset: number;
}

interface CrystalDraft {
  x: number;
  rare: boolean;
  zigzag: Zigzag | null;
  offset: number;
}

// ─── Интервалы ──────────────────────────────────────────────────────────────
// Наборы интервалов — плоские массивы [lo0, hi0, lo1, hi1, …], отсортированные по lo.

/** Позиции центра корабля, свободные в момент t: проходы шире MIN_PASS. */
function freeCenters(blocks: readonly number[], t: number): number[] {
  const act: number[] = [];
  for (let i = 0; i < blocks.length; i += 4) {
    if (blocks[i] < t && blocks[i + 1] > t) act.push(blocks[i + 2], blocks[i + 3]);
  }
  // Сортировка пар по левому краю (пар мало — вставками).
  for (let i = 2; i < act.length; i += 2) {
    const lo = act[i];
    const hi = act[i + 1];
    let j = i - 2;
    while (j >= 0 && act[j] > lo) {
      act[j + 2] = act[j];
      act[j + 3] = act[j + 1];
      j -= 2;
    }
    act[j + 2] = lo;
    act[j + 3] = hi;
  }
  const out: number[] = [];
  const r = GAME.player.radius;
  const minC = GAME.player.edgePadding;
  const maxC = WORLD_W - GAME.player.edgePadding;
  let cursor = 0;
  const pushFree = (a: number, b: number): void => {
    if (b - a < MIN_PASS) return;
    const lo = Math.max(a + r, minC);
    const hi = Math.min(b - r, maxC);
    if (hi >= lo) out.push(lo, hi);
  };
  for (let i = 0; i < act.length; i += 2) {
    if (act[i] > cursor) pushFree(cursor, Math.min(act[i], WORLD_W));
    if (act[i + 1] > cursor) cursor = act[i + 1];
    if (cursor >= WORLD_W) break;
  }
  if (cursor < WORLD_W) pushFree(cursor, WORLD_W);
  return out;
}

function intersect(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i], b[j]);
    const hi = Math.min(a[i + 1], b[j + 1]);
    if (hi >= lo) out.push(lo, hi);
    if (a[i + 1] < b[j + 1]) i += 2;
    else j += 2;
  }
  return out;
}

/** Расширить достижимые интервалы на d в пределах их свободных компонент. */
function expandWithin(reach: readonly number[], comps: readonly number[], d: number): number[] {
  const out: number[] = [];
  let c = 0;
  for (let i = 0; i < reach.length; i += 2) {
    while (c < comps.length && comps[c + 1] < reach[i]) c += 2;
    if (c >= comps.length) break;
    const lo = Math.max(comps[c], reach[i] - d);
    const hi = Math.min(comps[c + 1], reach[i + 1] + d);
    const n = out.length;
    if (n > 0 && lo <= out[n - 1]) out[n - 1] = Math.max(out[n - 1], hi);
    else out.push(lo, hi);
  }
  return out;
}

/**
 * Есть ли путь для корабля через все окна препятствий. blocks — плоский
 * массив [t0, t1, lo, hi, …]: с t0 по t1 занят диапазон хитбокса [lo, hi].
 */
export function passable(blocks: readonly number[]): boolean {
  if (blocks.length === 0) return true;
  const times: number[] = [0];
  for (let i = 0; i < blocks.length; i += 4) times.push(Math.max(0, blocks[i]), blocks[i + 1]);
  times.sort((a, b) => a - b);
  let reach: number[] | null = null;
  for (let k = 0; k + 1 < times.length; k++) {
    const ta = times[k];
    const tb = times[k + 1];
    if (tb - ta < 1e-6) continue;
    const comps = freeCenters(blocks, (ta + tb) / 2);
    reach = reach === null ? comps : intersect(reach, comps);
    if (reach.length === 0) return false;
    reach = expandWithin(reach, comps, FAIR_SPEED * (tb - ta));
  }
  return true;
}

function rangesOverlap(a: readonly number[], b: readonly number[], pad: number): boolean {
  for (let i = 0; i < a.length; i += 2) {
    for (let j = 0; j < b.length; j += 2) {
      if (a[i] - pad < b[j + 1] && b[j] - pad < a[i + 1]) return true;
    }
  }
  return false;
}

// ─── Генератор ──────────────────────────────────────────────────────────────

/** Вертикальный «коридор» объекта до линии корабля — для проверки наездов. */
interface Track {
  y: number;
  vy: number;
  /** Полувысота хитбокса. */
  half: number;
  /** Занятые диапазоны X с учётом всего размаха зигзага. */
  xs: number[];
  /** Секунды до того, как центр объекта дойдёт до линии корабля. */
  tLine: number;
  laser: boolean;
}

/** Нейтральный контекст до первой доли. */
const IDLE_CONTEXT: BeatContext = {
  mode: 'attract',
  level: 1,
  motion: { hf: 1, mult: 1, multNext: 1, toLevelUp: Infinity },
  toNextBeat: 0,
  period: 1,
  periodNext: 1,
  periodSwitchAt: Infinity,
  playerY: 0,
  graceLeft: 0,
  rareChance: 0,
};

export class Spawner {
  private rest = 0;
  private chainRest = 0;
  /** Времена ближайших долей от текущего момента (переиспользуемый буфер). */
  private readonly beats: number[] = [];
  private readonly zz: [number, number] = [0, 0];
  /** Контекст текущей доли (между долями не используется). */
  private ctx: BeatContext = IDLE_CONTEXT;

  constructor(private readonly host: SpawnerHost) {}

  /** Новый забег или новая демо-сцена. */
  reset(mode: 'attract' | 'playing'): void {
    this.rest = mode === 'playing' ? 0 : 1;
    // В забеге первая цепочка сфер летит уже во время READY — разминка.
    this.chainRest = mode === 'playing' ? 0 : 2;
  }

  /** Вызывается движком на каждой доле. */
  onBeat(ctx: BeatContext): void {
    this.ctx = ctx;
    this.fillBeats(ctx);
    const attract = ctx.mode === 'attract';
    const level = attract ? ATTRACT_LEVEL : ctx.level;

    if (this.rest > 0) {
      this.rest--;
    } else if (chance(attract ? 0.45 : spawnChance(level))) {
      const pattern = weightedPick(PATTERNS, (p) => p.weight(level));
      if (this.spawnPattern(pattern.id, level, attract)) {
        this.rest = pattern.rest + (attract ? randInt(1, 3) : extraRest(level));
      }
    }

    if (this.chainRest > 0) {
      this.chainRest--;
    } else if (chance(attract ? 0.4 : 0.55)) {
      const count = this.spawnChain(level, attract);
      if (count > 0) this.chainRest = Math.ceil(count * CHAIN_SPACING) + (attract ? randInt(4, 7) : randInt(2, 5));
    }
  }

  // ── время долей ──

  private fillBeats(ctx: BeatContext): void {
    const b = this.beats;
    b.length = 0;
    let t = ctx.toNextBeat;
    for (let i = 0; i <= MAX_SLOT + 4; i++) {
      b.push(t);
      t += this.periodAfter(t);
    }
  }

  private periodAfter(t: number): number {
    return t >= this.ctx.periodSwitchAt ? this.ctx.periodNext : this.ctx.period;
  }

  /** Время (сек от «сейчас») позиции pos в долях: целая часть — номер доли, дробная — доля от неё. */
  private beatTime(pos: number): number {
    const i = Math.floor(pos);
    const t = this.beats[i];
    const f = pos - i;
    return f > 0 ? t + f * this.periodAfter(t) : t;
  }

  // ── препятствия ──

  private spawnPattern(id: PatternId, level: number, attract: boolean): boolean {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      // С каждой неудачей зигзаг скромнее, последние попытки — без него.
      const zzScale = attempt < 2 ? 1 : attempt < 4 ? 0.55 : 0;
      const drafts = this.draftPattern(id, level, attract, zzScale);
      if (this.placeObstacles(drafts)) return true;
    }
    return false;
  }

  private makeZigzag(level: number, ampLimit: number, scale: number, attract: boolean): Zigzag | null {
    if (scale <= 0 || !chance(zigzagChance(level) * (attract ? 0.5 : 1))) return null;
    const freq = zigzagFreq(level);
    // Боковая скорость зигзага (2π·freq·amp) не выше максимальной скорости корабля:
    // от препятствия всегда можно уйти, оно не «догоняет».
    const amp = Math.min(zigzagAmp(level) * rand(0.7, 1) * scale, ampLimit, GAME.player.maxSpeed / (TAU * freq));
    if (amp < MIN_ZIGZAG_AMP) return null;
    return { amp, freq, phase: rand(0, TAU) };
  }

  private pickBodyKind(level: number): ObstacleKind {
    return weightedPick(BODY_KINDS, (k) => kindWeight(k, level));
  }

  private randomSize(kind: ObstacleKind, small: boolean): number {
    const p = OBSTACLES[kind];
    return small ? rand(p.sizeMin, lerp(p.sizeMin, p.sizeMax, 0.35)) : rand(p.sizeMin, p.sizeMax);
  }

  private draftPattern(id: PatternId, level: number, attract: boolean, zzScale: number): ObstacleDraft[] {
    const W = WORLD_W;
    switch (id) {
      case 'single': {
        const kind = this.pickBodyKind(level);
        const size = this.randomSize(kind, false);
        const e = hitboxExtent(kind, size);
        const zigzag = this.makeZigzag(level, W / 2 - e - 4, zzScale, attract);
        const amp = zigzag ? zigzag.amp : 0;
        return [{ kind, x: rand(e + amp, W - e - amp), size, gapW: 0, zigzag, offset: 0 }];
      }
      case 'pair': {
        const k1 = this.pickBodyKind(level);
        const k2 = this.pickBodyKind(level);
        const s1 = this.randomSize(k1, false);
        const s2 = this.randomSize(k2, false);
        const e1 = hitboxExtent(k1, s1);
        const e2 = hitboxExtent(k2, s2);
        // Проход между парой сужается с уровнем, но сам по себе остаётся честным проходом.
        const squeeze = lerp(1, 0.82, clamp((level - 1) / 8, 0, 1));
        const gap = Math.max(rand(MIN_PASS * 1.3, MIN_PASS * 2.1) * squeeze, MIN_PASS + 2 * FAIR_MARGIN + 2);
        const span = 2 * e1 + gap + 2 * e2;
        // Пара виляет синхронно: проход между ними едет вместе с ней.
        const zigzag = this.makeZigzag(level, (W - span) / 2 - 2, zzScale, attract);
        const amp = zigzag ? zigzag.amp : 0;
        const left = rand(amp, W - span - amp);
        return [
          { kind: k1, x: left + e1, size: s1, gapW: 0, zigzag, offset: 0 },
          { kind: k2, x: left + 2 * e1 + gap + e2, size: s2, gapW: 0, zigzag: zigzag ? { ...zigzag } : null, offset: 0 },
        ];
      }
      case 'rain': {
        const sizes = [this.randomSize('cube', true), this.randomSize('cube', true), this.randomSize('cube', true)];
        const e = hitboxExtent('cube', Math.max(sizes[0], sizes[1], sizes[2]));
        const dir = chance(0.5) ? 1 : -1;
        const dx = rand(58, 86);
        const span = 2 * dx;
        const zigzag = this.makeZigzag(level, (W - span - 2 * e) / 2 - 2, zzScale * 0.6, attract);
        const amp = zigzag ? zigzag.amp : 0;
        const lo = e + amp;
        const hi = W - e - amp - span;
        const start = rand(lo, hi);
        const drafts: ObstacleDraft[] = [];
        for (let i = 0; i < 3; i++) {
          const x = dir > 0 ? start + i * dx : start + span - i * dx;
          drafts.push({
            kind: 'cube',
            x,
            size: sizes[i],
            gapW: 0,
            zigzag: zigzag ? { ...zigzag } : null,
            offset: i * 0.5,
          });
        }
        return drafts;
      }
      case 'laser': {
        const gapW = laserGapForLevel(level);
        const size = this.randomSize('laser', false);
        const zigzag = this.makeZigzag(level, (W - gapW) / 2 - 4, zzScale, attract);
        const amp = zigzag ? zigzag.amp : 0;
        const x = rand(gapW / 2 + amp, W - gapW / 2 - amp);
        return [{ kind: 'laser', x, size, gapW, zigzag, offset: 0 }];
      }
    }
  }

  /** Первая доля, к которой все объекты успевают прилететь из-за верхнего края. */
  private firstSlot(items: readonly { vy: number; half: number; offset: number }[], graceLeft: number): number {
    const ctx = this.ctx;
    for (let slot = 0; slot <= MAX_SLOT; slot++) {
      let ok = true;
      for (const it of items) {
        const t = this.beatTime(slot + it.offset);
        const y = ctx.playerY - it.vy * travel(ctx.motion, t);
        if (y > -(it.half + SPAWN_MARGIN)) {
          ok = false;
          break;
        }
        // Препятствие не должно показаться до конца стартовой паузы.
        if (graceLeft > 0 && y + it.vy * travel(ctx.motion, graceLeft) > -it.half) {
          ok = false;
          break;
        }
      }
      if (ok) return slot;
    }
    return -1;
  }

  private placeObstacles(drafts: readonly ObstacleDraft[]): boolean {
    const ctx = this.ctx;
    const items = drafts.map((d) => ({
      vy: GAME.speed.base * OBSTACLES[d.kind].speedFactor,
      half: hitboxExtent(d.kind, d.size),
      offset: d.offset,
    }));
    const first = this.firstSlot(items, ctx.mode === 'playing' ? ctx.graceLeft : 0);
    if (first < 0) return false;
    for (let slot = first; slot <= Math.min(first + 1, MAX_SLOT); slot++) {
      const cands = drafts.map((d, i) => this.materializeObstacle(d, items[i].vy, this.beatTime(slot + d.offset)));
      if (this.obstaclesFit(cands)) {
        for (const c of cands) {
          c.id = this.host.nextId();
          this.host.obstacles.push(c);
        }
        return true;
      }
    }
    return false;
  }

  private materializeObstacle(d: ObstacleDraft, vy: number, arrival: number): SimObstacle {
    const ctx = this.ctx;
    const preset = OBSTACLES[d.kind];
    const spin = preset.spinMax > 0 ? rand(preset.spinMin, preset.spinMax) * (chance(0.5) ? 1 : -1) : 0;
    return {
      id: 0,
      kind: d.kind,
      x: d.x + zigzagOffset(d.zigzag, 0),
      y: ctx.playerY - vy * travel(ctx.motion, arrival),
      baseX: d.x,
      vy,
      size: d.size,
      gapW: d.gapW,
      rotation: d.kind === 'laser' ? 0 : rand(0, TAU),
      spin,
      zigzag: d.zigzag,
      age: 0,
      passed: false,
      minClear: Infinity,
    };
  }

  // ── проверки ──

  private obstacleTrack(o: SimObstacle, forCrystal: boolean): Track | null {
    const ctx = this.ctx;
    if (o.y >= ctx.playerY) return null;
    const amp = o.zigzag ? o.zigzag.amp : 0;
    let xs: number[];
    if (o.kind === 'laser') {
      // Для сфер лазер — две половины луча (сфера может лететь через проход),
      // для препятствий — вся ширина: полоса лазера принадлежит только ему.
      const half = o.gapW / 2;
      xs = forCrystal ? [-1, o.baseX + amp - half, o.baseX - amp + half, WORLD_W + 1] : [-1, WORLD_W + 1];
    } else {
      const e = obstacleExtent(o);
      xs = [o.baseX - amp - e, o.baseX + amp + e];
    }
    return {
      y: o.y,
      vy: o.vy,
      half: obstacleExtent(o),
      xs,
      tLine: timeToTravel(ctx.motion, o.vy, ctx.playerY - o.y),
      laser: o.kind === 'laser',
    };
  }

  private crystalTrack(c: SimCrystal): Track | null {
    const ctx = this.ctx;
    if (c.y >= ctx.playerY || c.magnetized || c.missed) return null;
    const amp = c.zigzag ? c.zigzag.amp : 0;
    return {
      y: c.y,
      vy: c.vy,
      half: c.radius,
      xs: [c.baseX - amp - c.radius, c.baseX + amp + c.radius],
      tLine: timeToTravel(ctx.motion, c.vy, ctx.playerY - c.y),
      laser: false,
    };
  }

  /**
   * Два объекта не сближаются по Y ближе need, пока первый из них не дойдёт
   * до линии корабля. Разность Y меняется монотонно (скорости обоих умножаются
   * на один и тот же speedMult), так что хватает проверить концы отрезка.
   */
  private separated(a: Track, b: Track, need: number): boolean {
    const tEnd = Math.min(a.tLine, b.tLine);
    const dy0 = a.y - b.y;
    const dy1 = dy0 + (a.vy - b.vy) * travel(this.ctx.motion, tEnd);
    if (dy0 * dy1 <= 0) return false;
    return Math.min(Math.abs(dy0), Math.abs(dy1)) >= need;
  }

  private obstaclesFit(cands: readonly SimObstacle[]): boolean {
    const ctx = this.ctx;
    for (const c of cands) {
      const tc = this.obstacleTrack(c, false);
      if (!tc) return false;
      for (const o of this.host.obstacles) {
        const to = this.obstacleTrack(o, false);
        if (!to) continue;
        const laser = tc.laser || to.laser;
        if (!rangesOverlap(tc.xs, to.xs, 0)) continue;
        if (!this.separated(tc, to, tc.half + to.half + (laser ? LASER_BAND : ROW_GAP_Y))) return false;
      }
      const tcc = this.obstacleTrack(c, true);
      if (!tcc) return false;
      for (const k of this.host.crystals) {
        const tk = this.crystalTrack(k);
        if (!tk || !rangesOverlap(tcc.xs, tk.xs, CRYSTAL_CLEAR)) continue;
        if (!this.separated(tcc, tk, tcc.half + tk.half + CRYSTAL_CLEAR)) return false;
      }
    }

    const blocks: number[] = [];
    for (const o of this.host.obstacles) this.pushBlocks(blocks, o, ctx);
    for (const c of cands) this.pushBlocks(blocks, c, ctx);
    return passable(blocks);
  }

  /** Окно, когда хитбокс препятствия перекрывает полосу корабля, и занятый в нём диапазон X. */
  private pushBlocks(out: number[], o: SimObstacle, ctx: BeatContext): void {
    const r = GAME.player.radius;
    const half = obstacleExtent(o) + FAIR_MARGIN;
    const bottom = ctx.playerY + r + half;
    if (o.y >= bottom) return;
    const t0 = timeToTravel(ctx.motion, o.vy, ctx.playerY - r - half - o.y);
    const t1 = timeToTravel(ctx.motion, o.vy, bottom - o.y);
    zigzagRange(o.zigzag, o.age + t0, o.age + t1, this.zz);
    const lo = o.baseX + this.zz[0];
    const hi = o.baseX + this.zz[1];
    if (o.kind === 'laser') {
      const g = o.gapW / 2;
      out.push(t0, t1, -1, hi - g + FAIR_MARGIN);
      out.push(t0, t1, lo + g - FAIR_MARGIN, WORLD_W + 1);
    } else {
      const e = obstacleExtent(o) + FAIR_MARGIN;
      out.push(t0, t1, lo - e, hi + e);
    }
  }

  // ── сферы ──

  private spawnChain(level: number, attract: boolean): number {
    for (let attempt = 0; attempt < 3; attempt++) {
      const drafts = this.draftChain(level, attract);
      if (drafts.length > 0 && this.placeCrystals(drafts)) return drafts.length;
    }
    return 0;
  }

  private draftChain(level: number, attract: boolean): CrystalDraft[] {
    const ctx = this.ctx;
    const n = randInt(CHAIN_MIN, CHAIN_MAX);
    // Максимальный шаг по X между соседними сферами, чтобы собрать всю цепочку.
    const step = FAIR_SPEED * ctx.period * CHAIN_SPACING * CHAIN_REACH;
    const pad = GAME.player.edgePadding + GAME.crystal.rareRadius;
    let zigzag: Zigzag | null = null;
    if (!attract && level >= GAME.zigzag.startLevel && chance(zigzagChance(level) * 0.5)) {
      const freq = zigzagFreq(level);
      // Змейка не быстрее половины FAIR_SPEED — за ней можно успеть.
      const amp = Math.min(zigzagAmp(level) * 0.5, (FAIR_SPEED * 0.45) / (TAU * freq));
      if (amp >= MIN_ZIGZAG_AMP) zigzag = { amp, freq, phase: rand(0, TAU) };
    }
    const amp = zigzag ? zigzag.amp : 0;
    const a = pad + amp;
    const b = WORLD_W - pad - amp;
    if (b - a < 40) return [];

    const xs: number[] = [];
    if (chance(0.5)) {
      // Синусоида: соседние точки отстоят не больше чем на A.
      const A = Math.min(rand(28, 90), step, (b - a) / 2);
      const cx = rand(a + A, b - A);
      const phi = rand(0, TAU);
      for (let i = 0; i < n; i++) xs.push(cx + A * Math.sin(phi + (i * Math.PI) / 3));
    } else {
      // Дуга: от xa к xb с выгибом.
      const span = Math.min((n - 1) * step * 0.6, b - a) * rand(0.4, 1);
      let xa = rand(a, b - span);
      let xb = xa + span;
      if (chance(0.5)) [xa, xb] = [xb, xa];
      const bulge = rand(18, 50) * (chance(0.5) ? 1 : -1);
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        xs.push(clamp(lerp(xa, xb, u) + bulge * Math.sin(Math.PI * u), a, b));
      }
    }
    for (let i = 1; i < n; i++) if (Math.abs(xs[i] - xs[i - 1]) > step) return [];

    const drafts: CrystalDraft[] = [];
    for (let i = 0; i < n; i++) {
      drafts.push({
        x: xs[i],
        rare: !attract && chance(ctx.rareChance),
        zigzag: zigzag ? { ...zigzag } : null,
        offset: i * CHAIN_SPACING,
      });
    }
    return drafts;
  }

  private placeCrystals(drafts: readonly CrystalDraft[]): boolean {
    const vy = GAME.speed.base * GAME.crystal.speedFactor;
    const items = drafts.map((d) => ({
      vy,
      half: d.rare ? GAME.crystal.rareRadius : GAME.crystal.radius,
      offset: d.offset,
    }));
    const first = this.firstSlot(items, 0);
    if (first < 0) return false;
    for (let slot = first; slot <= Math.min(first + 1, MAX_SLOT); slot++) {
      const cands = drafts.map((d, i) => this.materializeCrystal(d, vy, items[i].half, this.beatTime(slot + d.offset)));
      if (this.crystalsFit(cands)) {
        for (const c of cands) {
          c.id = this.host.nextId();
          this.host.crystals.push(c);
        }
        return true;
      }
    }
    return false;
  }

  private materializeCrystal(d: CrystalDraft, vy: number, radius: number, arrival: number): SimCrystal {
    const ctx = this.ctx;
    return {
      id: 0,
      x: d.x + zigzagOffset(d.zigzag, 0),
      y: ctx.playerY - vy * travel(ctx.motion, arrival),
      baseX: d.x,
      vy,
      radius,
      rare: d.rare,
      phase: rand(0, TAU),
      age: 0,
      zigzag: d.zigzag,
      magnetized: false,
      mvx: 0,
      mvy: 0,
      missed: false,
    };
  }

  private crystalsFit(cands: readonly SimCrystal[]): boolean {
    for (const c of cands) {
      const tc = this.crystalTrack(c);
      if (!tc) return false;
      for (const o of this.host.obstacles) {
        const to = this.obstacleTrack(o, true);
        if (!to || !rangesOverlap(tc.xs, to.xs, CRYSTAL_CLEAR)) continue;
        if (!this.separated(tc, to, tc.half + to.half + CRYSTAL_CLEAR)) return false;
      }
      // Цепочки не накладываются друг на друга.
      for (const k of this.host.crystals) {
        const tk = this.crystalTrack(k);
        if (!tk || !rangesOverlap(tc.xs, tk.xs, 0)) continue;
        if (!this.separated(tc, tk, tc.half + tk.half + 6)) return false;
      }
    }
    return true;
  }
}
