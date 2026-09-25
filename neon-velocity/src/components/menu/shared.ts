/** Общие константы и форматтеры меню (отдельный модуль — файлы компонентов экспортируют только компоненты). */
import type { Variants } from 'framer-motion';

/** Мягкий «экспо»-выход: быстро стартует, долго дотягивает. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * NeonButton прячет подсказку клавиши классом «hidden sm:inline-flex», но у Kbd
 * свой «inline-flex», и в сборке он побеждает — на телефоне подсказки вылезают.
 * Селектор потомка сильнее одиночного класса: контейнер прячет их сам.
 */
export const HIDE_KBD_ON_PHONE = 'max-sm:[&_kbd]:hidden';

/** Карточки магазина въезжают каскадом при смене вкладки (метки — как у панели вкладки). */
export const cardVariants: Variants = {
  enter: { opacity: 0, y: 14, scale: 0.98 },
  center: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: EASE_OUT } },
};

const NBSP = '\u00a0';

/** 0.1 → «+10 %» (по-русски процент отделяется неразрывным пробелом). */
export function formatBonus(fraction: number): string {
  return `+${Math.round(fraction * 100)}${NBSP}%`;
}

/** 0.14 → «14 %». */
export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}${NBSP}%`;
}

/** Суммарное время в забегах: «45 с», «12 мин 05 с», «3 ч 07 мин». */
export function formatPlayTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}${NBSP}с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}${NBSP}мин ${String(s % 60).padStart(2, '0')}${NBSP}с`;
  const h = Math.floor(m / 60);
  return `${h}${NBSP}ч ${String(m % 60).padStart(2, '0')}${NBSP}мин`;
}

/** id вкладки и её панели — для связки aria-controls / aria-labelledby. */
export function tabId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

export function tabPanelId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}
