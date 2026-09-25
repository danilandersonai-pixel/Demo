// Загрузка, проверка и сохранение состояния. Любые данные извне (localStorage, импорт файла)
// проходят через normalizeState — битые или чужие поля заменяются значениями по умолчанию.

import type {
  AvatarId,
  Daily,
  DayStats,
  Difficulty,
  GameState,
  Grant,
  Habit,
  Hero,
  LogEntry,
  LogKind,
  Reward,
  RewardIconId,
  StatKey,
  StatState,
  Todo,
  Totals,
} from '../types';
import { LOG_LIMIT, STORAGE_KEY, maxHp } from './constants';
import { createInitialState } from './seed';
import { uid } from './utils';

type Obj = Record<string, unknown>;

const AVATARS: AvatarId[] = ['warrior', 'mage', 'guardian', 'ranger', 'necro', 'phantom', 'android', 'familiar'];
const REWARD_ICONS: RewardIconId[] = [
  'film', 'pizza', 'game', 'coffee', 'sleep', 'music', 'shopping', 'travel', 'book', 'gift', 'potion', 'icecream',
];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'epic'];
const STATS: StatKey[] = ['strength', 'intellect', 'discipline'];
const LOG_KINDS: LogKind[] = ['quest', 'damage', 'level', 'shop', 'system', 'death', 'heal', 'stat', 'undo'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number, min = -Infinity): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, value) : fallback;
}

function int(value: unknown, fallback: number, min = 0): number {
  return Math.round(num(value, fallback, min));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function dateKey(value: unknown, fallback: string): string {
  return typeof value === 'string' && DATE_RE.test(value) ? value : fallback;
}

function nullableDate(value: unknown): string | null {
  return typeof value === 'string' && DATE_RE.test(value) ? value : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeStat(value: unknown): StatState {
  const o = isObj(value) ? value : {};
  return { level: int(o.level, 1, 1), xp: int(o.xp, 0, 0) };
}

function normalizeGrant(value: unknown): Grant | null {
  if (!isObj(value)) return null;
  return {
    xp: int(value.xp, 0),
    gold: int(value.gold, 0),
    stat: oneOf(value.stat, STATS, 'discipline'),
    statPoints: int(value.statPoints, 0),
  };
}

function normalizeHero(value: unknown, fallback: Hero): Hero {
  if (!isObj(value)) return fallback;
  const stats = isObj(value.stats) ? value.stats : {};
  const level = int(value.level, fallback.level, 1);
  const hero: Hero = {
    name: str(value.name, fallback.name).slice(0, 24) || fallback.name,
    avatar: oneOf(value.avatar, AVATARS, fallback.avatar),
    level,
    xp: int(value.xp, 0),
    hp: int(value.hp, fallback.hp, 1),
    gold: int(value.gold, fallback.gold),
    maxLevelReached: Math.max(level, int(value.maxLevelReached, level, 1)),
    stats: {
      strength: normalizeStat(stats.strength),
      intellect: normalizeStat(stats.intellect),
      discipline: normalizeStat(stats.discipline),
    },
  };
  hero.hp = Math.min(hero.hp, maxHp(hero));
  return hero;
}

function normalizeHabit(value: unknown, today: string): Habit | null {
  if (!isObj(value) || typeof value.title !== 'string' || !value.title.trim()) return null;
  const positive = bool(value.positive, true);
  const negative = bool(value.negative, false);
  return {
    id: str(value.id, uid()),
    type: 'habit',
    title: value.title,
    notes: str(value.notes, ''),
    difficulty: oneOf(value.difficulty, DIFFICULTIES, 'easy'),
    positive: positive || !negative,
    negative,
    penalizeSkip: positive && bool(value.penalizeSkip, false),
    countUp: int(value.countUp, 0),
    countDown: int(value.countDown, 0),
    lastPlusDate: nullableDate(value.lastPlusDate),
    createdDate: dateKey(value.createdDate, today),
    createdAt: int(value.createdAt, Date.now()),
  };
}

function normalizeDaily(value: unknown, today: string): Daily | null {
  if (!isObj(value) || typeof value.title !== 'string' || !value.title.trim()) return null;
  const days = arr(value.days).filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6);
  const completedGrant = normalizeGrant(value.completedGrant);
  const streak = int(value.streak, 0);
  const bestStreak = Math.max(streak, int(value.bestStreak, streak));
  return {
    id: str(value.id, uid()),
    type: 'daily',
    title: value.title,
    notes: str(value.notes, ''),
    difficulty: oneOf(value.difficulty, DIFFICULTIES, 'easy'),
    stat: oneOf(value.stat, STATS, 'strength'),
    days: days.length > 0 ? Array.from(new Set(days)).sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6],
    completed: bool(value.completed, false) && completedGrant !== null,
    completedGrant,
    streak,
    bestStreak,
    prevBestStreak: Math.min(bestStreak, int(value.prevBestStreak, bestStreak)),
    createdDate: dateKey(value.createdDate, today),
    createdAt: int(value.createdAt, Date.now()),
  };
}

