import { describe, it, expect } from 'vitest';
import { testSim, give } from './helpers';
import type { Sim } from '../src/sim/sim';
import { sendRequest, acceptProposal, rollbackTo, bugs, completeScan, requestFix, editProposal } from '../src/vibe/vibe';
import { headFiles, diffLines } from '../src/vibe/git';
import { startSandbox } from '../src/vibe/sandbox';
import { hallucinate } from '../src/ai/hallucination';
import { hire } from '../src/ai/agents';
import { Rng } from '../src/core/rng';
import { parse } from '../src/script/parser';

const REQ1 = 'Сделай так, чтобы медная руда автоматически доставлялась на переработку, приоритет отдавался аккумуляторам, а если энергии не хватает — временно отключай производство микросхем.';

function chipFactory(sim: Sim, n = 10): number[] {
  give(sim, { iron_plate: 5000, gear: 2000, copper_plate: 2000, stone_brick: 2000, steel: 500 });
  const { x, y } = sim.world.base;
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = sim.place('assembler2', x - 14 + (i % 5) * 3, y + 4 + Math.floor(i / 5) * 3, 0, { recipe: 'microchip', force: true })!;
    a.inv = { silicon_wafer: 999, copper_wire: 999, plastic: 999 };
    ids.push(a.id);
  }
  for (let i = 0; i < 4; i++) {
    sim.place('pole', x - 13 + i * 4, y + 3, 0, { force: true });
    sim.place('pole', x - 13 + i * 4, y + 10, 0, { force: true });
  }
  return ids;
}

function untilProposal(sim: Sim, seconds = 20) {
  const n0 = sim.ai.proposals.length;
  for (let t = 0; t < seconds * 60 && sim.ai.proposals.length === n0; t++) sim.step();
  return sim.ai.proposals[sim.ai.proposals.length - 1];
}

describe('vibe coding loop', () => {
  it('request #1 → proposal with the reference code → commit → chips disabled on shortage (criterion 4)', () => {
    const sim = testSim(5);
    const chips = chipFactory(sim, 10);
    sim.ai.tokens = 5000;
    sim.ai.compute = 5000;
    expect(sendRequest(sim, REQ1).ok).toBe(true);
    const p = untilProposal(sim);
    expect(p).toBeTruthy();
    expect(p.code).toContain('class CopperRouter(Agent):');
    expect(p.checklist).toContain('Запущен мониторинг');
    const c = acceptProposal(sim, p.id)!;
    expect(c.version).toBe('v1.1');
    expect(headFiles(sim.git)['automation.py']).toBe(p.code);
    sim.run(3);
    expect(sim.ents.get(chips[0])!.scriptOff).toBe(true);
    expect(sim.scripts.controllers(chips[0])).toContain('CopperRouter');
  });

  it('charges tokens and refuses requests without tokens', () => {
    const sim = testSim();
    sim.ai.tokens = 3;
    expect(sendRequest(sim, 'Держи запас аккумуляторов на уровне 500').ok).toBe(false);
    sim.ai.tokens = 1000;
    expect(sendRequest(sim, 'Держи запас аккумуляторов на уровне 500').ok).toBe(true);
    expect(sim.ai.tokens).toBeLessThan(1000);
  });

  it('asks a clarifying question with options for gibberish', () => {
    const sim = testSim();
    sim.settings.hallucinations = false;
    sim.ai.tokens = 1000;
    sendRequest(sim, 'абырвалг');
    sim.run(5);
    const last = sim.ai.chat[sim.ai.chat.length - 1];
    expect(last.from).toBe('agent');
    expect(last.options?.length).toBeGreaterThan(0);
  });

  it('rollback restores the previous scripts as a new commit', () => {
    const sim = testSim();
    sim.ai.tokens = 5000;
    sendRequest(sim, 'Держи запас аккумуляторов на уровне 500');
    acceptProposal(sim, untilProposal(sim).id);
    sendRequest(sim, 'Ночью отключай всё, кроме серверов');
    acceptProposal(sim, untilProposal(sim).id);
    expect(headFiles(sim.git)['automation.py']).toContain('NightShift');
    const v11 = sim.git.commits.find((c) => c.version === 'v1.1')!;
    const r = rollbackTo(sim, v11.id)!;
    expect(r.tag).toBe('rollback');
    expect(headFiles(sim.git)['automation.py']).toContain('BatteryStock');
    expect(sim.git.commits.map((c) => c.version)).toEqual(['v1.0', 'v1.1', 'v1.2', 'v1.3']);
  });

  it('diff shows added and removed lines', () => {
    const d = diffLines('a\nb\nc', 'a\nx\nc');
    expect(d.filter((l) => l.op === '+').map((l) => l.text)).toEqual(['x']);
    expect(d.filter((l) => l.op === '-').map((l) => l.text)).toEqual(['b']);
  });

  it('accepting without sandbox adds tech debt; refactor pays it down', () => {
    const sim = testSim();
    sim.ai.tokens = 9000;
    sendRequest(sim, 'Держи запас аккумуляторов на уровне 500');
    acceptProposal(sim, untilProposal(sim).id);
    const debt = sim.ai.techDebt;
    expect(debt).toBeGreaterThan(0);
    sim.ai.era = 2;
    sendRequest(sim, 'Отрефактори скрипты');
    const p = untilProposal(sim);
    expect(p.kind).toBe('refactor');
    acceptProposal(sim, p.id);
    expect(sim.ai.techDebt).toBeLessThan(debt);
  });

  it('manual edits are validated by the parser', () => {
    const sim = testSim();
    sim.ai.tokens = 5000;
    sendRequest(sim, 'Держи запас аккумуляторов на уровне 500');
    const p = untilProposal(sim);
    expect(editProposal(sim, p.id, 'class X(Agent)\n  pass').ok).toBe(false);
    expect(editProposal(sim, p.id, 'class X(Agent):\n    def run(self):\n        self.limit("battery", 300)\n').ok).toBe(true);
    expect(p.edited).toBe(true);
  });
});

