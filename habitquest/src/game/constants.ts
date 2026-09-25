import type { Difficulty, Hero, StatKey, TaskType } from '../types';

export const STORAGE_KEY = 'habitquest:state:v1';
export const TAB_STORAGE_KEY = 'habitquest:tab';
export const LOG_LIMIT = 250;

/** Базовое здоровье героя; Сила добавляет HP_PER_STRENGTH за каждый уровень выше первого. */
export const BASE_MAX_HP = 50;
export const HP_PER_STRENGTH = 5;

/** Шанс критического успеха и его множитель. */
export const CRIT_CHANCE = 0.1;
export const CRIT_MULTIPLIER = 1.5;

/** При гибели герой теряет эту долю золота и один уровень. */
export const DEATH_GOLD_PENALTY = 0.3;

export const STAT_META: Record<StatKey, { label: string; short: string; description: string; bonus: string }> = {
  strength: {
    label: 'Сила',
    short: 'СИЛ',
    description: 'Физические и рутинные дела: спорт, режим, быт.',
    bonus: `+${HP_PER_STRENGTH} к макс. HP и −2% урона за уровень`,
  },
  intellect: {
    label: 'Интеллект',
    short: 'ИНТ',
    description: 'Учёба, работа головой, проекты.',
    bonus: '+3% к получаемому опыту за уровень',
  },
  discipline: {
    label: 'Дисциплина',
    short: 'ДИС',
    description: 'Привычки: всё, что держится на силе воли.',
    bonus: '+3% к получаемому золоту за уровень',
  },
};

export const STAT_ORDER: StatKey[] = ['strength', 'intellect', 'discipline'];

/** Характеристика по умолчанию для каждого типа квестов. Привычки всегда качают Дисциплину. */
export const DEFAULT_STAT: Record<TaskType, StatKey> = {
  habit: 'discipline',
  daily: 'strength',
  todo: 'intellect',
};

export const DIFFICULTY_META: Record<Difficulty, { label: string; stars: number }> = {
  easy: { label: 'Легко', stars: 1 },
  medium: { label: 'Средне', stars: 2 },
  epic: { label: 'Эпично', stars: 3 },
};

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'epic'];

export interface RewardRow {
  xp: number;
  gold: number;
  statPoints: number;
  /** Урон за «минус» привычки или пропуск дейлика. */
  damage: number;
}

/** Таблица наград и штрафов по типу квеста и сложности. */
export const REWARD_TABLE: Record<TaskType, Record<Difficulty, RewardRow>> = {
  habit: {
    easy: { xp: 8, gold: 3, statPoints: 1, damage: 5 },
    medium: { xp: 15, gold: 6, statPoints: 2, damage: 10 },
    epic: { xp: 25, gold: 10, statPoints: 3, damage: 18 },
  },
  daily: {
    easy: { xp: 10, gold: 5, statPoints: 1, damage: 6 },
    medium: { xp: 18, gold: 9, statPoints: 2, damage: 10 },
    epic: { xp: 30, gold: 15, statPoints: 3, damage: 16 },
  },
  todo: {
    easy: { xp: 15, gold: 8, statPoints: 2, damage: 0 },
    medium: { xp: 35, gold: 18, statPoints: 4, damage: 0 },
    epic: { xp: 80, gold: 40, statPoints: 8, damage: 0 },
  },
};

/** Бонус серии дейлика: +5% опыта за каждый день серии, максимум +50%. */
export const STREAK_BONUS_PER_DAY = 0.05;
export const STREAK_BONUS_CAP = 10;

/**
 * Формула прогрессии: первый уровень требует 100 XP, каждый следующий — на 25 больше.
 * 1→2: 100, 2→3: 125, 3→4: 150 …
 */
export function xpToNextLevel(level: number): number {
  return 100 + (level - 1) * 25;
}

/** Очки характеристики, нужные для её следующего уровня: 10, 15, 20 … */
export function statPointsToNext(level: number): number {
  return 10 + (level - 1) * 5;
}

/** Бонусное золото за впервые достигнутый уровень. */
export function levelUpGoldBonus(level: number): number {
  return level * 10;
}

export function maxHp(hero: Hero): number {
  return BASE_MAX_HP + (hero.stats.strength.level - 1) * HP_PER_STRENGTH;
}

export function xpMultiplier(hero: Hero): number {
  return 1 + (hero.stats.intellect.level - 1) * 0.03;
}

export function goldMultiplier(hero: Hero): number {
  return 1 + (hero.stats.discipline.level - 1) * 0.03;
}

/** Доля поглощаемого урона: 2% за уровень Силы выше первого, не больше 40%. */
export function damageReduction(hero: Hero): number {
  return Math.min(0.4, (hero.stats.strength.level - 1) * 0.02);
}

const TITLES: Array<{ from: number; title: string }> = [
  { from: 1, title: 'Новобранец' },
  { from: 3, title: 'Искатель' },
  { from: 5, title: 'Страж привычек' },
  { from: 8, title: 'Нетраннер воли' },
  { from: 12, title: 'Мастер ритуалов' },
  { from: 16, title: 'Хроно-рыцарь' },
  { from: 20, title: 'Легенда неона' },
];

export function heroTitle(level: number): string {
  let current = TITLES[0]?.title ?? '';
  for (const entry of TITLES) {
    if (level >= entry.from) current = entry.title;
  }
  return current;
}

export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
