import { BUILDINGS, type BuildingType } from '../data/buildings';
import { ITEMS, type ItemId } from '../data/items';
import { RECIPES, recipeForItem, type RecipeDef } from '../data/recipes';
import type { Sim } from '../sim/sim';
import type { Entity } from '../sim/types';
import type { Dir } from '../core/iso';

export interface BpEntity {
  type: BuildingType;
  dx: number;
  dy: number;
  dir: Dir;
  recipe?: string;
}

export interface LinePlan {
  item: ItemId;
  rate: number;
  machines: number;
  machine: BuildingType;
  recipe: RecipeDef;
  perMachine: number;
  entities: BpEntity[];
  w: number;
  h: number;
  inputs: string[];
  fluid: boolean;
}

function machineFor(r: RecipeDef, sim: Sim): BuildingType {
  if (r.machine === 'smelter') return 'smelter';
  if (r.machine === 'chem') return 'chem';
  if (r.machine === 'assembler2') return 'assembler2';
  return sim.isUnlocked('assembler2') ? 'assembler2' : 'assembler';
}

/**
 * Parametric production row: input belt → inserters → N machines → inserters → output belt, with poles.
 * Layout (x grows east): y0 input belt, y1 inserters+poles, y2.. machines, then inserters/pipes, then output belt.
 */
export function planLine(sim: Sim, item: ItemId, rate: number): LinePlan | null {
  const r = recipeForItem(item);
  if (!r) return null;
  const machine = machineFor(r, sim);
  const def = BUILDINGS[machine];
  const speed = (def.speed ?? 1) * (1 + sim.effects.craftSpeed);
  const perMachine = (60 * r.outputs[0].n * speed) / r.time;
  const n = Math.max(1, Math.min(12, Math.ceil(rate / perMachine)));
  const s = def.w;
  const fluid = !!r.fluid;
  const E: BpEntity[] = [];
  const W = n * s;
  for (let x = 0; x < W; x++) E.push({ type: 'belt', dx: x, dy: 0, dir: 1 });
  const outRow = 2 + s + 1;
  for (let i = 0; i < n; i++) {
    const mx = i * s;
    E.push({ type: machine, dx: mx, dy: 2, dir: 1, recipe: r.machine === 'smelter' ? undefined : r.id });
    E.push({ type: 'inserter', dx: mx + 1, dy: 1, dir: 2 });
    E.push({ type: 'inserter', dx: mx + 1, dy: 2 + s, dir: 2 });
    if (s >= 3 || i % 2 === 0) E.push({ type: 'pole', dx: mx + (s >= 3 ? 2 : 0), dy: 1, dir: 0 });
    if (fluid) {
      E.push({ type: 'pipe', dx: mx, dy: 2 + s, dir: 0 });
      if (s >= 3) E.push({ type: 'pipe', dx: mx + 2, dy: 2 + s, dir: 0 });
    } else if (s >= 3) E.push({ type: 'pole', dx: mx + 2, dy: 2 + s, dir: 0 });
  }
  for (let x = 0; x < W; x++) E.push({ type: 'belt', dx: x, dy: outRow, dir: 1 });
  return {
    item, rate, machines: n, machine, recipe: r, perMachine, entities: E, w: W, h: outRow + 1,
    inputs: r.inputs.map((i) => ITEMS[i.item].name), fluid,
  };
}

/** Find a free, revealed, dry rectangle near (cx, cy). Spiral search. */
export function findSpot(sim: Sim, w: number, h: number, cx: number, cy: number, maxR = 40): { x: number; y: number } | null {
  const ok = (x0: number, y0: number) => {
    for (let y = y0 - 1; y <= y0 + h; y++) {
      for (let x = x0 - 1; x <= x0 + w; x++) {
        if (!sim.world.inBounds(x, y)) return false;
        const i = sim.world.idx(x, y);
        if (sim.world.occ[i] || sim.world.isWaterAt(x, y) || !sim.world.fog[i]) return false;
      }
    }
    return true;
  };
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.round(cx + dx - w / 2);
        const y = Math.round(cy + dy - h / 2);
        if (ok(x, y)) return { x, y };
      }
    }
  }
  return null;
}

/** Place blueprint entities as ghosts and lay power poles to them. Returns number placed. */
export function placeBlueprint(sim: Sim, entities: BpEntity[], x: number, y: number, connect = true): number {
  let n = 0;
  const ids = new Set<number>();
  for (const e of entities) {
    const r = sim.place(e.type, x + e.dx, y + e.dy, e.dir, { recipe: e.recipe, byScript: true });
    if (r) {
      n++;
      ids.add(r.id);
    }
  }
  if (n && connect) {
    sim.flags.blueprintsPlaced = (sim.flags.blueprintsPlaced ?? 0) + 1;
    connectPower(sim, { instant: false, onlyIds: ids, maxPoles: 20 });
  }
  return n;
}

