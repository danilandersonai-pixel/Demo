import type { Sim } from './sim';
import { RES_CODE } from '../data/items';
import { isWater } from '../data/biomes';

/** Random world events: sandstorm, geomagnetic storm, meteor. Checked once per second. */
export interface WorldEventState {
  next: number;
  sandstormUntil: number;
  geostormUntil: number;
}

export function solarFactor(sim: Sim): number {
  return sim.time < (sim.flags.sandstormUntil ?? 0) ? 0.3 : 1;
}

export function computeFactor(sim: Sim): number {
  return sim.time < (sim.flags.geostormUntil ?? 0) ? 0.6 : 1;
}

export function worldEvents(sim: Sim): void {
  if (sim.headless) return;
  if (sim.flags.nextWorldEvent === undefined) sim.flags.nextWorldEvent = 12 * 60 + sim.rng.range(0, 300);
  if (sim.time < sim.flags.nextWorldEvent) return;
  sim.flags.nextWorldEvent = sim.time + sim.rng.range(8 * 60, 14 * 60);
  const roll = sim.rng.next();
  if (roll < 0.4 && sim.list.some((e) => e.type === 'solar')) {
    sim.flags.sandstormUntil = sim.time + 90;
    sim.toast({ kind: 'warning', title: 'Песчаная буря', text: 'Солнечные поля дают 30 % мощности ближайшие 90 с. Самое время для скрипта с приоритетами.', key: 'sandstorm' });
  } else if (roll < 0.7 && sim.list.some((e) => e.type === 'server' || e.type === 'aicore' || e.type === 'datacenter')) {
    sim.flags.geostormUntil = sim.time + 60;
    sim.toast({ kind: 'warning', title: 'Геомагнитная буря', text: 'Помехи в серверах: вычисления −40 % на 60 с.', key: 'geostorm' });
  } else {
    // meteor: a fresh rare-earth (or uranium) patch somewhere in the explored area
    const w = sim.world;
    for (let t = 0; t < 200; t++) {
      const x = sim.rng.int(10, w.w - 10);
      const y = sim.rng.int(10, w.h - 10);
      const i = w.idx(x, y);
      if (!w.fog[i] || isWater(w.biome[i]) || w.occ[i] || w.res[i]) continue;
      const res = sim.rng.chance(0.7) ? 'rare_earth' : 'uranium_ore';
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (!w.inBounds(xx, yy) || Math.hypot(dx, dy) > 2.3) continue;
        const j = w.idx(xx, yy);
        if (isWater(w.biome[j]) || w.occ[j]) continue;
        w.res[j] = RES_CODE[res];
        w.amt[j] = 900;
        w.deco[j] = 0;
        w.markDirty(xx, yy);
      }
      w.deposits.push({ res, x, y, total: 900 * 18 });
      sim.events.emit('fx', { kind: 'explode', x, y });
      sim.toast({ kind: 'info', title: 'Метеорит!', text: res === 'rare_earth' ? 'Упал обломок с редкоземами — новое месторождение.' : 'Упал обломок с ураном — новое месторождение.', focus: { x, y }, key: 'meteor' + x });
      break;
    }
  }
}
