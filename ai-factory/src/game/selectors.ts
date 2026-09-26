// Чистые функции-«селекторы»: только читают состояние. Их используют движок,
// цели, интерфейс и тесты баланса — формулы живут в одном месте.

import {
  BAL,
  BUILDINGS,
  COLS,
  FEEDS,
  GRID,
  PRODUCTION_TYPES,
  START_MAX,
  START_MIN,
} from './config';
import type { Building, BuildingType, GameState, ResKey, ResearchId, SellableRes } from './types';

export interface Mods {
  /** Суммарная прибавка скорости от исследований (0,25 за каждый конвейер). */
  speed: number;
  coderEnergy: number;
  debtMult: number;
  capMult: number;
  smartGrid: boolean;
  reactorMult: number;
  gpuMult: number;
  minerMult: number;
  trainerInput: number;
  priceMult: number;
  agiUnlocked: boolean;
  agiMult: number;
  expansion: boolean;
  autoRefactor: boolean;
}

export function hasResearch(s: Pick<GameState, 'research'>, id: ResearchId): boolean {
  return s.research.done.includes(id);
}

export function getMods(s: Pick<GameState, 'research'>): Mods {
  const d = new Set(s.research.done);
  return {
    speed: (d.has('conveyor') ? 0.25 : 0) + (d.has('hyper') ? 0.25 : 0),
    coderEnergy: d.has('softRefactor') ? 0.7 : 1,
    debtMult: d.has('codeReview') ? 0.5 : 1,
    capMult: d.has('coldStorage') ? 2 : 1,
    smartGrid: d.has('smartGrid'),
    reactorMult: d.has('fusion') ? 1.5 : 1,
    gpuMult: d.has('tensorCores') ? 1.5 : 1,
    minerMult: d.has('synthData') ? 1.5 : 1,
    trainerInput: d.has('distill') ? 0.75 : 1,
    priceMult: d.has('viral') ? 1.3 : 1,
    agiUnlocked: d.has('transformers'),
    agiMult: d.has('singularity') ? 1.5 : 1,
    expansion: d.has('expansion'),
    autoRefactor: d.has('cicd'),
  };
}

export const levelOut = (level: number): number => 1 + BAL.levelOut * (level - 1);
export const levelEnergy = (level: number): number => 1 + BAL.levelEnergy * (level - 1);

export function coderEff(debt: number): number {
  return 1 - BAL.debtLoss * (Math.min(100, Math.max(0, debt)) / 100);
}

export function cellName(x: number, y: number): string {
  return `${COLS[x] ?? '?'}${y + 1}`;
}

export function serialOf(b: Pick<Building, 'type' | 'id'>): string {
  return `${BUILDINGS[b.type].serial}-${String(b.id).padStart(3, '0')}`;
}

export function cellsOf(b: Pick<Building, 'type' | 'x' | 'y'>): Array<[number, number]> {
  const size = BUILDINGS[b.type].size;
  const out: Array<[number, number]> = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) out.push([b.x + dx, b.y + dy]);
  }
  return out;
}

/** Карта ячеек: индекс здания в s.buildings или −1. */
export function cellMap(s: Pick<GameState, 'buildings'>, ignoreId?: number): Int32Array {
  const map = new Int32Array(GRID * GRID).fill(-1);
  s.buildings.forEach((b, i) => {
    if (b.id === ignoreId) return;
    for (const [x, y] of cellsOf(b)) {
      if (x >= 0 && y >= 0 && x < GRID && y < GRID) map[y * GRID + x] = i;
    }
  });
  return map;
}

export function isCellOpen(s: Pick<GameState, 'research'>, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return false;
  if (hasResearch(s, 'expansion')) return true;
  return x >= START_MIN && x <= START_MAX && y >= START_MIN && y <= START_MAX;
}

export function openCellCount(s: Pick<GameState, 'research'>): number {
  return hasResearch(s, 'expansion') ? GRID * GRID : (START_MAX - START_MIN + 1) ** 2;
}

export function occupiedCells(s: Pick<GameState, 'buildings'>): number {
  let n = 0;
  for (const b of s.buildings) n += BUILDINGS[b.type].size ** 2;
  return n;
}

