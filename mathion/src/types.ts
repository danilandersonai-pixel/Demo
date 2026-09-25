// Модель данных Mathion. Всё сохраняемое состояние — один сериализуемый объект GameState.

/** Школы магии: Земля (+/−), Огонь (×), Вода (÷), Пустота (уравнения с x). */
export type Element = 'earth' | 'fire' | 'water' | 'void';
export type BlitzElement = Element | 'chaos';
export type Essences = Record<Element, number>;

export type TabId = 'arena' | 'lab' | 'tower' | 'inventory';

export type UpgradeId = 'stone' | 'lenses' | 'shield' | 'crystal' | 'amulet' | 'codex';
export type PotionId = 'health' | 'freeze' | 'bomb' | 'mana';
export type SpellId = 'meteor' | 'regen' | 'shatter';

export type HuntTier = 'easy' | 'normal' | 'hard';
export type BattleMode = 'hunt' | 'campaign';

/** Особые свойства врагов (в основном у боссов башни). */
export type TraitId =
  | 'heat' // Жар: на размышление на 2 секунды меньше
  | 'frost_shield' // Ледяной панцирь: каждая атака восстанавливает щит
  | 'poison' // Яд: атака отравляет на 3 хода
  | 'even_only' // Чётность: принимает только чётные ответы
  | 'rage' // Ярость: каждая атака сильнее предыдущей
  | 'mirror' // Отражение: часть урона возвращается игроку
  | 'chrono' // Пожиратель времени: таймер вдвое короче, урон выше
  | 'regen' // Регенерация: лечится при каждой атаке
  | 'void_only' // Печать Пустоты: уязвим только к Высшей Магии Пустоты
  | 'phase'; // Две фазы: на половине HP восстанавливает щит и усиливается

export type EnemyKind = 'monster' | 'golem' | 'boss';

export type EnemyIconId =
  | 'rat'
  | 'bug'
  | 'snail'
  | 'bird'
  | 'ghost'
  | 'skull'
  | 'golem'
  | 'anvil'
  | 'flame'
  | 'snowflake'
  | 'eye'
  | 'hourglass'
  | 'crown'
  | 'orbit'
  | 'axe'
  | 'hexagon'
  | 'biohazard';

export type ProblemKind = 'add' | 'sub' | 'mixed' | 'mul' | 'div' | 'eq';

export interface Problem {
  id: string;
  element: Element;
  kind: ProblemKind;
  /** Текст примера на экране: «12 × 13», «3x + 7 = 22». */
  display: string;
  /** Полная запись с ответом для журнала: «12 × 13 = 156», «3x + 7 = 22 → x = 5». */
  solution: string;
  answer: number;
  difficulty: number;
}

export interface Enemy {
  id: string;
  templateId: string;
  name: string;
  title: string;
  kind: EnemyKind;
  icon: EnemyIconId;
  level: number;
  maxHp: number;
  hp: number;
  shield: number;
  maxShield: number;
  /** Базовый урон атаки. */
  attack: number;
  /** Надбавка к урону от «Ярости» и второй фазы. */
  attackBonus: number;
  /** Секунды на один пример до атаки врага. */
  attackTime: number;
  weakness: Element | null;
  resist: Element | null;
  traits: TraitId[];
  /** Для босса с двумя фазами: наступила ли вторая. */
  enraged: boolean;
}

export interface Rewards {
  gold: number;
  xp: number;
  essences: Essences;
  firstClear: boolean;
}

export interface Battle {
  mode: BattleMode;
  floor: number | null;
  huntTier: HuntTier | null;
  enemy: Enemy;
  element: Element;
  problem: Problem;
  /** Остаток времени на текущий пример, мс. */
  timeLeft: number;
  timeLimit: number;
  /** Остаток действия Зелья заморозки, мс. */
  freezeLeft: number;
  combo: number;
  maxCombo: number;
  poisonTurns: number;
  turn: number;
  correct: number;
  wrong: number;
  damageDealt: number;
  damageTaken: number;
  status: 'active' | 'victory' | 'defeat';
  rewards: Rewards | null;
  /** Потери при поражении. */
  goldLost: number;
}

export interface Blitz {
  element: BlitzElement;
  status: 'active' | 'over';
  timeLeft: number;
  elapsed: number;
  score: number;
  correct: number;
  wrong: number;
  combo: number;
  maxCombo: number;
  problem: Problem;
  /** Сколько верных ответов дано в каждой школе — из этого считаются эссенции. */
  tally: Essences;
  rewards: { gold: number; essences: Essences } | null;
  /** Место в таблице рекордов (1…10) или null. */
  recordRank: number | null;
}

export interface BlitzRecord {
  id: string;
  score: number;
  correct: number;
  wrong: number;
  maxCombo: number;
  element: BlitzElement;
  date: number;
}

export interface Player {
  name: string;
  level: number;
  xp: number;
  hp: number;
  mana: number;
  gold: number;
  essences: Essences;
}

export type LogKind = 'attack' | 'crit' | 'hurt' | 'heal' | 'loot' | 'level' | 'boss' | 'craft' | 'system' | 'victory' | 'defeat';

export interface LogEntry {
  id: string;
  ts: number;
  kind: LogKind;
  text: string;
}

export interface ElementStats {
  correct: number;
  wrong: number;
}

export interface Stats {
  battlesWon: number;
  battlesLost: number;
  bossesSlain: number;
  totalDamage: number;
  bestHit: number;
  crits: number;
  potionsUsed: number;
  spellsCast: number;
  byElement: Record<Element, ElementStats>;
}

export interface GameState {
  version: 1;
  player: Player;
  upgrades: Record<UpgradeId, number>;
  potions: Record<PotionId, number>;
  /** Сколько этажей башни пройдено (0…10). */
  campaignCleared: number;
  battle: Battle | null;
  blitz: Blitz | null;
  records: BlitzRecord[];
  stats: Stats;
  log: LogEntry[];
  createdAt: number;
}

/** Визуальные события, которые движок возвращает вместе с новым состоянием. */
export type GameEvent =
  | { type: 'enemyHit'; amount: number; shield: number; crit: boolean; element: Element }
  | { type: 'playerHit'; amount: number; reason: 'wrong' | 'timeout' | 'poison' | 'mirror' }
  | { type: 'heal'; amount: number }
  | { type: 'mana'; amount: number }
  | { type: 'enemyHeal'; amount: number }
  | { type: 'enemyShield'; amount: number }
  | { type: 'cast'; element: Element }
  | { type: 'potion'; id: PotionId }
  | { type: 'wrong' }
  | { type: 'levelUp'; level: number }
  | { type: 'blitzPoints'; points: number; bonusTime: number }
  | { type: 'victory' }
  | { type: 'defeat' };

export interface EngineResult {
  state: GameState;
  events: GameEvent[];
}

export interface Rng {
  (): number;
}
