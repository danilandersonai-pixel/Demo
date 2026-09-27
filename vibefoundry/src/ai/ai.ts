import type { Sim } from '../sim/sim';
import { checkEra } from './eras';
import { processAgents, completeScan, rollbackTo, bugs, sendRequest, pushChat, acceptProposal } from '../vibe/vibe';
import { headCommit } from '../vibe/git';
import { goRogue } from '../sim/enemies';
import { powerRatio, mainPower } from '../sim/power';
import { CONTROLLABLE } from '../data/buildings';
import { modelVersion } from './state';
import { ERA_NAMES } from './eras';

const HQ_COMPUTE = 2;
const HQ_TOKENS = 0.6;

/** Per-tick AI layer: terminal trickle and agent task progress. */
export function updateAI(sim: Sim, dt: number): void {
  if (sim.hq) {
    sim.ai.compute += HQ_COMPUTE * dt;
    sim.stats.produce('compute', HQ_COMPUTE * dt);
    sim.ai.tokens += HQ_TOKENS * dt;
    sim.stats.produce('tokens', HQ_TOKENS * dt);
  }
  processAgents(sim, dt);
}

/** Once per simulated second: eras, catastrophes, CI, Debugger, autonomy, victory. */
export function aiEverySecond(sim: Sim): void {
  const prevEra = sim.ai.era;
  checkEra(sim);
  if (sim.ai.era !== prevEra) {
    sim.scripts.refreshSlots();
    const v = modelVersion(sim.ai);
    pushChat(sim, { from: 'system', text: `Новая эра: ${ERA_NAMES[sim.ai.era]}. Модель v${v.toFixed(1)}.` });
  }
  if (sim.headless) return;
  // data collectors: bonus for crafts nearby
  const collectors = sim.list.filter((e) => e.type === 'datacollector' && !e.ghost && e.status === 'working');
  if (collectors.length && sim.craftEvents.length) {
    let bonus = 0;
    for (const c of collectors) for (const ev of sim.craftEvents) if (Math.abs(ev.x - c.x) <= 12 && Math.abs(ev.y - c.y) <= 12) bonus += 0.04;
    sim.ai.data += bonus;
    sim.stats.produce('data', bonus);
  }
  catastropheCheck(sim);
  optimizeCheck(sim);
  ciCheck(sim);
  // Debugger scans every 30 s
  const dbg = sim.ai.agents.find((a) => a.role === 'debugger');
  if (dbg && sim.time - sim.ai.lastDebuggerScan >= 30 && dbg.status !== 'working') completeScan(sim, dbg, false);
  // flapping counters decay every minute
  if (Math.floor(sim.time) % 60 === 0) for (const e of sim.list) if (e.toggles) e.toggles = Math.floor(e.toggles / 2);
  // edge-triggered low-energy event for on_event handlers
  const low = powerRatio(sim) < 0.7;
  if (low && !sim.flags.lowEnergy) sim.scripts.fireEvent(sim, 'low_energy');
  sim.flags.lowEnergy = low;
  autonomy(sim);
  orchestratorGoals(sim);
}

function catastropheCheck(sim: Sim): void {
  const c = headCommit(sim.git);
  if (!c || !c.checkAt || sim.time < c.checkAt) return;
  const before = c.prodBefore;
  c.checkAt = undefined;
  if (c.tag === 'rollback' || before < 20) return;
  const now = sim.productionScore();
  if (now < before * 0.6) {
    c.tag = 'catastrophe';
    sim.flags.catastrophes = (sim.flags.catastrophes ?? 0) + 1;
    const parent = sim.git.commits.find((x) => x.id === c.parent);
    const drop = Math.round((1 - now / before) * 100);
    sim.toast({
      kind: 'danger', title: `Катастрофа после ${c.version}`, text: `Общее производство упало на ${drop}%. Откатиться?`,
      action: parent ? { label: `Rollback to ${parent.version}`, cmd: 'rollback', arg: parent.id } : undefined, key: 'cat' + c.id,
    });
    pushChat(sim, { from: 'system', text: `⚠ ${c.version} помечен «Катастрофа»: производство −${drop}% за минуту.` });
    if (sim.ai.era >= 2 && !sim.settings.peaceful && sim.rng.chance(0.35)) {
      const n = goRogue(sim, 2);
      if (n) sim.toast({ kind: 'danger', title: 'Сбой! Дроны вышли из-под контроля', text: `${n} дрона атакуют фабрику, пока версия не откачена`, key: 'rogue' });
    }
  }
}

function optimizeCheck(sim: Sim): void {
  const o = sim.flags.optimizeCheck as { at: number; before: number } | undefined;
  if (!o || sim.time < o.at) return;
  delete sim.flags.optimizeCheck;
  const now = sim.productionScore();
  if (o.before > 1 && now > o.before) {
    const pct = Math.round(((now - o.before) / o.before) * 100);
    if (pct >= 2) sim.toast({ kind: 'success', title: 'Производство оптимизировано', text: `+${pct}% к эффективности`, key: 'opt' + Math.floor(sim.time) });
  }
}

