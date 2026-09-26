// Правила доступности действий. Одни и те же проверки использует reducer
// (чтобы нельзя было «обмануть» игру) и интерфейс (чтобы блокировать кнопки с причиной).

import { BUILDINGS, GRID_COLS, GRID_ROWS, MAX_LEVEL, RESEARCH, ROW_UNLOCK_COSTS, useLevelMult } from './config.ts';
import { buildCost, getMultipliers, hasResearch, structuralEnergyNet, upgradeCost } from './economy.ts';
import { fmt } from './format.ts';
import type { BuildingId, Cost, GameState, ResearchId } from './types.ts';

export interface Check {
  ok: boolean;
  reason: string | null;
}

const OK: Check = { ok: true, reason: null };
const fail = (reason: string): Check => ({ ok: false, reason });

export function isCellUnlocked(state: GameState, index: number): boolean {
  return index >= 0 && index < GRID_COLS * GRID_ROWS && Math.floor(index / GRID_COLS) < state.rowsUnlocked;
}

export function firstFreeCell(state: GameState): number {
  return state.grid.findIndex((cell, index) => !cell.type && isCellUnlocked(state, index));
}

/** Ячейка для стройки: выбранная, если она свободна, иначе первая свободная. */
export function resolveBuildTarget(state: GameState, selected: number | null): number {
  if (selected !== null && isCellUnlocked(state, selected) && !state.grid[selected]?.type) return selected;
  return firstFreeCell(state);
}

function checkCost(state: GameState, cost: Cost): Check {
  if (state.credits < cost.credits) return fail(`Не хватает ${fmt(cost.credits - state.credits)}₵`);
  if (state.data < cost.data) return fail(`Не хватает ${fmt(cost.data - state.data)} ед. данных`);
  return OK;
}

function checkEnergy(state: GameState, extraUse: number): Check {
  if (extraUse <= 0) return OK;
  if (state.blackout) return fail('Сеть в аварийном режиме — сначала восстановите энергию');
  const spare = structuralEnergyNet(state);
  if (spare + 1e-9 < extraUse) return fail(`Нужно ещё ${fmt(extraUse - spare, 1)}⚡ мощности`);
  return OK;
}

export function checkBuild(state: GameState, type: BuildingId, cell: number): Check {
  if (state.status !== 'playing') return fail('Игра окончена');
  const def = BUILDINGS[type];
  if (def.requires && !hasResearch(state, def.requires)) {
    return fail(`Требуется исследование «${RESEARCH[def.requires].name}»`);
  }
  if (cell < 0) return fail('Нет свободных ячеек — расширьте сектор');
  if (!isCellUnlocked(state, cell)) return fail('Ячейка заблокирована');
  if (state.grid[cell].type) return fail('Ячейка занята');
  const cost = checkCost(state, buildCost(state, type));
  if (!cost.ok) return cost;
  const use = def.energyUse * useLevelMult(1) * getMultipliers(state, false).use;
  return checkEnergy(state, use);
}

export function checkUpgrade(state: GameState, index: number): Check {
  if (state.status !== 'playing') return fail('Игра окончена');
  const cell = state.grid[index];
  if (!cell?.type) return fail('Пустая ячейка');
  if (cell.level >= MAX_LEVEL) return fail('Максимальный уровень');
  const cost = checkCost(state, upgradeCost(cell));
  if (!cost.ok) return cost;
  if (!cell.enabled) return OK;
  const def = BUILDINGS[cell.type];
  const extra = def.energyUse * (useLevelMult(cell.level + 1) - useLevelMult(cell.level)) * getMultipliers(state, false).use;
  return checkEnergy(state, extra);
}

/** Сколько постоянной мощности пропадёт, если выключить генератор (с учётом ауры). */
function generatorLoss(state: GameState, index: number): number {
  const without = { ...state, grid: state.grid.map((c, i) => (i === index ? { ...c, enabled: false } : c)) };
  return structuralEnergyNet(state) - structuralEnergyNet(without);
}

export function checkDemolish(state: GameState, index: number): Check {
  if (state.status !== 'playing') return fail('Игра окончена');
  const cell = state.grid[index];
  if (!cell?.type) return fail('Пустая ячейка');
  if (cell.enabled) {
    const loss = generatorLoss(state, index);
    if (loss > 0 && structuralEnergyNet(state) - loss < -1e-9) {
      return fail('Сеть не выдержит — сначала отключите потребителей');
    }
  }
  return OK;
}

export function checkToggle(state: GameState, index: number): Check {
  if (state.status !== 'playing') return fail('Игра окончена');
  const cell = state.grid[index];
  if (!cell?.type) return fail('Пустая ячейка');
  const def = BUILDINGS[cell.type];
  if (cell.enabled) {
    const loss = generatorLoss(state, index);
    if (loss > 0 && structuralEnergyNet(state) - loss < -1e-9) {
      return fail('Сеть не выдержит — сначала отключите потребителей');
    }
    return OK;
  }
  const use = def.energyUse * useLevelMult(cell.level) * getMultipliers(state, false).use;
  return checkEnergy(state, use);
}

export function nextRowCost(state: GameState): Cost | null {
  const idx = state.rowsUnlocked - (GRID_ROWS - ROW_UNLOCK_COSTS.length);
  return ROW_UNLOCK_COSTS[idx] ?? null;
}

export function checkUnlockRow(state: GameState): Check {
  if (state.status !== 'playing') return fail('Игра окончена');
  const cost = nextRowCost(state);
  if (!cost) return fail('Сектор полностью открыт');
  return checkCost(state, cost);
}

export type ResearchStatus = 'done' | 'active' | 'available' | 'locked';

export function researchStatus(state: GameState, id: ResearchId): ResearchStatus {
  if (hasResearch(state, id)) return 'done';
  if (state.research.active === id) return 'active';
  return RESEARCH[id].requires.every((req) => hasResearch(state, req)) ? 'available' : 'locked';
}

export function checkResearch(state: GameState, id: ResearchId): Check {
  if (state.status !== 'playing') return fail('Игра окончена');
  const status = researchStatus(state, id);
  if (status === 'done') return fail('Уже изучено');
  if (status === 'active') return fail('Уже исследуется');
  if (status === 'locked') {
    const missing = RESEARCH[id].requires.filter((req) => !hasResearch(state, req)).map((req) => `«${RESEARCH[req].name}»`);
    return fail(`Сначала изучите ${missing.join(' и ')}`);
  }
  if (state.research.active) return fail(`Отдел занят: «${RESEARCH[state.research.active].name}»`);
  return checkCost(state, RESEARCH[id].cost);
}
