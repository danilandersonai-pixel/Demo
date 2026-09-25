// Игровой движок HabitQuest.
// Все функции чистые: принимают GameState и возвращают новый GameState + список событий для UI.
// Никаких обращений к React, DOM или localStorage здесь нет — это упрощает проверку логики.

import type {
  Daily,
  DailyDraft,
  DateKey,
  Difficulty,
  EngineResult,
  GameEvent,
  GameState,
  Grant,
  Habit,
  HabitDraft,
  Hero,
  LogKind,
  Reward,
  RewardDraft,
  StatKey,
  TaskType,
  Todo,
  TodoDraft,
  AvatarId,
} from '../types';
import {
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  DEATH_GOLD_PENALTY,
  LOG_LIMIT,
  REWARD_TABLE,
  STAT_META,
  STREAK_BONUS_CAP,
  STREAK_BONUS_PER_DAY,
  damageReduction,
  goldMultiplier,
  levelUpGoldBonus,
  maxHp,
  statPointsToNext,
  xpMultiplier,
  xpToNextLevel,
} from './constants';
import { addDays, diffDays, formatLongDate, weekdayIndex } from './dates';
import { daysWord, uid } from './utils';

export type Rng = () => number;

export interface ActionContext {
  /** Текущий игровой день. */
  today: DateKey;
  /** Источник случайности (для критов); в тестах можно подменить. */
  rng: Rng;
}

/**
 * Транзакция: накапливает изменения состояния и события в рамках одного действия игрока.
 * Состояние внутри остаётся иммутабельным — каждое изменение создаёт новый объект.
 */
class Tx {
  state: GameState;
  readonly events: GameEvent[] = [];

  constructor(state: GameState) {
    this.state = state;
  }

  log(kind: LogKind, text: string): void {
    const entry = { id: uid(), ts: Date.now(), kind, text };
    this.state = { ...this.state, log: [entry, ...this.state.log].slice(0, LOG_LIMIT) };
    this.events.push({ type: 'log', kind, text });
  }

  emit(event: GameEvent): void {
    this.events.push(event);
  }

  setHero(hero: Hero): void {
    this.state = { ...this.state, hero };
  }

  result(): EngineResult {
    return { state: this.state, events: this.events };
  }
}

function unchanged(state: GameState): EngineResult {
  return { state, events: [] };
}

// ---------------------------------------------------------------------------
// Примитивы героя
// ---------------------------------------------------------------------------

/** Начисляет опыт, обрабатывая каскад повышений уровня (излишек XP переносится). */
function gainXp(tx: Tx, amount: number): void {
  if (amount <= 0) return;
  const hero = tx.state.hero;
  let { level, xp, gold, maxLevelReached } = hero;
  let leveled = false;
  xp += amount;

  while (xp >= xpToNextLevel(level)) {
    xp -= xpToNextLevel(level);
    level += 1;
    leveled = true;
    let bonusGold = 0;
    if (level > maxLevelReached) {
      maxLevelReached = level;
      bonusGold = levelUpGoldBonus(level);
      gold += bonusGold;
    }
    tx.emit({ type: 'levelUp', level, bonusGold });
    tx.log(
      'level',
      bonusGold > 0
        ? `НОВЫЙ УРОВЕНЬ! Вы достигли ${level} уровня. HP восстановлено, бонус +${bonusGold} золота. До следующего уровня: ${xpToNextLevel(level)} XP`
        : `Уровень ${level} возвращён. HP восстановлено.`,
    );
  }

  const next: Hero = { ...hero, level, xp, gold, maxLevelReached };
  if (leveled) next.hp = maxHp(next);
  tx.setHero(next);
}

/** Снимает опыт (при отмене квеста); при нехватке XP уровень понижается. */
function loseXp(tx: Tx, amount: number): void {
  if (amount <= 0) return;
  const hero = tx.state.hero;
  let { level, xp } = hero;
  xp -= amount;
  while (xp < 0 && level > 1) {
    level -= 1;
    xp += xpToNextLevel(level);
  }
  if (xp < 0) xp = 0;
  if (level < hero.level) {
    tx.log('undo', `Уровень понижен до ${level} из-за отмены квеста.`);
  }
  tx.setHero({ ...hero, level, xp });
}

