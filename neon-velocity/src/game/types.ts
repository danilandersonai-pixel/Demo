/**
 * Общие типы игры — контракт между движком (engine), рендером (renderer),
 * звуком (audio), вводом (input) и React-интерфейсом.
 *
 * Все координаты игровых объектов — в «мировых единицах» (см. viewport.ts):
 * ширина игрового поля всегда WORLD_W, высота — viewport.worldH.
 * Ось Y направлена вниз: препятствия появляются сверху (y < 0) и падают вниз.
 */

// ─── Идентификаторы пресетов ────────────────────────────────────────────────

export type ThemeId = 'cyberpunk' | 'gold' | 'acid' | 'arctic';
export type SkinId = 'core' | 'trail' | 'magnet' | 'ghost' | 'singularity';
export type UpgradeId = 'resonator' | 'fieldAmp' | 'lucky';
export type ObstacleKind = 'cube' | 'laser' | 'saw';
/** Силуэт корпуса корабля — рендер и превью в магазине рисуют его по-разному. */
export type ShipShape = 'arrow' | 'delta' | 'wing' | 'orb' | 'star';

// ─── Темы, скины, улучшения ─────────────────────────────────────────────────

export interface ThemeColors {
  /** Фон холста (самый тёмный слой). */
  bg: string;
  /** Градиент неба над горизонтом: сверху → к горизонту. */
  skyTop: string;
  skyBottom: string;
  /** Градиент ретро-солнца: верх → низ. */
  sunTop: string;
  sunBottom: string;
  /** Цвета сетки по уровням скорости: уровень N берёт grid[(N - 1) % grid.length]. */
  grid: string[];
  /** Корпус корабля и его светящееся ядро (если у скина нет своих цветов). */
  player: string;
  playerCore: string;
  /** Частицы неонового шлейфа. */
  trail: string;
  /** Препятствия. */
  cube: string;
  laser: string;
  saw: string;
  /** Энергетические сферы: обычная и редкая. */
  crystal: string;
  crystalRare: string;
  /** Акценты интерфейса: основной, второй, подсветка (жёлтый-аналог). */
  accent: string;
  accent2: string;
  accent3: string;
}

export interface Theme {
  id: ThemeId;
  /** Название латиницей, как в аркадах: «Neon Cyberpunk». */
  name: string;
  /** Короткое описание по-русски для магазина. */
  tagline: string;
  /** Цена в кристаллах (0 — бесплатно и открыто с начала). */
  price: number;
  colors: ThemeColors;
}

export interface SkinPerks {
  /** Оставляет хвост из светящихся частиц. */
  trail: boolean;
  /** Сколько столкновений прощается за один забег (щит-призрак). */
  shieldCharges: number;
  /** Притягивает кристаллы в радиусе GAME.magnet.radius. */
  magnet: boolean;
  /** Бонус к очкам: 0.1 = +10 %. */
  scoreBonus: number;
}

export interface Skin {
  id: SkinId;
  /** Название латиницей: «Ghost Shield». */
  name: string;
  /** Название по-русски: «Щит-призрак». */
  title: string;
  /** Описание перка по-русски для магазина. */
  description: string;
  price: number;
  shape: ShipShape;
  perks: SkinPerks;
  /** Собственные цвета корпуса и ядра; если не заданы — берутся из темы. */
  hull?: string;
  core?: string;
}

export interface Upgrade {
  id: UpgradeId;
  /** Название по-русски. */
  title: string;
  /** Описание эффекта одного уровня по-русски. */
  description: string;
  maxTier: number;
  /** Цена покупки уровня: prices[i] — цена перехода с уровня i на i + 1. */
  prices: number[];
  /** Сила эффекта за один уровень (доля: 0.2 = +20 %). */
  perTier: number;
}

export type UpgradeLevels = Record<UpgradeId, number>;

/** Всё, что движку нужно знать о снаряжении игрока на старте забега. */
export interface Loadout {
  skin: Skin;
  theme: Theme;
  upgrades: UpgradeLevels;
  /** Лучший результат ДО этого забега — для вспышки «NEW RECORD!». */
  highscore: number;
}

// ─── Экран и мир ────────────────────────────────────────────────────────────

export interface Viewport {
  /** Размер холста в CSS-пикселях. */
  cssW: number;
  cssH: number;
  /** Плотность пикселей (ограничена 2 ради производительности). */
  dpr: number;
  /** Левый край игрового поля в CSS-пикселях. */
  fieldX: number;
  /** Ширина игрового поля в CSS-пикселях. */
  fieldW: number;
  /** CSS-пикселей на одну мировую единицу. */
  scale: number;
  /** Ширина мира — всегда WORLD_W. */
  worldW: number;
  /** Высота мира = cssH / scale. */
  worldH: number;
}

// ─── Ввод ───────────────────────────────────────────────────────────────────

export interface InputState {
  /** -1..1: ← / A = -1, → / D = +1, обе или ни одной = 0. */
  axis: number;
  /** X указателя (мышь/палец) в мировых единицах; null — указателя нет. */
  pointerX: number | null;
  /** Каким способом игрок управлял последним. */
  lastSource: 'keyboard' | 'pointer' | 'none';
}

