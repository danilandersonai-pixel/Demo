import type { Element, Essences, GameState, HuntTier, PotionId, SpellId, UpgradeId } from '../types';

export const STORAGE_KEY = 'mathion:save:v1';
export const TAB_KEY = 'mathion:tab';
export const LOG_LIMIT = 120;
export const RECORDS_LIMIT = 10;

export const ELEMENTS: Element[] = ['earth', 'fire', 'water', 'void'];

export interface ElementMeta {
  name: string;
  magic: string;
  /** Род. падеж для журнала: «Магию Огня». */
  accusative: string;
  operation: string;
  essence: string;
  /** Базовый урон правильного ответа. */
  baseDamage: number;
  /** Мана за правильный ответ. */
  mana: number;
  /** Дополнительные секунды на пример этой школы. */
  extraTime: number;
  /** Очки блица за ответ. */
  blitzPoints: number;
  /** Минимальный уровень героя для школы. */
  unlockLevel: number;
}

export const ELEMENT_META: Record<Element, ElementMeta> = {
  earth: {
    name: 'Земля',
    magic: 'Магия Земли',
    accusative: 'Магию Земли',
    operation: 'Сложение и вычитание',
    essence: 'Эссенция Земли',
    baseDamage: 10,
    mana: 8,
    extraTime: 0,
    blitzPoints: 10,
    unlockLevel: 1,
  },
  fire: {
    name: 'Огонь',
    magic: 'Магия Огня',
    accusative: 'Магию Огня',
    operation: 'Умножение',
    essence: 'Эссенция Огня',
    baseDamage: 14,
    mana: 9,
    extraTime: 1,
    blitzPoints: 15,
    unlockLevel: 1,
  },
  water: {
    name: 'Вода',
    magic: 'Магия Воды',
    accusative: 'Магию Воды',
    operation: 'Деление',
    essence: 'Эссенция Воды',
    baseDamage: 14,
    mana: 9,
    extraTime: 1,
    blitzPoints: 15,
    unlockLevel: 1,
  },
  void: {
    name: 'Пустота',
    magic: 'Высшая Магия Пустоты',
    accusative: 'Высшую Магию Пустоты',
    operation: 'Уравнения с x',
    essence: 'Эссенция Пустоты',
    baseDamage: 21,
    mana: 13,
    extraTime: 4,
    blitzPoints: 25,
    unlockLevel: 3,
  },
};

export function emptyEssences(): Essences {
  return { earth: 0, fire: 0, water: 0, void: 0 };
}

// ---------------------------------------------------------------------------
// Герой
// ---------------------------------------------------------------------------

export const BASE_HP = 100;
export const HP_PER_LEVEL = 12;
export const BASE_MANA = 60;
export const MANA_PER_LEVEL = 6;

/** Опыт до следующего уровня: 60, 100, 140, … */
export function xpToNext(level: number): number {
  return 60 + (level - 1) * 40;
}

export function maxHp(state: Pick<GameState, 'player' | 'upgrades'>): number {
  return BASE_HP + (state.player.level - 1) * HP_PER_LEVEL + state.upgrades.amulet * 20;
}

export function maxMana(state: Pick<GameState, 'player'>): number {
  return BASE_MANA + (state.player.level - 1) * MANA_PER_LEVEL;
}

/** Множитель урона от уровня героя: +10% за уровень. */
export function levelDamageMultiplier(level: number): number {
  return 1 + (level - 1) * 0.1;
}

export const BASE_CRIT_CHANCE = 0.12;
export const COMBO_CRIT_BONUS = 0.06;

export function critMultiplier(stoneLevel: number): number {
  return 1.5 + stoneLevel * 0.25;
}

export function critChance(combo: number): number {
  return BASE_CRIT_CHANCE + (combo >= 5 ? COMBO_CRIT_BONUS : 0);
}

