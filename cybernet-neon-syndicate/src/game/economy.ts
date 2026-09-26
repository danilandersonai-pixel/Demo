// Экономическая модель: множители, выработка каждой ячейки, прогноз следующего дня.
// Прогноз (projectTick) использует и игровой цикл, и интерфейс — поэтому цифры
// «+15.2/день» на экране совпадают с тем, что реально начислит следующий тик.

import {
  AURA_CAP,
  AUTOBROKER_FEE,
  BASE_DATA_CAP,
  BASE_ENERGY_CAP,
  BASE_OVERHEAD,
  BLACKOUT_RESTART,
  BLACKOUT_RESTART_GRAPHENE,
  BUILDINGS,
  ENERGY_EXPORT_PRICE,
  GRID_CELLS,
  OVERHEAD_PER_ROW,
  START_ROWS,
  STANDBY_UPKEEP,
  WEALTH_FREE,
  WEALTH_RATE,
  auraLevelMult,
  inflationAt,
  neighborsOf,
  outputMult,
  upkeepLevelMult,
  useLevelMult,
} from './config.ts';
import type { BuildingId, Cell, Cost, GameState, ModTarget, ResearchId } from './types.ts';

export interface Multipliers {
  credit: number;
  miner: number;
  data: number;
  energyProd: number;
  solar: number;
  use: number;
  upkeep: number;
  aura: number;
  dataCap: number;
  energyCap: number;
  dataPrice: number;
}

export interface CellOutput {
  index: number;
  type: BuildingId;
  active: boolean;
  adjBonus: number;
  energyProd: number;
  energyUse: number;
  credits: number;
  data: number;
  upkeep: number;
}

export interface Economy {
  cells: Array<CellOutput | null>;
  /** Бонус ауры оптимизаторов в каждой ячейке (в т.ч. пустой — для подсказки при стройке). */
  aura: number[];
  energyProd: number;
  energyUse: number;
  energyCap: number;
  creditProd: number;
  dataProd: number;
  dataCap: number;
  upkeep: number;
  overhead: number;
  inflation: number;
  mults: Multipliers;
  bySource: {
    solar: number;
    reactor: number;
    miner: number;
    qcore: number;
    server: number;
    qcoreData: number;
  };
}

export interface EconomyOptions {
  /** Учитывать временные эффекты событий. */
  temporary?: boolean;
  /** Оптимизаторы запитаны (в блэкауте их аура не работает). */
  powered?: boolean;
}

export function hasResearch(state: Pick<GameState, 'research'>, id: ResearchId): boolean {
  return state.research.done.includes(id);
}

function tempMult(state: Pick<GameState, 'modifiers'>, target: ModTarget): number {
  let mult = 1;
  for (const mod of state.modifiers) {
    if (mod.target === target) mult *= 1 + mod.value;
  }
  return Math.max(0, mult);
}

export function getMultipliers(state: GameState, temporary = true): Multipliers {
  const has = (id: ResearchId) => hasResearch(state, id);
  const temp = (target: ModTarget) => (temporary ? tempMult(state, target) : 1);
  const syndicate = has('syndicateProtocol') ? 0.15 : 0;
  return {
    credit: (1 + (has('quantumAlgo') ? 0.25 : 0) + syndicate) * temp('creditOutput'),
    miner: temp('minerOutput'),
    data: (1 + (has('dataCompression') ? 0.1 : 0) + syndicate) * temp('dataOutput'),
    energyProd: (1 + syndicate) * temp('energyProd'),
    solar: (1 + (has('orbitalMirrors') ? 0.35 : 0)) * temp('solarOutput'),
    use: (has('nitrogenCooling') ? 0.8 : 1) * temp('energyUse'),
    upkeep: (has('shadowLedger') ? 0.85 : 1) * temp('upkeep'),
    aura: has('swarmMind') ? 25 / 15 : 1,
    dataCap: has('dataCompression') ? 1.6 : 1,
    energyCap: has('grapheneCells') ? 2.5 : 1,
    dataPrice: (has('syndicateProtocol') ? 1.1 : 1) * temp('dataPrice'),
  };
}

/** Бонус, который один оптимизатор даёт каждому соседу. */
export function optimizerAura(level: number, mults: Pick<Multipliers, 'aura'>): number {
  return BUILDINGS.optimizer.aura * auraLevelMult(level) * mults.aura;
}

