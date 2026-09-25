import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Фокус модальной панели: при открытии — внутрь диалога (на initial или на
 * первый интерактивный элемент), Tab/Shift+Tab циклятся внутри. При закрытии
 * фокус возвращается на кнопку, открывшую панель, — но только если её выбрали
 * с клавиатуры: после клика мышью фокус остаётся «ничьим», и Enter в меню
 * запускает забег, а не открывает панель заново. anchor — любой элемент
 * внутри диалога: Panel не пробрасывает ref, диалог находится через closest().
 */
export function useDialogFocus(anchor: RefObject<HTMLElement | null>, initial?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const dialog = anchor.current?.closest<HTMLElement>('[role="dialog"]') ?? null;
    if (!dialog) return;
    const opener = document.activeElement;
    const previous = opener instanceof HTMLElement && !dialog.contains(opener) ? opener : null;
    const restore = previous?.matches(':focus-visible') ?? false;

    const target = initial?.current ?? focusables(dialog)[0] ?? null;
    target?.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables(dialog);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !dialog.contains(active);
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (restore && previous?.isConnected) previous.focus({ preventScroll: true });
    };
    // Ref-объекты стабильны: эффект срабатывает один раз — при открытии панели.
  }, [anchor, initial]);
}
