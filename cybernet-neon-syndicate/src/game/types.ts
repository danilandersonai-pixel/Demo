// Типы игрового ядра CyberNet: Neon Syndicate.
// Ядро не зависит от React: его можно гонять headless (см. scripts/simulate.ts).

export type BuildingId = 'solar' | 'miner' | 'server' | 'optimizer' | 'reactor' | 'qcore';

export type ResearchId =
  | 'quantumAlgo'
  | 'dataCompression'
  | 'nitrogenCooling'
  | 'neuroFirewall'
  | 'autoBroker'
  | 'grapheneCells'
  | 'shadowLedger'
  | 'swarmMind'
  | 'coldFusion'
  | 'syndicateProtocol'
  | 'singularity'
  | 'orbitalMirrors';

export type EventId =
  | 'hack'
  | 'solarFlare'
  | 'taxAudit'
  | 'geoStorm'
  | 'dataBoom'
  | 'dataCrash'
  | 'cryptoRally'
  | 'cryptoWinter'
  | 'heatwave'
  | 'sabotage'
  | 'investor'
  | 'blackMarket'
  | 'blueprintLeak'
  | 'netGrant'
  | 'rivalRaid'
  | 'inflationSpike';

export type Accent = 'credit' | 'data' | 'energy' | 'research' | 'danger';
export type Speed = 0 | 1 | 2 | 4;
export type GameStatus = 'playing' | 'gameover';
export type LogTone = 'info' | 'success' | 'warning' | 'danger' | 'event' | 'system';
export type LogCategory = 'build' | 'economy' | 'research' | 'event' | 'system';
/** Полярность события: влияет на частоту по мере роста угрозы и на цвет в интерфейсе. */
export type EventPolarity = 'good' | 'bad' | 'neutral';

/** Цели временных модификаторов от событий. Значение — относительная добавка (+0.5 = +50%). */
export type ModTarget =
  | 'energyProd'
  | 'solarOutput'
  | 'energyUse'
  | 'minerOutput'
  | 'creditOutput'
  | 'dataOutput'
  | 'dataPrice'
  | 'upkeep';

export interface Cost {
  credits: number;
  data: number;
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  /** Грамматический род названия — для согласования в логе («построена», «улучшен», «переведено»). */
  gender: 'm' | 'f' | 'n';
  tag: string;
  description: string;
  accent: Accent;
  baseCost: Cost;
  /** Рост цены за каждую уже стоящую копию этого здания. */
  costGrowth: number;
  energyProd: number;
  energyUse: number;
  creditProd: number;
  dataProd: number;
  dataCap: number;
  energyCap: number;
  upkeep: number;
  /** Бонус соседям (только у ИИ-Оптимизатора). */
  aura: number;
  requires: ResearchId | null;
}

export interface ResearchDef {
  id: ResearchId;
  name: string;
  tag: string;
  description: string;
  effect: string;
  cost: Cost;
  duration: number;
  requires: ResearchId[];
  col: number;
  row: number;
}

export interface Cell {
  /** Уникальный номер постройки; 0 — ячейка пуста. Меняется при каждой новой стройке. */
  uid: number;
  type: BuildingId | null;
  level: number;
  enabled: boolean;
  /** Сколько кредитов вложено (стройка + улучшения) — от этого считается возврат при демонтаже. */
  invested: number;
  builtDay: number;
}

export interface Modifier {
  id: number;
  eventId: EventId;
  label: string;
  target: ModTarget;
  value: number;
  startDay: number;
  /** Последний день, в который эффект ещё действует. */
  endsDay: number;
}

export type OptionTone = 'safe' | 'risky' | 'danger' | 'neutral';

export interface DecisionOption {
  id: string;
  label: string;
  detail: string;
  tone: OptionTone;
  /** Добровольная плата за вариант. Если не хватает — вариант заблокирован. */
  cost: Cost;
}

export interface PendingDecision {
  eventId: EventId;
  title: string;
  description: string;
  options: DecisionOption[];
  defaultOption: string;
  startDay: number;
  expiresDay: number;
  /** Суммы, зафиксированные в момент события, — чтобы цифры в окне не «плыли». */
  ctx: Record<string, number>;
  /** Скорость до события: на время решения игра сбрасывается на 1×, потом скорость возвращается. 0 — не менялась. */
  resumeSpeed: number;
}

