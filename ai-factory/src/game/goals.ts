// Контракты-цели: мягкое обучение и ориентиры в песочнице. Выполняются в любом
// порядке, но в интерфейсе показывается первая невыполненная.

import { avgIncome, countType, hasResearch, occupiedCells } from './selectors';
import { GRID } from './config';
import type { GameState } from './types';

export interface GoalDef {
  id: string;
  title: string;
  desc: string;
  reward: number;
  /** [текущее значение, цель]. Цель выполнена, когда первое ≥ второго. */
  progress: (s: GameState) => [number, number];
  /** Как показывать прогресс: штуки, деньги в секунду и т. п. */
  unit?: 'count' | 'income';
}

export const GOALS: GoalDef[] = [
  {
    id: 'g_reactor',
    title: 'Запустить энергосеть',
    desc: 'Постройте Квантовый реактор',
    reward: 100,
    progress: (s) => [countType(s, 'reactor'), 1],
  },
  {
    id: 'g_miners',
    title: 'Поток данных',
    desc: 'Постройте 3 Генератора сырых данных',
    reward: 150,
    progress: (s) => [countType(s, 'miner'), 3],
  },
  {
    id: 'g_coder',
    title: 'Вайб пошёл',
    desc: 'Постройте Блок вайбкодинга',
    reward: 250,
    progress: (s) => [countType(s, 'coder'), 1],
  },
  {
    id: 'g_code',
    title: 'Первые 250 KLOC',
    desc: 'Произведите 250 KLOC Чистого кода',
    reward: 300,
    progress: (s) => [Math.floor(s.stats.codeWritten), 250],
  },
  {
    id: 'g_trainer',
    title: 'Нейросеть проснулась',
    desc: 'Постройте GPU-кластер и Кластер обучения LLM',
    reward: 400,
    progress: (s) => [Math.min(1, countType(s, 'gpu')) + Math.min(1, countType(s, 'trainer')), 2],
  },
  {
    id: 'g_model',
    title: 'Первая модель',
    desc: 'Обучите первую модель',
    reward: 600,
    progress: (s) => [Math.floor(s.stats.modelsTrained), 1],
  },
  {
    id: 'g_saas',
    title: 'Выход на рынок',
    desc: 'Продайте 5 моделей через SaaS-терминал',
    reward: 1000,
    progress: (s) => [Math.floor(s.stats.modelsSold), 5],
  },
  {
    id: 'g_research',
    title: 'Научный отдел',
    desc: 'Завершите первое исследование',
    reward: 1500,
    progress: (s) => [s.research.done.length, 1],
  },
  {
    id: 'g_refactor',
    title: 'Уборка в коде',
    desc: 'Запустите ИИ-рефакторинг',
    reward: 500,
    progress: (s) => [Math.min(1, s.stats.refactors + s.stats.autoRefactors), 1],
  },
  {
    id: 'g_inc100',
    title: 'Стабильный поток',
    desc: 'Выйдите на пассивный доход $100/с',
    reward: 3000,
    progress: (s) => [avgIncome(s), 100],
    unit: 'income',
  },
  {
    id: 'g_expansion',
    title: 'Большой цех',
    desc: 'Изучите «Расширение цеха» и откройте сетку 8×8',
    reward: 10000,
    progress: (s) => [hasResearch(s, 'expansion') ? 1 : 0, 1],
  },
  {
    id: 'g_inc1k',
    title: 'Корпорация',
    desc: 'Выйдите на пассивный доход $1 000/с',
    reward: 30000,
    progress: (s) => [avgIncome(s), 1000],
    unit: 'income',
  },
  {
    id: 'g_agi',
    title: 'Эра AGI',
    desc: 'Постройте Суперкомпьютер AGI',
    reward: 100000,
    progress: (s) => [countType(s, 'agi'), 1],
  },
  {
    id: 'g_full',
    title: 'Ни метра впустую',
    desc: 'Застройте все 64 ячейки цеха',
    reward: 250000,
    progress: (s) => [occupiedCells(s), GRID * GRID],
  },
  {
    id: 'g_inc10k',
    title: 'Сингулярность близко',
    desc: 'Выйдите на пассивный доход $10 000/с',
    reward: 500000,
    progress: (s) => [avgIncome(s), 10000],
    unit: 'income',
  },
];

export function currentGoal(s: GameState): GoalDef | null {
  return GOALS.find((g) => !s.goals.includes(g.id)) ?? null;
}