/** Изменяет очки характеристики в обе стороны с каскадом уровней. */
function changeStat(tx: Tx, stat: StatKey, delta: number): void {
  if (delta === 0) return;
  const hero = tx.state.hero;
  const current = hero.stats[stat];
  let { level, xp } = current;
  xp += delta;

  while (xp >= statPointsToNext(level)) {
    xp -= statPointsToNext(level);
    level += 1;
    tx.log('stat', `Характеристика «${STAT_META[stat].label}» выросла до ${level}! ${STAT_META[stat].bonus}.`);
  }
  while (xp < 0 && level > 1) {
    level -= 1;
    xp += statPointsToNext(level);
  }
  if (xp < 0) xp = 0;
  if (level < current.level) {
    tx.log('undo', `Характеристика «${STAT_META[stat].label}» снизилась до ${level}.`);
  }

  const next: Hero = { ...hero, stats: { ...hero.stats, [stat]: { level, xp } } };
  next.hp = Math.min(next.hp, maxHp(next));
  tx.setHero(next);
}

/** Наносит урон с учётом защиты от Силы. При HP ≤ 0 герой погибает и теряет уровень и часть золота. */
function dealDamage(tx: Tx, raw: number): number {
  if (raw <= 0) return 0;
  const hero = tx.state.hero;
  const dealt = Math.max(1, Math.round(raw * (1 - damageReduction(hero))));
  const hp = hero.hp - dealt;

  tx.state = {
    ...tx.state,
    totals: { ...tx.state.totals, damageTaken: tx.state.totals.damageTaken + dealt },
    today: { ...tx.state.today, damage: tx.state.today.damage + dealt },
  };
  tx.emit({ type: 'float', xp: 0, gold: 0, hp: -dealt, crit: false });

  if (hp > 0) {
    tx.setHero({ ...hero, hp });
    return dealt;
  }

  const lostLevel = hero.level > 1;
  const lostGold = Math.floor(hero.gold * DEATH_GOLD_PENALTY);
  const fallen: Hero = {
    ...hero,
    level: Math.max(1, hero.level - 1),
    xp: 0,
    gold: hero.gold - lostGold,
  };
  fallen.hp = maxHp(fallen);
  tx.setHero(fallen);
  tx.state = { ...tx.state, totals: { ...tx.state.totals, deaths: tx.state.totals.deaths + 1 } };
  tx.emit({ type: 'death', lostLevel, lostGold });
  tx.log(
    'death',
    `ГЕРОЙ ПАЛ! ${lostLevel ? `Уровень понижен до ${fallen.level}, ` : 'Опыт уровня потерян, '}утрачено ${lostGold} золота. Вы возрождаетесь с полным HP.`,
  );
  return dealt;
}

function heal(tx: Tx, amount: number): number {
  const hero = tx.state.hero;
  const healed = Math.min(amount, maxHp(hero) - hero.hp);
  if (healed <= 0) return 0;
  tx.setHero({ ...hero, hp: hero.hp + healed });
  tx.emit({ type: 'float', xp: 0, gold: 0, hp: healed, crit: false });
  return healed;
}

// ---------------------------------------------------------------------------
// Награды
// ---------------------------------------------------------------------------

interface RolledGrant {
  grant: Grant;
  crit: boolean;
}

