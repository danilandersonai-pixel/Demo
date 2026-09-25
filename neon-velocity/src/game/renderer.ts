// STUB: контракт рендера. Владелец (агент renderer) заменяет тело полностью, сохраняя экспортируемые сигнатуры.
import type { GameState, Viewport } from './types';

export interface RenderOptions {
  /** Тряска экрана включена в настройках. */
  shake: boolean;
  /** Игра на паузе: кадр статичен, можно приглушить сцену. */
  paused: boolean;
}

export class Renderer {
  constructor(_canvas: HTMLCanvasElement) {}

  /** Выставить размер холста: canvas.width = cssW * dpr и т. д. */
  resize(_viewport: Viewport): void {}

  /** Нарисовать кадр целиком. */
  render(_state: GameState, _options: RenderOptions): void {}

  /** Освободить кэши и офскрин-холсты. */
  dispose(): void {}
}
