import { describe, it, expect } from 'vitest';
import { testSim, buildGearLine, give, putResource } from './helpers';
import { mainPower } from '../src/sim/power';
import { Sim } from '../src/sim/sim';

describe('factory core', () => {
  it('ore → plates → gears flow on real belts and inserters', () => {
    const sim = testSim();
    const l = buildGearLine(sim);
    expect(l.drill && l.smelter && l.asm && l.store).toBeTruthy();
    sim.run(90);
    expect(sim.stats.totalProduced.iron_ore).toBeGreaterThan(20);
    expect(sim.stats.totalProduced.iron_plate).toBeGreaterThan(10);
    expect(l.store.store!.gear ?? 0).toBeGreaterThan(3);
  });

  it('belt carries items and blocks when the end is closed', () => {
    const sim = testSim();
    give(sim, { iron_plate: 100, gear: 50 });
    const { x, y } = sim.world.base;
    putResource(sim, x + 4, y + 6, 2, 2, 'copper_ore');
    sim.place('drill', x + 4, y + 6, 1);
    for (let i = 0; i < 6; i++) sim.place('belt', x + 6 + i, y + 6, 1);
    sim.run(60);
    let onBelts = 0;
    for (const e of sim.list) if (e.bi !== undefined) onBelts += sim.belts.cnt[e.bi];
    // 6 belts × 4 slots = 24 max; drill output stalls once full
    expect(onBelts).toBeGreaterThanOrEqual(20);
    expect(onBelts).toBeLessThanOrEqual(24);
  });

  it('power deficit slows consumers proportionally and priorities are honoured', () => {
    const sim = testSim();
    give(sim, { iron_plate: 2000, gear: 1000, copper_plate: 1000, stone_brick: 1000 });
    const { x, y } = sim.world.base;
    const asms = [];
    for (let i = 0; i < 16; i++) {
      const a = sim.place('assembler', x - 12 + (i % 8) * 3, y + 4 + Math.floor(i / 8) * 3, 0, { recipe: 'gear' })!;
      a.inv!.iron_plate = 5;
      asms.push(a);
    }
    // 16 × 75 kW = 1.2 MW > 1 MW
    for (let i = 0; i < 6; i++) sim.place('pole', x - 12 + i * 5, y + 3, 0);
    for (let i = 0; i < 6; i++) sim.place('pole', x - 12 + i * 5, y + 10, 0);
    asms[0].prio = 1;
    sim.run(0.5);
    const net = mainPower(sim);
    expect(net.demand).toBeGreaterThan(net.capacity);
    expect(asms[0].sat).toBe(1);
    expect(asms[5].sat!).toBeLessThan(1);
  });

  it('serialize → deserialize round-trips the factory', () => {
    const sim = testSim();
    buildGearLine(sim);
    sim.run(30);
    const snap = JSON.parse(JSON.stringify(sim.serialize()));
    const b = Sim.deserialize(snap);
    expect(b.list.length).toBe(sim.list.length);
    b.run(30);
    sim.run(30);
    expect(b.stats.totalProduced.iron_ore).toBe(sim.stats.totalProduced.iron_ore);
  });
});
