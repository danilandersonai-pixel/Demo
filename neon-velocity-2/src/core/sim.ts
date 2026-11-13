/**
 * Симуляция — правила игры (SPEC §4). Чистая функция от зерна и ввода: ни DOM,
 * ни Math.random, ни реального времени; один step() — ровно один тик (1/128 с).
 *
 * Порядок событий внутри тика фиксирован (на него опираются звук и HUD):
 *   1) go | gameOver → levelUp → beat → newRecord (если рекорд побит очками за долю);
 *   2) по сферам в порядке прилёта: comboUp → overdrive(on) → collect → newRecord
 *      либо miss → comboBreak → overdrive(off);
 *   3) по препятствиям в порядке прилёта: shieldBreak → comboBreak → overdrive(off),
 *      либо death, либо dodge → newRecord.
 *
 * Поле x у событий: collect / miss — X сферы; shieldBreak / death — X корабля
 * (точка удара); dodge — ближайшая к кораблю точка препятствия (у лазера —
 * ближний край прохода), туда рендер может ставить искры near miss.
 *
 * Решения там, где спецификация молчит:
 *  • attract — уровень всегда 1, все объекты летят с подлётом 1-го уровня:
 *    сцена за меню не ускоряется, сколько бы меню ни было открыто;
 *  • после гибели level / speedMult / levelProgress замирают, levelUp не приходит;
 *  • препятствие, прошедшее сквозь неуязвимый корабль, засчитывается как
 *    уклонение, но не как near miss (его minClear отрицательный).
 *
 * В установившемся режиме step() сам память не выделяет: массивы состояния
 * уплотняются на месте, контакт считается во временный объект. Новые объекты —
 * только события и сущности очередного такта (раз в 240 тиков).
 */
import { createChart } from './chartgen';
import { contactAt, depthReach, type Contact } from './collision';
import { BASE_SIM_LOADOUT, GAME, multiplierForChain, speedMultForLevel, WORLD } from './config';
import { approach, clamp, smoothstep } from './math';
import { crystalBaseX, depthAt, obstacleX, pickupReach } from './motion';
import { Autopilot } from './sim-autopilot';
import { ChartFeed } from './sim-feed';
import { restShip, steerShip } from './sim-ship';
import {
  barAtTick,
  beatAtTick,
  beatInBar,
  LEAD_IN_TICKS,
  levelAtTick,
  levelProgressAtTick,
  TICK_DT,
  TICK_RATE,
  TICKS_PER_BEAT,
} from './timing';
import type {
  ChartSource,
  Crystal,
  HudSnapshot,
  InputFrame,
  Obstacle,
  RunResult,
  SimEvent,
  SimLoadout,
  SimMode,
  SimState,
} from './types';

const CENTER = WORLD.roadW / 2;
/** Наибольший сдвиг сферы магнитом за тик. */
const MAGNET_STEP = GAME.magnet.pullSpeed * TICK_DT;
/** Целая валюта × дробный множитель резонатора может выйти на волосок ниже целого: запас, чтобы 6.999…9 не стало 6. */
const CURRENCY_EPS = 1e-9;
/** Фоновая сцена летит на скорости 1-го уровня и не ускоряется. */
const ATTRACT_APPROACH = GAME.approach.base;
/** Фоновая сцена: первые три доли без препятствий — автопилот успевает отойти. */
const ATTRACT_CLEAR_TICKS = 3 * TICKS_PER_BEAT;
/** Общий пустой ответ drainEvents: заморожен, чтобы случайная запись в него не осталась незамеченной. */
const NO_EVENTS = Object.freeze<SimEvent[]>([]) as SimEvent[];

function createState(): SimState {
  return {
    mode: 'attract',
    seed: 0,
    tick: 0,
    timeScale: 1,
    level: 1,
    speedMult: 1,
    levelProgress: 0,
    player: { x: CENTER, prevX: CENTER, vx: 0, bank: 0, alive: true, shield: 0, shieldMax: 0, invulnTicks: 0 },
    obstacles: [],
    crystals: [],
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
  };
}

/**
 * Детерминированная симуляция игры: без DOM, без Math.random, без реального
 * времени. Один вызов step() — ровно один тик (1/128 с).
 */
export class Simulation {
  /**
   * Полное состояние; меняет его только сама симуляция. Объект, его player и
   * массивы живут всё время жизни симуляции — ссылку можно держать между забегами.
   * До первого startAttract / startRun это пустая фоновая сцена.
   */
  readonly state: SimState = createState();

