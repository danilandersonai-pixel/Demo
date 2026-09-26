import type { Sim } from '../sim/sim';
import type { Agent, AgentRole, ChatMsg, Proposal, CiTest } from '../ai/state';
import { modelVersionLabel } from '../ai/state';
import { analyze, INTENT_TEMPLATES, type IntentResult } from './intent';
import { generate } from './codegen';
import { parse } from '../script/parser';
import { groupKnown } from '../script/groups';
import { commit, headCommit, headFiles, TAG_LABELS, type Commit, type CommitTag } from './git';
import { ROLES, pickAgent, gainXp } from '../ai/agents';
import { hallucinate, hallucinationChance } from '../ai/hallucination';
import { contextCapacity, contextFit, contextNeeded } from '../ai/context';
import { planLine } from '../ai/architect';
import { mainPower, powerRatio } from '../sim/power';
import { calmRogues } from '../sim/enemies';
import { BUILDINGS, CONTROLLABLE } from '../data/buildings';
import { ITEMS, type ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import { STATUS_TEXT } from '../sim/types';
import { ERA_NAMES } from '../ai/eras';

export const MAX_CHAT = 200;

export interface VibePayload {
  text: string;
  ir: IntentResult;
  job: 'code' | 'blueprint' | 'scan' | 'refactor' | 'optimize' | 'status' | 'test' | 'clarify' | 'fix';
  llmCode?: string;
  llmNote?: string;
  steps?: { role: AgentRole; text: string; done: boolean }[];
  bugId?: number;
  autopilot?: boolean;
}

export interface BugEntry {
  id: number;
  file: string;
  commitId: number;
  type: string;
  line: number;
  desc: string;
  original: string;
  corrupted: string;
  found: boolean;
  fixed: boolean;
}

export function bugs(sim: Sim): BugEntry[] {
  return (sim.flags.bugs ??= []) as BugEntry[];
}

export function pushChat(sim: Sim, msg: Omit<ChatMsg, 'id' | 'time'>): ChatMsg {
  const m: ChatMsg = { ...msg, id: sim.ai.nextMsgId++, time: sim.time };
  sim.ai.chat.push(m);
  if (sim.ai.chat.length > MAX_CHAT) sim.ai.chat.splice(0, sim.ai.chat.length - MAX_CHAT);
  sim.events.emit('chat', m);
  return m;
}

/** Tokens a request costs: prompt length + the part of the factory the agent must read. */
export function requestCost(sim: Sim, text: string): number {
  const ctx = Math.min(contextNeeded(sim), contextCapacity(sim));
  return Math.ceil(12 + text.length / 4 + ctx * 6);
}

function jobFor(ir: IntentResult): VibePayload['job'] {
  const s = ir.special;
  if (!s) return ir.rules.length ? 'code' : 'clarify';
  switch (s.kind) {
    case 'blueprint':
      return 'blueprint';
    case 'scan':
      return 'scan';
    case 'refactor':
      return 'refactor';
    case 'optimize':
      return 'optimize';
    case 'status':
      return 'status';
    case 'test':
      return 'test';
  }
}

const DURATION: Record<VibePayload['job'], number> = { code: 4, blueprint: 6, scan: 5, refactor: 7, optimize: 6, status: 2, test: 2, clarify: 1.5, fix: 4 };

/** Player sends a natural-language request. Charges tokens and queues a task on the best agent. */
export function sendRequest(sim: Sim, text: string, targetAgentId?: number, extra: Partial<VibePayload> = {}): { ok: boolean; msg?: string } {
  const t = text.trim();
  if (!t) return { ok: false, msg: 'Пустой запрос' };
  const cost = requestCost(sim, t);
  if (sim.ai.tokens < cost) {
    pushChat(sim, { from: 'system', text: `Недостаточно токенов: нужно ${cost}, есть ${Math.floor(sim.ai.tokens)}. Постройте инференс-узел или подождите — терминал базы генерирует немного токенов.` });
    return { ok: false, msg: 'Недостаточно токенов' };
  }
  sim.ai.tokens -= cost;
  sim.stats.consume('tokens', cost);
  const ir = analyze(t, Object.keys(sim.groups));
  const job = extra.job ?? jobFor(ir);
  const jobKind = job === 'test' || job === 'status' || job === 'clarify' ? 'code' : job === 'fix' ? 'scan' : job;
  const agent = pickAgent(sim, jobKind as any, targetAgentId);
  pushChat(sim, { from: 'player', text: t, agentId: agent.id, role: agent.role });
  const payload: VibePayload = { text: t, ir, job, ...extra };
  // Orchestrator decomposes composite goals into subtasks for other agents.
  if (agent.role === 'orchestrator' && job === 'code' && ir.rules.length >= 2) {
    const helpers = sim.ai.agents.filter((a) => a.role !== 'orchestrator' && a.role !== 'terminal');
    payload.steps = ir.rules.map((r, i) => ({
      role: (helpers[i % Math.max(1, helpers.length)]?.role ?? 'coder') as AgentRole,
      text: describeRule(r),
      done: false,
    }));
    if (helpers.some((h) => h.role === 'debugger')) payload.steps.push({ role: 'debugger', text: 'проверка рисков', done: false });
  }
  assign(sim, agent, payload, cost);
  return { ok: true };
}

function describeRule(r: IntentResult['rules'][number]): string {
  const a = r.actions[0];
  const what =
    a.kind === 'route' ? `маршрут ${ITEMS[a.item].short}` :
    a.kind === 'priority' ? `приоритет ${a.target}` :
    a.kind === 'limit' ? `лимит ${ITEMS[a.item].short}` :
    a.kind === 'disable' ? `отключение ${a.target}` :
    a.kind === 'enable' ? `включение ${a.target}` :
    a.kind === 'notify' ? 'уведомления' :
    a.kind === 'recipe' ? `рецепт ${a.group}` :
    a.kind === 'dispatch' ? 'задание дронам' :
    a.kind === 'balance' ? `балансировка ${ITEMS[a.item].short}` : 'правило';
  return r.cond ? `${what} по условию` : what;
}

function assign(sim: Sim, agent: Agent, payload: VibePayload, cost = 0): void {
  if (agent.status === 'working' && agent.task) {
    (sim.ai as any).queue = [...((sim.ai as any).queue ?? []), { agentId: agent.id, payload }];
    return;
  }
  const speed = agent.speed;
  agent.status = 'working';
  agent.task = {
    kind: payload.job === 'blueprint' ? 'blueprint' : payload.job === 'scan' || payload.job === 'fix' ? 'scan' : payload.job === 'refactor' ? 'refactor' : payload.steps ? 'orchestrate' : payload.job === 'status' ? 'answer' : 'code',
    label: taskLabel(payload),
    progress: 0,
    duration: DURATION[payload.job] / speed,
    payload: { ...payload, cost },
  };
}

function taskLabel(p: VibePayload): string {
  switch (p.job) {
    case 'blueprint':
      return 'Планирование';
    case 'scan':
    case 'fix':
      return 'Диагностика';
    case 'refactor':
      return 'Рефакторинг';
    case 'optimize':
      return 'Оптимизация';
    case 'status':
      return 'Отчёт';
    default:
      return p.steps ? 'Координация' : 'Код';
  }
}

/** Advance agent tasks (called every tick). */
export function processAgents(sim: Sim, dt: number): void {
  if (sim.headless) return;
  for (const a of sim.ai.agents) {
    if (a.status !== 'working' || !a.task) continue;
    const burn = 1.5 * dt;
    const slow = sim.ai.compute < burn ? 0.25 : 1;
    if (slow === 1) {
      sim.ai.compute -= burn;
      sim.stats.consume('compute', burn);
    }
    a.task.progress += (dt * slow) / Math.max(0.3, a.task.duration);
    const p = a.task.payload as VibePayload;
    if (p.steps) {
      const k = Math.floor(a.task.progress * p.steps.length);
      p.steps.forEach((s, i) => (s.done = i < k));
    }
    if (a.task.progress >= 1) {
      const payload = a.task.payload as VibePayload;
      a.task = undefined;
      a.status = 'idle';
      completeTask(sim, a, payload);
      if (gainXp(a, 1)) sim.toast({ kind: 'success', title: `${a.name} повысил уровень`, text: `Уровень ${a.level}: быстрее и точнее`, key: 'lvl' + a.id + a.level });
      const q = ((sim.ai as any).queue ?? []) as { agentId: number; payload: VibePayload }[];
      const next = q.findIndex((x) => x.agentId === a.id);
      if (next >= 0) {
        const [item] = q.splice(next, 1);
        assign(sim, a, item.payload);
      }
    }
  }
}

function persona(role: AgentRole, kind: 'done' | 'clarify' | 'blueprint', extra = ''): string {
  if (role === 'terminal') {
    if (kind === 'clarify') return '> ЗАПРОС НЕ РАСПОЗНАН. Уточните цель:';
    return '> OK. Скрипт сгенерирован.' + (extra ? ' ' + extra : '');
  }
  const map: Record<AgentRole, string> = {
    terminal: '',
    coder: 'Готово! Создана система автоматизации.',
    architect: 'Спланировал производственную цепочку и логику управления.',
    debugger: 'Сделал, но проверил риски: при дефиците энергии правило сработает первым.',
    optimizer: 'Оптимизировал: логика минимальная, лишних операций нет.',
    orchestrator: 'Разложил цель на подзадачи и раздал агентам. Итог собран в один скрипт.',
  };
  if (kind === 'clarify') return role === 'debugger' ? 'Не хочу рисковать фабрикой вслепую. Уточните, что именно нужно:' : role === 'optimizer' ? 'Чтобы выжать проценты, мне нужна конкретная цель:' : 'Не до конца понял задачу. Что сделать?';
  return map[role] + (extra ? ' ' + extra : '');
}

function snake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function targetFile(sim: Sim, classes: string[]): string {
  if (sim.ai.era <= 1) return 'automation.py';
  const files = headFiles(sim.git);
  for (const [f, src] of Object.entries(files)) {
    if (classes.some((c) => new RegExp(`class ${c}\\b`).test(src))) return f;
  }
  return snake(classes[0]) + '.py';
}

function clarifyOptions(ir: IntentResult): { label: string; text: string }[] {
  const pick = ['disable_on_power_low', 'limit_stock', 'notify_rate_below', 'route_item', 'status_report'];
  return INTENT_TEMPLATES.filter((t) => pick.includes(t.id)).map((t) => ({ label: t.example, text: t.example }));
}

function staticWarnings(sim: Sim, code: string): string[] {
  const out: string[] = [];
  const rx = /self\.(disable|enable|shutdown|set_priority|set_recipe)\("([a-z_0-9]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(code))) if (!groupKnown(sim, m[2])) out.push(`Группа «${m[2]}» пока не существует — выделите здания рамкой и создайте её (кнопка «Группа»).`);
  return [...new Set(out)];
}

function completeTask(sim: Sim, agent: Agent, p: VibePayload): void {
  switch (p.job) {
    case 'code':
      return completeCode(sim, agent, p);
    case 'clarify':
      if (sim.settings.hallucinations && agent.role === 'terminal' && modelVersionLabel(sim.ai) === 'v1.0' && p.ir.unknown.length && sim.rng.chance(0.35)) {
        // weak model guesses instead of asking
        const guess = analyze('Если энергии не хватает — отключай сборочные цеха');
        return completeCode(sim, agent, { ...p, ir: guess, llmNote: 'Модель не уверена в запросе и сделала предположение.' }, 0.35);
      }
      pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: persona(agent.role, 'clarify'), options: clarifyOptions(p.ir) });
      return;
    case 'blueprint':
      return completeBlueprint(sim, agent, p);
    case 'scan':
      completeScan(sim, agent, true);
      return;
    case 'refactor':
      return completeRefactor(sim, agent);
    case 'optimize':
      return completeOptimize(sim, agent, p);
    case 'status':
      pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: statusReport(sim) });
      return;
    case 'test':
      return completeTest(sim, agent, p);
    case 'fix':
      return completeFix(sim, agent, p.bugId!);
  }
}

