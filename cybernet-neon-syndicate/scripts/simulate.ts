// Headless-симуляция баланса: гоняет игровой reducer без интерфейса.
// Запуск: npm run sim  (или node scripts/simulate.ts [число_сидов] [макс_дней])
//
// Боты:
//  • passive — ничего не строит, на события отвечает вариантом по умолчанию;
//  • greedy  — строит и улучшает по окупаемости, держит запас мощности, исследует по приоритету.
// Хороший баланс: пассивная игра проигрывает, осмысленная — живёт в разы дольше.

import { BUILDINGS, BUILDING_ORDER, GRID_CELLS, RESEARCH_ORDER, neighborsOf } from '../src/game/config.ts';
import { computeEconomy, effectiveDataPrice, projectTick, structuralEnergyNet } from '../src/game/economy.ts';
import { createInitialState, gameReducer } from '../src/game/engine.ts';
import { checkBuild, checkResearch, checkUnlockRow, checkUpgrade, isCellUnlocked } from '../src/game/rules.ts';
import type { Action, BuildingId, GameState } from '../src/game/types.ts';

const SEEDS = Number(process.argv[2] ?? 6);
const MAX_DAYS = Number(process.argv[3] ?? 4000);

function value(state: GameState): number {
  const p = projectTick(state);
  const price = effectiveDataPrice(state);
  return p.creditsDelta + p.dataGain * price * 0.8;
}

function decide(state: GameState): string {
  const pending = state.pending!;
  const ctx = pending.ctx;
  const can = (id: string) => {
    const o = pending.options.find((x) => x.id === id)!;
    return state.credits >= o.cost.credits && state.data >= o.cost.data;
  };
  switch (pending.eventId) {
    case 'hack':
      if (can('protect') && ctx.protect < ctx.loss + ctx.dataLoss * 3) return 'protect';
      if (can('counter') && state.data > ctx.counterData * 4) return 'counter';
      return 'ignore';
    case 'taxAudit':
      if (can('lawyers') && state.data > ctx.lawyersData * 3) return 'lawyers';
      return 'pay';
    case 'investor':
      return state.credits < 400 ? 'accept' : 'decline';
    case 'blackMarket':
      return 'sell';
    case 'rivalRaid':
      return can('pay') && ctx.ransom < state.credits * 0.5 ? 'pay' : 'defend';
    default:
      return pending.defaultOption;
  }
}