/** Суммарный бонус оптимизаторов по ячейкам; складывается, но не выше AURA_CAP. */
export function computeAura(state: GameState, mults: Multipliers, powered: boolean): number[] {
  const aura = new Array<number>(GRID_CELLS).fill(0);
  if (!powered) return aura;
  state.grid.forEach((cell, index) => {
    if (cell.type !== 'optimizer' || !cell.enabled) return;
    const bonus = optimizerAura(cell.level, mults);
    for (const n of neighborsOf(index)) aura[n] += bonus;
  });
  return aura.map((value) => Math.min(value, AURA_CAP));
}

/** Плата за хранение капитала сверх порога, ₵/день. */
export function wealthCost(credits: number): number {
  return Math.max(0, credits - WEALTH_FREE) * WEALTH_RATE;
}

/** Выработка одной постройки с учётом уровня, ауры и глобальных множителей. */
export function cellOutput(
  cell: Cell,
  index: number,
  adjBonus: number,
  mults: Multipliers,
  inflation: number,
): CellOutput | null {
  if (!cell.type) return null;
  const def = BUILDINGS[cell.type];
  const out = outputMult(cell.level);
  const boost = 1 + adjBonus;
  const active = cell.enabled;
  const solarMult = cell.type === 'solar' ? mults.solar : 1;
  const minerMult = cell.type === 'miner' ? mults.miner : 1;
  const upkeepBase = def.upkeep * upkeepLevelMult(cell.level) * mults.upkeep * inflation;
  return {
    index,
    type: cell.type,
    active,
    adjBonus,
    energyProd: active ? def.energyProd * out * boost * mults.energyProd * solarMult : 0,
    energyUse: active ? def.energyUse * useLevelMult(cell.level) * mults.use : 0,
    credits: active ? def.creditProd * out * boost * mults.credit * minerMult : 0,
    data: active ? def.dataProd * out * boost * mults.data : 0,
    upkeep: active ? upkeepBase : upkeepBase * STANDBY_UPKEEP,
  };
}

export function computeEconomy(state: GameState, options: EconomyOptions = {}): Economy {
  const temporary = options.temporary ?? true;
  const powered = options.powered ?? !state.blackout;
  const mults = getMultipliers(state, temporary);
  const inflation = inflationAt(state.day);
  const aura = computeAura(state, mults, powered);

  let energyProd = 0;
  let energyUse = 0;
  let creditProd = 0;
  let dataProd = 0;
  let upkeep = 0;
  let dataCapExtra = 0;
  let energyCapExtra = 0;
  const bySource = { solar: 0, reactor: 0, miner: 0, qcore: 0, server: 0, qcoreData: 0 };

  const cells = state.grid.map((cell, index) => {
    const output = cellOutput(cell, index, aura[index], mults, inflation);
    if (!output || !cell.type) return null;
    const def = BUILDINGS[cell.type];
    energyProd += output.energyProd;
    energyUse += output.energyUse;
    creditProd += output.credits;
    dataProd += output.data;
    upkeep += output.upkeep;
    // Хранилища работают и в режиме ожидания: это пассивная ёмкость.
    dataCapExtra += def.dataCap * outputMult(cell.level);
    energyCapExtra += def.energyCap * outputMult(cell.level);
    if (cell.type === 'solar') bySource.solar += output.energyProd;
    if (cell.type === 'reactor') bySource.reactor += output.energyProd;
    if (cell.type === 'miner') bySource.miner += output.credits;
    if (cell.type === 'qcore') {
      bySource.qcore += output.credits;
      bySource.qcoreData += output.data;
    }
    if (cell.type === 'server') bySource.server += output.data;
    return output;
  });

  const overhead =
    (BASE_OVERHEAD + OVERHEAD_PER_ROW * Math.max(0, state.rowsUnlocked - START_ROWS)) * inflation * mults.upkeep;

  return {
    cells,
    aura,
    energyProd,
    energyUse,
    energyCap: (BASE_ENERGY_CAP + energyCapExtra) * mults.energyCap,
    creditProd,
    dataProd,
    dataCap: (BASE_DATA_CAP + dataCapExtra) * mults.dataCap,
    upkeep,
    overhead,
    inflation,
    mults,
    bySource,
  };
}

/** Постоянный баланс мощности (без временных событий) — по нему блокируются покупки. */
export function structuralEnergyNet(state: GameState): number {
  const econ = computeEconomy(state, { temporary: false, powered: true });
  return econ.energyProd - econ.energyUse;
}

