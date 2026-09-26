import { BUILDINGS } from '../data/buildings';
import type { Sim } from './sim';
import type { Entity, PowerNetStats } from './types';
import { solarFactor } from './worldEvents';

const ACC_CAPACITY = 5000; // kJ
const ACC_RATE = 300; // kW
const OIL_PER_SEC_FULL = 2; // oil units per second for a power plant at full load
const REACTOR_FUEL_SECONDS = 60;

/** Union-find helper. */
function find(p: Int32Array, i: number): number {
  while (p[i] !== i) {
    p[i] = p[p[i]];
    i = p[i];
  }
  return i;
}

/** Rebuild electric networks: poles connected by reach, buildings covered by supply areas. */
export function rebuildPower(sim: Sim): void {
  const poles = sim.list.filter((e) => !e.ghost && BUILDINGS[e.type].poleReach);
  const parent = new Int32Array(poles.length);
  for (let i = 0; i < poles.length; i++) parent[i] = i;
  const cx = (e: Entity) => e.x + e.w / 2;
  const cy = (e: Entity) => e.y + e.h / 2;
  for (let i = 0; i < poles.length; i++) {
    const a = poles[i];
    const ra = BUILDINGS[a.type].poleReach!;
    for (let j = i + 1; j < poles.length; j++) {
      const b = poles[j];
      const reach = Math.min(ra, BUILDINGS[b.type].poleReach!) + (a.w + b.w) / 2 - 1;
      const dx = cx(a) - cx(b);
      const dy = cy(a) - cy(b);
      if (dx * dx + dy * dy <= reach * reach) {
        const ri = find(parent, i);
        const rj = find(parent, j);
        if (ri !== rj) parent[ri] = rj;
      }
    }
  }
  const netIds = new Map<number, number>();
  const nets: PowerNetStats[] = [];
  sim.supply.fill(0);
  const W = sim.world.w;
  for (let i = 0; i < poles.length; i++) {
    const r = find(parent, i);
    let id = netIds.get(r);
    if (id === undefined) {
      id = nets.length;
      netIds.set(r, id);
      nets.push({ id, capacity: 0, demand: 0, nominal: 0, used: 0, sat: 1, charge: 0, chargeMax: 0 });
    }
    const p = poles[i];
    p.net = id;
    const s = BUILDINGS[p.type].poleSupply!;
    for (let y = p.y - s; y < p.y + p.h + s; y++) {
      if (y < 0 || y >= sim.world.h) continue;
      for (let x = p.x - s; x < p.x + p.w + s; x++) {
        if (x < 0 || x >= W) continue;
        if (!sim.supply[y * W + x]) sim.supply[y * W + x] = id + 1;
      }
    }
  }
  for (const e of sim.list) {
    if (e.ghost) continue;
    const def = BUILDINGS[e.type];
    if (def.poleReach) continue;
    if (!def.power && !def.gen && e.type !== 'accumulator') {
      e.net = -1;
      continue;
    }
    let net = -1;
    for (let y = e.y; y < e.y + e.h && net < 0; y++) {
      for (let x = e.x; x < e.x + e.w; x++) {
        const v = sim.supply[y * W + x];
        if (v) {
          net = v - 1;
          break;
        }
      }
    }
    e.net = net;
  }
  sim.powerNets = nets;
  sim.mainNet = sim.hq?.net ?? -1;
}

export function isEnabled(e: Entity): boolean {
  if (e.scriptOff) return false;
  if (e.scriptOn) return true;
  return !e.off;
}

export function priorityOf(e: Entity): number {
  return e.scriptPrio ?? e.prio ?? 3;
}

// Scratch arrays reused every tick (no allocations in the hot path).
let tierDemand = new Float64Array(0);
let tierSat = new Float64Array(0);

