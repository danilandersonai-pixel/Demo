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
 * Когда экран Game Over замер: карточка въехала, счёт набрался (GAME_OVER_COUNT), глитч и
 * вывеска рекорда отыграли (hud.css, до 1.5 с), холст под экраном уже стоит (GameHost,
 * OVER_LIVE). С этого момента экран размывает фон: раньше размытие пересчитывалось бы на
 * весь экран в каждом кадре въезда. Всё, что движется на Game Over, обязано кончиться раньше.
 */
export const GAME_OVER_SETTLE_MS = 1550;

/** Набор счёта на Game Over, сек: ждёт въезда карточки и кончается вместе с глитчем. */
export const GAME_OVER_COUNT = { delay: 0.3, duration: 1.1 } as const;

/** Мягкий «экспо»-выход: быстро стартует, долго дотягивает. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const POINT_FORMS: [string, string, string] = ['очко', 'очка', 'очков'];
