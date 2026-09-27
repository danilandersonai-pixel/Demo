import { BUILDINGS } from '../data/buildings';
import { RECIPES } from '../data/recipes';
import { TECHS } from '../data/research';
import type { Sim } from './sim';
import type { Drone, Entity } from './types';
import { offer } from './logistics';
import { ITEM_INDEX, ITEMS, type ItemId } from '../data/items';

export const HQ_RANGE = 45;
export const PORT_RANGE = 30;
const BASE_SPEED = 9;
const BUILD_TIME = 0.5;

export const DRONE_NAMES: Record<Drone['kind'], string> = {
  construction: 'Строительный дрон',
  worker: 'Рабочий дрон',
  logistic: 'Логистический дрон',
  engineer: 'Инженер-робот',
  combat: 'Боевой дрон',
};

export const DRONE_COST: Record<Drone['kind'], { item: ItemId; n: number }[]> = {
  construction: [{ item: 'iron_plate', n: 10 }, { item: 'gear', n: 5 }, { item: 'battery', n: 2 }, { item: 'microchip', n: 2 }],
  worker: [{ item: 'iron_plate', n: 10 }, { item: 'battery', n: 2 }, { item: 'microchip', n: 3 }],
  logistic: [{ item: 'steel', n: 5 }, { item: 'battery', n: 3 }, { item: 'microchip', n: 3 }],
  engineer: [{ item: 'steel', n: 5 }, { item: 'gear', n: 10 }, { item: 'microchip', n: 4 }],
  combat: [{ item: 'steel', n: 10 }, { item: 'battery', n: 4 }, { item: 'microchip', n: 6 }],
};

export const DRONE_TECH: Record<Drone['kind'], string | undefined> = {
  construction: 'droneport',
  worker: 'drones_worker',
  logistic: 'drones_logistic',
  engineer: 'drones_engineer',
  combat: 'drones_combat',
};

export function droneHomes(sim: Sim): Entity[] {
  return sim.list.filter((e) => !e.ghost && (e.type === 'hq' || e.type === 'droneport'));
}

