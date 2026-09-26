// Мелкие мутаторы черновика состояния. Reducer клонирует состояние целиком
// и дальше меняет копию этими функциями — так код логики остаётся читаемым.

import { EVENT_HISTORY_LIMIT, LOG_LIMIT, TOAST_LIMIT } from './config.ts';
import type { EventId, GameState, LogCategory, LogTone, ModTarget, Toast } from './types.ts';

export function pushLog(s: GameState, text: string, tone: LogTone = 'info', category: LogCategory = 'system'): void {
  s.log.push({ id: s.nextLogId, day: s.day, text, tone, category });
  s.nextLogId += 1;
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

export function pushToast(s: GameState, kind: Toast['kind'], title: string, text: string): void {
  s.toasts.push({ id: s.nextToastId, kind, title, text });
  s.nextToastId += 1;
  if (s.toasts.length > TOAST_LIMIT) s.toasts.splice(0, s.toasts.length - TOAST_LIMIT);
}

export function addModifier(
  s: GameState,
  eventId: EventId,
  label: string,
  target: ModTarget,
  value: number,
  duration: number,
): void {
  s.modifiers.push({
    id: s.nextModId,
    eventId,
    label,
    target,
    value,
    startDay: s.day,
    endsDay: s.day + duration,
  });
  s.nextModId += 1;
}

export function pushEventRecord(s: GameState, eventId: EventId, title: string, outcome: string, tone: LogTone): void {
  s.eventHistory.unshift({ id: s.nextLogId, day: s.day, eventId, title, outcome, tone });
  if (s.eventHistory.length > EVENT_HISTORY_LIMIT) s.eventHistory.length = EVENT_HISTORY_LIMIT;
}

/** Обновляет рекорды и показывает неоновое уведомление при их побитии. */
export function updateRecords(s: GameState): void {
  if (s.credits > s.stats.peakCapital) s.stats.peakCapital = s.credits;

  if (s.day > s.records.bestDays) s.records.bestDays = s.day;
  if (!s.recordFlags.days && s.baseline.days > 0 && s.day > s.baseline.days) {
    s.recordFlags.days = true;
    pushToast(s, 'record', 'Новый рекорд выживания', `Синдикат держится уже ${s.day} дн. — прошлый рекорд ${s.baseline.days} дн.`);
    pushLog(s, `НОВЫЙ РЕКОРД ВЫЖИВАНИЯ: ${s.day} дн.`, 'success', 'system');
  }

  if (s.credits > s.records.bestCapital) s.records.bestCapital = Math.floor(s.credits);
  if (!s.recordFlags.capital && s.baseline.capital > 0 && s.credits > s.baseline.capital) {
    s.recordFlags.capital = true;
    pushToast(s, 'record', 'Новый рекорд капитала', `На счетах ${Math.floor(s.credits)}₵ — прошлый рекорд ${s.baseline.capital}₵.`);
    pushLog(s, `НОВЫЙ РЕКОРД КАПИТАЛА: ${Math.floor(s.credits)}₵`, 'success', 'system');
  }
}
