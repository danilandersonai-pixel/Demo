// Игровой движок: один тик = одна секунда. Всё распределение ресурсов считается
// от запасов на начало тика, поэтому результат не зависит от порядка зданий в
// массиве: дефицитный ресурс делится между потребителями пропорционально спросу.

import { BAL, BUILDINGS, MARKET_EVENTS, RESEARCH, RES_META } from './config';
import { GOALS } from './goals';
import { money, num, pct, roman } from './format';
import { rand, randInt, gauss } from './rng';
import {
  buildCost,
  cellMap,
  cellName,
  countType,
  exchangePrice,
  findPlacement,
  getCaps,
  getMods,
  hasResearch,
  modelPrice,
  ratesOf,
  refactorCost,
  refactorCostOf,
  refundOf,
  serialOf,
  upgradeCost,
  type Rates,
} from './selectors';
import type {
  ActionResult,
  Building,
  BuildingFlow,
  BuildingType,
  Flow,
  GameState,
  Limit,
  LogKind,
  Notice,
  OfflineSummary,
  ResearchId,
  SellableRes,
  Status,
} from './types';

const EPS = 1e-9;

export function emptyFlow(): Flow {
  return {
    gen: 0,
    load: 0,
    power: 1,
    blackout: false,
    brownout: false,
    computeSupply: 0,
    computeDemand: 0,
    computeNeedMax: 0,
    computeRatio: 1,
    prod: { data: 0, code: 0, models: 0 },
    cons: { data: 0, code: 0, models: 0 },
    sold: { data: 0, code: 0 },
    caps: { ...BAL.baseCaps },
    income: 0,
    incomeSustained: 0,
    incomeSaas: 0,
    incomeAgi: 0,
    incomeExchange: 0,
    price: BAL.price.model,
    researchDraw: 0,
    b: {},
  };
}

export function createState(seed: number, now: number): GameState {
  const s: GameState = {
    v: 1,
    tick: 0,
    rng: seed >>> 0,
    credits: BAL.startCredits,
    res: { data: 0, code: 0, models: 0 },
    buildings: [],
    nextId: 1,
    research: { done: [], active: null },
    market: { index: 1, phase: 0, event: null, nextEventAt: 0, history: [] },
    autoSell: { data: true, code: true },
    stats: {
      earned: 0,
      manualSales: 0,
      dataMined: 0,
      codeWritten: 0,
      modelsTrained: 0,
      modelsSold: 0,
      built: 0,
      refactors: 0,
      autoRefactors: 0,
      blackoutTicks: 0,
      commissioned: 0,
      agiBuiltAt: null,
    },
    flow: emptyFlow(),
    incomeHistory: [],
    goals: [],
    log: [],
    logSeq: 0,
    lastPowerNotice: -100,
    createdAt: now,
    savedAt: now,
  };
  s.market.phase = rand(s) * Math.PI * 2;
  s.market.nextEventAt = randInt(s, 240, 320);
  s.flow = computeFlow(s);
  pushLog(s, 'info', 'Смена началась. Постройте Квантовый реактор, чтобы запитать цех.');
  return s;
}

export function pushLog(s: GameState, kind: LogKind, text: string): void {
  s.log.push({ id: ++s.logSeq, t: s.tick, kind, text });
  if (s.log.length > BAL.logLen) s.log.splice(0, s.log.length - BAL.logLen);
}

/** Минимум из нескольких ограничителей + имя того, что ограничивает сильнее всего. */
function bind(pairs: Array<[number, Limit]>): [number, Limit] {
  let v = 1;
  let lim: Limit = 'none';
  for (const [x, l] of pairs) {
    if (x < v - EPS) {
      v = x;
      lim = l;
    }
  }
  return [Math.max(0, v), lim];
}

/** Какой из множителей ограничивает сильнее всего (для подписи «почему не 100%»). */
function weakest(pairs: Array<[number, Limit]>): Limit {
  let v = 1 - EPS;
  let lim: Limit = 'none';
  for (const [x, l] of pairs) {
    if (x < v) {
      v = x;
      lim = l;
    }
  }
  return lim;
}

