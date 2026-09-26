// Общие типы игрового движка. Движок не зависит от React: всё состояние —
// обычный сериализуемый объект, который целиком уходит в localStorage.

export type ResKey = 'data' | 'code' | 'models';
export type SellableRes = 'data' | 'code';

export type BuildingType =
  | 'reactor'
  | 'miner'
  | 'coder'
  | 'gpu'
  | 'trainer'
  | 'publisher'
  | 'storage'
  | 'agi';

export type ResearchId =
  | 'conveyor'
  | 'softRefactor'
  | 'coldStorage'
  | 'smartGrid'
  | 'codeReview'
  | 'synthData'
  | 'tensorCores'
  | 'fusion'
  | 'viral'
  | 'expansion'
  | 'cicd'
  | 'distill'
  | 'hyper'
  | 'transformers'
  | 'singularity';

/** Ресурс, который здание отдаёт соседям по прямому конвейеру. */
export type LinkRes = 'data' | 'code' | 'models' | 'compute';

export interface Building {
  id: number;
  type: BuildingType;
  /** Левая верхняя ячейка (для 2×2 — угол блока). */
  x: number;
  y: number;
  level: number;
  enabled: boolean;
  /** Технический долг 0…100 (только у Блоков вайбкодинга). */
  debt: number;
  /** Сколько вложено в здание (постройка + улучшения) — для возврата при сносе. */
  invested: number;
  /** Накопитель выпуска моделей: когда доходит до 1, на плитке всплывает «+1». */
  acc: number;
  /** Секунды пусконаладки (0…30): после них узел засчитывается в рекорд построек. */
  work: number;
}

/** Почему здание работает не на 100%. */
export type Limit =
  | 'none'
  | 'paused'
  | 'power'
  | 'compute'
  | 'data'
  | 'code'
  | 'models'
  | 'space';

export type Status = 'working' | 'partial' | 'idle' | 'blocked' | 'nopower' | 'paused';

export interface BuildingFlow {
  /** Загрузка 0…1. */
  u: number;
  status: Status;
  lim: Limit;
  /** Основной выпуск за тик: данные / код / модели / $ / PFLOPS / МВт. */
  out: number;
  /** КПД (для Блоков вайбкодинга падает с техдолгом), для остальных 1. */
  eff: number;
  /** Сколько соседей подают сюда ресурсы по прямым конвейерам. */
  adj: number;
  /** Итоговый множитель скорости (исследования + соседство). */
  speed: number;
  /** На этом тике закончился цикл обучения модели. */
  pulse: boolean;
}

export interface Flow {
  gen: number;
  load: number;
  /** Доля мощности, которую получает фабрика: 1 — норма, 0 — обесточено. */
  power: number;
  blackout: boolean;
  brownout: boolean;
  computeSupply: number;
  /** Спрос на вычисления с учётом реальной загрузки. */
  computeDemand: number;
  /** Спрос, если все потребители вычислений заработают на 100%. */
  computeNeedMax: number;
  computeRatio: number;
  prod: Record<ResKey, number>;
  cons: Record<ResKey, number>;
  /** Продано биржевым автоматом за тик. */
  sold: Record<SellableRes, number>;
  caps: Record<ResKey, number>;
  /** Пассивный доход за тик (SaaS + AGI + автопродажа сырья). */
  income: number;
  /** Та же выручка, но продажа моделей учитывается не больше их выпуска за тик. */
  incomeSustained: number;
  incomeSaas: number;
  incomeAgi: number;
  incomeExchange: number;
  /** Цена одной модели на рынке на этом тике. */
  price: number;
  researchDraw: number;
  b: Record<number, BuildingFlow>;
}

export interface MarketEvent {
  id: string;
  name: string;
  desc: string;
  kind: 'price' | 'grid';
  factor: number;
  startedAt: number;
  endsAt: number;
}

export interface Market {
  /** Медленный индекс рынка (процесс Орнштейна — Уленбека вокруг 1). */
  index: number;
  /** Фаза «хайп-цикла» — синусоиды поверх индекса. */
  phase: number;
  event: MarketEvent | null;
  nextEventAt: number;
  /** История цены модели за последние тики. */
  history: number[];
}

export interface Stats {
  earned: number;
  manualSales: number;
  dataMined: number;
  codeWritten: number;
  modelsTrained: number;
  modelsSold: number;
  built: number;
  refactors: number;
  autoRefactors: number;
  blackoutTicks: number;
  /** Сколько узлов этой фабрики прошли пусконаладку. */
  commissioned: number;
  agiBuiltAt: number | null;
}

export type LogKind = 'info' | 'build' | 'research' | 'market' | 'alert' | 'record' | 'goal';

export interface LogEntry {
  id: number;
  t: number;
  kind: LogKind;
  text: string;
}

export interface ActiveResearch {
  id: ResearchId;
  /** Сколько Чистого кода уже вложено. */
  paid: number;
}

export interface GameState {
  v: 1;
  tick: number;
  /** Состояние детерминированного ГПСЧ (mulberry32). */
  rng: number;
  credits: number;
  res: Record<ResKey, number>;
  buildings: Building[];
  nextId: number;
  research: { done: ResearchId[]; active: ActiveResearch | null };
  market: Market;
  autoSell: Record<SellableRes, boolean>;
  stats: Stats;
  flow: Flow;
  incomeHistory: number[];
  goals: string[];
  log: LogEntry[];
  logSeq: number;
  lastPowerNotice: number;
  createdAt: number;
  savedAt: number;
}

export type Tone = 'info' | 'good' | 'warn' | 'bad';

/** Всплывающее уведомление, которое движок просит показать игроку. */
export interface Notice {
  tone: Tone;
  title: string;
  text?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  notices?: Notice[];
}

export interface OfflineSummary {
  seconds: number;
  earned: number;
  models: number;
  code: number;
  data: number;
  blackoutTicks: number;
  research: ResearchId[];
  goals: string[];
}