// ─── Игровые сущности ───────────────────────────────────────────────────────

export interface Zigzag {
  /** Амплитуда, мировые единицы. */
  amp: number;
  /** Частота, колебаний в секунду. */
  freq: number;
  /** Начальная фаза, рад. */
  phase: number;
}

export interface Player {
  /** Центр корабля. */
  x: number;
  y: number;
  /** Горизонтальная скорость, ед/с. */
  vx: number;
  /** Радиус хитбокса (меньше нарисованного корабля — так честнее). */
  radius: number;
  /** Крен -1..1 для отрисовки, плавно следует за vx. */
  tilt: number;
  /** Секунды неуязвимости после срабатывания щита (>0 — корабль мерцает). */
  invuln: number;
  shieldCharges: number;
  maxShieldCharges: number;
  alive: boolean;
  /** 0..1 — вспышка корпуса при потере щита, затухает. */
  hitFlash: number;
}

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  /**
   * cube / saw — центр фигуры.
   * laser — центр ПРОХОДА в лазерной стене (сам луч тянется на всю ширину поля).
   */
  x: number;
  y: number;
  /** X без зигзага (для laser — базовый центр прохода). */
  baseX: number;
  /** Собственная скорость падения, ед/с (итоговая = vy * speedMult * heightFactor). */
  vy: number;
  /**
   * cube — половина стороны квадрата;
   * saw — радиус (с зубьями);
   * laser — половина толщины луча.
   */
  size: number;
  /** laser: ширина прохода. Для cube / saw — 0. */
  gapW: number;
  /** Угол поворота, рад (cube / saw). */
  rotation: number;
  /** Скорость вращения, рад/с. */
  spin: number;
  zigzag: Zigzag | null;
  /** Секунды с момента появления. */
  age: number;
  /** Уже пересекло линию игрока — уклонение засчитано. */
  passed: boolean;
}

export interface Crystal {
  id: number;
  x: number;
  y: number;
  baseX: number;
  vy: number;
  radius: number;
  /** Редкая сфера: больше очков и валюты. */
  rare: boolean;
  /** Фаза пульсации, рад. */
  phase: number;
  age: number;
  zigzag: Zigzag | null;
  /** Сейчас притягивается магнитом (рендер рисует линию поля). */
  magnetized: boolean;
}

export type ParticleShape = 'pixel' | 'spark' | 'ring' | 'glow';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Оставшееся время жизни, сек. */
  life: number;
  maxLife: number;
  /** pixel — сторона квадрата; spark — длина штриха; ring / glow — радиус. */
  size: number;
  color: string;
  /** Затухание скорости, 1/с: v *= exp(-drag * dt). */
  drag: number;
  /** Ускорение по Y, ед/с². */
  gravity: number;
  shape: ParticleShape;
  rotation: number;
  spin: number;
  /** Изменение size в секунду (ring — расширение волны). */
  grow: number;
}

/** Всплывающий текст в мире: «+150», «NEAR MISS», «x4 COMBO». */
export interface Floater {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  /** Размер шрифта в мировых единицах. */
  size: number;
}

// ─── Состояние движка ───────────────────────────────────────────────────────

/**
 * attract — фоновая «демо-сцена» для меню (без столкновений и очков);
 * playing — идёт забег;
 * dying — взрыв и слоу-мо после смертельного столкновения;
 * over — забег окончен, фон продолжает жить под экраном Game Over.
 */
export type EngineMode = 'attract' | 'playing' | 'dying' | 'over';

/** Полное состояние, которое движок обновляет, а рендер только читает. */
export interface GameState {
  mode: EngineMode;
  viewport: Viewport;
  theme: Theme;
  skin: Skin;
  /** Время симуляции, сек (растёт во всех режимах, кроме паузы). */
  time: number;
  /** Секунды с начала текущего забега. */
  runTime: number;
  /** Замедление времени: 1 — норма, в режиме dying ≈ GAME.death.slowMo. */
  timeScale: number;
  /** Уровень скорости, начиная с 1; растёт каждые GAME.levelDuration сек. */
  level: number;
  speedMult: number;
  /** 0..1 — прогресс до следующего уровня. */
  levelProgress: number;
  /** 1 → 0 после повышения уровня (вспышка сетки). */
  levelUpPulse: number;
  /** Накопленная дистанция прокрутки фона, мировые единицы. */
  scroll: number;
  bpm: number;
  /** Номер текущей доли с начала забега (или attract-сцены). */
  beatIndex: number;
  /** 0..1 — фаза внутри текущей доли (0 — удар). */
  beatPhase: number;
  /** «Травма» тряски 0..1; смещение камеры = shake² * GAME.shake.maxOffset. */
  shake: number;
  /** 0..1 — полноэкранная вспышка цвета flashColor. */
  flash: number;
  flashColor: string;
  player: Player;
  obstacles: Obstacle[];
  crystals: Crystal[];
  /** Только живые частицы (движок сам переиспользует объекты). */
  particles: Particle[];
  floaters: Floater[];
  /** Радиус магнита в мировых единицах; 0 — магнита нет. */
  magnetRadius: number;
  score: number;
  multiplier: number;
  /** Сколько кристаллов подряд собрано без пропуска и столкновения. */
  chain: number;
  /** Валюта за текущий забег (с учётом резонатора, может быть дробной). */
  runCrystals: number;
  /** Рекорд ДО забега. */
  highscore: number;
  /** Текущий счёт уже обогнал прошлый рекорд (и тот был > 0). */
  newRecord: boolean;
}