function completeCode(sim: Sim, agent: Agent, p: VibePayload, forcedConfidence?: number): void {
  let code: string;
  let checklist: string[];
  let classes: string[];
  if (p.llmCode) {
    code = p.llmCode;
    try {
      classes = parse(code).classes.map((c) => c.name);
    } catch {
      classes = ['Automation'];
    }
    checklist = ['Написан код для агентов', 'Код проверен парсером FactoryScript'];
  } else {
    const g = generate(p.ir);
    if (!g) {
      pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: persona(agent.role, 'clarify'), options: clarifyOptions(p.ir) });
      return;
    }
    code = g.code;
    checklist = g.checklist;
    classes = g.classes;
  }
  const warnings = staticWarnings(sim, code);
  const fileName = targetFile(sim, classes);
  const prevCode = headFiles(sim.git)[fileName] ?? '';
  const bugsList = [];
  const chance = sim.git.commits.filter((c) => c.tag !== 'base').length === 0 ? 0 : hallucinationChance(sim, agent);
  if (sim.rng.chance(chance)) {
    const h = hallucinate(code, sim.rng);
    if (h) {
      code = h.code;
      bugsList.push(h.bug);
    }
  }
  const fit = contextFit(sim);
  const conf = forcedConfidence ?? Math.max(0.3, Math.min(0.99, 0.97 - (1 - p.ir.understanding) * 0.3 - chance * 0.5 - (1 - fit) * 0.25 + (sim.rng.next() - 0.5) * 0.04));
  const extra: string[] = [];
  if (p.llmNote) extra.push(p.llmNote);
  if (fit < 1) extra.push(`Контекст переполнен: вижу ${Math.round(fit * 100)}% фабрики.`);
  const proposal: Proposal = {
    id: sim.ai.nextProposalId++, agentId: agent.id, role: agent.role, request: p.text, kind: 'script', fileName, code, prevCode,
    tokens: (p as any).cost ?? 0, confidence: conf, checklist, status: 'pending', bugs: bugsList, message: `${agent.name}: ${classes.join(', ')}`,
    tag: agent.role === 'optimizer' ? 'ai' : 'ai', createdAt: sim.time,
  };
  sim.ai.proposals.push(proposal);
  if (sim.ai.proposals.length > 40) sim.ai.proposals.splice(0, sim.ai.proposals.length - 40);
  const text = persona(agent.role, 'done', extra.join(' ')) + (warnings.length ? '\n⚠ ' + warnings.join('\n⚠ ') : '');
  pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text, checklist, proposalId: proposal.id, steps: p.steps?.map((s) => ({ ...s, done: true })) });
  if (p.autopilot) acceptProposal(sim, proposal.id, { auto: true });
}

