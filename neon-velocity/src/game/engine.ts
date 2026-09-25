// STUB: контракт движка. Владелец (агент engine) заменяет тело полностью, сохраняя экспортируемые сигнатуры.
import type { GameEvent, GameState, HudSnapshot, InputState, Loadout, RunResult, Viewport } from './types';

export class GameEngine {
  /** Полное состояние мира; рендер читает его каждый кадр. */
  readonly state: GameState;

  constructor(_viewport: Viewport, _loadout: Loadout) {
    this.state = null as unknown as GameState;
  }

  /** Новый размер экрана: пересчитать мир (игрок остаётся внизу, в пределах поля). */
  resize(_viewport: Viewport): void {}

  /** Сменить тему/скин без перезапуска (в меню — живое превью покупок). */
  setLoadout(_loadout: Loadout): void {}

  /** Фоновая демо-сцена для меню: без столкновений, очков и событий, кроме beat. */
  enterAttract(): void {}

  /** Начать новый забег с нуля. */
  startRun(_loadout: Loadout): void {}

  /** Состояние ввода на этот кадр. */
  setInput(_input: InputState): void {}

  /** Продвинуть симуляцию на dt реальных секунд (внутри — подшаги GAME.fixedStep). */
  update(_dt: number): void {}

  /** Забрать накопленные события (очередь очищается). */
  drainEvents(): GameEvent[] {
    return [];
  }

  /** Снимок для HUD (fps заполняет GameCanvas). */
  getHud(): HudSnapshot {
    return null as unknown as HudSnapshot;
  }

  /** Итог последнего завершённого забега или null. */
  getRunResult(): RunResult | null {
    return null;
  }
}
