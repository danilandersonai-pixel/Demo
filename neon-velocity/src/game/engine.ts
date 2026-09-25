/**
 * Игровой движок — чистая симуляция без DOM и без отрисовки. Один экземпляр
 * живёт всё время, режимы переключаются методами:
 *   attract — демо-сцена за меню; playing — забег; dying — взрыв и слоу-мо;
 *   over — забег окончен, фон доживает под экраном Game Over.
 *
 * update(dt) режет кадр на подшаги ≤ GAME.fixedStep (от туннелирования на
 * высокой скорости). Ритм идёт по реальному времени: доли не «плывут» в
 * слоу-мо, а lateBy у события beat точно говорит, насколько раньше конца кадра
 * пересечена граница доли. Генерация (spawner.ts) привязана к долям.
 */
import {
  GAME,
  WORLD_W,
  bpmForLevel,
  crystalYield,
  levelForTime,
  magnetRadius,
  multiplierForChain,
  rareChance,
  shipColors,
  speedMultForLevel,
} from './config';
import { circlesOverlap, obstacleClearance, obstacleExtent, obstacleHitsCircle } from './collision';
import { Autopilot } from './engine-autopilot';
import { Fx } from './engine-fx';
import { type MotionModel, type SimCrystal, type SimObstacle, zigzagOffset } from './engine-motion';
import { clamp, damp } from './math';
import { ParticlePool } from './particles';
import { SHIP_GEOMETRY, SHIP_SIZE } from './shipGeometry';
import { type BeatContext, Spawner } from './spawner';
import type {
  Floater,
  GameEvent,
  GameState,
  HudSnapshot,
  InputState,
  Loadout,
  ObstacleKind,
  RunResult,
  Viewport,
} from './types';
import { heightFactor } from './viewport';

/** Крен корабля — так же, как его рисует рендер (render/ship.ts): поворот и сжатие по X. */
const BANK_ANGLE = 0.3;
const BANK_SQUASH = 0.16;
/** Сфера засчитана пропущенной, уйдя ниже корабля на столько (ARCHITECTURE §4). */
const MISS_MARGIN = 30;
/** Демо-сцена сразу «населена»: столько секунд прогоняется заранее. */
const ATTRACT_PREWARM = 6;
/** Затухание вспышек, сек. */
const FLASH_TIME = 0.25;
const LEVEL_PULSE_TIME = 1;
const HIT_FLASH_TIME = 0.45;
/** Как быстро крен догоняет скорость, 1/с. */
const TILT_RATE = 10;
/** Демо-автопилот ведёт корабль мягче игрока. */
const ATTRACT_FOLLOW = 3.2;
const ATTRACT_MAX_SPEED = 380;
/** Затухание скорости, набранной от магнита, 1/с (без него сферы «вращаются» вокруг корабля). */
const MAGNET_DRAG = 2.5;
/** Как быстро гаснет зигзаг пойманной магнитом сферы, ед/с. */
const MAGNET_ZIGZAG_FADE = 160;
/** Выхлоп двигателя: частиц в секунду на сопло. */
const EXHAUST_RATE = 70;
const FLOATER_LIMIT = 24;
const FLOATER_LIFE = 0.9;
const WHITE = '#ffffff';

export class GameEngine {
  /** Полное состояние мира; рендер читает его каждый кадр. */
  readonly state: GameState;

  private loadout: Loadout;
  private readonly input: InputState = { axis: 0, pointerX: null, lastSource: 'none' };
  private readonly obstacles: SimObstacle[] = [];
  private readonly crystals: SimCrystal[] = [];
  private readonly floaters: Floater[] = [];
  private readonly pool = new ParticlePool(GAME.particles.max);
  private readonly fx = new Fx(this.pool);
  private readonly autopilot = new Autopilot();
  private readonly spawner: Spawner;
  private readonly motion: MotionModel = { hf: 1, mult: 1, multNext: 1, toLevelUp: Infinity };
  private events: GameEvent[] = [];
  private result: RunResult | null = null;
  private idSeq = 1;

