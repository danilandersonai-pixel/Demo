import { BUILDINGS } from '../data/buildings';
import type { Sim } from './sim';
import type { Entity } from './types';

const TURRET_RANGE = 12;
const ENEMY_SPEED = 1.6;
const FIRST_WAVE = 9 * 60;

/** Aggression of the rogue automatons: pollution + tech debt + catastrophes. */
export function aggression(sim: Sim): number {
  const pol = (sim.flags.pollution ?? 0) as number;
  const cat = (sim.flags.catastrophes ?? 0) as number;
  return 0.15 + pol / 400 + sim.ai.techDebt / 60 + cat * 0.25;
}

export function updateEnemies(sim: Sim, dt: number): void {
  if (sim.tick % 60 === 5) perSecond(sim);
  // movement & attacks
  for (const en of sim.enemies) {
    en.px = en.x;
    en.py = en.y;
    let t = sim.ents.get(en.target);
    if (!t || t.ghost) {
      t = nearestBuilding(sim, en.x, en.y);
      en.target = t?.id ?? 0;
      if (!t) continue;
    }
    const tx = Math.max(t.x, Math.min(t.x + t.w, en.x));
    const ty = Math.max(t.y, Math.min(t.y + t.h, en.y));
    const dx = tx - en.x;
    const dy = ty - en.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.9) {
      const step = ENEMY_SPEED * dt;
      en.x += (dx / d) * Math.min(step, d);
      en.y += (dy / d) * Math.min(step, d);
    } else {
      en.cooldown -= dt;
      if (en.cooldown <= 0) {
        en.cooldown = 1;
        damage(sim, t, en.rogueDrone ? 8 : 14);
        sim.events.emit('fx', { kind: 'spark', x: tx, y: ty });
      }
    }
  }
  // rogue drones
  for (const dr of sim.drones) {
    if (dr.state !== 'rogue') continue;
    dr.px = dr.x;
    dr.py = dr.y;
    const t = nearestBuilding(sim, dr.x, dr.y);
    if (!t) continue;
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    const dx = cx - dr.x;
    const dy = cy - dr.y;
    const d = Math.hypot(dx, dy);
    if (d > 1.2) {
      dr.x += (dx / d) * 4 * dt;
      dr.y += (dy / d) * 4 * dt;
      dr.ang = Math.atan2(dy, dx);
    } else {
      dr.t += dt;
      if (dr.t > 1) {
        dr.t = 0;
        damage(sim, t, 6);
        sim.events.emit('fx', { kind: 'spark', x: cx, y: cy });
      }
    }
  }
  // turrets
  for (const e of sim.list) {
    if (e.type !== 'turret' || e.ghost) continue;
    e.cooldown = Math.max(0, (e.cooldown ?? 0) - dt);
    if ((e.sat ?? 0) < 0.2) continue;
    if ((sim.tick + e.id) % 6 !== 0) continue;
    const cx = e.x + 1;
    const cy = e.y + 1;
    let best: { x: number; y: number; hp: number } | undefined;
    let bd = TURRET_RANGE * TURRET_RANGE;
    for (const en of sim.enemies) {
      const dd = (en.x - cx) ** 2 + (en.y - cy) ** 2;
      if (dd < bd) {
        bd = dd;
        best = en;
      }
    }
    for (const dr of sim.drones) {
      if (dr.state !== 'rogue') continue;
      const dd = (dr.x - cx) ** 2 + (dr.y - cy) ** 2;
      if (dd < bd) {
        bd = dd;
        best = dr;
      }
    }
    if (best && (e.cooldown ?? 0) <= 0.4) {
      best.hp -= 18 * (e.sat ?? 1);
      e.cooldown = 0.5;
      e.aim = Math.atan2(best.y - cy, best.x - cx);
      sim.events.emit('fx', { kind: 'shot', x: cx, y: cy, x2: best.x, y2: best.y });
    }
  }
  // deaths
  if (sim.enemies.length) {
    for (let i = sim.enemies.length - 1; i >= 0; i--) {
      const en = sim.enemies[i];
      if (en.hp <= 0) {
        sim.events.emit('fx', { kind: 'explode', x: en.x, y: en.y });
        sim.enemies.splice(i, 1);
        sim.flags.killed = (sim.flags.killed ?? 0) + 1;
      }
    }
  }
  for (let i = sim.drones.length - 1; i >= 0; i--) {
    const dr = sim.drones[i];
    if (dr.state === 'rogue' && dr.hp <= 0) {
      sim.events.emit('fx', { kind: 'explode', x: dr.x, y: dr.y });
      sim.drones.splice(i, 1);
    }
  }
}

