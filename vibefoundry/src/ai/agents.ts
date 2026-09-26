import type { Sim } from '../sim/sim';
import type { Agent, AgentRole } from './state';
import { AGENT_SLOTS } from './eras';

export interface RoleDef {
  role: AgentRole;
  name: string;
  tag: string;
  color: string;
  desc: string;
  speed: number;
  halluc: number;
  unlock?: string;
  greet: string;
}

export const ROLES: Record<AgentRole, RoleDef> = {
  terminal: { role: 'terminal', name: 'Терминал', tag: 'Код', color: '#6fdc5a', desc: 'Примитивный ИИ в терминале: советы и простые скрипты.', speed: 0.8, halluc: 1.3, greet: '> ИИ-терминал онлайн. Опишите задачу — напишу скрипт.' },
  architect: { role: 'architect', name: 'Architect', tag: 'Планирование', color: '#4a8cff', desc: 'Проектирует производственные цепочки и ставит чертежи.', speed: 1, halluc: 1.1, unlock: 'agent_architect', greet: 'Architect на связи. Спроектирую линию под любую цель.' },
  coder: { role: 'coder', name: 'Coder', tag: 'Код', color: '#32c6f4', desc: 'Пишет и настраивает код автоматизации.', speed: 1.25, halluc: 1, unlock: 'agent_coder', greet: 'Coder готов. Опишите, что автоматизировать.' },
  debugger: { role: 'debugger', name: 'Debugger', tag: 'Диагностика', color: '#ed5347', desc: 'Находит и исправляет ошибки.', speed: 1, halluc: 0.6, unlock: 'agent_debugger', greet: 'Debugger подключён. Буду сканировать фабрику каждые 30 секунд.' },
  optimizer: { role: 'optimizer', name: 'Optimizer', tag: 'Оптимизация', color: '#33c0a7', desc: 'Ищет узкие места и способы повысить эффективность.', speed: 0.9, halluc: 0.9, unlock: 'agent_optimizer', greet: 'Optimizer здесь. Найду, где теряются проценты.' },
  orchestrator: { role: 'orchestrator', name: 'Orchestrator', tag: 'Управление', color: '#9096db', desc: 'Координирует работу других агентов, в эре колонии ставит цели сам.', speed: 1, halluc: 1.15, unlock: 'agent_orchestrator', greet: 'Orchestrator активен. Давайте большие цели — раздам подзадачи.' },
};

export const HIRABLE: AgentRole[] = ['coder', 'debugger', 'optimizer', 'architect', 'orchestrator'];

export function hiredCount(sim: Sim): number {
  return sim.ai.agents.filter((a) => a.role !== 'terminal').length;
}

export function hireCost(sim: Sim): { compute: number; tokens: number } {
  const n = hiredCount(sim);
  return { compute: 200 + n * 150, tokens: 150 + n * 80 };
}

export function canHire(sim: Sim, role: AgentRole): { ok: boolean; reason?: string } {
  const def = ROLES[role];
  if (sim.ai.era < 2) return { ok: false, reason: 'Нужен AI Core (эра 2)' };
  if (!sim.list.some((e) => e.type === 'aicore' && !e.ghost)) return { ok: false, reason: 'Постройте AI Core' };
  if (def.unlock && !sim.isUnlocked(def.unlock)) return { ok: false, reason: 'Нужно исследование «Агент ' + def.name + '»' };
  if (sim.ai.agents.some((a) => a.role === role)) return { ok: false, reason: 'Уже нанят' };
  if (hiredCount(sim) >= AGENT_SLOTS[sim.ai.era]) return { ok: false, reason: `Все слоты заняты (${AGENT_SLOTS[sim.ai.era]} в этой эре)` };
  const c = hireCost(sim);
  if (sim.ai.compute < c.compute || sim.ai.tokens < c.tokens) return { ok: false, reason: `Нужно ${c.compute} вычислений и ${c.tokens} токенов` };
  return { ok: true };
}

export function hire(sim: Sim, role: AgentRole): Agent | null {
  if (!canHire(sim, role).ok) return null;
  const c = hireCost(sim);
  sim.ai.compute -= c.compute;
  sim.ai.tokens -= c.tokens;
  sim.stats.consume('compute', c.compute);
  sim.stats.consume('tokens', c.tokens);
  const a: Agent = { id: sim.ai.nextAgentId++, role, name: ROLES[role].name, level: 1, xp: 0, speed: ROLES[role].speed, status: 'idle', hiredAt: sim.time, done: 0 };
  sim.ai.agents.push(a);
  sim.noteManual();
  return a;
}

export function gainXp(a: Agent, xp: number): boolean {
  a.xp += xp;
  a.done++;
  const need = a.level * 5;
  if (a.xp >= need) {
    a.xp -= need;
    a.level++;
    a.speed *= 1.1;
    return true;
  }
  return false;
}

/** Best agent for a kind of job, falling back to the terminal. */
export function pickAgent(sim: Sim, job: 'code' | 'blueprint' | 'scan' | 'refactor' | 'optimize' | 'plan', preferred?: number): Agent {
  const agents = sim.ai.agents;
  if (preferred !== undefined) {
    const p = agents.find((a) => a.id === preferred);
    if (p) return p;
  }
  const want: Record<string, AgentRole[]> = {
    code: ['coder', 'orchestrator', 'optimizer', 'terminal'],
    blueprint: ['architect', 'orchestrator', 'coder', 'terminal'],
    scan: ['debugger', 'coder', 'terminal'],
    refactor: ['optimizer', 'coder', 'terminal'],
    optimize: ['optimizer', 'orchestrator', 'coder', 'terminal'],
    plan: ['orchestrator', 'architect', 'coder', 'terminal'],
  };
  for (const r of want[job]) {
    const idle = agents.find((a) => a.role === r && a.status !== 'working');
    if (idle) return idle;
  }
  for (const r of want[job]) {
    const any = agents.find((a) => a.role === r);
    if (any) return any;
  }
  return agents[0];
}
