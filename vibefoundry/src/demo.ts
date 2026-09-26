import { Sim, DAY_LENGTH } from './sim/sim';
import { Biome, Deco } from './data/biomes';
import { RES_CODE, type ResourceId } from './data/items';
import { TECHS } from './data/research';
import type { BuildingType } from './data/buildings';
import type { Dir } from './core/iso';
import { planLine, connectPower } from './ai/architect';
import { commit } from './vibe/git';
import { analyze } from './vibe/intent';
import { generate } from './vibe/codegen';
import { pushChat } from './vibe/vibe';
import { sendToPoi, nearestPoi } from './sim/drones';
import type { Proposal } from './ai/state';
import { QUESTS } from './data/quests';

export const DEMO_SEED = 424242;

const REFERENCE = `class CopperRouter(Agent):
    every = 2          # запускать каждые 2 секунды игрового времени
    def run(self):
        if self.power < 0.8:
            self.disable("chip_production")
        self.set_priority("batteries", 1)
        self.route("copper_ore", "smelter")

class EnergyManager(Agent):
    def monitor(self):
        if self.energy < 0.6:
            self.shutdown("chip_production")
            self.notify("low_energy")
`;

const BATTERY = `class BatteryStock(Agent):
    def run(self):
        self.limit("battery", 400)
`;

const NIGHT_BAD = `class NightShift(Agent):
    every = 5
    def run(self):
        if not self.is_night:
            for b in self.buildings("all"):
                if b.type not in ["server", "datacenter"]:
                    self.disable(b)
`;

const NIGHT_OK = `class NightShift(Agent):
    every = 5
    def run(self):
        if self.is_night:
            self.disable("labs")
`;

const CHIP_WATCH_BUG = `class ChipWatcher(Agent):
    every = 5
    def monitor(self):
        if self.rate("micro_chip") < 10:
            self.notify("Производство: микросхемы ниже 10/мин", "warning")
`;

