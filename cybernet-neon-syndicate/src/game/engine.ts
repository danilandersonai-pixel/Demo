// Игровой движок: начальное состояние и reducer всех действий.
// Один TICK = один игровой день. Reducer чистый: случайность берётся из rngSeed в состоянии.

import {
  AUTOBROKER_TARGET,
  AUTOBROKER_TRIGGER,
  BANKRUPTCY_DAYS,
  BUILDINGS,
  BUY_SPREAD,
  DEMOLISH_REFUND,
  EVENT_INTERVAL,
  GRID_CELLS,
  HISTORY_LENGTH,
  MARKET_BASE_PRICE,
  MARKET_MAX_PRICE,
  MARKET_MIN_PRICE,
  MIN_RECORD_DAYS,
  RESEARCH,
  SAVE_VERSION,
  START_CREDITS,
  START_DATA,
  START_ENERGY,
  START_ROWS,
  agree,
  cellLabel,
} from './config.ts';
import {
  autoBrokerPrice,
  buildCost,
  computeEconomy,
  effectiveDataPrice,
  hasResearch,
  projectTick,
  upgradeCost,
} from './economy.ts';
import { canChoose, resolveDecision, rollEvent, triggerEvent } from './events.ts';
import { fmt } from './format.ts';
import { pushLog, pushToast, updateRecords } from './mutators.ts';
import { createRng } from './rng.ts';
import {
  checkBuild,
  checkDemolish,
  checkResearch,
  checkToggle,
  checkUnlockRow,
  checkUpgrade,
  nextRowCost,
} from './rules.ts';
import type { Action, BuildingId, Cell, GameState, Records, RunSummary } from './types.ts';

export function emptyCell(): Cell {
  return { uid: 0, type: null, level: 0, enabled: true, invested: 0, builtDay: 0 };
}

export function emptyRecords(): Records {
  return { bestDays: 0, bestCapital: 0, totalRuns: 0, runs: [], epoch: 0 };
}

/** Стартовая база: две солнечные панели и две майнинг-фермы — доход идёт с первого дня. */
const STARTER_LAYOUT: Array<[number, BuildingId]> = [
  [0, 'solar'],
  [1, 'solar'],
  [6, 'miner'],
  [7, 'miner'],
];

export function createInitialState(seed: number, now: number, records: Records = emptyRecords()): GameState {
  const grid = Array.from({ length: GRID_CELLS }, emptyCell);
  let uid = 1;
  for (const [index, type] of STARTER_LAYOUT) {
    grid[index] = {
      uid,
      type,
      level: 1,
      enabled: true,
      invested: BUILDINGS[type].baseCost.credits,
      builtDay: 0,
    };
    uid += 1;
  }

  // Номер сессии занимается сразу при старте — так два забега никогда не получат один номер.
  const runId = records.totalRuns + 1;
  const state: GameState = {
    version: SAVE_VERSION,
    runId,
    status: 'playing',
    day: 0,
    credits: START_CREDITS,
    data: START_DATA,
    energy: START_ENERGY,
    blackout: false,
    grid,
    rowsUnlocked: START_ROWS,
    nextUid: uid,
    research: { done: [], active: null, progress: 0 },
    modifiers: [],
    nextModId: 1,
    pending: null,
    lastEventId: null,
    market: { price: MARKET_BASE_PRICE, history: [MARKET_BASE_PRICE] },
    autoBrokerEnabled: false,
    bankruptDays: 0,
    history: { credits: [START_CREDITS], data: [START_DATA], energy: [START_ENERGY] },
    log: [],
    nextLogId: 1,
    eventHistory: [],
    toasts: [],
    nextToastId: 1,
    stats: {
      built: 0,
      upgrades: 0,
      demolished: 0,
      researchDone: 0,
      events: 0,
      blackouts: 0,
      dataSold: 0,
      creditsEarned: 0,
      peakCapital: START_CREDITS,
      peakIncome: 0,
    },
    records: { ...records, runs: [...records.runs], totalRuns: runId },
    baseline: { days: records.bestDays, capital: records.bestCapital },
    recordFlags: { days: false, capital: false },
    rngSeed: seed >>> 0,
    speed: 1,
    settings: { autoPause: true },
    lastTick: null,
    startedAt: now,
  };

  pushLog(state, `Синдикат «Neon» развёрнут. Сессия #${state.runId}. Стартовый капитал ${START_CREDITS}₵`, 'system', 'system');
  pushLog(state, 'В секторе работают 2 солнечные панели и 2 майнинг-фермы', 'info', 'build');
  pushLog(state, `Каждые ${EVENT_INTERVAL} дней — глобальное событие. Не допускайте минуса дольше ${BANKRUPTCY_DAYS} дней`, 'warning', 'system');
  return state;
}

