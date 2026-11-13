/**
 * Сохранение прогресса в localStorage. Любые данные из хранилища считаются
 * недоверенными: каждое поле проверяется и при ошибке заменяется значением по
 * умолчанию, неизвестные id отбрасываются. Если localStorage недоступен
 * (приватное окно, запрет сайта), игра работает без сохранения.
 */
import { DEFAULT_UPGRADES, SKINS, THEMES, UPGRADES } from '../game/config';
import type { LeaderboardEntry, SaveData, Settings, SkinId, Stats, ThemeId, UpgradeId, UpgradeLevels } from '../game/types';

export const SAVE_KEY = 'neon-velocity/save/v1';
export const LEADERBOARD_SIZE = 5;
/** Стартовый подарок: хватает на первое улучшение. */
export const STARTING_CRYSTALS = 150;

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  music: 0.7,
  sfx: 0.8,
  screenShake: true,
  showFps: false,
};

const DEFAULT_STATS: Stats = {
  gamesPlayed: 0,
  totalCrystals: 0,
  totalScore: 0,
  bestMultiplier: 1,
  totalTime: 0,
};

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function createDefaultSave(): SaveData {
  return {
    version: 1,
    crystals: STARTING_CRYSTALS,
    highscore: 0,
    leaderboard: [],
    ownedSkins: ['core'],
    equippedSkin: 'core',
    ownedThemes: ['cyberpunk'],
    equippedTheme: 'cyberpunk',
    upgrades: { ...DEFAULT_UPGRADES },
    settings: { ...DEFAULT_SETTINGS, screenShake: !prefersReducedMotion() },
    stats: { ...DEFAULT_STATS },
    seenTutorial: false,
  };
}

// ─── Валидация ──────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback;
}

function int(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return Math.floor(num(v, fallback, min, max));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function isSkinId(v: unknown): v is SkinId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SKINS, v);
}

function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(THEMES, v);
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function sanitizeEntry(v: unknown): LeaderboardEntry | null {
  if (!isRecord(v)) return null;
  const date = typeof v.date === 'string' && !Number.isNaN(Date.parse(v.date)) ? v.date : null;
  if (!date) return null;
  const score = int(v.score, -1);
  if (score < 0) return null;
  return {
    id: typeof v.id === 'string' && v.id.length > 0 && v.id.length < 64 ? v.id : makeEntryId(),
    score,
    level: int(v.level, 1, 1, 999),
    speedMult: num(v.speedMult, 1, 1, 99),
    date,
    maxMultiplier: int(v.maxMultiplier, 1, 1, 999),
    crystals: int(v.crystals, 0),
    duration: num(v.duration, 0, 0, 1e7),
    skinId: isSkinId(v.skinId) ? v.skinId : 'core',
  };
}

export function sortLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  // При равенстве очков выше тот, кто поставил результат раньше.
  return [...entries].sort((a, b) => b.score - a.score || Date.parse(a.date) - Date.parse(b.date));
}

function sanitizeUpgrades(v: unknown): UpgradeLevels {
  const out: UpgradeLevels = { ...DEFAULT_UPGRADES };
  if (!isRecord(v)) return out;
  for (const id of Object.keys(DEFAULT_UPGRADES) as UpgradeId[]) {
    out[id] = int(v[id], 0, 0, UPGRADES[id].maxTier);
  }
  return out;
}

function sanitizeSettings(v: unknown, defaults: Settings): Settings {
  if (!isRecord(v)) return { ...defaults };
  return {
    sound: bool(v.sound, defaults.sound),
    music: num(v.music, defaults.music, 0, 1),
    sfx: num(v.sfx, defaults.sfx, 0, 1),
    screenShake: bool(v.screenShake, defaults.screenShake),
    showFps: bool(v.showFps, defaults.showFps),
  };
}

function sanitizeStats(v: unknown): Stats {
  if (!isRecord(v)) return { ...DEFAULT_STATS };
  return {
    gamesPlayed: int(v.gamesPlayed, 0),
    totalCrystals: int(v.totalCrystals, 0),
    totalScore: int(v.totalScore, 0),
    bestMultiplier: int(v.bestMultiplier, 1, 1, 999),
    totalTime: num(v.totalTime, 0, 0, 1e9),
  };
}

/** Привести произвольные данные к корректному SaveData. */
export function sanitizeSave(raw: unknown): SaveData {
  const d = createDefaultSave();
  if (!isRecord(raw)) return d;

  const ownedSkins = uniq<SkinId>(['core', ...(Array.isArray(raw.ownedSkins) ? raw.ownedSkins.filter(isSkinId) : [])]);
  const ownedThemes = uniq<ThemeId>([
    'cyberpunk',
    ...(Array.isArray(raw.ownedThemes) ? raw.ownedThemes.filter(isThemeId) : []),
  ]);
  const equippedSkin = isSkinId(raw.equippedSkin) && ownedSkins.includes(raw.equippedSkin) ? raw.equippedSkin : 'core';
  const equippedTheme =
    isThemeId(raw.equippedTheme) && ownedThemes.includes(raw.equippedTheme) ? raw.equippedTheme : 'cyberpunk';

  // id записей уникальны: по ним таблица различает строки и подсвечивает
  // последний забег. Повтор (битое или правленое руками сохранение) получает новый id.
  const seenIds = new Set<string>();
  const entries = (Array.isArray(raw.leaderboard) ? raw.leaderboard : [])
    .map(sanitizeEntry)
    .filter((e): e is LeaderboardEntry => e !== null)
    .map((e) => {
      let id = e.id;
      while (seenIds.has(id)) id = makeEntryId();
      seenIds.add(id);
      return id === e.id ? e : { ...e, id };
    });
  const leaderboard = sortLeaderboard(entries).slice(0, LEADERBOARD_SIZE);

  // Рекорд не может быть меньше лучшей записи таблицы.
  const highscore = Math.max(int(raw.highscore, 0), leaderboard[0]?.score ?? 0);

  return {
    version: 1,
    crystals: int(raw.crystals, d.crystals),
    highscore,
    leaderboard,
    ownedSkins,
    equippedSkin,
    ownedThemes,
    equippedTheme,
    upgrades: sanitizeUpgrades(raw.upgrades),
    settings: sanitizeSettings(raw.settings, d.settings),
    stats: sanitizeStats(raw.stats),
    seenTutorial: bool(raw.seenTutorial, false),
  };
}

// ─── Чтение и запись ────────────────────────────────────────────────────────

export function loadSave(): SaveData {
  try {
    const text = window.localStorage.getItem(SAVE_KEY);
    if (!text) return createDefaultSave();
    return sanitizeSave(JSON.parse(text));
  } catch {
    return createDefaultSave();
  }
}

/** Записать сохранение. Возвращает false, если хранилище недоступно. */
export function persistSave(save: SaveData): boolean {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function makeEntryId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