/** Считает награду: база из таблицы × бонусы характеристик × серия × крит. */
export function rollGrant(
  hero: Hero,
  type: TaskType,
  difficulty: Difficulty,
  stat: StatKey,
  rng: Rng,
  streak = 0,
): RolledGrant {
  const row = REWARD_TABLE[type][difficulty];
  const streakMult = type === 'daily' ? 1 + Math.min(streak, STREAK_BONUS_CAP) * STREAK_BONUS_PER_DAY : 1;
  const crit = rng() < CRIT_CHANCE;
  const critMult = crit ? CRIT_MULTIPLIER : 1;
  return {
    crit,
    grant: {
      xp: Math.round(row.xp * xpMultiplier(hero) * streakMult * critMult),
      gold: Math.round(row.gold * goldMultiplier(hero) * critMult),
      stat,
      statPoints: row.statPoints,
    },
  };
}

/** Прогноз награды без крита — для подсказок в карточках квестов. */
export function previewGrant(hero: Hero, type: TaskType, difficulty: Difficulty, streak = 0): { xp: number; gold: number } {
  const { grant } = rollGrant(hero, type, difficulty, 'discipline', () => 1, streak);
  return { xp: grant.xp, gold: grant.gold };
}

export function previewDamage(hero: Hero, type: TaskType, difficulty: Difficulty, half = false): number {
  const raw = REWARD_TABLE[type][difficulty].damage;
  const base = half ? Math.ceil(raw / 2) : raw;
  return Math.max(1, Math.round(base * (1 - damageReduction(hero))));
}

function applyGrant(tx: Tx, grant: Grant, crit: boolean): void {
  const hero = tx.state.hero;
  tx.setHero({ ...hero, gold: hero.gold + grant.gold });
  tx.state = {
    ...tx.state,
    totals: {
      ...tx.state.totals,
      xpEarned: tx.state.totals.xpEarned + grant.xp,
      goldEarned: tx.state.totals.goldEarned + grant.gold,
      questsCompleted: tx.state.totals.questsCompleted + 1,
      crits: tx.state.totals.crits + (crit ? 1 : 0),
    },
    today: {
      ...tx.state.today,
      xp: tx.state.today.xp + grant.xp,
      gold: tx.state.today.gold + grant.gold,
      quests: tx.state.today.quests + 1,
    },
  };
  tx.emit({ type: 'float', xp: grant.xp, gold: grant.gold, hp: 0, crit });
  changeStat(tx, grant.stat, grant.statPoints);
  gainXp(tx, grant.xp);
}

function revertGrant(tx: Tx, grant: Grant): void {
  const hero = tx.state.hero;
  tx.setHero({ ...hero, gold: hero.gold - grant.gold });
  tx.state = {
    ...tx.state,
    totals: {
      ...tx.state.totals,
      xpEarned: Math.max(0, tx.state.totals.xpEarned - grant.xp),
      goldEarned: Math.max(0, tx.state.totals.goldEarned - grant.gold),
      questsCompleted: Math.max(0, tx.state.totals.questsCompleted - 1),
    },
    today: {
      ...tx.state.today,
      xp: Math.max(0, tx.state.today.xp - grant.xp),
      gold: Math.max(0, tx.state.today.gold - grant.gold),
      quests: Math.max(0, tx.state.today.quests - 1),
    },
  };
  tx.emit({ type: 'float', xp: -grant.xp, gold: -grant.gold, hp: 0, crit: false });
  loseXp(tx, grant.xp);
  changeStat(tx, grant.stat, -grant.statPoints);
}

// ---------------------------------------------------------------------------
// Привычки
// ---------------------------------------------------------------------------

export function habitPlus(state: GameState, id: string, ctx: ActionContext): EngineResult {
  const habit = state.habits.find((h) => h.id === id);
  if (!habit || !habit.positive) return unchanged(state);
  const tx = new Tx(state);
  const { grant, crit } = rollGrant(state.hero, 'habit', habit.difficulty, 'discipline', ctx.rng);

  tx.state = {
    ...tx.state,
    habits: tx.state.habits.map((h) =>
      h.id === id ? { ...h, countUp: h.countUp + 1, lastPlusDate: ctx.today } : h,
    ),
    totals: { ...tx.state.totals, habitsPlus: tx.state.totals.habitsPlus + 1 },
  };
  tx.log('quest', `Вы выполнили привычку «${habit.title}» и получили ${grant.xp} XP и ${grant.gold} золота.${crit ? ' КРИТ ×1.5!' : ''}`);
  applyGrant(tx, grant, crit);
  return tx.result();
}

