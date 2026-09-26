import { BUILDINGS } from '../data/buildings';
import type { Sim } from './sim';
import type { Entity } from './types';

export interface FluidNet {
  id: number;
  amount: number;
  capacity: number;
  members: number[];
}

const PIPE_CAP = 20;
const BUILDING_CAP = 100;

function capOf(e: Entity): number {
  return e.type === 'pipe' ? PIPE_CAP : BUILDING_CAP;
}

/** Push network amounts back into member entities (before topology changes / saving). */
export function distributeFluids(sim: Sim): void {
  for (const n of sim.fluidNets) {
    if (!n.capacity) continue;
    for (const id of n.members) {
      const e = sim.ents.get(id);
      if (e) e.fluid = (n.amount * capOf(e)) / n.capacity;
    }
  }
}

export function rebuildFluids(sim: Sim): void {
  distributeFluids(sim);
  const nodes = sim.list.filter((e) => !e.ghost && (e.type === 'pipe' || BUILDINGS[e.type].fluid));
  const index = new Map<number, number>();
  nodes.forEach((e, i) => index.set(e.id, i));
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (const e of nodes) {
    const i = index.get(e.id)!;
    // neighbours along the footprint perimeter
    for (let x = e.x; x < e.x + e.w; x++) {
      for (const y of [e.y - 1, e.y + e.h]) {
        const o = sim.entityAt(x, y);
        if (o && o !== e && index.has(o.id)) union(i, index.get(o.id)!);
      }
    }
    for (let y = e.y; y < e.y + e.h; y++) {
      for (const x of [e.x - 1, e.x + e.w]) {
        const o = sim.entityAt(x, y);
        if (o && o !== e && index.has(o.id)) union(i, index.get(o.id)!);
      }
    }
  }
  const nets: FluidNet[] = [];
  const netOf = new Map<number, number>();
  for (let i = 0; i < nodes.length; i++) {
    const r = find(i);
    let id = netOf.get(r);
    if (id === undefined) {
      id = nets.length;
      netOf.set(r, id);
      nets.push({ id, amount: 0, capacity: 0, members: [] });
    }
    const e = nodes[i];
    const n = nets[id];
    n.members.push(e.id);
    n.capacity += capOf(e);
    n.amount += e.fluid ?? 0;
    e.fnet = id;
  }
  for (const e of sim.list) if (!(e.type === 'pipe' || BUILDINGS[e.type].fluid)) e.fnet = -1;
  sim.fluidNets = nets;
}

/** Fluid network of an entity (or undefined). */
export function fluidNetOf(sim: Sim, e: Entity): FluidNet | undefined {
  return e.fnet !== undefined && e.fnet >= 0 ? sim.fluidNets[e.fnet] : undefined;
}