/**
 * Рассчитывает все потоки фабрики на текущий тик, ничего не меняя в состоянии.
 * Используется и в step(), и для мгновенного предпросмотра после действий игрока.
 */
export function computeFlow(s: GameState): Flow {
  const mods = getMods(s);
  const map = cellMap(s);
  const caps = getCaps(s, mods);
  const bs = s.buildings;
  const n = bs.length;
  const R: Rates[] = new Array(n);
  for (let i = 0; i < n; i++) R[i] = ratesOf(s, bs[i], mods, map);

  // --- Энергосеть ---------------------------------------------------------
  const ev = s.market.event;
  const gridFactor = ev && ev.kind === 'grid' ? ev.factor : 1;
  let gen = 0;
  let load = 0;
  for (let i = 0; i < n; i++) {
    if (!bs[i].enabled) continue;
    gen += R[i].gen * gridFactor;
    load += R[i].energy;
  }
  let power = 1;
  let blackout = false;
  let brownout = false;
  if (load > gen + EPS) {
    if (mods.smartGrid && gen > EPS) {
      power = gen / load;
      brownout = true;
    } else {
      power = 0;
      blackout = true;
    }
  }

  // --- Спрос на входы -------------------------------------------------------
  const S0 = s.res;
  const price = modelPrice(s, mods);
  const u = new Float64Array(n);
  const lim: Limit[] = new Array(n).fill('none');

  let dAgi = 0;
  let dSaas = 0;
  let dDataCoders = 0;
  let dDataTrainers = 0;
  let dCode = 0;
  let computeSupply = 0;
  let computeNeedMax = 0;
  for (let i = 0; i < n; i++) {
    const b = bs[i];
    if (!b.enabled) continue;
    switch (b.type) {
      case 'agi':
        dAgi += R[i].inModels;
        computeNeedMax += R[i].computeNeed;
        break;
      case 'publisher':
        dSaas += R[i].inModels;
        break;
      case 'coder':
        dDataCoders += R[i].inData;
        break;
      case 'trainer':
        dDataTrainers += R[i].inData;
        dCode += R[i].inCode;
        computeNeedMax += R[i].computeNeed;
        break;
      case 'gpu':
        computeSupply += R[i].computeOut * power;
        break;
      default:
        break;
    }
  }
  // Модели: AGI забирает первым, SaaS — остаток. Данные делят кодеры и кластеры.
  const fAgi = dAgi > EPS ? Math.min(1, S0.models / dAgi) : 0;
  const dData = dDataCoders + dDataTrainers;
  const fData = dData > EPS ? Math.min(1, S0.data / dData) : 1;
  // Лаборатория НИОКР — тоже потребитель кода. Спрос берём по номинальной
  // ставке, а не по остатку: иначе к концу исследования её доля таяла бы
  // вместе с остатком и прогресс «висел» бы на 100%.
  const act = s.research.active;
  const researchDemand = act && power > EPS ? (RESEARCH[act.id].code / RESEARCH[act.id].time) * power : 0;
  const dCodeTotal = dCode + researchDemand;
  const fCode = dCodeTotal > EPS ? Math.min(1, S0.code / dCodeTotal) : 1;

  // --- Вычислительная мощность --------------------------------------------
  // Спрос считаем по реальной загрузке: AGI без моделей или кластер без
  // данных не бронируют PFLOPS у тех, кто может работать. Итоговая загрузка —
  // произведение, чтобы суммарный расход не превысил мощность GPU.
  const pre = new Float64Array(n);
  let computeDemand = 0;
  for (let i = 0; i < n; i++) {
    const b = bs[i];
    if (!b.enabled) continue;
    if (b.type === 'agi') pre[i] = Math.min(power, fAgi);
    else if (b.type === 'trainer') pre[i] = Math.min(power, fData, fCode);
    else continue;
    computeDemand += R[i].computeNeed * pre[i];
  }
  const computeRatio = computeDemand > EPS ? Math.min(1, computeSupply / computeDemand) : 1;

  // --- Продажа моделей ---------------------------------------------------------
  let consAgi = 0;
  for (let i = 0; i < n; i++) {
    if (bs[i].type !== 'agi' || !bs[i].enabled) continue;
    u[i] = pre[i] * computeRatio;
    lim[i] = weakest([
      [power, 'power'],
      [fAgi, 'models'],
      [computeRatio, 'compute'],
    ]);
    consAgi += u[i] * R[i].inModels;
  }
  const leftModels = Math.max(0, S0.models - consAgi);
  const fSaas = dSaas > EPS ? Math.min(1, leftModels / dSaas) : 0;
  let consSaas = 0;
  for (let i = 0; i < n; i++) {
    if (bs[i].type !== 'publisher' || !bs[i].enabled) continue;
    [u[i], lim[i]] = bind([
      [power, 'power'],
      [fSaas, 'models'],
    ]);
    consSaas += u[i] * R[i].inModels;
  }
  const incomeAgi = consAgi * price * BAL.agiMult * mods.agiMult;
  const incomeSaas = consSaas * price;
  const consModels = consAgi + consSaas;

  // --- Кластеры обучения ----------------------------------------------------
  let modelsPre = 0;
  for (let i = 0; i < n; i++) {
    if (bs[i].type !== 'trainer' || !bs[i].enabled) continue;
    u[i] = pre[i] * computeRatio;
    lim[i] = weakest([
      [power, 'power'],
      [computeRatio, 'compute'],
      [fData, 'data'],
      [fCode, 'code'],
    ]);
    modelsPre += u[i] * R[i].outModels;
  }
  const spaceModels = Math.max(0, caps.models - S0.models + consModels);
  const gModels = modelsPre > EPS ? Math.min(1, spaceModels / modelsPre) : 1;
  let consDataT = 0;
  let consCodeT = 0;
  let prodModels = 0;
  for (let i = 0; i < n; i++) {
    if (bs[i].type !== 'trainer' || !bs[i].enabled) continue;
    if (gModels < 1 - EPS && gModels <= u[i]) lim[i] = 'space';
    u[i] *= gModels;
    consDataT += u[i] * R[i].inData;
    consCodeT += u[i] * R[i].inCode;
    prodModels += u[i] * R[i].outModels;
  }

  const researchDraw = act
    ? Math.max(0, Math.min(researchDemand * fCode, RESEARCH[act.id].code - act.paid, S0.code - consCodeT))
    : 0;

  // --- Блоки вайбкодинга ------------------------------------------------------
  let codePre = 0;
  for (let i = 0; i < n; i++) {
    if (bs[i].type !== 'coder' || !bs[i].enabled) continue;
    [u[i], lim[i]] = bind([
      [power, 'power'],
      [fData, 'data'],
    ]);
    codePre += u[i] * R[i].outCode;
  }
  // При включённой автопродаже место на складе не ограничивает выпуск:
  // излишек уходит на биржу, и запас не растёт выше max(текущий, резерв).
  const sellCode = s.autoSell.code && power > EPS;
  const spaceCode = Math.max(0, caps.code - S0.code + consCodeT + researchDraw);
  const gCode = sellCode || codePre <= EPS ? 1 : Math.min(1, spaceCode / codePre);
  let consDataC = 0;
  let prodCode = 0;
  for (let i = 0; i < n; i++) {
    if (bs[i].type !== 'coder' || !bs[i].enabled) continue;
    if (gCode < 1 - EPS && gCode <= u[i]) lim[i] = 'space';
    u[i] *= gCode;
    consDataC += u[i] * R[i].inData;
    prodCode += u[i] * R[i].outCode;
  }

  // --- Генераторы данных -------------------------------------------------------
  let dataPre = 0;
  for (let i = 0; i < n; i++) {
    if (bs[i].type === 'miner' && bs[i].enabled) dataPre += power * R[i].outData;
  }
  const sellData = s.autoSell.data && power > EPS;
  const spaceData = Math.max(0, caps.data - S0.data + consDataT + consDataC);
  const gData = sellData || dataPre <= EPS ? 1 : Math.min(1, spaceData / dataPre);
  for (let i = 0; i < n; i++) {
    if (bs[i].type !== 'miner' || !bs[i].enabled) continue;
    u[i] = power * gData;
    lim[i] = weakest([
      [power, 'power'],
      [gData, 'space'],
    ]);
  }
  const prodData = dataPre * gData;

  // --- Биржевой автомат продаёт только текущие излишки сверх резерва ---------
  // Старые запасы он не трогает: иначе включение автопродажи после накопления
  // склада давало бы разовый всплеск «пассивного» дохода и фальшивый рекорд.
  const data1 = S0.data - consDataT - consDataC + prodData;
  const code1 = S0.code - consCodeT - researchDraw + prodCode;
  const surplusData = Math.max(0, prodData - consDataT - consDataC);
  const surplusCode = Math.max(0, prodCode - consCodeT - researchDraw);
  const soldData = sellData ? Math.min(surplusData, Math.max(0, data1 - caps.data * BAL.autoSellReserve)) : 0;
  const soldCode = sellCode ? Math.min(surplusCode, Math.max(0, code1 - caps.code * BAL.autoSellReserve)) : 0;
  const incomeExchange = soldData * exchangePrice(s, 'data') + soldCode * exchangePrice(s, 'code');

  // Доход, обеспеченный текущим производством: распродажа накопленных моделей
  // приносит деньги, но в рекорд и контракты «$N/с» не засчитывается.
  const modelIncome = incomeAgi + incomeSaas;
  const backed = consModels > EPS ? Math.min(1, prodModels / consModels) : 1;
  const incomeSustained = incomeExchange + modelIncome * backed;

  // --- Остальные здания и статусы ----------------------------------------------
  const b: Record<number, BuildingFlow> = {};
  for (let i = 0; i < n; i++) {
    const bd = bs[i];
    const r = R[i];
    let ui = u[i];
    let li = lim[i];
    if (bd.type === 'reactor') {
      ui = bd.enabled ? 1 : 0;
      li = 'none';
    } else if (bd.type === 'gpu' || bd.type === 'storage') {
      ui = bd.enabled ? power : 0;
      li = power < 1 - EPS ? 'power' : 'none';
    }
    let status: Status;
    if (!bd.enabled) {
      status = 'paused';
      li = 'paused';
      ui = 0;
    } else if (blackout && bd.type !== 'reactor') {
      status = 'nopower';
      li = 'power';
    } else if (ui >= 0.98) {
      status = 'working';
    } else if (ui > 0.005) {
      status = 'partial';
    } else {
      status = li === 'space' ? 'blocked' : 'idle';
    }
    let out = 0;
    switch (bd.type) {
      case 'reactor':
        out = bd.enabled ? r.gen * gridFactor : 0;
        break;
      case 'miner':
        out = ui * r.outData;
        break;
      case 'coder':
        out = ui * r.outCode;
        break;
      case 'trainer':
        out = ui * r.outModels;
        break;
      case 'publisher':
        out = ui * r.inModels * price;
        break;
      case 'agi':
        out = ui * r.inModels * price * BAL.agiMult * mods.agiMult;
        break;
      case 'gpu':
        out = bd.enabled ? r.computeOut * power : 0;
        break;
      case 'storage':
        out = 0;
        break;
    }
    b[bd.id] = { u: ui, status, lim: li, out, eff: r.eff, adj: r.adj, speed: r.speed, pulse: false };
  }

  return {
    gen,
    load,
    power,
    blackout,
    brownout,
    computeSupply,
    computeDemand,
    computeNeedMax,
    computeRatio,
    prod: { data: prodData, code: prodCode, models: prodModels },
    cons: { data: consDataT + consDataC, code: consCodeT + researchDraw, models: consModels },
    sold: { data: soldData, code: soldCode },
    caps,
    income: modelIncome + incomeExchange,
    incomeSustained,
    incomeSaas,
    incomeAgi,
    incomeExchange,
    price,
    researchDraw,
    b,
  };
}