function damage(sim: Sim, e: Entity, dmg: number): void {
  e.hp -= dmg;
  if (e.type === 'hq') {
    e.hp = Math.max(1, e.hp);
    return;
  }
  if (e.hp <= 0) {
    const { type, x, y, dir, recipe } = e;
    sim.removeEntity(e, false);
    sim.events.emit('fx', { kind: 'explode', x: x + e.w / 2, y: y + e.h / 2 });
    // auto-rebuild ghost (Factorio-style)
    const g = sim.place(type, x, y, dir, { byScript: true });
    if (g && recipe) g.recipe = recipe;
    sim.toast({ kind: 'danger', title: 'Здание уничтожено', text: `${BUILDINGS[type].name} — призрак для восстановления поставлен`, focus: { x, y }, key: 'destroyed' });
  }
}

function nearestBuilding(sim: Sim, x: number, y: number): Entity | undefined {
  let best: Entity | undefined;
  let bd = Infinity;
  for (const e of sim.list) {
    if (e.ghost || e.type === 'belt' || e.type === 'pipe' || e.type === 'pole') continue;
    const dd = (e.x + e.w / 2 - x) ** 2 + (e.y + e.h / 2 - y) ** 2;
    if (dd < bd) {
      bd = dd;
      best = e;
    }
  }
  return best;
}

function perSecond(sim: Sim): void {
  // pollution: sum of working polluters
  let pol = 0;
  for (const e of sim.list) {
    const p = BUILDINGS[e.type].pollution;
    if (p && e.status === 'working') pol += p;
  }
  sim.flags.pollution = pol;
  if (sim.settings.peaceful || !sim.world.nests.length) return;
  if (sim.time < FIRST_WAVE) return;
  const agg = aggression(sim);
  sim.flags.nextWave = sim.flags.nextWave ?? sim.time + 60;
  if (sim.time < sim.flags.nextWave) return;
  sim.flags.nextWave = sim.time + sim.rng.range(200, 380) / Math.min(4, agg);
  if (sim.enemies.length > 30) return;
  const nest = sim.rng.pick(sim.world.nests);
  const n = Math.min(10, 2 + Math.floor(agg * 2) + sim.ai.era);
  const target = nearestBuilding(sim, nest.x, nest.y);
  for (let i = 0; i < n; i++) {
    sim.enemies.push({
      id: sim.nextId++, x: nest.x + sim.rng.range(-1.5, 1.5), y: nest.y + sim.rng.range(-1.5, 1.5), px: nest.x, py: nest.y,
      hp: 60 + sim.ai.era * 15, target: target?.id ?? 0, cooldown: 1, nest: 0,
    });
  }
  sim.toast({ kind: 'danger', title: 'Сбойные автоматы атакуют!', text: `${n} одичавших роботов идут к фабрике`, focus: { x: nest.x, y: nest.y }, key: 'wave' });
}

/** Catastrophe side-effect: some drones go rogue until rollback. */
export function goRogue(sim: Sim, count: number): number {
  let n = 0;
  for (const d of sim.drones) {
    if (n >= count) break;
    if (d.kind === 'construction' && sim.drones.filter((x) => x.kind === 'construction' && x.state !== 'rogue').length <= 1) continue;
    if (d.state === 'rogue') continue;
    d.state = 'rogue';
    d.task = undefined;
    d.hp = 80;
    n++;
  }
  return n;
}

export function calmRogues(sim: Sim): void {
  for (const d of sim.drones) if (d.state === 'rogue') {
    d.state = 'return';
    d.hp = 100;
  }
}