  // Ритм — реальные секунды с начала забега или демо-сцены.
  private beatClock = 0;
  private nextBeatAt = 0;
  private lastBeatAt = 0;
  /** Темп нового уровня вступает на ближайшей доле, чтобы такт не рвался. */
  private pendingBpm = 0;

  // Забег.
  private goSent = false;
  private deathTimer = 0;
  private collected = 0;
  private maxMultiplier = 1;
  private maxChain = 0;
  private nearMisses = 0;
  private scoreBonus = 0;
  private yieldMult = 1;
  private rareP = 0;
  private hull = WHITE;
  private core = WHITE;
  private exhaustAcc = 0;
  private trailIndex = 0;
  /** Идёт холостой прогон демо-сцены: частицы корабля всё равно будут стёрты. */
  private prewarming = false;

  constructor(viewport: Viewport, loadout: Loadout) {
    this.loadout = loadout;
    this.spawner = new Spawner({
      obstacles: this.obstacles,
      crystals: this.crystals,
      nextId: () => this.idSeq++,
    });
    const shield = loadout.skin.perks.shieldCharges;
    this.state = {
      mode: 'attract',
      viewport,
      theme: loadout.theme,
      skin: loadout.skin,
      time: 0,
      runTime: 0,
      timeScale: 1,
      level: 1,
      speedMult: GAME.speed.attract,
      levelProgress: 0,
      levelUpPulse: 0,
      scroll: 0,
      bpm: GAME.rhythm.bpmBase,
      beatIndex: -1,
      beatPhase: 0,
      shake: 0,
      flash: 0,
      flashColor: WHITE,
      player: {
        x: WORLD_W / 2,
        y: viewport.worldH - GAME.player.yFromBottom,
        vx: 0,
        radius: GAME.player.radius,
        tilt: 0,
        invuln: 0,
        shieldCharges: shield,
        maxShieldCharges: shield,
        alive: true,
        hitFlash: 0,
      },
      obstacles: this.obstacles,
      crystals: this.crystals,
      particles: this.pool.live,
      floaters: this.floaters,
      magnetRadius: 0,
      score: 0,
      multiplier: 1,
      chain: 0,
      runCrystals: 0,
      highscore: loadout.highscore,
      newRecord: false,
    };
    this.applyLoadout(loadout, true);
    this.startAttract();
  }

  // ─── Публичный контракт ───────────────────────────────────────────────────

  /** Новый размер экрана: пересчитать мир (игрок остаётся внизу, в пределах поля). */
  resize(viewport: Viewport): void {
    const s = this.state;
    const old = s.viewport.worldH;
    s.viewport = viewport;
    const k = viewport.worldH / old;
    // Сцена растягивается по высоте целиком — время подлёта объектов почти не меняется.
    if (Number.isFinite(k) && k > 0 && Math.abs(k - 1) > 1e-6) {
      for (const o of this.obstacles) o.y *= k;
      for (const c of this.crystals) {
        c.y *= k;
        c.mvy *= k;
      }
      for (const f of this.floaters) f.y *= k;
      this.pool.scaleY(k);
    }
    const p = s.player;
    p.y = viewport.worldH - GAME.player.yFromBottom;
    p.x = clamp(p.x, GAME.player.edgePadding, WORLD_W - GAME.player.edgePadding);
  }

  /** Сменить тему/скин без перезапуска (в меню — живое превью покупок). */
  setLoadout(loadout: Loadout): void {
    const s = this.state;
    // Посреди забега перки не меняются — только внешний вид темы.
    const running = s.mode === 'playing' || s.mode === 'dying';
    this.applyLoadout(loadout, !running);
    if (!running) {
      s.player.shieldCharges = s.skin.perks.shieldCharges;
      s.player.maxShieldCharges = s.skin.perks.shieldCharges;
    }
  }

  /** Фоновая демо-сцена для меню: без столкновений, очков и событий, кроме beat. */
  enterAttract(): void {
    if (this.state.mode !== 'attract') this.startAttract();
  }

