import { BUILDINGS } from '../data/buildings';
import { ITEM_INDEX, RES_BY_CODE, type ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import { TECHS } from '../data/research';
import { isWater } from '../data/biomes';
import { outputTile, offer, outputCap } from './logistics';
import { isEnabled } from './power';
import { fluidNetOf } from './fluids';
import type { Sim } from './sim';
import type { Entity } from './types';

const PUMP_RATE = 10; // oil / s
const COMPUTE: Partial<Record<string, number>> = { aicore: 6, server: 12, datacenter: 150 };

let stockCache: Record<string, number> = {};
let stockTick = -1;
/** Global stock snapshot refreshed every 30 ticks (limits check it per machine). */
export function cachedStock(sim: Sim, item: string): number {
  if (sim.tick - stockTick >= 30 || stockTick > sim.tick) {
    stockCache = sim.stockAll();
    stockTick = sim.tick;
  }
  return stockCache[item] ?? 0;
}

export function updateMachines(sim: Sim, dt: number): void {
  const craftBoost = 1 + sim.effects.craftSpeed;
  for (let li = 0; li < sim.list.length; li++) {
    const e = sim.list[li];
    if (e.ghost) continue;
    switch (e.type) {
      case 'drill':
        updateDrill(sim, e, dt);
        break;
      case 'pumpjack':
        updatePump(sim, e, dt);
        break;
      case 'smelter':
      case 'assembler':
      case 'assembler2':
      case 'chem':
        updateCrafter(sim, e, dt, craftBoost);
        break;
      case 'lab':
        updateLab(sim, e, dt);
        break;
      case 'aicore':
      case 'server':
      case 'datacenter':
        updateCompute(sim, e, dt);
        break;
      case 'inference':
        updateInference(sim, e, dt);
        break;
      case 'datacollector':
        updateCollector(sim, e, dt);
        break;
      case 'training':
        updateTraining(sim, e, dt);
        break;
      case 'radar':
        updateRadar(sim, e, dt);
        break;
      case 'ci':
      case 'droneport':
      case 'spire':
      case 'turret':
        simpleConsumer(sim, e);
        break;
    }
  }
}

function powerStatus(e: Entity): boolean {
  if (!isEnabled(e)) {
    e.status = 'disabled';
    e.wantPower = 0;
    return false;
  }
  if ((e.net ?? -1) < 0) {
    e.status = 'no_power';
    e.wantPower = BUILDINGS[e.type].power;
    return false;
  }
  return true;
}

function simpleConsumer(sim: Sim, e: Entity): void {
  const def = BUILDINGS[e.type];
  if (!powerStatus(e)) return;
  if (e.type === 'turret') {
    e.wantPower = (e.cooldown ?? 0) > 0 ? def.power : def.idle;
  } else e.wantPower = def.power;
  const s = e.sat ?? 0;
  e.status = s <= 0.01 ? 'no_power' : s < 0.6 ? 'low_power' : 'working';
  if (e.type === 'turret' && e.status === 'working') e.status = (e.cooldown ?? 0) > 0 ? 'working' : 'idle';
  void sim;
}

function updateDrill(sim: Sim, e: Entity, dt: number): void {
  const def = BUILDINGS.drill;
  if (!powerStatus(e)) return;
  if (e.hand) {
    e.wantPower = def.idle;
    if (tryOutput(sim, e, e.hand)) {
      e.hand = 0;
    } else {
      e.status = 'output_full';
      return;
    }
  }
  // find a tile with resource
  const W = sim.world.w;
  let tile = -1;
  let bestAmt = 0;
  for (let y = e.y; y < e.y + e.h; y++) {
    for (let x = e.x; x < e.x + e.w; x++) {
      const i = y * W + x;
      const code = sim.world.res[i];
      if (!code || RES_BY_CODE[code] === 'oil') continue;
      if (sim.world.amt[i] > bestAmt) {
        bestAmt = sim.world.amt[i];
        tile = i;
      }
    }
  }
  if (tile < 0) {
    e.status = 'no_resource';
    e.wantPower = def.idle;
    return;
  }
  const res = RES_BY_CODE[sim.world.res[tile]] as ItemId;
  e.recipe = res;
  e.wantPower = def.power;
  const sat = e.sat ?? 0;
  if (sat <= 0.01) {
    e.status = 'no_power';
    return;
  }
  e.status = sat < 0.6 ? 'low_power' : 'working';
  e.mine = (e.mine ?? 0) + dt * (def.speed ?? 0.5) * (1 + sim.effects.miningProd) * sat;
  if (e.mine >= 1) {
    e.mine -= 1;
    sim.world.amt[tile] -= 1;
    if (sim.world.amt[tile] <= 0) {
      sim.world.amt[tile] = 0;
      sim.world.res[tile] = 0;
      sim.world.dirtyChunks.add(sim.world.chunkOf(tile % W, Math.floor(tile / W)));
    }
    const idx = ITEM_INDEX[res];
    sim.stats.produce(res, 1);
    if (!tryOutput(sim, e, idx)) e.hand = idx;
  }
}

function tryOutput(sim: Sim, e: Entity, idx: number): boolean {
  const t = outputTile(e);
  const o = sim.entityAt(t.x, t.y);
  if (!o || o.ghost) return false;
  return offer(sim, o, idx, true);
}

function updatePump(sim: Sim, e: Entity, dt: number): void {
  const def = BUILDINGS.pumpjack;
  if (!powerStatus(e)) return;
  const net = fluidNetOf(sim, e);
  let oilTile = -1;
  const W = sim.world.w;
  for (let y = e.y; y < e.y + e.h && oilTile < 0; y++) {
    for (let x = e.x; x < e.x + e.w; x++) {
      const i = y * W + x;
      if (RES_BY_CODE[sim.world.res[i]] === 'oil' && sim.world.amt[i] > 0) {
        oilTile = i;
        break;
      }
    }
  }
  if (oilTile < 0) {
    e.status = 'no_resource';
    e.wantPower = def.idle;
    return;
  }
  if (!net || net.amount >= net.capacity - 0.01) {
    e.status = 'output_full';
    e.wantPower = def.idle;
    return;
  }
  e.wantPower = def.power;
  const sat = e.sat ?? 0;
  if (sat <= 0.01) {
    e.status = 'no_power';
    return;
  }
  e.status = 'working';
  const amt = Math.min(PUMP_RATE * dt * sat, net.capacity - net.amount, sim.world.amt[oilTile]);
  net.amount += amt;
  sim.world.amt[oilTile] -= amt;
  sim.stats.produce('oil', amt);
}

function updateCrafter(sim: Sim, e: Entity, dt: number, boost: number): void {
  const def = BUILDINGS[e.type];
  if (!powerStatus(e)) {
    return;
  }
  const r = e.recipe ? RECIPES[e.recipe] : undefined;
  if (!r) {
    e.status = e.type === 'smelter' ? 'no_input' : 'no_recipe';
    e.wantPower = def.idle;
    return;
  }
  const sat = e.sat ?? 0;
  if (e.crafting) {
    e.wantPower = def.power;
    if (sat <= 0.01) {
      e.status = 'no_power';
      return;
    }
    e.status = sat < 0.6 ? 'low_power' : 'working';
    e.progress = (e.progress ?? 0) + (dt * (def.speed ?? 1) * boost * sat) / r.time;
    if (e.progress < 1) return;
    e.progress = 0;
    e.crafting = false;
    for (const o of r.outputs) {
      e.out![o.item] = (e.out![o.item] ?? 0) + o.n;
      sim.stats.produce(o.item, o.n);
    }
    if (sim.craftEvents.length < 400) sim.craftEvents.push({ x: e.x, y: e.y });
  }
  // try to start the next craft
  const outItem = r.outputs[0].item;
  const lim = sim.limits.get(outItem);
  if (lim !== undefined && cachedStock(sim, outItem) + (e.out![outItem] ?? 0) >= lim) {
    e.status = 'limit';
    e.wantPower = def.idle;
    return;
  }
  for (const o of r.outputs) {
    if ((e.out![o.item] ?? 0) + o.n > outputCap(o.n)) {
      e.status = 'output_full';
      e.wantPower = def.idle;
      return;
    }
  }
  for (const s of r.inputs) {
    if ((e.inv![s.item] ?? 0) < s.n) {
      e.status = 'no_input';
      e.wantPower = def.idle;
      return;
    }
  }
  let net = undefined as ReturnType<typeof fluidNetOf>;
  if (r.fluid) {
    net = fluidNetOf(sim, e);
    if (!net || net.amount < r.fluid.n) {
      e.status = 'no_fluid';
      e.wantPower = def.idle;
      return;
    }
  }
  if (r.ai) {
    if ((r.ai.data ?? 0) > sim.ai.data || (r.ai.weights ?? 0) > sim.ai.weights) {
      e.status = 'no_input';
      e.wantPower = def.idle;
      return;
    }
  }
  for (const s of r.inputs) {
    e.inv![s.item] -= s.n;
    sim.stats.consume(s.item, s.n);
  }
  if (r.fluid && net) {
    net.amount -= r.fluid.n;
    sim.stats.consume('oil', r.fluid.n);
  }
  if (r.ai) {
    if (r.ai.data) {
      sim.ai.data -= r.ai.data;
      sim.stats.consume('data', r.ai.data);
    }
    if (r.ai.weights) {
      sim.ai.weights -= r.ai.weights;
      sim.stats.consume('weights', r.ai.weights);
    }
  }
  e.crafting = true;
  e.progress = 0;
  e.wantPower = def.power;
  e.status = sat <= 0.01 ? 'no_power' : 'working';
}

function updateLab(sim: Sim, e: Entity, dt: number): void {
  const def = BUILDINGS.lab;
  if (!powerStatus(e)) return;
  const cur = sim.research.current;
  if (!cur) {
    e.status = 'no_research';
    e.wantPower = def.idle;
    e.crafting = false;
    return;
  }
  const t = TECHS[cur];
  const sat = e.sat ?? 0;
  if (e.crafting && e.recipe !== cur) {
    // research switched: keep partial unit on the new tech
    e.recipe = cur;
  }
  if (!e.crafting) {
    for (const p of t.packs) {
      if ((e.inv![p] ?? 0) < 1) {
        e.status = 'no_input';
        e.wantPower = def.idle;
        return;
      }
    }
    for (const p of t.packs) {
      e.inv![p]--;
      sim.stats.consume(p, 1);
    }
    e.crafting = true;
    e.progress = 0;
    e.recipe = cur;
  }
  e.wantPower = def.power;
  if (sat <= 0.01) {
    e.status = 'no_power';
    return;
  }
  e.status = 'working';
  e.progress = (e.progress ?? 0) + (dt * (def.speed ?? 1) * sat) / t.time;
  if (e.progress >= 1) {
    e.progress = 0;
    e.crafting = false;
    const done = (sim.research.progress[cur] ?? 0) + 1;
    sim.research.progress[cur] = done;
    if (done >= t.count) sim.completeResearch(cur);
  }
}

function updateCompute(sim: Sim, e: Entity, dt: number): void {
  const def = BUILDINGS[e.type];
  if (!powerStatus(e)) return;
  e.wantPower = def.power;
  const sat = e.sat ?? 0;
  if (sat <= 0.01) {
    e.status = 'no_power';
    return;
  }
  let rate = COMPUTE[e.type] ?? 0;
  if (e.type === 'datacenter') {
    if (e.cooled === undefined) e.cooled = nearWater(sim, e, 4);
    if (!e.cooled) rate *= 0.4;
  }
  const add = rate * sat * dt;
  sim.ai.compute += add;
  sim.stats.produce('compute', add);
  e.status = e.type === 'datacenter' && !e.cooled ? 'no_cooling' : sat < 0.6 ? 'low_power' : 'working';
}

export function nearWater(sim: Sim, e: Entity, r: number): boolean {
  for (let y = e.y - r; y < e.y + e.h + r; y++) {
    for (let x = e.x - r; x < e.x + e.w + r; x++) {
      if (!sim.world.inBounds(x, y)) continue;
      if (isWater(sim.world.biome[sim.world.idx(x, y)])) return true;
    }
  }
  return false;
}

function updateInference(sim: Sim, e: Entity, dt: number): void {
  const def = BUILDINGS.inference;
  if (!powerStatus(e)) return;
  const sat = e.sat ?? 0;
  const need = 4 * dt * sat;
  if (sim.ai.compute < need || need <= 0) {
    e.status = sat <= 0.01 ? 'no_power' : 'no_input';
    e.wantPower = def.idle;
    return;
  }
  e.wantPower = def.power;
  sim.ai.compute -= need;
  sim.stats.consume('compute', need);
  const tok = 3 * dt * sat;
  sim.ai.tokens += tok;
  sim.stats.produce('tokens', tok);
  e.status = 'working';
}

function updateCollector(sim: Sim, e: Entity, dt: number): void {
  const def = BUILDINGS.datacollector;
  if (!powerStatus(e)) return;
  e.wantPower = def.power;
  const sat = e.sat ?? 0;
  if (sat <= 0.01) {
    e.status = 'no_power';
    return;
  }
  // base trickle; bonus per nearby craft is added once per second in the AI layer
  const add = 0.12 * dt * sat;
  sim.ai.data += add;
  sim.stats.produce('data', add);
  e.status = 'working';
}

function updateTraining(sim: Sim, e: Entity, dt: number): void {
  const def = BUILDINGS.training;
  if (!powerStatus(e)) return;
  const sat = e.sat ?? 0;
  const c = 25 * dt * sat;
  const d = 1 * dt * sat;
  if (sat <= 0.01) {
    e.status = 'no_power';
    e.wantPower = def.power;
    return;
  }
  if (sim.ai.compute < c || sim.ai.data < d) {
    e.status = 'no_input';
    e.wantPower = def.idle;
    return;
  }
  e.wantPower = def.power;
  sim.ai.compute -= c;
  sim.ai.data -= d;
  sim.stats.consume('compute', c);
  sim.stats.consume('data', d);
  const w = 0.05 * dt * sat;
  sim.ai.weights += w;
  sim.ai.weightsTotal += w;
  sim.stats.produce('weights', w);
  e.status = 'working';
}

function updateRadar(sim: Sim, e: Entity, dt: number): void {
  const def = BUILDINGS.radar;
  if (!powerStatus(e)) return;
  e.wantPower = def.power;
  const sat = e.sat ?? 0;
  if (sat <= 0.01) {
    e.status = 'no_power';
    return;
  }
  e.status = 'working';
  e.scanR = Math.min(48, (e.scanR ?? 12) + 0.35 * dt * sat);
  if ((sim.tick + e.id) % 60 === 0) sim.world.reveal(e.x + 1, e.y + 1, e.scanR);
}
