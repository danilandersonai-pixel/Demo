/**
 * Баланс и стартовые пресеты (темы, скины, улучшения, препятствия).
 * Все числа игры живут здесь: симуляция, генератор трека и тесты читают их отсюда.
 */
import type {
  Loadout,
  ObstacleKind,
  SimLoadout,
  Skin,
  SkinId,
  Theme,
  ThemeId,
  Upgrade,
  UpgradeId,
  UpgradeLevels,
} from './types';

// ─── Мир ────────────────────────────────────────────────────────────────────

export const WORLD = {
  /** Ширина дороги, единицы мира. */
  roadW: 100,
  /** Глубина, на которой объекты появляются из дымки. */
  zFar: 400,
  /** На сколько объект уходит за линию корабля, прежде чем исчезнуть. */
  zBehind: 70,
} as const;

// ─── Баланс ─────────────────────────────────────────────────────────────────

export const GAME = {
  /** Время подлёта объекта от zFar до корабля. */
  approach: {
    /** Тиков на 1-м уровне (300 тиков = 2.34 с). */
    base: 300,
    /** Прирост скорости за уровень: 0.13 = +13 %. */
    perLevel: 0.13,
    /** Быстрее этого объекты не летят (100 тиков = 0.78 с, скорость ×3). */
    min: 100,
  },

  player: {
    /** Радиус хитбокса; нарисованный корабль примерно вдвое больше. */
    radius: 2.6,
    /** Клавиатура: предел скорости (ед/с), ускорение (ед/с²), торможение (1/с). */
    maxSpeed: 150,
    accel: 1500,
    friction: 12,
    /** Мышь/палец: скорость следования (1/с) и предел скорости (ед/с). */
    pointerFollow: 16,
    pointerMaxSpeed: 280,
    /** Отступ центра корабля от края дороги. */
    edge: 5,
    /** Как быстро крен догоняет скорость (1/с). */
    bankRate: 10,
  },

  combo: {
    /** Сфер подряд на +1 к множителю. */
    step: 4,
    maxMultiplier: 8,
    /** OVERDRIVE (множитель на максимуме): очки умножаются ещё на это. */
    overdriveBonus: 2,
  },

  score: {
    /** За каждую прожитую долю (× уровень × множитель). */
    perBeat: 5,
    crystal: 100,
    rareCrystal: 500,
    dodge: 20,
    nearMiss: 150,
  },

  /** Зазор между хитбоксами, который считается «почти задел». */
  nearMissClear: 2.2,

  crystal: {
    radius: 2.2,
    rareRadius: 2.9,
    /** Запас к радиусу подбора: сфера берётся при |Δx| ≤ радиус + радиус корабля + pad. */
    pickupPad: 1.2,
    currency: 1,
    rareCurrency: 5,
    /** Базовый шанс редкой сферы (+ улучшение lucky). */
    rareChance: 0.06,
  },

  magnet: {
    /** Базовый поперечный радиус (+ улучшение fieldAmp). */
    radius: 14,
    /** За сколько тиков до прилёта сфера начинает притягиваться. */
    leadTicks: 48,
    /** Предел скорости притяжения, ед/с. */
    pullSpeed: 75,
  },

  shield: {
    /** Тики неуязвимости после срабатывания щита (205 тиков = 1.6 с). */
    invulnTicks: 205,
  },

  /** «Виляние» препятствий — со 2-го уровня. */
  sway: {
    startLevel: 2,
    chanceBase: 0.3,
    chancePerLevel: 0.1,
    chanceMax: 0.85,
    ampBase: 9,
    ampPerLevel: 2,
    ampMax: 26,
    periodBase: 280,
    periodPerLevel: 16,
    periodMin: 120,
  },

  /** Хитбоксы относительно нарисованного размера (прощающие). */
  hitbox: {
    cube: 0.9,
    saw: 0.88,
    /** Какая доля радиуса корабля учитывается у лазера. */
    laserPlayer: 0.8,
  },

  /** Честность трека: генератор обязан оставлять проход, достижимый «неидеальным» игроком. */
  fairness: {
    /** Минимальная ширина прохода: 3.2 диаметра корабля. */
    minGap: 16.64,
    /** Скорость, на которую рассчитаны перестроения (55 % от предельной). */
    assumedSpeed: 82.5,
  },

  death: {
    /** Замедление времени во время взрыва. */
    timeScale: 0.32,
    /** Тиков взрыва до экрана Game Over (56 тиков при 0.32× ≈ 1.37 с). */
    ticks: 56,
  },

  /** Тряска камеры (косметика рендера). */
  shake: {
    maxOffset: 16,
    decay: 1.8,
    hit: 1,
    shield: 0.65,
    levelUp: 0.5,
    nearMiss: 0.12,
  },

  /** Препятствия не прилетают раньше этого такта от GO (первый такт — только сферы). */
  firstObstacleBar: 1,

  limits: {
    obstacles: 64,
    crystals: 96,
  },
} as const;