function powerTransition(s: GameState, prev: Flow, f: Flow, notices: Notice[]): void {
  if (f.blackout && !prev.blackout) {
    if (s.tick - s.lastPowerNotice >= 5) {
      notices.push({
        tone: 'bad',
        title: 'ОБЕСТОЧИВАНИЕ',
        text: `Нагрузка ${num(f.load)} МВт > генерации ${num(f.gen)} МВт. Постройте реактор или отключите часть зданий.`,
      });
    }
    pushLog(s, 'alert', `ОБЕСТОЧИВАНИЕ: нагрузка ${num(f.load)} МВт, генерация ${num(f.gen)} МВт`);
    s.lastPowerNotice = s.tick;
  } else if (!f.blackout && prev.blackout && !f.brownout) {
    notices.push({
      tone: 'good',
      title: 'Питание восстановлено',
      text: `Генерация ${num(f.gen)} МВт покрывает нагрузку ${num(f.load)} МВт`,
    });
    pushLog(s, 'info', 'Питание восстановлено, цех снова работает');
  } else if (f.brownout && (!prev.brownout || prev.blackout)) {
    notices.push({
      tone: 'warn',
      title: 'Дефицит мощности',
      text: `Умная энергосеть держит цех на ${pct(f.power)}. Добавьте реакторов.`,
    });
    pushLog(s, 'alert', `Дефицит мощности: цех работает на ${pct(f.power)}`);
  }
}

