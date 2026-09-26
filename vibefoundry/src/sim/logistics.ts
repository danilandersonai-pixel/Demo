import { BELTLIKE, BUILDINGS } from '../data/buildings';
import { ITEM_BY_INDEX, ITEM_INDEX, type ItemId } from '../data/items';
import { RECIPES, SMELT_BY_INPUT } from '../data/recipes';
import { TECHS } from '../data/research';
import { DX, DY, opposite, type Dir } from '../core/iso';
import { GAP } from './beltStore';
import type { Sim } from './sim';
import type { Entity } from './types';

/** nextMode values. */
export const LINK_NONE = 0;
export const LINK_INLINE = 1;
export const LINK_SIDE = 2;
export const LINK_SINK = 3;

export const BELT_SPEED = 2; // tiles / s
export const INSERTER_HALF = 0.6; // seconds per half-swing

export function inputCap(n: number): number {
  return Math.max(2, n * 2 + 1);
}
export function outputCap(n: number): number {
  return Math.max(4, n * 4);
}

/** Output tile of a drill / directional building (clockwise-symmetric). */
export function outputTile(e: { x: number; y: number; w: number; h: number; dir: Dir }): { x: number; y: number } {
  switch (e.dir) {
    case 0: return { x: e.x, y: e.y - 1 };
    case 1: return { x: e.x + e.w, y: e.y };
    case 2: return { x: e.x + e.w - 1, y: e.y + e.h };
    default: return { x: e.x - 1, y: e.y + e.h - 1 };
  }
}

function isBelt(e: Entity | undefined): e is Entity {
  return !!e && !e.ghost && BELTLIKE.has(e.type);
}

/** Target for an item leaving belt `e` in direction d. Returns [id, mode]. */
function linkFrom(sim: Sim, e: Entity, d: Dir): [number, number] {
  const tx = e.x + DX[d];
  const ty = e.y + DY[d];
  const o = sim.entityAt(tx, ty);
  if (!o || o.ghost) return [0, LINK_NONE];
  if (BELTLIKE.has(o.type)) {
    if (o.type === 'underground') {
      if (o.ug === 'in' && o.dir === d) return [o.id, LINK_INLINE];
      return [0, LINK_NONE];
    }
    if (o.type === 'splitter') return o.dir === d ? [o.id, LINK_INLINE] : [0, LINK_NONE];
    if (o.dir === opposite(d)) return [0, LINK_NONE];
    if (o.dir === d) return [o.id, LINK_INLINE];
    // perpendicular: side-load if o already has a straight feeder, else it's a turn
    const bx = o.x - DX[o.dir];
    const by = o.y - DY[o.dir];
    const back = sim.entityAt(bx, by);
    if (isBelt(back) && back.dir === o.dir && back.type !== 'splitter') return [o.id, LINK_SIDE];
    return [o.id, LINK_INLINE];
  }
  if (o.type === 'hq' || o.type === 'storage') return [o.id, LINK_SINK];
  return [0, LINK_NONE];
}

