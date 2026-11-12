// STUB: контракт генератора трека. Владелец (агент chart) заменяет тело целиком, сохраняя экспортируемые сигнатуры.
import type { ChartOptions, ChartSource } from './types';

/**
 * Процедурный трек: по зерну выдаёт такт за тактом препятствия и сферы,
 * привязанные к сетке шестнадцатых. Детерминирован и гарантированно проходим
 * (см. verifyChart в bot.ts).
 */
export function createChart(_seed: number, _options: ChartOptions): ChartSource {
  return { bar: () => [] };
}
