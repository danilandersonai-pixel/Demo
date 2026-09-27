import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { Sim } from '../src/sim/sim';
import { buildStress } from '../src/stress';

describe('performance', () => {
  it('ticks a 2000-building / 10k-item factory well under the 16 ms frame budget', () => {
    const sim = Sim.newGame({ seed: 777, peaceful: true });
    const c = buildStress(sim);
    sim.run(2); // warm-up + topology
    const n = 600;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) sim.step();
    const ms = (performance.now() - t0) / n;
    const itemsOnBelts = sim.belts.totalItems();
    const report = { ...c, entities: sim.list.length, itemsOnBelts, msPerTick: Math.round(ms * 1000) / 1000, upsPossible: Math.round(1000 / ms) };
    fs.mkdirSync('docs', { recursive: true });
    fs.writeFileSync('docs/stress-result.json', JSON.stringify(report, null, 2));
    expect(c.buildings).toBeGreaterThanOrEqual(2000);
    expect(itemsOnBelts).toBeGreaterThanOrEqual(9000);
    expect(ms).toBeLessThan(8);
  });
});