  /** Начать новый забег с нуля. */
  startRun(loadout: Loadout): void {
    const s = this.state;
    this.applyLoadout(loadout, true);

    // Демо-объекты на экране рассыпаются искрами — забег начинается с чистого поля.
    const h = s.viewport.worldH;
    for (const o of this.obstacles) {
      if (o.y < -60 || o.y > h + 60) continue;
      if (o.kind === 'laser') this.fx.shatter(o, s.theme.colors.laser);
      else this.fx.dissolve(o.x, o.y, this.obstacleColor(o.kind));
    }
    for (const c of this.crystals) {
      if (c.y > -20 && c.y < h + 20) this.fx.dissolve(c.x, c.y, c.rare ? s.theme.colors.crystalRare : s.theme.colors.crystal);
    }
    this.obstacles.length = 0;
    this.crystals.length = 0;
    this.floaters.length = 0;

    s.mode = 'playing';
    s.timeScale = 1;
    s.runTime = 0;
    s.level = 1;
    s.speedMult = speedMultForLevel(1);
    s.bpm = bpmForLevel(1);
    s.levelProgress = 0;
    s.levelUpPulse = 0;
    this.resetPlayer();
    this.resetScore();
    this.resetBeatClock();
    this.goSent = false;
    this.deathTimer = 0;
    this.result = null;
    this.spawner.reset('playing');
    this.events = [];
    this.push({ type: 'runStart' });
  }

  /** Состояние ввода на этот кадр. */
  setInput(input: InputState): void {
    this.input.axis = clamp(Number.isFinite(input.axis) ? input.axis : 0, -1, 1);
    this.input.pointerX = input.pointerX !== null && Number.isFinite(input.pointerX) ? input.pointerX : null;
    this.input.lastSource = input.lastSource;
  }

  /** Продвинуть симуляцию на dt реальных секунд (внутри — подшаги GAME.fixedStep). */
  update(dt: number): void {
    if (!(dt > 0)) return;
    const real = Math.min(dt, GAME.maxFrameDt);
    const steps = Math.max(1, Math.ceil((real * this.state.timeScale) / GAME.fixedStep - 1e-9));
    const hr = real / steps;
    for (let i = 0; i < steps; i++) {
      // timeScale читается на каждом подшаге: смерть посреди кадра сразу включает слоу-мо.
      this.step(hr * this.state.timeScale, hr, real - hr * (i + 1));
    }
  }

  /** Забрать накопленные события (очередь очищается). */
  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Снимок для HUD (fps заполняет GameCanvas). */
  getHud(): HudSnapshot {
    const s = this.state;
    const score = Math.floor(s.score);
    const step = GAME.combo.step;
    return {
      score,
      highscore: Math.max(s.highscore, score),
      multiplier: s.multiplier,
      chain: s.chain,
      chainProgress: s.multiplier >= GAME.combo.maxMultiplier ? 1 : (s.chain % step) / step,
      level: s.level,
      speedMult: s.speedMult,
      levelProgress: s.levelProgress,
      crystals: Math.floor(s.runCrystals + 1e-6),
      shieldCharges: s.player.shieldCharges,
      maxShieldCharges: s.player.maxShieldCharges,
      newRecord: s.newRecord,
      elapsed: s.runTime,
      fps: 0,
    };
  }

  /** Итог последнего завершённого забега или null. */
  getRunResult(): RunResult | null {
    return this.result;
  }

  // ─── Режимы ───────────────────────────────────────────────────────────────

  private applyLoadout(loadout: Loadout, full: boolean): void {
    const s = this.state;
    this.loadout = loadout;
    s.theme = loadout.theme;
    if (full) {
      s.skin = loadout.skin;
      s.magnetRadius = magnetRadius(loadout.skin, loadout.upgrades);
      s.highscore = loadout.highscore;
      this.scoreBonus = loadout.skin.perks.scoreBonus;
      this.yieldMult = crystalYield(loadout.upgrades);
      this.rareP = rareChance(loadout.upgrades);
    }
    const colors = shipColors(s.skin, s.theme);
    this.hull = colors.hull;
    this.core = colors.core;
  }

