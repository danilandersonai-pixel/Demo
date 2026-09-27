import { describe, it, expect } from 'vitest';
import { testSim, give } from './helpers';
import { hire } from '../src/ai/agents';
import { installAutopilot } from '../src/ai/ai';
import { TECH_LIST } from '../src/data/research';
import { QUESTS } from '../src/data/quests';
import { BUILDING_LIST } from '../src/data/buildings';

describe('progression: eras 1 → 4 and victory', () => {
  it('content volume matches the brief', () => {
    expect(TECH_LIST.length).toBeGreaterThanOrEqual(35);
    expect(QUESTS.length).toBeGreaterThanOrEqual(25);
    expect(BUILDING_LIST.filter((b) => !b.hidden).length).toBeGreaterThanOrEqual(12);
  });

  it('eras advance on their conditions and the colony can win', () => {
    const sim = testSim(21);
    sim.settings.hallucinations = false;
    const { x, y } = sim.world.base;
    give(sim, { steel: 5000, microchip: 5000, battery: 2000, tensor_chip: 2000, memory_module: 2000, stone_brick: 5000, iron_plate: 5000, gear: 5000, copper_wire: 5000, uranium_fuel: 500, magnet: 500, copper_plate: 5000 });
    const events: number[] = [];
    sim.events.on('era', (e) => events.push(e.era));
    // era 2: research + AI Core
    sim.completeResearch('ai_core');
    sim.place('aicore', x + 5, y - 2, 0);
    sim.run(2);
    expect(sim.ai.era).toBe(2);
    for (const t of ['agent_coder', 'agent_debugger', 'agent_optimizer']) sim.completeResearch(t);
    sim.ai.compute = 1e6;
    sim.ai.tokens = 1e6;
    expect(hire(sim, 'coder')).toBeTruthy();
    expect(hire(sim, 'debugger')).toBeTruthy();
    // era 3: autonomous drones + droneport + model v1.5
    sim.completeResearch('autonomous_drones');
    sim.completeResearch('droneport');
    sim.place('droneport', x - 8, y - 2, 0);
    sim.ai.weightsTotal = 10;
    sim.run(2);
    expect(sim.ai.era).toBe(3);
    // era 4: autonomy + v2.5 + 4 agents
    for (const t of ['agent_architect', 'agent_orchestrator', 'autonomy', 'colony_spire', 'nuclear']) sim.completeResearch(t);
    expect(hire(sim, 'optimizer')).toBeTruthy();
    expect(hire(sim, 'architect')).toBeTruthy();
    sim.ai.weightsTotal = 30;
    sim.run(2);
    expect(sim.ai.era).toBe(4);
    expect(hire(sim, 'orchestrator')).toBeTruthy();
    expect(events).toEqual([2, 3, 4]);
    // Spire needs 20 MW: a reactor with fuel next to the base
    const reactor = sim.place('reactor', x + 12, y - 2, 0)!;
    reactor.inv = { uranium_fuel: 3 };
    sim.place('spire', x - 3, y + 8, 0);
    for (let i = 0; i < 4; i++) sim.place('pole', x + 4 + i * 3, y + 4, 0);
    sim.place('pole', x + 1, y + 7, 0);
    // autopilot puts every production building under agent control
    const orch = sim.ai.agents.find((a) => a.role === 'orchestrator')!;
    installAutopilot(sim, orch.id);
    let won = false;
    sim.events.on('victory', () => (won = true));
    for (let t = 0; t < 900 && !won; t += 10) {
      sim.ai.manualActions = [];
      reactor.inv!.uranium_fuel = 3;
      sim.run(10);
    }
    expect(sim.ai.autonomy).toBeGreaterThan(0.9);
    expect(won).toBe(true);
  });
});