export function habitMinus(state: GameState, id: string): EngineResult {
  const habit = state.habits.find((h) => h.id === id);
  if (!habit || !habit.negative) return unchanged(state);
  const tx = new Tx(state);
  tx.state = {
    ...tx.state,
    habits: tx.state.habits.map((h) => (h.id === id ? { ...h, countDown: h.countDown + 1 } : h)),
    totals: { ...tx.state.totals, habitsMinus: tx.state.totals.habitsMinus + 1 },
  };
  const dealt = dealDamage(tx, REWARD_TABLE.habit[habit.difficulty].damage);
  // Запись об уроне идёт до возможной записи о гибели, поэтому вставляем её под сообщение о смерти.
  insertLogBeforeDeath(tx, 'damage', `Внимание! Вы получили ${dealt} урона за вредную привычку «${habit.title}».`);
  return tx.result();
}

/** Лог хранится от новых к старым: если урон убил героя, запись об уроне должна стоять «раньше» гибели. */
function insertLogBeforeDeath(tx: Tx, kind: LogKind, text: string): void {
  const died = tx.events.some((e) => e.type === 'death');
  if (!died) {
    tx.log(kind, text);
    return;
  }
  const entry = { id: uid(), ts: Date.now(), kind, text };
  const [latest, ...rest] = tx.state.log;
  tx.state = {
    ...tx.state,
    log: latest ? [latest, entry, ...rest].slice(0, LOG_LIMIT) : [entry],
  };
  tx.events.push({ type: 'log', kind, text });
}

export function createHabit(state: GameState, draft: HabitDraft, ctx: ActionContext): EngineResult {
  const tx = new Tx(state);
  const habit: Habit = {
    id: uid(),
    type: 'habit',
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    difficulty: draft.difficulty,
    positive: draft.positive,
    negative: draft.negative,
    penalizeSkip: draft.positive && draft.penalizeSkip,
    countUp: 0,
    countDown: 0,
    lastPlusDate: null,
    createdDate: ctx.today,
    createdAt: Date.now(),
  };
  tx.state = { ...tx.state, habits: [habit, ...tx.state.habits] };
  tx.log('system', `Новая привычка добавлена: «${habit.title}».`);
  return tx.result();
}

export function updateHabit(state: GameState, id: string, draft: HabitDraft): EngineResult {
  if (!state.habits.some((h) => h.id === id)) return unchanged(state);
  const tx = new Tx(state);
  tx.state = {
    ...tx.state,
    habits: tx.state.habits.map((h) =>
      h.id === id
        ? {
            ...h,
            title: draft.title.trim(),
            notes: draft.notes.trim(),
            difficulty: draft.difficulty,
            positive: draft.positive,
            negative: draft.negative,
            penalizeSkip: draft.positive && draft.penalizeSkip,
          }
        : h,
    ),
  };
  tx.log('system', `Привычка «${draft.title.trim()}» обновлена.`);
  return tx.result();
}

// ---------------------------------------------------------------------------
// Дейлики
// ---------------------------------------------------------------------------

export function isDailyDue(daily: Daily, today: DateKey): boolean {
  return daily.days.includes(weekdayIndex(today));
}