function normalizeTodo(value: unknown): Todo | null {
  if (!isObj(value) || typeof value.title !== 'string' || !value.title.trim()) return null;
  const completedGrant = normalizeGrant(value.completedGrant);
  const completed = bool(value.completed, false) && completedGrant !== null;
  return {
    id: str(value.id, uid()),
    type: 'todo',
    title: value.title,
    notes: str(value.notes, ''),
    difficulty: oneOf(value.difficulty, DIFFICULTIES, 'easy'),
    stat: oneOf(value.stat, STATS, 'intellect'),
    dueDate: nullableDate(value.dueDate),
    completed,
    completedAt: completed ? int(value.completedAt, Date.now()) : null,
    completedGrant: completed ? completedGrant : null,
    createdAt: int(value.createdAt, Date.now()),
  };
}

function normalizeReward(value: unknown): Reward | null {
  if (!isObj(value) || typeof value.title !== 'string' || !value.title.trim()) return null;
  const kind = value.kind === 'potion' ? 'potion' : 'custom';
  return {
    id: str(value.id, uid()),
    title: value.title,
    notes: str(value.notes, ''),
    cost: int(value.cost, 10, 1),
    icon: kind === 'potion' ? 'potion' : oneOf(value.icon, REWARD_ICONS, 'gift'),
    kind,
    purchases: int(value.purchases, 0),
    createdAt: int(value.createdAt, Date.now()),
  };
}

function normalizeLog(value: unknown): LogEntry | null {
  if (!isObj(value) || typeof value.text !== 'string') return null;
  return {
    id: str(value.id, uid()),
    ts: int(value.ts, Date.now()),
    kind: oneOf(value.kind, LOG_KINDS, 'system'),
    text: value.text,
  };
}

function normalizeTotals(value: unknown, fallback: Totals): Totals {
  const o = isObj(value) ? value : {};
  return {
    questsCompleted: int(o.questsCompleted, fallback.questsCompleted),
    habitsPlus: int(o.habitsPlus, fallback.habitsPlus),
    habitsMinus: int(o.habitsMinus, fallback.habitsMinus),
    xpEarned: int(o.xpEarned, fallback.xpEarned),
    goldEarned: int(o.goldEarned, fallback.goldEarned),
    goldSpent: int(o.goldSpent, fallback.goldSpent),
    damageTaken: int(o.damageTaken, fallback.damageTaken),
    deaths: int(o.deaths, fallback.deaths),
    rewardsBought: int(o.rewardsBought, fallback.rewardsBought),
    crits: int(o.crits, fallback.crits),
  };
}

function normalizeDayStats(value: unknown, date: string): DayStats {
  const o = isObj(value) ? value : {};
  if (o.date !== date) return { date, xp: 0, gold: 0, quests: 0, damage: 0 };
  return { date, xp: int(o.xp, 0), gold: int(o.gold, 0), quests: int(o.quests, 0), damage: int(o.damage, 0) };
}

function compact<T>(list: Array<T | null>): T[] {
  return list.filter((item): item is T => item !== null);
}

/** Превращает произвольные данные в корректный GameState или возвращает null, если это не сохранение HabitQuest. */
export function normalizeState(raw: unknown, realToday: string): GameState | null {
  if (!isObj(raw) || raw.version !== 1 || !isObj(raw.hero)) return null;
  const base = createInitialState(realToday);
  const lastProcessedDate = dateKey(raw.lastProcessedDate, realToday);
  const rewards = compact(arr(raw.rewards).map(normalizeReward));
  if (!rewards.some((r) => r.kind === 'potion')) {
    const potion = base.rewards.find((r) => r.kind === 'potion');
    if (potion) rewards.unshift(potion);
  }
  return {
    version: 1,
    hero: normalizeHero(raw.hero, base.hero),
    habits: compact(arr(raw.habits).map((h) => normalizeHabit(h, lastProcessedDate))),
    dailies: compact(arr(raw.dailies).map((d) => normalizeDaily(d, lastProcessedDate))),
    todos: compact(arr(raw.todos).map(normalizeTodo)),
    rewards,
    log: compact(arr(raw.log).map(normalizeLog)).slice(0, LOG_LIMIT),
    totals: normalizeTotals(raw.totals, base.totals),
    today: normalizeDayStats(raw.today, lastProcessedDate),
    lastProcessedDate,
    dayOffset: int(raw.dayOffset, 0),
    createdAt: int(raw.createdAt, Date.now()),
  };
}

export function loadState(realToday: string): GameState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = normalizeState(JSON.parse(stored), realToday);
      if (parsed) return parsed;
    }
  } catch {
    // Хранилище недоступно (приватный режим) или данные повреждены — начинаем новую игру.
  }
  return createInitialState(realToday);
}

export function saveState(state: GameState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Настройка интерфейса не критична — просто не запоминаем её.
  }
}

/** Скачивает сохранение в JSON-файл. */
export function exportState(state: GameState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `habitquest-${state.lastProcessedDate}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Читает JSON-файл сохранения. Возвращает состояние или текст ошибки. */
export async function importStateFile(file: File, realToday: string): Promise<GameState | string> {
  if (file.size > 5_000_000) return 'Файл слишком большой для сохранения HabitQuest.';
  try {
    const text = await file.text();
    const parsed = normalizeState(JSON.parse(text), realToday);
    return parsed ?? 'Это не похоже на сохранение HabitQuest.';
  } catch {
    return 'Не удалось прочитать файл: повреждённый JSON.';
  }
}
