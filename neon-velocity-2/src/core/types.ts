/**
 * Общие типы — контракт между симуляцией (core), рендером, звуком, вводом и
 * интерфейсом.
 *
 * Мир — плоскость дороги: x поперёк (0…WORLD.roadW), z вдоль, вперёд от линии
 * корабля (z = 0 — линия удара, z = WORLD.zFar — где объекты появляются).
 * Единицы по x и z одинаковые. Высоты у симуляции нет: это дело рендера.
 *
 * Время — целые тики (см. timing.ts). Положение объекта не накапливается, а
 * вычисляется из тика: объект с arriveTick и approachTicks находится на глубине
 * z = zFar · (arriveTick − t) / approachTicks (см. motion.ts).
 */

// ─── Идентификаторы пресетов ────────────────────────────────────────────────

export type ThemeId = 'cyberpunk' | 'gold' | 'acid' | 'arctic';
export type SkinId = 'core' | 'trail' | 'magnet' | 'ghost' | 'singularity';
export type UpgradeId = 'resonator' | 'fieldAmp' | 'lucky';
export type ObstacleKind = 'cube' | 'saw' | 'laser';
/** Силуэт корпуса корабля. */
export type ShipShape = 'arrow' | 'delta' | 'wing' | 'orb' | 'star';
/** Декорации у горизонта — у каждой темы свои. */
export type Scenery = 'city' | 'palms' | 'toxic' | 'aurora';

// ─── Темы, скины, улучшения ─────────────────────────────────────────────────

export interface ThemeColors {
  /** Самый тёмный слой холста. */
  bg: string;
  /** Небо: зенит → горизонт. */
  skyTop: string;
  skyBottom: string;
  /** Ретро-солнце: верх → низ. */
  sunTop: string;
  sunBottom: string;
  /** Дымка у горизонта (в неё уходит дорога и из неё выходят объекты). */
  haze: string;
  /** Полотно дороги (почти чёрное, с оттенком темы). */
  road: string;
  /** Цвета сетки по уровням скорости: уровень N берёт grid[(N − 1) % grid.length]. */
  grid: string[];
  /** Светящиеся бортики дороги и линия удара. */
  rail: string;
  /** Декорации горизонта: ближний и дальний планы. */
  sceneryNear: string;
  sceneryFar: string;
  /** Корпус корабля и ядро (если у скина нет своих цветов). */
  ship: string;
  shipCore: string;
  /** Шлейф и выхлоп. */
  trail: string;
  cube: string;
  saw: string;
  laser: string;
  crystal: string;
  crystalRare: string;
  /** Акценты интерфейса. */
  accent: string;
  accent2: string;
  accent3: string;
}

export interface Theme {
  id: ThemeId;
  /** Латиницей: «Neon Cyberpunk». */
  name: string;
  /** Короткое описание по-русски. */
  tagline: string;
  price: number;
  scenery: Scenery;
  colors: ThemeColors;
}

export interface SkinPerks {
  /** Хвост из светящихся частиц (косметика рендера). */
  trail: boolean;
  /** Сколько столкновений прощается за забег. */
  shieldCharges: number;
  /** Притягивает сферы. */
  magnet: boolean;
  /** Бонус к очкам: 0.1 = +10 %. */
  scoreBonus: number;
}

export interface Skin {
  id: SkinId;
  /** Латиницей: «Ghost Shield». */
  name: string;
  /** По-русски: «Щит-призрак». */
  title: string;
  description: string;
  price: number;
  shape: ShipShape;
  perks: SkinPerks;
  /** Собственные цвета корпуса и ядра; иначе — из темы. */
  hull?: string;
  core?: string;
}

export interface Upgrade {
  id: UpgradeId;
  title: string;
  description: string;
  maxTier: number;
  /** prices[i] — цена перехода с уровня i на i + 1. */
  prices: number[];
  /** Эффект одного уровня (доля). */
  perTier: number;
}

export type UpgradeLevels = Record<UpgradeId, number>;

/** Снаряжение игрока, как его видит интерфейс. */
export interface Loadout {
  skin: Skin;
  theme: Theme;
  upgrades: UpgradeLevels;
  /** Рекорд ДО забега. */
  highscore: number;
}

/** То же снаряжение, сведённое к числам, которые нужны симуляции (см. toSimLoadout). */
export interface SimLoadout {
  shieldCharges: number;
  /** Поперечный радиус магнита; 0 — магнита нет. */
  magnetRadius: number;
  scoreBonus: number;
  /** Множитель заработка валюты. */
  crystalYield: number;
  /** Шанс редкой сферы (нужен генератору трека). */
  rareChance: number;
  highscore: number;
}

// ─── Ввод ───────────────────────────────────────────────────────────────────

