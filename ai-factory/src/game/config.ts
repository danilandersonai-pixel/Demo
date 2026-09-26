// Весь баланс игры в одном месте. Числа подобраны симуляцией
// (см. src/game/balance.test.ts) — меняя их, прогоняйте `npm test`.

import type { BuildingType, LinkRes, ResKey, ResearchId, SellableRes } from './types';

export const GRID = 8;
/** Стартовая площадка 6×6 — ячейки с индексами 1…6 по обеим осям. */
export const START_MIN = 1;
export const START_MAX = 6;
export const COLS = 'ABCDEFGH';

export const BAL = {
  maxLevel: 10,
  /** +50% выпуска за уровень (Mk.V = ×3, Mk.X = ×5,5). */
  levelOut: 0.5,
  /** +30% энергопотребления за уровень (Mk.X = ×3,7) — апгрейд экономнее новой постройки. */
  levelEnergy: 0.3,
  /** Улучшение Mk.N → Mk.N+1 стоит базовая цена × 1,8 × 2^(N−1). */
  upgradeMult: 1.8,
  upgradeGrowth: 2,
  refund: 0.5,

  reactorGen: 24,
  minerOut: 3,
  coderIn: 3,
  coderOut: 2,
  gpuOut: 10,
  trainerData: 2,
  trainerCode: 3,
  trainerCompute: 5,
  trainerOut: 0.2,
  publisherIn: 0.4,
  agiIn: 0.5,
  agiCompute: 30,
  agiMult: 10,
  /** Каждое Хранилище Mk.I даёт +100% базовой вместимости склада. */
  storageBonus: 1,

  baseCaps: { data: 1000, code: 800, models: 60 } as Record<ResKey, number>,
  price: { data: 1, code: 5, model: 300 },

  /** Прямой конвейер от соседа-поставщика: +10% скорости, максимум 4 соседа. */
  adjBonus: 0.1,
  adjMax: 4,

  /** Техдолг растёт на 0,35 п. п. за тик полной загрузки (0→100 примерно за 5 минут). */
  debtRate: 0.35,
  /** При долге 100% КПД Блока падает до 40%. */
  debtLoss: 0.6,
  refactorPerPoint: 8,
  autoRefactorAt: 40,
  autoRefactorDiscount: 0.5,

  /** Автопродажа оставляет на складе 25% вместимости как буфер для цехов. */
  autoSellReserve: 0.25,
  startCredits: 2000,
  historyLen: 120,
  logLen: 60,
  offlineCap: 4 * 3600,
};

export type BuildingCategory = 'energy' | 'extraction' | 'production' | 'export' | 'infrastructure';