export function rebuildBeltLinks(sim: Sim): void {
  for (const e of sim.list) {
    if (!isBelt(e)) continue;
    e.curve = 0;
    if (e.type === 'underground' && e.ug === 'in') {
      e.next = e.pair ?? 0;
      e.nextMode = e.pair ? LINK_INLINE : LINK_NONE;
      continue;
    }
    if (e.type === 'splitter') {
      const outs: number[] = [];
      for (const d of [e.dir, ((e.dir + 3) & 3) as Dir, ((e.dir + 1) & 3) as Dir]) {
        const [id, mode] = linkFrom(sim, e, d);
        outs.push(id, mode);
      }
      e.outs = outs;
      e.next = 0;
      e.nextMode = LINK_NONE;
      continue;
    }
    const [id, mode] = linkFrom(sim, e, e.dir);
    e.next = id;
    e.nextMode = mode;
  }
  // curves for rendering: a belt fed only from one side turns
  for (const e of sim.list) {
    if (!isBelt(e) || e.type !== 'belt') continue;
    const back = sim.entityAt(e.x - DX[e.dir], e.y - DY[e.dir]);
    if (isBelt(back) && back.next === e.id) continue;
    const ld = ((e.dir + 3) & 3) as Dir;
    const rd = ((e.dir + 1) & 3) as Dir;
    const left = sim.entityAt(e.x + DX[ld], e.y + DY[ld]);
    const right = sim.entityAt(e.x + DX[rd], e.y + DY[rd]);
    const fromLeft = isBelt(left) && left.next === e.id && left.nextMode === LINK_INLINE;
    const fromRight = isBelt(right) && right.next === e.id && right.nextMode === LINK_INLINE;
    if (fromLeft && !fromRight) e.curve = -1;
    else if (fromRight && !fromLeft) e.curve = 1;
  }
}

/**
 * Offer an item to a building. When commit=false only checks.
 * This is the single source of truth for "what a building accepts".
 */
export function offer(sim: Sim, e: Entity, itemIdx: number, commit: boolean, dropPos = 0.5): boolean {
  if (e.ghost || !itemIdx) return false;
  const item = ITEM_BY_INDEX[itemIdx] as ItemId;
  const def = BUILDINGS[e.type];
  if (BELTLIKE.has(e.type)) {
    if (!commit) return sim.belts.canInsert(e.bi!, dropPos);
    return sim.belts.insert(e.bi!, itemIdx, dropPos);
  }
  if (def.storage) {
    if ((e.storeTotal ?? 0) >= def.storage) return false;
    if (commit) {
      e.store![item] = (e.store![item] ?? 0) + 1;
      e.storeTotal = (e.storeTotal ?? 0) + 1;
    }
    return true;
  }
  switch (e.type) {
    case 'smelter': {
      const inv = e.inv!;
      let r = e.recipe ? RECIPES[e.recipe] : undefined;
      const empty = !e.crafting && isEmpty(inv) && isEmpty(e.out!);
      if (!r || (empty && !r.inputs.some((s) => s.item === item))) {
        const rid = SMELT_BY_INPUT[item];
        if (!rid || !sim.isUnlocked(RECIPES[rid].unlock)) return false;
        if (r && !empty) return false;
        if (commit) e.recipe = rid;
        r = RECIPES[rid];
      }
      const st = r.inputs.find((s) => s.item === item);
      if (!st) return false;
      if ((inv[item] ?? 0) >= inputCap(st.n)) return false;
      if (commit) inv[item] = (inv[item] ?? 0) + 1;
      return true;
    }
    case 'assembler':
    case 'assembler2':
    case 'chem': {
      const r = e.recipe ? RECIPES[e.recipe] : undefined;
      if (!r) return false;
      const st = r.inputs.find((s) => s.item === item);
      if (!st) return false;
      if ((e.inv![item] ?? 0) >= inputCap(st.n)) return false;
      if (commit) e.inv![item] = (e.inv![item] ?? 0) + 1;
      return true;
    }
    case 'lab': {
      const cur = sim.research.current;
      if (!cur) return false;
      const t = TECHS[cur];
      if (!t.packs.includes(item as any)) return false;
      if ((e.inv![item] ?? 0) >= 4) return false;
      if (commit) e.inv![item] = (e.inv![item] ?? 0) + 1;
      return true;
    }
    case 'reactor': {
      if (item !== 'uranium_fuel') return false;
      if ((e.inv!.uranium_fuel ?? 0) >= 3) return false;
      if (commit) e.inv!.uranium_fuel = (e.inv!.uranium_fuel ?? 0) + 1;
      return true;
    }
    case 'aicore':
    case 'server': {
      if (item !== 'memory_module') return false;
      const slots = e.type === 'aicore' ? 20 : 4;
      if ((e.modules ?? 0) >= slots) return false;
      if (commit) {
        e.modules = (e.modules ?? 0) + 1;
        sim.stats.consume('memory_module', 1);
      }
      return true;
    }
  }
  return false;
}

