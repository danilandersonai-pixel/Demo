import type { Sim } from './sim';

export interface QuestState {
  done: string[];
  active: string[];
  claimed: Record<string, number>;
}

export function newQuestState(): QuestState {
  return { done: [], active: [], claimed: {} };
}

/** Filled in phase 3. */
export function updateQuests(_sim: Sim): void {}