/** Hook used by scripts: build("microchip_line", "base"). */
export function architectBuild(sim: Sim, name: string, near: string): boolean {
  const m = name.toLowerCase().match(/^([a-z_]+?)(?:_line)?(?:_(\d+))?$/);
  if (!m) return false;
  const item = (Object.keys(ITEMS).find((k) => k === m[1] || k.startsWith(m[1])) ?? null) as ItemId | null;
  if (!item) return false;
  const plan = planLine(sim, item, Number(m[2] ?? 30));
  if (!plan) return false;
  let cx = sim.world.base.x;
  let cy = sim.world.base.y + 12;
  if (near !== 'base') {
    const g = sim.list.find((e) => e.type === near || e.recipe === near);
    if (g) {
      cx = g.x;
      cy = g.y;
    }
  }
  const spot = findSpot(sim, plan.w, plan.h, cx, cy);
  if (!spot) return false;
  return placeBlueprint(sim, plan.entities, spot.x, spot.y) > 0;
}

export function recipeName(id: string): string {
  return RECIPES[id]?.name ?? id;
}

/**
 * Connect every unpowered consumer (built or ghost) to the main grid by laying poles.
 * Ghost poles already placed count as planned coverage, so repeated calls never duplicate chains.
 */
export function connectPower(sim: Sim, opts: { instant?: boolean; maxPoles?: number; onlyIds?: Set<number> } = {}): number {
  sim.rebuildTopology();
  const main = sim.mainNet;
  const REACH = 7;
  const planned: { x: number; y: number }[] = sim.list.filter((e) => e.type === 'pole' && e.ghost).map((e) => ({ x: e.x, y: e.y }));
  const anchors: { x: number; y: number }[] = [
    ...sim.list.filter((e) => !e.ghost && BUILDINGS[e.type].poleReach && (e.net ?? -1) === main).map((e) => ({ x: e.x + Math.floor(e.w / 2), y: e.y + Math.floor(e.h / 2) })),
    ...planned,
  ];
  const coveredBy = (t: Entity, p: { x: number; y: number }) => p.x >= t.x - 2 && p.x <= t.x + t.w + 1 && p.y >= t.y - 2 && p.y <= t.y + t.h + 1;
  const hq = sim.hq!;
  const targets = sim.list
    .filter((e) => (BUILDINGS[e.type].power > 0 || BUILDINGS[e.type].gen) && e.type !== 'hq' && !BUILDINGS[e.type].poleReach)
    .filter((e) => (e.ghost ? true : (e.net ?? -1) !== main))
    .filter((e) => !opts.onlyIds || opts.onlyIds.has(e.id))
    .sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y));
  let placed = 0;
  const max = opts.maxPoles ?? 60;
  for (const t of targets) {
    if (placed >= max) break;
    if (!t.ghost && (t.net ?? -1) === main) continue;
    if (planned.some((p) => coveredBy(t, p))) continue;
    // already inside the supply area of a built main-grid pole?
    if (t.ghost) {
      let powered = false;
      for (let yy = t.y; yy < t.y + t.h && !powered; yy++) for (let xx = t.x; xx < t.x + t.w; xx++) if (sim.supply[yy * sim.world.w + xx] === main + 1) powered = true;
      if (powered) continue;
    }
    const tx = t.x + t.w / 2;
    const ty = t.y + t.h / 2;
    let best = anchors[0];
    let bd = Infinity;
    for (const a of anchors) {
      const d = Math.hypot(a.x - tx, a.y - ty);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (!best) break;
    let cx = best.x;
    let cy = best.y;
    for (let guard = 0; guard < 20 && placed < max; guard++) {
      const dx = tx - cx;
      const dy = ty - cy;
      const d = Math.hypot(dx, dy);
      const step = Math.min(REACH, Math.max(1, d - 1.5));
      const spot = freeNear(sim, Math.round(cx + (dx / Math.max(d, 1e-6)) * step), Math.round(cy + (dy / Math.max(d, 1e-6)) * step));
      if (!spot || Math.hypot(spot.x - cx, spot.y - cy) > 8) break;
      const e = sim.place('pole', spot.x, spot.y, 0, { force: true, instant: opts.instant ?? true, byScript: true });
      if (!e) break;
      placed++;
      planned.push(spot);
      anchors.push(spot);
      cx = spot.x;
      cy = spot.y;
      if (coveredBy(t, spot)) break;
    }
  }
  sim.topoDirty = true;
  return placed;
}

function freeNear(sim: Sim, x: number, y: number): { x: number; y: number } | null {
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = x + dx;
        const py = y + dy;
        if (!sim.world.inBounds(px, py)) continue;
        const i = sim.world.idx(px, py);
        if (!sim.world.occ[i] && !sim.world.isWaterAt(px, py)) return { x: px, y: py };
      }
    }
  }
  return null;
}