export function toggleDaily(state: GameState, id: string, ctx: ActionContext): EngineResult {
  const daily = state.dailies.find((d) => d.id === id);
  if (!daily) return unchanged(state);
  const tx = new Tx(state);

  if (daily.completed && daily.completedGrant) {
    const grant = daily.completedGrant;
    if (state.hero.gold < grant.gold) {
      tx.log('system', `Нельзя отменить дейлик «${daily.title}»: полученное золото уже потрачено.`);
      return tx.result();
    }
    tx.state = {
      ...tx.state,
      dailies: tx.state.dailies.map((d) =>
        d.id === id
          ? {
              ...d,
              completed: false,
              completedGrant: null,
              streak: Math.max(0, d.streak - 1),
              bestStreak: d.prevBestStreak,
            }
          : d,
      ),
    };
    tx.log('undo', `Выполнение дейлика «${daily.title}» отменено: −${grant.xp} XP, −${grant.gold} золота.`);
    revertGrant(tx, grant);
    return tx.result();
  }

  if (!isDailyDue(daily, ctx.today)) {
    tx.log('system', `Дейлик «${daily.title}» сегодня не по расписанию — отдыхайте.`);
    return tx.result();
  }

  const { grant, crit } = rollGrant(state.hero, 'daily', daily.difficulty, daily.stat, ctx.rng, daily.streak);
  const streak = daily.streak + 1;
  tx.state = {
    ...tx.state,
    dailies: tx.state.dailies.map((d) =>
      d.id === id
        ? {
            ...d,
            completed: true,
            completedGrant: grant,
            streak,
            prevBestStreak: d.bestStreak,
            bestStreak: Math.max(d.bestStreak, streak),
          }
        : d,
    ),
  };
  tx.log(
    'quest',
    `Вы выполнили дейлик «${daily.title}» и получили ${grant.xp} XP и ${grant.gold} золота. Серия: ${streak} ${daysWord(streak)}.${crit ? ' КРИТ ×1.5!' : ''}`,
  );
  applyGrant(tx, grant, crit);
  return tx.result();
}

export function createDaily(state: GameState, draft: DailyDraft, ctx: ActionContext): EngineResult {
  const tx = new Tx(state);
  const daily: Daily = {
    id: uid(),
    type: 'daily',
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    difficulty: draft.difficulty,
    stat: draft.stat,
    days: [...draft.days].sort((a, b) => a - b),
    completed: false,
    completedGrant: null,
    streak: 0,
    bestStreak: 0,
    prevBestStreak: 0,
    createdDate: ctx.today,
    createdAt: Date.now(),
  };
  tx.state = { ...tx.state, dailies: [daily, ...tx.state.dailies] };
  tx.log('system', `Новый дейлик добавлен: «${daily.title}».`);
  return tx.result();
}

export function updateDaily(state: GameState, id: string, draft: DailyDraft): EngineResult {
  if (!state.dailies.some((d) => d.id === id)) return unchanged(state);
  const tx = new Tx(state);
  tx.state = {
    ...tx.state,
    dailies: tx.state.dailies.map((d) =>
      d.id === id
        ? {
            ...d,
            title: draft.title.trim(),
            notes: draft.notes.trim(),
            difficulty: draft.difficulty,
            stat: draft.stat,
            days: [...draft.days].sort((a, b) => a - b),
          }
        : d,
    ),
  };
  tx.log('system', `Дейлик «${draft.title.trim()}» обновлён.`);
  return tx.result();
}

// ---------------------------------------------------------------------------
// Разовые квесты (To-do)
// ---------------------------------------------------------------------------

export function toggleTodo(state: GameState, id: string, ctx: ActionContext): EngineResult {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return unchanged(state);
  const tx = new Tx(state);

  if (todo.completed && todo.completedGrant) {
    const grant = todo.completedGrant;
    if (state.hero.gold < grant.gold) {
      tx.log('system', `Нельзя вернуть квест «${todo.title}»: полученное золото уже потрачено.`);
      return tx.result();
    }
    tx.state = {
      ...tx.state,
      todos: tx.state.todos.map((t) =>
        t.id === id ? { ...t, completed: false, completedAt: null, completedGrant: null } : t,
      ),
    };
    tx.log('undo', `Квест «${todo.title}» возвращён в работу: −${grant.xp} XP, −${grant.gold} золота.`);
    revertGrant(tx, grant);
    return tx.result();
  }

  const { grant, crit } = rollGrant(state.hero, 'todo', todo.difficulty, todo.stat, ctx.rng);
  tx.state = {
    ...tx.state,
    todos: tx.state.todos.map((t) =>
      t.id === id ? { ...t, completed: true, completedAt: Date.now(), completedGrant: grant } : t,
    ),
  };
  tx.log('quest', `Вы выполнили квест «${todo.title}» и получили ${grant.xp} XP и ${grant.gold} золота.${crit ? ' КРИТ ×1.5!' : ''}`);
  applyGrant(tx, grant, crit);
  return tx.result();
}

