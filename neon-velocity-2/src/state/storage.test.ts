/** Границы чисел сохранения: таблица рекордов рассчитана на счёт конечной длины. */
import { describe, expect, it } from 'vitest';
import { sanitizeSave } from './storage';

function entry(score: unknown, id: string): Record<string, unknown> {
  return { id, score, date: '2026-01-01T00:00:00Z', level: 3, speedMult: 1.26, maxMultiplier: 2, crystals: 4, duration: 31, skinId: 'core' };
}

describe('счёт записи таблицы', () => {
  it('ограничен сверху точным целым — как рекорд и статистика', () => {
    const save = sanitizeSave({ highscore: 1e40, leaderboard: [entry(1e300, 'a'), entry(123_456_789_012.9, 'b')] });
    expect(save.leaderboard.map((e) => e.score)).toEqual([Number.MAX_SAFE_INTEGER, 123_456_789_012]);
    expect(save.highscore).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('не число, бесконечность и неположительный счёт запись отбрасывают', () => {
    const save = sanitizeSave({ leaderboard: [entry(Infinity, 'a'), entry(NaN, 'b'), entry('100', 'c'), entry(0, 'd'), entry(-5, 'e'), entry(0.4, 'f'), entry(7, 'g')] });
    expect(save.leaderboard.map((e) => e.score)).toEqual([7]);
  });
});