function bestCellFor(state: GameState, type: BuildingId): number {
  const econ = computeEconomy(state);
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < GRID_CELLS; i += 1) {
    if (!isCellUnlocked(state, i) || state.grid[i].type) continue;
    let score: number;
    if (type === 'optimizer') {
      score = neighborsOf(i).filter((n) => {
        const t = state.grid[n].type;
        return t && t !== 'optimizer';
      }).length + neighborsOf(i).filter((n) => isCellUnlocked(state, n) && !state.grid[n].type).length * 0.4;
    } else {
      score = econ.aura[i];
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Добавить мощность самым дешёвым способом за 1⚡: новая панель/реактор или улучшение генератора. */
function addPower(state: GameState): GameState {
  const options: Array<{ action: Action; perUnit: number }> = [];
  const base = structuralEnergyNet(state);
  const rich = { ...state, credits: 1e12, data: 1e9 };
  const consider = (action: Action) => {
    const next = gameReducer(rich, action);
    if (next === rich) return;
    const gain = structuralEnergyNet(next) - base;
    if (gain <= 0) return;
    const cost = 1e12 - next.credits + (1e9 - next.data) * 3;
    options.push({ action, perUnit: cost / gain });
  };
  for (const t of ['solar', 'reactor'] as BuildingId[]) {
    const cell = bestCellFor(state, t);
    if (cell >= 0) consider({ type: 'BUILD', building: t, cell });
  }
  state.grid.forEach((c, i) => {
    if (c.type === 'solar' || c.type === 'reactor') consider({ type: 'UPGRADE', cell: i });
  });
  options.sort((a, b) => a.perUnit - b.perUnit);
  for (const o of options) {
    const next = gameReducer(state, o.action);
    if (next !== state) return next;
    return state; // самый выгодный вариант пока не по карману — копим
  }
  if (checkUnlockRow(state).ok) return gameReducer(state, { type: 'UNLOCK_ROW' });
  return state;
}

function greedyAct(state: GameState): GameState {
  let s = state;
  if (s.pending) s = gameReducer(s, { type: 'RESOLVE_DECISION', option: decide(s) });

  const econ = computeEconomy(s);
  if (!s.autoBrokerEnabled && s.data > econ.dataCap * 0.92) {
    s = gameReducer(s, { type: 'SELL_DATA', fraction: 0.4 });
  }
  // Экстренно: минус на счёте — продаём данные, как сделал бы внимательный игрок.
  if (s.credits < 0 && s.data > 0) {
    const need = -s.credits / effectiveDataPrice(s);
    s = gameReducer(s, { type: 'SELL_DATA', fraction: Math.min(1, (need + 1) / s.data) });
  }

  if (!s.research.active) {
    for (const id of RESEARCH_ORDER) {
      if (checkResearch(s, id).ok) {
        s = gameReducer(s, { type: 'START_RESEARCH', id });
        break;
      }
    }
  }

  for (let step = 0; step < 4; step += 1) {
    const base = value(s);
    const price = effectiveDataPrice(s);
    const candidates: Array<{ action: Action; roi: number }> = [];
    const spare = structuralEnergyNet(s);

    // Питание: держим запас мощности под следующую постройку.
    if (spare < 10 && !s.blackout) {
      const powered = addPower(s);
      if (powered === s) break;
      s = powered;
      continue;
    }

    for (const t of BUILDING_ORDER) {
      if (BUILDINGS[t].energyProd > 0) continue;
      const cell = bestCellFor(s, t);
      if (cell < 0) continue;
      const action: Action = { type: 'BUILD', building: t, cell };
      const next = gameReducer({ ...s, credits: 1e12, data: 1e9 }, action);
      if (next === s || next.credits === 1e12) continue;
      const cost = 1e12 - next.credits + (1e9 - next.data) * price;
      const gain = value({ ...next, credits: s.credits, data: s.data }) - base;
      candidates.push({ action, roi: gain / cost });
    }
    for (let i = 0; i < GRID_CELLS; i += 1) {
      const cell = s.grid[i];
      if (!cell.type || BUILDINGS[cell.type].energyProd > 0) continue;
      const action: Action = { type: 'UPGRADE', cell: i };
      const next = gameReducer({ ...s, credits: 1e12, data: 1e9 }, action);
      if (next.credits === 1e12) continue;
      const cost = 1e12 - next.credits + (1e9 - next.data) * price;
      const gain = value({ ...next, credits: s.credits, data: s.data }) - base;
      candidates.push({ action, roi: gain / cost });
    }
    const freeCells = s.grid.filter((c, i) => !c.type && isCellUnlocked(s, i)).length;
    if (freeCells <= 1 && checkUnlockRow({ ...s, credits: 1e12, data: 1e9 }).ok) {
      const bestBuild = candidates.filter((c) => c.action.type === 'BUILD').reduce((m, c) => Math.max(m, c.roi), 0);
      candidates.push({ action: { type: 'UNLOCK_ROW' }, roi: Math.max(0.002, bestBuild * 0.6) });
    }
    candidates.sort((a, b) => b.roi - a.roi);
    const best = candidates.find((c) => c.roi > 0);
    if (!best) break;
    const next = gameReducer(s, best.action);
    if (next === s) {
      // Упёрлись в энергию — добавляем мощность.
      const act = best.action;
      const probe = { ...s, credits: 1e12, data: 1e9 };
      const reason =
        act.type === 'BUILD' ? checkBuild(probe, act.building, act.cell).reason : act.type === 'UPGRADE' ? checkUpgrade(probe, act.cell).reason : null;
      if (reason?.includes('мощности')) s = addPower(s);
      break;
    }
    s = next;
  }
  return s;
}

interface RunResult {
  days: number;
  peak: number;
  research: number;
  buildings: number;
  firstResearch: number;
  snapshots: Record<number, string>;
  blackouts: number;
}

function run(seed: number, bot: 'passive' | 'greedy'): RunResult {
  let s = createInitialState(seed, 0);
  s.speed = 1;
  const snapshots: Record<number, string> = {};
  let firstResearch = -1;
  const marks = new Set([50, 100, 200, 400, 800, 1200, 1600, 2000, 3000]);
  while (s.status === 'playing' && s.day < MAX_DAYS) {
    s = gameReducer(s, { type: 'TICK', now: 0 });
    if (bot === 'greedy' && s.status === 'playing' && s.day % 2 === 0) s = greedyAct(s);
    if (firstResearch < 0 && s.research.done.length > 0) firstResearch = s.day;
    if (marks.has(s.day)) {
      const p = projectTick(s);
      const built = s.grid.filter((c) => c.type).length;
      const lv = s.grid.reduce((a, c) => a + (c.type ? c.level : 0), 0);
      snapshots[s.day] =
        `₵${Math.round(s.credits)} net${p.creditsDelta >= 0 ? '+' : ''}${p.creditsDelta.toFixed(1)} ` +
        `prod${p.creditProduction.toFixed(0)} upk${(p.upkeep + p.overhead).toFixed(0)} ` +
        `data${Math.round(s.data)}/${Math.round(p.econ.dataCap)} +${p.dataGain.toFixed(1)} ` +
        `E${Math.round(s.energy)}/${Math.round(p.econ.energyCap)} ` +
        `bld${built} lv${lv} rows${s.rowsUnlocked} res${s.research.done.length}`;
    }
  }
  return {
    days: s.day,
    peak: Math.round(s.stats.peakCapital),
    research: s.research.done.length,
    buildings: s.grid.filter((c) => c.type).length,
    firstResearch,
    snapshots,
    blackouts: s.stats.blackouts,
  };
}

for (const bot of ['passive', 'greedy'] as const) {
  console.log(`\n=== ${bot.toUpperCase()} (${SEEDS} сидов, лимит ${MAX_DAYS} дн.) ===`);
  const results: RunResult[] = [];
  for (let i = 0; i < SEEDS; i += 1) {
    const r = run(1000 + i * 7919, bot);
    results.push(r);
    console.log(
      `seed#${i}: дней ${r.days}, пик ₵${r.peak}, исследований ${r.research}, зданий ${r.buildings}, ` +
        `первое иссл. д.${r.firstResearch}, блэкаутов ${r.blackouts}`,
    );
    if (i === 0) for (const [d, line] of Object.entries(r.snapshots)) console.log(`   д.${d}: ${line}`);
  }
  const avg = results.reduce((a, r) => a + r.days, 0) / results.length;
  const min = Math.min(...results.map((r) => r.days));
  const max = Math.max(...results.map((r) => r.days));
  console.log(`ИТОГО ${bot}: среднее ${avg.toFixed(0)} дн., мин ${min}, макс ${max}`);
}