function completeBlueprint(sim: Sim, agent: Agent, p: VibePayload): void {
  const s = p.ir.special;
  if (!s || s.kind !== 'blueprint') return;
  const plan = planLine(sim, s.item, s.rate);
  if (!plan) {
    pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: `Для «${ITEMS[s.item].name}» нет рецепта сборки — это сырьё, его добывают бурами на месторождении.` });
    return;
  }
  const machineName = BUILDINGS[plan.machine].name;
  const proposal: Proposal = {
    id: sim.ai.nextProposalId++, agentId: agent.id, role: agent.role, request: p.text, kind: 'blueprint', fileName: '', code: '', prevCode: '',
    tokens: 0, confidence: 0.92, checklist: [`${plan.machines} × ${machineName}`, `≈ ${Math.round(plan.machines * plan.perMachine)} ${ITEMS[s.item].short}/мин`, 'Входная и выходная ленты, манипуляторы, ЛЭП'],
    status: 'pending', bugs: [], message: `Architect: линия ${ITEMS[s.item].short}`,
    blueprint: { item: s.item, rate: s.rate, machines: plan.machines, entities: plan.entities.map((e) => ({ ...e })) }, createdAt: sim.time,
  };
  sim.ai.proposals.push(proposal);
  const note = plan.fluid ? ' Под цехами — трубы: подключите к ним нефть.' : '';
  pushChat(sim, {
    from: 'agent', agentId: agent.id, role: agent.role,
    text: `Спроектировал линию «${ITEMS[s.item].name}»: ${plan.machines} × ${machineName} по ${plan.perMachine.toFixed(1)}/мин = ${Math.round(plan.machines * plan.perMachine)}/мин. Подайте на верхнюю ленту: ${plan.inputs.join(', ') || 'нефть'}.${note} Нажмите «Принять» и укажите место — дроны построят чертёж.`,
    checklist: proposal.checklist, proposalId: proposal.id,
  });
}