function updateMarket(s: GameState, notices: Notice[]): void {
  const m = s.market;
  m.index += 0.04 * (1 - m.index) + 0.025 * gauss(s);
  m.index = Math.min(1.35, Math.max(0.7, m.index));

  if (m.event && s.tick >= m.event.endsAt) {
    pushLog(s, 'market', `Событие «${m.event.name}» закончилось`);
    m.event = null;
  }
  if (!m.event && s.tick >= m.nextEventAt) {
    const reactors = countType(s, 'reactor');
    const pool = MARKET_EVENTS.filter(
      (e) => (e.minTick ?? 0) <= s.tick && (e.minReactors ?? 0) <= reactors,
    );
    const total = pool.reduce((a, e) => a + e.weight, 0);
    let r = rand(s) * total;
    let pick = pool[0];
    for (const e of pool) {
      r -= e.weight;
      if (r <= 0) {
        pick = e;
        break;
      }
    }
    m.event = {
      id: pick.id,
      name: pick.name,
      desc: pick.desc,
      kind: pick.kind,
      factor: pick.factor,
      startedAt: s.tick,
      endsAt: s.tick + pick.duration,
    };
    m.nextEventAt = s.tick + pick.duration + randInt(s, 90, 180);
    const good = pick.factor >= 1;
    const effect =
      pick.kind === 'grid'
        ? `Реакторы ×${String(pick.factor).replace('.', ',')} на ${pick.duration} с`
        : `Цены ×${String(pick.factor).replace('.', ',')} на ${pick.duration} с`;
    notices.push({ tone: good ? 'good' : 'warn', title: pick.name, text: `${pick.desc}. ${effect}` });
    pushLog(s, 'market', `${pick.name}: ${effect}`);
  }
}

