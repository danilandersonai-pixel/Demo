/**
 * Стартовые пресеты (темы, скины, улучшения, препятствия) и параметры баланса.
 * Все числа баланса живут здесь — движок не должен хардкодить свои.
 */
import type { ObstacleKind, Skin, SkinId, Theme, ThemeId, Upgrade, UpgradeId, UpgradeLevels } from './types';

/** Ширина мира в мировых единицах — одинакова на любом экране. */
export const WORLD_W = 480;
/** Эталонная высота мира: скорости заданы для неё и масштабируются под реальную. */
export const REFERENCE_WORLD_H = 800;

// ─── Баланс ─────────────────────────────────────────────────────────────────

export const GAME = {
  /** Каждые 15 секунд — новый уровень скорости. */
  levelDuration: 15,
  /** Первые секунды забега без препятствий (баннер READY → GO!). */
  startGrace: 1.6,
  /** Максимальный шаг симуляции: update() делит dt на подшаги не длиннее этого. */
  fixedStep: 1 / 120,
  /** Кадр длиннее этого считается лагом и обрезается. */
  maxFrameDt: 0.05,

  speed: {
    /** Базовая скорость падения препятствий при speedMult = 1, ед/с (для REFERENCE_WORLD_H). */
    base: 270,
    /** Прибавка множителя скорости за уровень. */
    perLevel: 0.14,
    max: 3.3,
    /** Скорость прокрутки фона в attract-режиме (доля от base). */
    attract: 0.45,
  },

  rhythm: {
    bpmBase: 112,
    bpmPerLevel: 6,
    bpmMax: 172,
  },

  player: {
    /** Радиус хитбокса. Нарисованный корабль больше (~22 ед. в высоту). */
    radius: 11,
    /** Расстояние от центра корабля до нижнего края мира. */
    yFromBottom: 118,
    /** Клавиатура: ускорение, максимальная скорость, торможение (1/с). */
    accel: 5200,
    maxSpeed: 640,
    friction: 12,
    /** Мышь/палец: скорость следования (1/с) и предел скорости. */
    pointerFollow: 16,
    pointerMaxSpeed: 1100,
    /** Отступ от краёв поля. */
    edgePadding: 16,
  },

  combo: {
    /** Сколько сфер подряд нужно на +1 к множителю. */
    step: 3,
    maxMultiplier: 10,
  },

  score: {
    /** Очки за секунду выживания (умножаются на уровень и комбо). */
    perSecond: 10,
    crystal: 50,
    rareCrystal: 250,
    /** Препятствие прошло мимо. */
    dodge: 10,
    nearMiss: 50,
  },

  /** Зазор между хитбоксами, который считается «почти задел». */
  nearMissDistance: 20,

  crystal: {
    radius: 10,
    rareRadius: 13,
    /** Базовый шанс редкой сферы (+ lucky-улучшение). */
    rareChance: 0.06,
    /** Валюта за сферу. */
    currency: 1,
    rareCurrency: 5,
    /** Скорость падения относительно препятствий. */
    speedFactor: 0.85,
  },

  magnet: {
    /**
     * Базовый радиус притяжения, ед. (+ fieldAmp-улучшение). Задан для эталонной
     * высоты мира: по Y поле, как и скорости падения, × heightFactor (эллипс).
     */
    radius: 150,
    /** Сила притяжения, ед/с² (по Y тоже × heightFactor). */
    strength: 2600,
  },

  shield: {
    /** Секунды неуязвимости после срабатывания щита. */
    invuln: 1.6,
  },

  zigzag: {
    /** С какого уровня препятствия начинают вилять. */
    startLevel: 2,
    chanceBase: 0.3,
    chancePerLevel: 0.1,
    chanceMax: 0.85,
    ampBase: 42,
    ampPerLevel: 9,
    ampMax: 130,
    freqBase: 0.45,
    freqPerLevel: 0.05,
    freqMax: 1.0,
  },

  /** Хитбоксы препятствий относительно нарисованного размера (прощающие). */
  hitbox: {
    cube: 0.9,
    saw: 0.86,
    laser: 0.8,
  },

  shake: {
    /** Максимальное смещение камеры, CSS-пикселей. */
    maxOffset: 18,
    /** Скорость затухания травмы, 1/с. */
    decay: 1.8,
    hit: 1,
    shield: 0.65,
    levelUp: 0.45,
    nearMiss: 0.12,
  },

  death: {
    /** Замедление времени при взрыве. */
    slowMo: 0.3,
    /** Сколько реальных секунд длится взрыв до экрана Game Over. */
    duration: 1.35,
  },

  particles: {
    max: 1600,
  },
} as const;

