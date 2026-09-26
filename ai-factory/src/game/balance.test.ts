// Балансовая симуляция: «средний толковый игрок»-бот два игровых часа строит
// фабрику по узким местам, ведёт исследования и чистит техдолг. Тест печатает
// темп прогресса и падает, если баланс заметно уехал.

import { describe, expect, it } from 'vitest';
import { BAL, BUILDINGS, GRID, RESEARCH } from './config';
import { build, createState, demolish, refactor, researchBlocker, startResearch, step, toggle, upgrade } from './engine';
import {
  avgIncome,
  cellMap,
  countType,
  energyUse,
  findPlacement,
  getMods,
  isCellOpen,
  neighborsOf,
  ratesOf,
  buildCost,
  refactorCost,
  totalDebt,
  upgradeCost,
} from './selectors';
import { FEEDS } from './config';
import type { BuildingType, GameState, ResearchId } from './types';

const BOT_RESEARCH: ResearchId[] = [
  'conveyor',
  'softRefactor',
  'smartGrid',
  'coldStorage',
  'expansion',
  'synthData',
  'tensorCores',
  'codeReview',
  'viral',
  'fusion',
  'distill',
  'cicd',
  'hyper',
  'transformers',
  'singularity',
];

/** Два угловых блока 2×2 бот держит пустыми под будущие AGI. */
const RESERVED = new Set<number>([0, 1, GRID, GRID + 1, 6, 7, GRID + 6, GRID + 7]);

function nominal(s: GameState) {
  const mods = getMods(s);
  const map = cellMap(s);
  const n = {
    dataSup: 0,
    dataDem: 0,
    codeSup: 0,
    codeDem: 0,
    compSup: 0,
    compDem: 0,
    modSup: 0,
    modDem: 0,
    agiDem: 0,
    minerOut: 0,
    coderOut: 0,
  };
  for (const b of s.buildings) {
    if (!b.enabled) continue;
    const r = ratesOf(s, b, mods, map);
    n.dataSup += r.outData;
    n.dataDem += r.inData;
    n.codeSup += r.outCode;
    n.codeDem += r.inCode;
    n.compSup += r.computeOut;
    n.compDem += r.computeNeed;
    n.modSup += r.outModels;
    n.modDem += r.inModels;
    if (b.type === 'agi') n.agiDem += r.inModels;
    if (b.type === 'miner') n.minerOut = Math.max(n.minerOut, r.outData);
    if (b.type === 'coder') n.coderOut = Math.max(n.coderOut, r.outCode);
  }
  // Исследованию бот отдаёт примерно четверть его полного аппетита.
  const act = s.research.active;
  if (act) n.codeDem += (RESEARCH[act.id].code / RESEARCH[act.id].time) * 0.25;
  return n;
}

function placeScore(s: GameState, type: BuildingType, x: number, y: number, map: Int32Array): number {
  let score = 0;
  for (const [nx, ny] of neighborsOf({ type, x, y })) {
    const j = map[ny * GRID + nx];
    if (j < 0) continue;
    const nb = s.buildings[j];
    if (FEEDS[type]?.includes(nb.type)) score += 2;
    if (FEEDS[nb.type]?.includes(type)) score += 2;
  }
  return score;
}

function bestCell(s: GameState, type: BuildingType): { x: number; y: number } | null {
  const map = cellMap(s);
  if (BUILDINGS[type].size === 2) {
    for (const [x, y] of [
      [0, 0],
      [6, 0],
    ]) {
      const p = findPlacement(s, type, x, y);
      if (p && p.x === x && p.y === y) return p;
    }
    return null;
  }
  let best: { x: number; y: number } | null = null;
  let bestScore = -1;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const i = y * GRID + x;
      if (RESERVED.has(i) || map[i] !== -1 || !isCellOpen(s, x, y)) continue;
      const sc = placeScore(s, type, x, y, map);
      if (sc > bestScore) {
        bestScore = sc;
        best = { x, y };
      }
    }
  }
  return best;
}

function tryBuild(s: GameState, type: BuildingType): 'ok' | 'nospace' | 'nomoney' {
  const cell = bestCell(s, type);
  if (!cell) return 'nospace';
  return build(s, type, cell.x, cell.y).ok ? 'ok' : 'nomoney';
}

function lowestLevel(s: GameState, type: BuildingType) {
  return s.buildings.filter((b) => b.type === type && b.level < BAL.maxLevel).sort((a, b) => a.level - b.level)[0];
}

