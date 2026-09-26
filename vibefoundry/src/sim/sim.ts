import { BUILDINGS, BELTLIKE, STORAGE_TYPES, type BuildingType } from '../data/buildings';
import { ITEM_INDEX, ITEM_BY_INDEX, type ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import { TECHS, type TechEffects } from '../data/research';
import { Deco } from '../data/biomes';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { DX, DY, type Dir } from '../core/iso';
import { World, type WorldData } from '../world/world';
import { generateWorld } from '../world/worldgen';
import { BeltStore, type BeltStoreData } from './beltStore';
import { Stats, type StatsData } from './stats';
import { RUNTIME_KEYS, type Drone, type Enemy, type Entity, type PowerNetStats, type Toast } from './types';
import { rebuildPower, updatePower } from './power';
import { rebuildBeltLinks, updateBelts, updateInserters } from './logistics';
import { updateMachines } from './machines';
import { rebuildFluids, distributeFluids, type FluidNet } from './fluids';
import { updateDrones, droneRangeOk } from './drones';
import { updateEnemies } from './enemies';
import { newAIState, type AIState, type ChatMsg } from '../ai/state';
import { updateAI, aiEverySecond } from '../ai/ai';
import { GitState, newGitState } from '../vibe/git';
import { ScriptRuntime } from '../script/runtime';
import { QuestState, newQuestState, updateQuests } from './quests';
import { architectBuild } from '../ai/architect';
import { worldEvents } from './worldEvents';
import { initGit } from '../vibe/vibe';

export interface SimEvents extends Record<string, unknown> {
  toast: Toast;
  built: Entity;
  removed: Entity;
  research: { id: string };
  era: { era: number };
  quest: { id: string; done: boolean };
  victory: Record<string, never>;
  chat: ChatMsg;
  sound: { name: string };
  fx: { kind: 'build' | 'explode' | 'spark' | 'shot' | 'reveal'; x: number; y: number; x2?: number; y2?: number };
}

export interface Settings {
  peaceful: boolean;
  hallucinations: boolean;
  instantBuild: boolean;
  difficulty: number;
}

export interface ResearchState {
  done: string[];
  current: string | null;
  progress: Record<string, number>;
  queue: string[];
}

export interface NewGameOptions {
  seed: number;
  size?: number;
  peaceful?: boolean;
  /** Skip starting quests/HQ (tests). */
  bare?: boolean;
}

export const DT = 1 / 60;
export const DAY_LENGTH = 480;
export const SAVE_VERSION = 3;

export interface SimSnapshot {
  version: number;
  tick: number;
  seed: number;
  rng: number;
  nextId: number;
  entities: Entity[];
  belts: BeltStoreData;
  world: {
    w: number; h: number; seed: number; biome: string; height: string; res: string; amt: string; deco: string; fog: string;
    pois: WorldData['pois']; deposits: WorldData['deposits']; base: WorldData['base']; nests: WorldData['nests'];
  };
  drones: Drone[];
  enemies: Enemy[];
  nextDroneId: number;
  stats: StatsData;
  research: ResearchState;
  groups: Record<string, number[]>;
  settings: Settings;
  dayTime: number;
  day: number;
  ai: AIState;
  git: GitState;
  quests: QuestState;
  flags: Record<string, any>;
  scriptState: Record<string, Record<string, any>>;
}

export class Sim {
  world: World;
  belts: BeltStore;
  ents = new Map<number, Entity>();
  list: Entity[] = [];
  tick = 0;
  rng: Rng;
  seed: number;
  nextId = 1;
  events = new EventBus<SimEvents>();
  drones: Drone[] = [];
  enemies: Enemy[] = [];
  nextDroneId = 1;
  stats = new Stats();
  research: ResearchState = { done: [], current: null, progress: {}, queue: [] };
  doneSet = new Set<string>();
  effects: Required<TechEffects> = { beltSpeed: 0, inserterSpeed: 0, miningProd: 0, craftSpeed: 0, hallucination: 0, context: 0, droneSpeed: 0 };
  groups: Record<string, number[]> = {};
  settings: Settings = { peaceful: false, hallucinations: true, instantBuild: false, difficulty: 1 };
  dayTime = 0.3 * DAY_LENGTH;
  day = 1;
  ai: AIState = newAIState();
  git: GitState = newGitState();
  scripts: ScriptRuntime;
  quests: QuestState = newQuestState();
  flags: Record<string, any> = {};
  headless = false;

  // derived
  topoDirty = true;
  topoVersion = 0;
  powerNets: PowerNetStats[] = [];
  mainNet = -1;
  fluidNets: FluidNet[] = [];
  supply: Int32Array;
  hq: Entity | null = null;
  limits = new Map<string, number>();
  routeInfo: { item: string; group: string; splitters: number }[] = [];
  /** Per-splitter filters from scripts: entity id → item → output index. */
  splitterFilters = new Map<number, Map<number, number>>();
  /** Item indices distributed round-robin by all splitters (balance()). */
  splitterBalance = new Set<number>();
  /** Architect hook for build(blueprint, near) in scripts (installed by the vibe layer). */
  architect?: (name: string, near: string, agent: string) => boolean;
  /** Crafts completed in the last second per tile-chunk (for data collectors). */
  craftEvents: { x: number; y: number }[] = [];
  lastProdScore = 0;
  manualTouch = 0;
  /** Stock snapshot for limit() checks (per instance: sandbox clones must not share it). */
  stockCache: { tick: number; data: Record<string, number> } = { tick: -1e9, data: {} };

  constructor(world: World, seed: number) {
    this.world = world;
    this.seed = seed;
    this.rng = new Rng(seed ^ 0x5eed);
    this.belts = new BeltStore(512);
    this.supply = new Int32Array(world.w * world.h);
    this.scripts = new ScriptRuntime();
    this.architect = (name, near) => architectBuild(this, name, near);
  }

  static newGame(opts: NewGameOptions): Sim {
    const world = generateWorld({ seed: opts.seed, size: opts.size });
    const sim = new Sim(world, opts.seed);
    sim.settings.peaceful = !!opts.peaceful;
    const b = world.base;
    const hq = sim.createEntity('hq', b.x - 2, b.y - 2, 2, false);
    sim.hq = hq;
    hq.store = {
      iron_plate: 320, copper_plate: 160, gear: 90, stone_brick: 90, iron_ore: 0,
    };
    hq.storeTotal = 660;
    for (let i = 0; i < 2; i++) sim.addDrone('construction', hq.id);
    initGit(sim);
    updateQuests(sim);
    return sim;
  }

  // ---------------------------------------------------------------- time
  get time(): number {
    return this.tick * DT;
  }
  /** 0..1 fraction of the day. */
  get dayFrac(): number {
    return this.dayTime / DAY_LENGTH;
  }
  get isNight(): boolean {
    const f = this.dayFrac;
    return f > 0.72 || f < 0.06;
  }
  /** 0 (night) .. 1 (noon) light level for solar and rendering. */
  get daylight(): number {
    const f = this.dayFrac;
    if (f < 0.06) return 0.05;
    if (f < 0.14) return 0.05 + ((f - 0.06) / 0.08) * 0.95;
    if (f < 0.62) return 1;
    if (f < 0.72) return 1 - ((f - 0.62) / 0.1) * 0.95;
    return 0.05;
  }
  clockText(): string {
    const hours = (this.dayFrac * 24 + 6) % 24;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // --------------------------------------------------------------- research
  isUnlocked(tech: string | undefined): boolean {
    return !tech || this.doneSet.has(tech);
  }
  buildingUnlocked(t: BuildingType): boolean {
    return this.isUnlocked(BUILDINGS[t].unlock);
  }
  completeResearch(id: string): void {
    if (this.doneSet.has(id)) return;
    this.research.done.push(id);
    this.doneSet.add(id);
    if (this.research.current === id) this.research.current = this.research.queue.shift() ?? null;
    this.recomputeEffects();
    const t = TECHS[id];
    this.events.emit('research', { id });
    this.events.emit('toast', { kind: 'info', title: 'Доступна новая технология', text: t?.name ?? id, key: 'tech-' + id });
    this.events.emit('sound', { name: 'tech' });
  }
  recomputeEffects(): void {
    const e = { beltSpeed: 0, inserterSpeed: 0, miningProd: 0, craftSpeed: 0, hallucination: 0, context: 0, droneSpeed: 0 };
    for (const id of this.research.done) {
      const fx = TECHS[id]?.effects;
      if (!fx) continue;
      for (const k of Object.keys(fx) as (keyof TechEffects)[]) e[k] += fx[k] ?? 0;
    }
    this.effects = e;
  }

  // --------------------------------------------------------------- storage
  storages(): Entity[] {
    const out: Entity[] = [];
    for (const e of this.list) if (!e.ghost && STORAGE_TYPES.has(e.type)) out.push(e);
    return out;
  }
  stock(item: string): number {
    let s = 0;
    for (const e of this.list) if (e.store && !e.ghost) s += e.store[item] ?? 0;
    return s;
  }
  stockAll(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.list) {
      if (!e.store || e.ghost) continue;
      for (const k in e.store) out[k] = (out[k] ?? 0) + e.store[k];
    }
    return out;
  }
  hasStock(cost: { item: string; n: number }[]): boolean {
    for (const c of cost) if (this.stock(c.item) < c.n) return false;
    return true;
  }
  takeStock(cost: { item: string; n: number }[]): boolean {
    if (!this.hasStock(cost)) return false;
    for (const c of cost) {
      let need = c.n;
      for (const e of this.list) {
        if (!e.store || e.ghost || need <= 0) continue;
        const have = e.store[c.item] ?? 0;
        const take = Math.min(have, need);
        if (take > 0) {
          e.store[c.item] = have - take;
          e.storeTotal = (e.storeTotal ?? 0) - take;
          need -= take;
        }
      }
    }
    return true;
  }
  /** Adds to HQ first, then any storage with room. Returns amount stored. */
  addStock(item: string, n: number): number {
    let left = n;
    const targets = this.hq ? [this.hq, ...this.storages().filter((s) => s !== this.hq)] : this.storages();
    for (const s of targets) {
      if (left <= 0) break;
      const cap = BUILDINGS[s.type].storage ?? 0;
      const room = cap - (s.storeTotal ?? 0);
      const put = Math.min(room, left);
      if (put > 0) {
        s.store![item] = (s.store![item] ?? 0) + put;
        s.storeTotal = (s.storeTotal ?? 0) + put;
        left -= put;
      }
    }
    return n - left;
  }

  // ------------------------------------------------------------- placement
  entityAt(x: number, y: number): Entity | undefined {
    if (!this.world.inBounds(x, y)) return undefined;
    const id = this.world.occ[this.world.idx(x, y)];
    return id ? this.ents.get(id) : undefined;
  }

  canPlace(type: BuildingType, x: number, y: number, dir: Dir, force = false): { ok: boolean; reason?: string } {
    const def = BUILDINGS[type];
    if (!def) return { ok: false, reason: 'Неизвестное здание' };
    if (!force && def.hidden) return { ok: false, reason: 'Нельзя построить' };
    if (!force && !this.isUnlocked(def.unlock)) return { ok: false, reason: 'Требуется исследование: ' + (TECHS[def.unlock!]?.name ?? def.unlock) };
    if (type === 'spire' && this.list.some((e) => e.type === 'spire')) return { ok: false, reason: 'Шпиль уже строится' };
    let resTiles = 0;
    let oilTiles = 0;
    for (let yy = y; yy < y + def.h; yy++) {
      for (let xx = x; xx < x + def.w; xx++) {
        if (!this.world.inBounds(xx, yy)) return { ok: false, reason: 'За краем карты' };
        const i = this.world.idx(xx, yy);
        if (this.world.isWaterAt(xx, yy)) return { ok: false, reason: 'Нельзя строить на воде' };
        if (this.world.occ[i]) return { ok: false, reason: 'Место занято' };
        if (!force && !this.world.fog[i]) return { ok: false, reason: 'Неразведанная территория' };
        const r = this.world.resourceAt(xx, yy);
        if (r === 'oil') oilTiles++;
        else if (r) resTiles++;
      }
    }
    if (type === 'drill') {
      if (!resTiles) return { ok: false, reason: 'Бур ставится на месторождение руды' };
      const r = this.drillResource(x, y, def.w, def.h);
      if (r === 'rare_earth' && !this.isUnlocked('rare_earth')) return { ok: false, reason: 'Требуется исследование: Редкоземы' };
      if (r === 'uranium_ore' && !this.isUnlocked('uranium')) return { ok: false, reason: 'Требуется исследование: Урановая обработка' };
    }
    if (type === 'pumpjack' && !oilTiles) return { ok: false, reason: 'Буровая ставится на нефтяное пятно' };
    return { ok: true };
  }

  drillResource(x: number, y: number, w: number, h: number): ItemId | null {
    const counts: Record<string, number> = {};
    let best: string | null = null;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const r = this.world.resourceAt(xx, yy);
        if (!r || r === 'oil') continue;
        counts[r] = (counts[r] ?? 0) + 1;
        if (!best || counts[r] > counts[best]) best = r;
      }
    }
    return best as ItemId | null;
  }

  createEntity(type: BuildingType, x: number, y: number, dir: Dir, ghost: boolean): Entity {
    const def = BUILDINGS[type];
    const e: Entity = { id: this.nextId++, type, x, y, w: def.w, h: def.h, dir, hp: def.hp, createdAt: this.tick };
    if (ghost) e.ghost = true;
    this.ents.set(e.id, e);
    this.list.push(e);
    for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++) this.world.occ[this.world.idx(xx, yy)] = e.id;
    if (!ghost) this.initEntity(e);
    this.topoDirty = true;
    return e;
  }

  private initEntity(e: Entity): void {
    const def = BUILDINGS[e.type];
    delete e.ghost;
    delete e.status;
    e.hp = def.hp;
    if (BELTLIKE.has(e.type)) e.bi = this.belts.alloc();
    if (def.storage && !e.store) {
      e.store = {};
      e.storeTotal = 0;
    }
    if (def.machine || e.type === 'lab') {
      e.recipe = e.recipe ?? null;
      e.progress = 0;
      e.inv = e.inv ?? {};
      e.out = e.out ?? {};
    }
    if (['reactor', 'aicore', 'server'].includes(e.type)) e.inv = e.inv ?? {};
    if (e.type === 'inserter') {
      e.phase = 0;
      e.t = 0;
      e.hand = 0;
    }
    if (e.type === 'drill' || e.type === 'pumpjack') e.mine = 0;
    if (e.type === 'accumulator') e.charge = 0;
    if (e.type === 'reactor') e.fuel = 0;
    if (e.type === 'radar') e.scanR = 12;
    if (e.type === 'aicore' || e.type === 'server') e.modules = e.modules ?? 0;
    if (e.type === 'underground') this.pairUnderground(e);
    // clear trees and rocks under the footprint
    for (let yy = e.y; yy < e.y + e.h; yy++) {
      for (let xx = e.x; xx < e.x + e.w; xx++) {
        const i = this.world.idx(xx, yy);
        if (this.world.deco[i] !== Deco.None) {
          this.world.deco[i] = Deco.None;
          this.world.markDirty(xx, yy);
        }
      }
    }
    const rev = this.world.reveal(e.x + e.w / 2, e.y + e.h / 2, e.type === 'hq' ? 22 : 7);
    if (rev > 0) this.events.emit('fx', { kind: 'reveal', x: e.x, y: e.y });
    this.topoDirty = true;
  }

  private pairUnderground(e: Entity): void {
    // entrance behind us (against dir) → we are the exit
    for (let d = 1; d <= 6; d++) {
      const o = this.entityAt(e.x - DX[e.dir] * d, e.y - DY[e.dir] * d);
      if (o && o.type === 'underground' && !o.ghost && o.dir === e.dir) {
        if (o.ug === 'in' && !o.pair) {
          e.ug = 'out';
          e.pair = o.id;
          o.pair = e.id;
          this.topoDirty = true;
          return;
        }
        break;
      }
    }
    e.ug = 'in';
    // an unpaired underground ahead of us (built first) becomes our exit
    for (let d = 1; d <= 6; d++) {
      const o = this.entityAt(e.x + DX[e.dir] * d, e.y + DY[e.dir] * d);
      if (o && o.type === 'underground' && !o.ghost && o.dir === e.dir) {
        if (!o.pair) {
          o.ug = 'out';
          o.pair = e.id;
          e.pair = o.id;
          this.topoDirty = true;
        }
        break;
      }
    }
  }

  /** A pairing was broken: let the former partner find a new role. */
  private unpairUnderground(partnerId: number | undefined): void {
    if (!partnerId) return;
    const p = this.ents.get(partnerId);
    if (!p || p.type !== 'underground') return;
    delete p.pair;
    if (!p.ghost) this.pairUnderground(p);
  }

  /** Place a building as a ghost (or instantly when instantBuild / force). */
  place(type: BuildingType, x: number, y: number, dir: Dir, opts: { force?: boolean; instant?: boolean; recipe?: string; byScript?: boolean } = {}): Entity | null {
    // Re-orient an existing belt instead of failing.
    if (BELTLIKE.has(type) && type === 'belt') {
      const ex = this.entityAt(x, y);
      if (ex && ex.type === 'belt') {
        if (ex.dir !== dir) {
          ex.dir = dir;
          this.topoDirty = true;
        }
        return ex;
      }
    }
    const chk = this.canPlace(type, x, y, dir, opts.force);
    if (!chk.ok) return null;
    const instant = opts.instant || this.settings.instantBuild;
    const def = BUILDINGS[type];
    if (instant && !opts.force) {
      if (!opts.byScript) this.noteManual();
      if (!this.takeStock(def.cost)) {
        const e = this.createEntity(type, x, y, dir, true);
        if (opts.recipe) e.recipe = opts.recipe;
        return e;
      }
      const e = this.createEntity(type, x, y, dir, false);
      if (opts.recipe) e.recipe = opts.recipe;
      this.events.emit('built', e);
      return e;
    }
    const e = this.createEntity(type, x, y, dir, !instant);
    if (opts.recipe) e.recipe = opts.recipe;
    if (!e.ghost) this.events.emit('built', e);
    if (!opts.byScript) this.noteManual();
    return e;
  }

  /** Turn a ghost into a real building (called by drones after paying). */
  finishBuild(e: Entity): void {
    if (!e.ghost) return;
    this.initEntity(e);
    delete e.assigned;
    delete e.paid;
    this.events.emit('built', e);
    this.events.emit('fx', { kind: 'build', x: e.x + e.w / 2, y: e.y + e.h / 2 });
    this.events.emit('sound', { name: 'build' });
  }

  rotate(e: Entity): void {
    const def = BUILDINGS[e.type];
    if (!def.rotatable) return;
    e.dir = ((e.dir + 1) & 3) as Dir;
    if (e.type === 'underground' && !e.ghost) {
      const partner = e.pair;
      delete e.pair;
      this.unpairUnderground(partner);
      this.pairUnderground(e);
    }
    this.topoDirty = true;
  }

  /** Mark for deconstruction (drones will remove) or remove ghosts immediately. */
  deconstruct(e: Entity): void {
    if (e.type === 'hq') return;
    if (e.ghost) {
      if (e.paid) this.refundCost(e);
      this.removeEntity(e, false);
      return;
    }
    if (this.settings.instantBuild) {
      this.removeEntity(e, true);
      return;
    }
    e.decon = true;
    this.noteManual();
  }

  refundCost(e: Entity): void {
    for (const c of BUILDINGS[e.type].cost) this.addStock(c.item, c.n);
  }

  removeEntity(e: Entity, refund: boolean): void {
    if (!this.ents.has(e.id)) return;
    if (refund) {
      this.refundCost(e);
      for (const bag of [e.inv, e.out, e.store]) if (bag && e !== this.hq) for (const k in bag) if (bag[k] > 0) this.addStock(k, bag[k]);
      if (e.hand) {
        const it = ITEM_BY_INDEX[e.hand];
        if (it) this.addStock(it, 1);
      }
    }
    if (e.bi !== undefined) {
      const items = this.belts.clear(e.bi);
      if (refund) for (const it of items) this.addStock(ITEM_BY_INDEX[it]!, 1);
      this.belts.release(e.bi);
    }
    const partner = e.pair;
    for (let yy = e.y; yy < e.y + e.h; yy++) for (let xx = e.x; xx < e.x + e.w; xx++) {
      const i = this.world.idx(xx, yy);
      if (this.world.occ[i] === e.id) this.world.occ[i] = 0;
    }
    this.ents.delete(e.id);
    if (e.type === 'underground') this.unpairUnderground(partner);
    const idx = this.list.indexOf(e);
    if (idx >= 0) this.list.splice(idx, 1);
    for (const g in this.groups) {
      const arr = this.groups[g];
      const k = arr.indexOf(e.id);
      if (k >= 0) arr.splice(k, 1);
    }
    for (const d of this.drones) if (d.task && d.task.id === e.id && (d.task.type === 'build' || d.task.type === 'decon' || d.task.type === 'repair')) {
      d.task = undefined;
      d.state = 'return';
    }
    this.topoDirty = true;
    this.events.emit('removed', e);
  }

  noteManual(): void {
    this.manualTouch = this.time;
    this.ai.manualActions.push(this.time);
    if (this.ai.manualActions.length > 200) this.ai.manualActions.splice(0, 100);
  }

  // --------------------------------------------------------------- drones
  addDrone(kind: Drone['kind'], home: number): Drone {
    const h = this.ents.get(home);
    const x = h ? h.x + h.w / 2 : this.world.base.x;
    const y = h ? h.y + h.h / 2 : this.world.base.y;
    const d: Drone = { id: this.nextDroneId++, kind, x, y, px: x, py: y, home, state: 'idle', t: 0, hp: 100, ang: 0 };
    this.drones.push(d);
    return d;
  }

  inDroneRange(x: number, y: number): boolean {
    return droneRangeOk(this, x, y);
  }

  // ------------------------------------------------------------- topology
  rebuildTopology(): void {
    this.topoDirty = false;
    this.topoVersion++;
    rebuildPower(this);
    rebuildBeltLinks(this);
    rebuildFluids(this);
    this.scripts.invalidate();
  }

  /** Main simulation step (fixed 1/60 s). */
  step(): void {
    const dt = DT;
    if (this.topoDirty) this.rebuildTopology();
    this.scripts.update(this, dt);
    updatePower(this, dt);
    updateMachines(this, dt);
    updateInserters(this, dt);
    updateBelts(this, dt);
    updateDrones(this, dt);
    updateEnemies(this, dt);
    updateAI(this, dt);
    this.tick++;
    this.dayTime += dt;
    if (this.dayTime >= DAY_LENGTH) {
      this.dayTime -= DAY_LENGTH;
      this.day++;
    }
    if (this.tick % 60 === 0) this.everySecond();
  }

  run(seconds: number): void {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) this.step();
  }

  private everySecond(): void {
    this.stats.roll();
    this.craftEvents.length = 0;
    updateQuests(this);
    aiEverySecond(this);
    worldEvents(this);
  }

  /** Items produced per minute across all item types (for catastrophe detection). */
  productionScore(): number {
    let s = 0;
    for (const k of this.stats.keys) if (k in ITEM_INDEX) s += this.stats.rate(k, 30);
    return s;
  }

  recipeOf(e: Entity) {
    return e.recipe ? RECIPES[e.recipe] : undefined;
  }

  toast(t: Toast): void {
    this.events.emit('toast', t);
  }

  // ------------------------------------------------------------ serialize
  serialize(): SimSnapshot {
    distributeFluids(this);
    const ents = this.list.map((e) => {
      const c: any = { ...e };
      for (const k of RUNTIME_KEYS) delete c[k];
      if (c.inv) c.inv = { ...c.inv };
      if (c.out) c.out = { ...c.out };
      if (c.store) c.store = { ...c.store };
      return c as Entity;
    });
    const w = this.world;
    return {
      version: SAVE_VERSION,
      tick: this.tick,
      seed: this.seed,
      rng: this.rng.state,
      nextId: this.nextId,
      entities: ents,
      belts: this.belts.toData(),
      world: {
        w: w.w, h: w.h, seed: w.seed,
        biome: b64(w.biome), height: b64(w.height), res: b64(w.res), amt: b64(new Uint8Array(w.amt.buffer.slice(0))), deco: b64(w.deco), fog: b64(w.fog),
        pois: structuredClone(w.pois), deposits: structuredClone(w.deposits), base: { ...w.base }, nests: structuredClone(w.nests),
      },
      drones: structuredClone(this.drones),
      enemies: structuredClone(this.enemies),
      nextDroneId: this.nextDroneId,
      stats: this.stats.toData(),
      research: structuredClone(this.research),
      groups: structuredClone(this.groups),
      settings: { ...this.settings },
      dayTime: this.dayTime,
      day: this.day,
      ai: structuredClone(this.ai),
      git: structuredClone(this.git),
      quests: structuredClone(this.quests),
      flags: structuredClone(this.flags),
      scriptState: this.scripts.exportState(),
    };
  }

  static deserialize(s: SimSnapshot): Sim {
    const amtBytes = unb64(s.world.amt);
    const world = new World({
      w: s.world.w, h: s.world.h, seed: s.world.seed,
      biome: unb64(s.world.biome), height: unb64(s.world.height), res: unb64(s.world.res),
      amt: new Float32Array(amtBytes.buffer, amtBytes.byteOffset, amtBytes.byteLength / 4).slice(),
      deco: unb64(s.world.deco), fog: unb64(s.world.fog),
      pois: structuredClone(s.world.pois), deposits: structuredClone(s.world.deposits), base: { ...s.world.base }, nests: structuredClone(s.world.nests),
    });
    const sim = new Sim(world, s.seed);
    sim.tick = s.tick;
    sim.rng.state = s.rng;
    sim.nextId = s.nextId;
    sim.belts = BeltStore.fromData(s.belts);
    for (const raw of s.entities) {
      const e: Entity = structuredClone(raw);
      sim.ents.set(e.id, e);
      sim.list.push(e);
      for (let yy = e.y; yy < e.y + e.h; yy++) for (let xx = e.x; xx < e.x + e.w; xx++) world.occ[world.idx(xx, yy)] = e.id;
      if (e.type === 'hq') sim.hq = e;
    }
    sim.drones = structuredClone(s.drones);
    sim.enemies = structuredClone(s.enemies);
    sim.nextDroneId = s.nextDroneId;
    sim.stats = Stats.fromData(s.stats);
    sim.research = structuredClone(s.research);
    sim.doneSet = new Set(sim.research.done);
    sim.recomputeEffects();
    sim.groups = structuredClone(s.groups);
    sim.settings = { ...s.settings };
    sim.dayTime = s.dayTime;
    sim.day = s.day;
    sim.ai = structuredClone(s.ai);
    sim.git = structuredClone(s.git);
    sim.quests = structuredClone(s.quests);
    sim.flags = structuredClone(s.flags);
    sim.scripts.loadFromGit(sim);
    sim.scripts.importState(s.scriptState ?? {});
    sim.topoDirty = true;
    return sim;
  }

  /** Deep clone for sandbox forecasts (events muted). */
  clone(): Sim {
    const c = Sim.deserialize(this.serialize());
    c.headless = true;
    c.events.muted = true;
    return c;
  }
}

function b64(u: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + CH)));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export function itemIdx(item: string): number {
  return ITEM_INDEX[item as ItemId] ?? 0;
}
