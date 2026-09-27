import { describe, it, expect } from 'vitest';
import { testSim, give, putResource } from './helpers';
import { cachedStock } from '../src/sim/machines';
import { powerRatio, mainPower } from '../src/sim/power';
import { sendRequest } from '../src/vibe/vibe';

describe('regressions from the code review', () => {
  it('stock cache is per simulation (sandbox clones do not share it)', () => {
    const a = testSim();
    give(a, { gear: 500 });
    expect(cachedStock(a, 'gear')).toBeGreaterThanOrEqual(500);
    const b = a.clone();
    b.hq!.store!.gear = 0;
    b.hq!.storeTotal = Object.values(b.hq!.store!).reduce((x, y) => x + y, 0);
    b.stockCache.tick = -1e9;
    expect(cachedStock(b, 'gear')).toBe(0);
    expect(cachedStock(a, 'gear')).toBeGreaterThanOrEqual(500);
  });

  it('two inserters bringing different ores to an empty smelter never jam forever', () => {
    const sim = testSim();
    give(sim, { iron_plate: 400, gear: 200, copper_plate: 200, stone_brick: 200 });
    const { x, y } = sim.world.base;
    const sx = x + 8;
    const sy = y + 8;
    putResource(sim, sx - 4, sy, 2, 2, 'iron_ore');
    putResource(sim, sx, sy - 4, 2, 2, 'copper_ore');
    sim.place('drill', sx - 4, sy, 1); // → belt at (sx-2, sy)
    sim.place('belt', sx - 2, sy, 1);
    sim.place('inserter', sx - 1, sy, 1);
    sim.place('drill', sx, sy - 4, 2); // south → output (sx+1, sy-2)
    sim.place('belt', sx + 1, sy - 2, 2);
    sim.place('inserter', sx + 1, sy - 1, 2);
    const sm = sim.place('smelter', sx, sy, 1)!;
    sim.place('pole', sx - 1, sy + 2, 0);
    sim.place('pole', x + 3, y + 5, 0);
    sim.place('pole', sx - 5, sy + 3, 0);
    sim.run(40);
    const inserters = sim.list.filter((e) => e.type === 'inserter');
    for (const ins of inserters) expect(ins.phase === 2 && (ins.t ?? 0) > 6).toBe(false);
    expect(sm.recipe).not.toBeNull();
    expect((sim.stats.totalProduced.iron_plate ?? 0) + (sim.stats.totalProduced.copper_plate ?? 0)).toBeGreaterThan(3);
  });

  it('underground belts pair even when the exit is built before the entrance', () => {
    const sim = testSim();
    sim.completeResearch('logistics2');
    give(sim, { iron_plate: 100, gear: 50 });
    const { x, y } = sim.world.base;
    const out = sim.place('underground', x + 12, y + 8, 1)!;
    const inn = sim.place('underground', x + 8, y + 8, 1)!;
    expect(inn.ug).toBe('in');
    expect(out.ug).toBe('out');
    expect(inn.pair).toBe(out.id);
    // removing the entrance frees the exit for a new pairing
    sim.removeEntity(inn, false);
    expect(out.pair).toBeUndefined();
    const inn2 = sim.place('underground', x + 9, y + 8, 1)!;
    expect(inn2.pair).toBe(out.id);
  });

  it('queued requests keep their token cost on the proposal', () => {
    const sim = testSim();
    sim.ai.tokens = 5000;
    sendRequest(sim, 'Держи запас аккумуляторов на уровне 500');
    sendRequest(sim, 'Ночью отключай всё, кроме серверов');
    for (let t = 0; t < 60 * 30 && sim.ai.proposals.length < 2; t++) sim.step();
    expect(sim.ai.proposals.length).toBe(2);
    for (const p of sim.ai.proposals) expect(p.tokens).toBeGreaterThan(0);
  });

  it('self.power does not count an almost empty accumulator bank as full reserve', () => {
    const sim = testSim();
    sim.completeResearch('accumulators');
    give(sim, { iron_plate: 2000, gear: 1000, copper_plate: 1000, stone_brick: 1000, battery: 50 });
    const { x, y } = sim.world.base;
    for (let i = 0; i < 12; i++) {
      const a = sim.place('assembler2', x - 14 + (i % 6) * 3, y + 4 + Math.floor(i / 6) * 3, 0, { recipe: 'science_mech', force: true })!;
      a.inv = { gear: 1e6, copper_plate: 1e6 };
    }
    for (let i = 0; i < 5; i++) sim.place('pole', x - 13 + i * 4, y + 3, 0, { force: true });
    for (let i = 0; i < 5; i++) sim.place('pole', x - 13 + i * 4, y + 10, 0, { force: true });
    const acc = sim.place('accumulator', x + 3, y - 6, 0, { force: true, instant: true })!;
    sim.run(1);
    acc.charge = 2; // nearly empty
    sim.run(1 / 60);
    const n = mainPower(sim);
    expect(n.nominal).toBeGreaterThan(n.capacity);
    expect(powerRatio(sim)).toBeLessThan(0.99);
  });
});