/** Distribute power per network with 5 priority tiers; charge/discharge accumulators. */
export function updatePower(sim: Sim, dt: number): void {
  const nets = sim.powerNets;
  const nN = nets.length;
  if (tierDemand.length < nN * 6) {
    tierDemand = new Float64Array(nN * 6 + 12);
    tierSat = new Float64Array(nN * 6 + 12);
  }
  tierDemand.fill(0, 0, nN * 6);
  for (const n of nets) {
    n.capacity = 0;
    n.demand = 0;
    n.nominal = 0;
    n.used = 0;
    n.charge = 0;
    n.chargeMax = 0;
  }
  const daylight = sim.daylight;
  // pass 1: generation capacity and demand
  for (const e of sim.list) {
    if (e.ghost) continue;
    const def = BUILDINGS[e.type];
    const net = e.net ?? -1;
    if (net < 0) {
      if (def.power) e.sat = 0;
      continue;
    }
    const N = nets[net];
    if (def.gen) {
      let cap = 0;
      switch (e.type) {
        case 'hq':
          cap = def.gen;
          break;
        case 'power_plant': {
          const fn = e.fnet !== undefined && e.fnet >= 0 ? sim.fluidNets[e.fnet] : undefined;
          cap = fn && fn.amount > 0.5 ? def.gen : 0;
          e.status = cap > 0 ? 'working' : 'no_fluid';
          break;
        }
        case 'solar':
          cap = def.gen * daylight * solarFactor(sim);
          e.status = cap > 10 ? 'working' : 'idle';
          break;
        case 'reactor':
          if ((e.fuel ?? 0) <= 0 && (e.inv?.uranium_fuel ?? 0) > 0) {
            e.inv!.uranium_fuel--;
            e.fuel = REACTOR_FUEL_SECONDS;
            sim.stats.consume('uranium_fuel', 1);
          }
          cap = (e.fuel ?? 0) > 0 ? def.gen : 0;
          e.status = cap > 0 ? 'working' : 'no_input';
          break;
      }
      N.capacity += cap;
      e.wantPower = cap; // store capacity for load share
    }
    if (e.type === 'accumulator') {
      N.charge += e.charge ?? 0;
      N.chargeMax += ACC_CAPACITY;
    }
    if (def.power) {
      const enabled = isEnabled(e);
      const want = e.wantPower ?? def.idle;
      const nominalWant = enabled ? want : e.off ? 0 : def.power;
      N.nominal += nominalWant;
      if (!enabled) continue;
      N.demand += want;
      tierDemand[net * 6 + Math.max(1, Math.min(5, priorityOf(e)))] += want;
    }
  }
  // pass 2: satisfaction per tier (+ accumulator discharge)
  for (let n = 0; n < nN; n++) {
    const N = nets[n];
    let available = N.capacity;
    const deficit = N.demand - N.capacity;
    let discharge = 0;
    if (deficit > 0 && N.charge > 0) {
      discharge = Math.min(deficit, (N.chargeMax / ACC_CAPACITY) * ACC_RATE, (N.charge / dt));
      available += discharge;
    }
    let remaining = available;
    for (let p = 1; p <= 5; p++) {
      const d = tierDemand[n * 6 + p];
      if (d <= 0) {
        tierSat[n * 6 + p] = 1;
        continue;
      }
      const s = Math.max(0, Math.min(1, remaining / d));
      tierSat[n * 6 + p] = s;
      remaining -= d * s;
    }
    N.used = available - remaining;
    N.sat = N.demand > 0 ? Math.min(1, available / N.demand) : 1;
    // accumulators: discharge or charge with surplus
    const surplus = N.capacity - Math.min(N.capacity, N.demand);
    (N as any)._discharge = discharge;
    (N as any)._surplus = surplus;
    (N as any)._genUsed = Math.min(N.capacity, N.demand);
  }
  // pass 3: apply satisfaction, fuel, accumulators
  for (const e of sim.list) {
    if (e.ghost) continue;
    const def = BUILDINGS[e.type];
    const net = e.net ?? -1;
    if (net < 0) continue;
    const N = nets[net];
    if (def.power) e.sat = isEnabled(e) ? tierSat[net * 6 + Math.max(1, Math.min(5, priorityOf(e)))] : 0;
    if (e.type === 'accumulator') {
      const disc = (N as any)._discharge as number;
      const sur = (N as any)._surplus as number;
      const nAcc = N.chargeMax / ACC_CAPACITY;
      if (disc > 0) e.charge = Math.max(0, (e.charge ?? 0) - (disc / nAcc) * dt);
      else if (sur > 0) e.charge = Math.min(ACC_CAPACITY, (e.charge ?? 0) + Math.min(ACC_RATE, sur / nAcc) * dt);
      e.status = disc > 0 ? 'working' : 'idle';
    }
    if (def.gen && N.capacity > 0) {
      const load = ((N as any)._genUsed as number) / N.capacity;
      if (e.type === 'power_plant' && (e.wantPower ?? 0) > 0) {
        const fn = sim.fluidNets[e.fnet!];
        const need = OIL_PER_SEC_FULL * load * dt;
        const take = Math.min(fn.amount, need);
        fn.amount -= take;
        sim.stats.consume('oil', take);
      }
      if (e.type === 'reactor' && (e.fuel ?? 0) > 0) e.fuel = Math.max(0, e.fuel! - dt * Math.max(0.15, load));
    }
  }
}

/** Main network stats for HUD and scripts. */
export function mainPower(sim: Sim): PowerNetStats {
  return sim.powerNets[sim.mainNet] ?? { id: -1, capacity: 0, demand: 0, nominal: 0, used: 0, sat: 1, charge: 0, chargeMax: 0 };
}

/** self.power / self.energy for scripts: capacity (+accumulator reserve) against nominal demand. */
export function powerRatio(sim: Sim): number {
  const n = mainPower(sim);
  if (n.nominal <= 0) return 1;
  // reserve counts only what the bank can actually sustain for ~10 s
  const accBoost = Math.min((n.chargeMax / ACC_CAPACITY) * ACC_RATE, n.charge / 10);
  return Math.max(0, Math.min(1, (n.capacity + accBoost) / n.nominal));
}
