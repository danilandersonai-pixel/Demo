// Константы и справочники: здания, исследования, параметры баланса.
// Все числа здесь — единственный источник правды для экономики.

import type { BuildingDef, BuildingId, Cost, ResearchDef, ResearchId } from './types.ts';

export const SAVE_VERSION = 1;

// --- Сектор ---
export const GRID_COLS = 6;
export const GRID_ROWS = 6;
export const GRID_CELLS = GRID_COLS * GRID_ROWS;
export const START_ROWS = 3;
export const MAX_LEVEL = 5;
/** Стоимость открытия рядов 4, 5, 6. */
export const ROW_UNLOCK_COSTS: Cost[] = [
  { credits: 1400, data: 0 },
  { credits: 5500, data: 350 },
  { credits: 18000, data: 1400 },
];

// --- Время ---
export const EVENT_INTERVAL = 30;
export const DECISION_WINDOW = 10;
export const BANKRUPTCY_DAYS = 5;
export const HISTORY_LENGTH = 60;
export const LOG_LIMIT = 160;
export const EVENT_HISTORY_LIMIT = 12;
export const TOAST_LIMIT = 4;

// --- Стартовые условия ---
export const START_CREDITS = 250;
export const START_DATA = 0;
export const START_ENERGY = 100;

// --- Хранилища ---
export const BASE_ENERGY_CAP = 150;
export const BASE_DATA_CAP = 200;

// --- Энергосеть ---
/** Перезапуск сети после блэкаута при заполнении хранилища на эту долю. */
export const BLACKOUT_RESTART = 0.25;
export const BLACKOUT_RESTART_GRAPHENE = 0.15;
/** Излишек энергии при полном хранилище продаётся в городскую сеть по этой цене. */
export const ENERGY_EXPORT_PRICE = 0.12;

// --- Расходы ---
/** Базовые накладные расходы синдиката (аренда сектора, охрана), ₵/день. */
export const BASE_OVERHEAD = 2;
/** Каждый докупленный ряд сектора добавляет накладных, ₵/день. */
export const OVERHEAD_PER_ROW = 1.5;
/** Линейная инфляция содержания: множитель = 1 + день × ставка. */
export const INFLATION_RATE = 0.006;
/** Здание в режиме ожидания платит эту долю содержания. */
export const STANDBY_UPKEEP = 0.5;
export const DEMOLISH_REFUND = 0.5;

// --- Рынок данных ---
export const MARKET_BASE_PRICE = 3;
export const MARKET_MIN_PRICE = 1.2;
export const MARKET_MAX_PRICE = 8;
/** Наценка при покупке данных у рынка. */
export const BUY_SPREAD = 1.6;
export const AUTOBROKER_TRIGGER = 0.9;
export const AUTOBROKER_TARGET = 0.5;
/** Комиссия Авто-Брокера. */
export const AUTOBROKER_FEE = 0.15;

