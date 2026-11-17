/**
 * Отладочный интерфейс для автотестов в браузере и инструментов баланса.
 * Доступен только в режиме разработки или когда в адресе есть «debug»
 * (?debug или #debug) — в обычной игре window.__NV__ не существует.
 * Устанавливает его GameHost (см. SPEC, «Хост»).
 */
import type { BotOptions } from './core/bot';
import type { Simulation } from './core/sim';
import type { InputFrame, Screen, SimEvent, SimState } from './core/types';
import type { Camera } from './render/camera';

export interface DebugApi {
  /** Симуляция — читать state, не вызывать step() самому. */
  sim: Simulation;
  /**
   * Текущий экран приложения. Сразу после паузы экран уже 'playing', но мир ещё стоит
   * две доли (отсчёт «2», «1») — тики пойдут, когда resumeCount() вернёт 0.
   */
  screen(): Screen;
  /** Актуальная камера (перевод координат мир ↔ экран). */
  camera(): Camera;
  /** Подменить ввод игрока функцией от состояния; null возвращает управление. */
  setInput(fn: ((state: SimState) => InputFrame) | null): void;
  /** Включить бота-планировщика (planMove) вместо игрока; false — выключить. */
  autopilot(on: boolean, options?: BotOptions): void;
  /** Все события симуляции с момента последнего вызова (копятся, пока включён debug). */
  takeEvents(): SimEvent[];
  /** Сколько тиков симуляции и кадров отрисовки прошло с загрузки. */
  counters(): { ticks: number; frames: number };
  /**
   * Отсчёт после паузы: цифра на экране — сколько долей мир ещё стоит (2, 1); 0 — отсчёта
   * нет. Пока он идёт, screen() === 'playing' и ввод включён (цель руления меняется), но
   * counters().ticks и sim.state.tick стоят. Отсчёт обрывают пауза, «Заново» и выход в меню.
   */
  resumeCount(): number;
}

declare global {
  interface Window {
    __NV__?: DebugApi;
  }
}

export function debugEnabled(): boolean {
  try {
    return import.meta.env.DEV || /debug/.test(window.location.search) || /debug/.test(window.location.hash);
  } catch {
    return false;
  }
}

export function installDebug(api: DebugApi): () => void {
  if (!debugEnabled()) return () => {};
  window.__NV__ = api;
  return () => {
    if (window.__NV__ === api) delete window.__NV__;
  };
}
