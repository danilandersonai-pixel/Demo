// STUB: контракт ввода. Владелец (агент audio-input) заменяет тело полностью, сохраняя экспортируемые сигнатуры.
import type { InputState } from './types';

export class InputController {
  /**
   * Подписаться на клавиатуру (window) и указатель (target).
   * toWorldX переводит clientX события в мировой X.
   */
  attach(_target: HTMLElement, _toWorldX: (clientX: number) => number): void {}

  /** Снять все слушатели. */
  detach(): void {}

  /** Вне забега ввод выключен: состояние нейтральное, preventDefault не вызывается. */
  setEnabled(_enabled: boolean): void {}

  getState(): InputState {
    return { axis: 0, pointerX: null, lastSource: 'none' };
  }

  /** Сбросить зажатые клавиши и указатель (старт забега, потеря фокуса). */
  reset(): void {}
}