function completeTest(sim: Sim, agent: Agent, p: VibePayload): void {
  const s = p.ir.special;
  if (!s || s.kind !== 'test') return;
  if (!sim.list.some((e) => e.type === 'ci' && !e.ghost)) {
    pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: 'Тесты производства проверяет CI-станция. Постройте её (исследование «CI-станция»), и я добавлю тест.' });
    return;
  }
  const t = s.test;
  const name = t.name || `${ITEMS[t.key as ItemId]?.short ?? t.key} ${t.kind === 'rate_ge' ? '≥' : '≥'} ${t.value}${t.kind === 'rate_ge' ? '/мин' : ''}`;
  const test: CiTest = { id: sim.ai.nextTestId++, name, kind: t.kind, key: t.key, value: t.value, pass: false };
  sim.ai.ciTests.push(test);
  pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: `Добавил тест в CI: «${name}». CI-станция проверяет его постоянно и в песочнице.` });
}

// ------------------------------------------------------------------ accept / reject / edit
export function acceptProposal(sim: Sim, pid: number, opts: { auto?: boolean; snapshot?: boolean } = {}): Commit | null {
  const p = sim.ai.proposals.find((x) => x.id === pid);
  if (!p || p.status === 'accepted' || p.status === 'rejected') return null;
  if (p.kind === 'blueprint') {
    p.status = 'accepted';
    return null;
  }
  try {
    parse(p.code);
  } catch (e) {
    pushChat(sim, { from: 'system', text: `Код не проходит парсер: ${(e as Error).message}. Исправьте в редакторе.` });
    return null;
  }
  const files = { ...headFiles(sim.git) };
  if (p.kind === 'refactor') {
    for (const k of Object.keys(files)) files[k] = normalizeCode(files[k]);
  } else if (sim.ai.era <= 1) {
    for (const k of Object.keys(files)) delete files[k];
    files['automation.py'] = p.code;
  } else files[p.fileName] = p.code;
  // tech debt
  let debt = 0;
  const lines = p.code.split('\n').length;
  if (p.kind === 'refactor') debt = -15;
  else if (p.sandboxed && p.forecast?.tests?.length && p.forecast.tests.every((t) => t.pass)) debt = 0;
  else if (p.sandboxed) debt = 1;
  else debt = 4 + (lines > 12 ? 2 : 0);
  if (p.edited) debt += 1;
  sim.ai.techDebt = Math.max(0, Math.min(100, sim.ai.techDebt + debt));
  const tag: CommitTag = p.kind === 'fix' ? 'fix' : p.kind === 'refactor' ? 'refactor' : 'ai';
  const agent = sim.ai.agents.find((a) => a.id === p.agentId);
  const c = commit(sim.git, {
    message: p.kind === 'refactor' ? 'Рефакторинг скриптов, снижение техдолга' : p.kind === 'fix' ? `Исправление: ${p.message}` : p.message,
    author: agent?.name ?? 'Агент',
    time: sim.time,
    files,
    groups: structuredClone(sim.groups),
    priorities: manualPriorities(sim),
    tag,
    prodBefore: sim.productionScore(),
    checkAt: sim.time + 60,
    techDebtAdded: debt,
    snapshot: opts.snapshot ? takeSnapshot(sim) : undefined,
  });
  p.status = 'accepted';
  // record hidden bugs that survived editing
  for (const b of p.bugs) {
    const corrupted = p.code.split('\n')[b.line - 1] ?? '';
    const origLine = b.original.split('\n')[b.line - 1] ?? '';
    if (b.type !== 'missing_else' && corrupted === origLine) continue;
    if (b.type === 'missing_else' && p.code === b.original) continue;
    bugs(sim).push({ id: (sim.flags.nextBugId = (sim.flags.nextBugId ?? 0) + 1), file: p.kind === 'script' ? (sim.ai.era <= 1 ? 'automation.py' : p.fileName) : p.fileName, commitId: c.id, type: b.type, line: b.line, desc: b.desc, original: b.original, corrupted, found: false, fixed: false });
  }
  // bugs in overwritten files are gone
  for (const b of bugs(sim)) if (!b.fixed && b.commitId !== c.id && files[b.file] !== undefined && !files[b.file].includes(b.corrupted)) b.fixed = true;
  if (p.kind === 'fix') {
    sim.flags.bugsFixed = (sim.flags.bugsFixed ?? 0) + 1;
    calmRogues(sim);
  }
  if (p.role === 'optimizer' && p.kind === 'script') sim.flags.optimizeCheck = { at: sim.time + 60, before: sim.productionScore() };
  sim.scripts.loadFromGit(sim);
  pushChat(sim, { from: 'system', text: `${opts.auto ? 'Автопилот принял' : 'Принято'}: ${c.version} — ${c.message}${debt > 0 ? ` (+${debt} техдолга)` : debt < 0 ? ` (${debt} техдолга)` : ''}` });
  sim.events.emit('sound', { name: 'commit' });
  if (!opts.auto) sim.noteManual();
  return c;
}

