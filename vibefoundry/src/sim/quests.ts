import { QUESTS } from '../data/quests';
import { ITEMS, type ItemId } from '../data/items';
import type { Sim } from './sim';

export interface QuestState {
  done: string[];
  active: string[];
  claimed: Record<string, number>;
}

export function newQuestState(): QuestState {
  return { done: [], active: [], claimed: {} };
}

/** Checked once per simulated second; completes quests in any order, shows the first 3 open ones. */
export function updateQuests(sim: Sim): void {
  if (sim.headless) return;
  const q = sim.quests;
  const done = new Set(q.done);
  for (const def of QUESTS) {
    if (done.has(def.id)) continue;
    const [cur, max] = def.progress(sim);
    if (cur >= max) {
      q.done.push(def.id);
      done.add(def.id);
      q.claimed[def.id] = sim.time;
      const r = def.reward;
      const parts: string[] = [];
      if (r?.tokens) {
        sim.ai.tokens += r.tokens;
        parts.push(`+${r.tokens} токенов`);
      }
      if (r?.compute) {
        sim.ai.compute += r.compute;
        parts.push(`+${r.compute} вычислений`);
      }
      if (r?.items) for (const k in r.items) {
        sim.addStock(k, r.items[k]);
        parts.push(`+${r.items[k]} ${ITEMS[k as ItemId]?.name.toLowerCase() ?? k}`);
      }
      sim.events.emit('quest', { id: def.id, done: true });
      sim.toast({ kind: 'success', title: `Задача выполнена: ${def.title}`, text: parts.length ? 'Награда: ' + parts.join(', ') : undefined, key: 'quest-' + def.id });
    }
  }
  q.active = QUESTS.filter((d) => !done.has(d.id) && d.era <= sim.ai.era + 1).slice(0, 3).map((d) => d.id);
}
