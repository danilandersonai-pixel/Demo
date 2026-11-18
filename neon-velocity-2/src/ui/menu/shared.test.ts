import { describe, expect, it } from 'vitest';
import { GAME, OBSTACLES } from '../../core/config';
import { fitFontSize, formatBonus, formatPercent, formatPlayTime, levelRulesText, sinceOrdinal, svgId, tabId, tabPanelId } from './shared';

const NBSP = ' ';

describe('форматтеры меню', () => {
  it('проценты и бонусы отделяют знак % неразрывным пробелом', () => {
    expect(formatBonus(0.1)).toBe(`+10${NBSP}%`);
    expect(formatBonus(0.15)).toBe(`+15${NBSP}%`);
    expect(formatBonus(0)).toBe(`+0${NBSP}%`);
    expect(formatPercent(0.14)).toBe(`14${NBSP}%`);
    // 0.06 + 0.04 * 3 в двоичной арифметике не ровно 0.18 — округление обязано это скрыть.
    expect(formatPercent(0.06 + 0.04 * 3)).toBe(`18${NBSP}%`);
  });

  it('время в забегах: секунды, минуты с секундами, часы с минутами', () => {
    expect(formatPlayTime(0)).toBe(`0${NBSP}с`);
    expect(formatPlayTime(45.9)).toBe(`45${NBSP}с`);
    expect(formatPlayTime(725)).toBe(`12${NBSP}мин 05${NBSP}с`);
    expect(formatPlayTime(3600)).toBe(`1${NBSP}ч 00${NBSP}мин`);
    expect(formatPlayTime(11_250)).toBe(`3${NBSP}ч 07${NBSP}мин`);
    expect(formatPlayTime(-5)).toBe(`0${NBSP}с`);
  });
});

describe('уровни в справке', () => {
  it('предлог «со» — только перед «второго» и «сто …»', () => {
    expect(sinceOrdinal(2)).toBe(`со${NBSP}2-го`);
    expect(sinceOrdinal(101)).toBe(`со${NBSP}101-го`);
    expect(sinceOrdinal(199)).toBe(`со${NBSP}199-го`);
    for (const n of [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 20, 21, 22, 32, 100, 200, 202, 1002]) {
      expect(sinceOrdinal(n)).toBe(`с${NBSP}${n}-го`);
    }
  });

  it('равные уровни называются один раз, одним предложением', () => {
    expect(levelRulesText(2, 2)).toBe(
      `Со${NBSP}2-го уровня препятствия идут зигзагом и появляются лазерные ворота — чем дальше, тем у\u0301же проход.`,
    );
    expect(levelRulesText(3, 3)).toBe(
      `С${NBSP}3-го уровня препятствия идут зигзагом и появляются лазерные ворота — чем дальше, тем у\u0301же проход.`,
    );
  });

  it('разные уровни — два предложения по возрастанию, у каждого свой предлог', () => {
    expect(levelRulesText(2, 4)).toBe(
      `Со${NBSP}2-го уровня препятствия идут зигзагом. С${NBSP}4-го уровня появляются лазерные ворота — и чем дальше, тем у\u0301же проход.`,
    );
    expect(levelRulesText(3, 2)).toBe(
      `Со${NBSP}2-го уровня появляются лазерные ворота — и чем дальше, тем у\u0301же проход. С${NBSP}3-го уровня препятствия идут зигзагом.`,
    );
  });

  it('при любых значениях конфига каждый уровень назван один раз и со своим предлогом', () => {
    for (let sway = 1; sway <= 12; sway++) {
      for (let laser = 1; laser <= 12; laser++) {
        const text = levelRulesText(sway, laser);
        const named = [...text.matchAll(/(Со|С|со|с)\u00a0(\d+)-го уровня/g)].map((m) => [m[1].toLowerCase(), Number(m[2])] as const);
        expect(named.map(([, n]) => n)).toEqual(sway === laser ? [sway] : [Math.min(sway, laser), Math.max(sway, laser)]);
        for (const [prep, n] of named) expect(prep).toBe(n === 2 ? 'со' : 'с');
        // Ни одного «N-го» без слова «уровня»: «с 3-го препятствия» читалось бы как «с третьего препятствия».
        expect(text.match(/-го/g)?.length).toBe(named.length);
        expect(text).toMatch(/^С/);
        expect(text.endsWith('.')).toBe(true);
      }
    }
  });

  it('текущий баланс: оба уровня из конфига попадают в абзац', () => {
    const text = levelRulesText(GAME.sway.startLevel, OBSTACLES.laser.minLevel);
    expect(text.toLowerCase()).toContain(`${sinceOrdinal(OBSTACLES.laser.minLevel)} уровня`);
    expect(text.toLowerCase()).toContain(`${sinceOrdinal(GAME.sway.startLevel)} уровня`);
  });
});

describe('fitFontSize', () => {
  // Разбор строки вида min(1.25rem, calc((100cqi - 1px) / 5.85)): кегль в px для ширины контейнера.
  function resolve(css: string, containerPx: number): number {
    const m = /^min\(([\d.]+)rem, calc\(\(100cqi - 1px\) \/ ([\d.]+)\)\)$/.exec(css);
    if (!m) throw new Error(`неожиданный формат: ${css}`);
    return Math.min(Number(m[1]) * 16, (containerPx - 1) / Number(m[2]));
  }
  /** Ширина строки при таком кегле: знак 0.6em плюс разрядка. */
  function widthAt(chars: number, fontPx: number, tracking: number): number {
    return chars * (0.6 + tracking) * fontPx;
  }

  it('короткая строка остаётся на полном кегле', () => {
    // «9 999 999» (9 знаков) в колонке 118px — прежние 20px.
    expect(resolve(fitFontSize(9, 1.25, 0.05), 118)).toBe(20);
    expect(resolve(fitFontSize(2, 0.875, 0.025), 78)).toBe(14);
  });

  it('длинная строка сжимается ровно до ширины контейнера', () => {
    for (const container of [102, 118, 140, 156, 280]) {
      for (const chars of [9, 11, 13, 15, 21]) {
        for (const [maxRem, tracking] of [
          [1.25, 0.05],
          [0.875, 0.025],
        ] as const) {
          const px = resolve(fitFontSize(chars, maxRem, tracking), container);
          expect(px).toBeLessThanOrEqual(maxRem * 16);
          expect(widthAt(chars, px, tracking)).toBeLessThanOrEqual(container);
          // Сжатие не больше необходимого: либо полный кегль, либо строка во всю ширину.
          if (px < maxRem * 16) expect(widthAt(chars, px, tracking)).toBeGreaterThan(container - 1.5);
        }
      }
    }
  });

  it('пустая строка не делит на ноль', () => {
    expect(fitFontSize(0, 1, 0)).toBe('min(1rem, calc((100cqi - 1px) / 0.6))');
  });
});

describe('идентификаторы', () => {
  it('вкладка и её панель ссылаются друг на друга парой id', () => {
    expect(tabId('nv-shop', 'skins')).toBe('nv-shop-tab-skins');
    expect(tabPanelId('nv-shop', 'skins')).toBe('nv-shop-panel-skins');
  });

  it('svgId убирает из useId() символы, непригодные для url(#…)', () => {
    expect(svgId(':r1:')).toBe('nvr1');
    expect(svgId('«r2»')).toBe('nvr2');
    expect(svgId('_r_3_')).toBe('nv_r_3_');
    expect(svgId(':r1:')).toMatch(/^[A-Za-z][\w-]*$/);
  });
});
