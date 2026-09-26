// Сохранение в localStorage. Забег и рекорды лежат под разными ключами:
// «Новая игра» стирает забег, но Зал славы остаётся.
// Любое чтение/запись обёрнуто в try/catch — в приватном окне хранилище может быть недоступно.
//
// Несколько вкладок: сейв помечается идентификатором вкладки-владельца. Рекорды при записи
// сливаются с уже сохранёнными (лучшие значения побеждают), поэтому забытая вкладка
// не может откатить Зал славы.

import { DECISION_WINDOW, GRID_CELLS, GRID_ROWS, MAX_LEVEL, RESEARCH, SAVE_VERSION, START_ROWS, BUILDINGS } from './config.ts';
import { computeEconomy } from './economy.ts';
import { createInitialState, emptyCell, emptyRecords } from './engine.ts';
import { EVENTS } from './events.ts';
import type {
  BuildingId,
  Cell,
  DecisionOption,
  EventRecord,
  GameState,
  LogEntry,
  Modifier,
  ModTarget,
  PendingDecision,
  Records,
  ResearchId,
  RunSummary,
  TickReport,
} from './types.ts';

export const SAVE_KEY = 'cybernet-neon-syndicate:save:v1';
export const RECORDS_KEY = 'cybernet-neon-syndicate:records:v1';

type Json = Record<string, unknown>;

const MOD_TARGETS: ModTarget[] = ['energyProd', 'solarOutput', 'energyUse', 'minerOutput', 'creditOutput', 'dataOutput', 'dataPrice', 'upkeep'];
const TONES = ['info', 'success', 'warning', 'danger', 'event', 'system'] as const;
const CATEGORIES = ['build', 'economy', 'research', 'event', 'system'] as const;
const OPTION_TONES = ['safe', 'risky', 'danger', 'neutral'] as const;
/** Разумный потолок для любых сумм — защищает от Infinity и 1e308 в подправленных сейвах. */
const MAX_AMOUNT = 1e12;

