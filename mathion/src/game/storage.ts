// Загрузка, проверка и сохранение. Всё, что читается из localStorage, проходит через normalizeState:
// битые поля заменяются значениями по умолчанию, чужие данные отбрасываются.

import type {
  Battle,
  Blitz,
  BlitzElement,
  BlitzRecord,
  Element,
  Enemy,
  Essences,
  GameState,
  LogEntry,
  LogKind,
  PotionId,
  Problem,
  Stats,
  TraitId,
  UpgradeId,
} from '../types';
import { ELEMENTS, LOG_LIMIT, POTION_ORDER, POTION_STACK, RECORDS_LIMIT, STORAGE_KEY, UPGRADES, UPGRADE_ORDER, maxHp, maxMana } from './constants';
import { createInitialState } from './seed';
import { uid } from './utils';

type Obj = Record<string, unknown>;

const LOG_KINDS: LogKind[] = ['attack', 'crit', 'hurt', 'heal', 'loot', 'level', 'boss', 'craft', 'system', 'victory', 'defeat'];
const TRAITS: TraitId[] = ['heat', 'frost_shield', 'poison', 'even_only', 'rage', 'mirror', 'chrono', 'regen', 'void_only', 'phase'];

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function int(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return Math.round(num(value, fallback, min, max));
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function nullableElement(value: unknown): Element | null {
  return typeof value === 'string' && (ELEMENTS as string[]).includes(value) ? (value as Element) : null;
}

function essences(value: unknown): Essences {
  const o = isObj(value) ? value : {};
  return { earth: int(o.earth, 0), fire: int(o.fire, 0), water: int(o.water, 0), void: int(o.void, 0) };
}

function problem(value: unknown): Problem | null {
  if (!isObj(value) || typeof value.display !== 'string' || typeof value.answer !== 'number') return null;
  return {
    id: str(value.id, uid()),
    element: oneOf(value.element, ELEMENTS, 'earth'),
    kind: oneOf(value.kind, ['add', 'sub', 'mixed', 'mul', 'div', 'eq'] as const, 'add'),
    display: value.display,
    solution: str(value.solution, `${value.display} = ${value.answer}`),
    answer: Math.round(value.answer),
    difficulty: int(value.difficulty, 1, 1),
  };
}

function enemy(value: unknown): Enemy | null {
  if (!isObj(value) || typeof value.name !== 'string') return null;
  const maxHpValue = int(value.maxHp, 50, 1);
  return {
    id: str(value.id, uid()),
    templateId: str(value.templateId, 'unknown'),
    name: value.name,
    title: str(value.title, ''),
    kind: oneOf(value.kind, ['monster', 'golem', 'boss'] as const, 'monster'),
    icon: oneOf(
      value.icon,
      ['rat', 'bug', 'snail', 'bird', 'ghost', 'skull', 'golem', 'anvil', 'flame', 'snowflake', 'eye', 'hourglass', 'crown', 'orbit', 'axe', 'hexagon', 'biohazard'] as const,
      'skull',
    ),
    level: int(value.level, 1, 1),
    maxHp: maxHpValue,
    hp: int(value.hp, maxHpValue, 0, maxHpValue),
    shield: int(value.shield, 0),
    maxShield: int(value.maxShield, 0),
    attack: int(value.attack, 5, 1),
    attackBonus: int(value.attackBonus, 0),
    attackTime: num(value.attackTime, 12, 4, 60),
    weakness: nullableElement(value.weakness),
    resist: nullableElement(value.resist),
    traits: Array.isArray(value.traits) ? value.traits.filter((t): t is TraitId => typeof t === 'string' && (TRAITS as string[]).includes(t)) : [],
    enraged: value.enraged === true,
  };
}

function battle(value: unknown): Battle | null {
  if (!isObj(value)) return null;
  const e = enemy(value.enemy);
  const p = problem(value.problem);
  if (!e || !p) return null;
  const status = oneOf(value.status, ['active', 'victory', 'defeat'] as const, 'active');
  const timeLimit = int(value.timeLimit, 12000, 1000);
  const rewards = isObj(value.rewards)
    ? { gold: int(value.rewards.gold, 0), xp: int(value.rewards.xp, 0), essences: essences(value.rewards.essences), firstClear: value.rewards.firstClear === true }
    : null;
  return {
    mode: value.mode === 'campaign' ? 'campaign' : 'hunt',
    floor: typeof value.floor === 'number' ? int(value.floor, 1, 1, 10) : null,
    huntTier: value.huntTier === 'easy' || value.huntTier === 'hard' || value.huntTier === 'normal' ? value.huntTier : null,
    enemy: e,
    element: oneOf(value.element, ELEMENTS, p.element),
    problem: p,
    // После перезагрузки на текущий пример даётся полное время — таймер пока страница закрыта не идёт.
    timeLeft: timeLimit,
    timeLimit,
    freezeLeft: int(value.freezeLeft, 0),
    combo: int(value.combo, 0),
    maxCombo: int(value.maxCombo, 0),
    poisonTurns: int(value.poisonTurns, 0, 0, 10),
    turn: int(value.turn, 1, 1),
    correct: int(value.correct, 0),
    wrong: int(value.wrong, 0),
    damageDealt: int(value.damageDealt, 0),
    damageTaken: int(value.damageTaken, 0),
    status,
    rewards: status === 'victory' ? rewards : null,
    goldLost: int(value.goldLost, 0),
  };
}

const BLITZ_ELEMENTS: BlitzElement[] = ['earth', 'fire', 'water', 'void', 'chaos'];

function blitz(value: unknown): Blitz | null {
  if (!isObj(value)) return null;
  const p = problem(value.problem);
  if (!p) return null;
  const status = value.status === 'over' ? 'over' : 'active';
  return {
    element: oneOf(value.element, BLITZ_ELEMENTS, 'earth'),
    status,
    timeLeft: int(value.timeLeft, 0),
    elapsed: int(value.elapsed, 0),
    score: int(value.score, 0),
    correct: int(value.correct, 0),
    wrong: int(value.wrong, 0),
    combo: int(value.combo, 0),
    maxCombo: int(value.maxCombo, 0),
    problem: p,
    tally: essences(value.tally),
    rewards: isObj(value.rewards) ? { gold: int(value.rewards.gold, 0), essences: essences(value.rewards.essences) } : null,
    recordRank: typeof value.recordRank === 'number' ? int(value.recordRank, 1, 1, RECORDS_LIMIT) : null,
  };
}

function record(value: unknown): BlitzRecord | null {
  if (!isObj(value) || typeof value.score !== 'number') return null;
  return {
    id: str(value.id, uid()),
    score: int(value.score, 0),
    correct: int(value.correct, 0),
    wrong: int(value.wrong, 0),
    maxCombo: int(value.maxCombo, 0),
    element: oneOf(value.element, BLITZ_ELEMENTS, 'earth'),
    date: int(value.date, Date.now()),
  };
}

function logEntry(value: unknown): LogEntry | null {
  if (!isObj(value) || typeof value.text !== 'string') return null;
  return { id: str(value.id, uid()), ts: int(value.ts, Date.now()), kind: oneOf(value.kind, LOG_KINDS, 'system'), text: value.text };
}

function stats(value: unknown, fallback: Stats): Stats {
  const o = isObj(value) ? value : {};
  const by = isObj(o.byElement) ? o.byElement : {};
  const byElement = { ...fallback.byElement };
  for (const el of ELEMENTS) {
    const e = isObj(by[el]) ? (by[el] as Obj) : {};
    byElement[el] = { correct: int(e.correct, 0), wrong: int(e.wrong, 0) };
  }
  return {
    battlesWon: int(o.battlesWon, 0),
    battlesLost: int(o.battlesLost, 0),
    bossesSlain: int(o.bossesSlain, 0),
    totalDamage: int(o.totalDamage, 0),
    bestHit: int(o.bestHit, 0),
    crits: int(o.crits, 0),
    potionsUsed: int(o.potionsUsed, 0),
    spellsCast: int(o.spellsCast, 0),
    byElement,
  };
}

function compact<T>(list: Array<T | null>): T[] {
  return list.filter((item): item is T => item !== null);
}

export function normalizeState(raw: unknown): GameState | null {
  if (!isObj(raw) || raw.version !== 1 || !isObj(raw.player)) return null;
  const base = createInitialState();
  const p = raw.player;
  const upgradesRaw = isObj(raw.upgrades) ? raw.upgrades : {};
  const upgrades = { ...base.upgrades };
  for (const id of UPGRADE_ORDER) upgrades[id as UpgradeId] = int(upgradesRaw[id], 0, 0, UPGRADES[id].maxLevel);
  const potionsRaw = isObj(raw.potions) ? raw.potions : {};
  const potions = { ...base.potions };
  for (const id of POTION_ORDER) potions[id as PotionId] = int(potionsRaw[id], 0, 0, POTION_STACK);

  const state: GameState = {
    version: 1,
    player: {
      name: str(p.name, base.player.name).slice(0, 24) || base.player.name,
      level: int(p.level, 1, 1, 99),
      xp: int(p.xp, 0),
      hp: int(p.hp, base.player.hp),
      mana: int(p.mana, base.player.mana),
      gold: int(p.gold, 0),
      essences: essences(p.essences),
    },
    upgrades,
    potions,
    campaignCleared: int(raw.campaignCleared, 0, 0, 10),
    battle: battle(raw.battle),
    blitz: blitz(raw.blitz),
    records: compact(Array.isArray(raw.records) ? raw.records.map(record) : [])
      .sort((a, b) => b.score - a.score)
      .slice(0, RECORDS_LIMIT),
    stats: stats(raw.stats, base.stats),
    log: compact(Array.isArray(raw.log) ? raw.log.map(logEntry) : []).slice(0, LOG_LIMIT),
    createdAt: int(raw.createdAt, Date.now()),
  };
  state.player.hp = Math.min(state.player.hp, maxHp(state));
  state.player.mana = Math.min(state.player.mana, maxMana(state));
  // Бой и блиц не могут идти одновременно.
  if (state.battle && state.blitz) state.blitz = null;
  return state;
}

export function loadState(): GameState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = normalizeState(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    // Хранилище недоступно или данные повреждены — начинаем заново.
  }
  return createInitialState();
}

export function saveState(state: GameState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Не критично: настройка интерфейса просто не запомнится.
  }
}
