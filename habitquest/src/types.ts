// Модель данных HabitQuest. Всё состояние игры — один сериализуемый объект GameState,
// который целиком сохраняется в localStorage.

export type StatKey = 'strength' | 'intellect' | 'discipline';
export type Difficulty = 'easy' | 'medium' | 'epic';
export type TaskType = 'habit' | 'daily' | 'todo';
export type TabId = 'dashboard' | 'quests' | 'shop' | 'settings';

export type AvatarId = 'warrior' | 'mage' | 'guardian' | 'ranger' | 'necro' | 'phantom' | 'android' | 'familiar';

export type RewardIconId =
  | 'film'
  | 'pizza'
  | 'game'
  | 'coffee'
  | 'sleep'
  | 'music'
  | 'shopping'
  | 'travel'
  | 'book'
  | 'gift'
  | 'potion'
  | 'icecream';

/** Дата в формате YYYY-MM-DD (локальное время). */
export type DateKey = string;

export interface StatState {
  level: number;
  /** Очки внутри текущего уровня характеристики. */
  xp: number;
}

export interface Hero {
  name: string;
  avatar: AvatarId;
  level: number;
  /** Опыт внутри текущего уровня. */
  xp: number;
  hp: number;
  gold: number;
  /** Максимальный достигнутый уровень — бонус за уровень выдаётся только один раз. */
  maxLevelReached: number;
  stats: Record<StatKey, StatState>;
}

/** Точная запись выданной награды — нужна, чтобы корректно откатить выполнение. */
export interface Grant {
  xp: number;
  gold: number;
  stat: StatKey;
  statPoints: number;
}

interface TaskBase {
  id: string;
  title: string;
  notes: string;
  difficulty: Difficulty;
  createdAt: number;
}

export interface Habit extends TaskBase {
  type: 'habit';
  /** Есть кнопка «+» (полезное действие). */
  positive: boolean;
  /** Есть кнопка «−» (вредное действие). */
  negative: boolean;
  /** Снимать HP, если за игровой день ни разу не нажат «+». */
  penalizeSkip: boolean;
  countUp: number;
  countDown: number;
  /** Игровой день последнего «+». */
  lastPlusDate: DateKey | null;
  /** Игровой день создания — пропуск не штрафуется в день, когда привычки ещё не было. */
  createdDate: DateKey;
}

export interface Daily extends TaskBase {
  type: 'daily';
  stat: StatKey;
  /** Дни недели по расписанию: 0 — понедельник … 6 — воскресенье. */
  days: number[];
  completed: boolean;
  completedGrant: Grant | null;
  streak: number;
  bestStreak: number;
  /** Рекорд серии до последнего выполнения — чтобы отмена не оставляла «фальшивый» рекорд. */
  prevBestStreak: number;
  createdDate: DateKey;
}

export interface Todo extends TaskBase {
  type: 'todo';
  stat: StatKey;
  dueDate: DateKey | null;
  completed: boolean;
  completedAt: number | null;
  completedGrant: Grant | null;
}

export type Task = Habit | Daily | Todo;

export interface Reward {
  id: string;
  title: string;
  notes: string;
  cost: number;
  icon: RewardIconId;
  /** potion — встроенное зелье, восстанавливает HP. */
  kind: 'custom' | 'potion';
  purchases: number;
  createdAt: number;
}

export type LogKind = 'quest' | 'damage' | 'level' | 'shop' | 'system' | 'death' | 'heal' | 'stat' | 'undo';

export interface LogEntry {
  id: string;
  ts: number;
  kind: LogKind;
  text: string;
}

export interface Totals {
  questsCompleted: number;
  habitsPlus: number;
  habitsMinus: number;
  xpEarned: number;
  goldEarned: number;
  goldSpent: number;
  damageTaken: number;
  deaths: number;
  rewardsBought: number;
  crits: number;
}

/** Сводка текущего игрового дня, обнуляется при смене суток. */
export interface DayStats {
  date: DateKey;
  xp: number;
  gold: number;
  quests: number;
  damage: number;
}

export interface GameState {
  version: 1;
  hero: Hero;
  habits: Habit[];
  dailies: Daily[];
  todos: Todo[];
  rewards: Reward[];
  log: LogEntry[];
  totals: Totals;
  today: DayStats;
  /** Последний игровой день, для которого выполнена смена суток. */
  lastProcessedDate: DateKey;
  /** Сдвиг игровых суток относительно реального календаря (кнопка «Симулировать новый день»). */
  dayOffset: number;
  createdAt: number;
}

/** Параметры, которые форма передаёт при создании / редактировании задачи. */
export interface HabitDraft {
  title: string;
  notes: string;
  difficulty: Difficulty;
  positive: boolean;
  negative: boolean;
  penalizeSkip: boolean;
}

export interface DailyDraft {
  title: string;
  notes: string;
  difficulty: Difficulty;
  stat: StatKey;
  days: number[];
}

export interface TodoDraft {
  title: string;
  notes: string;
  difficulty: Difficulty;
  stat: StatKey;
  dueDate: DateKey | null;
}

export interface RewardDraft {
  title: string;
  notes: string;
  cost: number;
  icon: RewardIconId;
}

/** Экранная точка, откуда «вылетают» числа наград. */
export interface Origin {
  x: number;
  y: number;
}

/** Всплывающая надпись над местом клика: +XP, +золото, −HP. */
export interface Floater {
  id: string;
  x: number;
  y: number;
  xp: number;
  gold: number;
  hp: number;
  crit: boolean;
}

/** Побочные эффекты, которые движок возвращает вместе с новым состоянием. */
export type GameEvent =
  | { type: 'log'; kind: LogKind; text: string }
  | { type: 'levelUp'; level: number; bonusGold: number }
  | { type: 'death'; lostLevel: boolean; lostGold: number }
  | { type: 'float'; xp: number; gold: number; hp: number; crit: boolean };

export interface EngineResult {
  state: GameState;
  events: GameEvent[];
}