export function createTodo(state: GameState, draft: TodoDraft): EngineResult {
  const tx = new Tx(state);
  const todo: Todo = {
    id: uid(),
    type: 'todo',
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    difficulty: draft.difficulty,
    stat: draft.stat,
    dueDate: draft.dueDate,
    completed: false,
    completedAt: null,
    completedGrant: null,
    createdAt: Date.now(),
  };
  tx.state = { ...tx.state, todos: [todo, ...tx.state.todos] };
  tx.log('system', `Новый квест добавлен: «${todo.title}».`);
  return tx.result();
}

export function updateTodo(state: GameState, id: string, draft: TodoDraft): EngineResult {
  if (!state.todos.some((t) => t.id === id)) return unchanged(state);
  const tx = new Tx(state);
  tx.state = {
    ...tx.state,
    todos: tx.state.todos.map((t) =>
      t.id === id
        ? {
            ...t,
            title: draft.title.trim(),
            notes: draft.notes.trim(),
            difficulty: draft.difficulty,
            stat: draft.stat,
            dueDate: draft.dueDate,
          }
        : t,
    ),
  };
  tx.log('system', `Квест «${draft.title.trim()}» обновлён.`);
  return tx.result();
}

export function clearCompletedTodos(state: GameState): EngineResult {
  const count = state.todos.filter((t) => t.completed).length;
  if (count === 0) return unchanged(state);
  const tx = new Tx(state);
  tx.state = { ...tx.state, todos: tx.state.todos.filter((t) => !t.completed) };
  tx.log('system', `Архив выполненных квестов очищен (${count}).`);
  return tx.result();
}

// ---------------------------------------------------------------------------
// Общие операции с задачами
// ---------------------------------------------------------------------------

export function deleteTask(state: GameState, type: TaskType, id: string): EngineResult {
  const tx = new Tx(state);
  let title: string | null = null;
  if (type === 'habit') {
    title = state.habits.find((h) => h.id === id)?.title ?? null;
    tx.state = { ...tx.state, habits: tx.state.habits.filter((h) => h.id !== id) };
  } else if (type === 'daily') {
    title = state.dailies.find((d) => d.id === id)?.title ?? null;
    tx.state = { ...tx.state, dailies: tx.state.dailies.filter((d) => d.id !== id) };
  } else {
    title = state.todos.find((t) => t.id === id)?.title ?? null;
    tx.state = { ...tx.state, todos: tx.state.todos.filter((t) => t.id !== id) };
  }
  if (title === null) return unchanged(state);
  tx.log('system', `Квест «${title}» удалён.`);
  return tx.result();
}

/**
 * Меняет задачу местами с ближайшим соседом в нужном направлении.
 * sameGroup ограничивает соседей (для to-do — только задачи с тем же статусом выполнения),
 * чтобы перестановка не «пропадала» за скрытыми элементами списка.
 */
export function moveTask(state: GameState, type: TaskType, id: string, direction: -1 | 1): EngineResult {
  function move<T extends { id: string }>(list: T[], sameGroup: (a: T, b: T) => boolean = () => true): T[] {
    const index = list.findIndex((item) => item.id === id);
    const current = list[index];
    if (!current) return list;
    let target = index + direction;
    while (target >= 0 && target < list.length) {
      const candidate = list[target];
      if (candidate && sameGroup(current, candidate)) break;
      target += direction;
    }
    const other = list[target];
    if (!other) return list;
    const next = [...list];
    next[index] = other;
    next[target] = current;
    return next;
  }
  if (type === 'habit') return { state: { ...state, habits: move(state.habits) }, events: [] };
  if (type === 'daily') return { state: { ...state, dailies: move(state.dailies) }, events: [] };
  return { state: { ...state, todos: move(state.todos, (a, b) => a.completed === b.completed) }, events: [] };
}