// ─── Кривая сложности ───────────────────────────────────────────────────────

/** Множитель скорости уровня: ×1.00, ×1.13, ×1.26 … до ×3.00. */
export function speedMultForLevel(level: number): number {
  const a = GAME.approach;
  return Math.min(1 + a.perLevel * (Math.max(1, level) - 1), a.base / a.min);
}

/** Время подлёта для уровня, тики. */
export function approachTicksForLevel(level: number): number {
  return Math.max(GAME.approach.min, Math.round(GAME.approach.base / speedMultForLevel(level)));
}

/** Вероятность, что препятствие пойдёт зигзагом (0 на 1-м уровне). */
export function swayChance(level: number): number {
  const s = GAME.sway;
  if (level < s.startLevel) return 0;
  return Math.min(s.chanceBase + s.chancePerLevel * (level - s.startLevel), s.chanceMax);
}

export function swayAmp(level: number): number {
  const s = GAME.sway;
  return Math.min(s.ampBase + s.ampPerLevel * Math.max(0, level - s.startLevel), s.ampMax);
}

export function swayPeriodTicks(level: number): number {
  const s = GAME.sway;
  return Math.max(s.periodMin, s.periodBase - s.periodPerLevel * Math.max(0, level - s.startLevel));
}

/** Множитель комбо по длине цепочки: x1, x2 … до maxMultiplier. */
export function multiplierForChain(chain: number): number {
  return Math.min(1 + Math.floor(chain / GAME.combo.step), GAME.combo.maxMultiplier);
}

/** Половина ширины прохода в лазерной стене: сужается с уровнем. */
export function laserHalfGapForLevel(level: number): number {
  return Math.max(15 - 0.7 * (level - 2), LASER_HALF_GAP_MIN);
}
export const LASER_HALF_GAP_MIN = 9.5;

// ─── Препятствия ────────────────────────────────────────────────────────────

export interface ObstaclePreset {
  kind: ObstacleKind;
  title: string;
  description: string;
  /** С какого уровня появляется. */
  minLevel: number;
  /** Вес выбора на minLevel и прибавка за каждый следующий уровень. */
  weight: number;
  weightPerLevel: number;
  /** Диапазон halfW (для laser не используется — см. laserHalfGapForLevel). */
  sizeMin: number;
  sizeMax: number;
  /** Половина хитбокса по глубине; null — равна halfW (куб). */
  halfD: number | null;
  /** Диапазон скорости вращения по модулю, рад/с. */
  spinMin: number;
  spinMax: number;
}

export const OBSTACLES: Record<ObstacleKind, ObstaclePreset> = {
  cube: {
    kind: 'cube',
    title: 'Неоновый куб',
    description: 'Каркасный куб, вращается на лету. Самое частое препятствие.',
    minLevel: 1,
    weight: 5,
    weightPerLevel: 0,
    sizeMin: 4.5,
    sizeMax: 6.5,
    halfD: null,
    spinMin: 0.6,
    spinMax: 2.4,
  },
  saw: {
    kind: 'saw',
    title: 'Циркулярная пила',
    description: 'Диск с зубьями катится по дороге ребром. Широкая, но тонкая.',
    minLevel: 1,
    weight: 2,
    weightPerLevel: 0.5,
    sizeMin: 5,
    sizeMax: 8,
    halfD: 1.2,
    spinMin: 7,
    spinMax: 13,
  },
  laser: {
    kind: 'laser',
    title: 'Лазерные ворота',
    description: 'Луч поперёк всей дороги с одним проходом. Со 2-го уровня.',
    minLevel: 2,
    weight: 1.2,
    weightPerLevel: 0.35,
    sizeMin: 0,
    sizeMax: 0,
    halfD: 1,
    spinMin: 0,
    spinMax: 0,
  },
};

// ─── Темы ───────────────────────────────────────────────────────────────────

