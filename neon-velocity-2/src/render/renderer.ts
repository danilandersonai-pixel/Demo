// STUB: контракт рендера. Владелец (агент renderer) заменяет тело целиком, сохраняя экспортируемые сигнатуры.
import type { SimEvent, SimState, Skin, Theme } from '../core/types';
import { makeCamera, type Camera } from './camera';

export interface RenderFrame {
  state: SimState;
  /** Доля тика 0..1: рендер рисует мир в момент state.tick − 1 + alpha (интерполяция между тиками). */
  alpha: number;
  theme: Theme;
  skin: Skin;
  /** Реальное время, сек — для косметических анимаций, не связанных с тиками. */
  now: number;
  /** Игра на паузе: кадр статичен. */
  paused: boolean;
  /** Тряска камеры включена в настройках. */
  shake: boolean;
  /** Пользователь просит меньше движения: без тряски, рывков камеры и вспышек. */
  reducedMotion: boolean;
}

export class Renderer {
  camera: Camera;

  constructor(_canvas: HTMLCanvasElement) {
    this.camera = makeCamera(1, 1, 1);
  }

  /** Новый размер холста; возвращает актуальную камеру (она же нужна вводу). */
  resize(cssW: number, cssH: number, dpr: number): Camera {
    this.camera = makeCamera(cssW, cssH, dpr);
    return this.camera;
  }

  /** Событие симуляции: частицы, вспышки, тряска — вся косметика живёт в рендере. */
  onEvent(_event: SimEvent, _state: SimState): void {}

  /** Сбросить косметику (частицы, тряску) перед новым забегом или сценой. */
  reset(): void {}

  /** Нарисовать кадр целиком. */
  render(_frame: RenderFrame): void {}

  /** Освободить кэши и офскрин-холсты. */
  dispose(): void {}
}