  private startAttract(): void {
    const s = this.state;
    s.mode = 'attract';
    this.obstacles.length = 0;
    this.crystals.length = 0;
    s.timeScale = 1;
    s.runTime = 0;
    s.level = 1;
    s.speedMult = GAME.speed.attract;
    s.bpm = GAME.rhythm.bpmBase;
    s.levelProgress = 0;
    s.levelUpPulse = 0;
    this.resetPlayer();
    this.resetScore();
    s.highscore = this.loadout.highscore;
    this.resetBeatClock();
    this.spawner.reset('attract');
    this.autopilot.reset();

    // Прогон «вхолостую», чтобы меню открылось с уже летящими объектами.
    const n = Math.round(ATTRACT_PREWARM / GAME.fixedStep);
    this.prewarming = true;
    for (let i = 0; i < n; i++) this.step(GAME.fixedStep, GAME.fixedStep, 0);
    this.prewarming = false;
    this.pool.clear();
    this.floaters.length = 0;
    this.events = [];
    s.shake = 0;
    s.flash = 0;
  }

  private resetPlayer(): void {
    const p = this.state.player;
    p.x = WORLD_W / 2;
    p.y = this.state.viewport.worldH - GAME.player.yFromBottom;
    p.vx = 0;
    p.tilt = 0;
    p.invuln = 0;
    p.shieldCharges = this.state.skin.perks.shieldCharges;
    p.maxShieldCharges = p.shieldCharges;
    p.alive = true;
    p.hitFlash = 0;
  }

  private resetScore(): void {
    const s = this.state;
    s.score = 0;
    s.multiplier = 1;
    s.chain = 0;
    s.runCrystals = 0;
    s.newRecord = false;
    this.collected = 0;
    this.maxMultiplier = 1;
    this.maxChain = 0;
    this.nearMisses = 0;
  }

  private resetBeatClock(): void {
    this.beatClock = 0;
    this.nextBeatAt = 0;
    this.lastBeatAt = 0;
    this.pendingBpm = 0;
    this.state.beatIndex = -1;
    this.state.beatPhase = 0;
  }

  // ─── Шаг симуляции ────────────────────────────────────────────────────────