// --- Множители уровней ---
export function outputMult(level: number): number {
  return 1 + 0.8 * (level - 1);
}
export function useLevelMult(level: number): number {
  return 1 + 0.5 * (level - 1);
}
export function upkeepLevelMult(level: number): number {
  return 1 + 0.6 * (level - 1);
}
export function auraLevelMult(level: number): number {
  return 1 + 0.5 * (level - 1);
}
/** Инфляция содержания к заданному дню. */
export function inflationAt(day: number): number {
  return 1 + Math.max(0, day) * INFLATION_RATE;
}
/** Тяжесть событий растёт со временем. */
export function severityAt(day: number): number {
  return 1 + Math.max(0, day) / 250;
}
/** Уровень угрозы 0..1 — влияет на частоту негативных событий. */
export function threatAt(day: number): number {
  return Math.min(1, Math.max(0, day) / 900);
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  solar: {
    id: 'solar',
    name: 'Солнечная панель',
    builtVerb: 'Построена',
    tag: 'SOL-7',
    description: 'Перовскитный массив на крыше мегаблока. Даёт энергию и немного расширяет хранилище.',
    accent: 'energy',
    baseCost: { credits: 50, data: 0 },
    costGrowth: 1.12,
    energyProd: 7,
    energyUse: 0,
    creditProd: 0,
    dataProd: 0,
    dataCap: 0,
    energyCap: 20,
    upkeep: 0.25,
    aura: 0,
    requires: null,
  },
  miner: {
    id: 'miner',
    name: 'Майнинг-ферма',
    builtVerb: 'Построена',
    tag: 'MNR-4',
    description: 'Стойки ASIC на подпольном крипто-протоколе. Главный источник кредитов.',
    accent: 'credit',
    baseCost: { credits: 80, data: 0 },
    costGrowth: 1.14,
    energyProd: 0,
    energyUse: 4,
    creditProd: 5,
    dataProd: 0,
    dataCap: 0,
    energyCap: 0,
    upkeep: 0.8,
    aura: 0,
    requires: null,
  },
  server: {
    id: 'server',
    name: 'Серверная стойка',
    builtVerb: 'Построена',
    tag: 'SRV-2',
    description: 'Перехватывает и индексирует трафик мегаполиса. Даёт данные и место для их хранения.',
    accent: 'data',
    baseCost: { credits: 120, data: 0 },
    costGrowth: 1.15,
    energyProd: 0,
    energyUse: 3.5,
    creditProd: 0,
    dataProd: 1.5,
    dataCap: 100,
    energyCap: 0,
    upkeep: 1,
    aura: 0,
    requires: null,
  },
  optimizer: {
    id: 'optimizer',
    name: 'ИИ-Оптимизатор',
    builtVerb: 'Построен',
    tag: 'AI-OPT',
    description: 'Нейросеть балансирует нагрузку соседей: +15% к выработке всех 8 соседних ячеек.',
    accent: 'research',
    baseCost: { credits: 600, data: 60 },
    costGrowth: 1.6,
    energyProd: 0,
    energyUse: 6,
    creditProd: 0,
    dataProd: 0,
    dataCap: 0,
    energyCap: 0,
    upkeep: 3,
    aura: 0.15,
    requires: null,
  },
  reactor: {
    id: 'reactor',
    name: 'Термоядерный реактор',
    builtVerb: 'Построен',
    tag: 'FUS-X',
    description: 'Компактный токамак холодного синтеза. Огромная выработка и большое хранилище энергии.',
    accent: 'energy',
    baseCost: { credits: 4000, data: 300 },
    costGrowth: 1.35,
    energyProd: 65,
    energyUse: 0,
    creditProd: 0,
    dataProd: 0,
    dataCap: 0,
    energyCap: 250,
    upkeep: 12,
    aura: 0,
    requires: 'coldFusion',
  },
  qcore: {
    id: 'qcore',
    name: 'Квантовое ядро',
    builtVerb: 'Построено',
    tag: 'Q-CORE',
    description: 'Кубитный кластер: одновременно добывает кредиты и генерирует данные. Очень прожорлив.',
    accent: 'credit',
    baseCost: { credits: 14000, data: 1200 },
    costGrowth: 1.45,
    energyProd: 0,
    energyUse: 40,
    creditProd: 80,
    dataProd: 10,
    dataCap: 300,
    energyCap: 0,
    upkeep: 25,
    aura: 0,
    requires: 'singularity',
  },
};

export const BUILDING_ORDER: BuildingId[] = ['solar', 'miner', 'server', 'optimizer', 'reactor', 'qcore'];

