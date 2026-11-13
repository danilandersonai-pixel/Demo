/**
 * Превращение элементов трека в сущности симуляции. Вынесено отдельно, чтобы
 * симуляция, проверка честности и тесты строили объекты одинаково.
 */
import { approachTicksForLevel, OBSTACLES } from './config';
import { levelAtTick } from './timing';
import type { Crystal, CrystalSpec, Obstacle, ObstacleSpec } from './types';

/** Время подлёта определяется уровнем в момент ПРИЛЁТА — так объекты никогда не обгоняют друг друга. */
export function approachFor(arriveTick: number): number {
  return approachTicksForLevel(levelAtTick(arriveTick));
}

export function makeObstacle(spec: ObstacleSpec, id: number): Obstacle {
  const approachTicks = approachFor(spec.arriveTick);
  const preset = OBSTACLES[spec.kind];
  return {
    id,
    kind: spec.kind,
    spawnTick: spec.arriveTick - approachTicks,
    arriveTick: spec.arriveTick,
    approachTicks,
    x: spec.x,
    sway: spec.sway,
    halfW: spec.halfW,
    halfD: preset.halfD ?? spec.halfW,
    yaw0: spec.yaw0 ?? 0,
    yawRate: spec.yawRate ?? 0,
    minClear: Infinity,
    resolved: false,
    destroyed: false,
  };
}

export function makeCrystal(spec: CrystalSpec, id: number, note: number): Crystal {
  const approachTicks = approachFor(spec.arriveTick);
  return {
    id,
    spawnTick: spec.arriveTick - approachTicks,
    arriveTick: spec.arriveTick,
    approachTicks,
    x: spec.x,
    sway: spec.sway,
    rare: spec.rare,
    pull: 0,
    prevPull: 0,
    state: 'live',
    note,
  };
}

export function isObstacleSpec(item: { kind: string }): item is ObstacleSpec {
  return item.kind !== 'crystal';
}
