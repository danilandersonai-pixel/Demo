// Сохранение в localStorage. Все обращения обёрнуты в try/catch: в приватном
// режиме или в песочнице хранилище может быть недоступно — игра тогда просто
// работает без сохранений.

import { BAL, BUILDINGS, GRID, RESEARCH } from './config';
import { computeFlow, createState } from './engine';
import { GOALS } from './goals';
import { newSeed } from './rng';
import { cellsOf, isCellOpen } from './selectors';
import { defaultRecords, sanitizeRecords, type Records } from './records';
import type { Building, BuildingType, GameState, LogEntry, LogKind, ResearchId } from './types';

const SAVE_KEY = 'ai-factory:save:v1';
const RECORDS_KEY = 'ai-factory:records:v1';
const PREFS_KEY = 'ai-factory:prefs:v1';

export type RightTab = 'research' | 'market' | 'records';

export interface Prefs {
  speed: number;
  welcomed: boolean;
  tab: RightTab;
}

const DEFAULT_PREFS: Prefs = { speed: 1, welcomed: false, tab: 'research' };

function storage(): Storage | null {
  try {
    const ls = window.localStorage;
    const probe = '__ai_factory_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

export function storageAvailable(): boolean {
  return storage() !== null;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* хранилище недоступно — удалять нечего */
  }
}

export function serialize(s: GameState): string {
  const { flow: _flow, ...rest } = s;
  return JSON.stringify(rest);
}

const finite = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const nonNeg = (v: unknown, fb: number): number => Math.max(0, finite(v, fb));

const LOG_KINDS: ReadonlySet<LogKind> = new Set(['info', 'build', 'research', 'market', 'alert', 'record', 'goal']);

/** Восстанавливает состояние из JSON, отбрасывая всё битое и неизвестное. */
export function deserialize(raw: string): GameState | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || o.v !== 1 || !Array.isArray(o.buildings)) return null;

  const seed = finite(o.rng, newSeed()) >>> 0;
  const s = createState(seed, finite(o.createdAt, Date.now()));
  s.rng = seed;
  s.log = [];
  s.tick = Math.floor(nonNeg(o.tick, 0));
  s.credits = nonNeg(o.credits, BAL.startCredits);
  const res = (o.res ?? {}) as Record<string, unknown>;
  s.res = { data: nonNeg(res.data, 0), code: nonNeg(res.code, 0), models: nonNeg(res.models, 0) };

  const research = (o.research ?? {}) as { done?: unknown; active?: unknown };
  const done = Array.isArray(research.done)
    ? (research.done.filter((id) => typeof id === 'string' && id in RESEARCH) as ResearchId[])
    : [];
  s.research.done = [...new Set(done)];
  const active = research.active as { id?: unknown; paid?: unknown } | null | undefined;
  if (active && typeof active.id === 'string' && active.id in RESEARCH && !s.research.done.includes(active.id as ResearchId)) {
    s.research.active = { id: active.id as ResearchId, paid: nonNeg(active.paid, 0) };
  }

  // Здания: проверяем тип, координаты, уровень и пересечения.
  const occupied = new Set<number>();
  let maxId = 0;
  const buildings: Building[] = [];
  for (const item of o.buildings as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Record<string, unknown>;
    if (typeof b.type !== 'string' || !(b.type in BUILDINGS)) continue;
    const type = b.type as BuildingType;
    const cand: Building = {
      id: Math.floor(finite(b.id, 0)),
      type,
      x: Math.floor(finite(b.x, -1)),
      y: Math.floor(finite(b.y, -1)),
      level: Math.min(BAL.maxLevel, Math.max(1, Math.floor(finite(b.level, 1)))),
      enabled: b.enabled !== false,
      debt: type === 'coder' ? Math.min(100, nonNeg(b.debt, 0)) : 0,
      invested: nonNeg(b.invested, BUILDINGS[type].cost),
      acc: Math.min(1, nonNeg(b.acc, 0)),
      // В старых сохранениях поля нет — такие узлы уже засчитаны в рекорд.
      work: Math.min(BAL.commissionTicks, Math.floor(nonNeg(b.work, BAL.commissionTicks))),
    };
    if (cand.id <= 0 || buildings.some((x) => x.id === cand.id)) continue;
    const cells = cellsOf(cand);
    const fits = cells.every(([x, y]) => isCellOpen(s, x, y) && !occupied.has(y * GRID + x));
    if (!fits) continue;
    cells.forEach(([x, y]) => occupied.add(y * GRID + x));
    buildings.push(cand);
    maxId = Math.max(maxId, cand.id);
  }
  s.buildings = buildings;
  s.nextId = Math.max(maxId + 1, Math.floor(finite(o.nextId, 1)));

  const market = (o.market ?? {}) as Record<string, unknown>;
  s.market.index = Math.min(1.35, Math.max(0.7, finite(market.index, 1)));
  s.market.phase = finite(market.phase, s.market.phase);
  s.market.nextEventAt = Math.floor(nonNeg(market.nextEventAt, s.tick + 120));
  const ev = market.event as Record<string, unknown> | null | undefined;
  if (ev && typeof ev.name === 'string' && (ev.kind === 'price' || ev.kind === 'grid')) {
    s.market.event = {
      id: String(ev.id ?? 'event'),
      name: ev.name,
      desc: String(ev.desc ?? ''),
      kind: ev.kind,
      factor: Math.min(3, Math.max(0.1, finite(ev.factor, 1))),
      startedAt: Math.floor(nonNeg(ev.startedAt, s.tick)),
      endsAt: Math.floor(nonNeg(ev.endsAt, s.tick)),
    };
  }
  s.market.history = Array.isArray(market.history)
    ? (market.history.filter((v) => typeof v === 'number' && Number.isFinite(v)) as number[]).slice(-BAL.historyLen)
    : [];

  const auto = (o.autoSell ?? {}) as Record<string, unknown>;
  s.autoSell = { data: auto.data !== false, code: auto.code !== false };

  const st = (o.stats ?? {}) as Record<string, unknown>;
  s.stats = {
    earned: nonNeg(st.earned, 0),
    manualSales: nonNeg(st.manualSales, 0),
    dataMined: nonNeg(st.dataMined, 0),
    codeWritten: nonNeg(st.codeWritten, 0),
    modelsTrained: nonNeg(st.modelsTrained, 0),
    modelsSold: nonNeg(st.modelsSold, 0),
    built: Math.floor(nonNeg(st.built, 0)),
    refactors: Math.floor(nonNeg(st.refactors, 0)),
    autoRefactors: Math.floor(nonNeg(st.autoRefactors, 0)),
    blackoutTicks: Math.floor(nonNeg(st.blackoutTicks, 0)),
    commissioned: Math.floor(
      nonNeg(st.commissioned, s.buildings.filter((b) => b.work >= BAL.commissionTicks).length),
    ),
    agiBuiltAt: typeof st.agiBuiltAt === 'number' ? st.agiBuiltAt : null,
  };

  s.incomeHistory = Array.isArray(o.incomeHistory)
    ? (o.incomeHistory.filter((v) => typeof v === 'number' && Number.isFinite(v)) as number[]).slice(-BAL.historyLen)
    : [];
  const goalIds = new Set(GOALS.map((g) => g.id));
  s.goals = Array.isArray(o.goals) ? [...new Set(o.goals.filter((g) => typeof g === 'string' && goalIds.has(g)) as string[])] : [];

  s.log = Array.isArray(o.log)
    ? (o.log as unknown[])
        .filter((e): e is LogEntry => {
          const x = e as LogEntry;
          return (
            !!x &&
            typeof x.text === 'string' &&
            Number.isFinite(x.t) &&
            Number.isFinite(x.id) &&
            LOG_KINDS.has(x.kind)
          );
        })
        .slice(-BAL.logLen)
    : [];
  s.logSeq = Math.max(Math.floor(nonNeg(o.logSeq, 0)), ...s.log.map((e) => e.id), 0);
  s.lastPowerNotice = finite(o.lastPowerNotice, -100);
  s.savedAt = finite(o.savedAt, Date.now());
  s.flow = computeFlow(s);
  return s;
}

export function loadGame(): GameState | null {
  const raw = read(SAVE_KEY);
  return raw ? deserialize(raw) : null;
}

export function hasSave(): boolean {
  return read(SAVE_KEY) !== null;
}

export function saveGame(s: GameState): boolean {
  return write(SAVE_KEY, serialize(s));
}

export function clearGame(): void {
  remove(SAVE_KEY);
}

export function loadRecords(): Records {
  const raw = read(RECORDS_KEY);
  if (!raw) return defaultRecords();
  try {
    return sanitizeRecords(JSON.parse(raw));
  } catch {
    return defaultRecords();
  }
}

export function saveRecords(r: Records): boolean {
  return write(RECORDS_KEY, JSON.stringify(r));
}

export function loadPrefs(): Prefs {
  const raw = read(PREFS_KEY);
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      speed: [0, 1, 2, 4].includes(p.speed as number) ? (p.speed as number) : 1,
      welcomed: p.welcomed === true,
      tab: p.tab === 'market' || p.tab === 'records' || p.tab === 'research' ? p.tab : 'research',
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): boolean {
  return write(PREFS_KEY, JSON.stringify(p));
}