export function droneRangeOk(sim: Sim, x: number, y: number): boolean {
  for (const h of droneHomes(sim)) {
    const r = h.type === 'hq' ? HQ_RANGE : PORT_RANGE;
    const dx = h.x + h.w / 2 - x;
    const dy = h.y + h.h / 2 - y;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

function homeOf(sim: Sim, d: Drone): Entity | undefined {
  let h = sim.ents.get(d.home);
  if (!h || h.ghost) {
    h = sim.hq ?? undefined;
    if (h) d.home = h.id;
  }
  return h;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}

export function updateDrones(sim: Sim, dt: number): void {
  const speed = BASE_SPEED * (1 + sim.effects.droneSpeed);
  if (sim.tick % 60 === 17) ghostScan(sim);
  for (const d of sim.drones) {
    d.px = d.x;
    d.py = d.y;
    const home = homeOf(sim, d);
    if (!home) continue;
    const hx = home.x + home.w / 2;
    const hy = home.y + home.h / 2;
    switch (d.state) {
      case 'idle': {
        // hover near the pad
        if ((sim.tick + d.id * 7) % 12 === 0) assignTask(sim, d, home);
        break;
      }
      case 'fly': {
        const t = d.task!;
        if (moveTo(d, t.x, t.y, speed * dt)) {
          d.state = 'work';
          d.t = 0;
        }
        if (d.task?.type === 'attack') {
          const en = sim.enemies.find((x) => x.id === t.id);
          if (!en) {
            d.task = undefined;
            d.state = 'return';
          } else {
            t.x = en.x;
            t.y = en.y;
          }
        }
        break;
      }
      case 'work':
        doWork(sim, d, dt, home);
        break;
      case 'expedition': {
        d.t += dt;
        const poi = sim.world.pois.find((p) => p.id === d.task?.id);
        const dur = d.kind === 'worker' ? 15 : 30;
        // orbit the point
        if (poi) {
          d.x = poi.x + 0.5 + Math.cos(d.t * 2) * 1.2;
          d.y = poi.y + 0.5 + Math.sin(d.t * 2) * 1.2;
        }
        if (d.t >= dur) {
          if (poi) completePoi(sim, poi.id, d);
          d.task = undefined;
          d.state = 'return';
        }
        break;
      }
      case 'return': {
        if (moveTo(d, hx, hy, speed * dt)) {
          d.state = 'idle';
          if (d.carry) {
            sim.addStock(d.carry.item, d.carry.n);
            d.carry = undefined;
          }
        }
        break;
      }
      case 'rogue':
        break; // handled by enemies module
    }
    if (d.x !== d.px || d.y !== d.py) d.ang = Math.atan2(d.y - d.py, d.x - d.px);
  }
}

function moveTo(d: Drone, x: number, y: number, step: number): boolean {
  const dx = x - d.x;
  const dy = y - d.y;
  const l = Math.hypot(dx, dy);
  if (l <= step) {
    d.x = x;
    d.y = y;
    return true;
  }
  d.x += (dx / l) * step;
  d.y += (dy / l) * step;
  return false;
}

function inHomeRange(home: Entity, x: number, y: number): boolean {
  const r = home.type === 'hq' ? HQ_RANGE : PORT_RANGE;
  return dist2(home.x + home.w / 2, home.y + home.h / 2, x, y) <= r * r;
}

function assignTask(sim: Sim, d: Drone, home: Entity): void {
  const hx = home.x + home.w / 2;
  const hy = home.y + home.h / 2;
  if (d.kind === 'construction') {
    let best: Entity | undefined;
    let bestD = Infinity;
    let decon = false;
    for (const e of sim.list) {
      if (e.assigned) continue;
      if (!(e.ghost || e.decon)) continue;
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      if (!inHomeRange(home, cx, cy)) continue;
      if (e.ghost && !e.paid && !sim.hasStock(BUILDINGS[e.type].cost)) continue;
      // deconstruction first, then oldest ghosts weighted by distance
      const score = dist2(hx, hy, cx, cy) + (e.decon ? -1e6 : 0) + (e.createdAt ?? 0) * 0.02;
      if (score < bestD) {
        bestD = score;
        best = e;
        decon = !!e.decon;
      }
    }
    if (!best) return;
    if (!decon && !best.paid) {
      if (!sim.takeStock(BUILDINGS[best.type].cost)) return;
      best.paid = true;
    }
    best.assigned = d.id;
    d.task = { type: decon ? 'decon' : 'build', id: best.id, x: best.x + best.w / 2, y: best.y + best.h / 2 };
    d.state = 'fly';
    return;
  }
  if (d.kind === 'worker') {
    if (sim.flags.autoExplore) {
      const poi = nearestPoi(sim, hx, hy);
      if (poi) sendToPoi(sim, d, poi.id);
    }
    return;
  }
  if (d.kind === 'engineer') {
    let best: Entity | undefined;
    let bd = Infinity;
    for (const e of sim.list) {
      if (e.ghost || e.hp >= BUILDINGS[e.type].hp || e.assigned) continue;
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      if (!inHomeRange(home, cx, cy)) continue;
      const dd = dist2(hx, hy, cx, cy);
      if (dd < bd) {
        bd = dd;
        best = e;
      }
    }
    if (best) {
      best.assigned = d.id;
      d.task = { type: 'repair', id: best.id, x: best.x + best.w / 2, y: best.y + best.h / 2 };
      d.state = 'fly';
    }
    return;
  }
  if (d.kind === 'combat') {
    let best = undefined as undefined | (typeof sim.enemies)[number];
    let bd = Infinity;
    for (const en of sim.enemies) {
      const dd = dist2(hx, hy, en.x, en.y);
      if (dd < 40 * 40 && dd < bd) {
        bd = dd;
        best = en;
      }
    }
    if (best) {
      d.task = { type: 'attack', id: best.id, x: best.x, y: best.y };
      d.state = 'fly';
    }
    return;
  }
  if (d.kind === 'logistic') {
    for (const e of sim.list) {
      if (e.ghost || !e.recipe || !e.inv || e.assigned) continue;
      if (!inHomeRange(home, e.x, e.y)) continue;
      if (e.status === 'no_input') {
        const r = RECIPES[e.recipe];
        if (!r) continue;
        for (const s of r.inputs) {
          if ((e.inv[s.item] ?? 0) >= s.n) continue;
          const n = Math.min(5, sim.stock(s.item));
          if (n <= 0) continue;
          sim.takeStock([{ item: s.item, n }]);
          e.assigned = d.id;
          d.carry = { item: s.item, n };
          d.task = { type: 'deliver', id: e.id, x: e.x + e.w / 2, y: e.y + e.h / 2, item: s.item, n };
          d.state = 'fly';
          return;
        }
      } else if (e.status === 'output_full' && e.out) {
        e.assigned = d.id;
        d.task = { type: 'collect', id: e.id, x: e.x + e.w / 2, y: e.y + e.h / 2 };
        d.state = 'fly';
        return;
      }
    }
  }
}

function doWork(sim: Sim, d: Drone, dt: number, _home: Entity): void {
  const t = d.task;
  if (!t) {
    d.state = 'return';
    return;
  }
  d.t += dt;
  if (t.type === 'poi') {
    d.state = 'expedition';
    d.t = 0;
    return;
  }
  if (t.type === 'attack') {
    const en = sim.enemies.find((x) => x.id === t.id);
    if (!en) {
      d.task = undefined;
      d.state = 'return';
      return;
    }
    if (dist2(d.x, d.y, en.x, en.y) > 9) {
      d.state = 'fly';
      t.x = en.x;
      t.y = en.y;
      return;
    }
    if (d.t > 0.5) {
      d.t = 0;
      en.hp -= 14;
      sim.events.emit('fx', { kind: 'shot', x: d.x, y: d.y, x2: en.x, y2: en.y });
    }
    return;
  }
  const e = sim.ents.get(t.id);
  if (!e) {
    d.task = undefined;
    d.state = 'return';
    return;
  }
  switch (t.type) {
    case 'build':
      if (d.t >= (BUILDINGS[e.type].buildTime ?? BUILD_TIME)) {
        sim.finishBuild(e);
        d.task = undefined;
        d.state = 'return';
      }
      break;
    case 'decon':
      if (d.t >= BUILD_TIME) {
        sim.removeEntity(e, true);
        d.task = undefined;
        d.state = 'return';
      }
      break;
    case 'repair': {
      const max = BUILDINGS[e.type].hp;
      e.hp = Math.min(max, e.hp + 150 * dt);
      if (e.hp >= max) {
        delete e.assigned;
        d.task = undefined;
        d.state = 'return';
      }
      break;
    }
    case 'deliver': {
      if (d.carry) {
        const idx = ITEM_INDEX[d.carry.item as ItemId];
        while (d.carry.n > 0 && offer(sim, e, idx, true)) d.carry.n--;
        if (d.carry.n <= 0) d.carry = undefined;
      }
      delete e.assigned;
      d.task = undefined;
      d.state = 'return';
      break;
    }
    case 'collect': {
      if (e.out) {
        for (const k in e.out) {
          if (e.out[k] > 0 && !d.carry) {
            d.carry = { item: k, n: e.out[k] };
            e.out[k] = 0;
          }
        }
      }
      delete e.assigned;
      d.task = undefined;
      d.state = 'return';
      break;
    }
  }
}

function ghostScan(sim: Sim): void {
  for (const e of sim.list) {
    if (!e.ghost || e.assigned) continue;
    if (!droneRangeOk(sim, e.x + e.w / 2, e.y + e.h / 2)) e.status = 'out_of_range';
    else if (!e.paid && !sim.hasStock(BUILDINGS[e.type].cost)) e.status = 'no_materials';
    else e.status = 'waiting';
  }
}

export function nearestPoi(sim: Sim, x: number, y: number) {
  let best = undefined as undefined | (typeof sim.world.pois)[number];
  let bd = Infinity;
  for (const p of sim.world.pois) {
    if (p.explored || p.claimedBy) continue;
    const dd = dist2(x, y, p.x, p.y);
    if (dd < bd) {
      bd = dd;
      best = p;
    }
  }
  return best;
}

/** Send a drone to explore a point of interest. Returns false if no suitable drone. */
export function sendToPoi(sim: Sim, d: Drone, poiId: number): boolean {
  const poi = sim.world.pois.find((p) => p.id === poiId);
  if (!poi || poi.explored) return false;
  poi.claimedBy = d.id;
  d.task = { type: 'poi', id: poi.id, x: poi.x + 0.5, y: poi.y + 0.5 };
  d.state = 'fly';
  return true;
}

/** Dispatch any available drone of kind (falls back to a free construction drone for scouting). */
export function dispatchDrone(sim: Sim, kind: string, target: string | { x: number; y: number }): { ok: boolean; msg: string } {
  const k = normalizeDroneKind(kind);
  let pool = sim.drones.filter((d) => d.kind === k && d.state === 'idle');
  if (!pool.length && (k === 'worker')) pool = sim.drones.filter((d) => d.kind === 'construction' && d.state === 'idle');
  if (k === 'worker') {
    const target0 = typeof target === 'string' ? target : '';
    if (typeof target === 'string' && /unknown|poi|неизв/.test(target0)) {
      // idempotent: skip if a drone is already exploring
      if (sim.drones.some((d) => d.task?.type === 'poi' && d.state !== 'return')) return { ok: true, msg: 'Разведка уже идёт' };
      const home = sim.hq!;
      const poi = nearestPoi(sim, home.x, home.y);
      if (!poi) return { ok: false, msg: 'Неизвестных областей не осталось' };
      const d = pool[0];
      if (!d) return { ok: false, msg: 'Нет свободных дронов' };
      sendToPoi(sim, d, poi.id);
      return { ok: true, msg: `Дрон отправлен к точке (${poi.x}, ${poi.y})` };
    }
  }
  const d = pool[0];
  if (!d) return { ok: false, msg: 'Нет свободных дронов типа ' + k };
  if (typeof target === 'object') {
    d.task = { type: 'explore', id: 0, x: target.x, y: target.y };
    d.state = 'fly';
    return { ok: true, msg: 'Дрон отправлен' };
  }
  return { ok: false, msg: 'Неизвестная цель ' + target };
}

export function normalizeDroneKind(kind: string): Drone['kind'] {
  const k = kind.toLowerCase();
  if (/scout|worker|разв|рабоч|explor/.test(k)) return 'worker';
  if (/logist|логист|cargo/.test(k)) return 'logistic';
  if (/engin|инжен|repair/.test(k)) return 'engineer';
  if (/combat|боев|guard|defen/.test(k)) return 'combat';
  return 'construction';
}

export function completePoi(sim: Sim, poiId: number, d?: Drone): void {
  const poi = sim.world.pois.find((p) => p.id === poiId);
  if (!poi || poi.explored) return;
  poi.explored = true;
  delete poi.claimedBy;
  sim.world.reveal(poi.x + 0.5, poi.y + 0.5, 12);
  sim.flags.poisExplored = (sim.flags.poisExplored ?? 0) + 1;
  let text = '';
  switch (poi.kind) {
    case 'ruins':
      sim.ai.data += 250;
      sim.stats.produce('data', 250);
      text = 'Руины старых серверов: +250 данных для обучения';
      break;
    case 'drone': {
      const kind = sim.isUnlocked('drones_worker') ? 'worker' : 'construction';
      sim.addDrone(kind, sim.hq!.id);
      text = `Заброшенный дрон восстановлен: +1 ${DRONE_NAMES[kind].toLowerCase()}`;
      break;
    }
    case 'cache': {
      sim.addStock('steel', 30);
      sim.addStock('gear', 60);
      sim.addStock('iron_plate', 80);
      if (sim.research.current) {
        const cur = sim.research.current;
        sim.research.progress[cur] = (sim.research.progress[cur] ?? 0) + 5;
        if (sim.research.progress[cur] >= TECHS[cur].count) sim.completeResearch(cur);
      }
      text = 'Тайник чертежей: сталь, шестерни, пластины и +5 ед. исследования';
      break;
    }
    case 'anomaly':
      sim.ai.compute += 400;
      sim.ai.tokens += 300;
      sim.stats.produce('compute', 400);
      sim.stats.produce('tokens', 300);
      text = 'Аномалия: +400 вычислений и +300 токенов';
      break;
  }
  sim.toast({ kind: 'success', title: 'Экспедиция завершена', text, focus: { x: poi.x, y: poi.y } });
  void d;
  void ITEMS;
}