/** Ввод на один тик симуляции. */
export interface InputFrame {
  /** −1…1 с клавиатуры. */
  axis: number;
  /** X указателя в единицах дороги; null — указателя нет. */
  pointerX: number | null;
  /** Чем игрок управлял последним. */
  source: 'keyboard' | 'pointer' | 'none';
}

// ─── Трек: что и когда прилетает ────────────────────────────────────────────

/** Поперечное «виляние» вокруг точки прилёта. */
export interface Sway {
  /** Амплитуда, единицы дороги. */
  amp: number;
  /** Период, тики. */
  periodTicks: number;
  /** Фаза в момент прилёта, рад. */
  phase: number;
}

export interface ObstacleSpec {
  kind: ObstacleKind;
  /** Тик, в который объект пересекает линию корабля. Всегда на сетке шестнадцатых. */
  arriveTick: number;
  /**
   * X в момент прилёта: cube / saw — центр; laser — центр ПРОХОДА
   * (сам луч перекрывает всю дорогу).
   */
  x: number;
  sway: Sway | null;
  /** cube — половина стороны; saw — радиус; laser — половина ширины прохода. */
  halfW: number;
  /** cube: угол в момент прилёта (рад) и скорость вращения (рад/тик). */
  yaw0?: number;
  yawRate?: number;
}

export interface CrystalSpec {
  kind: 'crystal';
  arriveTick: number;
  x: number;
  sway: Sway | null;
  rare: boolean;
}

export type ChartItem = ObstacleSpec | CrystalSpec;

/**
 * Источник трека. Симуляция запрашивает такты строго по порядку (0, 1, 2 …),
 * каждый один раз и заранее — до того, как его объекты должны появиться.
 * Такт b покрывает тики [b·240, (b+1)·240). Генератор обязан быть
 * детерминированным: одно зерно → один и тот же трек.
 */
export interface ChartSource {
  bar(index: number): ChartItem[];
}

export interface ChartOptions {
  /** Шанс редкой сферы. */
  rareChance: number;
  /** Режим фоновой сцены меню: редкие декоративные объекты, без роста сложности. */
  attract?: boolean;
}

// ─── Сущности симуляции ─────────────────────────────────────────────────────

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  /** Тик появления на дальней границе = arriveTick − approachTicks. */
  spawnTick: number;
  arriveTick: number;
  /** За сколько тиков объект проходит от zFar до линии корабля. */
  approachTicks: number;
  /** X в момент прилёта (см. ObstacleSpec.x). */
  x: number;
  sway: Sway | null;
  halfW: number;
  /** Половина хитбокса по глубине (см. OBSTACLES[kind]). */
  halfD: number;
  yaw0: number;
  yawRate: number;
  /** Минимальный зазор с кораблём за время пролёта (для near miss); Infinity, пока не сближались. */
  minClear: number;
  /** Объект миновал корабль — уклонение уже засчитано. */
  resolved: boolean;
  /** Разбит о щит: больше не сталкивается, рендер показывает осколки. */
  destroyed: boolean;
}

export type CrystalState = 'live' | 'taken' | 'missed';

export interface Crystal {
  id: number;
  spawnTick: number;
  arriveTick: number;
  approachTicks: number;
  /** X в момент прилёта без учёта магнита. */
  x: number;
  sway: Sway | null;
  rare: boolean;
  /** Смещение магнитом на текущем и на прошлом тике (для интерполяции). */
  pull: number;
  prevPull: number;
  state: CrystalState;
  /** Порядковый номер сферы в забеге — звук берёт по нему ноту мелодии. */
  note: number;
}

export interface Player {
  x: number;
  /** X на прошлом тике (для интерполяции). */
  prevX: number;
  /** Скорость, ед/с. */
  vx: number;
  /** Крен −1…1, плавно следует за vx. */
  bank: number;
  alive: boolean;
  shield: number;
  shieldMax: number;
  /** Тики неуязвимости после срабатывания щита. */
  invulnTicks: number;
}

/**
 * attract — фоновая сцена меню (без столкновений и очков);
 * ready — вступление READY (tick < 0);
 * playing — забег;
 * dying — взрыв в замедлении;
 * over — забег окончен, дорога ещё живёт под экраном Game Over.
 */
export type SimMode = 'attract' | 'ready' | 'playing' | 'dying' | 'over';

/** Полное состояние симуляции. Меняет его только Simulation; остальные читают. */
export interface SimState {
  mode: SimMode;
  /** Зерно забега (одно зерно + один и тот же ввод = один и тот же забег). */
  seed: number;
  /** Текущий тик: в забеге от −LEAD_IN_TICKS, GO на 0; в attract — от 0. */
  tick: number;
  /** Сколько реального времени стоит один тик: 1, а в dying — GAME.death.timeScale. */
  timeScale: number;
  level: number;
  speedMult: number;
  levelProgress: number;
  player: Player;
  obstacles: Obstacle[];
  crystals: Crystal[];
  score: number;
  /** Сфер подряд без пропуска и столкновения. */
  chain: number;
  multiplier: number;
  /** Множитель на максимуме — идёт OVERDRIVE (очки ×2). */
  overdrive: boolean;
  /** Валюта за забег (может быть дробной из-за резонатора). */
  runCrystals: number;
  crystalsCollected: number;
  dodged: number;
  nearMisses: number;
  maxMultiplier: number;
  maxChain: number;
  /** Поперечный радиус магнита; 0 — нет. */
  magnetRadius: number;
  /** Рекорд ДО забега. */
  highscore: number;
  /** Счёт уже обогнал прошлый рекорд (и тот был > 0). */
  newRecord: boolean;
}

