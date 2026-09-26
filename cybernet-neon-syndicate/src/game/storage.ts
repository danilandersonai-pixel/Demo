// Сохранение в localStorage. Забег и рекорды лежат под разными ключами:
// «Новая игра» стирает забег, но Зал славы остаётся.
// Любое чтение/запись обёрнуто в try/catch — в приватном окне хранилище может быть недоступно.

import { BUILDINGS, GRID_CELLS, GRID_ROWS, MAX_LEVEL, RESEARCH, SAVE_VERSION, START_ROWS } from './config.ts';
import { createInitialState, emptyCell, emptyRecords } from './engine.ts';
import { EVENTS } from './events.ts';
import type { BuildingId, Cell, GameState, Records, ResearchId, RunSummary } from './types.ts';

export const SAVE_KEY = 'cybernet-neon-syndicate:save:v1';
export const RECORDS_KEY = 'cybernet-neon-syndicate:records:v1';

type Json = Record<string, unknown>;

function isObj(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function int(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return Math.floor(num(value, fallback, min, max));
}

function numList(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const list = value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
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

/**
 * Восстанавливает сохранённый забег. Неизвестные или битые поля заменяются значениями
 * по умолчанию, а совсем нечитаемый сейв даёт null (начнётся новая игра).
 */
export function sanitizeState(raw: unknown, records: Records, now: number, seed: number): GameState | null {
  if (!isObj(raw) || raw.version !== SAVE_VERSION || !Array.isArray(raw.grid)) return null;
  const base = createInitialState(seed, now, records);
  try {
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

    const state: GameState = {
      ...base,
      runId: int(raw.runId, base.runId, 1),
      status: raw.status === 'gameover' ? 'gameover' : 'playing',
      day: int(raw.day, 0, 0),
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
      modifiers: Array.isArray(raw.modifiers)
        ? raw.modifiers.filter(
            (m): m is GameState['modifiers'][number] =>
              isObj(m) && typeof m.target === 'string' && typeof m.eventId === 'string' && m.eventId in EVENTS &&
              typeof m.value === 'number' && typeof m.endsDay === 'number' && typeof m.label === 'string',
          )
        : [],
      nextModId: int(raw.nextModId, 1, 1),
      pending: sanitizePending(raw.pending),
      lastEventId: typeof raw.lastEventId === 'string' && raw.lastEventId in EVENTS ? (raw.lastEventId as GameState['lastEventId']) : null,
      market: {
        price: num(market.price, base.market.price, 0.5, 20),
        history: numList(market.history, base.market.history),
      },
      autoBrokerEnabled: raw.autoBrokerEnabled === true && done.includes('autoBroker'),
      bankruptDays: int(raw.bankruptDays, 0, 0),
      history: {
        credits: numList(history.credits, base.history.credits),
        data: numList(history.data, base.history.data),
        energy: numList(history.energy, base.history.energy),
      },
      log: Array.isArray(raw.log)
        ? raw.log.filter((e): e is GameState['log'][number] => isObj(e) && typeof e.text === 'string' && typeof e.id === 'number').slice(-160)
        : base.log,
      nextLogId: int(raw.nextLogId, 1, 1),
      eventHistory: Array.isArray(raw.eventHistory)
        ? raw.eventHistory.filter((e): e is GameState['eventHistory'][number] => isObj(e) && typeof e.outcome === 'string' && typeof e.eventId === 'string' && e.eventId in EVENTS).slice(0, 12)
        : [],
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
      records,
      baseline: { days: int(baseline.days, records.bestDays, 0), capital: int(baseline.capital, records.bestCapital, 0) },
      recordFlags: { days: flags.days === true, capital: flags.capital === true },
      rngSeed: int(raw.rngSeed, seed, 0, 0xffffffff) >>> 0,
      speed: raw.speed === 0 || raw.speed === 2 || raw.speed === 4 ? raw.speed : 1,
      settings: { autoPause: settings.autoPause !== false },
      lastTick: isObj(raw.lastTick) ? (raw.lastTick as unknown as GameState['lastTick']) : null,
      startedAt: num(raw.startedAt, now, 0),
    };
    const maxLogId = state.log.reduce((m, e) => Math.max(m, e.id), 0);
    state.nextLogId = Math.max(state.nextLogId, maxLogId + 1);
    const maxModId = state.modifiers.reduce((m, e) => Math.max(m, e.id), 0);
    state.nextModId = Math.max(state.nextModId, maxModId + 1);
    return state;
  } catch {
    return null;
  }
}

function sanitizePending(raw: unknown): GameState['pending'] {
  if (!isObj(raw) || typeof raw.eventId !== 'string' || !(raw.eventId in EVENTS)) return null;
  if (!Array.isArray(raw.options) || !isObj(raw.ctx) || typeof raw.defaultOption !== 'string') return null;
  const options = raw.options.filter(
    (o): o is NonNullable<GameState['pending']>['options'][number] =>
      isObj(o) && typeof o.id === 'string' && typeof o.label === 'string' && isObj(o.cost),
  );
  if (!options.some((o) => o.id === raw.defaultOption)) return null;
  return {
    eventId: raw.eventId as NonNullable<GameState['pending']>['eventId'],
    title: typeof raw.title === 'string' ? raw.title : EVENTS[raw.eventId as keyof typeof EVENTS].title,
    description: typeof raw.description === 'string' ? raw.description : '',
    options,
    defaultOption: raw.defaultOption,
    startDay: int(raw.startDay, 0, 0),
    expiresDay: int(raw.expiresDay, 0, 0),
    ctx: raw.ctx as Record<string, number>,
  };
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

export function saveGame(state: GameState): boolean {
  const { records, toasts: _toasts, ...run } = state;
  const okRecords = writeRaw(RECORDS_KEY, records);
  const okRun = writeRaw(SAVE_KEY, run);
  return okRecords && okRun;
}

export function clearSave(): void {
  try {
    globalThis.localStorage?.removeItem(SAVE_KEY);
  } catch {
    // Хранилище недоступно — удалять нечего.
  }
}