export interface LogEntry {
  id: number;
  day: number;
  text: string;
  tone: LogTone;
  category: LogCategory;
}

export interface EventRecord {
  id: number;
  day: number;
  eventId: EventId;
  title: string;
  outcome: string;
  tone: LogTone;
}

export interface Toast {
  id: number;
  kind: 'record' | 'research' | 'alert' | 'info';
  title: string;
  text: string;
}

export interface RunStats {
  built: number;
  upgrades: number;
  demolished: number;
  researchDone: number;
  events: number;
  blackouts: number;
  dataSold: number;
  creditsEarned: number;
  peakCapital: number;
  peakIncome: number;
}

export interface RunSummary {
  runId: number;
  days: number;
  peakCapital: number;
  researchDone: number;
  built: number;
  endedAt: number;
  cause: 'bankrupt' | 'reset';
}

export interface Records {
  bestDays: number;
  bestCapital: number;
  /** Сколько номеров сессий уже выдано (номер занимается при старте забега). */
  totalRuns: number;
  runs: RunSummary[];
  /** Метка последней очистки Зала славы: при слиянии вкладок более свежая очистка побеждает. */
  epoch: number;
}

export interface TickReport {
  day: number;
  credits: {
    production: number;
    export: number;
    broker: number;
    upkeep: number;
    overhead: number;
    wealth: number;
    net: number;
  };
  data: {
    production: number;
    sold: number;
    overflow: number;
    net: number;
  };
  energy: {
    production: number;
    consumption: number;
    net: number;
    exported: number;
    powerRatio: number;
  };
}

export interface GameSettings {
  autoPause: boolean;
}

export interface GameState {
  version: number;
  runId: number;
  status: GameStatus;
  day: number;
  credits: number;
  data: number;
  energy: number;
  blackout: boolean;
  grid: Cell[];
  rowsUnlocked: number;
  nextUid: number;
  research: {
    done: ResearchId[];
    active: ResearchId | null;
    progress: number;
  };
  modifiers: Modifier[];
  nextModId: number;
  pending: PendingDecision | null;
  lastEventId: EventId | null;
  market: {
    price: number;
    history: number[];
  };
  autoBrokerEnabled: boolean;
  bankruptDays: number;
  history: {
    credits: number[];
    data: number[];
    energy: number[];
  };
  log: LogEntry[];
  nextLogId: number;
  eventHistory: EventRecord[];
  toasts: Toast[];
  nextToastId: number;
  stats: RunStats;
  records: Records;
  /** Рекорды на момент старта забега — с ними сравниваем, чтобы поймать побитие. */
  baseline: { days: number; capital: number };
  recordFlags: { days: boolean; capital: boolean };
  rngSeed: number;
  speed: Speed;
  settings: GameSettings;
  lastTick: TickReport | null;
  startedAt: number;
}

export type Action =
  | { type: 'TICK'; now: number }
  | { type: 'BUILD'; building: BuildingId; cell: number }
  | { type: 'UPGRADE'; cell: number }
  | { type: 'DEMOLISH'; cell: number }
  | { type: 'TOGGLE'; cell: number }
  | { type: 'UNLOCK_ROW' }
  | { type: 'START_RESEARCH'; id: ResearchId }
  | { type: 'SELL_DATA'; fraction: number }
  | { type: 'BUY_DATA'; amount: number }
  | { type: 'TOGGLE_AUTOBROKER' }
  | { type: 'RESOLVE_DECISION'; option: string }
  | { type: 'SET_SPEED'; speed: Speed }
  | { type: 'DISMISS_TOAST'; id: number }
  | { type: 'SET_AUTOPAUSE'; value: boolean }
  | { type: 'NEW_GAME'; seed: number; now: number }
  | { type: 'WIPE_RECORDS'; now: number }
  /** Подменить состояние целиком (перехват управления из другой вкладки). */
  | { type: 'HYDRATE'; state: GameState };
