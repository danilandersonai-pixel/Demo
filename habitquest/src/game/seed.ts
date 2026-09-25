import type { Daily, DateKey, GameState, Habit, Reward, Todo } from '../types';
import { ALL_DAYS } from './constants';
import { addDays } from './dates';
import { uid } from './utils';

function habit(partial: Pick<Habit, 'title' | 'notes' | 'difficulty' | 'positive' | 'negative' | 'penalizeSkip'>, today: DateKey, countUp = 0, countDown = 0): Habit {
  return {
    id: uid(),
    type: 'habit',
    countUp,
    countDown,
    lastPlusDate: null,
    createdDate: today,
    createdAt: Date.now(),
    ...partial,
  };
}

function daily(partial: Pick<Daily, 'title' | 'notes' | 'difficulty' | 'stat' | 'days'>, today: DateKey, streak = 0): Daily {
  return {
    id: uid(),
    type: 'daily',
    completed: false,
    completedGrant: null,
    streak,
    bestStreak: streak,
    prevBestStreak: streak,
    createdDate: today,
    createdAt: Date.now(),
    ...partial,
  };
}

function todo(partial: Pick<Todo, 'title' | 'notes' | 'difficulty' | 'stat' | 'dueDate'>): Todo {
  return {
    id: uid(),
    type: 'todo',
    completed: false,
    completedAt: null,
    completedGrant: null,
    createdAt: Date.now(),
    ...partial,
  };
}

function reward(partial: Pick<Reward, 'title' | 'notes' | 'cost' | 'icon'>, kind: Reward['kind'] = 'custom'): Reward {
  return { id: uid(), kind, purchases: 0, createdAt: Date.now(), ...partial };
}

/** Новая игра со стартовыми квестами и наградами. */
export function createInitialState(today: DateKey): GameState {
  const now = Date.now();
  return {
    version: 1,
    hero: {
      name: 'Нео Странник',
      avatar: 'warrior',
      level: 1,
      xp: 45,
      hp: 42,
      gold: 60,
      maxLevelReached: 1,
      stats: {
        strength: { level: 1, xp: 4 },
        intellect: { level: 1, xp: 6 },
        discipline: { level: 1, xp: 3 },
      },
    },
    habits: [
      habit({ title: 'Выпить стакан воды', notes: 'Гидратация — базовый бафф.', difficulty: 'easy', positive: true, negative: false, penalizeSkip: false }, today, 4),
      habit({ title: 'Прочитать 10 страниц', notes: 'Любая полезная книга.', difficulty: 'easy', positive: true, negative: false, penalizeSkip: true }, today, 2),
      habit({ title: 'Отжаться 20 раз', notes: '', difficulty: 'medium', positive: true, negative: false, penalizeSkip: false }, today, 1),
      habit({ title: 'Перекус: полезный / фастфуд', notes: '«+» — фрукты и орехи, «−» — чипсы и бургер.', difficulty: 'medium', positive: true, negative: true, penalizeSkip: false }, today, 1, 1),
      habit({ title: 'Залипать в соцсетях', notes: 'Каждые 30 минут бесцельного скролла.', difficulty: 'medium', positive: false, negative: true, penalizeSkip: false }, today, 0, 2),
      habit({ title: 'Лечь спать после 01:00', notes: '', difficulty: 'epic', positive: false, negative: true, penalizeSkip: false }, today),
    ],
    dailies: [
      daily({ title: 'Утренняя зарядка', notes: '10 минут — и тело проснулось.', difficulty: 'easy', stat: 'strength', days: ALL_DAYS }, today, 3),
      daily({ title: 'Потренироваться', notes: 'Зал, бег или домашняя тренировка.', difficulty: 'medium', stat: 'strength', days: ALL_DAYS }, today, 1),
      daily({ title: 'Урок программирования', notes: 'Один модуль курса или 45 минут практики.', difficulty: 'medium', stat: 'intellect', days: [0, 1, 2, 3, 4] }, today, 5),
      daily({ title: 'Медитация 10 минут', notes: '', difficulty: 'easy', stat: 'discipline', days: ALL_DAYS }, today),
      daily({ title: 'Разобрать входящие', notes: 'Почта и мессенджеры до «нуля».', difficulty: 'easy', stat: 'discipline', days: [0, 2, 4] }, today),
    ],
    todos: [
      todo({ title: 'Оплатить коммунальные услуги', notes: '', difficulty: 'easy', stat: 'discipline', dueDate: today }),
      todo({ title: 'Записаться к стоматологу', notes: 'Плановый осмотр.', difficulty: 'easy', stat: 'strength', dueDate: addDays(today, 3) }),
      todo({ title: 'Разобрать гардероб', notes: 'Отдать ненужное на благотворительность.', difficulty: 'medium', stat: 'strength', dueDate: addDays(today, 1) }),
      todo({ title: 'Дочитать «Атомные привычки»', notes: '', difficulty: 'medium', stat: 'intellect', dueDate: null }),
      todo({ title: 'Собрать портфолио проектов', notes: 'Три лучших кейса, описание и ссылки.', difficulty: 'epic', stat: 'intellect', dueDate: addDays(today, 7) }),
    ],
    rewards: [
      reward({ title: 'Зелье здоровья', notes: 'Мгновенно восстанавливает 15 HP.', cost: 25, icon: 'potion' }, 'potion'),
      reward({ title: 'Кофе из любимой кофейни', notes: '', cost: 20, icon: 'coffee' }),
      reward({ title: 'Час видеоигр', notes: 'Без угрызений совести.', cost: 30, icon: 'game' }),
      reward({ title: 'Поспать подольше', notes: 'Будильник на час позже.', cost: 35, icon: 'sleep' }),
      reward({ title: 'Посмотреть фильм', notes: '', cost: 40, icon: 'film' }),
      reward({ title: 'Съесть пиццу', notes: 'Любую, даже с ананасами.', cost: 60, icon: 'pizza' }),
      reward({ title: 'Купить новую книгу', notes: '', cost: 80, icon: 'book' }),
      reward({ title: 'Выходной без дел', notes: 'Целый день отдыха.', cost: 150, icon: 'travel' }),
    ],
    log: [
      {
        id: uid(),
        ts: now,
        kind: 'system',
        text: 'Добро пожаловать в HabitQuest! Выполняйте квесты, копите золото и не давайте вредным привычкам снять ваше HP.',
      },
    ],
    totals: {
      questsCompleted: 0,
      habitsPlus: 0,
      habitsMinus: 0,
      xpEarned: 0,
      goldEarned: 0,
      goldSpent: 0,
      damageTaken: 0,
      deaths: 0,
      rewardsBought: 0,
      crits: 0,
    },
    today: { date: today, xp: 0, gold: 0, quests: 0, damage: 0 },
    lastProcessedDate: today,
    dayOffset: 0,
    createdAt: now,
  };
}