// ─── Кривая сложности ───────────────────────────────────────────────────────

export function levelForTime(runTime: number): number {
  return 1 + Math.floor(Math.max(0, runTime) / GAME.levelDuration);
}

export function speedMultForLevel(level: number): number {
  return Math.min(1 + GAME.speed.perLevel * (level - 1), GAME.speed.max);
}

export function bpmForLevel(level: number): number {
  return Math.min(GAME.rhythm.bpmBase + GAME.rhythm.bpmPerLevel * (level - 1), GAME.rhythm.bpmMax);
}

/** Вероятность, что новое препятствие пойдёт зигзагом (0 до startLevel). */
export function zigzagChance(level: number): number {
  const z = GAME.zigzag;
  if (level < z.startLevel) return 0;
  return Math.min(z.chanceBase + z.chancePerLevel * (level - z.startLevel), z.chanceMax);
}

export function zigzagAmp(level: number): number {
  const z = GAME.zigzag;
  return Math.min(z.ampBase + z.ampPerLevel * Math.max(0, level - z.startLevel), z.ampMax);
}

export function zigzagFreq(level: number): number {
  const z = GAME.zigzag;
  return Math.min(z.freqBase + z.freqPerLevel * Math.max(0, level - z.startLevel), z.freqMax);
}

/** Множитель комбо по длине цепочки: x1, x2, x3 … до maxMultiplier. */
export function multiplierForChain(chain: number): number {
  return Math.min(1 + Math.floor(chain / GAME.combo.step), GAME.combo.maxMultiplier);
}

// ─── Препятствия ────────────────────────────────────────────────────────────

export interface ObstaclePreset {
  kind: ObstacleKind;
  /** Название для «Как играть». */
  title: string;
  description: string;
  /** С какого уровня появляется. */
  minLevel: number;
  /** Вес выбора на minLevel и прибавка веса за каждый следующий уровень. */
  weight: number;
  weightPerLevel: number;
  /** Диапазон size (см. Obstacle.size). */
  sizeMin: number;
  sizeMax: number;
  /** Относительная скорость падения. */
  speedFactor: number;
  /** Диапазон скорости вращения по модулю, рад/с. */
  spinMin: number;
  spinMax: number;
}

export const OBSTACLES: Record<ObstacleKind, ObstaclePreset> = {
  cube: {
    kind: 'cube',
    title: 'Неоновый куб',
    description: 'Вращающийся каркасный куб. Самое частое препятствие.',
    minLevel: 1,
    weight: 5,
    weightPerLevel: 0,
    sizeMin: 15,
    sizeMax: 27,
    speedFactor: 1,
    spinMin: 0.6,
    spinMax: 2.6,
  },
  saw: {
    kind: 'saw',
    title: 'Циркулярная пила',
    description: 'Раскрученный диск с зубьями. Круглый хитбокс, но большой.',
    minLevel: 1,
    weight: 2,
    weightPerLevel: 0.5,
    sizeMin: 20,
    sizeMax: 34,
    speedFactor: 0.9,
    spinMin: 7,
    spinMax: 13,
  },
  laser: {
    kind: 'laser',
    title: 'Лазерная стена',
    description: 'Луч во всю ширину поля с одним проходом. Со 2-го уровня.',
    minLevel: 2,
    weight: 1.2,
    weightPerLevel: 0.35,
    sizeMin: 4,
    sizeMax: 5,
    speedFactor: 0.72,
    spinMin: 0,
    spinMax: 0,
  },
};