export function rejectProposal(sim: Sim, pid: number): void {
  const p = sim.ai.proposals.find((x) => x.id === pid);
  if (!p || p.status === 'accepted') return;
  p.status = 'rejected';
  pushChat(sim, { from: 'system', text: 'Предложение отклонено.' });
}

export function editProposal(sim: Sim, pid: number, code: string): { ok: boolean; error?: string } {
  const p = sim.ai.proposals.find((x) => x.id === pid);
  if (!p) return { ok: false, error: 'Нет предложения' };
  try {
    parse(code);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  p.code = code;
  p.edited = true;
  p.forecast = undefined;
  p.sandboxed = false;
  return { ok: true };
}

/** Player commits code they wrote by hand (no agent involved). */
export function manualCommit(sim: Sim, fileName: string, code: string): Commit | null {
  try {
    parse(code);
  } catch (e) {
    pushChat(sim, { from: 'system', text: `Код не проходит парсер: ${(e as Error).message}` });
    return null;
  }
  const files = { ...headFiles(sim.git), [fileName]: code };
  sim.ai.techDebt = Math.min(100, sim.ai.techDebt + 1);
  const c = commit(sim.git, { message: `Ручная правка ${fileName}`, author: 'Игрок', time: sim.time, files, groups: structuredClone(sim.groups), priorities: manualPriorities(sim), tag: 'manual', prodBefore: sim.productionScore(), checkAt: sim.time + 60 });
  sim.scripts.loadFromGit(sim);
  sim.noteManual();
  return c;
}

function manualPriorities(sim: Sim): Record<number, number> {
  const out: Record<number, number> = {};
  for (const e of sim.list) if (e.prio !== undefined) out[e.id] = e.prio;
  return out;
}

function takeSnapshot(sim: Sim): any {
  const snaps = sim.git.commits.filter((c) => c.snapshot);
  if (snaps.length >= 3) delete snaps[0].snapshot;
  return sim.serialize();
}

export function snapshotAffordable(sim: Sim): boolean {
  return contextCapacity(sim) - contextNeeded(sim) >= 4;
}

/** Roll back scripts, groups and manual priorities to a commit (as a new "rollback" commit). */
export function rollbackTo(sim: Sim, commitId: number): Commit | null {
  const target = sim.git.commits.find((c) => c.id === commitId);
  if (!target) return null;
  const cur = headCommit(sim.git);
  sim.groups = structuredClone(target.groups);
  for (const e of sim.list) {
    const p = target.priorities[e.id];
    if (p !== undefined) e.prio = p;
    else delete e.prio;
  }
  const c = commit(sim.git, { message: `Откат к ${target.version}`, author: 'Игрок', time: sim.time, files: { ...target.files }, groups: structuredClone(target.groups), priorities: { ...target.priorities }, tag: 'rollback', prodBefore: sim.productionScore() });
  for (const b of bugs(sim)) if (!b.fixed && target.files[b.file]?.includes(b.corrupted) !== true) b.fixed = true;
  calmRogues(sim);
  sim.scripts.loadFromGit(sim);
  pushChat(sim, { from: 'system', text: `Откат: ${cur?.version ?? '—'} → ${target.version} (${c.version})` });
  sim.events.emit('sound', { name: 'commit' });
  return c;
}

export function tagLabel(tag: CommitTag): string {
  return tag ? TAG_LABELS[tag] : '';
}

// ------------------------------------------------------------------ Debugger
export function completeScan(sim: Sim, agent: Agent | null, manual: boolean): number {
  const found: BugEntry[] = [];
  const role = agent?.role ?? 'debugger';
  const skill = role === 'debugger' ? 0.65 + (agent?.level ?? 1) * 0.05 : 0.35;
  for (const b of bugs(sim)) {
    if (b.fixed || b.found) continue;
    let p = skill;
    const inst = sim.scripts.instances.find((i) => i.file === b.file);
    if ((b.type === 'wrong_item' || b.type === 'bad_group') && inst?.warnings.length) p = 0.95;
    if (b.type === 'flapping' && sim.list.some((e) => (e.toggles ?? 0) > 6)) p = 0.95;
    if (sim.rng.chance(p)) {
      b.found = true;
      found.push(b);
    }
  }
  // runtime errors are always found
  const errs = sim.scripts.instances.filter((i) => i.status === 'error');
  const name = agent?.name ?? 'Debugger';
  if (found.length) {
    for (const b of found) {
      const focus = focusFor(sim, b.file);
      sim.toast({ kind: 'warning', title: 'Агент обнаружил ошибку в производственной цепочке', text: `${b.file}, строка ${b.line}: ${b.desc}`, focus, action: { label: 'Предложить фикс', cmd: 'debugFix', arg: b.id }, key: 'bug' + b.id });
    }
    pushChat(sim, { from: 'agent', agentId: agent?.id, role, text: `Нашёл ${found.length} ${found.length === 1 ? 'ошибку' : 'ошибки'}:\n` + found.map((b) => `• ${b.file}:${b.line} — ${b.desc}`).join('\n') + '\nНажмите «Предложить фикс» в уведомлении или попросите «исправь баг».' });
  } else if (manual) {
    const flappy = sim.list.filter((e) => (e.toggles ?? 0) > 6).length;
    const extra = errs.length ? ` Но ${errs.length} скрипт(а) в статусе «Ошибка»: ${errs.map((e) => e.cls.name + ':' + e.error?.line).join(', ')}.` : '';
    pushChat(sim, { from: 'agent', agentId: agent?.id, role, text: `Проверил ${sim.scripts.instances.length} агентов и ${sim.list.length} построек.${flappy ? ` ${flappy} зданий часто переключаются — возможен дребезг.` : ' Явных багов не нашёл.'}${extra}` });
  }
  sim.ai.lastDebuggerScan = sim.time;
  void name;
  return found.length;
}

function focusFor(sim: Sim, file: string): { x: number; y: number } | undefined {
  const inst = sim.scripts.instances.find((i) => i.file === file);
  const ids = inst ? [...inst.claims.off, ...inst.claims.prio.keys()] : [];
  const e = ids.length ? sim.ents.get(ids[0]) : sim.list.find((x) => CONTROLLABLE.has(x.type));
  return e ? { x: e.x, y: e.y } : undefined;
}

/** Debugger proposes the fix for a found bug. */
export function requestFix(sim: Sim, bugId: number): void {
  const agent = pickAgent(sim, 'scan');
  assign(sim, agent, { text: 'Исправь баг', ir: analyze(''), job: 'fix', bugId }, 0);
}

function completeFix(sim: Sim, agent: Agent, bugId: number): void {
  const b = bugs(sim).find((x) => x.id === bugId);
  if (!b || b.fixed) {
    pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: 'Этот баг уже исправлен.' });
    return;
  }
  const cur = headFiles(sim.git)[b.file] ?? '';
  const fixed = cur.includes(b.corrupted) && b.type !== 'missing_else' ? cur.replace(b.corrupted, b.original.split('\n')[b.line - 1]) : b.original;
  const proposal: Proposal = {
    id: sim.ai.nextProposalId++, agentId: agent.id, role: agent.role, request: 'Исправь баг', kind: 'fix', fileName: b.file, code: fixed, prevCode: cur,
    tokens: 0, confidence: 0.96, checklist: ['Найдена причина', 'Исправлена строка ' + b.line, 'Поведение фабрики восстановится после принятия'], status: 'pending', bugs: [], message: `${b.file}:${b.line} — ${b.desc}`, tag: 'fix', createdAt: sim.time,
  };
  sim.ai.proposals.push(proposal);
  (proposal as any).bugId = b.id;
  pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: `Причина: ${b.desc.toLowerCase()} (строка ${b.line}). Подготовил исправление — посмотрите дифф.`, proposalId: proposal.id, checklist: proposal.checklist });
}

