import { Sim } from './sim/sim';
import { Biome, Deco } from './data/biomes';

/**
 * Stress factory for performance measurements: belt loops full of items plus ~2000 powered buildings.
 * Returns counts for reporting.
 */
export function buildStress(sim: Sim, target = { buildings: 2000, items: 10000 }): { buildings: number; belts: number; items: number } {
  const w = sim.world;
  const x0 = 8;
  const y0 = 8;
  const W = w.w - 16;
  const H = w.h - 16;
  for (let y = y0; y < y0 + H; y++) for (let x = x0; x < x0 + W; x++) {
    const i = w.idx(x, y);
    if (w.occ[i]) continue;
    w.biome[i] = Biome.Meadow;
    w.deco[i] = Deco.None;
    w.res[i] = 0;
    w.amt[i] = 0;
    w.fog[i] = 1;
  }
  const hq = sim.hq!;
  let buildings = 0;
  let belts = 0;
  // belt loops (rectangles 24×6) in the top half
  const loops: [number, number][] = [];
  for (let ly = y0 + 2; ly < y0 + H / 2 - 8; ly += 9) for (let lx = x0 + 2; lx < x0 + W - 28; lx += 28) loops.push([lx, ly]);
  const LW = 24;
  const LH = 6;
  for (const [lx, ly] of loops) {
    if (lx < hq.x + 8 && lx + LW > hq.x - 3 && ly < hq.y + 8 && ly + LH > hq.y - 3) continue;
    for (let x = lx; x < lx + LW; x++) {
      sim.place('belt', x, ly, 1, { force: true, instant: true });
      sim.place('belt', x + 1, ly + LH, 3, { force: true, instant: true });
    }
    for (let y = ly; y < ly + LH; y++) {
      sim.place('belt', lx + LW, y, 2, { force: true, instant: true });
      sim.place('belt', lx, y + 1, 0, { force: true, instant: true });
    }
  }
  // fill belts with items (3 per tile) until the item target is reached
  let items = 0;
  for (const e of sim.list) {
    if (e.type !== 'belt' || e.bi === undefined) continue;
    belts++;
    for (let k = 0; k < 3 && items < target.items; k++) {
      if (sim.belts.insert(e.bi, 1 + ((e.id + k) % 20), k * 0.3 + 0.05)) items++;
    }
  }
  // powered buildings in the bottom half: assemblers crafting gears + inserters + poles
  outer: for (let y = y0 + H / 2; y < y0 + H - 4; y += 5) {
    for (let x = x0 + 2; x < x0 + W - 4; x += 4) {
      if (buildings >= target.buildings) break outer;
      const a = sim.place('assembler', x, y, 1, { force: true, instant: true, recipe: 'gear' });
      if (a) {
        a.inv = { iron_plate: 1e6 };
        buildings++;
      }
      const ins = sim.place('inserter', x + 3, y + 1, 1, { force: true, instant: true });
      if (ins) buildings++;
      if ((x / 4) % 2 === 0) {
        const p = sim.place('pole', x + 3, y + 3, 0, { force: true, instant: true });
        if (p) buildings++;
      }
    }
  }
  // generous power so every building works
  for (let k = 0; k < 6; k++) {
    const r = sim.place('reactor', x0 + 2 + k * 6, y0 + H - 6, 1, { force: true, instant: true });
    if (r) r.inv = { uranium_fuel: 1e6 };
  }
  sim.topoDirty = true;
  return { buildings, belts, items };
}