export const THEMES: Record<ThemeId, Theme> = {
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Neon Cyberpunk',
    tagline: 'Ночной мегаполис: ядовитая маджента, бирюза и небоскрёбы на горизонте.',
    price: 0,
    scenery: 'city',
    colors: {
      bg: '#05050a',
      skyTop: '#04030d',
      skyBottom: '#2b0a3d',
      sunTop: '#ffe94a',
      sunBottom: '#ff2bd6',
      haze: '#ff2bd6',
      road: '#07061a',
      grid: ['#ff2bd6', '#22f0ff', '#a855f7', '#ffe94a', '#ff5f1f', '#39ff88'],
      rail: '#22f0ff',
      sceneryNear: '#22f0ff',
      sceneryFar: '#8b3dff',
      ship: '#22f0ff',
      shipCore: '#e6feff',
      trail: '#ff2bd6',
      cube: '#ff2bd6',
      saw: '#ffe94a',
      laser: '#ff3b6b',
      crystal: '#22f0ff',
      crystalRare: '#ffe94a',
      accent: '#ff2bd6',
      accent2: '#22f0ff',
      accent3: '#ffe94a',
    },
  },
  gold: {
    id: 'gold',
    name: 'Retrowave Gold',
    tagline: 'Закат восьмидесятых: золото, огромное солнце и пальмы вдоль шоссе.',
    price: 400,
    scenery: 'palms',
    colors: {
      bg: '#0a0508',
      skyTop: '#0d0314',
      skyBottom: '#5a1230',
      sunTop: '#fff3b0',
      sunBottom: '#ff7a00',
      haze: '#ff7a3d',
      road: '#120610',
      grid: ['#ffb300', '#ff6a00', '#ff3d7f', '#ffd700', '#c026d3'],
      rail: '#ffd23f',
      sceneryNear: '#ff3d7f',
      sceneryFar: '#7a1f6b',
      ship: '#ffd23f',
      shipCore: '#fff8e1',
      trail: '#ff8a00',
      cube: '#ff3d7f',
      saw: '#c084fc',
      laser: '#ff5a1f',
      crystal: '#ffe066',
      crystalRare: '#ff4fd8',
      accent: '#ffb300',
      accent2: '#ff3d7f',
      accent3: '#fff3b0',
    },
  },
  acid: {
    id: 'acid',
    name: 'Toxic Acid',
    tagline: 'Кислотный рейв: радиоактивный лайм, фиолетовый туман и трубы заводов.',
    price: 400,
    scenery: 'toxic',
    colors: {
      bg: '#030805',
      skyTop: '#020803',
      skyBottom: '#17381d',
      sunTop: '#eaff00',
      sunBottom: '#1fd65f',
      haze: '#7dff3a',
      road: '#040d07',
      grid: ['#39ff14', '#b6ff00', '#00ffa3', '#d4ff3a', '#a855f7'],
      rail: '#b6ff00',
      sceneryNear: '#39ff14',
      sceneryFar: '#6d28d9',
      ship: '#b6ff00',
      shipCore: '#f4ffd6',
      trail: '#39ff14',
      cube: '#a855f7',
      saw: '#eaff00',
      laser: '#ff2e63',
      crystal: '#00ffa3',
      crystalRare: '#f0abfc',
      accent: '#39ff14',
      accent2: '#a855f7',
      accent3: '#eaff00',
    },
  },
  arctic: {
    id: 'arctic',
    name: 'Arctic Pulse',
    tagline: 'Ледяной неон: холодная синева, острые пики и северное сияние.',
    price: 700,
    scenery: 'aurora',
    colors: {
      bg: '#02050c',
      skyTop: '#020617',
      skyBottom: '#0c2a4a',
      sunTop: '#e0f2fe',
      sunBottom: '#38bdf8',
      haze: '#7dd3fc',
      road: '#030a16',
      grid: ['#38bdf8', '#818cf8', '#22d3ee', '#e0f2fe', '#f472b6'],
      rail: '#e0f2fe',
      sceneryNear: '#7dd3fc',
      sceneryFar: '#34d399',
      ship: '#e0f2fe',
      shipCore: '#ffffff',
      trail: '#38bdf8',
      cube: '#818cf8',
      saw: '#22d3ee',
      laser: '#f472b6',
      crystal: '#a5f3fc',
      crystalRare: '#fde047',
      accent: '#38bdf8',
      accent2: '#f472b6',
      accent3: '#fde047',
    },
  },
};

export const THEME_ORDER: ThemeId[] = ['cyberpunk', 'gold', 'acid', 'arctic'];

// ─── Скины корабля ──────────────────────────────────────────────────────────

const NO_PERKS = { trail: false, shieldCharges: 0, magnet: false, scoreBonus: 0 };