export const RESEARCH: Record<ResearchId, ResearchDef> = {
  quantumAlgo: {
    id: 'quantumAlgo',
    name: 'Квантовые алгоритмы',
    tag: 'QA-01',
    description: 'Алгоритм Шора-Гровера для подбора хешей.',
    effect: '+25% к добыче кредитов',
    cost: { credits: 350, data: 110 },
    duration: 12,
    requires: [],
    col: 0,
    row: 0,
  },
  dataCompression: {
    id: 'dataCompression',
    name: 'Фрактальное сжатие',
    tag: 'DC-02',
    description: 'Самоподобная упаковка массивов.',
    effect: '+60% к хранилищу данных, +10% к генерации данных',
    cost: { credits: 200, data: 60 },
    duration: 8,
    requires: [],
    col: 1,
    row: 0,
  },
  nitrogenCooling: {
    id: 'nitrogenCooling',
    name: 'Охлаждение жидким азотом',
    tag: 'LN-03',
    description: 'Криоконтуры вокруг каждой стойки.',
    effect: '−20% к потреблению энергии всеми зданиями',
    cost: { credits: 300, data: 90 },
    duration: 12,
    requires: [],
    col: 2,
    row: 0,
  },
  neuroFirewall: {
    id: 'neuroFirewall',
    name: 'Нейро-файрвол',
    tag: 'NF-04',
    description: 'Самообучающийся периметр сети.',
    effect: 'Урон от хакеров −50%, защита вдвое дешевле, шанс контратаки 75%',
    cost: { credits: 900, data: 240 },
    duration: 16,
    requires: ['quantumAlgo'],
    col: 0,
    row: 1,
  },
  autoBroker: {
    id: 'autoBroker',
    name: 'Авто-Брокер',
    tag: 'AB-05',
    description: 'Торговый бот на тёмной бирже.',
    effect: 'Продаёт избыток данных при заполнении хранилища на 90%',
    cost: { credits: 800, data: 200 },
    duration: 15,
    requires: ['dataCompression'],
    col: 1,
    row: 1,
  },
  grapheneCells: {
    id: 'grapheneCells',
    name: 'Графеновые аккумуляторы',
    tag: 'GC-06',
    description: 'Суперконденсаторы на графене.',
    effect: '×2.5 к хранилищу энергии, сеть перезапускается с 15%',
    cost: { credits: 700, data: 180 },
    duration: 14,
    requires: ['nitrogenCooling'],
    col: 2,
    row: 1,
  },
  shadowLedger: {
    id: 'shadowLedger',
    name: 'Теневая бухгалтерия',
    tag: 'SL-07',
    description: 'Офшорные прокладки в семи юрисдикциях.',
    effect: '−15% к содержанию и накладным, налоговые проверки вдвое мягче',
    cost: { credits: 2000, data: 400 },
    duration: 20,
    requires: ['neuroFirewall'],
    col: 0,
    row: 2,
  },
  swarmMind: {
    id: 'swarmMind',
    name: 'Роевой интеллект',
    tag: 'SW-08',
    description: 'Оптимизаторы объединяются в рой.',
    effect: 'Бонус ИИ-Оптимизаторов соседям: 15% → 25%',
    cost: { credits: 2400, data: 480 },
    duration: 22,
    requires: ['autoBroker'],
    col: 1,
    row: 2,
  },
  coldFusion: {
    id: 'coldFusion',
    name: 'Холодный синтез',
    tag: 'CF-09',
    description: 'Стабильная плазма при комнатной температуре.',
    effect: 'Открывает постройку «Термоядерный реактор»',
    cost: { credits: 3000, data: 450 },
    duration: 24,
    requires: ['grapheneCells'],
    col: 2,
    row: 2,
  },
  syndicateProtocol: {
    id: 'syndicateProtocol',
    name: 'Протокол «Синдикат»',
    tag: 'SP-10',
    description: 'Единая шина управления всеми активами.',
    effect: '+15% ко всей выработке, +10% к цене продажи данных',
    cost: { credits: 8000, data: 1200 },
    duration: 30,
    requires: ['shadowLedger'],
    col: 0,
    row: 3,
  },
  singularity: {
    id: 'singularity',
    name: 'Квантовая сингулярность',
    tag: 'QS-11',
    description: 'Кубиты, которые проектируют кубиты.',
    effect: 'Открывает постройку «Квантовое ядро»',
    cost: { credits: 10000, data: 1500 },
    duration: 32,
    requires: ['swarmMind', 'coldFusion'],
    col: 1,
    row: 3,
  },
  orbitalMirrors: {
    id: 'orbitalMirrors',
    name: 'Орбитальные зеркала',
    tag: 'OM-12',
    description: 'Спутники фокусируют солнце на панелях.',
    effect: '+35% к выработке солнечных панелей, бури вдвое слабее',
    cost: { credits: 6000, data: 900 },
    duration: 28,
    requires: ['coldFusion'],
    col: 2,
    row: 3,
  },
};

export const RESEARCH_ORDER: ResearchId[] = [
  'quantumAlgo',
  'dataCompression',
  'nitrogenCooling',
  'neuroFirewall',
  'autoBroker',
  'grapheneCells',
  'shadowLedger',
  'swarmMind',
  'coldFusion',
  'syndicateProtocol',
  'singularity',
  'orbitalMirrors',
];

export const COLUMN_LABELS = 'ABCDEF';

export function cellLabel(index: number): string {
  const row = Math.floor(index / GRID_COLS);
  const col = index % GRID_COLS;
  return `${COLUMN_LABELS[col]}${row + 1}`;
}

/** Соседи по Муру (8 направлений) — на них действует аура ИИ-Оптимизатора. */
export function neighborsOf(index: number): number[] {
  const row = Math.floor(index / GRID_COLS);
  const col = index % GRID_COLS;
  const result: number[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) result.push(r * GRID_COLS + c);
    }
  }
  return result;
}
