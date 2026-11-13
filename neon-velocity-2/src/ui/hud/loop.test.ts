import { describe, expect, it } from 'vitest';
import { GAME, SKINS, THEMES } from '../../core/config';
import { TICK_RATE } from '../../core/timing';
import type { Loadout, RunResult } from '../../core/types';
import { EMPTY_HUD } from '../hudStore';
import { coarsenHud, FixedStep, MAX_TICKS_PER_FRAME, shieldNote, withBankedRecord } from './loop';

function run(hz: number, seconds: number, clock = { timeScale: 1 }): { ticks: number; alphas: number[] } {
  const stepper = new FixedStep();
  let ticks = 0;
  const alphas: number[] = [];
  for (let i = 0; i < Math.round(hz * seconds); i++) {
    ticks += stepper.advance(1 / hz, clock, () => {
      /* один тик */
    });
    alphas.push(stepper.alpha);
  }
  return { ticks, alphas };
}

describe('FixedStep', () => {
  it.each([30, 60, 75, 90, 120, 144, 240])('на %i Гц идёт ровно 128 тиков в секунду', (hz) => {
    const { ticks, alphas } = run(hz, 10);
    expect(Math.abs(ticks - TICK_RATE * 10)).toBeLessThanOrEqual(1);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('на 60 Гц кадр просчитывает 2–3 тика', () => {
    const stepper = new FixedStep();
    const counts = new Set<number>();
    for (let i = 0; i < 600; i++) counts.add(stepper.advance(1 / 60, { timeScale: 1 }, () => undefined));
    expect([...counts].sort()).toEqual([2, 3]);
  });

  it('не больше 8 тиков за кадр, остаток отбрасывается', () => {
    const stepper = new FixedStep();
    let ticks = 0;
    const stepped = stepper.advance(0.5, { timeScale: 1 }, () => {
      ticks++;
    });
    expect(stepped).toBe(MAX_TICKS_PER_FRAME);
    expect(ticks).toBe(MAX_TICKS_PER_FRAME);
    expect(stepper.alpha).toBeGreaterThanOrEqual(0);
    expect(stepper.alpha).toBeLessThan(1);
    // Отброшенное время не всплывает в следующих кадрах.
    expect(stepper.advance(1 / 60, { timeScale: 1 }, () => undefined)).toBeLessThanOrEqual(3);
  });

  it('медленные 10 кадров в секунду замедляют игру, а не ускоряют потом', () => {
    const { ticks } = run(10, 5);
    expect(ticks).toBe(MAX_TICKS_PER_FRAME * 50);
  });

  it('timeScale растягивает тики: замедленный взрыв длится ticks / 128 / timeScale секунд', () => {
    const scale = GAME.death.timeScale;
    const { ticks } = run(60, 10, { timeScale: scale });
    expect(Math.abs(ticks - TICK_RATE * 10 * scale)).toBeLessThanOrEqual(1);
  });

  it('смена timeScale посреди кадра пересчитывает остаток времени', () => {
    const stepper = new FixedStep();
    const clock = { timeScale: 1 };
    let ticks = 0;
    // Кадр на 6 тиков; на втором тике начинается замедление 0.25×: оставшиеся 4 тика времени стоят один тик.
    const stepped = stepper.advance(6 / TICK_RATE, clock, () => {
      ticks++;
      if (ticks === 2) clock.timeScale = 0.25;
    });
    expect(stepped).toBe(3);
    expect(stepper.alpha).toBeCloseTo(0, 6);
  });

  it('нулевой и отрицательный dt тиков не дают, reset обнуляет долю', () => {
    const stepper = new FixedStep();
    expect(stepper.advance(0, { timeScale: 1 }, () => undefined)).toBe(0);
    expect(stepper.advance(-1, { timeScale: 1 }, () => undefined)).toBe(0);
    stepper.advance(0.004, { timeScale: 1 }, () => undefined);
    expect(stepper.alpha).toBeGreaterThan(0);
    stepper.reset();
    expect(stepper.alpha).toBe(0);
  });
});

describe('coarsenHud', () => {
  it('огрубляет полосу уровня до восьмых нот и время до половины секунды', () => {
    const snap = coarsenHud({ ...EMPTY_HUD, levelProgress: 0.337, elapsed: 12.74 }, 58, true);
    expect(snap.levelProgress).toBe(21 / 64);
    expect(snap.elapsed).toBe(12.5);
    expect(snap.fps).toBe(58);
  });

  it('границы шагов не теряются из-за округления', () => {
    for (let k = 0; k <= 64; k++) expect(coarsenHud({ ...EMPTY_HUD, levelProgress: k / 64 }, 0, true).levelProgress).toBe(k / 64);
    expect(coarsenHud({ ...EMPTY_HUD, elapsed: 0.1 + 0.2 + 0.2 }, 0, true).elapsed).toBe(0.5);
  });

  it('гасит OVERDRIVE после гибели корабля', () => {
    expect(coarsenHud({ ...EMPTY_HUD, overdrive: true }, 0, true).overdrive).toBe(true);
    expect(coarsenHud({ ...EMPTY_HUD, overdrive: true }, 0, false).overdrive).toBe(false);
  });
});

describe('shieldNote', () => {
  it('дописывает сгоревший множитель только когда он был настоящим', () => {
    expect(shieldNote(0, 0)).toBe('щит принял удар');
    expect(shieldNote(0, 1)).toBe('щит принял удар');
    expect(shieldNote(0, 5)).toBe('щит принял удар · x5 сгорел');
  });

  it('склоняет остаток зарядов', () => {
    expect(shieldNote(1, 0)).toBe('остался 1 заряд');
    expect(shieldNote(2, 3)).toBe('осталось 2 заряда · x3 сгорел');
    expect(shieldNote(5, 0)).toBe('осталось 5 зарядов');
    expect(shieldNote(21, 0)).toBe('остался 21 заряд');
  });
});

describe('withBankedRecord', () => {
  const loadout: Loadout = { skin: SKINS.core, theme: THEMES.cyberpunk, upgrades: { resonator: 0, fieldAmp: 0, lucky: 0 }, highscore: 1000 };
  const result = (score: number): RunResult => ({
    score,
    level: 1,
    speedMult: 1,
    crystals: 0,
    crystalsCollected: 0,
    maxMultiplier: 1,
    maxChain: 0,
    nearMisses: 0,
    dodged: 0,
    duration: 1,
    newRecord: false,
    seed: 1,
  });

  it('без сданного итога и при меньшем счёте снаряжение не меняется', () => {
    expect(withBankedRecord(loadout, null)).toBe(loadout);
    expect(withBankedRecord(loadout, result(999))).toBe(loadout);
    expect(withBankedRecord(loadout, result(1000))).toBe(loadout);
  });

  it('сданный рекорд становится рекордом следующего забега', () => {
    const next = withBankedRecord(loadout, result(2500.9));
    expect(next.highscore).toBe(2500);
    expect(next.skin).toBe(loadout.skin);
    expect(loadout.highscore).toBe(1000);
  });
});