/** Ширина прохода в лазерной стене: сужается с уровнем, но не меньше laserGapMin. */
export function laserGapForLevel(level: number): number {
  return Math.max(150 - 7 * (level - 2), LASER_GAP_MIN);
}
export const LASER_GAP_MIN = 96;

// ─── Темы ───────────────────────────────────────────────────────────────────

export const THEMES: Record<ThemeId, Theme> = {
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Neon Cyberpunk',
    tagline: 'Классика: ядовитая маджента и бирюза ночного мегаполиса.',
    price: 0,
    colors: {
      bg: '#05050a',
      skyTop: '#05030f',
      skyBottom: '#2b0a3d',
      sunTop: '#ffe94a',
      sunBottom: '#ff2bd6',
      grid: ['#ff2bd6', '#22f0ff', '#a855f7', '#ffe94a', '#ff5f1f', '#39ff88'],
      player: '#22f0ff',
      playerCore: '#e6feff',
      trail: '#ff2bd6',
      cube: '#ff2bd6',
      laser: '#ff3b6b',
      saw: '#ffe94a',
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
    tagline: 'Закат восьмидесятых: золото, оранжевое солнце и хром.',
    price: 400,
    colors: {
      bg: '#0a0508',
      skyTop: '#0d0314',
      skyBottom: '#4a0f2e',
      sunTop: '#fff3b0',
      sunBottom: '#ff7a00',
      grid: ['#ffb300', '#ff6a00', '#ff3d7f', '#ffd700', '#c026d3'],
      player: '#ffd23f',
      playerCore: '#fff8e1',
      trail: '#ff8a00',
      cube: '#ff3d7f',
      laser: '#ff5a1f',
      saw: '#c084fc',
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
    tagline: 'Кислотный рейв: радиоактивный лайм и фиолетовый туман.',
    price: 400,
    colors: {
      bg: '#030805',
      skyTop: '#020803',
      skyBottom: '#15331c',
      sunTop: '#eaff00',
      sunBottom: '#1fd65f',
      grid: ['#39ff14', '#b6ff00', '#00ffa3', '#d4ff3a', '#a855f7'],
      player: '#b6ff00',
      playerCore: '#f4ffd6',
      trail: '#39ff14',
      cube: '#a855f7',
      laser: '#ff2e63',
      saw: '#eaff00',
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
    tagline: 'Ледяной неон: холодный синий, северное сияние и розовые лазеры.',
    price: 700,
    colors: {
      bg: '#02050c',
      skyTop: '#020617',
      skyBottom: '#0c2a4a',
      sunTop: '#e0f2fe',
      sunBottom: '#38bdf8',
      grid: ['#38bdf8', '#818cf8', '#22d3ee', '#e0f2fe', '#f472b6'],
      player: '#e0f2fe',
      playerCore: '#ffffff',
      trail: '#38bdf8',
      cube: '#818cf8',
      laser: '#f472b6',
      saw: '#22d3ee',
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
    description: 'Оставляет хвост из светящихся частиц. Эффектность приносит +10 % к очкам.',
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

/** Множитель заработка валюты с учётом резонатора. */
export function crystalYield(upgrades: UpgradeLevels): number {
  return 1 + UPGRADES.resonator.perTier * upgrades.resonator;
}

/** Радиус магнита (0 — у скина нет магнита). */
export function magnetRadius(skin: Skin, upgrades: UpgradeLevels): number {
  if (!skin.perks.magnet) return 0;
  return GAME.magnet.radius * (1 + UPGRADES.fieldAmp.perTier * upgrades.fieldAmp);
}

/** Шанс редкой сферы с учётом «Призмы удачи». */
export function rareChance(upgrades: UpgradeLevels): number {
  return GAME.crystal.rareChance + UPGRADES.lucky.perTier * upgrades.lucky;
}

/** Цвета корпуса и ядра с учётом собственных цветов скина. */
export function shipColors(skin: Skin, theme: Theme): { hull: string; core: string } {
  return { hull: skin.hull ?? theme.colors.player, core: skin.core ?? theme.colors.playerCore };
}