// ---------------------------------------------------------------------------
// Магазин
// ---------------------------------------------------------------------------

export const POTION_HEAL = 15;

export function buyReward(state: GameState, id: string): EngineResult {
  const reward = state.rewards.find((r) => r.id === id);
  if (!reward) return unchanged(state);
  const tx = new Tx(state);
  const hero = state.hero;

  if (hero.gold < reward.cost) {
    tx.log('system', `Недостаточно золота для «${reward.title}»: нужно ${reward.cost}, у вас ${hero.gold}.`);
    return tx.result();
  }
  if (reward.kind === 'potion' && hero.hp >= maxHp(hero)) {
    tx.log('system', 'Здоровье и так полное — зелье не потрачено.');
    return tx.result();
  }

  tx.setHero({ ...hero, gold: hero.gold - reward.cost });
  tx.state = {
    ...tx.state,
    rewards: tx.state.rewards.map((r) => (r.id === id ? { ...r, purchases: r.purchases + 1 } : r)),
    totals: {
      ...tx.state.totals,
      goldSpent: tx.state.totals.goldSpent + reward.cost,
      rewardsBought: tx.state.totals.rewardsBought + 1,
    },
  };
  tx.emit({ type: 'float', xp: 0, gold: -reward.cost, hp: 0, crit: false });

  if (reward.kind === 'potion') {
    const healed = heal(tx, POTION_HEAL);
    tx.log('heal', `Вы купили «${reward.title}» за ${reward.cost} золота и восстановили ${healed} HP.`);
  } else {
    tx.log('shop', `Вы купили награду «${reward.title}» за ${reward.cost} золота. Заслужено!`);
  }
  return tx.result();
}

export function createReward(state: GameState, draft: RewardDraft): EngineResult {
  const tx = new Tx(state);
  const reward: Reward = {
    id: uid(),
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    cost: Math.max(1, Math.round(draft.cost)),
    icon: draft.icon,
    kind: 'custom',
    purchases: 0,
    createdAt: Date.now(),
  };
  tx.state = { ...tx.state, rewards: [...tx.state.rewards, reward] };
  tx.log('system', `В магазин добавлена награда «${reward.title}» за ${reward.cost} золота.`);
  return tx.result();
}

export function updateReward(state: GameState, id: string, draft: RewardDraft): EngineResult {
  const target = state.rewards.find((r) => r.id === id);
  if (!target) return unchanged(state);
  const tx = new Tx(state);
  tx.state = {
    ...tx.state,
    rewards: tx.state.rewards.map((r) =>
      r.id === id
        ? {
            ...r,
            title: draft.title.trim(),
            notes: draft.notes.trim(),
            cost: Math.max(1, Math.round(draft.cost)),
            icon: r.kind === 'potion' ? r.icon : draft.icon,
          }
        : r,
    ),
  };
  tx.log('system', `Награда «${draft.title.trim()}» обновлена.`);
  return tx.result();
}

export function deleteReward(state: GameState, id: string): EngineResult {
  const reward = state.rewards.find((r) => r.id === id);
  if (!reward || reward.kind === 'potion') return unchanged(state);
  const tx = new Tx(state);
  tx.state = { ...tx.state, rewards: tx.state.rewards.filter((r) => r.id !== id) };
  tx.log('system', `Награда «${reward.title}» убрана из магазина.`);
  return tx.result();
}

// ---------------------------------------------------------------------------
// Профиль и служебное
// ---------------------------------------------------------------------------