function pushHistory(list: number[], value: number): void {
  list.push(Math.round(value * 100) / 100);
  if (list.length > HISTORY_LENGTH) list.splice(0, list.length - HISTORY_LENGTH);
}

function archiveRun(s: GameState, now: number, cause: RunSummary['cause']): void {
  const summary: RunSummary = {
    runId: s.runId,
    days: s.day,
    peakCapital: Math.floor(s.stats.peakCapital),
    researchDone: s.stats.researchDone,
    built: s.stats.built,
    endedAt: now,
    cause,
  };
  s.records.totalRuns = Math.max(s.records.totalRuns, s.runId);
  // Завершённый забег — официальный: его итоги учитываются в рекордах в любом случае.
  s.records.bestDays = Math.max(s.records.bestDays, summary.days);
  s.records.bestCapital = Math.max(s.records.bestCapital, summary.peakCapital);
  s.records.runs = [...s.records.runs.filter((r) => r.runId !== s.runId), summary].sort((a, b) => b.days - a.days || b.peakCapital - a.peakCapital).slice(0, 8);
}

function updateMarket(s: GameState, rng: ReturnType<typeof createRng>): void {
  // Возврат к медленно гуляющему среднему + шум: цена «дышит» циклами по ~280 дней.
  const target = MARKET_BASE_PRICE + 0.7 * Math.sin(s.day / 45) + 0.3 * Math.sin(s.day / 11);
  let price = s.market.price + (target - s.market.price) * 0.07 + rng.gauss() * 0.11;
  price = Math.min(MARKET_MAX_PRICE, Math.max(MARKET_MIN_PRICE, price));
  s.market.price = Math.round(price * 1000) / 1000;
  pushHistory(s.market.history, s.market.price);
}