/** Ячейки снаружи здания, соседние с ним по стороне. */
export function neighborsOf(b: Pick<Building, 'type' | 'x' | 'y'>): Array<[number, number]> {
  const size = BUILDINGS[b.type].size;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < size; i++) {
    out.push([b.x + i, b.y - 1], [b.x + i, b.y + size], [b.x - 1, b.y + i], [b.x + size, b.y + i]);
  }
  return out.filter(([x, y]) => x >= 0 && y >= 0 && x < GRID && y < GRID);
}

/** Сколько соседей-поставщиков подают ресурсы напрямую (с учётом лимита). */
export function adjacencyCount(s: Pick<GameState, 'buildings'>, b: Building, map: Int32Array): number {
  const feeds = FEEDS[b.type];
  if (!feeds) return 0;
  const seen = new Set<number>();
  for (const [x, y] of neighborsOf(b)) {
    const j = map[y * GRID + x];
    if (j < 0) continue;
    const nb = s.buildings[j];
    if (nb && nb.enabled && feeds.includes(nb.type)) seen.add(nb.id);
  }
  return Math.min(BAL.adjMax, seen.size);
}

export function energyUse(b: Building, mods: Mods): number {
  if (b.type === 'reactor') return 0;
  let e = BUILDINGS[b.type].energy * levelEnergy(b.level);
  if (b.type === 'coder') e *= mods.coderEnergy;
  return e;
}

export function reactorGen(b: Building, mods: Mods): number {
  return b.type === 'reactor' ? BAL.reactorGen * levelOut(b.level) * mods.reactorMult : 0;
}

/** Номинальные потоки здания при 100% загрузке. */
export interface Rates {
  speed: number;
  adj: number;
  eff: number;
  energy: number;
  gen: number;
  computeOut: number;
  computeNeed: number;
  inData: number;
  inCode: number;
  inModels: number;
  outData: number;
  outCode: number;
  outModels: number;
  capBonus: number;
}

export function ratesOf(s: Pick<GameState, 'buildings'>, b: Building, mods: Mods, map: Int32Array): Rates {
  return ratesFor(b, mods, adjacencyCount(s, b, map));
}

export function ratesFor(b: Building, mods: Mods, adj: number): Rates {
  const lv = levelOut(b.level);
  const speed = PRODUCTION_TYPES.has(b.type) ? 1 + mods.speed + BAL.adjBonus * adj : 1;
  const r: Rates = {
    speed,
    adj,
    eff: 1,
    energy: energyUse(b, mods),
    gen: 0,
    computeOut: 0,
    computeNeed: 0,
    inData: 0,
    inCode: 0,
    inModels: 0,
    outData: 0,
    outCode: 0,
    outModels: 0,
    capBonus: 0,
  };
  switch (b.type) {
    case 'reactor':
      r.gen = reactorGen(b, mods);
      break;
    case 'miner':
      r.outData = BAL.minerOut * lv * speed * mods.minerMult;
      break;
    case 'coder':
      r.eff = coderEff(b.debt);
      r.inData = BAL.coderIn * lv * speed;
      r.outCode = BAL.coderOut * lv * speed * r.eff;
      break;
    case 'gpu':
      r.computeOut = BAL.gpuOut * lv * mods.gpuMult;
      break;
    case 'trainer':
      r.inData = BAL.trainerData * lv * speed * mods.trainerInput;
      r.inCode = BAL.trainerCode * lv * speed * mods.trainerInput;
      r.computeNeed = BAL.trainerCompute * lv * speed;
      r.outModels = BAL.trainerOut * lv * speed;
      break;
    case 'publisher':
      r.inModels = BAL.publisherIn * lv * speed;
      break;
    case 'agi':
      r.inModels = BAL.agiIn * lv * speed;
      r.computeNeed = BAL.agiCompute * lv * speed;
      break;
    case 'storage':
      r.capBonus = BAL.storageBonus * lv;
      break;
  }
  return r;
}