/** Build a mid-game factory (era "Дроны") that shows every key mechanic within two minutes. */
export function buildDemo(): Sim {
  const sim = Sim.newGame({ seed: DEMO_SEED, peaceful: false });
  const w = sim.world;
  const { x: bx, y: by } = w.base;
  // flatten a work area around the base
  for (let y = by - 26; y <= by + 30; y++) {
    for (let x = bx - 32; x <= bx + 46; x++) {
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y);
      if (w.occ[i]) continue;
      w.biome[i] = Math.abs(x - bx) + Math.abs(y - by) > 40 ? Biome.Plains : Biome.Meadow;
      w.deco[i] = (x + y * 7) % 23 === 0 && (x < bx - 28 || y > by + 26) ? Deco.Oak : Deco.None;
      w.res[i] = 0;
      w.amt[i] = 0;
    }
  }
  w.reveal(bx, by, 58);
  const res = (x: number, y: number, ww: number, hh: number, r: ResourceId, amt: number) => {
    for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + ww; xx++) {
      const i = w.idx(xx, yy);
      w.res[i] = RES_CODE[r];
      w.amt[i] = amt;
    }
  };
  // research up to the drone era
  const want = ['autonomous_drones', 'agent_architect', 'drones_worker', 'drones_logistic', 'drones_engineer', 'drones_combat', 'agent_optimizer', 'ci', 'fast_inserters', 'solar', 'accumulators', 'turrets', 'radar', 'mining_productivity', 'power_lines'];
  const done = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    for (const p of TECHS[id].prereq) visit(p);
    done.add(id);
    sim.research.done.push(id);
    sim.doneSet.add(id);
  };
  want.forEach(visit);
  sim.recomputeEffects();
  sim.research.current = 'datacenter';
  sim.research.progress.datacenter = 24;
  sim.events.muted = true;
  const P = (t: BuildingType, x: number, y: number, dir: Dir = 1, recipe?: string) => {
    const e = sim.place(t, x, y, dir, { force: true, instant: true, recipe });
    return e;
  };
  const fill = (e: ReturnType<typeof P>, items: Record<string, number>) => {
    if (!e?.store) return;
    for (const k in items) e.store[k] = (e.store[k] ?? 0) + items[k];
    e.storeTotal = Object.values(e.store).reduce((a, b) => a + b, 0);
  };
  // ---- ore → plate lines (west): iron top, copper bottom
  const oreLine = (ore: ResourceId, x0: number, y0: number) => {
    res(x0, y0, 2, 4, ore, 4000);
    P('drill', x0, y0, 1);
    P('drill', x0, y0 + 2, 1);
    P('belt', x0 + 2, y0 + 2, 0);
    P('belt', x0 + 2, y0 + 1, 0);
    for (let x = x0 + 2; x <= x0 + 8; x++) P('belt', x, y0, 1);
    for (const sx of [x0 + 4, x0 + 6]) {
      P('inserter', sx, y0 + 1, 2);
      P('smelter', sx, y0 + 2, 1);
      P('inserter', sx, y0 + 4, 2);
    }
    for (let x = x0 + 4; x <= x0 + 9; x++) P('belt', x, y0 + 5, 1);
    P('storage', x0 + 10, y0 + 5, 1);
    P('pole', x0 + 5, y0 + 1, 0);
    P('pole', x0 + 8, y0 + 3, 0);
    P('pole', x0 + 1, y0 + 5, 0);
  };
  oreLine('iron_ore', bx - 28, by - 12);
  oreLine('copper_ore', bx - 28, by + 2);
  // ---- microchip line (north-east) via the Architect planner
  const feeders = (x: number, y: number, items: string[]) => {
    items.forEach((it, k) => {
      const c = P('storage', x + k * 3, y - 3, 1);
      fill(c, { [it]: 900 });
      const ins = P('inserter', x + k * 3, y - 1, 2);
      if (ins) ins.filter = it;
    });
  };
  const chip = planLine(sim, 'microchip', 24)!;
  const cx = bx + 8;
  const cy = by - 18;
  for (const e of chip.entities) P(e.type, cx + e.dx, cy + e.dy, e.dir, e.recipe);
  feeders(cx, cy, ['silicon_wafer', 'copper_wire', 'plastic']);
  P('storage', cx + chip.w, cy + chip.h - 1, 1);
  for (let k = 0; k < 3; k++) P('pole', cx + k * 3 + 2, cy - 2, 0);
  // ---- battery line (south-east): chem plants on oil
  const bat = planLine(sim, 'battery', 20)!;
  const bxl = bx + 8;
  const byl = by + 10;
  for (const e of bat.entities) P(e.type, bxl + e.dx, byl + e.dy, e.dir, e.recipe);
  feeders(bxl, byl, ['iron_plate', 'copper_plate', 'electrolyte']);
  res(bxl + bat.w, byl + 4, 2, 2, 'oil', 200000);
  P('pumpjack', bxl + bat.w, byl + 4, 1);
  P('storage', bxl + bat.w, byl + bat.h - 1, 1);
  P('power_plant', bxl + bat.w + 2, byl + 3, 1);
  P('power_plant', bxl + bat.w + 2, byl + 6, 1);
  for (let k = 0; k < 3; k++) P('pole', bxl + k * 3 + 2, byl - 2, 0);
  P('pole', bxl + bat.w + 1, byl + 3, 0);
  P('pole', bxl + bat.w + 5, byl + 5, 0);
  // ---- AI district (north of HQ)
  const ai = P('aicore', bx - 3, by - 12, 1);
  if (ai) ai.modules = 6;
  const s1 = P('server', bx + 2, by - 12, 1);
  const s2 = P('server', bx + 2, by - 9, 1);
  if (s1) s1.modules = 2;
  if (s2) s2.modules = 1;
  P('inference', bx - 6, by - 12, 1);
  P('datacollector', bx - 6, by - 9, 1);
  P('ci', bx - 9, by - 12, 1);
  P('radar', bx - 9, by - 9, 1);
  P('droneport', bx + 5, by + 4, 1);
  P('accumulator', bx + 6, by - 3, 1);
  P('accumulator', bx + 8, by - 3, 1);
  P('solar', bx - 12, by + 12, 1);
  P('solar', bx - 8, by + 12, 1);
  const lab = P('lab', bx - 6, by + 5, 1);
  const sc = P('storage', bx - 9, by + 6, 1);
  fill(sc, { science_mech: 300, science_elec: 300, science_ai: 200 });
  P('inserter', bx - 7, by + 6, 1);
  void lab;
  P('turret', bx - 20, by + 18, 1);
  P('turret', bx + 30, by - 20, 1);
  // pole mesh connecting districts to the HQ
  for (const [x, y] of [[bx - 3, by - 5], [bx - 8, by - 5], [bx + 4, by - 5], [bx - 11, by - 8], [bx - 16, by - 9], [bx - 16, by + 2], [bx - 11, by + 5], [bx - 16, by + 8], [bx - 10, by + 10], [bx + 8, by - 8], [bx + 8, by - 12], [bx + 4, by + 8], [bx + 7, by + 8], [bx + 3, by + 2], [bx - 3, by + 5], [bx - 22, by - 3], [bx - 20, by + 14], [bx + 26, by - 16], [bx + 30, by - 17]] as [number, number][]) P('pole', x, y, 0);
  connectPower(sim);
  // a few ghosts so construction drones are busy right away
  for (const [t, x, y] of [['solar', bx - 4, by + 12], ['accumulator', bx + 10, by - 3], ['turret', bx + 20, by + 22], ['radar', bx - 14, by - 16]] as [BuildingType, number, number][]) sim.place(t, x, y, 1);
  // storage with building materials for the ghosts
  sim.addStock('steel', 400);
  sim.addStock('silicon_wafer', 120);
  sim.addStock('battery', 60);
  sim.addStock('microchip', 150);
  sim.addStock('copper_plate', 300);
  sim.addStock('iron_plate', 500);
  sim.addStock('gear', 200);
  sim.addStock('memory_module', 6);
  // ---- agents, drones, AI resources
  sim.ai.era = 3;
  sim.ai.eraTimes = [0, 900, 2100];
  sim.ai.weightsTotal = 12;
  sim.ai.weights = 3;
  sim.ai.compute = 3200;
  sim.ai.tokens = 2400;
  sim.ai.data = 420;
  sim.ai.techDebt = 17;
  const roles = ['coder', 'debugger', 'optimizer', 'architect'] as const;
  for (const r of roles) {
    sim.ai.agents.push({ id: sim.ai.nextAgentId++, role: r, name: { coder: 'Coder', debugger: 'Debugger', optimizer: 'Optimizer', architect: 'Architect' }[r], level: r === 'coder' ? 3 : 2, xp: 2, speed: r === 'coder' ? 1.5 : 1.1, status: 'idle', hiredAt: 1200, done: 9 });
  }
  const port = sim.list.find((e) => e.type === 'droneport')!;
  for (const k of ['construction', 'construction', 'worker', 'worker', 'logistic', 'logistic', 'engineer', 'combat'] as const) sim.addDrone(k, port.id);
  sim.flags.autoExplore = true;
  // ---- git history: base → AI → stock → catastrophe → rollback → fix → current
  const t0 = 1500;
  const g = sim.git;
  const c1 = commit(g, { message: 'Терминал: CopperRouter, EnergyManager', author: 'Терминал', time: t0, files: { 'automation.py': REFERENCE }, groups: {}, priorities: {}, tag: 'ai', prodBefore: 120 });
  const c2 = commit(g, { message: 'Coder: BatteryStock — запас аккумуляторов', author: 'Coder', time: t0 + 300, files: { ...c1.files, 'battery_stock.py': BATTERY }, groups: {}, priorities: {}, tag: 'ai', prodBefore: 150 });
  commit(g, { message: 'Coder: NightShift — ночной режим', author: 'Coder', time: t0 + 520, files: { ...c2.files, 'night_shift.py': NIGHT_BAD }, groups: {}, priorities: {}, tag: 'catastrophe', prodBefore: 180 });
  commit(g, { message: 'Откат к v1.2', author: 'Игрок', time: t0 + 610, files: { ...c2.files }, groups: {}, priorities: {}, tag: 'rollback', prodBefore: 40 });
  const c5 = commit(g, { message: 'Исправление: инвертированное условие в NightShift', author: 'Debugger', time: t0 + 700, files: { ...c2.files, 'night_shift.py': NIGHT_OK }, groups: {}, priorities: {}, tag: 'fix', prodBefore: 170, techDebtAdded: 0 });
  const c6 = commit(g, { message: 'Optimizer: ChipWatcher — мониторинг микросхем', author: 'Optimizer', time: t0 + 900, files: { ...c5.files, 'chip_watcher.py': CHIP_WATCH_BUG }, groups: {}, priorities: {}, tag: 'ai', prodBefore: 190, techDebtAdded: 4 });
  sim.flags.catastrophes = 1;
  sim.flags.bugsFixed = 1;
  sim.flags.sandboxRuns = 2;
  // hidden hallucination in ChipWatcher for the Debugger to find
  sim.flags.bugs = [{ id: 1, file: 'chip_watcher.py', commitId: c6.id, type: 'wrong_item', line: 4, desc: 'Неверное имя предмета — действие молча не выполняется', original: CHIP_WATCH_BUG.replace('micro_chip', 'microchip'), corrupted: '        if self.rate("micro_chip") < 10:', found: false, fixed: false }];
  sim.flags.nextBugId = 1;
  sim.scripts.loadFromGit(sim);
  // CI tests
  sim.ai.ciTests = [
    { id: 1, name: 'микросхемы ≥ 8/мин', kind: 'rate_ge', key: 'microchip', value: 8, pass: false },
    { id: 2, name: 'энергия никогда не ниже 70%', kind: 'power_ge', key: 'power', value: 0.7, pass: false },
    { id: 3, name: 'запас: аккумуляторы ≥ 30', kind: 'stock_ge', key: 'battery', value: 30, pass: false },
  ];
  sim.ai.nextTestId = 4;
  // chat history
  sim.ai.chat = [];
  const coder = sim.ai.agents.find((a) => a.role === 'coder')!;
  const opt = sim.ai.agents.find((a) => a.role === 'optimizer')!;
  pushChat(sim, { from: 'player', text: 'Сделай так, чтобы медная руда автоматически доставлялась на переработку, приоритет отдавался аккумуляторам, а если энергии не хватает — временно отключай производство микросхем.', agentId: 1, role: 'terminal' });
  pushChat(sim, { from: 'agent', agentId: 1, role: 'terminal', text: '> OK. Скрипт сгенерирован.', checklist: ['Написан код для агентов', 'Настроены приоритеты', 'Добавлены условия по энергии', 'Запущен мониторинг'] });
  pushChat(sim, { from: 'system', text: 'Принято: v1.1 — Терминал: CopperRouter, EnergyManager' });
  pushChat(sim, { from: 'player', text: 'Ночью отключай всё, кроме серверов.', agentId: coder.id, role: 'coder' });
  pushChat(sim, { from: 'system', text: '⚠ v1.3 помечен «Катастрофа»: производство −78% за минуту.' });
  pushChat(sim, { from: 'system', text: 'Откат: v1.3 → v1.2 (v1.4)' });
  pushChat(sim, { from: 'agent', agentId: sim.ai.agents.find((a) => a.role === 'debugger')!.id, role: 'debugger', text: 'Причина катастрофы: инвертированное условие в NightShift — фабрика отключалась днём. Исправил: ночью выключаются только лаборатории.' });
  pushChat(sim, { from: 'system', text: 'Принято: v1.5 — Исправление: инвертированное условие в NightShift' });
  pushChat(sim, { from: 'system', text: 'Принято: v1.6 — Optimizer: ChipWatcher (+4 техдолга)' });
  // a pending proposal to review right away
  const ir = analyze('Если железных пластин больше 1000 — останови плавильни железа.');
  const gen = generate(ir)!;
  const prop: Proposal = {
    id: sim.ai.nextProposalId++, agentId: opt.id, role: 'optimizer', request: 'Если железных пластин больше 1000 — останови плавильни железа.', kind: 'script', fileName: 'iron_limiter.py', code: gen.code, prevCode: '',
    tokens: 58, confidence: 0.94, checklist: gen.checklist, status: 'pending', bugs: [], message: 'Optimizer: IronLimiter', tag: 'ai', createdAt: 0,
  };
  sim.ai.proposals.push(prop);
  pushChat(sim, { from: 'player', text: prop.request, agentId: opt.id, role: 'optimizer' });
  pushChat(sim, { from: 'agent', agentId: opt.id, role: 'optimizer', text: 'Оптимизировал: логика минимальная, лишних операций нет. Прогоните в песочнице — CI проверит тесты.', checklist: gen.checklist, proposalId: prop.id });
  // clock: day 5, night falls in ~60 s
  sim.day = 5;
  sim.dayTime = 0.72 * DAY_LENGTH - 60 - 90;
  // pre-warm: belts fill, stats accumulate, drones take off
  sim.run(90);
  const poi = nearestPoi(sim, bx, by);
  const worker = sim.drones.find((d) => d.kind === 'worker' && d.state === 'idle');
  if (poi && worker) sendToPoi(sim, worker, poi.id);
  sim.ai.lastDebuggerScan = sim.time - 22;
  const doneQuests = new Set(sim.quests.done);
  for (const q of QUESTS) if (q.era === 1 || ['q_aicore', 'q_agent_script', 'q_memory', 'q_sandbox', 'q_debug'].includes(q.id)) doneQuests.add(q.id);
  sim.quests.done = [...doneQuests];
  sim.events.muted = false;
  return sim;
}
