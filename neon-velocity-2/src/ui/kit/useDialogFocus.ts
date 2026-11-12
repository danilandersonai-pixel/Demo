import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/** Кто открыл панель и вернуть ли ему фокус при закрытии. */
interface Opener {
  element: HTMLElement;
  restore: boolean;
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
  /**
   * Открывший запоминается один раз за открытие (undefined — ещё не смотрели,
   * null — фокус был ничей). StrictMode в разработке прогоняет эффект дважды:
   * ко второму прогону фокус уже внутри диалога, а слой под панелью inert, и
   * «вернуть» фокус туда в промежуточной очистке нельзя — без ref открывший
   * терялся бы.
   */
  const opener = useRef<Opener | null | undefined>(undefined);

  useEffect(() => {
    const dialog = anchor.current?.closest<HTMLElement>('[role="dialog"]') ?? null;
    if (!dialog) return;
    if (opener.current === undefined) {
      const active = document.activeElement;
      opener.current =
        active instanceof HTMLElement && active !== document.body && !dialog.contains(active)
          ? { element: active, restore: active.matches(':focus-visible') }
          : null;
    }

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
      // Настоящее закрытие: App снимает inert со слоя под панелью в том же
      // коммите, что и закрывает её, — к концу анимации выхода кнопка снова фокусируема.
      const back = opener.current;
      if (back?.restore && back.element.isConnected) back.element.focus({ preventScroll: true });
    };
    // Ref-объекты стабильны: эффект срабатывает один раз — при открытии панели.
  }, [anchor, initial]);
}