function ciCheck(sim: Sim): void {
  const ci = sim.list.some((e) => e.type === 'ci' && !e.ghost && (e.sat ?? 0) > 0.3);
  if (!ci) return;
  const pr = powerRatio(sim);
  for (const t of sim.ai.ciTests) {
    const was = t.pass;
    if (t.kind === 'rate_ge') t.pass = sim.stats.rate(t.key) >= t.value;
    else if (t.kind === 'stock_ge') t.pass = sim.stock(t.key) >= t.value;
    else {
      if (pr < t.value) t.everFailed = true;
      t.pass = pr >= t.value;
    }
    if (was && !t.pass) sim.toast({ kind: 'warning', title: 'CI: тест упал', text: t.name, key: 'ci' + t.id });
  }
}

function autonomy(sim: Sim): void {
  const prod = sim.list.filter((e) => !e.ghost && CONTROLLABLE.has(e.type));
  const managed = sim.scripts.managedIds();
  const frac = prod.length ? prod.filter((e) => managed.has(e.id)).length / prod.length : 0;
  const recent = sim.ai.manualActions.filter((t) => sim.time - t < 300).length;
  const a = frac * Math.max(0, 1 - recent * 0.02);
  sim.ai.autonomy = sim.ai.autonomy * 0.9 + a * 0.1;
  const spire = sim.list.find((e) => e.type === 'spire' && !e.ghost);
  if (sim.ai.era >= 4 && spire && (spire.sat ?? 0) > 0.9 && sim.ai.autonomy >= 0.9) {
    sim.ai.autonomyHeld += 1;
    if (sim.ai.autonomyHeld >= 600 && !sim.ai.victory) {
      sim.ai.victory = true;
      sim.events.emit('victory', {});
    }
  } else if (sim.ai.autonomyHeld > 0 && !sim.ai.victory) sim.ai.autonomyHeld = Math.max(0, sim.ai.autonomyHeld - 2);
}

const GOALS = [
  'Если энергии не хватает — отключай производство микросхем, а приоритет отдавай аккумуляторам',
  'Ночью отключай всё, кроме серверов',
  'Держи запас аккумуляторов на уровне 500',
  'Если врагов много — отправь боевых дронов',
  'Отправь дрона исследовать ближайшую неизвестную область',
];

/** Era 4: the Orchestrator sets its own goals and ships them (autopilot). */
function orchestratorGoals(sim: Sim): void {
  if (sim.ai.era < 4 || !sim.flags.autopilot) return;
  const orch = sim.ai.agents.find((a) => a.role === 'orchestrator');
  if (!orch || orch.status === 'working') return;
  if (sim.time - sim.ai.orchestratorGoalAt < 60) return;
  sim.ai.orchestratorGoalAt = sim.time;
  // colony autopilot script manages every production group
  const hasAutopilot = Object.keys(sim.git.commits.at(-1)?.files ?? {}).includes('colony_autopilot.py');
  const text = hasAutopilot ? GOALS[Math.floor(sim.time / 60) % GOALS.length] : 'COLONY_AUTOPILOT';
  if (text === 'COLONY_AUTOPILOT') {
    installAutopilot(sim, orch.id);
    return;
  }
  pushChat(sim, { from: 'agent', agentId: orch.id, role: 'orchestrator', text: `Новая цель колонии: «${text}». Выполняю без участия игрока.` });
  sendRequest(sim, text, orch.id, { autopilot: true });
  void mainPower;
  void bugs;
  void rollbackTo;
}

/** A script that puts every production building under agent control (the autonomy index). */
export function installAutopilot(sim: Sim, agentId: number): void {
  const code = `class ColonyAutopilot(Agent):
    every = 3
    def run(self):
        for b in self.buildings("all"):
            if b.type == "server" or b.type == "datacenter" or b.type == "spire":
                self.set_priority(b, 1)
            elif b.type == "turret":
                self.set_priority(b, 2)
            else:
                self.set_priority(b, 3)
        if self.power < 0.7:
            self.disable("labs")
`;
  const orch = sim.ai.agents.find((a) => a.id === agentId)!;
  sim.ai.proposals.push({
    id: sim.ai.nextProposalId++, agentId, role: 'orchestrator', request: 'Автопилот колонии', kind: 'script', fileName: 'colony_autopilot.py', code, prevCode: '',
    tokens: 0, confidence: 0.97, checklist: ['Все цеха под управлением агентов', 'Приоритеты: серверы → оборона → производство', 'Разгрузка при дефиците энергии'], status: 'pending', bugs: [], message: 'Orchestrator: автопилот колонии', tag: 'ai', createdAt: sim.time,
  });
  const p = sim.ai.proposals[sim.ai.proposals.length - 1];
  pushChat(sim, { from: 'agent', agentId, role: 'orchestrator', text: 'Беру колонию под управление: пишу автопилот для всех цехов.', proposalId: p.id, checklist: p.checklist });
  acceptProposal(sim, p.id, { auto: true });
  void orch;
}
