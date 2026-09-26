import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { Sim } from '../src/sim/sim';
import { PlaytestBot } from '../src/bot';

describe('playtest bot (node)', () => {
  it('plays the first 20 minutes by the rules and hits the opening milestones', () => {
    const sim = Sim.newGame({ seed: 20260926, peaceful: false });
    sim.settings.hallucinations = false;
    const bot = new PlaytestBot(sim);
    const marks: Record<number, string[]> = {};
    for (let m = 1; m <= 20; m++) {
      bot.run(60);
      marks[m] = sim.quests.done.slice();
    }
    const report = {
      quests: sim.quests.done,
      research: sim.research.done,
      produced: Object.fromEntries(Object.entries(sim.stats.totalProduced).filter(([k]) => !['compute', 'tokens', 'data'].includes(k)).map(([k, v]) => [k, Math.round(v)])),
      entities: sim.list.length,
      ghosts: sim.list.filter((e) => e.ghost).map((e) => e.type + ':' + e.status),
      commits: sim.git.commits.map((c) => c.version + ' ' + c.message),
      log: bot.log,
      statuses: sim.list.filter((e) => ['drill', 'smelter', 'assembler', 'lab'].includes(e.type)).map((e) => e.type + ':' + e.status),
      stock: sim.stockAll(),
      marks,
    };
    fs.mkdirSync('/tmp/vf', { recursive: true });
    fs.writeFileSync('/tmp/vf/bot.json', JSON.stringify(report, null, 1));
    for (const q of ['q_drill', 'q_belt', 'q_smelt', 'q_copper', 'q_gears', 'q_vibe', 'q_lab', 'q_research']) expect(sim.quests.done).toContain(q);
  });
});