function checkGoals(s: GameState, notices: Notice[]): void {
  for (const g of GOALS) {
    if (s.goals.includes(g.id)) continue;
    const [cur, target] = g.progress(s);
    if (cur + EPS < target) continue;
    s.goals.push(g.id);
    s.credits += g.reward;
    notices.push({ tone: 'good', title: `Контракт выполнен: ${g.title}`, text: `Награда ${money(g.reward)}` });
    pushLog(s, 'goal', `Контракт «${g.title}» выполнен, награда ${money(g.reward)}`);
  }
}

function autoRefactor(s: GameState): void {
  let count = 0;
  for (const b of s.buildings) {
    if (b.type !== 'coder' || b.debt < BAL.autoRefactorAt) continue;
    const cost = refactorCostOf(b, BAL.autoRefactorDiscount);
    if (s.credits < cost) continue;
    s.credits -= cost;
    b.debt = 0;
    count++;
  }
  if (count > 0) {
    if (s.stats.autoRefactors === 0) {
      pushLog(s, 'info', 'CI/CD-конвейер провёл первый автоматический рефакторинг');
    }
    s.stats.autoRefactors += count;
  }
}

/** Один тик симуляции. Мутирует состояние и возвращает уведомления для игрока. */
export function step(s: GameState): Notice[] {
  const notices: Notice[] = [];
  s.tick += 1;
  updateMarket(s, notices);

  const prev = s.flow;
  const f = computeFlow(s);

  s.res.data = Math.max(0, s.res.data + f.prod.data - f.cons.data - f.sold.data);
  s.res.code = Math.max(0, s.res.code + f.prod.code - f.cons.code - f.sold.code);
  s.res.models = Math.max(0, s.res.models + f.prod.models - f.cons.models);
  s.credits += f.income;

  const st = s.stats;
  st.earned += f.income;
  st.dataMined += f.prod.data;
  st.codeWritten += f.prod.code;
  st.modelsTrained += f.prod.models;
  st.modelsSold += f.cons.models;
  if (f.blackout) st.blackoutTicks += 1;

  const mods = getMods(s);
  for (const b of s.buildings) {
    if (!b.enabled) continue;
    // Пусконаладка: узел засчитывается в рекорд после 30 секунд работы под током.
    if (b.work < BAL.commissionTicks && !f.blackout) {
      b.work += 1;
      if (b.work >= BAL.commissionTicks) st.commissioned += 1;
    }
    const bf = f.b[b.id];
    if (!bf) continue;
    if (b.type === 'coder' && bf.u > 0) {
      b.debt = Math.min(100, b.debt + BAL.debtRate * bf.u * mods.debtMult);
    } else if (b.type === 'trainer') {
      b.acc += bf.out;
      if (b.acc >= 1) {
        b.acc -= Math.floor(b.acc);
        bf.pulse = true;
      }
    }
  }
  if (mods.autoRefactor) autoRefactor(s);

  const act = s.research.active;
  if (act) {
    const def = RESEARCH[act.id];
    act.paid += f.researchDraw;
    if (act.paid >= def.code - 1e-6) {
      s.research.done.push(act.id);
      s.research.active = null;
      notices.push({ tone: 'good', title: `Открыто: ${def.name}`, text: def.effect });
      pushLog(s, 'research', `Исследование «${def.name}» завершено: ${def.effect}`);
    }
  }

  powerTransition(s, prev, f, notices);

  s.incomeHistory.push(f.incomeSustained);
  if (s.incomeHistory.length > BAL.historyLen) s.incomeHistory.shift();
  s.market.history.push(f.price);
  if (s.market.history.length > BAL.historyLen) s.market.history.shift();

  s.flow = f;
  checkGoals(s, notices);
  return notices;
}