function tick(state: GameState, now: number): GameState {
  if (state.status !== 'playing') return state;
  const p = projectTick(state);
  const s: GameState = structuredClone(state);
  const rng = createRng(s.rngSeed);
  s.day += 1;
  s.toasts = s.toasts.slice(-3);

  // 1. Завершение временных эффектов.
  const expired = s.modifiers.filter((mod) => mod.endsDay < s.day);
  if (expired.length) {
    s.modifiers = s.modifiers.filter((mod) => mod.endsDay >= s.day);
    for (const mod of expired) pushLog(s, `Эффект «${mod.label}» завершён`, 'info', 'event');
  }

  // 2. Производство и энергосеть.
  s.credits += p.creditsDelta;
  s.data = Math.min(p.econ.dataCap, s.data + p.dataGain);
  s.energy = p.energyAfter;
  s.blackout = p.blackoutAfter;
  s.stats.creditsEarned += p.creditProduction + p.exportIncome;
  if (p.blackoutStarted) {
    s.stats.blackouts += 1;
    pushLog(s, 'БЛЭКАУТ! Энергия на нуле — производство остановлено', 'danger', 'economy');
    pushToast(s, 'alert', 'Блэкаут', 'Энергия упала до нуля. Производство стоит, содержание списывается.');
  }
  if (p.blackoutEnded) pushLog(s, 'Энергосеть перезапущена — производство возобновлено', 'success', 'economy');

  // 3. Авто-Брокер: продаёт излишек при заполнении хранилища.
  let brokerIncome = 0;
  let brokerSold = 0;
  if (s.autoBrokerEnabled && hasResearch(s, 'autoBroker') && s.data >= p.econ.dataCap * AUTOBROKER_TRIGGER) {
    brokerSold = Math.floor(s.data - p.econ.dataCap * AUTOBROKER_TARGET);
    if (brokerSold > 0) {
      brokerIncome = brokerSold * autoBrokerPrice(s);
      s.data -= brokerSold;
      s.credits += brokerIncome;
      s.stats.dataSold += brokerSold;
      pushLog(s, `Авто-Брокер продал ${fmt(brokerSold)} ед. данных за ${fmt(brokerIncome)}₵`, 'success', 'economy');
    }
  }

  // 4. Рынок данных.
  updateMarket(s, rng);

  // 5. Исследования.
  if (s.research.active) {
    s.research.progress += 1;
    const def = RESEARCH[s.research.active];
    if (s.research.progress >= def.duration) {
      s.research.done.push(def.id);
      s.research.active = null;
      s.research.progress = 0;
      s.stats.researchDone += 1;
      if (def.id === 'autoBroker') s.autoBrokerEnabled = true;
      pushLog(s, `Исследование завершено: «${def.name}». ${def.effect}`, 'success', 'research');
      pushToast(s, 'research', 'Исследование завершено', `${def.name}: ${def.effect}`);
    }
  }

  // 6. Просроченное решение — срабатывает вариант по умолчанию.
  if (s.pending && s.day >= s.pending.expiresDay) {
    resolveDecision(s, s.pending.defaultOption, rng, true);
  }

  // 7. Глобальное событие раз в EVENT_INTERVAL дней.
  if (s.day % EVENT_INTERVAL === 0 && !s.pending) {
    triggerEvent(s, rollEvent(s, rng), rng);
  }

  // 8. Авто-Брокер гасит минус на счёте, продавая данные (после событий — они тоже могли увести в минус).
  if (s.credits < 0 && s.autoBrokerEnabled && hasResearch(s, 'autoBroker') && s.data >= 1) {
    const price = autoBrokerPrice(s);
    const units = Math.min(Math.floor(s.data), Math.ceil(-s.credits / price));
    if (units > 0) {
      const income = units * price;
      s.data -= units;
      s.credits += income;
      s.stats.dataSold += units;
      brokerSold += units;
      brokerIncome += income;
      pushLog(s, `Авто-Брокер экстренно продал ${fmt(units)} ед. данных за ${fmt(income)}₵, чтобы закрыть минус`, 'warning', 'economy');
    }
  }

  // 9. Банкротство: минус держится BANKRUPTCY_DAYS дней подряд.
  if (s.credits < 0) {
    s.bankruptDays += 1;
    if (s.bankruptDays >= BANKRUPTCY_DAYS) {
      s.status = 'gameover';
      pushLog(s, `БАНКРОТСТВО. Синдикат ликвидирован на ${s.day}-й день`, 'danger', 'system');
      updateRecords(s);
      archiveRun(s, now, 'bankrupt');
    } else {
      const left = BANKRUPTCY_DAYS - s.bankruptDays;
      pushLog(s, `Баланс отрицательный! До банкротства ${left} дн.`, 'danger', 'economy');
      if (s.bankruptDays === 1) {
        pushToast(s, 'alert', 'Угроза банкротства', `Кредиты ушли в минус. У вас ${left} дн., чтобы вернуть баланс.`);
      }
    }
  } else if (s.bankruptDays > 0) {
    s.bankruptDays = 0;
    pushLog(s, 'Баланс восстановлен — угроза банкротства снята', 'success', 'economy');
  }

  // 10. Рекорды, статистика, история для графиков.
  const netIncome = p.creditsDelta + brokerIncome;
  if (netIncome > s.stats.peakIncome) s.stats.peakIncome = netIncome;
  if (s.status === 'playing') updateRecords(s);
  pushHistory(s.history.credits, s.credits);
  pushHistory(s.history.data, s.data);
  pushHistory(s.history.energy, s.energy);

  s.lastTick = {
    day: s.day,
    credits: {
      production: p.creditProduction,
      export: p.exportIncome,
      broker: brokerIncome,
      upkeep: p.upkeep,
      overhead: p.overhead,
      wealth: p.wealth,
      net: netIncome,
    },
    data: {
      production: p.dataGain,
      sold: brokerSold,
      overflow: p.dataOverflow,
      net: p.dataGain - brokerSold,
    },
    energy: {
      production: p.econ.energyProd,
      consumption: p.energyConsumed,
      net: p.energyDelta,
      exported: p.energyExported,
      powerRatio: p.powerRatio,
    },
  };

  s.rngSeed = rng.seed;
  return s;
}

