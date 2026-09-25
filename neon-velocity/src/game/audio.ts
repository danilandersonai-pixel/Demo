// STUB: контракт звука. Владелец (агент audio-input) заменяет тело полностью, сохраняя экспортируемые сигнатуры.
import type { GameEvent } from './types';
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

  /** Музыка звучит только во время забега; вне забега beat-события игнорируются. */
  setMusicActive(_active: boolean): void {}

  /** Пауза: заглушить звучащие голоса, не теряя состояния. */
  setPaused(_paused: boolean): void {}

  /** Все события движка: beat → музыка, остальные → звуковые эффекты. */
  handleEvent(_event: GameEvent): void {}

  /** Звуки интерфейса. */
  ui(_sound: UiSound): void {}
}

/** Единственный экземпляр на приложение. */
export const audio = new AudioEngine();