/** Прогоняет n тиков подряд (офлайн-прогресс, догонялка фоновой вкладки). */
export function simulate(s: GameState, ticks: number): OfflineSummary {
  const st = s.stats;
  const before = {
    earned: st.earned,
    models: st.modelsTrained,
    code: st.codeWritten,
    data: st.dataMined,
    blackout: st.blackoutTicks,
    research: s.research.done.length,
    goals: s.goals.length,
  };
  const n = Math.max(0, Math.floor(ticks));
  for (let i = 0; i < n; i++) step(s);
  return {
    seconds: n,
    earned: st.earned - before.earned,
    models: st.modelsTrained - before.models,
    code: st.codeWritten - before.code,
    data: st.dataMined - before.data,
    blackoutTicks: st.blackoutTicks - before.blackout,
    research: s.research.done.slice(before.research),
    goals: s.goals.slice(before.goals),
  };
}

// ---------------------------------------------------------------------------
// Действия игрока. Каждое мутирует переданное состояние и пересчитывает потоки,
// чтобы интерфейс сразу показал новую нагрузку сети и загрузку зданий.
// ---------------------------------------------------------------------------

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function finish(s: GameState, notices: Notice[] = []): ActionResult {
  const prev = s.flow;
  s.flow = computeFlow(s);
  powerTransition(s, prev, s.flow, notices);
  return { ok: true, notices };
}