function build(state: GameState, type: BuildingId, cell: number): GameState {
  if (!checkBuild(state, type, cell).ok) return state;
  const s = structuredClone(state);
  const cost = buildCost(state, type);
  const def = BUILDINGS[type];
  s.credits -= cost.credits;
  s.data -= cost.data;
  s.grid[cell] = { uid: s.nextUid, type, level: 1, enabled: true, invested: cost.credits, builtDay: s.day };
  s.nextUid += 1;
  s.stats.built += 1;
  const price = cost.data > 0 ? `${fmt(cost.credits)}₵ + ${fmt(cost.data)} ед. данных` : `${fmt(cost.credits)}₵`;
  pushLog(s, `${agree(def, ['Построен', 'Построена', 'Построено'])} ${def.name} [${cellLabel(cell)}] за ${price}`, 'info', 'build');
  return s;
}

function upgrade(state: GameState, index: number): GameState {
  if (!checkUpgrade(state, index).ok) return state;
  const s = structuredClone(state);
  const cell = s.grid[index];
  const cost = upgradeCost(cell);
  s.credits -= cost.credits;
  s.data -= cost.data;
  cell.level += 1;
  cell.invested += cost.credits;
  s.stats.upgrades += 1;
  const def = BUILDINGS[cell.type!];
  pushLog(s, `${def.name} [${cellLabel(index)}] ${agree(def, ['улучшен', 'улучшена', 'улучшено'])} до ур. ${cell.level}`, 'info', 'build');
  return s;
}

function demolish(state: GameState, index: number): GameState {
  if (!checkDemolish(state, index).ok) return state;
  const s = structuredClone(state);
  const cell = s.grid[index];
  const refund = Math.round(cell.invested * DEMOLISH_REFUND);
  const name = BUILDINGS[cell.type!].name;
  s.credits += refund;
  s.grid[index] = emptyCell();
  s.stats.demolished += 1;
  // Если хранилище данных сжалось — лишнее теряется.
  const cap = computeEconomy(s).dataCap;
  if (s.data > cap) s.data = cap;
  const energyCap = computeEconomy(s).energyCap;
  if (s.energy > energyCap) s.energy = energyCap;
  pushLog(s, `Демонтирован объект «${name}» [${cellLabel(index)}]. Возврат ${fmt(refund)}₵`, 'warning', 'build');
  updateRecords(s);
  return s;
}

function toggle(state: GameState, index: number): GameState {
  if (!checkToggle(state, index).ok) return state;
  const s = structuredClone(state);
  const cell = s.grid[index];
  cell.enabled = !cell.enabled;
  const def = BUILDINGS[cell.type!];
  pushLog(
    s,
    cell.enabled
      ? `«${def.name}» [${cellLabel(index)}] снова в сети`
      : `«${def.name}» [${cellLabel(index)}] ${agree(def, ['переведён', 'переведена', 'переведено'])} в режим ожидания`,
    'info',
    'build',
  );
  return s;
}

function unlockRow(state: GameState): GameState {
  if (!checkUnlockRow(state).ok) return state;
  const cost = nextRowCost(state)!;
  const s = structuredClone(state);
  s.credits -= cost.credits;
  s.data -= cost.data;
  s.rowsUnlocked += 1;
  pushLog(s, `Сектор расширен: открыт ряд ${s.rowsUnlocked} (+6 ячеек)`, 'success', 'build');
  return s;
}