function energyOf(s: GameState, type: BuildingType): number {
  const mods = getMods(s);
  return energyUse({ id: 0, type, x: 0, y: 0, level: 1, enabled: true, debt: 0, invested: 0, acc: 0, work: 0 }, mods);
}

/** Прибавка нагрузки от улучшения здания на один уровень. */
function upgradeEnergy(s: GameState, type: BuildingType): number {
  return energyOf(s, type) * 0.3;
}

/**
 * Следит за запасом мощности перед действием, которому нужно extra МВт.
 * 'ok' — можно действовать, 'acted' — бот построил/улучшил реактор, 'wait' — копим.
 */
function ensureEnergy(s: GameState, extra: number): 'ok' | 'acted' | 'wait' {
  const f = s.flow;
  if (f.gen - f.load >= extra + 1) return 'ok';
  const r = tryBuild(s, 'reactor');
  if (r === 'ok') return 'acted';
  if (r === 'nomoney') return 'wait';
  const reactor = lowestLevel(s, 'reactor');
  if (reactor && s.credits >= upgradeCost(reactor)) return upgrade(s, reactor.id).ok ? 'acted' : 'wait';
  return 'wait';
}

function need(s: GameState): BuildingType {
  const n = nominal(s);
  if (countType(s, 'trainer') === 0) {
    if (countType(s, 'miner') < 4) return 'miner';
    if (countType(s, 'coder') < 2) return 'coder';
    if (countType(s, 'gpu') < 1) return 'gpu';
    return 'trainer';
  }
  if (n.modSup > n.modDem + 1e-9) return 'publisher';
  if (n.compDem > n.compSup + 1e-9) return 'gpu';
  if (n.codeDem * 1.1 > n.codeSup) return 'coder';
  if (n.dataDem * 1.05 > n.dataSup) return 'miner';
  return 'trainer';
}

/** Одно решение бота за тик. Возвращает true, если что-то сделал. */
function botAct(s: GameState): boolean {
  const mods = getMods(s);
  // 1. Техдолг, пока нет CI/CD.
  if (!mods.autoRefactor) {
    const d = totalDebt(s);
    const cost = refactorCost(s);
    if (d.avg >= 45 && cost > 0 && cost <= s.credits * 0.3) return refactor(s).ok;
  }
  // 2. Исследования по очереди, как только хватает денег.
  if (!s.research.active) {
    const next = BOT_RESEARCH.find((id) => !s.research.done.includes(id) && RESEARCH[id].requires.every((r) => s.research.done.includes(r)));
    if (next && !researchBlocker(s, next)) return startResearch(s, next).ok;
  }
  // 3. Когда AGI справляется со всеми моделями, терминалы SaaS отключаем.
  const n = nominal(s);
  if (n.agiDem >= n.modSup && n.agiDem > 0) {
    const pub = s.buildings.find((b) => b.type === 'publisher' && b.enabled);
    if (pub) return toggle(s, pub.id).ok;
  }
  // 4. AGI — главный приоритет, как только он открыт и есть площадка.
  if (mods.agiUnlocked && bestCell(s, 'agi')) {
    if (s.credits < buildCost(s, 'agi')) return false;
    const e = ensureEnergy(s, energyOf(s, 'agi'));
    if (e !== 'ok') return e === 'acted';
    return tryBuild(s, 'agi') === 'ok';
  }
  // 5. Узкое место цепочки: строим, а если места нет — улучшаем или сносим лишнее.
  const want = need(s);
  const cell = bestCell(s, want);
  if (cell) {
    const e = ensureEnergy(s, energyOf(s, want));
    if (e !== 'ok') return e === 'acted';
    return build(s, want, cell.x, cell.y).ok;
  }
  const target = lowestLevel(s, want);
  if (target) {
    if (s.credits < upgradeCost(target)) return false;
    const e = ensureEnergy(s, upgradeEnergy(s, want));
    if (e !== 'ok') return e === 'acted';
    return upgrade(s, target.id).ok;
  }
  // Всё нужное на Mk.V, а места нет: освобождаем ячейку от излишков.
  const victim = surplus(s, n);
  if (victim) return demolish(s, victim.id).ok;
  return false;
}

/** Здание, без которого фабрика обойдётся: лишний генератор, кодер или терминал. */
function surplus(s: GameState, n: ReturnType<typeof nominal>) {
  const byLevel = (type: BuildingType) =>
    s.buildings.filter((b) => b.type === type).sort((a, b) => a.level - b.level)[0];
  if (n.dataSup - n.dataDem > n.minerOut * 1.2) return byLevel('miner');
  if (n.codeSup - n.codeDem > n.coderOut * 1.2) return byLevel('coder');
  const pub = s.buildings.find((b) => b.type === 'publisher' && !b.enabled);
  if (pub) return pub;
  return undefined;
}