function findBuilding(s: GameState, id: number): Building | undefined {
  return s.buildings.find((b) => b.id === id);
}

export function buildBlocker(s: GameState, type: BuildingType, x: number, y: number): string | null {
  const def = BUILDINGS[type];
  if (def.requires && !hasResearch(s, def.requires)) {
    return `Нужна технология «${RESEARCH[def.requires].name}»`;
  }
  if (!findPlacement(s, type, x, y)) {
    return def.size === 2
      ? 'Нужен свободный блок 2×2 на открытой площадке'
      : 'Ячейка занята или ещё не открыта';
  }
  const cost = buildCost(s, type);
  if (s.credits < cost) return `Не хватает ${money(cost - s.credits)}`;
  return null;
}

export function build(s: GameState, type: BuildingType, x: number, y: number): ActionResult {
  const blocker = buildBlocker(s, type, x, y);
  if (blocker) return fail(blocker);
  const pos = findPlacement(s, type, x, y);
  if (!pos) return fail('Нет места');
  const def = BUILDINGS[type];
  const cost = buildCost(s, type);
  s.credits -= cost;
  const b: Building = {
    id: s.nextId++,
    type,
    x: pos.x,
    y: pos.y,
    level: 1,
    enabled: true,
    debt: 0,
    invested: cost,
    acc: 0,
    work: 0,
  };
  s.buildings.push(b);
  s.stats.built += 1;
  if (type === 'agi' && s.stats.agiBuiltAt === null) s.stats.agiBuiltAt = s.tick;
  pushLog(s, 'build', `${def.name} ${serialOf(b)} построен в ${cellName(pos.x, pos.y)} за ${money(cost)}`);
  return finish(s);
}

export function upgrade(s: GameState, id: number): ActionResult {
  const b = findBuilding(s, id);
  if (!b) return fail('Здание не найдено');
  if (b.level >= BAL.maxLevel) return fail(`Уже максимальный уровень Mk.${roman(BAL.maxLevel)}`);
  const cost = upgradeCost(b);
  if (s.credits < cost) return fail(`Не хватает ${money(cost - s.credits)}`);
  s.credits -= cost;
  b.level += 1;
  b.invested += cost;
  pushLog(s, 'build', `${BUILDINGS[b.type].name} ${serialOf(b)} улучшен до Mk.${roman(b.level)} за ${money(cost)}`);
  return finish(s);
}

export function demolish(s: GameState, id: number): ActionResult {
  const i = s.buildings.findIndex((b) => b.id === id);
  if (i < 0) return fail('Здание не найдено');
  const b = s.buildings[i];
  const refund = refundOf(b);
  s.buildings.splice(i, 1);
  s.credits += refund;
  pushLog(s, 'build', `${BUILDINGS[b.type].name} ${serialOf(b)} демонтирован, возвращено ${money(refund)}`);
  return finish(s, [{ tone: 'info', title: 'Здание демонтировано', text: `Возвращено ${money(refund)}` }]);
}

export function toggle(s: GameState, id: number): ActionResult {
  const b = findBuilding(s, id);
  if (!b) return fail('Здание не найдено');
  b.enabled = !b.enabled;
  pushLog(s, 'build', `${BUILDINGS[b.type].name} ${serialOf(b)} ${b.enabled ? 'включён' : 'остановлен'}`);
  return finish(s);
}

