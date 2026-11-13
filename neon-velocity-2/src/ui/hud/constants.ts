/** Общие константы оболочки (отдельный модуль — файлы компонентов экспортируют только компоненты). */
import type { BannerKind } from '../../core/types';

/** «Полка» баннеров по высоте: вверху — рекорд, в середине — старт и уровни, ниже — щит и комбо. */
export type BannerShelf = 'top' | 'mid' | 'low';

export const SHELVES: readonly BannerShelf[] = ['top', 'mid', 'low'];

/**
 * На полке живёт один баннер: новый вытесняет прежний (это делает GameHost),
 * иначе надписи одной линии печатались бы друг поверх друга.
 */
export const BANNER_SHELF: Record<BannerKind, BannerShelf> = {
  newRecord: 'top',
  ready: 'mid',
  go: 'mid',
  levelUp: 'mid',
  shield: 'low',
  comboBreak: 'low',
  comboUp: 'low',
  overdrive: 'low',
};

/**
 * Первые миллисекунды экран Game Over не слушает клавиши и тапы: игрок ещё
 * жмёт клавиши забега и не должен случайно начать новый или уйти в меню.
 */
export const GAME_OVER_ARM_MS = 650;

/**
 * NeonButton прячет подсказку клавиши только на узком экране; телефон боком
 * шире sm, поэтому контейнер кнопок прячет клавиши ещё и по «пальцу».
 */
export const HIDE_KBD_ON_TOUCH = 'max-sm:[&_kbd]:hidden pointer-coarse:[&_kbd]:hidden';

/** Мягкий «экспо»-выход: быстро стартует, долго дотягивает. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const POINT_FORMS: [string, string, string] = ['очко', 'очка', 'очков'];
