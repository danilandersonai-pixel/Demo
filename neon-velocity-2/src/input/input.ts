// STUB: контракт ввода. Владелец (агент audio-input) заменяет тело целиком, сохраняя экспортируемые сигнатуры.
import type { InputFrame } from '../core/types';

export class InputController {
  /**
   * Подписаться на клавиатуру (window) и указатель (target).
   * toRoadX переводит clientX события в X на дороге (см. screenToRoadX).
   */
  attach(_target: HTMLElement, _toRoadX: (clientX: number) => number): void {}

  /** Снять все слушатели. */
  detach(): void {}

  /** Вне забега ввод выключен: кадр нейтральный, preventDefault не вызывается. */
  setEnabled(_enabled: boolean): void {}

  /** Ввод на текущий тик. */
  frame(): InputFrame {
    return { axis: 0, pointerX: null, source: 'none' };
  }

  /** Сбросить зажатые клавиши и указатель (старт забега, потеря фокуса). */
  reset(): void {}
}