export function move(s: GameState, id: number, x: number, y: number): ActionResult {
  const b = findBuilding(s, id);
  if (!b) return fail('Здание не найдено');
  const pos = findPlacement(s, b.type, x, y, b.id);
  if (!pos) {
    return fail(
      BUILDINGS[b.type].size === 2 ? 'Сюда блок 2×2 не помещается' : 'Ячейка занята или закрыта',
    );
  }
  if (pos.x === b.x && pos.y === b.y) return fail('Здание уже стоит здесь');
  const from = cellName(b.x, b.y);
  b.x = pos.x;
  b.y = pos.y;
  pushLog(s, 'build', `${BUILDINGS[b.type].name} ${serialOf(b)} перенесён ${from} → ${cellName(b.x, b.y)}`);
  return finish(s);
}

export function refactor(s: GameState): ActionResult {
  const cost = refactorCost(s);
  if (cost <= 0) return fail('Техдолга нет — код и так чистый');
  if (s.credits < cost) return fail(`Рефакторинг стоит ${money(cost)}: не хватает ${money(cost - s.credits)}`);
  s.credits -= cost;
  let cleaned = 0;
  for (const b of s.buildings) {
    if (b.type === 'coder' && b.debt > 0) {
      b.debt = 0;
      cleaned++;
    }
  }
  s.stats.refactors += 1;
  pushLog(s, 'info', `ИИ-рефакторинг: очищено блоков — ${cleaned}, потрачено ${money(cost)}`);
  return finish(s, [
    { tone: 'good', title: 'ИИ-рефакторинг завершён', text: `Мусор вычищен из ${cleaned} блоков за ${money(cost)}` },
  ]);
}

export function researchBlocker(s: GameState, id: ResearchId): string | null {
  const def = RESEARCH[id];
  if (hasResearch(s, id)) return 'Уже изучено';
  if (s.research.active) {
    return s.research.active.id === id
      ? 'Уже исследуется'
      : `Лаборатория занята: «${RESEARCH[s.research.active.id].name}»`;
  }
  const missing = def.requires.filter((r) => !hasResearch(s, r));
  if (missing.length) return `Сначала: ${missing.map((r) => RESEARCH[r].name).join(', ')}`;
  if (s.credits < def.cost) return `Не хватает ${money(def.cost - s.credits)}`;
  return null;
}

export function startResearch(s: GameState, id: ResearchId): ActionResult {
  const blocker = researchBlocker(s, id);
  if (blocker) return fail(blocker);
  const def = RESEARCH[id];
  s.credits -= def.cost;
  s.research.active = { id, paid: 0 };
  pushLog(s, 'research', `Запущено исследование «${def.name}» (${money(def.cost)} + ${num(def.code)} KLOC кода)`);
  return finish(s);
}

export function sell(s: GameState, res: SellableRes, fraction: number): ActionResult {
  const amount = s.res[res] * Math.min(1, Math.max(0, fraction));
  if (amount < 1) return fail('На складе почти пусто — продавать нечего');
  const value = amount * exchangePrice(s, res);
  s.res[res] -= amount;
  s.credits += value;
  s.stats.manualSales += value;
  s.stats.earned += value;
  const meta = RES_META[res];
  pushLog(s, 'market', `Продано вручную: ${num(amount)} ${meta.unit} (${meta.name.toLowerCase()}) за ${money(value)}`);
  return finish(s, [{ tone: 'good', title: `Продано ${num(amount)} ${meta.unit}`, text: `+${money(value)}` }]);
}

export function setAutoSell(s: GameState, res: SellableRes, on: boolean): ActionResult {
  s.autoSell[res] = on;
  pushLog(s, 'market', `Автопродажа «${RES_META[res].name}» ${on ? 'включена' : 'выключена'}`);
  return finish(s);
}