// ─── События движка ─────────────────────────────────────────────────────────

export type GameEvent =
  /** Сильная доля ритма. lateBy — на сколько сек событие запоздало относительно идеальной сетки. */
  | { type: 'beat'; index: number; bpm: number; level: number; lateBy: number }
  | { type: 'runStart' }
  /** Закончилась стартовая пауза GAME.startGrace — пошли препятствия. */
  | { type: 'go' }
  | { type: 'collect'; rare: boolean; chain: number; multiplier: number; x: number; y: number }
  | { type: 'comboUp'; multiplier: number }
  | { type: 'comboBreak'; reason: 'hit' | 'miss'; lostMultiplier: number }
  | { type: 'nearMiss'; x: number; y: number }
  | { type: 'shieldBreak'; x: number; y: number; chargesLeft: number }
  | { type: 'levelUp'; level: number; speedMult: number }
  | { type: 'newRecord'; score: number }
  | { type: 'death'; x: number; y: number }
  | { type: 'gameOver'; result: RunResult };

export interface RunResult {
  /** Итоговый счёт (целое). */
  score: number;
  /** Достигнутый уровень скорости. */
  level: number;
  /** Множитель скорости на момент окончания. */
  speedMult: number;
  /** Заработанная валюта (целое, уже с бонусом резонатора). */
  crystals: number;
  /** Сколько сфер собрано. */
  crystalsCollected: number;
  /** Лучший множитель комбо за забег. */
  maxMultiplier: number;
  /** Самая длинная цепочка сфер подряд. */
  maxChain: number;
  nearMisses: number;
  /** Длительность забега, сек. */
  duration: number;
  /** Счёт обогнал прошлый рекорд. */
  newRecord: boolean;
  skinId: SkinId;
}

// ─── HUD ────────────────────────────────────────────────────────────────────

export interface HudSnapshot {
  score: number;
  /** max(рекорд до забега, текущий счёт). */
  highscore: number;
  multiplier: number;
  chain: number;
  /** 0..1 — сколько осталось до следующего множителя. */
  chainProgress: number;
  level: number;
  speedMult: number;
  levelProgress: number;
  /** Кристаллы за забег (целое). */
  crystals: number;
  shieldCharges: number;
  maxShieldCharges: number;
  newRecord: boolean;
  /** Секунды с начала забега. */
  elapsed: number;
  fps: number;
}

export type BannerKind = 'ready' | 'go' | 'levelUp' | 'newRecord' | 'shield' | 'comboBreak' | 'comboUp';

export interface Banner {
  id: number;
  kind: BannerKind;
  /** Крупный текст: «LEVEL 3», «NEW RECORD!». */
  text: string;
  /** Подпись мельче: «SPEED ×1.28». */
  sub?: string;
  /** Время появления (performance.now()). */
  createdAt: number;
  /** Сколько мс показывать. */
  duration: number;
}

// ─── Прогресс и сохранение ──────────────────────────────────────────────────

export interface LeaderboardEntry {
  id: string;
  score: number;
  level: number;
  speedMult: number;
  /** Дата и время забега в ISO-формате. */
  date: string;
  maxMultiplier: number;
  crystals: number;
  duration: number;
  skinId: SkinId;
}

export interface Settings {
  /** Звук включён. */
  sound: boolean;
  /** Громкость музыки 0..1. */
  music: number;
  /** Громкость эффектов 0..1. */
  sfx: number;
  /** Тряска экрана. */
  screenShake: boolean;
  /** Счётчик FPS в HUD. */
  showFps: boolean;
}

export interface Stats {
  gamesPlayed: number;
  totalCrystals: number;
  totalScore: number;
  bestMultiplier: number;
  /** Суммарное время в забегах, сек. */
  totalTime: number;
}

export interface SaveData {
  version: 1;
  /** Кошелёк кристаллов. */
  crystals: number;
  highscore: number;
  /** Топ-5 забегов, по убыванию очков. */
  leaderboard: LeaderboardEntry[];
  ownedSkins: SkinId[];
  equippedSkin: SkinId;
  ownedThemes: ThemeId[];
  equippedTheme: ThemeId;
  upgrades: UpgradeLevels;
  settings: Settings;
  stats: Stats;
  /** Игрок уже видел подсказку по управлению. */
  seenTutorial: boolean;
}

/** Что показывает React поверх холста. */
export type Screen = 'menu' | 'playing' | 'paused' | 'gameover';
export type MenuPanel = 'shop' | 'leaderboard' | 'settings' | 'howto';
