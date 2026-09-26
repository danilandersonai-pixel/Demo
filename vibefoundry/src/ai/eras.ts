import type { Sim } from '../sim/sim';
import { modelVersion } from './state';

export const ERA_NAMES = ['', 'ИИ в терминале', 'AI Core', 'Дроны', 'AI-колония'];
export const ERA_SUB = ['', 'ограниченный контекст', 'больше памяти', 'физическое тело', 'полная автономия'];

/** Max simultaneously active script files per era. */
export const SCRIPT_SLOTS = [0, 1, 6, 10, 16];
/** Agent hiring slots per era (not counting the terminal). */
export const AGENT_SLOTS = [0, 0, 2, 4, 6];

export interface EraReq {
  text: string;
  done: boolean;
}

export function nextEraRequirements(sim: Sim): EraReq[] {
  const era = sim.ai.era;
  const has = (t: string) => sim.list.some((e) => e.type === t && !e.ghost);
  const v = modelVersion(sim.ai);
  const hired = sim.ai.agents.filter((a) => a.role !== 'terminal').length;
  if (era === 1) return [
    { text: 'Исследование «Ядро ИИ»', done: sim.doneSet.has('ai_core') },
    { text: 'Построен AI Core', done: has('aicore') },
  ];
  if (era === 2) return [
    { text: 'Исследование «Автономные дроны»', done: sim.doneSet.has('autonomous_drones') },
    { text: 'Построен дрон-порт', done: has('droneport') },
    { text: `Модель ≥ v1.5 (сейчас v${v.toFixed(1)})`, done: v >= 1.5 },
  ];
  if (era === 3) return [
    { text: 'Исследование «Автономия»', done: sim.doneSet.has('autonomy') },
    { text: `Модель ≥ v2.5 (сейчас v${v.toFixed(1)})`, done: v >= 2.5 },
    { text: `Нанято агентов ≥ 4 (сейчас ${hired})`, done: hired >= 4 },
  ];
  return [];
}

/** Checked each second: advances the era when all requirements are met. */
export function checkEra(sim: Sim): void {
  if (sim.ai.era >= 4) return;
  const req = nextEraRequirements(sim);
  if (!req.length || !req.every((r) => r.done)) return;
  sim.ai.era++;
  sim.ai.eraTimes[sim.ai.era - 1] = sim.time;
  sim.events.emit('era', { era: sim.ai.era });
  sim.toast({ kind: 'info', title: `Новая эра: ${ERA_NAMES[sim.ai.era]}`, text: ERA_SUB[sim.ai.era], key: 'era-' + sim.ai.era });
}