function isEmpty(bag: Record<string, number> | undefined): boolean {
  if (!bag) return true;
  for (const k in bag) if (bag[k] > 0) return false;
  return true;
}

/** Items a building wants from storage (for inserters pulling out of chests). */
function wantedItems(sim: Sim, dst: Entity): string[] {
  switch (dst.type) {
    case 'smelter':
      return dst.recipe ? RECIPES[dst.recipe].inputs.map((s) => s.item) : Object.keys(SMELT_BY_INPUT);
    case 'assembler':
    case 'assembler2':
    case 'chem':
      return dst.recipe ? RECIPES[dst.recipe].inputs.map((s) => s.item) : [];
    case 'lab':
      return sim.research.current ? TECHS[sim.research.current].packs : [];
    case 'reactor':
      return ['uranium_fuel'];
    case 'aicore':
    case 'server':
      return ['memory_module'];
  }
  return [];
}

// ------------------------------------------------------------------ belts
export function updateBelts(sim: Sim, dt: number): void {
  const bs = sim.belts;
  const pos = bs.pos;
  const items = bs.items;
  const cnt = bs.cnt;
  const step = BELT_SPEED * (1 + sim.effects.beltSpeed) * dt;
  for (let li = 0; li < sim.list.length; li++) {
    const e = sim.list[li];
    if (e.bi === undefined || e.ghost) continue;
    const b = e.bi;
    let n = cnt[b];
    if (!n) continue;
    const base = b * 4;
    let p = pos[base] + step;
    if (p >= 1) {
      const item = items[base];
      let moved = false;
      if (e.type === 'splitter') moved = splitterPush(sim, e, item, p - 1);
      else if (e.nextMode) moved = pushTo(sim, e.next!, e.nextMode!, item, p - 1);
      if (moved) {
        bs.removeAt(b, 0);
        n--;
        if (!n) continue;
        // advance the new front item this tick as well
        pos[base] = Math.min(1, pos[base] + step);
      } else {
        pos[base] = 1;
      }
    } else {
      pos[base] = p;
    }
    for (let k = 1; k < n; k++) {
      const lim = pos[base + k - 1] - GAP;
      const np = pos[base + k] + step;
      pos[base + k] = np < lim ? np : lim > pos[base + k] ? lim : pos[base + k];
    }
  }
}

function pushTo(sim: Sim, targetId: number, mode: number, item: number, overflow: number): boolean {
  const t = sim.ents.get(targetId);
  if (!t || t.ghost) return false;
  if (mode === LINK_INLINE) {
    if (!sim.belts.canEnterTail(t.bi!)) return false;
    sim.belts.pushTail(t.bi!, item, overflow);
    return true;
  }
  if (mode === LINK_SIDE) {
    return sim.belts.insert(t.bi!, item, 0.5);
  }
  if (mode === LINK_SINK) {
    const ok = offer(sim, t, item, true);
    return ok;
  }
  return false;
}

function splitterPush(sim: Sim, e: Entity, item: number, overflow: number): boolean {
  const outs = e.outs;
  if (!outs) return false;
  const filters = sim.splitterFilters.get(e.id);
  const f = filters?.get(item);
  if (f !== undefined) {
    const id = outs[f * 2];
    return id ? pushTo(sim, id, outs[f * 2 + 1], item, overflow) : false;
  }
  let reserved = 0;
  if (filters && !sim.splitterBalance.has(e.id)) for (const v of filters.values()) reserved |= 1 << v;
  const start = e.rr ?? 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < 3; j++) {
      const o = (start + j) % 3;
      if (!outs[o * 2]) continue;
      if (pass === 0 && reserved & (1 << o)) continue;
      if (pushTo(sim, outs[o * 2], outs[o * 2 + 1], item, overflow)) {
        e.rr = (o + 1) % 3;
        return true;
      }
    }
    if (!reserved) break;
  }
  return false;
}