export const SKINS: Record<SkinId, Skin> = {
  core: {
    id: 'core',
    name: 'Neon Core',
    title: 'Неоновое ядро',
    description: 'Стартовый корабль. Лёгкий, быстрый, без особых систем.',
    price: 0,
    shape: 'arrow',
    perks: { ...NO_PERKS },
  },
  trail: {
    id: 'trail',
    name: 'Neon Trail',
    title: 'Неоновый шлейф',
    description: 'Оставляет хвост из светящихся частиц. За эффектность — +10 % к очкам.',
    price: 300,
    shape: 'delta',
    perks: { ...NO_PERKS, trail: true, scoreBonus: 0.1 },
  },
  magnet: {
    id: 'magnet',
    name: 'Magnet',
    title: 'Магнит',
    description: 'Поле слегка притягивает энергетические сферы — проще держать комбо.',
    price: 450,
    shape: 'wing',
    perks: { ...NO_PERKS, magnet: true },
    hull: '#ffe94a',
    core: '#fffbe0',
  },
  ghost: {
    id: 'ghost',
    name: 'Ghost Shield',
    title: 'Щит-призрак',
    description: 'Призрачный щит прощает одно столкновение за забег.',
    price: 650,
    shape: 'orb',
    perks: { ...NO_PERKS, shieldCharges: 1 },
    hull: '#c4b5fd',
    core: '#f5f3ff',
  },
  singularity: {
    id: 'singularity',
    name: 'Singularity',
    title: 'Сингулярность',
    description: 'Всё сразу: шлейф, магнит и щит-призрак, плюс +15 % к очкам.',
    price: 2500,
    shape: 'star',
    perks: { trail: true, shieldCharges: 1, magnet: true, scoreBonus: 0.15 },
    hull: '#ffffff',
    core: '#ff2bd6',
  },
};

export const SKIN_ORDER: SkinId[] = ['core', 'trail', 'magnet', 'ghost', 'singularity'];

// ─── Улучшения ──────────────────────────────────────────────────────────────

export const UPGRADES: Record<UpgradeId, Upgrade> = {
  resonator: {
    id: 'resonator',
    title: 'Кристальный резонатор',
    description: '+20 % кристаллов за каждый забег.',
    maxTier: 3,
    prices: [200, 500, 1000],
    perTier: 0.2,
  },
  fieldAmp: {
    id: 'fieldAmp',
    title: 'Усилитель поля',
    description: '+30 % к радиусу магнита. Работает на кораблях с магнитом.',
    maxTier: 3,
    prices: [250, 600, 1200],
    perTier: 0.3,
  },
  lucky: {
    id: 'lucky',
    title: 'Призма удачи',
    description: '+4 % к шансу редкой сферы (×5 очков и валюты).',
    maxTier: 3,
    prices: [150, 400, 900],
    perTier: 0.04,
  },
};

export const UPGRADE_ORDER: UpgradeId[] = ['resonator', 'fieldAmp', 'lucky'];

export const DEFAULT_UPGRADES: UpgradeLevels = { resonator: 0, fieldAmp: 0, lucky: 0 };

// ─── Производные параметры снаряжения ───────────────────────────────────────

export function crystalYield(upgrades: UpgradeLevels): number {
  return 1 + UPGRADES.resonator.perTier * upgrades.resonator;
}

export function magnetRadius(skin: Skin, upgrades: UpgradeLevels): number {
  if (!skin.perks.magnet) return 0;
  return GAME.magnet.radius * (1 + UPGRADES.fieldAmp.perTier * upgrades.fieldAmp);
}

export function rareChance(upgrades: UpgradeLevels): number {
  return GAME.crystal.rareChance + UPGRADES.lucky.perTier * upgrades.lucky;
}

export function shipColors(skin: Skin, theme: Theme): { hull: string; core: string } {
  return { hull: skin.hull ?? theme.colors.ship, core: skin.core ?? theme.colors.shipCore };
}

/** Свести снаряжение к числам для симуляции. */
export function toSimLoadout(loadout: Loadout): SimLoadout {
  return {
    shieldCharges: loadout.skin.perks.shieldCharges,
    magnetRadius: magnetRadius(loadout.skin, loadout.upgrades),
    scoreBonus: loadout.skin.perks.scoreBonus,
    crystalYield: crystalYield(loadout.upgrades),
    rareChance: rareChance(loadout.upgrades),
    highscore: loadout.highscore,
  };
}

/** Снаряжение по умолчанию для тестов и фоновой сцены. */
export const BASE_SIM_LOADOUT: SimLoadout = {
  shieldCharges: 0,
  magnetRadius: 0,
  scoreBonus: 0,
  crystalYield: 1,
  rareChance: GAME.crystal.rareChance,
  highscore: 0,
};