/** Доля урона от ошибок, которую поглощает Ментальный щит: 20%, 30%, 40%. */
export function shieldBlock(shieldLevel: number): number {
  return shieldLevel <= 0 ? 0 : 0.1 + shieldLevel * 0.1;
}

/** Секунды, которые добавляют Магические линзы. */
export function lensesBonus(lensLevel: number): number {
  return lensLevel * 2;
}

export function codexChance(codexLevel: number): number {
  return codexLevel * 0.15;
}

/** Цена медитации (полное восстановление HP и маны вне боя). */
export function meditationCost(level: number): number {
  return 8 + level * 4;
}

// ---------------------------------------------------------------------------
// Охота
// ---------------------------------------------------------------------------

export const HUNT_TIERS: Record<HuntTier, { label: string; description: string; levelDelta: number; reward: number }> = {
  easy: { label: 'Тихая тропа', description: 'Враг на уровень слабее. Награда ×0.8', levelDelta: -1, reward: 0.8 },
  normal: { label: 'Лесная чаща', description: 'Враг вашего уровня. Награда ×1', levelDelta: 0, reward: 1 },
  hard: { label: 'Проклятые руины', description: 'Враг на 2 уровня сильнее. Награда ×1.6', levelDelta: 2, reward: 1.6 },
};

// ---------------------------------------------------------------------------
// Дерево апгрейдов
// ---------------------------------------------------------------------------

export interface UpgradeMeta {
  name: string;
  description: string;
  maxLevel: number;
  /** Колонка дерева и уровень в ней. */
  branch: 0 | 1 | 2;
  tier: 0 | 1;
  requires: { id: UpgradeId; level: number } | null;
  effect: (level: number) => string;
  cost: (nextLevel: number) => { gold: number; essences: Partial<Essences> };
}

export const UPGRADES: Record<UpgradeId, UpgradeMeta> = {
  stone: {
    name: 'Философский камень',
    description: 'Пассивно увеличивает критический урон от правильных ответов.',
    maxLevel: 5,
    branch: 0,
    tier: 0,
    requires: null,
    effect: (l) => `Крит ×${critMultiplier(l).toFixed(2)}`,
    cost: (n) => ({ gold: 50 * n, essences: { earth: 3 * n, fire: 3 * n } }),
  },
  codex: {
    name: 'Кодекс эссенций',
    description: 'Шанс получить двойную эссенцию за правильный ответ.',
    maxLevel: 3,
    branch: 0,
    tier: 1,
    requires: { id: 'stone', level: 1 },
    effect: (l) => `Двойная эссенция: ${Math.round(codexChance(l) * 100)}%`,
    cost: (n) => ({ gold: 70 * n, essences: { water: 3 * n, void: 2 * n } }),
  },
  lenses: {
    name: 'Магические линзы',
    description: 'Увеличивают время на размышление на 2 секунды за уровень.',
    maxLevel: 3,
    branch: 1,
    tier: 0,
    requires: null,
    effect: (l) => `+${lensesBonus(l)} с на пример`,
    cost: (n) => ({ gold: 45 * n, essences: { water: 3 * n, earth: 2 * n } }),
  },
  crystal: {
    name: 'Кристалл маны',
    description: 'Каждый правильный ответ приносит больше маны.',
    maxLevel: 3,
    branch: 1,
    tier: 1,
    requires: { id: 'lenses', level: 1 },
    effect: (l) => `+${l * 3} маны за ответ`,
    cost: (n) => ({ gold: 60 * n, essences: { fire: 2 * n, water: 3 * n } }),
  },
  shield: {
    name: 'Ментальный щит',
    description: 'Блокирует часть урона, который враг наносит за ошибки и промедление.',
    maxLevel: 3,
    branch: 2,
    tier: 0,
    requires: null,
    effect: (l) => `Блок ${Math.round(shieldBlock(l) * 100)}% урона`,
    cost: (n) => ({ gold: 60 * n, essences: { earth: 3 * n, void: n } }),
  },
  amulet: {
    name: 'Амулет жизни',
    description: 'Увеличивает максимальное здоровье на 20 за уровень.',
    maxLevel: 5,
    branch: 2,
    tier: 1,
    requires: { id: 'shield', level: 1 },
    effect: (l) => `+${l * 20} к макс. HP`,
    cost: (n) => ({ gold: 55 * n, essences: { earth: 2 * n, fire: 2 * n } }),
  },
};