describe('hallucinations, Debugger and fixes', () => {
  it('every mutation type produces parseable code with a recorded line', () => {
    const code = 'class A(Agent):\n    def run(self):\n        if self.power < 0.8:\n            self.disable("chip_production")\n        else:\n            self.enable("chip_production")\n        self.route("copper_ore", "smelter")\n';
    const seen = new Set<string>();
    for (let s = 1; s < 400 && seen.size < 6; s++) {
      const h = hallucinate(code, new Rng(s))!;
      expect(() => parse(h.code)).not.toThrow();
      expect(h.bug.line).toBeGreaterThan(0);
      seen.add(h.bug.type);
    }
    expect([...seen].sort()).toEqual(['bad_group', 'bad_threshold', 'flapping', 'inverted', 'missing_else', 'wrong_item']);
  });

  it('a hallucinated bug shows up in the factory, Debugger finds it, fix restores behaviour', () => {
    const sim = testSim(9);
    const chips = chipFactory(sim, 10);
    sim.ai.tokens = 9000;
    sim.ai.compute = 9000;
    sim.ai.era = 2;
    // first commit is protected from hallucinations; make one clean commit first
    sendRequest(sim, 'Держи запас аккумуляторов на уровне 500');
    acceptProposal(sim, untilProposal(sim).id);
    // force a bug: inverted condition
    sim.settings.hallucinations = true;
    sim.ai.weightsTotal = 0;
    let p;
    for (let tries = 0; tries < 40; tries++) {
      sendRequest(sim, 'Если энергии не хватает — отключай производство микросхем');
      p = untilProposal(sim);
      if (p.bugs.length) break;
      p.status = 'rejected';
    }
    expect(p!.bugs.length).toBe(1);
    acceptProposal(sim, p!.id);
    expect(bugs(sim).filter((b) => !b.fixed).length).toBe(1);
    // Debugger scan
    const dbgFound = completeScan(sim, null, true) + completeScan(sim, null, true) + completeScan(sim, null, true) + completeScan(sim, null, true);
    expect(dbgFound).toBeGreaterThanOrEqual(1);
    const b = bugs(sim).find((x) => x.found)!;
    requestFix(sim, b.id);
    const fix = untilProposal(sim);
    expect(fix.kind).toBe('fix');
    acceptProposal(sim, fix.id);
    expect(sim.flags.bugsFixed).toBe(1);
    expect(sim.git.commits[sim.git.commits.length - 1].tag).toBe('fix');
    sim.run(3);
    // after the fix chips are disabled only because of the real shortage
    expect(sim.ents.get(chips[0])!.scriptOff).toBe(true);
  });

  it('hiring agents requires the AI Core era', () => {
    const sim = testSim();
    expect(hire(sim, 'coder')).toBeNull();
  });
});

