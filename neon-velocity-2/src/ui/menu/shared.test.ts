import { describe, expect, it } from 'vitest';
import { formatBonus, formatPercent, formatPlayTime, svgId, tabId, tabPanelId } from './shared';

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