  private readonly feed = new ChartFeed();
  private readonly autopilot = new Autopilot();
  private readonly contact: Contact = { inRange: false, clear: Infinity };
  private events: SimEvent[] = [];
  /** 1 + бонус корабля к очкам. */
  private scoreFactor = 1;
  private crystalYield = 1;
  /** Валюта забега до множителя резонатора — целая, поэтому не копит ошибку округления. */
  private currencyUnits = 0;
  private deathTick = 0;
  /** Тик, на котором забег закончился (смерть или отказ); null — ещё идёт. */
  private endTick: number | null = null;
  private finalResult: RunResult | null = null;

  /** Фоновая сцена для меню: tick = 0, корабль на автопилоте, без столкновений, очков и событий, кроме beat. */
  startAttract(seed: number): void {
    // Трек создаётся первым: если генератор бросит исключение, прежняя сцена останется целой.
    const chart = createChart(seed, { rareChance: BASE_SIM_LOADOUT.rareChance, attract: true });
    this.begin('attract', seed, 0, BASE_SIM_LOADOUT);
    this.feed.reset(chart, ATTRACT_APPROACH, ATTRACT_CLEAR_TICKS);
    this.autopilot.reset();
    this.beat(0);
    this.feedRoad(0);
  }

  /**
   * Новый забег: tick = −LEAD_IN_TICKS, режим ready. Сразу кладёт в очередь
   * события ready и beat первого тика. chart по умолчанию —
   * createChart(seed, { rareChance: loadout.rareChance }).
   */
  startRun(seed: number, loadout: SimLoadout, chart?: ChartSource): void {
    const source = chart ?? createChart(seed, { rareChance: loadout.rareChance });
    this.begin('ready', seed, -LEAD_IN_TICKS, loadout);
    this.feed.reset(source);
    this.events.push({ type: 'ready', tick: -LEAD_IN_TICKS });
    this.beat(-LEAD_IN_TICKS);
    this.feedRoad(-LEAD_IN_TICKS);
  }

  /** Продвинуть симуляцию ровно на один тик. */
  step(input: InputFrame): void {
    const s = this.state;
    const tick = s.tick + 1;
    s.tick = tick;

    // 1–2. Часы забега, смена режима, ритм.
    if (this.runIsLive()) this.advanceRun(tick);
    else if (s.mode === 'dying' && tick - this.deathTick >= GAME.death.ticks) this.finish(tick);
    if (tick % TICKS_PER_BEAT === 0) this.beat(tick);

    // 3. Трек: новые такты и появление объектов. После конца забега дорога только доигрывает запрошенное.
    if (s.mode === 'over') this.feed.spawn(tick, s.obstacles, s.crystals);
    else this.feedRoad(tick);

    // 4. Корабль.
    const p = s.player;
    p.prevX = p.x;
    if (s.mode === 'attract') this.autopilot.drive(s);
    else if (this.runIsLive()) steerShip(p, input);
    else restShip(p);

    // 5–7. Сферы; столкновения и уклонения; уход объектов за корабль.
    this.updateCrystals(tick);
    this.updateObstacles(tick);
  }

  /**
   * Забрать накопленные события (очередь очищается). Возвращённый массив
   * принадлежит вызывающему; пустой ответ — общий замороженный массив.
   */
  drainEvents(): SimEvent[] {
    if (this.events.length === 0) return NO_EVENTS;
    const drained = this.events;
    this.events = [];
    return drained;
  }

  /** Снимок для HUD (fps заполняет хост). Каждый вызов — новый объект. */
  hud(): HudSnapshot {
    const s = this.state;
    const atMax = s.multiplier >= GAME.combo.maxMultiplier;
    return {
      score: s.score,
      highscore: Math.max(s.highscore, s.score),
      multiplier: s.multiplier,
      chain: s.chain,
      chainProgress: atMax ? 1 : (s.chain % GAME.combo.step) / GAME.combo.step,
      overdrive: s.overdrive,
      level: s.level,
      speedMult: s.speedMult,
      levelProgress: s.levelProgress,
      crystals: this.wholeCrystals(),
      shield: s.player.shield,
      shieldMax: s.player.shieldMax,
      newRecord: s.newRecord,
      elapsed: this.elapsedSeconds(),
      fps: 0,
    };
  }