// ------------------------------------------------------------------ Optimizer
function completeRefactor(sim: Sim, agent: Agent): void {
  const files = headFiles(sim.git);
  const names = Object.keys(files);
  if (!names.length) {
    pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: 'Рефакторить пока нечего — скриптов нет.' });
    return;
  }
  const code = names.map((n) => `# ${n}\n` + normalizeCode(files[n])).join('\n');
  const proposal: Proposal = {
    id: sim.ai.nextProposalId++, agentId: agent.id, role: agent.role, request: 'Рефакторинг', kind: 'refactor', fileName: names[0], code: normalizeCode(files[names[0]]), prevCode: files[names[0]],
    tokens: 0, confidence: 0.95, checklist: ['Выровнены отступы и пустые строки', 'Удалены лишние комментарии', `Техдолг −15 (сейчас ${Math.round(sim.ai.techDebt)})`], status: 'pending', bugs: [], message: 'Рефакторинг', tag: 'refactor', createdAt: sim.time,
  };
  void code;
  sim.ai.proposals.push(proposal);
  pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: `Прошёлся по ${names.length} файлам. Рефакторинг снизит техдолг на 15 пунктов → меньше галлюцинаций и дешевле операции.`, proposalId: proposal.id, checklist: proposal.checklist });
}

export function normalizeCode(src: string): string {
  return src
    .split('\n')
    .map((l) => l.replace(/\s+$/, '').replace(/\s{2,}#.*$/, ''))
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n')
    .replace(/\n+$/, '\n');
}

function completeOptimize(sim: Sim, agent: Agent, p: VibePayload): void {
  const machines = sim.list.filter((e) => !e.ghost && CONTROLLABLE.has(e.type) && e.type !== 'hq');
  if (!machines.length) {
    pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: 'Оптимизировать пока нечего — постройте производство.' });
    return;
  }
  const counts: Record<string, number> = {};
  for (const m of machines) counts[m.status ?? 'idle'] = (counts[m.status ?? 'idle'] ?? 0) + 1;
  const working = counts.working ?? 0;
  const eff = working / machines.length;
  const lines = [`Эффективность цехов: ${Math.round(eff * 100)}% (${working}/${machines.length} работают).`];
  const top = Object.entries(counts).filter(([k]) => k !== 'working').sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [k, n] of top) lines.push(`• ${STATUS_TEXT[k as keyof typeof STATUS_TEXT] ?? k}: ${n}`);
  // missing inputs
  const starving: Record<string, number> = {};
  for (const m of machines) {
    if (m.status !== 'no_input' || !m.recipe || !RECIPES[m.recipe]) continue;
    for (const s of RECIPES[m.recipe].inputs) if ((m.inv?.[s.item] ?? 0) < s.n) starving[s.item] = (starving[s.item] ?? 0) + 1;
  }
  const starv = Object.entries(starving).sort((a, b) => b[1] - a[1]);
  if (starv.length) lines.push(`Узкое место: не хватает «${ITEMS[starv[0][0] as ItemId].name}» (${starv[0][1]} цехов ждут).`);
  const net = mainPower(sim);
  let ir: IntentResult | null = null;
  if (net.sat < 0.95 || powerRatio(sim) < 0.95) {
    lines.push(`Энергия: дефицит ${Math.round((1 - net.sat) * 100)}%. Предлагаю приоритеты по энергии.`);
    const prodItem = (p.ir.special?.kind === 'optimize' && p.ir.special.item) || 'microchip';
    ir = analyze(`Приоритет — аккумуляторам, а если энергии не хватает — отключай производство ${ITEMS[prodItem as ItemId]?.short ?? 'микросхем'}`);
  } else if (starv.length) {
    const it = starv[0][0] as ItemId;
    ir = analyze(`Дай приоритет производству: ${ITEMS[it].short}`);
    if (!ir.rules.length) ir = null;
  }
  const gain = Math.max(3, Math.round((1 - eff) * 60));
  lines.push(`Ожидаемый прирост: +${gain}% к эффективности.`);
  if (ir && generate(ir)) {
    pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: lines.join('\n') });
    completeCode(sim, agent, { ...p, ir, job: 'code' });
  } else {
    lines.push(starv.length ? 'Скриптом тут не помочь — нужно больше сырья: попросите Architect спроектировать линию.' : 'Скриптовых улучшений не нашёл.');
    pushChat(sim, { from: 'agent', agentId: agent.id, role: agent.role, text: lines.join('\n') });
  }
}