export function restartThreshold(state: GameState): number {
  return hasResearch(state, 'grapheneCells') ? BLACKOUT_RESTART_GRAPHENE : BLACKOUT_RESTART;
}

export function effectiveDataPrice(state: GameState): number {
  return state.market.price * getMultipliers(state, true).dataPrice;
}

export function autoBrokerPrice(state: GameState): number {
  return effectiveDataPrice(state) * (1 - AUTOBROKER_FEE);
}

export interface TickProjection {
  econ: Economy;
  powerRatio: number;
  energyAfter: number;
  blackoutAfter: boolean;
  blackoutStarted: boolean;
  blackoutEnded: boolean;
  energyConsumed: number;
  energyExported: number;
  exportIncome: number;
  creditProduction: number;
  upkeep: number;
  overhead: number;
  wealth: number;
  creditsDelta: number;
  dataGain: number;
  dataOverflow: number;
  energyDelta: number;
}

/**
 * Что произойдёт за следующий день (без случайных событий и Авто-Брокера).
 * Вызывается на состоянии ДО наступления дня.
 */
export function projectTick(state: GameState): TickProjection {
  const nextDay = state.day + 1;
  const view: GameState = {
    ...state,
    day: nextDay,
    modifiers: state.modifiers.filter((mod) => mod.endsDay >= nextDay),
  };
  const econ = computeEconomy(view, { temporary: true, powered: !state.blackout });

  let powerRatio = 1;
  let energyAfter: number;
  let blackoutAfter = state.blackout;

  if (!state.blackout) {
    const available = state.energy + econ.energyProd;
    if (available >= econ.energyUse) {
      energyAfter = available - econ.energyUse;
    } else {
      powerRatio = econ.energyUse > 0 ? Math.max(0, available / econ.energyUse) : 1;
      energyAfter = 0;
      blackoutAfter = true;
    }
  } else {
    // Аварийный режим: потребители обесточены, генераторы заряжают хранилище.
    powerRatio = 0;
    energyAfter = state.energy + econ.energyProd;
    if (energyAfter >= econ.energyCap * restartThreshold(state)) blackoutAfter = false;
  }

  const energyExported = Math.max(0, energyAfter - econ.energyCap);
  energyAfter = Math.min(energyAfter, econ.energyCap);
  const exportIncome = energyExported * ENERGY_EXPORT_PRICE;
  const creditProduction = econ.creditProd * powerRatio;
  const wealth = wealthCost(state.credits);
  const creditsDelta = creditProduction + exportIncome - econ.upkeep - econ.overhead - wealth;
  const rawData = econ.dataProd * powerRatio;
  const room = Math.max(0, econ.dataCap - state.data);
  const dataGain = Math.min(rawData, room);

  return {
    econ,
    powerRatio,
    energyAfter,
    blackoutAfter,
    blackoutStarted: !state.blackout && blackoutAfter,
    blackoutEnded: state.blackout && !blackoutAfter,
    energyConsumed: econ.energyUse * powerRatio,
    energyExported,
    exportIncome,
    creditProduction,
    upkeep: econ.upkeep,
    overhead: econ.overhead,
    wealth,
    creditsDelta,
    dataGain,
    dataOverflow: Math.max(0, rawData - dataGain),
    energyDelta: energyAfter - state.energy,
  };
}

export function countBuildings(state: GameState, type?: BuildingId): number {
  let count = 0;
  for (const cell of state.grid) {
    if (cell.type && (!type || cell.type === type)) count += 1;
  }
  return count;
}

export function buildCost(state: GameState, type: BuildingId): Cost {
  const def = BUILDINGS[type];
  const factor = Math.pow(def.costGrowth, countBuildings(state, type));
  return {
    credits: Math.round(def.baseCost.credits * factor),
    data: Math.round(def.baseCost.data * factor),
  };
}

export function upgradeCost(cell: Cell): Cost {
  if (!cell.type) return { credits: 0, data: 0 };
  const def = BUILDINGS[cell.type];
  const step = 1.6 * Math.pow(1.9, cell.level - 1);
  return {
    credits: Math.round(def.baseCost.credits * step),
    data: Math.round(def.baseCost.data * step + def.baseCost.credits * 0.12 * (cell.level - 1)),
  };
}

/** Чистая стоимость имущества: кредиты + половина вложенного в здания + данные по рынку. */
export function netWorth(state: GameState): number {
  const buildings = state.grid.reduce((sum, cell) => sum + cell.invested * 0.5, 0);
  return state.credits + buildings + state.data * state.market.price;
}
