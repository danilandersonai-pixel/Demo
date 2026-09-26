import { describe, it, expect } from 'vitest';
import { buildDemo } from '../src/demo';
import { headCommit } from '../src/vibe/git';
import { mainPower } from '../src/sim/power';

describe('demo scenario', () => {
  it('shows every key mechanic', () => {
    const sim = buildDemo();
    expect(sim.ai.era).toBe(3);
    expect(sim.ai.agents.filter((a) => a.role !== 'terminal').length).toBe(4);
    expect(sim.git.commits.length).toBeGreaterThanOrEqual(6);
    const tags = sim.git.commits.map((c) => c.tag);
    expect(tags).toContain('catastrophe');
    expect(tags).toContain('rollback');
    expect(headCommit(sim.git)!.version).toBe('v1.6');
    expect(sim.scripts.instances.length).toBeGreaterThanOrEqual(4);
    expect(sim.ai.ciTests.length).toBe(3);
    expect(sim.drones.some((d) => d.state !== 'idle')).toBe(true);
    sim.run(30);
    const chips = sim.stats.rate('microchip');
    const batteries = sim.stats.rate('battery');
    const plates = sim.stats.rate('iron_plate');
    // working chip and battery lines
    expect(chips).toBeGreaterThan(3);
    expect(batteries).toBeGreaterThan(3);
    expect(plates).toBeGreaterThan(3);
    // night falls within ~1 minute
    let night = false;
    for (let i = 0; i < 40 && !night; i++) {
      sim.run(1);
      night = sim.isNight;
    }
    expect(night).toBe(true);
    const net = mainPower(sim);
    expect(net.capacity).toBeGreaterThan(5000);
  });
});