export function updateProfile(state: GameState, name: string, avatar: AvatarId): EngineResult {
  const trimmed = name.trim().slice(0, 24) || 'Безымянный герой';
  if (trimmed === state.hero.name && avatar === state.hero.avatar) return unchanged(state);
  const tx = new Tx(state);
  tx.setHero({ ...state.hero, name: trimmed, avatar });
  tx.log('system', `Профиль обновлён: теперь вы — ${trimmed}.`);
  return tx.result();
}

export function clearLog(state: GameState): EngineResult {
  const tx = new Tx({ ...state, log: [] });
  tx.log('system', 'Журнал событий очищен.');
  return tx.result();
}

/**
 * Смена игровых суток. Вызывается при запуске, раз в минуту и по кнопке симуляции.
 * — Пропущенные вчера дейлики наносят урон и обнуляют серию.
 * — Привычки с флагом «штраф за пропуск», по которым вчера не было «+», наносят половину урона.
 * — Если игрок отсутствовал несколько дней, серии дейликов, запланированных на эти дни, сбрасываются (без урона).
 * — Отметки дейликов снимаются, сводка дня обнуляется.
 */
export function processNewDay(state: GameState, today: DateKey): EngineResult {
  const prev = state.lastProcessedDate;
  if (today <= prev) return unchanged(state);

  const tx = new Tx(state);
  const gap = diffDays(prev, today);
  const prevWeekday = weekdayIndex(prev);
  const skippedWeekdays: number[] = [];
  for (let i = 1; i < gap; i += 1) skippedWeekdays.push(weekdayIndex(addDays(prev, i)));

  tx.log('system', `Наступил новый день: ${formatLongDate(today)}. Дейлики обновлены.`);

  const missedDailies: Daily[] = [];
  let streaksLostWhileAway = 0;
  const dailies = state.dailies.map((d) => {
    let streak = d.streak;
    const existedYesterday = d.createdDate <= prev;
    if (existedYesterday && d.days.includes(prevWeekday) && !d.completed) {
      missedDailies.push(d);
      streak = 0;
    }
    if (streak > 0 && skippedWeekdays.some((w) => d.days.includes(w))) {
      streak = 0;
      streaksLostWhileAway += 1;
    }
    return { ...d, completed: false, completedGrant: null, streak, prevBestStreak: d.bestStreak };
  });
  tx.state = {
    ...tx.state,
    dailies,
    lastProcessedDate: today,
    today: { date: today, xp: 0, gold: 0, quests: 0, damage: 0 },
  };

  for (const daily of missedDailies) {
    const dealt = dealDamage(tx, REWARD_TABLE.daily[daily.difficulty].damage);
    insertLogBeforeDeath(tx, 'damage', `Пропущен дейлик «${daily.title}»: получено ${dealt} урона, серия прервана.`);
  }

  const skippedHabits = state.habits.filter(
    (h) => h.positive && h.penalizeSkip && h.createdDate <= prev && h.lastPlusDate !== prev,
  );
  for (const habit of skippedHabits) {
    const dealt = dealDamage(tx, Math.ceil(REWARD_TABLE.habit[habit.difficulty].damage / 2));
    insertLogBeforeDeath(tx, 'damage', `Пропущена привычка «${habit.title}»: получено ${dealt} урона.`);
  }

  if (gap > 1) {
    const away = gap - 1;
    tx.log(
      'system',
      streaksLostWhileAway > 0
        ? `Вас не было ${away} ${daysWord(away)}. Серии сброшены у ${streaksLostWhileAway} дейликов.`
        : `Вас не было ${away} ${daysWord(away)}.`,
    );
  }
  if (missedDailies.length === 0 && skippedHabits.length === 0) {
    tx.log('system', 'Вчерашний день пройден без потерь. Так держать!');
  }
  return tx.result();
}

/** Кнопка «Симулировать новый день»: сдвигает игровой календарь на сутки вперёд и запускает смену дня. */
export function simulateNextDay(state: GameState, realToday: DateKey): EngineResult {
  const dayOffset = state.dayOffset + 1;
  const today = addDays(realToday, dayOffset);
  return processNewDay({ ...state, dayOffset }, today);
}