export interface BuildingDef {
  type: BuildingType;
  name: string;
  en: string;
  short: string;
  serial: string;
  category: BuildingCategory;
  desc: string;
  size: 1 | 2;
  cost: number;
  growth: number;
  energy: number;
  color: string;
  requires?: ResearchId;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  reactor: {
    type: 'reactor',
    name: 'Квантовый реактор',
    en: 'Quantum Reactor',
    short: 'РЕАКТОР',
    serial: 'QR',
    category: 'energy',
    desc: 'Питает всю фабрику. Если нагрузка превысит генерацию — цех обесточится.',
    size: 1,
    cost: 250,
    growth: 1.22,
    energy: 0,
    color: '#facc15',
  },
  miner: {
    type: 'miner',
    name: 'Генератор сырых данных',
    en: 'Data Miner',
    short: 'ДАННЫЕ',
    serial: 'DM',
    category: 'extraction',
    desc: 'Скрейпит интернет и пассивно добывает Сырые данные на склад.',
    size: 1,
    cost: 60,
    growth: 1.15,
    energy: 3,
    color: '#22d3ee',
  },
  coder: {
    type: 'coder',
    name: 'Блок вайбкодинга',
    en: 'Vibe Coder AI',
    short: 'ВАЙБКОД',
    serial: 'VC',
    category: 'production',
    desc: 'Превращает Сырые данные в Чистый код. Со временем копит техдолг — КПД падает.',
    size: 1,
    cost: 220,
    growth: 1.16,
    energy: 5,
    color: '#a855f7',
  },
  gpu: {
    type: 'gpu',
    name: 'GPU-кластер',
    en: 'Compute Node',
    short: 'GPU',
    serial: 'GX',
    category: 'energy',
    desc: 'Даёт вычислительную мощность (Compute) для обучения и AGI.',
    size: 1,
    cost: 500,
    growth: 1.18,
    energy: 6,
    color: '#60a5fa',
  },
  trainer: {
    type: 'trainer',
    name: 'Кластер обучения LLM',
    en: 'LLM Trainer',
    short: 'LLM',
    serial: 'LT',
    category: 'production',
    desc: 'Обучает модели из Сырых данных и Чистого кода на мощностях GPU.',
    size: 1,
    cost: 1200,
    growth: 1.18,
    energy: 10,
    color: '#f472b6',
  },
  publisher: {
    type: 'publisher',
    name: 'Экспортный терминал SaaS',
    en: 'SaaS Publisher',
    short: 'SaaS',
    serial: 'SP',
    category: 'export',
    desc: 'Сам продаёт обученные модели на глобальном рынке по текущей цене.',
    size: 1,
    cost: 900,
    growth: 1.2,
    energy: 4,
    color: '#34d399',
  },
  storage: {
    type: 'storage',
    name: 'Хранилище',
    en: 'Data Vault',
    short: 'СКЛАД',
    serial: 'SV',
    category: 'infrastructure',
    desc: 'Каждое Хранилище добавляет +100% базовой вместимости склада (×уровень).',
    size: 1,
    cost: 400,
    growth: 1.3,
    energy: 1,
    color: '#94a3b8',
  },
  agi: {
    type: 'agi',
    name: 'Суперкомпьютер AGI',
    en: 'AGI Supercomputer',
    short: 'AGI',
    serial: 'AG',
    category: 'export',
    desc: 'Блок 2×2 четвёртого тира. Продаёт модели как AGI-сервисы: ×10 прибыли с каждой модели.',
    size: 2,
    cost: 1500000,
    growth: 1.5,
    energy: 50,
    color: '#f0abfc',
    requires: 'transformers',
  },
};

export const BUILD_ORDER: BuildingType[] = [
  'reactor',
  'miner',
  'coder',
  'gpu',
  'trainer',
  'publisher',
  'storage',
  'agi',
];

/** Кто кого кормит по прямому конвейеру (потребитель → поставщики). */
export const FEEDS: Partial<Record<BuildingType, BuildingType[]>> = {
  coder: ['miner'],
  trainer: ['miner', 'coder', 'gpu'],
  publisher: ['trainer'],
  agi: ['trainer', 'gpu'],
};

/** Что поставщик отдаёт по конвейеру — определяет цвет ленты. */
export const LINK_RES: Partial<Record<BuildingType, LinkRes>> = {
  miner: 'data',
  coder: 'code',
  trainer: 'models',
  gpu: 'compute',
};

export const PRODUCTION_TYPES: ReadonlySet<BuildingType> = new Set<BuildingType>([
  'miner',
  'coder',
  'trainer',
  'publisher',
  'agi',
]);

export interface ResearchDef {
  id: ResearchId;
  tier: 1 | 2 | 3 | 4;
  name: string;
  effect: string;
  desc: string;
  cost: number;
  code: number;
  time: number;
  requires: ResearchId[];
}

