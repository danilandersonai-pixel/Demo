/** Тесты сохранения и прогресса: чистые функции, без браузера. */
import { describe, expect, it } from 'vitest';
import { SKINS, THEMES, UPGRADES } from '../core/config';
import type { RunResult, SaveData } from '../core/types';
import { buySkin, buyTheme, buyUpgrade, equipSkin, equipTheme, getLoadout, nextUpgradePrice, recordRun, resetProgress } from './progress';
import { createDefaultSave, LEADERBOARD_SIZE, sanitizeSave, STARTING_CRYSTALS } from './storage';

function result(score: number, extra: Partial<RunResult> = {}): RunResult {
  return {
    score,
    level: 2,
    speedMult: 1.13,
    crystals: 10,
    crystalsCollected: 9,
    maxMultiplier: 3,
    maxChain: 9,
    nearMisses: 1,
    dodged: 12,
    duration: 20,
    newRecord: false,
    seed: 1,
    ...extra,
  };
}

describe('sanitizeSave', () => {
  it('корректное сохранение проходит проверку без изменений', () => {
    let save = createDefaultSave();
    save = { ...save, crystals: 5000 };
    save = buySkin(save, 'ghost')!;
    save = buyTheme(save, 'gold')!;
    save = buyUpgrade(save, 'lucky')!;
    save = recordRun(save, result(1200), new Date('2026-01-02T03:04:05Z')).save;
    save = recordRun(save, result(800), new Date('2026-01-03T03:04:05Z')).save;
    expect(sanitizeSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it('мусор превращается в сохранение по умолчанию', () => {
    for (const junk of [null, 42, 'x', [], { crystals: 'много' }]) {
      const save = sanitizeSave(junk);
      expect(save.crystals).toBe(STARTING_CRYSTALS);
      expect(save.ownedSkins).toEqual(['core']);
      expect(save.equippedTheme).toBe('cyberpunk');
    }
  });

  it('неизвестные id, отрицательные числа и не купленная экипировка отбрасываются', () => {
    const save = sanitizeSave({
      crystals: -50,
      highscore: 10,
      ownedSkins: ['ghost', 'hacker', 'ghost'],
      equippedSkin: 'singularity',
      ownedThemes: ['void'],
      equippedTheme: 'gold',
      upgrades: { lucky: 99, resonator: -3, fieldAmp: 'x' },
      leaderboard: [
        { id: 'a', score: 500, date: '2026-01-01T00:00:00Z', level: 3, speedMult: 1.26, maxMultiplier: 2, crystals: 4, duration: 31, skinId: 'ghost' },
        { id: 'a', score: 400, date: '2026-01-02T00:00:00Z' },
        { id: 'b', score: -1, date: '2026-01-02T00:00:00Z' },
        { id: 'c', score: 100, date: 'вчера' },
      ],
    });
    expect(save.crystals).toBe(0);
    expect(save.ownedSkins.sort()).toEqual(['core', 'ghost']);
    expect(save.equippedSkin).toBe('core');
    expect(save.ownedThemes).toEqual(['cyberpunk']);
    expect(save.equippedTheme).toBe('cyberpunk');
    expect(save.upgrades).toEqual({ lucky: UPGRADES.lucky.maxTier, resonator: 0, fieldAmp: 0 });
    expect(save.leaderboard.map((e) => e.score)).toEqual([500, 400]);
    // Одинаковые id в таблице недопустимы: это ключи строк в интерфейсе.
    expect(new Set(save.leaderboard.map((e) => e.id)).size).toBe(2);
    // Рекорд не может быть меньше лучшей записи таблицы.
    expect(save.highscore).toBe(500);
  });
});

describe('магазин', () => {
  it('покупка списывает кристаллы и сразу надевает предмет; дважды купить нельзя', () => {
    const start: SaveData = { ...createDefaultSave(), crystals: 1000 };
    const bought = buySkin(start, 'trail')!;
    expect(bought.crystals).toBe(1000 - SKINS.trail.price);
    expect(bought.equippedSkin).toBe('trail');
    expect(buySkin(bought, 'trail')).toBeNull();
    expect(buySkin(bought, 'singularity')).toBeNull();
    expect(start.crystals).toBe(1000);

    const themed = buyTheme(bought, 'acid')!;
    expect(themed.crystals).toBe(bought.crystals - THEMES.acid.price);
    expect(themed.equippedTheme).toBe('acid');
    expect(equipTheme(themed, 'cyberpunk')!.equippedTheme).toBe('cyberpunk');
    expect(equipTheme(themed, 'arctic')).toBeNull();
    expect(equipSkin(themed, 'core')!.equippedSkin).toBe('core');
    expect(equipSkin(themed, 'ghost')).toBeNull();
  });

  it('улучшения покупаются по уровням до максимума', () => {
    let save: SaveData = { ...createDefaultSave(), crystals: 100000 };
    for (let tier = 0; tier < UPGRADES.resonator.maxTier; tier++) {
      expect(nextUpgradePrice(save, 'resonator')).toBe(UPGRADES.resonator.prices[tier]);
      save = buyUpgrade(save, 'resonator')!;
    }
    expect(save.upgrades.resonator).toBe(UPGRADES.resonator.maxTier);
    expect(nextUpgradePrice(save, 'resonator')).toBeNull();
    expect(buyUpgrade(save, 'resonator')).toBeNull();
    expect(buyUpgrade({ ...createDefaultSave(), crystals: 10 }, 'lucky')).toBeNull();
  });
});

describe('recordRun', () => {
  it('начисляет кристаллы, обновляет рекорд и статистику', () => {
    const save = createDefaultSave();
    const first = recordRun(save, result(700));
    expect(first.isHighscore).toBe(true);
    expect(first.previousHighscore).toBe(0);
    expect(first.rank).toBe(1);
    expect(first.entryId).toBe(first.save.leaderboard[0].id);
    expect(first.save.crystals).toBe(STARTING_CRYSTALS + 10);
    expect(first.save.highscore).toBe(700);
    expect(first.save.stats).toMatchObject({ gamesPlayed: 1, totalCrystals: 10, totalScore: 700, bestMultiplier: 3, totalTime: 20 });
    expect(first.save.leaderboard[0]).toMatchObject({ score: 700, level: 2, speedMult: 1.13, skinId: 'core' });

    const worse = recordRun(first.save, result(300));
    expect(worse.isHighscore).toBe(false);
    expect(worse.previousHighscore).toBe(700);
    expect(worse.rank).toBe(2);
    expect(worse.save.highscore).toBe(700);
  });

  it('таблица хранит пять лучших; при равенстве выше тот, кто раньше', () => {
    let save = createDefaultSave();
    const scores = [500, 900, 100, 700, 300, 900, 50];
    scores.forEach((score, i) => {
      save = recordRun(save, result(score), new Date(Date.UTC(2026, 0, 1 + i))).save;
    });
    expect(save.leaderboard).toHaveLength(LEADERBOARD_SIZE);
    expect(save.leaderboard.map((e) => e.score)).toEqual([900, 900, 700, 500, 300]);
    expect(Date.parse(save.leaderboard[0].date)).toBeLessThan(Date.parse(save.leaderboard[1].date));

    const out = recordRun(save, result(200));
    expect(out.rank).toBeNull();
    expect(out.entryId).toBeNull();
    expect(out.save.stats.gamesPlayed).toBe(8);
  });

  it('забег без очков не попадает в таблицу, но считается сыгранным', () => {
    const out = recordRun(createDefaultSave(), result(0, { crystals: 0 }));
    expect(out.save.leaderboard).toHaveLength(0);
    expect(out.rank).toBeNull();
    expect(out.isHighscore).toBe(false);
    expect(out.save.stats.gamesPlayed).toBe(1);
  });
});

describe('прочее', () => {
  it('сброс прогресса сохраняет настройки', () => {
    let save: SaveData = { ...createDefaultSave(), crystals: 9999 };
    save = { ...save, settings: { ...save.settings, sound: false, music: 0.3 } };
    const fresh = resetProgress(save);
    expect(fresh.crystals).toBe(STARTING_CRYSTALS);
    expect(fresh.settings).toEqual(save.settings);
  });

  it('getLoadout собирает снаряжение из сохранения', () => {
    const save = buySkin({ ...createDefaultSave(), crystals: 1000, highscore: 321 }, 'magnet')!;
    const loadout = getLoadout(save);
    expect(loadout.skin.id).toBe('magnet');
    expect(loadout.theme.id).toBe('cyberpunk');
    expect(loadout.highscore).toBe(321);
  });
});