// -------------------------------------------------------------- inserters
export function updateInserters(sim: Sim, dt: number): void {
  const speed = (1 + sim.effects.inserterSpeed) / INSERTER_HALF;
  const def = BUILDINGS.inserter;
  for (let li = 0; li < sim.list.length; li++) {
    const e = sim.list[li];
    if (e.type !== 'inserter' || e.ghost) continue;
    const sat = e.sat ?? 0;
    const phase = e.phase ?? 0;
    if (phase === 0) {
      e.wantPower = def.idle;
      if ((sim.tick + e.id) % 4 !== 0) continue;
      if (sat <= 0.01) {
        e.status = e.scriptOff || e.off ? 'disabled' : 'no_power';
        continue;
      }
      const src = sim.entityAt(e.x - DX[e.dir], e.y - DY[e.dir]);
      const dst = sim.entityAt(e.x + DX[e.dir], e.y + DY[e.dir]);
      if (!src || !dst || src.ghost || dst.ghost) {
        e.status = 'idle';
        continue;
      }
      const it = pick(sim, e, src, dst);
      if (it) {
        e.hand = it;
        e.phase = 1;
        e.t = 0;
        e.status = 'working';
        e.wantPower = def.power;
      } else e.status = 'no_input';
      continue;
    }
    e.wantPower = def.power;
    if (phase === 1) {
      e.t = (e.t ?? 0) + dt * speed * sat;
      if (e.t >= 1) {
        e.t = 1;
        e.phase = 2;
      }
    }
    if (e.phase === 2) {
      const dst = sim.entityAt(e.x + DX[e.dir], e.y + DY[e.dir]);
      if (dst && offer(sim, dst, e.hand!, true)) {
        e.hand = 0;
        e.phase = 3;
        e.t = 1;
        e.status = 'working';
      } else {
        e.status = 'output_full';
        e.wantPower = def.idle;
        if (!dst) {
          // target removed: drop back to storage
          const it = ITEM_BY_INDEX[e.hand!];
          if (it) sim.addStock(it, 1);
          e.hand = 0;
          e.phase = 0;
        }
      }
      continue;
    }
    if (e.phase === 3) {
      e.t = (e.t ?? 1) - dt * speed * sat;
      if (e.t <= 0) {
        e.t = 0;
        e.phase = 0;
      }
    }
  }
}

function pick(sim: Sim, ins: Entity, src: Entity, dst: Entity): number {
  const filterIdx = ins.filter ? ITEM_INDEX[ins.filter as ItemId] : 0;
  if (BELTLIKE.has(src.type)) {
    const b = src.bi!;
    const n = sim.belts.cnt[b];
    for (let k = 0; k < n; k++) {
      const it = sim.belts.items[b * 4 + k];
      if (filterIdx && it !== filterIdx) continue;
      if (offer(sim, dst, it, false)) {
        sim.belts.removeAt(b, k);
        return it;
      }
    }
    return 0;
  }
  if (src.out) {
    for (const k in src.out) {
      if (src.out[k] <= 0) continue;
      const it = ITEM_INDEX[k as ItemId];
      if (filterIdx && it !== filterIdx) continue;
      if (offer(sim, dst, it, false)) {
        src.out[k]--;
        return it;
      }
    }
    return 0;
  }
  if (src.store) {
    const wanted = filterIdx ? [ins.filter!] : wantedItems(sim, dst);
    for (const k of wanted) {
      if ((src.store[k] ?? 0) <= 0) continue;
      const it = ITEM_INDEX[k as ItemId];
      if (offer(sim, dst, it, false)) {
        src.store[k]--;
        src.storeTotal = (src.storeTotal ?? 0) - 1;
        return it;
      }
    }
  }
  return 0;
}
