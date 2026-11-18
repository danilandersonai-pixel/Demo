import { describe, expect, it } from 'vitest';
import { GAME, RESUME_COUNT_IN_BEATS, SKINS, THEMES } from '../../core/config';
import { TICK_DT, TICK_RATE, TICKS_PER_BEAT } from '../../core/timing';
import type { Loadout, RunResult } from '../../core/types';
import { EMPTY_HUD } from '../hudStore';
import { coarsenHud, FixedStep, MAX_TICKS_PER_FRAME, RecordWatch, ResumeCountIn, shieldNote, withBankedRecord } from './loop';

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

describe('ResumeCountIn', () => {
  const BEAT = TICKS_PER_BEAT * TICK_DT;
  const TOTAL = RESUME_COUNT_IN_BEATS * BEAT;

  it('отсчёт — две доли настоящего времени: 120 тиков, 0.9375 с', () => {
    expect(RESUME_COUNT_IN_BEATS).toBe(2);
    expect(TOTAL).toBe(0.9375);
    expect(TOTAL * TICK_RATE).toBe(2 * TICKS_PER_BEAT);
  });

  it('без отсчёта время кадра целиком достаётся симуляции', () => {
    const countIn = new ResumeCountIn();
    expect(countIn.active).toBe(false);
    expect(countIn.count).toBe(0);
    expect(countIn.advance(1 / 60)).toBe(1 / 60);
    expect(countIn.advance(-1)).toBe(0);
  });

  it.each([30, 60, 75, 120, 144, 240])('на %i Гц мир стоит ровно две доли: цифры «2», «1», ни одного тика', (hz) => {
    const countIn = new ResumeCountIn();
    const stepper = new FixedStep();
    countIn.start();
    expect(countIn.active).toBe(true);
    expect(countIn.count).toBe(2);
    // Первый кадр после паузы часы только запускает (dt = 0): отсчёт стартует с него.
    expect(countIn.advance(0)).toBe(0);

    const dt = 1 / hz;
    const seen: number[] = [];
    let ticks = 0;
    let frozen = 0;
    let firstTickAt = -1;
    for (let frame = 1; frame <= hz * 3; frame++) {
      const before = countIn.count;
      const simDt = countIn.advance(dt);
      if (before > 0 && seen[seen.length - 1] !== before) seen.push(before);
      if (countIn.active) {
        expect(simDt).toBe(0);
        frozen++;
        continue;
      }
      const stepped = stepper.advance(simDt, { timeScale: 1 }, () => undefined);
      if (stepped > 0 && firstTickAt < 0) firstTickAt = frame * dt;
      ticks += stepped;
    }
    expect(seen).toEqual([2, 1]);
    // Последний «стоячий» кадр — тот, что ещё не дотянул до 0.9375 с.
    expect(frozen).toBe(Math.ceil(TOTAL * hz - 1e-9) - 1);
    // Тики пошли в том же кадре, где кончился отсчёт, — не раньше и не кадром позже.
    expect(firstTickAt).toBeGreaterThanOrEqual(TOTAL);
    expect(firstTickAt).toBeLessThan(TOTAL + dt + TICK_DT);
    // За три секунды симуляция прожила ровно три секунды минус отсчёт: остаток кадра не потерян.
    expect(Math.abs(ticks - (3 - TOTAL) * TICK_RATE)).toBeLessThanOrEqual(1);
  });

  it('цифра меняется ровно на доле', () => {
    const countIn = new ResumeCountIn();
    countIn.start();
    countIn.advance(BEAT - 0.001);
    expect(countIn.count).toBe(2);
    countIn.advance(0.001);
    expect(countIn.count).toBe(1);
    countIn.advance(BEAT - 0.001);
    expect(countIn.count).toBe(1);
    expect(countIn.active).toBe(true);
    // Кадр, в котором отсчёт кончился, отдаёт симуляции свой остаток.
    expect(countIn.advance(0.011)).toBeCloseTo(0.01, 9);
    expect(countIn.count).toBe(0);
    expect(countIn.active).toBe(false);
  });

  it('пауза во время отсчёта обрывает его; следующий возврат считает заново', () => {
    const countIn = new ResumeCountIn();
    countIn.start();
    countIn.advance(0.7);
    expect(countIn.count).toBe(1);
    countIn.cancel();
    expect(countIn.active).toBe(false);
    expect(countIn.count).toBe(0);
    expect(countIn.advance(0.02)).toBe(0.02);
    countIn.start();
    expect(countIn.count).toBe(2);
    expect(countIn.advance(0.9)).toBe(0);
    expect(countIn.active).toBe(true);
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

describe('RecordWatch', () => {
  it('одна вкладка: рекорд объявляется один раз, когда счёт его обгоняет', () => {
    const watch = new RecordWatch();
    watch.start(400);
    expect(watch.poll(0, 400)).toBeNull();
    expect(watch.poll(400, 400)).toBeNull();
    expect(watch.beaten).toBe(false);
    expect(watch.poll(410, 400)).toBe(400);
    expect(watch.beaten).toBe(true);
    // Своё же сохранение рекорд не поднимает до конца забега; повторного объявления нет.
    expect(watch.poll(900, 400)).toBeNull();
    expect(watch.poll(5000, 400)).toBeNull();
    expect(watch.record).toBe(400);
  });

  it('первый забег (рекорда ещё нет) баннером не отмечается', () => {
    const watch = new RecordWatch();
    watch.start(0);
    expect(watch.poll(100, 0)).toBeNull();
    expect(watch.poll(9000, 0)).toBeNull();
    expect(watch.beaten).toBe(false);
  });

  it('две вкладки: забег, начатый до чужого рекорда, сверяется с рекордом из общего сохранения', () => {
    const watch = new RecordWatch();
    watch.start(400);
    expect(watch.poll(0, 400)).toBeNull();
    // Пока этот забег стоял на паузе, другая вкладка подняла рекорд до 6265.
    expect(watch.poll(0, 6265)).toBeNull();
    expect(watch.record).toBe(6265);
    // Счёт обогнал рекорд, с которым забег стартовал, — но не настоящий: баннера нет.
    expect(watch.poll(410, 6265)).toBeNull();
    expect(watch.poll(1315, 6265)).toBeNull();
    expect(watch.beaten).toBe(false);
    expect(watch.poll(6265, 6265)).toBeNull();
    // Обогнал настоящий — баннер с настоящим прошлым рекордом, один раз.
    expect(watch.poll(6300, 6265)).toBe(6265);
    expect(watch.poll(6400, 6265)).toBeNull();
    expect(watch.beaten).toBe(true);
  });

  it('рекорд подняли после объявления: ниже счёта — тишина, выше — обгонять заново', () => {
    const watch = new RecordWatch();
    watch.start(400);
    expect(watch.poll(500, 400)).toBe(400);
    expect(watch.poll(600, 550)).toBeNull();
    expect(watch.beaten).toBe(true);
    expect(watch.record).toBe(550);
    expect(watch.poll(700, 6265)).toBeNull();
    expect(watch.beaten).toBe(false);
    expect(watch.poll(7000, 6265)).toBe(6265);
  });

  it('сброс прогресса в другой вкладке рекорд идущего забега не опускает; новый забег начинает с чистого листа', () => {
    const watch = new RecordWatch();
    watch.start(400);
    expect(watch.poll(300, 0)).toBeNull();
    expect(watch.record).toBe(400);
    expect(watch.poll(401, 0)).toBe(400);
    watch.start(2500);
    expect(watch.beaten).toBe(false);
    expect(watch.poll(401, 2500)).toBeNull();
  });

  it('снимок HUD: BEST — настоящий рекорд (или счёт, когда он побит), метка — только после обгона', () => {
    const watch = new RecordWatch();
    watch.start(400);
    watch.poll(1315, 6265);
    // Симуляция сравнивала с 400 и уже считает рекорд побитым.
    const stale = { ...EMPTY_HUD, score: 1315, highscore: 1315, newRecord: true };
    expect(watch.stamp(stale)).toBe(stale);
    expect(stale.highscore).toBe(6265);
    expect(stale.newRecord).toBe(false);
    watch.poll(6300, 6265);
    const beaten = watch.stamp({ ...EMPTY_HUD, score: 6300, highscore: 6300, newRecord: true });
    expect(beaten.highscore).toBe(6300);
    expect(beaten.newRecord).toBe(true);
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