describe('sandbox', () => {
  it('forecasts the effect of a proposal without touching the real factory', () => {
    const sim = testSim(3);
    chipFactory(sim, 10);
    sim.ai.tokens = 5000;
    sim.ai.compute = 5000;
    sendRequest(sim, 'Если энергии не хватает — отключай производство микросхем');
    const p = untilProposal(sim);
    const tickBefore = sim.tick;
    const job = startSandbox(sim, p, 30);
    while (!job.done) job.step(1000);
    expect(sim.tick).toBe(tickBefore);
    const f = job.forecast!;
    expect(f.rows.length).toBeGreaterThan(0);
    expect(f.summary).toContain('энергия');
    // disabling chips in a deficit must improve power satisfaction in the branch
    expect(f.powerAfter).toBeGreaterThan(f.powerBefore);
  });
});

describe('real-AI mode plumbing (no network)', () => {
  it('holds the agent at 95% until LLM code arrives, then proposes that code', () => {
    const sim = testSim();
    sim.ai.tokens = 5000;
    const r = sendRequest(sim, 'Держи запас аккумуляторов на уровне 300', undefined, { job: 'code', llmPending: true });
    expect(r.ok).toBe(true);
    sim.run(15);
    expect(sim.ai.proposals.length).toBe(0);
    expect(sim.ai.agents[0].task!.progress).toBeLessThanOrEqual(0.95);
    r.payload!.llmCode = 'class Stock(Agent):\n    def run(self):\n        self.limit("battery", 300)\n';
    r.payload!.llmNote = 'Код написан моделью claude-haiku-4-5.';
    r.payload!.llmPending = false;
    const p = untilProposal(sim);
    expect(p.code).toContain('class Stock(Agent)');
    expect(sim.ai.chat.some((m) => m.text.includes('claude-haiku-4-5'))).toBe(true);
  });

  it('never serializes an API key', () => {
    const sim = testSim();
    const json = JSON.stringify(sim.serialize());
    expect(json).not.toMatch(/sk-ant-/);
  });
});

describe('Architect', () => {
  it('plans a microchip line, places it and wires it to the grid', async () => {
    const { planLine, placeBlueprint } = await import('../src/ai/architect');
    const sim = testSim(4);
    give(sim, { steel: 500, microchip: 200, magnet: 50, gear: 500, iron_plate: 1000, copper_plate: 500, stone_brick: 200 });
    sim.completeResearch('electronics');
    const plan = planLine(sim, 'microchip', 30)!;
    expect(plan.machines).toBeGreaterThanOrEqual(2);
    const { x, y } = sim.world.base;
    const n = placeBlueprint(sim, plan.entities, x + 12, y - 4);
    expect(n).toBe(plan.entities.length);
    sim.run(2);
    const machines = sim.list.filter((e) => e.type === plan.machine);
    expect(machines.length).toBe(plan.machines);
    for (const m of machines) expect(m.net).toBe(sim.mainNet);
    expect(sim.flags.blueprintsPlaced).toBe(1);
  });
});
