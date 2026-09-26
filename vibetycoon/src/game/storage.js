// Сохранение партии и рекордов в localStorage.
// Все обращения обёрнуты в try/catch: в приватном режиме хранилище может быть недоступно.

import { RECORDS_KEY, SAVE_KEY } from './config.js';
import { hydrate } from './engine.js';

export const EMPTY_RECORDS = {
  maxIncome: 0, // максимальный средний чистый доход в час (скользящее среднее за 6 ч)
  maxIncomeAt: null,
  maxStreak: 0, // самая долгая работа без критических галлюцинаций, ч
  maxStreakAt: null,
  autonomyWins: 0, // сколько раз достигнута полная автономия
  fastestAutonomy: null, // за сколько игровых часов
  gamesStarted: 1,
  seenHelp: false,
};

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return hydrate(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

export function saveGame(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

export function clearGame() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    /* хранилище недоступно — нечего чистить */
  }
}

export function loadRecords() {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    if (!raw) return { ...EMPTY_RECORDS };
    return { ...EMPTY_RECORDS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...EMPTY_RECORDS };
  }
}

export function saveRecords(records) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
    return true;
  } catch (e) {
    return false;
  }
}