function startResearch(state: GameState, id: GameState['research']['done'][number]): GameState {
  if (!checkResearch(state, id).ok) return state;
  const s = structuredClone(state);
  const def = RESEARCH[id];
  s.credits -= def.cost.credits;
  s.data -= def.cost.data;
  s.research.active = id;
  s.research.progress = 0;
  pushLog(s, `Запущено исследование «${def.name}» — ${def.duration} дн.`, 'info', 'research');
  return s;
}

function sellData(state: GameState, fraction: number): GameState {
  if (state.status !== 'playing') return state;
  const amount = Math.floor(state.data * Math.min(1, Math.max(0, fraction)));
  if (amount <= 0) return state;
  const s = structuredClone(state);
  const value = amount * effectiveDataPrice(s);
  s.data -= amount;
  s.credits += value;
  s.stats.dataSold += amount;
  pushLog(s, `Продано ${fmt(amount)} ед. данных за ${fmt(value)}₵`, 'info', 'economy');
  updateRecords(s);
  return s;
}

function buyData(state: GameState, requested: number): GameState {
  if (state.status !== 'playing') return state;
  const unit = effectiveDataPrice(state) * BUY_SPREAD;
  const room = Math.floor(computeEconomy(state).dataCap - state.data);
  const affordable = Math.floor(Math.max(0, state.credits) / unit);
  const amount = Math.min(Math.floor(requested), room, affordable);
  if (amount <= 0) return state;
  const s = structuredClone(state);
  const cost = amount * unit;
  s.credits -= cost;
  s.data += amount;
  pushLog(s, `Куплено ${fmt(amount)} ед. данных за ${fmt(cost)}₵`, 'info', 'economy');
  return s;
}

export function gameReducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'TICK':
      return tick(state, action.now);
    case 'BUILD':
      return build(state, action.building, action.cell);
    case 'UPGRADE':
      return upgrade(state, action.cell);
    case 'DEMOLISH':
      return demolish(state, action.cell);
    case 'TOGGLE':
      return toggle(state, action.cell);
    case 'UNLOCK_ROW':
      return unlockRow(state);
    case 'START_RESEARCH':
      return startResearch(state, action.id);
    case 'SELL_DATA':
      return sellData(state, action.fraction);
    case 'BUY_DATA':
      return buyData(state, action.amount);
    case 'TOGGLE_AUTOBROKER': {
      if (!hasResearch(state, 'autoBroker')) return state;
      const s = structuredClone(state);
      s.autoBrokerEnabled = !s.autoBrokerEnabled;
      pushLog(s, `Авто-Брокер ${s.autoBrokerEnabled ? 'включён' : 'выключен'}`, 'info', 'economy');
      return s;
    }
    case 'RESOLVE_DECISION': {
      if (state.status !== 'playing' || !state.pending || !canChoose(state, action.option)) return state;
      const s = structuredClone(state);
      const rng = createRng(s.rngSeed);
      resolveDecision(s, action.option, rng);
      s.rngSeed = rng.seed;
      return s;
    }
    case 'SET_SPEED':
      return state.speed === action.speed ? state : { ...state, speed: action.speed };
    case 'DISMISS_TOAST':
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) };
    case 'SET_AUTOPAUSE':
      return { ...state, settings: { ...state.settings, autoPause: action.value } };
    case 'NEW_GAME': {
      // Забег короче MIN_RECORD_DAYS в Зал славы не попадает; проигранный уже заархивирован при банкротстве.
      const s = structuredClone(state);
      if (s.status === 'playing' && s.day >= MIN_RECORD_DAYS) archiveRun(s, action.now, 'reset');
      const next = createInitialState(action.seed, action.now, s.records);
      next.speed = state.speed === 0 ? 1 : state.speed;
      next.settings = { ...state.settings };
      return next;
    }
    case 'WIPE_RECORDS': {
      const s = structuredClone(state);
      s.records = { ...emptyRecords(), totalRuns: s.runId, epoch: action.now };
      s.baseline = { days: 0, capital: 0 };
      s.recordFlags = { days: false, capital: false };
      pushLog(s, 'Зал славы очищен', 'warning', 'system');
      return s;
    }
    case 'HYDRATE':
      return action.state;
    default:
      return state;
  }
}