// ─── События симуляции ──────────────────────────────────────────────────────

/** У каждого события есть tick — тик, на котором оно произошло. */
export type SimEvent =
  /** Доля ритма. beat — номер от GO (во вступлении −4…−1), beatInBar — 0..3. */
  | { type: 'beat'; tick: number; beat: number; bar: number; beatInBar: number; level: number }
  /** Начало вступления READY. */
  | { type: 'ready'; tick: number }
  /** GO: tick = 0. */
  | { type: 'go'; tick: number }
  | { type: 'collect'; tick: number; x: number; rare: boolean; chain: number; multiplier: number; note: number; points: number }
  /** Сфера пропущена. */
  | { type: 'miss'; tick: number; x: number }
  | { type: 'comboUp'; tick: number; multiplier: number }
  | { type: 'comboBreak'; tick: number; reason: 'hit' | 'miss'; lost: number }
  /** Начало и конец OVERDRIVE. */
  | { type: 'overdrive'; tick: number; on: boolean }
  /** Препятствие миновало корабль. near — «почти задел». */
  | { type: 'dodge'; tick: number; x: number; kind: ObstacleKind; near: boolean; points: number }
  | { type: 'shieldBreak'; tick: number; x: number; kind: ObstacleKind; left: number }
  | { type: 'levelUp'; tick: number; level: number; speedMult: number }
  | { type: 'newRecord'; tick: number; score: number }
  | { type: 'death'; tick: number; x: number; kind: ObstacleKind }
  | { type: 'gameOver'; tick: number; result: RunResult };

export interface RunResult {
  /** Итоговый счёт (целое). */
  score: number;
  level: number;
  speedMult: number;
  /** Заработанная валюта (целое, с бонусом резонатора). */
  crystals: number;
  crystalsCollected: number;
  maxMultiplier: number;
  maxChain: number;
  nearMisses: number;
  dodged: number;
  /** Длительность забега от GO, сек. */
  duration: number;
  newRecord: boolean;
  seed: number;
}

// ─── HUD ────────────────────────────────────────────────────────────────────

export interface HudSnapshot {
  score: number;
  /** max(рекорд до забега, текущий счёт). */
  highscore: number;
  multiplier: number;
  chain: number;
  /** 0..1 — прогресс до следующего множителя (1 на максимуме). */
  chainProgress: number;
  overdrive: boolean;
  level: number;
  speedMult: number;
  levelProgress: number;
  /** Кристаллы за забег (целое). */
  crystals: number;
  shield: number;
  shieldMax: number;
  newRecord: boolean;
  /** Секунды от GO. */
  elapsed: number;
  fps: number;
}

export type BannerKind = 'ready' | 'go' | 'levelUp' | 'newRecord' | 'shield' | 'comboBreak' | 'comboUp' | 'overdrive';

export interface Banner {
  id: number;
  kind: BannerKind;
  text: string;
  sub?: string;
  createdAt: number;
  duration: number;
}

// ─── Прогресс и сохранение ──────────────────────────────────────────────────

export interface LeaderboardEntry {
  id: string;
  score: number;
  level: number;
  speedMult: number;
  /** Дата и время забега, ISO. */
  date: string;
  maxMultiplier: number;
  crystals: number;
  duration: number;
  skinId: SkinId;
}

export interface Settings {
  sound: boolean;
  /** Громкость музыки 0..1. */
  music: number;
  /** Громкость эффектов 0..1. */
  sfx: number;
  screenShake: boolean;
  showFps: boolean;
}

export interface Stats {
  gamesPlayed: number;
  totalCrystals: number;
  totalScore: number;
  bestMultiplier: number;
  totalTime: number;
}

export interface SaveData {
  version: 1;
  crystals: number;
  highscore: number;
  /** Топ-5, по убыванию очков. */
  leaderboard: LeaderboardEntry[];
  ownedSkins: SkinId[];
  equippedSkin: SkinId;
  ownedThemes: ThemeId[];
  equippedTheme: ThemeId;
  upgrades: UpgradeLevels;
  settings: Settings;
  stats: Stats;
  seenTutorial: boolean;
}

export type Screen = 'menu' | 'playing' | 'paused' | 'gameover';
export type MenuPanel = 'shop' | 'leaderboard' | 'settings' | 'howto';
