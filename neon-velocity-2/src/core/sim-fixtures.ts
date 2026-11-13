/**
 * Заготовки для тестов и замеров симуляции (в игру не попадают): короткие
 * конструкторы элементов трека, трек-шпион и простой процедурный трек с
 * гарантированным проходом — «полосой», вдоль которой нет препятствий.
 */
import { GAME, OBSTACLES, WORLD } from './config';
import { createRng } from './rng';
import { levelAtTick, TICKS_PER_BAR, TICKS_PER_BEAT, TICKS_PER_EIGHTH, TICKS_PER_STEP } from './timing';
import type { ChartItem, ChartSource, CrystalSpec, InputFrame, ObstacleSpec, SimState, Sway } from './types';

export const ROAD_CENTER = WORLD.roadW / 2;

export function crystalAt(arriveTick: number, x = ROAD_CENTER, rare = false): CrystalSpec {
  return { kind: 'crystal', arriveTick, x, sway: null, rare };
}

export function cubeAt(arriveTick: number, x = ROAD_CENTER, halfW = 5, sway: Sway | null = null): ObstacleSpec {
  return { kind: 'cube', arriveTick, x, sway, halfW, yaw0: 0, yawRate: 0 };
}

export function sawAt(arriveTick: number, x = ROAD_CENTER, halfW = 6, sway: Sway | null = null): ObstacleSpec {
  return { kind: 'saw', arriveTick, x, sway, halfW };
}

/** Лазерные ворота: x — центр прохода, halfW — половина его ширины. */
export function laserAt(arriveTick: number, x = ROAD_CENTER, halfW = 12, sway: Sway | null = null): ObstacleSpec {
  return { kind: 'laser', arriveTick, x, sway, halfW };
}

export function keyboard(axis: number): InputFrame {
  return { axis, pointerX: null, source: 'keyboard' };
}

// ─── Трек-шпион ─────────────────────────────────────────────────────────────

export interface BarRequest {
  bar: number;
  /** Тик симуляции в момент запроса. */
  tick: number;
}

/** Обёртка, которая записывает, какие такты и когда запросила симуляция. */
export function spyChart(inner: ChartSource, clock: () => number): { chart: ChartSource; requests: BarRequest[] } {
  const requests: BarRequest[] = [];
  return {
    requests,
    chart: {
      bar(index) {
        requests.push({ bar: index, tick: clock() });
        return inner.bar(index);
      },
    },
  };
}

// ─── Трек с полосой ─────────────────────────────────────────────────────────

export interface LaneChartOptions {
  /** Препятствий в такте в зависимости от уровня (по умолчанию 2 + уровень, не больше 12). */
  obstacles?: (level: number) => number;
  /** Сфер в такте, 0–16: на восьмых, при числе больше 8 — на шестнадцатых (по умолчанию 8). */
  crystals?: number;
  /** Доля сфер, стоящих на полосе; остальные разбросаны в стороне от неё (по умолчанию 1). */
  crystalsOnLane?: number;
  /** Шанс редкой сферы (по умолчанию базовый). */
  rareChance?: number;
  /** Шанс лазерных ворот в такте со 2-го уровня (по умолчанию 0.35). */
  laserChance?: number;
  /** Шанс зигзага у препятствия со 2-го уровня (по умолчанию 0.4). */
  swayChance?: number;
  /** Уровень сложности не растёт: всегда этот (для фоновой сцены). */
  fixedLevel?: number;
  /** Наибольший сдвиг полосы за такт (по умолчанию 20). */
  laneStep?: number;
}

export interface LaneChart extends ChartSource {
  /** X свободной полосы в тик tick: вдоль неё гарантированно нет препятствий. */
  laneAt(tick: number): number;
}

/** Запас между полосой и краем хитбокса препятствия в момент прилёта. */
const LANE_MARGIN = GAME.player.radius + 4.5;
const LANE_MIN = 20;
const LANE_MAX = WORLD.roadW - 20;
const LASER_HALF_GAP = 12;

/**
 * Процедурный трек для тестов. Полоса блуждает от такта к такту не быстрее
 * laneStep; препятствия ставятся только в стороне от неё, ворота — проходом
 * на ней, сферы — вдоль неё. Детерминирован и не зависит от порядка запросов.
 */
