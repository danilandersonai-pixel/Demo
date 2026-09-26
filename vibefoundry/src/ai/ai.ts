import type { Sim } from '../sim/sim';

const HQ_COMPUTE = 2;
const HQ_TOKENS = 0.6;

/** Per-tick AI layer update: terminal trickle. Extended in phase 6. */
export function updateAI(sim: Sim, dt: number): void {
  if (sim.hq) {
    sim.ai.compute += HQ_COMPUTE * dt;
    sim.stats.produce('compute', HQ_COMPUTE * dt);
    sim.ai.tokens += HQ_TOKENS * dt;
    sim.stats.produce('tokens', HQ_TOKENS * dt);
  }
}

export function aiEverySecond(_sim: Sim): void {}