export function getCaps(s: Pick<GameState, 'buildings'>, mods: Mods): Record<ResKey, number> {
  let bonus = 0;
  for (const b of s.buildings) {
    if (b.type === 'storage' && b.enabled) bonus += BAL.storageBonus * levelOut(b.level);
  }
  const m = (1 + bonus) * mods.capMult;
  return {
    data: BAL.baseCaps.data * m,
    code: BAL.baseCaps.code * m,
    models: BAL.baseCaps.models * m,
  };
}

export function countType(s: Pick<GameState, 'buildings'>, type: BuildingType): number {
  let n = 0;
  for (const b of s.buildings) if (b.type === type) n++;
  return n;
}

export function buildCost(s: Pick<GameState, 'buildings'>, type: BuildingType): number {
  const def = BUILDINGS[type];
  return Math.round(def.cost * Math.pow(def.growth, countType(s, type)));
}

export function upgradeCost(b: Pick<Building, 'type' | 'level'>): number {
  const def = BUILDINGS[b.type];
  return Math.round(def.cost * BAL.upgradeMult * Math.pow(BAL.upgradeGrowth, b.level - 1));
}

export function refundOf(b: Pick<Building, 'invested'>): number {
  return Math.round(b.invested * BAL.refund);
}

export function refactorCostOf(b: Pick<Building, 'debt' | 'level'>, discount = 1): number {
  return b.debt * BAL.refactorPerPoint * levelOut(b.level) * discount;
}

export function refactorCost(s: Pick<GameState, 'buildings'>, discount = 1): number {
  let c = 0;
  for (const b of s.buildings) if (b.type === 'coder') c += refactorCostOf(b, discount);
  return Math.ceil(c);
}

export function totalDebt(s: Pick<GameState, 'buildings'>): { avg: number; max: number; count: number } {
  let sum = 0;
  let max = 0;
  let count = 0;
  for (const b of s.buildings) {
    if (b.type !== 'coder') continue;
    sum += b.debt;
    max = Math.max(max, b.debt);
    count++;
  }
  return { avg: count ? sum / count : 0, max, count };
}

export function marketMult(s: Pick<GameState, 'market' | 'tick'>): number {
  const m = s.market;
  const wave = 1 + 0.1 * Math.sin((2 * Math.PI * s.tick) / 360 + m.phase);
  const ev = m.event && m.event.kind === 'price' ? m.event.factor : 1;
  return m.index * wave * ev;
}

export function modelPrice(s: Pick<GameState, 'market' | 'tick'>, mods: Mods): number {
  return BAL.price.model * marketMult(s) * mods.priceMult;
}

export function exchangePrice(s: Pick<GameState, 'market' | 'tick'>, res: SellableRes): number {
  return BAL.price[res] * marketMult(s);
}

/** Сглаженный пассивный доход за последние n тиков (по умолчанию 10 с). */
export function avgIncome(s: Pick<GameState, 'incomeHistory'>, n = 10): number {
  const h = s.incomeHistory;
  if (h.length === 0) return 0;
  const k = Math.min(n, h.length);
  let sum = 0;
  for (let i = h.length - k; i < h.length; i++) sum += h[i];
  return sum / k;
}

/**
 * Куда поставить здание, если игрок кликнул по ячейке (x, y).
 * Для блока 2×2 перебираются все четыре варианта, где клик — один из углов.
 */
export function findPlacement(
  s: Pick<GameState, 'buildings' | 'research'>,
  type: BuildingType,
  x: number,
  y: number,
  ignoreId?: number,
): { x: number; y: number } | null {
  const size = BUILDINGS[type].size;
  const map = cellMap(s, ignoreId);
  const candidates: Array<[number, number]> =
    size === 1
      ? [[x, y]]
      : [
          [x, y],
          [x - 1, y],
          [x, y - 1],
          [x - 1, y - 1],
        ];
  for (const [cx, cy] of candidates) {
    let fits = true;
    for (let dy = 0; dy < size && fits; dy++) {
      for (let dx = 0; dx < size && fits; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (!isCellOpen(s, px, py) || map[py * GRID + px] !== -1) fits = false;
      }
    }
    if (fits) return { x: cx, y: cy };
  }
  return null;
}