interface Report {
  seed: number;
  firstSale: number | null;
  firstResearch: number | null;
  inc100: number | null;
  expansion: number | null;
  inc1k: number | null;
  agi: number | null;
  inc10k: number | null;
  allResearch: number | null;
  incomeAt: Record<number, number>;
  finalBuildings: number;
  blackoutTicks: number;
  goals: number;
  maxIncome: number;
  agiCount: number;
}

function run(seed: number, minutes: number): Report {
  const s = createState(seed, 0);
  const rep: Report = {
    seed,
    firstSale: null,
    firstResearch: null,
    inc100: null,
    expansion: null,
    inc1k: null,
    agi: null,
    inc10k: null,
    allResearch: null,
    incomeAt: {},
    finalBuildings: 0,
    blackoutTicks: 0,
    goals: 0,
    maxIncome: 0,
    agiCount: 0,
  };
  const checkpoints = new Set([5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 180]);
  for (let t = 1; t <= minutes * 60; t++) {
    for (let k = 0; k < 4 && botAct(s); k++) {
      /* бот делает до четырёх действий за тик */
    }
    step(s);
    const inc = avgIncome(s, 10);
    rep.maxIncome = Math.max(rep.maxIncome, inc);
    const min = t / 60;
    if (rep.firstSale === null && s.stats.modelsSold >= 1) rep.firstSale = min;
    if (rep.firstResearch === null && s.research.done.length > 0) rep.firstResearch = min;
    if (rep.inc100 === null && inc >= 100) rep.inc100 = min;
    if (rep.expansion === null && s.research.done.includes('expansion')) rep.expansion = min;
    if (rep.inc1k === null && inc >= 1000) rep.inc1k = min;
    if (rep.agi === null && countType(s, 'agi') > 0) rep.agi = min;
    if (rep.inc10k === null && inc >= 10000) rep.inc10k = min;
    if (rep.allResearch === null && s.research.done.length === Object.keys(RESEARCH).length) rep.allResearch = min;
    if (t % 60 === 0 && checkpoints.has(t / 60)) rep.incomeAt[t / 60] = Math.round(inc);
  }
  rep.finalBuildings = s.buildings.length;
  rep.blackoutTicks = s.stats.blackoutTicks;
  rep.goals = s.goals.length;
  rep.agiCount = countType(s, 'agi');
  return rep;
}

const fmt = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} мин`);

describe('баланс', () => {
  it('темп прогресса укладывается в задуманную дугу', () => {
    const reports = [101, 202, 303].map((seed) => run(seed, 180));
    for (const r of reports) {
      console.log(
        [
          `seed ${r.seed}:`,
          `первая продажа ${fmt(r.firstSale)}`,
          `первое исследование ${fmt(r.firstResearch)}`,
          `$100/с ${fmt(r.inc100)}`,
          `8×8 ${fmt(r.expansion)}`,
          `$1k/с ${fmt(r.inc1k)}`,
          `AGI ${fmt(r.agi)}`,
          `$10k/с ${fmt(r.inc10k)}`,
          `всё изучено ${fmt(r.allResearch)}`,
          `\n  доход по минутам: ${Object.entries(r.incomeAt)
            .map(([m, v]) => `${m}м=$${v}`)
            .join(' ')}`,
          `\n  зданий ${r.finalBuildings} (AGI ${r.agiCount}), блэкаут ${r.blackoutTicks} с, контрактов ${r.goals}, пик $${Math.round(r.maxIncome)}/с`,
        ].join(' '),
      );
    }
    for (const r of reports) {
      expect(r.firstSale).not.toBeNull();
      // Первая продажа — в первые минуты, но не мгновенно.
      expect(r.firstSale!).toBeGreaterThan(0.5);
      expect(r.firstSale!).toBeLessThan(4);
      expect(r.firstResearch!).toBeLessThan(10);
      expect(r.expansion!).toBeLessThan(45);
      // AGI — кульминация: не раньше 45-й минуты и не позже двух с небольшим часов.
      expect(r.agi).not.toBeNull();
      expect(r.agi!).toBeGreaterThan(45);
      expect(r.agi!).toBeLessThan(130);
      expect(r.incomeAt[180]).toBeGreaterThan(5000);
      // Всё дерево, включая «Сингулярность», — цель больше чем на два часа.
      if (r.allResearch !== null) expect(r.allResearch).toBeGreaterThan(120);
    }
  }, 120000);
});