  /** Итог завершённого забега (после gameOver) или null. Брошенный забег отдаёт итог только через abandon(). */
  result(): RunResult | null {
    return this.finalResult;
  }

  /**
   * Итог забега, который игрок бросил (пауза → меню / заново, закрытие вкладки).
   * null, если забега нет, он уже завершён или в нём ещё ничего не заработано.
   * Незавершённый забег в любом случае переходит в over; события gameOver не будет.
   */
  abandon(): RunResult | null {
    const s = this.state;
    if (s.mode !== 'ready' && s.mode !== 'playing' && s.mode !== 'dying') return null;
    if (this.endTick === null) this.endTick = s.tick;
    s.mode = 'over';
    s.timeScale = 1;
    if (s.tick <= 0 || (s.score === 0 && s.crystalsCollected === 0)) return null;
    return this.buildResult();
  }

  // ─── Старт ────────────────────────────────────────────────────────────────

  /** Привести состояние к началу сцены. Объекты состояния переиспользуются. */
  private begin(mode: SimMode, seed: number, tick: number, loadout: SimLoadout): void {
    const s = this.state;
    s.mode = mode;
    s.seed = seed;
    s.tick = tick;
    s.timeScale = 1;
    s.level = 1;
    s.speedMult = 1;
    s.levelProgress = 0;
    const p = s.player;
    p.x = CENTER;
    p.prevX = CENTER;
    p.vx = 0;
    p.bank = 0;
    p.alive = true;
    p.shield = Math.max(0, Math.floor(loadout.shieldCharges));
    p.shieldMax = p.shield;
    p.invulnTicks = 0;
    s.obstacles.length = 0;
    s.crystals.length = 0;
    s.score = 0;
    s.chain = 0;
    s.multiplier = 1;
    s.overdrive = false;
    s.runCrystals = 0;
    s.crystalsCollected = 0;
    s.dodged = 0;
    s.nearMisses = 0;
    s.maxMultiplier = 1;
    s.maxChain = 0;
    s.magnetRadius = Math.max(0, loadout.magnetRadius);
    s.highscore = loadout.highscore;
    s.newRecord = false;
    this.scoreFactor = 1 + loadout.scoreBonus;
    this.crystalYield = loadout.crystalYield;
    this.currencyUnits = 0;
    this.deathTick = 0;
    this.endTick = null;
    this.finalResult = null;
    // Этот массив ещё никому не отдавали (drainEvents подменяет очередь), чистить его безопасно.
    this.events.length = 0;
  }

  // ─── Шаги 1–3: время, ритм, трек ──────────────────────────────────────────

  /** Игрок ещё управляет кораблём: вступление или сам забег. */
  private runIsLive(): boolean {
    const mode = this.state.mode;
    return mode === 'ready' || mode === 'playing';
  }

  /** Уровень скорости и команда GO. После гибели уровень замирает — итог и HUD показывают, докуда дошли. */
  private advanceRun(tick: number): void {
    const s = this.state;
    s.levelProgress = levelProgressAtTick(tick);
    if (tick === 0) {
      s.mode = 'playing';
      this.events.push({ type: 'go', tick });
    }
    const level = levelAtTick(tick);
    if (level !== s.level) {
      s.level = level;
      s.speedMult = speedMultForLevel(level);
      this.events.push({ type: 'levelUp', tick, level, speedMult: s.speedMult });
    }
  }

  private beat(tick: number): void {
    const s = this.state;
    this.events.push({ type: 'beat', tick, beat: beatAtTick(tick), bar: barAtTick(tick), beatInBar: beatInBar(tick), level: s.level });
    if (s.mode === 'playing' && tick > 0) {
      this.award(GAME.score.perBeat * s.level);
      this.checkRecord(tick);
    }
  }

  private feedRoad(tick: number): void {
    this.feed.request(tick);
    this.feed.spawn(tick, this.state.obstacles, this.state.crystals);
  }

  // ─── Шаг 5: сферы ─────────────────────────────────────────────────────────

