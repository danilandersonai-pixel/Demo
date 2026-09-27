import type { Sim } from '../sim/sim';
import type { Forecast, Proposal, CiTest } from '../ai/state';
import { headFiles } from './git';
import { normalizeCode } from './vibe';
import { ITEMS, type ItemId } from '../data/items';
import { resolveItem } from '../script/groups';
import { mainPower, powerRatio } from '../sim/power';

export interface SandboxJob {
  progress: number;
  done: boolean;
  forecast?: Forecast;
  step(maxMs?: number): void;
}

export const SANDBOX_SECONDS = 90;

export function sandboxFiles(sim: Sim, p: Proposal): Record<string, string> {
  const files = { ...headFiles(sim.git) };
  if (p.kind === 'refactor') {
    for (const k of Object.keys(files)) files[k] = normalizeCode(files[k]);
  } else if (sim.ai.era <= 1) {
    for (const k of Object.keys(files)) delete files[k];
    files['automation.py'] = p.code;
  } else files[p.fileName] = p.code;
  return files;
}

function interestingItems(sim: Sim, code: string): ItemId[] {
  const set = new Set<ItemId>();
  const rx = /"([a-z_]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(code))) {
    const base = m[1].replace(/_(production|smelters|line|mining)$/, '');
    const it = resolveItem(base);
    if (it && !ITEMS[it].fluid) set.add(it);
  }
  const top = sim.stats.keys
    .filter((k) => k in ITEMS && !ITEMS[k as ItemId].fluid)
    .map((k) => [k, sim.stats.rate(k)] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k as ItemId);
  for (const t of top) if (set.size < 5) set.add(t);
  return [...set].slice(0, 5);
}

function evalTests(s: Sim, tests: CiTest[], minPower: number): { name: string; pass: boolean }[] {
  return tests.map((t) => {
    let pass = false;
    if (t.kind === 'rate_ge') pass = s.stats.rate(t.key) >= t.value;
    else if (t.kind === 'stock_ge') pass = s.stock(t.key) >= t.value;
    else pass = minPower >= t.value;
    return { name: t.name, pass };
  });
}

/**
 * Forecast a proposal: two headless clones (current code vs branch) run forward 90 s in chunks.
 * The UI calls step() each frame so the game never freezes.
 */
export function startSandbox(sim: Sim, p: Proposal, seconds = SANDBOX_SECONDS): SandboxJob {
  const base = sim.clone();
  const branch = sim.clone();
  branch.scripts.setFiles(sandboxFiles(sim, p));
  const total = Math.round(seconds * 60);
  let done = 0;
  const items = interestingItems(sim, p.code);
  let powBase = 0;
  let powBranch = 0;
  let samples = 0;
  let minPowBranch = 1;
  const job: SandboxJob = {
    progress: 0,
    done: false,
    step(maxMs = 8) {
      if (job.done) return;
      const t0 = performance.now();
      while (done < total && performance.now() - t0 < maxMs) {
        for (let i = 0; i < 60 && done < total; i++, done++) {
          base.step();
          branch.step();
        }
        powBase += mainPower(base).sat;
        powBranch += mainPower(branch).sat;
        minPowBranch = Math.min(minPowBranch, powerRatio(branch));
        samples++;
      }
      job.progress = done / total;
      if (done >= total) {
        const rows = items.map((it) => ({ key: it, label: ITEMS[it].name, before: base.stats.rate(it), after: branch.stats.rate(it), unit: '/мин' }));
        const tests = evalTests(branch, sim.ai.ciTests, minPowBranch);
        const pb = powBase / Math.max(1, samples);
        const pa = powBranch / Math.max(1, samples);
        const parts = rows.slice(0, 3).map((r) => {
          const d = r.before > 0.5 ? Math.round(((r.after - r.before) / r.before) * 100) : r.after > 0.5 ? 100 : 0;
          return `${r.label}: ${Math.round(r.before)} → ${Math.round(r.after)}/мин${d ? ` (${d > 0 ? '+' : ''}${d}%)` : ''}`;
        });
        parts.push(pa < 0.995 ? `энергия: дефицит ${Math.round((1 - pa) * 100)}%` : 'энергия: без дефицита');
        job.forecast = { seconds, rows, powerBefore: pb, powerAfter: pa, tests, summary: parts.join(', ') };
        job.done = true;
      }
    },
  };
  return job;
}
