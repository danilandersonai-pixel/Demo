import { Sim } from '../src/sim/sim';
import { Biome, Deco } from '../src/data/biomes';
import { RES_CODE, type ResourceId } from '../src/data/items';

/** New game with instant build and a flat, revealed plaza around the base. */
export function testSim(seed = 7): Sim {
  const sim = Sim.newGame({ seed, peaceful: true });
  sim.settings.instantBuild = true;
  sim.settings.hallucinations = false;
  const w = sim.world;
  const { x: bx, y: by } = w.base;
  for (let y = by - 30; y <= by + 30; y++) {
    for (let x = bx - 30; x <= bx + 40; x++) {
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y);
      if (w.occ[i]) continue;
      w.biome[i] = Biome.Meadow;
      w.deco[i] = Deco.None;
      w.fog[i] = 1;
      w.res[i] = 0;
      w.amt[i] = 0;
    }
  }
  return sim;
}

export function putResource(sim: Sim, x: number, y: number, w: number, h: number, r: ResourceId, amt = 5000): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const i = sim.world.idx(xx, yy);
      sim.world.res[i] = RES_CODE[r];
      sim.world.amt[i] = amt;
    }
}

export function give(sim: Sim, items: Record<string, number>): void {
  for (const k in items) sim.hq!.store![k] = (sim.hq!.store![k] ?? 0) + items[k];
  sim.hq!.storeTotal = Object.values(sim.hq!.store!).reduce((a, b) => a + b, 0);
}

/**
 * Standard test line east of HQ: drill(iron) → belt → inserter → smelter → inserter → assembler(gear) → inserter → storage.
 * Returns key entities.
 */
export function buildGearLine(sim: Sim) {
  give(sim, { iron_plate: 500, gear: 200, copper_plate: 200, stone_brick: 200 });
  const bx = sim.world.base.x;
  const by = sim.world.base.y;
  const x0 = bx + 4;
  const y0 = by;
  putResource(sim, x0, y0, 2, 2, 'iron_ore');
  const drill = sim.place('drill', x0, y0, 1)!;
  for (let x = x0 + 2; x <= x0 + 6; x++) sim.place('belt', x, y0, 1);
  const ins1 = sim.place('inserter', x0 + 7, y0, 1)!;
  const smelter = sim.place('smelter', x0 + 8, y0, 1)!;
  const ins2 = sim.place('inserter', x0 + 10, y0, 1)!;
  const asm = sim.place('assembler', x0 + 11, y0 - 1, 1, { recipe: 'gear' })!;
  const ins3 = sim.place('inserter', x0 + 14, y0, 1)!;
  const store = sim.place('storage', x0 + 15, y0, 1)!;
  for (let x = x0; x <= x0 + 18; x += 5) sim.place('pole', x, y0 + 2, 0);
  return { drill, ins1, smelter, ins2, asm, ins3, store, x0, y0 };
}
