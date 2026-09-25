import type { GameState } from '../types';
import { BASE_HP, BASE_MANA } from './constants';
import { uid } from './utils';

/** Новая игра: немного золота, эссенций и зелий, чтобы сразу попробовать крафт и бой. */
export function createInitialState(): GameState {
  const now = Date.now();
  return {
    version: 1,
    player: {
      name: 'Ученик алхимика',
      level: 1,
      xp: 0,
      hp: BASE_HP,
      mana: Math.round(BASE_MANA / 2),
      gold: 80,
      essences: { earth: 6, fire: 5, water: 5, void: 2 },
    },
    upgrades: { stone: 0, codex: 0, lenses: 0, crystal: 0, shield: 0, amulet: 0 },
    potions: { health: 2, freeze: 1, bomb: 1, mana: 0 },
    campaignCleared: 0,
    battle: null,
    blitz: null,
    records: [],
    stats: {
      battlesWon: 0,
      battlesLost: 0,
      bossesSlain: 0,
      totalDamage: 0,
      bestHit: 0,
      crits: 0,
      potionsUsed: 0,
      spellsCast: 0,
      byElement: {
        earth: { correct: 0, wrong: 0 },
        fire: { correct: 0, wrong: 0 },
        water: { correct: 0, wrong: 0 },
        void: { correct: 0, wrong: 0 },
      },
    },
    log: [
      {
        id: uid(),
        ts: now,
        kind: 'system',
        text: 'Добро пожаловать в лабораторию Mathion! Решайте примеры, чтобы творить заклинания: Земля — сложение и вычитание, Огонь — умножение, Вода — деление.',
      },
    ],
    createdAt: now,
  };
}
