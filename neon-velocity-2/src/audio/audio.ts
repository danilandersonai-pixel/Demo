// STUB: контракт звука. Владелец (агент audio-input) заменяет тело целиком, сохраняя экспортируемые сигнатуры.
import type { SimEvent } from '../core/types';
import type { UiSound } from './uiSound';

export interface AudioSettings {
  enabled: boolean;
  /** 0..1 */
  music: number;
  /** 0..1 */
  sfx: number;
}

export class AudioEngine {
  /** Создать или возобновить AudioContext. Вызывать из обработчика жеста (клик, тап, клавиша). */
  unlock(): void {}

  setSettings(_settings: AudioSettings): void {}

  /** Музыка звучит только в забеге; вне его beat-события не играют. */
  setMusicActive(_active: boolean): void {}

  /** Пауза: плавно заглушить всё звучащее, не теряя состояния. */
  setPaused(_paused: boolean): void {}

  /**
   * Событие симуляции. late — сколько секунд назад (по часам симуляции) оно
   * произошло: звук ставится на ctx.currentTime + LATENCY − late и попадает в сетку.
   */
  onEvent(_event: SimEvent, _late: number): void {}

  /** Звуки интерфейса. */
  ui(_sound: UiSound): void {}

  /** Следующее включение звука в ЭТОЙ вкладке подтвердить щелчком (см. SPEC, «Звук»). */
  armToggleConfirm(): void {}
}

/** Единственный экземпляр на приложение. */
export const audio = new AudioEngine();