export const UPGRADE_ORDER: UpgradeId[] = ['stone', 'codex', 'lenses', 'crystal', 'shield', 'amulet'];

// ---------------------------------------------------------------------------
// Книга рецептов
// ---------------------------------------------------------------------------

export const POTION_STACK = 9;

export interface PotionMeta {
  name: string;
  /** Короткое имя для пояса в бою. */
  short: string;
  description: string;
  battleOnly: boolean;
  gold: number;
  essences: Partial<Essences>;
}

export const POTIONS: Record<PotionId, PotionMeta> = {
  health: {
    short: 'Здоровье',
    name: 'Зелье здоровья',
    description: 'Восстанавливает 40% максимального здоровья.',
    battleOnly: false,
    gold: 20,
    essences: { earth: 3, water: 2 },
  },
  freeze: {
    short: 'Заморозка',
    name: 'Зелье заморозки времени',
    description: 'Останавливает таймер врага на 10 секунд.',
    battleOnly: true,
    gold: 30,
    essences: { water: 3, void: 1 },
  },
  bomb: {
    short: 'Автоответ',
    name: 'Бомба-автоответ',
    description: 'Мгновенно решает текущий пример с гарантированным критом.',
    battleOnly: true,
    gold: 40,
    essences: { fire: 3, earth: 2, void: 1 },
  },
  mana: {
    short: 'Мана',
    name: 'Эликсир маны',
    description: 'Восстанавливает 50 маны.',
    battleOnly: false,
    gold: 25,
    essences: { water: 2, fire: 2 },
  },
};

export const POTION_ORDER: PotionId[] = ['health', 'freeze', 'bomb', 'mana'];
export const HEALTH_POTION_RATIO = 0.4;
export const FREEZE_DURATION = 10_000;
export const MANA_POTION_AMOUNT = 50;

// ---------------------------------------------------------------------------
// Книга заклинаний (тратят ману)
// ---------------------------------------------------------------------------

export interface SpellMeta {
  name: string;
  /** Короткое имя для пояса в бою. */
  short: string;
  description: string;
  mana: number;
  unlockLevel: number;
  element: Element;
}

export const SPELLS: Record<SpellId, SpellMeta> = {
  regen: {
    short: 'Руна',
    name: 'Руна восстановления',
    description: 'Лечит 25% максимального здоровья.',
    mana: 35,
    unlockLevel: 1,
    element: 'earth',
  },
  shatter: {
    short: 'Дробитель',
    name: 'Дробитель щитов',
    description: 'Полностью разрушает щит врага.',
    mana: 25,
    unlockLevel: 2,
    element: 'water',
  },
  meteor: {
    short: 'Метеор',
    name: 'Числовой метеор',
    description: 'Наносит 20 + 6 × уровень урона, игнорируя щит.',
    mana: 45,
    unlockLevel: 3,
    element: 'fire',
  },
};

export const SPELL_ORDER: SpellId[] = ['regen', 'shatter', 'meteor'];
export const REGEN_RATIO = 0.25;

export function meteorDamage(level: number): number {
  return 20 + level * 6;
}

// ---------------------------------------------------------------------------
// Блиц
// ---------------------------------------------------------------------------

export const BLITZ_START_TIME = 60_000;
export const BLITZ_BONUS_TIME = 3_000;
export const BLITZ_CORRECT_PER_DIFFICULTY = 4;
/** Комбо выше 20 больше не увеличивает очки (множитель не больше ×3). */
export const BLITZ_COMBO_CAP = 20;
export const BLITZ_MAX_DIFFICULTY = 25;