export function laneChart(seed: number, options: LaneChartOptions = {}): LaneChart {
  const root = createRng(seed);
  const laneStep = options.laneStep ?? 20;
  const anchors: number[] = [ROAD_CENTER];
  const anchor = (bar: number): number => {
    while (anchors.length <= bar) {
      const prev = anchors[anchors.length - 1];
      const next = prev + root.fork(1000 + anchors.length).range(-laneStep, laneStep);
      anchors.push(Math.min(LANE_MAX, Math.max(LANE_MIN, next)));
    }
    return anchors[Math.max(0, bar)];
  };
  const laneAt = (tick: number): number => {
    const bar = Math.max(0, Math.floor(tick / TICKS_PER_BAR));
    const a = anchor(bar);
    const b = anchor(bar + 1);
    return a + ((b - a) * Math.max(0, tick - bar * TICKS_PER_BAR)) / TICKS_PER_BAR;
  };

  const bar = (index: number): ChartItem[] => {
    const rng = root.fork(index);
    const start = index * TICKS_PER_BAR;
    const level = options.fixedLevel ?? levelAtTick(start);
    const items: ChartItem[] = [];

    const crystals = Math.min(16, options.crystals ?? 8);
    const crystalStep = crystals > 8 ? TICKS_PER_STEP : TICKS_PER_EIGHTH;
    for (let k = 0; k < crystals; k++) {
      const tick = start + k * crystalStep;
      if (tick < 2 * TICKS_PER_BEAT) continue;
      const onLane = rng.chance(options.crystalsOnLane ?? 1);
      const side = rng.chance(0.5) ? 1 : -1;
      const x = onLane ? laneAt(tick) : Math.min(95, Math.max(5, laneAt(tick) + side * rng.range(14, 40)));
      items.push(crystalAt(tick, x, rng.chance(options.rareChance ?? GAME.crystal.rareChance)));
    }

    if (index < GAME.firstObstacleBar) return items;
    const laserStep = level >= OBSTACLES.laser.minLevel && rng.chance(options.laserChance ?? 0.35) ? rng.int(0, 15) : -1;
    if (laserStep >= 0) items.push(laserAt(start + laserStep * TICKS_PER_STEP, laneAt(start + laserStep * TICKS_PER_STEP), LASER_HALF_GAP));

    const count = Math.min(12, options.obstacles ? options.obstacles(level) : 2 + level) - (laserStep >= 0 ? 1 : 0);
    for (let n = 0; n < count; n++) {
      const step = rng.int(0, 15);
      // Рядом с воротами другие препятствия не ставим: у прохода и так тесно.
      if (laserStep >= 0 && Math.abs(step - laserStep) < 2) continue;
      const tick = start + step * TICKS_PER_STEP;
      const kind = rng.chance(0.6) ? 'cube' : 'saw';
      const preset = OBSTACLES[kind];
      const halfW = rng.range(preset.sizeMin, preset.sizeMax);
      const extent = kind === 'cube' ? halfW * GAME.hitbox.cube * Math.SQRT2 : halfW * GAME.hitbox.saw;
      const lane = laneAt(tick);
      const minOffset = extent + LANE_MARGIN;
      const side = rng.chance(0.5) ? 1 : -1;
      const room = side > 0 ? WORLD.roadW - halfW - (lane + minOffset) : lane - minOffset - halfW;
      if (room <= 0) continue;
      const x = lane + side * (minOffset + rng.range(0, room));
      const sway: Sway | null =
        level >= GAME.sway.startLevel && rng.chance(options.swayChance ?? 0.4)
          ? { amp: Math.min(9, Math.min(x - halfW, WORLD.roadW - halfW - x) / 2), periodTicks: 280, phase: rng.range(0, Math.PI * 2) }
          : null;
      if (kind === 'cube') {
        const spin = (rng.range(preset.spinMin, preset.spinMax) * (rng.chance(0.5) ? 1 : -1)) / 128;
        items.push({ kind, arriveTick: tick, x, sway: sway && sway.amp > 0.5 ? sway : null, halfW, yaw0: rng.range(0, Math.PI), yawRate: spin });
      } else {
        items.push({ kind, arriveTick: tick, x, sway: sway && sway.amp > 0.5 ? sway : null, halfW });
      }
    }
    return items;
  };

  return { bar, laneAt };
}

/** Ввод «вести корабль по полосе» — указателем, чуть с упреждением. */
export function followLane(chart: LaneChart): (state: SimState) => InputFrame {
  const frame: InputFrame = { axis: 0, pointerX: ROAD_CENTER, source: 'pointer' };
  return (state) => {
    frame.pointerX = chart.laneAt(state.tick + 6);
    return frame;
  };
}
