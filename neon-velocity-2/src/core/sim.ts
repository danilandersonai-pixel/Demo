// STUB: контракт симуляции. Владелец (агент sim) заменяет тело целиком, сохраняя экспортируемые сигнатуры.
import type { ChartSource, HudSnapshot, InputFrame, RunResult, SimEvent, SimLoadout, SimState } from './types';

/**
 * Детерминированная симуляция игры: без DOM, без Math.random, без реального
 * времени. Один вызов step() — ровно один тик (1/128 с).
 */
export class Simulation {
  /** Полное состояние; меняет его только сама симуляция. */
  readonly state: SimState;

  constructor() {
    this.state = null as unknown as SimState;
  }

  /** Фоновая сцена для меню: tick = 0, корабль на автопилоте, без столкновений, очков и событий, кроме beat. */
  startAttract(_seed: number): void {}

  /**
   * Новый забег: tick = −LEAD_IN_TICKS, режим ready. Сразу кладёт в очередь
   * события ready и beat первого тика. chart по умолчанию —
   * createChart(seed, { rareChance: loadout.rareChance }).
   */
  startRun(_seed: number, _loadout: SimLoadout, _chart?: ChartSource): void {}

  /** Продвинуть симуляцию ровно на один тик. */
  step(_input: InputFrame): void {}

  /** Забрать накопленные события (очередь очищается). */
  drainEvents(): SimEvent[] {
    return [];
  }

  /** Снимок для HUD (fps заполняет хост). */
  hud(): HudSnapshot {
    return null as unknown as HudSnapshot;
  }

  /** Итог завершённого забега (после gameOver) или null. */
  result(): RunResult | null {
    return null;
  }

  /**
   * Итог забега, который игрок бросил (пауза → меню / заново, закрытие вкладки).
   * null, если забега нет, он уже завершён или в нём ещё ничего не заработано.
   */
  abandon(): RunResult | null {
    return null;
  }
}