export const RESEARCH: Record<ResearchId, ResearchDef> = {
  conveyor: {
    id: 'conveyor',
    tier: 1,
    name: 'Конвейерная оптимизация',
    effect: '+25% к скорости всех производственных зданий',
    desc: 'Синхронизирует такты цехов: ресурсы не ждут на стыках линий.',
    cost: 4000,
    code: 400,
    time: 45,
    requires: [],
  },
  softRefactor: {
    id: 'softRefactor',
    tier: 1,
    name: 'Мягкий рефакторинг',
    effect: '−30% энергопотребления Блоков вайбкодинга',
    desc: 'Блоки перестают перегенерировать один и тот же код по пять раз.',
    cost: 2000,
    code: 200,
    time: 25,
    requires: [],
  },
  coldStorage: {
    id: 'coldStorage',
    tier: 1,
    name: 'Холодное хранилище',
    effect: '×2 вместимость склада',
    desc: 'Редко используемые датасеты уезжают в дешёвый холодный слой.',
    cost: 3000,
    code: 250,
    time: 30,
    requires: [],
  },
  smartGrid: {
    id: 'smartGrid',
    tier: 1,
    name: 'Умная энергосеть',
    effect: 'При дефиците энергии цех замедляется, а не гаснет целиком',
    desc: 'Балансировщик делит доступную мощность между всеми потребителями.',
    cost: 5000,
    code: 400,
    time: 35,
    requires: [],
  },
  codeReview: {
    id: 'codeReview',
    tier: 2,
    name: 'Код-ревью ботами',
    effect: 'Техдолг копится вдвое медленнее',
    desc: 'Линтеры и ревью-боты ловят ошибки до того, как они уйдут в прод.',
    cost: 20000,
    code: 1500,
    time: 50,
    requires: ['softRefactor'],
  },
  synthData: {
    id: 'synthData',
    tier: 2,
    name: 'Синтетические данные',
    effect: '+50% выработки Генераторов сырых данных',
    desc: 'Генераторы дописывают датасеты сами, когда интернет заканчивается.',
    cost: 30000,
    code: 2000,
    time: 60,
    requires: ['conveyor'],
  },
  tensorCores: {
    id: 'tensorCores',
    tier: 2,
    name: 'Тензорные ядра',
    effect: '+50% мощности GPU-кластеров',
    desc: 'Смешанная точность и плотная упаковка матричных операций.',
    cost: 35000,
    code: 2500,
    time: 60,
    requires: ['conveyor'],
  },
  fusion: {
    id: 'fusion',
    tier: 2,
    name: 'Квантовый синтез',
    effect: '+50% генерации Квантовых реакторов',
    desc: 'Стабильная плазма в ловушке из запутанных частиц.',
    cost: 45000,
    code: 3000,
    time: 70,
    requires: ['smartGrid'],
  },
  viral: {
    id: 'viral',
    tier: 2,
    name: 'Вирусный маркетинг',
    effect: '+30% к цене моделей на рынке',
    desc: 'Бенчмарки в заголовках, демо в соцсетях, очередь из клиентов.',
    cost: 60000,
    code: 3000,
    time: 70,
    requires: ['coldStorage'],
  },
  expansion: {
    id: 'expansion',
    tier: 2,
    name: 'Расширение цеха',
    effect: 'Открывает внешнее кольцо: сетка 8×8 (+28 ячеек)',
    desc: 'Сносим перегородки и запускаем соседние пролёты завода.',
    cost: 50000,
    code: 4000,
    time: 90,
    requires: ['conveyor'],
  },
  cicd: {
    id: 'cicd',
    tier: 3,
    name: 'CI/CD-конвейер',
    effect: 'Автоматический рефакторинг при техдолге от 40% — за полцены',
    desc: 'Каждый блок чистится сам, как только долг доходит до порога.',
    cost: 150000,
    code: 8000,
    time: 90,
    requires: ['codeReview'],
  },
  distill: {
    id: 'distill',
    tier: 3,
    name: 'Дистилляция моделей',
    effect: '−25% расхода данных и кода Кластерами обучения',
    desc: 'Большие модели учат маленьких — выход тот же, сырья меньше.',
    cost: 250000,
    code: 12000,
    time: 100,
    requires: ['tensorCores'],
  },
  hyper: {
    id: 'hyper',
    tier: 3,
    name: 'Гиперконвейер',
    effect: 'Ещё +25% к скорости производственных зданий',
    desc: 'Магнитные ленты и предиктивная подача сырья на станки.',
    cost: 300000,
    code: 15000,
    time: 120,
    requires: ['expansion', 'synthData'],
  },
  transformers: {
    id: 'transformers',
    tier: 4,
    name: 'Архитектура трансформеров',
    effect: 'Открывает Суперкомпьютер AGI: ×10 прибыли с каждой модели',
    desc: 'Attention is all you need. Фабрика готова к четвёртому тиру.',
    cost: 800000,
    code: 25000,
    time: 180,
    requires: ['distill', 'fusion'],
  },
  singularity: {
    id: 'singularity',
    tier: 4,
    name: 'Технологическая сингулярность',
    effect: '+50% к доходу Суперкомпьютеров AGI',
    desc: 'AGI сам оптимизирует свою выдачу. Люди только смотрят на графики.',
    cost: 15000000,
    code: 100000,
    time: 300,
    requires: ['transformers', 'hyper'],
  },
};