  private updateCrystals(tick: number): void {
    const s = this.state;
    const list = s.crystals;
    const px = s.player.x;
    const interactive = s.mode === 'playing' || s.mode === 'attract';
    const magnet = s.magnetRadius;
    let kept = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const z = depthAt(c.arriveTick, c.approachTicks, tick);
      if (z < -WORLD.zBehind) continue;
      if (kept !== i) list[kept] = c;
      kept += 1;
      c.prevPull = c.pull;
      if (!interactive || c.state !== 'live') continue;

      const reach = pickupReach(c.rare);
      const pulled = magnet > 0 && c.arriveTick - tick <= GAME.magnet.leadTicks;
      if (z > reach && !pulled) continue;
      const baseX = crystalBaseX(c, tick);
      if (pulled) {
        const gap = Math.abs(px - baseX - c.pull);
        // Сила плавно спадает к краю поля: сфера у самой границы едва шевелится.
        if (gap <= magnet) c.pull = approach(c.pull, px - baseX, MAGNET_STEP * (1 - smoothstep(0, 1, gap / magnet)));
      }
      const x = baseX + c.pull;
      if (z < -reach) this.miss(c, x, tick);
      else if (z <= reach && Math.abs(px - x) <= reach) this.collect(c, x, tick);
    }
    if (kept !== list.length) list.length = kept;
  }

  private collect(c: Crystal, x: number, tick: number): void {
    const s = this.state;
    c.state = 'taken';
    // В фоновой сцене сфера просто исчезает: ни очков, ни событий.
    if (s.mode !== 'playing') return;

    s.crystalsCollected += 1;
    s.chain += 1;
    if (s.chain > s.maxChain) s.maxChain = s.chain;
    const multiplier = multiplierForChain(s.chain);
    if (multiplier > s.multiplier) {
      s.multiplier = multiplier;
      if (multiplier > s.maxMultiplier) s.maxMultiplier = multiplier;
      this.events.push({ type: 'comboUp', tick, multiplier });
      if (multiplier >= GAME.combo.maxMultiplier) {
        s.overdrive = true;
        this.events.push({ type: 'overdrive', tick, on: true });
      }
    }
    // Очки — уже с новым множителем (и с бонусом OVERDRIVE, если он только что включился).
    const points = this.award(c.rare ? GAME.score.rareCrystal : GAME.score.crystal);
    this.currencyUnits += c.rare ? GAME.crystal.rareCurrency : GAME.crystal.currency;
    s.runCrystals = this.currencyUnits * this.crystalYield;
    this.events.push({ type: 'collect', tick, x, rare: c.rare, chain: s.chain, multiplier: s.multiplier, note: c.note, points });
    this.checkRecord(tick);
  }

  private miss(c: Crystal, x: number, tick: number): void {
    c.state = 'missed';
    if (this.state.mode !== 'playing') return;
    this.events.push({ type: 'miss', tick, x });
    this.breakCombo('miss', tick);
  }

  private breakCombo(reason: 'hit' | 'miss', tick: number): void {
    const s = this.state;
    if (s.chain === 0) return;
    this.events.push({ type: 'comboBreak', tick, reason, lost: s.multiplier });
    s.chain = 0;
    s.multiplier = 1;
    if (s.overdrive) {
      s.overdrive = false;
      this.events.push({ type: 'overdrive', tick, on: false });
    }
  }

  // ─── Шаги 6–7: препятствия ────────────────────────────────────────────────

  private updateObstacles(tick: number): void {
    const s = this.state;
    const list = s.obstacles;
    const p = s.player;
    if (s.mode === 'playing' && p.invulnTicks > 0) p.invulnTicks -= 1;
    // Где корабль был полтика назад — там его и рисовал рендер.
    const midX = (p.prevX + p.x) / 2;
    let kept = 0;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const z = depthAt(o.arriveTick, o.approachTicks, tick);
      if (z < -WORLD.zBehind) continue;
      if (kept !== i) list[kept] = o;
      kept += 1;
      if (o.resolved || s.mode !== 'playing') continue;

      const reach = depthReach(o);
      // Объект ещё не дошёл до корабля: полтика назад он был только дальше.
      if (z > reach) continue;
      // Две пробы за тик — тонкие пилы и лучи не проскакивают корабль на высокой скорости.
      // Глубина пробы считается так же, как внутри contactAt: вне полосы контакта проба не нужна.
      if (Math.abs(depthAt(o.arriveTick, o.approachTicks, tick - 0.5)) <= reach) this.touch(o, tick - 0.5, midX, tick);
      if (o.resolved || !p.alive) continue;
      if (z >= -reach) this.touch(o, tick, p.x, tick);
      else this.dodge(o, tick);
    }
    if (kept !== list.length) list.length = kept;
  }

  /** Проба контакта в момент t (корабль в точке x): зазор для near miss, щит или гибель. */
  private touch(o: Obstacle, t: number, x: number, tick: number): void {
    const c = contactAt(o, t, x, this.contact);
    // Последнее слово о полосе контакта — за contactAt: вне её зазор не определён.
    if (!c.inRange) return;
    // Отрицательный зазор тоже запоминается: объект, прошедший сквозь неуязвимый корабль, — не near miss.
    if (c.clear < o.minClear) o.minClear = c.clear;
    const p = this.state.player;
    if (c.clear >= 0 || p.invulnTicks > 0) return;
    if (p.shield > 0) this.breakShield(o, tick);
    else this.die(o, tick);
  }

  private breakShield(o: Obstacle, tick: number): void {
    const p = this.state.player;
    p.shield -= 1;
    p.invulnTicks = GAME.shield.invulnTicks;
    o.destroyed = true;
    o.resolved = true;
    this.events.push({ type: 'shieldBreak', tick, x: p.x, kind: o.kind, left: p.shield });
    this.breakCombo('hit', tick);
  }

  private die(o: Obstacle, tick: number): void {
    const s = this.state;
    s.player.alive = false;
    s.mode = 'dying';
    s.timeScale = GAME.death.timeScale;
    this.deathTick = tick;
    this.endTick = tick;
    this.events.push({ type: 'death', tick, x: s.player.x, kind: o.kind });
  }

  private dodge(o: Obstacle, tick: number): void {
    const s = this.state;
    o.resolved = true;
    s.dodged += 1;
    const near = o.minClear >= 0 && o.minClear < GAME.nearMissClear;
    if (near) s.nearMisses += 1;
    const points = this.award(GAME.score.dodge + (near ? GAME.score.nearMiss : 0));
    this.events.push({ type: 'dodge', tick, x: this.nearestPoint(o, tick), kind: o.kind, near, points });
    this.checkRecord(tick);
  }

  /** Ближайшая к кораблю точка препятствия по x: у лазера — ближний край прохода. */
  private nearestPoint(o: Obstacle, tick: number): number {
    const px = this.state.player.x;
    const ox = obstacleX(o, tick);
    if (o.kind === 'laser') return px < ox ? ox - o.halfW : ox + o.halfW;
    const half = o.halfW * (o.kind === 'cube' ? GAME.hitbox.cube : GAME.hitbox.saw);
    return clamp(px, ox - half, ox + half);
  }

  // ─── Очки и итог ──────────────────────────────────────────────────────────

  /** Начислить очки за базу с текущими множителями; возвращает начисленное (целое). */
  private award(base: number): number {
    const s = this.state;
    const points = Math.round(base * s.multiplier * (s.overdrive ? GAME.combo.overdriveBonus : 1) * this.scoreFactor);
    s.score += points;
    return points;
  }

  /** NEW RECORD — один раз за забег, в момент, когда счёт обгоняет прошлый рекорд. */
  private checkRecord(tick: number): void {
    const s = this.state;
    if (s.newRecord || s.highscore <= 0 || s.score <= s.highscore) return;
    s.newRecord = true;
    this.events.push({ type: 'newRecord', tick, score: s.score });
  }

  /** Взрыв отыграл: забег окончен. */
  private finish(tick: number): void {
    const s = this.state;
    s.mode = 'over';
    s.timeScale = 1;
    this.finalResult = this.buildResult();
    this.events.push({ type: 'gameOver', tick, result: this.finalResult });
  }

  private wholeCrystals(): number {
    return Math.floor(this.state.runCrystals + CURRENCY_EPS);
  }

  /** Секунды от GO; после конца забега время стоит. */
  private elapsedSeconds(): number {
    return Math.max(0, this.endTick ?? this.state.tick) / TICK_RATE;
  }

  private buildResult(): RunResult {
    const s = this.state;
    return {
      score: s.score,
      level: s.level,
      speedMult: s.speedMult,
      crystals: this.wholeCrystals(),
      crystalsCollected: s.crystalsCollected,
      maxMultiplier: s.maxMultiplier,
      maxChain: s.maxChain,
      nearMisses: s.nearMisses,
      dodged: s.dodged,
      duration: this.elapsedSeconds(),
      newRecord: s.newRecord,
      seed: s.seed,
    };
  }
}
