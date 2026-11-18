/**
 * Помощники для тестов и инструментов баланса: трек «по сценарию», прогон
 * симуляции на N тиков, сбор событий.
 */
import { floorDiv, TICKS_PER_BAR } from './timing';
import type { ChartItem, ChartSource, InputFrame, SimEvent, SimState } from './types';

export const IDLE: InputFrame = { axis: 0, pointerX: null, source: 'none' };

/** Ввод «держать корабль в точке x» (указателем). */
export function holdAt(x: number): InputFrame {
  return { axis: 0, pointerX: x, source: 'pointer' };
}

/** Трек из заранее заданных объектов: каждый попадает в такт своего arriveTick. */
export function scriptedChart(items: ChartItem[]): ChartSource {
  const byBar = new Map<number, ChartItem[]>();
  for (const item of items) {
    const bar = floorDiv(item.arriveTick, TICKS_PER_BAR);
    const list = byBar.get(bar);
    if (list) list.push(item);
    else byBar.set(bar, [item]);
  }
  return { bar: (index) => byBar.get(index) ?? [] };
}

/** Пустой трек: ни препятствий, ни сфер. */
export const EMPTY_CHART: ChartSource = { bar: () => [] };

interface Steppable {
  readonly state: SimState;
  step(input: InputFrame): void;
  drainEvents(): SimEvent[];
}

/**
 * Прогнать симуляцию до тика untilTick включительно. input — постоянный ввод
 * или функция от состояния (бот). Возвращает все события за прогон.
 */
export function runUntil(sim: Steppable, untilTick: number, input: InputFrame | ((state: SimState) => InputFrame) = IDLE): SimEvent[] {
  const events: SimEvent[] = [];
  let guard = 0;
  while (sim.state.tick < untilTick) {
    sim.step(typeof input === 'function' ? input(sim.state) : input);
    for (const e of sim.drainEvents()) events.push(e);
    if (++guard > 5_000_000) throw new Error('runUntil: симуляция не продвигает tick');
  }
  return events;
}

export function eventsOf<T extends SimEvent['type']>(events: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** В состоянии нет NaN и бесконечностей (кроме minClear = Infinity у препятствий). */
export function findBadNumber(value: unknown, path = 'state'): string | null {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return path;
    if (!Number.isFinite(value) && !path.endsWith('.minClear')) return path;
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const bad = findBadNumber(value[i], `${path}[${i}]`);
      if (bad) return bad;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const bad = findBadNumber(v, `${path}.${k}`);
      if (bad) return bad;
    }
  }
  return null;
}
