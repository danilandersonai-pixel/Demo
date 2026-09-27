import type { Sim } from '../sim/sim';
import { BELTLIKE } from '../data/buildings';

/** Context capacity in "k" units: HQ terminal 4k + AI Core 8k + 2k per memory module. */
export function contextCapacity(sim: Sim): number {
  let cap = 4;
  for (const e of sim.list) {
    if (e.ghost) continue;
    if (e.type === 'aicore') cap += 8;
    if (e.type === 'aicore' || e.type === 'server') cap += 2 * (e.modules ?? 0);
    if (e.type === 'server') cap += 1;
  }
  return cap * (1 + sim.effects.context);
}

/** How much of the factory an agent needs to "see" (k units). */
export function contextNeeded(sim: Sim): number {
  let n = 0;
  for (const e of sim.list) if (!e.ghost && !BELTLIKE.has(e.type) && e.type !== 'pipe' && e.type !== 'pole') n++;
  const groups = Object.keys(sim.groups).length;
  let lines = 0;
  for (const src of Object.values(sim.scripts.files())) lines += src.split('\n').length;
  return 1 + n * 0.03 + groups * 0.3 + lines * 0.05;
}

/** Fraction of the factory visible to the agent (1 = everything fits). */
export function contextFit(sim: Sim): number {
  const need = contextNeeded(sim);
  const cap = contextCapacity(sim);
  return Math.min(1, cap / Math.max(0.001, need));
}
