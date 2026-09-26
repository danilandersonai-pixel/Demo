import { BUILDINGS, type BuildingType } from '../data/buildings';
import { ITEMS, type ItemId } from '../data/items';
import { RECIPES, recipeForItem, type RecipeDef } from '../data/recipes';
import type { Sim } from '../sim/sim';
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

/** Place blueprint entities as ghosts. Returns number placed. */
export function placeBlueprint(sim: Sim, entities: BpEntity[], x: number, y: number): number {
  let n = 0;
  for (const e of entities) {
    const r = sim.place(e.type, x + e.dx, y + e.dy, e.dir, { recipe: e.recipe, byScript: true });
    if (r) n++;
  }
  if (n) sim.flags.blueprintsPlaced = (sim.flags.blueprintsPlaced ?? 0) + 1;
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