export const RESEARCH_ORDER: ResearchId[] = [
  'conveyor',
  'softRefactor',
  'coldStorage',
  'smartGrid',
  'codeReview',
  'synthData',
  'tensorCores',
  'fusion',
  'viral',
  'expansion',
  'cicd',
  'distill',
  'hyper',
  'transformers',
  'singularity',
];

export const TIER_NAMES: Record<1 | 2 | 3 | 4, string> = {
  1: 'Основы автоматизации',
  2: 'Масштабирование',
  3: 'Оптимизация',
  4: 'Сверхразум',
};

export interface MarketEventDef {
  id: string;
  name: string;
  desc: string;
  kind: 'price' | 'grid';
  factor: number;
  duration: number;
  weight: number;
  minTick?: number;
  minReactors?: number;
}

export const MARKET_EVENTS: MarketEventDef[] = [
  {
    id: 'hype',
    name: 'ИИ-лихорадка',
    desc: 'Инвесторы скупают всё со словом «AI» в названии',
    kind: 'price',
    factor: 1.6,
    duration: 30,
    weight: 3,
  },
  {
    id: 'contract',
    name: 'Корпоративный контракт',
    desc: 'Банк заказал крупную партию моделей',
    kind: 'price',
    factor: 1.35,
    duration: 45,
    weight: 4,
  },
  {
    id: 'shortage',
    name: 'Дефицит GPU у конкурентов',
    desc: 'Чужие фабрики простаивают — покупатели идут к вам',
    kind: 'price',
    factor: 1.25,
    duration: 40,
    weight: 3,
  },
  {
    id: 'leak',
    name: 'Утечка весов',
    desc: 'Модель конкурента выложили в open-source',
    kind: 'price',
    factor: 0.65,
    duration: 30,
    weight: 3,
  },
  {
    id: 'audit',
    name: 'Регуляторная проверка',
    desc: 'Надзорный орган тормозит сделки',
    kind: 'price',
    factor: 0.75,
    duration: 40,
    weight: 3,
  },
  {
    id: 'bubble',
    name: 'Пузырь лопнул',
    desc: 'Паника на бирже, покупатели ждут дна',
    kind: 'price',
    factor: 0.5,
    duration: 20,
    weight: 1,
    minTick: 900,
  },
  {
    id: 'flare',
    name: 'Квантовая нестабильность',
    desc: 'Реакторы теряют 25% мощности — держите запас по энергии',
    kind: 'grid',
    factor: 0.75,
    duration: 25,
    weight: 2,
    minTick: 600,
    minReactors: 2,
  },
];

export const RES_META: Record<
  ResKey | 'energy' | 'compute' | 'credits',
  { name: string; unit: string; color: string }
> = {
  data: { name: 'Сырые данные', unit: 'ТБ', color: '#22d3ee' },
  code: { name: 'Чистый код', unit: 'KLOC', color: '#a855f7' },
  models: { name: 'Обученные модели', unit: 'шт.', color: '#f472b6' },
  energy: { name: 'Энергия', unit: 'МВт', color: '#facc15' },
  compute: { name: 'Вычисления', unit: 'PFLOPS', color: '#60a5fa' },
  credits: { name: 'Кредиты', unit: '$', color: '#34d399' },
};

export const LINK_COLORS: Record<LinkRes, string> = {
  data: '#22d3ee',
  code: '#a855f7',
  models: '#f472b6',
  compute: '#60a5fa',
};

export const SELLABLE: SellableRes[] = ['data', 'code'];