  /** h — шаг симуляции (с учётом timeScale), hr — реальное время шага, realLeft — сколько реального времени кадра осталось после него. */
  private step(h: number, hr: number, realLeft: number): void {
    const s = this.state;
    s.time += h;
    if (s.mode === 'playing') this.advanceRun(h);
    this.refreshMotion();

    const fall = s.speedMult * this.motion.hf;
    s.scroll += GAME.speed.base * fall * h;
    this.movePlayer(h);
    this.updateObstacles(h, fall);
    this.updateCrystals(h, fall);
    this.advanceBeat(hr, realLeft);

    if (s.mode === 'dying') {
      this.deathTimer += hr;
      if (this.deathTimer >= GAME.death.duration) this.finishRun();
    }

    if (!this.prewarming) {
      this.emitShipParticles(h);
      this.pool.update(h);
    }
    this.updateFloaters(h);

    // Тряска и вспышка гаснут по реальному времени — в слоу-мо отдача не растягивается.
    s.shake = Math.max(0, s.shake - GAME.shake.decay * hr);
    s.flash = Math.max(0, s.flash - hr / FLASH_TIME);
    s.levelUpPulse = Math.max(0, s.levelUpPulse - h / LEVEL_PULSE_TIME);
    const p = s.player;
    p.hitFlash = Math.max(0, p.hitFlash - h / HIT_FLASH_TIME);
    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - h);
  }

  private refreshMotion(): void {
    const s = this.state;
    const m = this.motion;
    m.hf = heightFactor(s.viewport);
    m.mult = s.speedMult;
    if (s.mode === 'playing' && s.player.alive) {
      m.multNext = speedMultForLevel(s.level + 1);
      m.toLevelUp = s.level * GAME.levelDuration - s.runTime;
    } else {
      m.multNext = s.speedMult;
      m.toLevelUp = Infinity;
    }
  }

  private advanceRun(h: number): void {
    const s = this.state;
    s.runTime += h;
    if (!this.goSent && s.runTime >= GAME.startGrace) {
      this.goSent = true;
      this.push({ type: 'go' });
    }
    const target = levelForTime(s.runTime);
    while (s.level < target) this.levelUp(s.level + 1);
    s.levelProgress = clamp((s.runTime - (s.level - 1) * GAME.levelDuration) / GAME.levelDuration, 0, 1);
    // Очки за выживание: perSecond × уровень в секунду (и тоже × комбо).
    if (this.goSent) this.addScore(GAME.score.perSecond * s.level * h);
  }

  private levelUp(level: number): void {
    const s = this.state;
    s.level = level;
    s.speedMult = speedMultForLevel(level);
    this.pendingBpm = bpmForLevel(level);
    s.levelUpPulse = 1;
    this.addShake(GAME.shake.levelUp);
    const grid = s.theme.colors.grid;
    const color = grid[(level - 1) % grid.length];
    s.flash = Math.max(s.flash, 0.35);
    s.flashColor = color;
    this.fx.levelUp(s.player.x, s.player.y, color);
    this.push({ type: 'levelUp', level, speedMult: s.speedMult });
  }

  // ─── Корабль ──────────────────────────────────────────────────────────────

  private movePlayer(h: number): void {
    const s = this.state;
    const p = s.player;
    if (!p.alive) return;
    const minX = GAME.player.edgePadding;
    const maxX = WORLD_W - GAME.player.edgePadding;

    if (s.mode === 'attract') {
      const tx = this.autopilot.target(h, p.x, p.y, this.obstacles, this.crystals, this.motion);
      this.follow(clamp(tx, minX, maxX), ATTRACT_FOLLOW, ATTRACT_MAX_SPEED, h);
    } else if (s.mode === 'playing') {
      const inp = this.input;
      if (inp.lastSource === 'pointer' && inp.pointerX !== null) {
        this.follow(clamp(inp.pointerX, minX, maxX), GAME.player.pointerFollow, GAME.player.pointerMaxSpeed, h);
      } else {
        this.steer(inp.axis, h);
      }
    }

    p.x += p.vx * h;
    if (p.x < minX) {
      p.x = minX;
      if (p.vx < 0) p.vx = 0;
    } else if (p.x > maxX) {
      p.x = maxX;
      if (p.vx > 0) p.vx = 0;
    }
    p.tilt = damp(p.tilt, clamp(p.vx / GAME.player.maxSpeed, -1, 1), TILT_RATE, h);
  }

  /** Клавиатура: ускорение, трение, предел скорости. */
  private steer(axis: number, h: number): void {
    const cfg = GAME.player;
    const p = this.state.player;
    const damping = Math.exp(-cfg.friction * h);
    if (axis !== 0) {
      // Разворот: встречная скорость гасится трением — корабль не «плывёт» в старую сторону.
      if (p.vx * axis < 0) p.vx *= damping;
      p.vx = clamp(p.vx + axis * cfg.accel * h, -cfg.maxSpeed, cfg.maxSpeed);
    } else {
      p.vx *= damping;
    }
  }

  /** Мышь/палец/автопилот: плавное экспоненциальное следование с пределом скорости. */
  private follow(target: number, rate: number, maxSpeed: number, h: number): void {
    const p = this.state.player;
    const k = 1 - Math.exp(-rate * h);
    p.vx = clamp(((target - p.x) * k) / h, -maxSpeed, maxSpeed);
  }

  private emitShipParticles(h: number): void {
    const s = this.state;
    const p = s.player;
    if (!p.alive) return;
    const geo = SHIP_GEOMETRY[s.skin.shape];
    const angle = p.tilt * BANK_ANGLE;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const squash = 1 - Math.abs(p.tilt) * BANK_SQUASH;
    this.exhaustAcc += h * EXHAUST_RATE;
    const puffs = Math.floor(this.exhaustAcc);
    this.exhaustAcc -= puffs;
    const trail = s.skin.perks.trail;
    for (let i = 0; i < geo.engines.length; i++) {
      const lx = geo.engines[i][0] * SHIP_SIZE * squash;
      const ly = geo.engines[i][1] * SHIP_SIZE;
      const wx = p.x + lx * cos - ly * sin;
      const wy = p.y + lx * sin + ly * cos;
      for (let k = 0; k < puffs; k++) this.fx.exhaust(wx, wy, this.hull, this.core);
      // Шлейф — на каждом подшаге из каждого сопла.
      if (trail) this.fx.trail(wx, wy + 2, p.vx, s.theme.colors.trail, this.trailIndex++);
    }
  }

  // ─── Препятствия ──────────────────────────────────────────────────────────

  private obstacleColor(kind: ObstacleKind): string {
    return this.state.theme.colors[kind];
  }

  private updateObstacles(h: number, fall: number): void {
    const s = this.state;
    const p = s.player;
    const list = this.obstacles;
    const bottom = s.viewport.worldH + 40;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      o.age += h;
      o.y += o.vy * fall * h;
      o.rotation += o.spin * h;
      if (o.zigzag) o.x = o.baseX + zigzagOffset(o.zigzag, o.age);
      const half = obstacleExtent(o);
      let keep = true;

      if (s.mode === 'playing' && p.alive && Math.abs(o.y - p.y) < half + p.radius + GAME.nearMissDistance) {
        const clear = obstacleClearance(o, p.x, p.y, p.radius);
        if (clear < o.minClear) o.minClear = clear;
        if (p.invuln <= 0 && obstacleHitsCircle(o, p.x, p.y, p.radius)) {
          this.hit(o);
          keep = false;
        }
      }
      if (keep && !o.passed && o.y - half > p.y + p.radius) {
        o.passed = true;
        this.onDodge(o);
      }
      if (keep && o.y - half > bottom) keep = false;
      if (keep) list[w++] = o;
    }
    list.length = w;
  }

  /** Препятствие пересекло линию корабля: уклонение и, возможно, near miss. */
  private onDodge(o: SimObstacle): void {
    const s = this.state;
    const p = s.player;
    if (s.mode !== 'playing' || !p.alive) return;
    this.addScore(GAME.score.dodge);
    if (o.minClear < 0 || o.minClear >= GAME.nearMissDistance) return;
    this.nearMisses++;
    this.addScore(GAME.score.nearMiss);
    // Сторона, с которой прошло препятствие: у лазера — ближняя кромка прохода.
    const dir = o.kind === 'laser' ? (p.x < o.x ? -1 : 1) : o.x >= p.x ? 1 : -1;
    const color = s.theme.colors.accent3;
    this.fx.nearMiss(p.x, p.y, dir, color);
    this.addShake(GAME.shake.nearMiss);
    this.addFloater(p.x + dir * 30, p.y - 24, 'NEAR MISS', color, 12);
    this.push({ type: 'nearMiss', x: p.x, y: p.y });
  }

  private hit(o: SimObstacle): void {
    const s = this.state;
    const p = s.player;
    const color = this.obstacleColor(o.kind);
    this.fx.shatter(o, color);
    if (p.shieldCharges > 0) {
      p.shieldCharges--;
      p.invuln = GAME.shield.invuln;
      p.hitFlash = 1;
      this.addShake(GAME.shake.shield);
      s.flash = Math.max(s.flash, 0.45);
      s.flashColor = this.hull;
      this.fx.shieldBreak(p.x, p.y, this.hull);
      this.push({ type: 'shieldBreak', x: p.x, y: p.y, chargesLeft: p.shieldCharges });
      this.breakCombo('hit');
      return;
    }
    this.die(color);
  }

  private die(hitColor: string): void {
    const s = this.state;
    const p = s.player;
    p.alive = false;
    p.vx = 0;
    s.mode = 'dying';
    s.timeScale = GAME.death.slowMo;
    this.deathTimer = 0;
    this.addShake(GAME.shake.hit);
    s.flash = 1;
    s.flashColor = WHITE;
    this.fx.death(p.x, p.y, this.hull, this.core, hitColor, s.theme.colors.accent);
    this.push({ type: 'death', x: p.x, y: p.y });
  }

  private finishRun(): void {
    const s = this.state;
    s.mode = 'over';
    s.timeScale = 1;
    this.result = {
      score: Math.floor(s.score),
      level: s.level,
      speedMult: s.speedMult,
      crystals: Math.floor(s.runCrystals + 1e-6),
      crystalsCollected: this.collected,
      maxMultiplier: this.maxMultiplier,
      maxChain: this.maxChain,
      nearMisses: this.nearMisses,
      duration: s.runTime,
      newRecord: s.newRecord,
      skinId: s.skin.id,
    };
    this.push({ type: 'gameOver', result: this.result });
  }

  // ─── Сферы и комбо ────────────────────────────────────────────────────────

  private updateCrystals(h: number, fall: number): void {
    const s = this.state;
    const p = s.player;
    const list = this.crystals;
    const playing = s.mode === 'playing' && p.alive;
    const attract = s.mode === 'attract';
    const R = s.magnetRadius;
    const magnetOn = R > 0 && p.alive && (playing || attract);
    const drag = Math.exp(-MAGNET_DRAG * h);
    const missLine = p.y + p.radius + MISS_MARGIN;
    const bottom = s.viewport.worldH + 40;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      c.age += h;
      c.magnetized = false;
      if (magnetOn && !c.missed) {
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R * R && d2 > 1e-6) {
          // Сила растёт к центру: на краю поля 0, у корабля — GAME.magnet.strength.
          const d = Math.sqrt(d2);
          const a = GAME.magnet.strength * (1 - d / R);
          c.mvx += (dx / d) * a * h;
          c.mvy += (dy / d) * a * h;
          c.magnetized = true;
        }
      }
      c.mvx *= drag;
      c.mvy *= drag;
      c.y += (c.vy * fall + c.mvy) * h;
      c.baseX += c.mvx * h;
      if (c.zigzag && c.magnetized) c.zigzag.amp = Math.max(0, c.zigzag.amp - MAGNET_ZIGZAG_FADE * h);
      c.x = clamp(c.baseX + zigzagOffset(c.zigzag, c.age), c.radius, WORLD_W - c.radius);

      let keep = true;
      if ((playing || attract) && p.alive && circlesOverlap(p.x, p.y, p.radius, c.x, c.y, c.radius)) {
        if (playing) this.collect(c);
        else this.fx.attractPop(c.x, c.y, c.rare ? s.theme.colors.crystalRare : s.theme.colors.crystal);
        keep = false;
      } else if (playing && !c.missed && c.y > missLine) {
        c.missed = true;
        this.breakCombo('miss');
      }
      if (keep && c.y - c.radius > bottom) keep = false;
      if (keep) list[w++] = c;
    }
    list.length = w;
  }

  private collect(c: SimCrystal): void {
    const s = this.state;
    const colors = s.theme.colors;
    s.chain++;
    const prev = s.multiplier;
    s.multiplier = multiplierForChain(s.chain);
    if (s.chain > this.maxChain) this.maxChain = s.chain;
    if (s.multiplier > this.maxMultiplier) this.maxMultiplier = s.multiplier;
    this.collected++;
    const pts = this.addScore(c.rare ? GAME.score.rareCrystal : GAME.score.crystal);
    s.runCrystals += (c.rare ? GAME.crystal.rareCurrency : GAME.crystal.currency) * this.yieldMult;
    const color = c.rare ? colors.crystalRare : colors.crystal;
    this.fx.collect(c.x, c.y, color, c.rare);
    this.addFloater(c.x, c.y - 16, '+' + Math.round(pts), color, c.rare ? 17 : 13);
    this.push({ type: 'collect', rare: c.rare, chain: s.chain, multiplier: s.multiplier, x: c.x, y: c.y });
    if (s.multiplier > prev) {
      const p = s.player;
      this.fx.comboUp(p.x, p.y, colors.accent);
      this.addFloater(p.x, p.y - 44, 'x' + s.multiplier + ' COMBO', colors.accent, 16);
      this.push({ type: 'comboUp', multiplier: s.multiplier });
    }
  }

  private breakCombo(reason: 'hit' | 'miss'): void {
    const s = this.state;
    if (s.chain <= 0) return;
    const lost = s.multiplier;
    s.chain = 0;
    s.multiplier = 1;
    this.push({ type: 'comboBreak', reason, lostMultiplier: lost });
  }

  /** Начислить очки: базовые × комбо × (1 + бонус скина). Возвращает начисленное. */
  private addScore(base: number): number {
    const s = this.state;
    const pts = base * s.multiplier * (1 + this.scoreBonus);
    s.score += pts;
    if (!s.newRecord && s.highscore > 0 && Math.floor(s.score) > s.highscore) {
      s.newRecord = true;
      const gold = s.theme.colors.accent3;
      this.fx.newRecord(s.player.x, s.player.y, gold);
      s.flash = Math.max(s.flash, 0.3);
      s.flashColor = gold;
      this.push({ type: 'newRecord', score: Math.floor(s.score) });
    }
    return pts;
  }

  // ─── Ритм ─────────────────────────────────────────────────────────────────

  private advanceBeat(hr: number, realLeft: number): void {
    const s = this.state;
    this.beatClock += hr;
    while (this.beatClock >= this.nextBeatAt) {
      // Точное опоздание: от границы доли до конца текущего кадра.
      const lateBy = this.beatClock - this.nextBeatAt + realLeft;
      if (this.pendingBpm > 0) {
        s.bpm = this.pendingBpm;
        this.pendingBpm = 0;
      }
      s.beatIndex++;
      this.lastBeatAt = this.nextBeatAt;
      this.nextBeatAt += 60 / s.bpm;
      this.push({ type: 'beat', index: s.beatIndex, bpm: s.bpm, level: s.level, lateBy });
      if (s.mode === 'attract' || (s.mode === 'playing' && s.player.alive)) {
        this.refreshMotion();
        this.spawner.onBeat(this.beatContext());
      }
    }
    const span = this.nextBeatAt - this.lastBeatAt;
    s.beatPhase = span > 0 ? clamp((this.beatClock - this.lastBeatAt) / span, 0, 0.9999) : 0;
  }

  private beatContext(): BeatContext {
    const s = this.state;
    const playing = s.mode === 'playing';
    const period = 60 / s.bpm;
    let periodNext = period;
    let periodSwitchAt = Infinity;
    if (this.pendingBpm > 0) {
      periodNext = 60 / this.pendingBpm;
      periodSwitchAt = 0;
    } else if (playing) {
      periodNext = 60 / bpmForLevel(s.level + 1);
      periodSwitchAt = this.motion.toLevelUp;
    }
    return {
      mode: playing ? 'playing' : 'attract',
      level: s.level,
      motion: this.motion,
      toNextBeat: this.nextBeatAt - this.beatClock,
      period,
      periodNext,
      periodSwitchAt,
      playerY: s.player.y,
      graceLeft: playing ? Math.max(0, GAME.startGrace - s.runTime) : 0,
      rareChance: this.rareP,
    };
  }

  // ─── Отдача ───────────────────────────────────────────────────────────────

  private addShake(amount: number): void {
    this.state.shake = Math.min(1, this.state.shake + amount);
  }

  private addFloater(x: number, y: number, text: string, color: string, size: number): void {
    if (this.floaters.length >= FLOATER_LIMIT) this.floaters.shift();
    this.floaters.push({ x, y, vy: -70, text, color, life: FLOATER_LIFE, maxLife: FLOATER_LIFE, size });
  }

  private updateFloaters(h: number): void {
    const list = this.floaters;
    const drag = Math.exp(-2 * h);
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      f.life -= h;
      if (f.life <= 0) continue;
      f.y += f.vy * h;
      f.vy *= drag;
      list[w++] = f;
    }
    list.length = w;
  }

  private push(event: GameEvent): void {
    this.events.push(event);
  }
}
