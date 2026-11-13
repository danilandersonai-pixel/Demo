/** Общие константы и форматтеры меню (файлы компонентов экспортируют только компоненты). */
import type { Variants } from 'framer-motion';

/** Мягкий «экспо»-выход: быстро стартует, долго дотягивает. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Каскадное появление блоков внутри панели. */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.06 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.36, ease: EASE_OUT } },
};

const NBSP = ' ';

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

export const CRYSTAL_FORMS: [string, string, string] = ['кристалл', 'кристалла', 'кристаллов'];

/** id вкладки и её панели — для связки aria-controls / aria-labelledby. */
export function tabId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

export function tabPanelId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}

/** useId() в React содержит символы, непригодные для url(#…) в SVG. */
export function svgId(reactId: string): string {
  return 'nv' + reactId.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Снять «мышиный» фокус с кнопки после нажатия. Фокус, пришедший с клавиатуры,
 * остаётся: по нему useDialogFocus вернёт фокус после закрытия панели. А после
 * клика или тапа фокус должен остаться ничьим — тогда Enter в меню запускает
 * забег, а не нажимает последнюю тронутую кнопку ещё раз.
 */
export function releasePointerFocus(el: HTMLElement): void {
  if (!el.matches(':focus-visible')) el.blur();
}