function isObj(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number, min = -MAX_AMOUNT, max = MAX_AMOUNT): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function int(value: unknown, fallback: number, min = -MAX_AMOUNT, max = MAX_AMOUNT): number {
  return Math.floor(num(value, fallback, min, max));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function numList(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const list = value
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .map((v) => Math.min(MAX_AMOUNT, Math.max(-MAX_AMOUNT, v)));
  return list.length ? list.slice(-60) : fallback;
}

function readRaw(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: unknown): boolean {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function sanitizeRecords(raw: unknown): Records {
  if (!isObj(raw)) return emptyRecords();
  const runs: RunSummary[] = Array.isArray(raw.runs)
    ? raw.runs.filter(isObj).slice(0, 8).map((r) => ({
        runId: int(r.runId, 0, 0),
        days: int(r.days, 0, 0),
        peakCapital: int(r.peakCapital, 0, 0),
        researchDone: int(r.researchDone, 0, 0),
        built: int(r.built, 0, 0),
        endedAt: num(r.endedAt, 0, 0),
        cause: r.cause === 'reset' ? 'reset' : 'bankrupt',
      }))
    : [];
  return {
    bestDays: int(raw.bestDays, 0, 0),
    bestCapital: int(raw.bestCapital, 0, 0),
    totalRuns: int(raw.totalRuns, 0, 0),
    runs,
    epoch: num(raw.epoch, 0, 0),
  };
}

/**
 * Слияние рекордов двух вкладок. Если одна из них позже очищала Зал славы — побеждает она,
 * иначе берутся лучшие значения и объединяются забеги.
 */
export function mergeRecords(mine: Records, stored: Records): Records {
  if (stored.epoch > mine.epoch) return { ...stored, totalRuns: Math.max(stored.totalRuns, mine.totalRuns) };
  if (mine.epoch > stored.epoch) return { ...mine, totalRuns: Math.max(stored.totalRuns, mine.totalRuns) };
  const seen = new Set<string>();
  const runs = [...mine.runs, ...stored.runs]
    .filter((run) => {
      const key = `${run.runId}:${run.endedAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.days - a.days || b.peakCapital - a.peakCapital)
    .slice(0, 8);
  return {
    bestDays: Math.max(mine.bestDays, stored.bestDays),
    bestCapital: Math.max(mine.bestCapital, stored.bestCapital),
    totalRuns: Math.max(mine.totalRuns, stored.totalRuns),
    runs,
    epoch: mine.epoch,
  };
}

function sanitizeCell(raw: unknown): Cell {
  if (!isObj(raw) || typeof raw.type !== 'string' || !(raw.type in BUILDINGS)) return emptyCell();
  return {
    uid: int(raw.uid, 1, 1),
    type: raw.type as BuildingId,
    level: int(raw.level, 1, 1, MAX_LEVEL),
    enabled: raw.enabled !== false,
    invested: num(raw.invested, 0, 0),
    builtDay: int(raw.builtDay, 0, 0),
  };
}

function sanitizeModifiers(raw: unknown, day: number): Modifier[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .filter((m) => typeof m.eventId === 'string' && m.eventId in EVENTS && typeof m.label === 'string')
    .map((m, i) => ({
      id: int(m.id, i + 1, 1),
      eventId: m.eventId as Modifier['eventId'],
      label: String(m.label).slice(0, 80),
      target: oneOf(m.target, MOD_TARGETS, 'energyProd'),
      value: num(m.value, 0, -1, 2),
      startDay: int(m.startDay, day, 0, day),
      endsDay: int(m.endsDay, day, 0, day + 60),
    }))
    .filter((m) => MOD_TARGETS.includes(m.target) && m.endsDay >= day);
}

function sanitizeOption(raw: unknown): DecisionOption | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.label !== 'string') return null;
  const cost = isObj(raw.cost) ? raw.cost : {};
  return {
    id: raw.id,
    label: raw.label.slice(0, 80),
    detail: typeof raw.detail === 'string' ? raw.detail.slice(0, 400) : '',
    tone: oneOf(raw.tone, OPTION_TONES, 'neutral'),
    cost: { credits: num(cost.credits, 0, 0), data: num(cost.data, 0, 0) },
  };
}

function sanitizePending(raw: unknown, day: number): PendingDecision | null {
  if (!isObj(raw) || typeof raw.eventId !== 'string' || !(raw.eventId in EVENTS)) return null;
  if (!Array.isArray(raw.options) || !isObj(raw.ctx) || typeof raw.defaultOption !== 'string') return null;
  const options = raw.options.map(sanitizeOption).filter((o): o is DecisionOption => o !== null);
  if (!options.some((o) => o.id === raw.defaultOption)) return null;
  const ctx: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw.ctx)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    ctx[key] = Math.min(MAX_AMOUNT, Math.max(-MAX_AMOUNT, value));
  }
  const startDay = int(raw.startDay, day, 0, day);
  return {
    eventId: raw.eventId as PendingDecision['eventId'],
    title: typeof raw.title === 'string' ? raw.title.slice(0, 80) : EVENTS[raw.eventId as keyof typeof EVENTS].title,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 400) : '',
    options,
    defaultOption: raw.defaultOption,
    startDay,
    expiresDay: int(raw.expiresDay, day + DECISION_WINDOW, day, day + DECISION_WINDOW),
    ctx,
    resumeSpeed: raw.resumeSpeed === 2 || raw.resumeSpeed === 4 ? raw.resumeSpeed : 0,
  };
}

function sanitizeLog(raw: unknown, fallback: LogEntry[]): LogEntry[] {
  if (!Array.isArray(raw)) return fallback;
  return raw
    .filter(isObj)
    .filter((e) => typeof e.text === 'string' && typeof e.id === 'number' && Number.isFinite(e.id))
    .slice(-160)
    .map((e) => ({
      id: Math.floor(e.id as number),
      day: int(e.day, 0, 0),
      text: String(e.text).slice(0, 300),
      tone: oneOf(e.tone, TONES, 'info'),
      category: oneOf(e.category, CATEGORIES, 'system'),
    }));
}

function sanitizeEventHistory(raw: unknown): EventRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .filter((e) => typeof e.eventId === 'string' && e.eventId in EVENTS && typeof e.outcome === 'string')
    .slice(0, 12)
    .map((e, i) => ({
      id: int(e.id, i, 0),
      day: int(e.day, 0, 0),
      eventId: e.eventId as EventRecord['eventId'],
      title: typeof e.title === 'string' ? e.title.slice(0, 80) : EVENTS[e.eventId as keyof typeof EVENTS].title,
      outcome: String(e.outcome).slice(0, 300),
      tone: oneOf(e.tone, TONES, 'info'),
    }));
}

function sanitizeLastTick(raw: unknown): TickReport | null {
  if (!isObj(raw) || !isObj(raw.credits) || !isObj(raw.data) || !isObj(raw.energy)) return null;
  const c = raw.credits;
  const d = raw.data;
  const e = raw.energy;
  return {
    day: int(raw.day, 0, 0),
    credits: {
      production: num(c.production, 0),
      export: num(c.export, 0),
      broker: num(c.broker, 0),
      upkeep: num(c.upkeep, 0),
      overhead: num(c.overhead, 0),
      wealth: num(c.wealth, 0),
      net: num(c.net, 0),
    },
    data: { production: num(d.production, 0), sold: num(d.sold, 0), overflow: num(d.overflow, 0), net: num(d.net, 0) },
    energy: {
      production: num(e.production, 0),
      consumption: num(e.consumption, 0),
      net: num(e.net, 0),
      exported: num(e.exported, 0),
      powerRatio: num(e.powerRatio, 1, 0, 1),
    },
  };
}

/**
 * Восстанавливает сохранённый забег. Неизвестные или битые поля заменяются значениями
 * по умолчанию, а совсем нечитаемый сейв даёт null (начнётся новая игра).
 */
export function sanitizeState(raw: unknown, records: Records, now: number, seed: number): GameState | null {
  if (!isObj(raw) || raw.version !== SAVE_VERSION || !Array.isArray(raw.grid)) return null;
  try {
    const base = createInitialState(seed, now, records);
    const day = int(raw.day, 0, 0, 1e7);
    const grid = Array.from({ length: GRID_CELLS }, (_, i) => sanitizeCell((raw.grid as unknown[])[i]));
    const research = isObj(raw.research) ? raw.research : {};
    const done = Array.isArray(research.done)
      ? (research.done.filter((id) => typeof id === 'string' && id in RESEARCH) as ResearchId[])
      : [];
    const active =
      typeof research.active === 'string' && research.active in RESEARCH && !done.includes(research.active as ResearchId)
        ? (research.active as ResearchId)
        : null;
    const market = isObj(raw.market) ? raw.market : {};
    const history = isObj(raw.history) ? raw.history : {};
    const stats = isObj(raw.stats) ? raw.stats : {};
    const settings = isObj(raw.settings) ? raw.settings : {};
    const baseline = isObj(raw.baseline) ? raw.baseline : {};
    const flags = isObj(raw.recordFlags) ? raw.recordFlags : {};
    const maxUid = grid.reduce((m, c) => Math.max(m, c.uid), 0);
    const runId = int(raw.runId, base.runId, 1);

    const state: GameState = {
      ...base,
      runId,
      status: raw.status === 'gameover' ? 'gameover' : 'playing',
      day,
      credits: num(raw.credits, base.credits),
      data: num(raw.data, 0, 0),
      energy: num(raw.energy, base.energy, 0),
      blackout: raw.blackout === true,
      grid,
      rowsUnlocked: int(raw.rowsUnlocked, START_ROWS, START_ROWS, GRID_ROWS),
      nextUid: Math.max(int(raw.nextUid, maxUid + 1, 1), maxUid + 1),
      research: {
        done: [...new Set(done)],
        active,
        progress: active ? int(research.progress, 0, 0, RESEARCH[active].duration) : 0,
      },
      modifiers: sanitizeModifiers(raw.modifiers, day),
      nextModId: int(raw.nextModId, 1, 1),
      pending: sanitizePending(raw.pending, day),
      lastEventId: typeof raw.lastEventId === 'string' && raw.lastEventId in EVENTS ? (raw.lastEventId as GameState['lastEventId']) : null,
      market: {
        price: num(market.price, base.market.price, 0.5, 20),
        history: numList(market.history, base.market.history),
      },
      autoBrokerEnabled: raw.autoBrokerEnabled === true && done.includes('autoBroker'),
      bankruptDays: int(raw.bankruptDays, 0, 0, 10),
      history: {
        credits: numList(history.credits, base.history.credits),
        data: numList(history.data, base.history.data),
        energy: numList(history.energy, base.history.energy),
      },
      log: sanitizeLog(raw.log, base.log),
      nextLogId: int(raw.nextLogId, 1, 1),
      eventHistory: sanitizeEventHistory(raw.eventHistory),
      toasts: [],
      nextToastId: 1,
      stats: {
        built: int(stats.built, 0, 0),
        upgrades: int(stats.upgrades, 0, 0),
        demolished: int(stats.demolished, 0, 0),
        researchDone: int(stats.researchDone, done.length, 0),
        events: int(stats.events, 0, 0),
        blackouts: int(stats.blackouts, 0, 0),
        dataSold: num(stats.dataSold, 0, 0),
        creditsEarned: num(stats.creditsEarned, 0, 0),
        peakCapital: num(stats.peakCapital, base.stats.peakCapital),
        peakIncome: num(stats.peakIncome, 0),
      },
      // Номер этого забега уже выдан — Зал славы должен это помнить.
      records: { ...records, totalRuns: Math.max(records.totalRuns, runId) },
      baseline: { days: int(baseline.days, records.bestDays, 0), capital: int(baseline.capital, records.bestCapital, 0) },
      recordFlags: { days: flags.days === true, capital: flags.capital === true },
      rngSeed: int(raw.rngSeed, seed, 0, 0xffffffff) >>> 0,
      speed: raw.speed === 0 || raw.speed === 2 || raw.speed === 4 ? raw.speed : 1,
      settings: { autoPause: settings.autoPause !== false },
      lastTick: sanitizeLastTick(raw.lastTick),
      startedAt: num(raw.startedAt, now, 0),
    };
    state.nextLogId = Math.max(state.nextLogId, state.log.reduce((m, e) => Math.max(m, e.id), 0) + 1);
    state.nextModId = Math.max(state.nextModId, state.modifiers.reduce((m, e) => Math.max(m, e.id), 0) + 1);
    // Запасы не могут превышать хранилища, которые реально стоят в секторе.
    const econ = computeEconomy(state);
    state.energy = Math.min(state.energy, econ.energyCap);
    state.data = Math.min(state.data, econ.dataCap);
    return state;
  } catch {
    return null;
  }
}

export function loadRecords(): Records {
  return sanitizeRecords(readRaw(RECORDS_KEY));
}

export function loadGame(now: number, seed: number): { state: GameState; restored: boolean } {
  const records = loadRecords();
  const restored = sanitizeState(readRaw(SAVE_KEY), records, now, seed);
  if (restored) return { state: restored, restored: true };
  return { state: createInitialState(seed, now, records), restored: false };
}

/** Кто последним писал сейв (идентификатор вкладки) — чтобы вкладки не затирали друг друга. */
export function readSaveOwner(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObj(parsed) && typeof parsed.owner === 'string' ? parsed.owner : null;
  } catch {
    return null;
  }
}

/** Пишет забег и рекорды. Рекорды сливаются с сохранёнными, чтобы не откатить чужой прогресс. */
export function saveGame(state: GameState, owner = 'solo'): boolean {
  const { records, toasts: _toasts, ...run } = state;
  const merged = mergeRecords(records, sanitizeRecords(readRaw(RECORDS_KEY)));
  const okRecords = writeRaw(RECORDS_KEY, merged);
  const okRun = writeRaw(SAVE_KEY, { ...run, owner });
  return okRecords && okRun;
}

export function clearSave(): void {
  try {
    globalThis.localStorage?.removeItem(SAVE_KEY);
  } catch {
    // Хранилище недоступно — удалять нечего.
  }
}
