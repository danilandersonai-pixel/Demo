/**
 * Чистые функции прогресса: покупки, экипировка, запись результата забега.
 * Каждая принимает SaveData и возвращает НОВЫЙ SaveData (или null, если
 * действие невозможно) — исходный объект не меняется.
 */
import { SKINS, THEMES, UPGRADES } from '../game/config';
import type { Loadout, RunResult, SaveData, Settings, SkinId, ThemeId, UpgradeId } from '../game/types';
import { createDefaultSave, LEADERBOARD_SIZE, makeEntryId, sortLeaderboard } from './storage';

export function canAfford(save: SaveData, price: number): boolean {
  return save.crystals >= price;
}

// ─── Скины ──────────────────────────────────────────────────────────────────

export function buySkin(save: SaveData, id: SkinId): SaveData | null {
  const skin = SKINS[id];
  if (save.ownedSkins.includes(id) || !canAfford(save, skin.price)) return null;
  return {
    ...save,
    crystals: save.crystals - skin.price,
    ownedSkins: [...save.ownedSkins, id],
    equippedSkin: id,
  };
}

export function equipSkin(save: SaveData, id: SkinId): SaveData | null {
  if (!save.ownedSkins.includes(id) || save.equippedSkin === id) return null;
  return { ...save, equippedSkin: id };
}

// ─── Темы ───────────────────────────────────────────────────────────────────

export function buyTheme(save: SaveData, id: ThemeId): SaveData | null {
  const theme = THEMES[id];
  if (save.ownedThemes.includes(id) || !canAfford(save, theme.price)) return null;
  return {
    ...save,
    crystals: save.crystals - theme.price,
    ownedThemes: [...save.ownedThemes, id],
    equippedTheme: id,
  };
}

export function equipTheme(save: SaveData, id: ThemeId): SaveData | null {
  if (!save.ownedThemes.includes(id) || save.equippedTheme === id) return null;
  return { ...save, equippedTheme: id };
}

// ─── Улучшения ──────────────────────────────────────────────────────────────

/** Цена следующего уровня улучшения или null, если уровень максимальный. */
export function nextUpgradePrice(save: SaveData, id: UpgradeId): number | null {
  const tier = save.upgrades[id];
  const up = UPGRADES[id];
  return tier >= up.maxTier ? null : up.prices[tier];
}

export function buyUpgrade(save: SaveData, id: UpgradeId): SaveData | null {
  const price = nextUpgradePrice(save, id);
  if (price === null || !canAfford(save, price)) return null;
  return {
    ...save,
    crystals: save.crystals - price,
    upgrades: { ...save.upgrades, [id]: save.upgrades[id] + 1 },
  };
}

// ─── Результат забега ───────────────────────────────────────────────────────

export interface RecordOutcome {
  save: SaveData;
  /** Место в топ-5 (1..5) или null, если результат в таблицу не попал. */
  rank: number | null;
  /** id записи в таблице (для подсветки) или null. */
  entryId: string | null;
  /**
   * Счёт выше прошлого абсолютного рекорда. Для самого первого забега с
   * очками тоже true — экран Game Over пишет «ПЕРВЫЙ РЕКОРД», если
   * previousHighscore === 0, и «NEW RECORD!» иначе.
   */
  isHighscore: boolean;
  /** Рекорд до этого забега. */
  previousHighscore: number;
}

export function recordRun(save: SaveData, result: RunResult, now: Date = new Date()): RecordOutcome {
  const score = Math.max(0, Math.floor(result.score));
  const entryId = makeEntryId();
  const entry = {
    id: entryId,
    score,
    level: Math.max(1, Math.floor(result.level)),
    speedMult: Math.round(result.speedMult * 100) / 100,
    date: now.toISOString(),
    maxMultiplier: Math.max(1, Math.floor(result.maxMultiplier)),
    crystals: Math.max(0, Math.floor(result.crystals)),
    duration: Math.max(0, result.duration),
    skinId: result.skinId,
  };

  const leaderboard = score > 0 ? sortLeaderboard([...save.leaderboard, entry]).slice(0, LEADERBOARD_SIZE) : save.leaderboard;
  const index = leaderboard.findIndex((e) => e.id === entryId);
  const isHighscore = score > save.highscore;

  const next: SaveData = {
    ...save,
    crystals: save.crystals + entry.crystals,
    highscore: Math.max(save.highscore, score),
    leaderboard,
    stats: {
      gamesPlayed: save.stats.gamesPlayed + 1,
      totalCrystals: save.stats.totalCrystals + entry.crystals,
      totalScore: save.stats.totalScore + score,
      bestMultiplier: Math.max(save.stats.bestMultiplier, entry.maxMultiplier),
      totalTime: save.stats.totalTime + entry.duration,
    },
    seenTutorial: true,
  };

  return {
    save: next,
    rank: index >= 0 ? index + 1 : null,
    entryId: index >= 0 ? entryId : null,
    isHighscore,
    previousHighscore: save.highscore,
  };
}

// ─── Прочее ─────────────────────────────────────────────────────────────────

export function updateSettings(save: SaveData, patch: Partial<Settings>): SaveData {
  return { ...save, settings: { ...save.settings, ...patch } };
}

/** Полный сброс прогресса (настройки звука сохраняются). */
export function resetProgress(save: SaveData): SaveData {
  const fresh = createDefaultSave();
  return { ...fresh, settings: { ...save.settings } };
}

/** Снаряжение для движка из текущего сохранения. */
export function getLoadout(save: SaveData): Loadout {
  return {
    skin: SKINS[save.equippedSkin],
    theme: THEMES[save.equippedTheme],
    upgrades: { ...save.upgrades },
    highscore: save.highscore,
  };
}
