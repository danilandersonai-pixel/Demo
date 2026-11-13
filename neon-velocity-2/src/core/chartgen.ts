/**
 * Генератор трека. По зерну выдаёт такт за тактом препятствия и сферы,
 * привязанные к сетке шестнадцатых: музыкальные фразы по восемь тактов,
 * именованные паттерны, цепочки сфер вдоль одной линии мелодии.
 *
 * Трек детерминирован и проходим по построению: каждое препятствие принимает
 * коридор честности (chart-corridor.ts) на той же сетке, что и verifyChart.
 *
 *   chartgen.ts        — вход: порядок тактов и короткая память
 *   chart-plan.ts      — композитор: драматургия уровня, формы тактов, сферы
 *   chart-patterns.ts  — библиотека паттернов
 *   chart-melody.ts    — линия мелодии, на которую нанизаны сферы
 *   chart-corridor.ts  — коридор честности
 */
import type { CorridorStats } from './chart-corridor';
import { Composer } from './chart-plan';
import { BARS_PER_LEVEL } from './timing';
import type { ChartItem, ChartOptions, ChartSource } from './types';

/** Сколько последних тактов помнить: симуляция берёт такт один раз, память нужна лишь на повторный запрос. */
const KEEP_BARS = BARS_PER_LEVEL;

/** Трек с диагностикой коридора — для тестов и инструментов баланса. */
export interface InspectableChart extends ChartSource {
  /** Статистика честности по уже сочинённым тактам. */
  stats(): CorridorStats;
}

export function createInspectableChart(seed: number, options: ChartOptions): InspectableChart {
  let composer = new Composer(seed, options);
  let recent: ChartItem[][] = [];
  /** Номер следующего несочинённого такта. */
  let next = 0;
  return {
    bar(index) {
      if (!Number.isInteger(index) || index < 0) return [];
      if (index < next - recent.length) {
        // Такт уже забыт. Трек детерминирован — сочиняем заново с начала.
        composer = new Composer(seed, options);
        recent = [];
        next = 0;
      }
      // Такт зависит от предыдущих, поэтому пропущенные сочиняются по дороге.
      while (next <= index) {
        recent.push(composer.compose(next));
        next += 1;
        if (recent.length > KEEP_BARS) recent.shift();
      }
      return recent[index - (next - recent.length)].slice();
    },
    stats: () => composer.stats,
  };
}

/**
 * Процедурный трек: по зерну выдаёт такт за тактом препятствия и сферы,
 * привязанные к сетке шестнадцатых. Детерминирован и гарантированно проходим
 * (см. verifyChart в bot.ts).
 */
export function createChart(seed: number, options: ChartOptions): ChartSource {
  return createInspectableChart(seed, options);
}