export function statusReport(sim: Sim): string {
  const net = mainPower(sim);
  const top = sim.stats.keys
    .filter((k) => k in ITEMS)
    .map((k) => [k, sim.stats.rate(k)] as [string, number])
    .filter(([, r]) => r > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, r]) => `${ITEMS[k as ItemId].short} ${Math.round(r)}/мин`);
  const errs = sim.scripts.instances.filter((i) => i.status === 'error').length;
  return [
    `Эра: ${ERA_NAMES[sim.ai.era]}. Модель ${modelVersionLabel(sim.ai)}, техдолг ${Math.round(sim.ai.techDebt)}.`,
    `Энергия: ${Math.round(net.used / 100) / 10} / ${Math.round(net.capacity / 100) / 10} MW (${Math.round(net.sat * 100)}%).`,
    top.length ? `Производство: ${top.join(', ')}.` : 'Производства пока нет.',
    `Агентов-скриптов: ${sim.scripts.instances.length}${errs ? `, с ошибками: ${errs}` : ''}. Коммитов: ${sim.git.commits.length}.`,
  ].join('\n');
}

/** Initial "v1.0 Базовая версия" commit for a new game. */
export function initGit(sim: Sim): void {
  if (sim.git.commits.length) return;
  commit(sim.git, { message: 'Базовая фабрика', author: 'Игрок', time: 0, files: {}, groups: {}, priorities: {}, tag: 'base', prodBefore: 0 });
  pushChat(sim, { from: 'agent', agentId: 1, role: 'terminal', text: ROLES.terminal.greet });
}
