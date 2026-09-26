// Игровой движок: чистые функции без React.
// Один вызов tick() = один игровой час. UI и симуляция используют одни и те же
// формулы (computeDerived / projectAgent), поэтому прогноз в редакторе агента
// совпадает с тем, что реально происходит в игре.

import {
  AGENT_NAMES,
  AUTONOMY_GOAL,
  BANKRUPTCY_LIMIT,
  BASE_AGENT_SLOTS,
  BUILD_MODES,
  ECONOMY,
  HISTORY_LIMIT,
  LOG_LIMIT,
  MODELS,
  MODULES,
  SAVE_VERSION,
  SERVERS,
  START_MONEY,
  TASKS,
  TECHS,
} from './config.js';
import { money, signedMoney, stamp } from './format.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ────────────────────────────────────────────────────────────────────────────
// Создание новой партии
// ────────────────────────────────────────────────────────────────────────────

let idCounter = 0;
export function uid(prefix) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function createAgent(taskId, modelId, existing = []) {
  const names = AGENT_NAMES[taskId];
  const sameTask = existing.filter((a) => a.task === taskId).length;
  const base = names[sameTask % names.length];
  return {
    id: uid('agent'),
    name: `${base}-${sameTask + 1}`,
    task: taskId,
    model: modelId,
    ctx: 1000,
    temp: 0.5,
    active: true,
    stats: { tasks: 0, revenue: 0, cost: 0, errors: 0, crits: 0 },
    last: null,
    lastWarnHour: -99,
  };
}

export function createNewGame() {
  const firstAgent = createAgent('support', 'micro', []);
  firstAgent.ctx = 800;
  firstAgent.temp = 0.4;
  const state = {
    version: SAVE_VERSION,
    hour: 0,
    money: START_MONEY,
    agents: [firstAgent],
    servers: { t4: 1, a100: 0, h100: 0, photonic: 0 },
    apiKeys: ['micro'],
    techs: [],
    modules: {},
    job: null,
    buildMode: 'vibe',
    debt: 0,
    quality: 92,
    streak: 0,
    outage: 0,
    lastManualHour: 0,
    history: [],
    logs: [],
    totals: { revenue: 0, cost: 0, tasks: 0, crits: 0, errors: 0 },
    autonomyAchieved: false,
    announcedStreakRecord: false,
    bankrupt: false,
  };
  pushLog(state, 'system', 'VibeOS v4.2 загружена. Кластер: 1× GPU-нода T4 (8 TFLOPS). Баланс ' + money(START_MONEY) + '.');
  pushLog(state, 'system', 'Агент «' + firstAgent.name + '» развёрнут на Микро-модели. Добро пожаловать, вайбкодер.');
  pushLog(state, 'hint', 'Совет: откройте агента в Песочнице и поиграйте со слайдерами — прогноз дохода пересчитывается мгновенно.');
  return state;
}

// ────────────────────────────────────────────────────────────────────────────
// Вспомогательные расчёты
// ────────────────────────────────────────────────────────────────────────────

export function hasTech(state, id) {
  return state.techs.includes(id);
}

export function moduleLevel(state, id) {
  return state.modules[id] || 0;
}

export function agentSlots(state) {
  return BASE_AGENT_SLOTS + (hasTech(state, 'multi_agent') ? 3 : 0) + (hasTech(state, 'swarm') ? 4 : 0);
}

export function agentDeployCost(state) {
  return ECONOMY.agentBaseCost + ECONOMY.agentCostStep * state.agents.length;
}

export function isModelAvailable(state, modelId) {
  const m = MODELS[modelId];
  if (m.requires && !hasTech(state, m.requires)) return false;
  return true;
}

export function isModelOwned(state, modelId) {
  const m = MODELS[modelId];
  if (!isModelAvailable(state, modelId)) return false;
  return m.keyCost === 0 || state.apiKeys.includes(modelId);
}

export function isTaskAvailable(state, taskId) {
  const t = TASKS[taskId];
  return !t.requires || hasTech(state, t.requires);
}

export function isServerAvailable(state, serverId) {
  const s = SERVERS[serverId];
  return !s.requires || hasTech(state, s.requires);
}

export function isModuleAvailable(state, moduleId) {
  const m = MODULES[moduleId];
  return !m.requires || hasTech(state, m.requires);
}

export function moduleBuildCost(state, moduleId, modeId) {
  const m = MODULES[moduleId];
  const lvl = moduleLevel(state, moduleId);
  const mode = BUILD_MODES[modeId || state.buildMode];
  return Math.round(m.cost * Math.pow(1.8, lvl) * mode.cost);
}

export function moduleBuildHours(state, moduleId, modeId) {
  const m = MODULES[moduleId];
  const lvl = moduleLevel(state, moduleId);
  const mode = BUILD_MODES[modeId || state.buildMode];
  return Math.max(1, Math.round(m.hours * (1 + 0.35 * lvl) * mode.time));
}

export function moduleBuildDebt(state, moduleId, modeId) {
  const m = MODULES[moduleId];
  const mode = BUILD_MODES[modeId || state.buildMode];
  const ci = moduleLevel(state, 'ci_cd');
  return m.debt * mode.debt * (1 - 0.15 * ci);
}

export function refactorCost(state) {
  const base = 30 + state.debt * 4;
  return Math.round(base * (hasTech(state, 'ai_linters') ? 0.7 : 1));
}

export function refactorHours(state) {
  return Math.max(2, Math.round(3 + state.debt / 15));
}

export function refactorKeep(state) {
  return hasTech(state, 'ai_linters') ? 0.15 : 0.3;
}

export function capacity(state) {
  let c = 0;
  for (const id of Object.keys(SERVERS)) c += (state.servers[id] || 0) * SERVERS[id].tflops;
  return c;
}

export function serverRent(state) {
  let r = 0;
  for (const id of Object.keys(SERVERS)) r += (state.servers[id] || 0) * SERVERS[id].rent;
  return r;
}

export function moduleCompute(state) {
  let c = 0;
  for (const id of Object.keys(MODULES)) c += moduleLevel(state, id) * MODULES[id].compute;
  return c;
}

export function moduleIncomeBase(state) {
  let v = 0;
  for (const id of Object.keys(MODULES)) v += moduleLevel(state, id) * MODULES[id].income;
  return v;
}

export function totalModuleLevels(state) {
  let v = 0;
  for (const id of Object.keys(MODULES)) v += moduleLevel(state, id);
  return v;
}

export function computeUsage(state) {
  let u = moduleCompute(state);
  for (const a of state.agents) if (a.active) u += MODELS[a.model].compute;
  return u;
}

// Эффекты тех-долга
export function debtEffects(debt) {
  const d = clamp(debt, 0, 100) / 100;
  return {
    speed: 1 - 0.5 * Math.pow(d, 1.3), // до −50% скорости
    tokenCost: 1 + 0.6 * d, // до +60% лишних токенов (ретраи, раздутые промты)
    moduleIncome: 1 - 0.5 * d, // до −50% пассивного дохода модулей
    quality: debt * ECONOMY.qualityDebtWeight, // до −25 пунктов качества
  };
}

// Глобальные множители системы на текущий час
export function systemFactors(state) {
  const cap = capacity(state);
  const usage = computeUsage(state);
  const throttle = usage > cap ? cap / usage : 1;
  const debt = debtEffects(state.debt);
  const refactoring = state.job && state.job.type === 'refactor';
  const outage = state.outage > 0;
  const broke = state.money < 0;
  const speedTech = hasTech(state, 'speculative') ? 1.25 : 1;
  const speedMult = (outage ? 0 : 1) * throttle * debt.speed * speedTech * (refactoring ? 0.9 : 1);
  return {
    cap,
    usage,
    load: cap > 0 ? usage / cap : 1,
    throttle,
    debt,
    refactoring,
    outage,
    broke,
    speedMult,
    cacheFactor: hasTech(state, 'prompt_cache') ? 0.3 : 1,
    promptScale: hasTech(state, 'prompt_eng') ? 1000 : 1600,
    vdb: moduleLevel(state, 'vector_db'),
    tokenDiscount: 1 - 0.1 * moduleLevel(state, 'response_cache'),
    critMult:
      (1 - 0.2 * moduleLevel(state, 'guardrails')) * (moduleLevel(state, 'monitoring') ? 0.9 : 1),
    qualityFactor: 0.4 + 0.6 * (clamp(state.quality, 0, 100) / 100),
  };
}

// Качество системного промта: убывающая отдача от длины контекста
export function promptQuality(ctx, promptScale) {
  return 1 - Math.exp(-ctx / promptScale);
}

// Прогноз работы агента за один час (ожидаемые значения).
// cfg позволяет подставить черновые настройки из редактора, не меняя state.
export function projectAgent(state, agent, cfg, factorsArg) {
  const f = factorsArg || systemFactors(state);
  const a = cfg ? { ...agent, ...cfg } : agent;
  const model = MODELS[a.model];
  const task = TASKS[a.task];
  const running = a.active && !f.broke;

  const tps = model.tps * f.speedMult;
  const tokens = running ? tps * 3600 : 0;
  const taskTokens = task.tokens * (1 - 0.12 * f.vdb);
  const billedCtx = a.ctx * f.cacheFactor;
  const tokensPerTask = taskTokens + billedCtx;
  const tasks = tokens / tokensPerTask;

  const pq = promptQuality(a.ctx, f.promptScale);
  const promptMult = 1.5 - pq; // 1.5 без промта → ~0.5 с длинным промтом
  const tempRisk = 0.5 + 1.5 * a.temp * a.temp; // квадратичный рост риска
  const creativity = 1 + task.creativity * a.temp * ECONOMY.tempCreativity;
  const solve = Math.pow(Math.min(1, model.cap / task.complexity), 1.5);
  // Релевантность: без внятных инструкций модель отвечает «мимо кассы»
  const relevance = 0.55 + 0.45 * pq;

  const hallucRate = model.halluc * tempRisk * promptMult * task.sensitivity * (1 - 0.1 * f.vdb);
  const errRate = clamp(hallucRate + (1 - solve) * ECONOMY.unsolvedErrorRate, 0, 0.9);

  const revenue = tasks * task.value * solve * relevance * creativity * f.qualityFactor * (1 - errRate);
  const tokenCost = (tokens / 1000) * model.price * f.debt.tokenCost * f.tokenDiscount;
  const ctxCost = ((tasks * billedCtx) / 1000) * model.price * f.debt.tokenCost * f.tokenDiscount;
  const errors = tasks * errRate;
  const critLambda =
    errors * ECONOMY.critPerError * task.sensitivity * (0.5 + a.temp) * f.critMult;
  const critChance = 1 - Math.exp(-critLambda);
  const expectedPenalty = critChance * task.critPenalty;

  return {
    running,
    tps: running ? tps : 0,
    tokens,
    tokensPerTask,
    tasks,
    promptQuality: pq,
    relevance,
    tempRisk,
    creativity,
    solve,
    errRate,
    revenue,
    tokenCost,
    ctxCost,
    errors,
    critChance,
    critPenalty: task.critPenalty,
    expectedPenalty,
    net: revenue - tokenCost - expectedPenalty,
    compute: a.active ? model.compute : 0,
  };
}

// Сводка по всей системе: используется панелью метрик и движком
export function computeDerived(state) {
  const f = systemFactors(state);
  const agents = state.agents.map((a) => ({ id: a.id, p: projectAgent(state, a, null, f) }));
  let revenue = 0;
  let tokenCost = 0;
  let tps = 0;
  let weightedErr = 0;
  let weight = 0;
  let expectedPenalty = 0;
  for (const { p } of agents) {
    revenue += p.revenue;
    tokenCost += p.tokenCost;
    tps += p.tps;
    expectedPenalty += p.expectedPenalty;
    if (p.running && p.tasks > 0) {
      // вес агента в общем качестве пропорционален его выручке
      weightedErr += p.errRate * (p.revenue + 1);
      weight += p.revenue + 1;
    }
  }
  const moduleIncome = f.outage ? 0 : moduleIncomeBase(state) * f.debt.moduleIncome;
  const rent = serverRent(state);
  const energy = f.usage * ECONOMY.energyPerTflop;
  const avgErr = weight > 0 ? weightedErr / weight : 0;
  const hasWork = agents.some(({ p }) => p.running && p.tasks > 0);
  const qualityTarget = clamp(
    (hasWork ? 100 * (1 - Math.min(1, avgErr * ECONOMY.qualityErrorWeight)) : 92) - f.debt.quality,
    0,
    100
  );
  const sla = state.quality < ECONOMY.slaThreshold ? revenue * ECONOMY.slaPenaltyShare : 0;
  const net = revenue + moduleIncome - tokenCost - rent - energy - sla - expectedPenalty;
  return {
    factors: f,
    agents,
    revenue,
    moduleIncome,
    tokenCost,
    rent,
    energy,
    sla,
    expectedPenalty,
    tps,
    net,
    avgErr,
    qualityTarget,
  };
}

// Индекс автономности: сколько «ручной работы» система делает сама
export function autonomyChecklist(state, stats) {
  const g = AUTONOMY_GOAL;
  const recentNet = stats ? stats.avgNet24 : averageNet(state, 24);
  const handsOff = state.hour - state.lastManualHour;
  return [
    ...g.modules.map((id) => ({
      id,
      label: MODULES[id].name.replace(/^(Написать|Поднять|Собрать|Внедрить) /, ''),
      done: moduleLevel(state, id) > 0,
      kind: 'module',
    })),
    {
      id: 'guardrails',
      label: 'Guardrails-фильтр ответов',
      done: moduleLevel(state, 'guardrails') >= g.guardrailsLevel,
      kind: 'module',
    },
    {
      id: 'streak',
      label: `${g.minStreak} ч без критических галлюцинаций`,
      done: state.streak >= g.minStreak,
      progress: Math.min(1, state.streak / g.minStreak),
      kind: 'metric',
    },
    {
      id: 'income',
      label: `Средний чистый доход ≥ $${g.minNetIncome}/ч за 24 ч`,
      done: state.history.length >= 24 && recentNet >= g.minNetIncome,
      progress: clamp(recentNet / g.minNetIncome, 0, 1),
      kind: 'metric',
    },
    {
      id: 'handsoff',
      label: `${g.handsOffHours} ч без ручного вмешательства`,
      done: handsOff >= g.handsOffHours,
      progress: Math.min(1, handsOff / g.handsOffHours),
      kind: 'metric',
    },
  ];
}

export function averageNet(state, hours) {
  const slice = state.history.slice(-hours);
  if (!slice.length) return 0;
  return slice.reduce((s, h) => s + h.net, 0) / slice.length;
}

// ────────────────────────────────────────────────────────────────────────────
// Логи
// ────────────────────────────────────────────────────────────────────────────

let logCounter = 0;
export function pushLog(state, level, text, hourOverride) {
  logCounter += 1;
  const hour = hourOverride === undefined ? state.hour : hourOverride;
  state.logs.push({ id: `${hour}_${logCounter}_${Math.random().toString(36).slice(2, 7)}`, hour, level, text });
  if (state.logs.length > LOG_LIMIT) state.logs.splice(0, state.logs.length - LOG_LIMIT);
}

function critAdvice(agent, p) {
  const tips = [];
  if (agent.temp >= 0.8) tips.push(`Снизьте Температуру в промте (сейчас ${agent.temp.toFixed(2)})!`);
  if (p.solve < 0.7) tips.push(`Модель слишком слаба для задачи (решает ${(p.solve * 100).toFixed(0)}%) — возьмите модель умнее.`);
  if (agent.ctx < 700) tips.push(`Системный промт слишком короткий (${agent.ctx} ток.) — добавьте инструкций.`);
  if (!tips.length && agent.temp >= 0.5) tips.push('Снизьте Температуру или добавьте Guardrails-фильтр.');
  if (!tips.length) tips.push('Внедрите Guardrails-фильтр или векторную БД, чтобы модель опиралась на факты.');
  return tips.join(' ');
}

// ────────────────────────────────────────────────────────────────────────────
// Игровой тик
// ────────────────────────────────────────────────────────────────────────────

// Клонирует state (достаточно глубоко для иммутабельного обновления React)
function cloneState(s) {
  return {
    ...s,
    agents: s.agents.map((a) => ({ ...a, stats: { ...a.stats } })),
    servers: { ...s.servers },
    apiKeys: [...s.apiKeys],
    techs: [...s.techs],
    modules: { ...s.modules },
    job: s.job ? { ...s.job } : null,
    history: [...s.history],
    logs: [...s.logs],
    totals: { ...s.totals },
  };
}

// Нормальный шум вокруг 1 (для «живых» чисел в логах)
function jitter(rng, amp) {
  return 1 + (rng() * 2 - 1) * amp;
}

// Один игровой час. Возвращает { state, events }.
// records — текущие рекорды (для генерации событий о побитии).
export function tick(prev, rng = Math.random, records = null) {
  const s = cloneState(prev);
  const events = [];
  if (s.bankrupt) return { state: s, events };

  const d = computeDerived(s);
  const f = d.factors;
  const hourStamp = s.hour; // логируем время начала часа

  // 1. Работа агентов (со случайным шумом и инцидентами)
  let revenue = 0;
  let tokenCost = 0;
  let penalties = 0;
  let critHappened = false;

  s.agents.forEach((agent, idx) => {
    const p = d.agents[idx].p;
    agent.last = null;
    if (!p.running || p.tasks <= 0) return;

    const noise = jitter(rng, 0.08);
    const tasks = p.tasks * noise;
    const rev = p.revenue * noise;
    const cost = p.tokenCost * noise;
    const errors = p.errors * noise;
    revenue += rev;
    tokenCost += cost;

    agent.stats.tasks += tasks;
    agent.stats.revenue += rev;
    agent.stats.cost += cost;
    agent.stats.errors += errors;

    let penalty = 0;
    let crit = false;
    if (rng() < p.critChance) {
      crit = true;
      critHappened = true;
      penalty = TASKS[agent.task].critPenalty * jitter(rng, 0.15);
      penalties += penalty;
      agent.stats.crits += 1;
      s.totals.crits += 1;
      s.quality = clamp(s.quality - ECONOMY.critQualityHit, 0, 100);
      pushLog(
        s,
        'crit',
        `КРИТИЧЕСКАЯ ГАЛЛЮЦИНАЦИЯ! «${agent.name}» ${TASKS[agent.task].critText}. Штраф ${money(-penalty, 0)}. ${critAdvice(agent, p)}`,
        hourStamp
      );
      events.push({ type: 'crit', agentId: agent.id });

      // Автопилот температуры исправляет настройки сам
      if (moduleLevel(s, 'temp_autopilot')) {
        const oldT = agent.temp;
        agent.temp = Math.max(0.1, Math.round((agent.temp - 0.15) * 100) / 100);
        if (agent.ctx < 2500) agent.ctx = Math.min(8000, agent.ctx + 300);
        pushLog(
          s,
          'auto',
          `[autopilot] «${agent.name}»: температура ${oldT.toFixed(2)} → ${agent.temp.toFixed(2)}, промт ${agent.ctx} ток.`,
          hourStamp
        );
      }
    }

    agent.last = { tasks, revenue: rev, cost, errors, crit, penalty };

    // Ротация логов: каждый агент отчитывается раз в 3 часа
    if ((s.hour + idx) % 3 === 0) {
      const t = TASKS[agent.task];
      const lvl = rev - cost >= 0 ? 'income' : 'warn';
      pushLog(
        s,
        lvl,
        `Агент «${agent.name}» обработал ${Math.round(tasks)} ${t.unit}. Доход ${signedMoney(rev, 0)}, токены ${money(-cost, 0)} (${Math.round(p.tokens / 1000)}k ток.)`,
        hourStamp
      );
    } else if (errors >= 1 && rng() < 0.18) {
      const lost = (rev / Math.max(tasks, 1)) * errors;
      pushLog(
        s,
        'warn',
        `Модерация отклонила ${Math.max(1, Math.round(errors))} ответ(ов) «${agent.name}»: мелкие галлюцинации (упущено ~${money(lost, 0)}).`,
        hourStamp
      );
    }

    // Мониторинг предупреждает о высоком риске заранее
    if (moduleLevel(s, 'monitoring') && p.critChance > 0.12 && s.hour - agent.lastWarnHour >= 8) {
      agent.lastWarnHour = s.hour;
      pushLog(
        s,
        'warn',
        `[monitoring] Риск инцидента у «${agent.name}» ${(p.critChance * 100).toFixed(0)}%/ч. ${critAdvice(agent, p)}`,
        hourStamp
      );
    }
  });

  // 2. Пассивный доход модулей и расходы инфраструктуры
  const moduleIncome = d.moduleIncome * (f.outage ? 0 : jitter(rng, 0.05));
  const rent = d.rent;
  const energy = d.energy;
  const sla = s.quality < ECONOMY.slaThreshold ? revenue * ECONOMY.slaPenaltyShare : 0;
  if (sla > 0 && s.hour % 4 === 0) {
    pushLog(s, 'warn', `SLA нарушен: качество ${s.quality.toFixed(0)}%. Клиенты требуют компенсаций ${money(-sla, 0)}/ч.`, hourStamp);
  }
  if (moduleIncome > 0 && s.hour % 6 === 0) {
    pushLog(s, 'income', `Автоматизации (скрипты и сервисы) принесли ${signedMoney(moduleIncome, 0)} за час.`, hourStamp);
  }

  const net = revenue + moduleIncome - tokenCost - rent - energy - sla - penalties;
  s.money += net;
  s.totals.revenue += revenue + moduleIncome;
  s.totals.cost += tokenCost + rent + energy + sla + penalties;
  s.totals.tasks += s.agents.reduce((sum, a) => sum + (a.last ? a.last.tasks : 0), 0);

  // 3. Качество дрейфует к целевому
  s.quality = clamp(s.quality + (d.qualityTarget - s.quality) * ECONOMY.qualityDrift, 0, 100);

  // 4. Стабильность (часы без критических галлюцинаций)
  const anyActive = s.agents.some((a) => a.active);
  if (critHappened) {
    s.streak = 0;
    s.announcedStreakRecord = false;
  } else if (anyActive && !f.outage) {
    s.streak += 1;
  }

  // 5. Тех-долг: пассивный рост
  const ci = moduleLevel(s, 'ci_cd');
  const activeAgents = s.agents.filter((a) => a.active).length;
  const passiveDebt =
    (ECONOMY.debtPerModuleLevel * totalModuleLevels(s) + ECONOMY.debtPerAgent * activeAgents) * (1 - 0.25 * ci);
  s.debt = clamp(s.debt + passiveDebt, 0, 100);

  // 6. Падения прода при огромном долге
  if (s.outage > 0) {
    s.outage -= 1;
    if (s.outage === 0) pushLog(s, 'success', 'Прод поднят. Сервисы снова обрабатывают запросы.', hourStamp);
  } else if (s.debt >= ECONOMY.outageDebtThreshold) {
    const chance = (s.debt - ECONOMY.outageDebtThreshold + 2) * 0.004;
    if (rng() < chance) {
      s.outage = 2 + Math.floor(rng() * 4);
      pushLog(
        s,
        'crit',
        `ПРОД УПАЛ! Спагетти-код не выдержал нагрузки (тех-долг ${s.debt.toFixed(0)}%). Простой ~${s.outage} ч. Срочно запустите Vibe Clean!`,
        hourStamp
      );
      events.push({ type: 'outage' });
    }
  }

  // 7. Перегрузка кластера
  if (f.load > 1 && s.hour % 3 === 0) {
    pushLog(
      s,
      'warn',
      `Перегрузка кластера: ${f.usage} из ${f.cap} TFLOPS. Агенты замедлены до ${(f.throttle * 100).toFixed(0)}%. Докупите серверы или отключите агентов.`,
      hourStamp
    );
  }

  // 8. Работа ИИ-ассистента (генерация кода / рефакторинг)
  if (s.job) {
    s.job.progress += 1;
    if (s.job.progress >= s.job.duration) {
      if (s.job.type === 'build') {
        const m = MODULES[s.job.moduleId];
        s.modules[m.id] = moduleLevel(s, m.id) + 1;
        s.debt = clamp(s.debt + s.job.debt, 0, 100);
        pushLog(
          s,
          'success',
          `ИИ-ассистент закоммитил ${m.file} (ур. ${s.modules[m.id]}). ${m.effect} Тех-долг +${s.job.debt.toFixed(1)}%.`,
          hourStamp
        );
      } else {
        const before = s.debt;
        s.debt = clamp(s.debt * refactorKeep(s), 0, 100);
        pushLog(
          s,
          'success',
          `Vibe Clean завершён: тех-долг ${before.toFixed(0)}% → ${s.debt.toFixed(0)}%. Токены снова расходуются эффективно.`,
          hourStamp
        );
      }
      s.job = null;
    }
  }

  // 9. Автоматизации (автономный режим)
  if (moduleLevel(s, 'auto_refactor') && !s.job && s.debt >= 45) {
    const cost = refactorCost(s);
    if (s.money >= cost + 50) {
      s.money -= cost;
      s.job = { type: 'refactor', progress: 0, duration: refactorHours(s), cost, startedHour: s.hour, auto: true };
      pushLog(s, 'auto', `[self-healing] Тех-долг ${s.debt.toFixed(0)}% — автоматически запущен Vibe Clean (${money(-cost, 0)}).`, hourStamp);
    }
  }
  if (moduleLevel(s, 'autoscaler')) {
    const cap = capacity(s);
    const usage = computeUsage(s);
    if (cap === 0 || usage / cap > 0.92) {
      const options = Object.values(SERVERS)
        .filter((sv) => isServerAvailable(s, sv.id))
        .filter((sv) => s.money >= sv.price * 1.5);
      const deficit = usage - cap * 0.8;
      const pick =
        options.find((sv) => sv.tflops >= deficit) || options[options.length - 1];
      if (pick) {
        s.money -= pick.price;
        s.servers[pick.id] = (s.servers[pick.id] || 0) + 1;
        pushLog(s, 'auto', `[autoscaler] Загрузка ${((usage / Math.max(cap, 1)) * 100).toFixed(0)}% — арендован ${pick.name} (+${pick.tflops} TFLOPS, ${money(-pick.price, 0)}).`, hourStamp);
      }
    }
  }

  // 10. Предупреждения о деньгах
  if (s.money < 0 && prev.money >= 0) {
    pushLog(s, 'crit', 'Баланс ушёл в минус! Провайдеры моделей заблокировали API-ключи — агенты стоят. Продайте серверы или дождитесь дохода автоматизаций.', hourStamp);
  }
  if (s.money < BANKRUPTCY_LIMIT) {
    s.bankrupt = true;
    pushLog(s, 'crit', `БАНКРОТСТВО. Долг ${money(s.money, 0)} превысил лимит кредитной линии.`, hourStamp);
    events.push({ type: 'bankrupt' });
  }

  // 11. История и время
  s.history.push({ hour: hourStamp, revenue: revenue + moduleIncome, cost: tokenCost + rent + energy + sla + penalties, net });
  if (s.history.length > HISTORY_LIMIT) s.history.splice(0, s.history.length - HISTORY_LIMIT);
  s.hour += 1;

  // 12. Рекорды и цель
  if (records) {
    const avg6 = averageNet(s, 6);
    if (s.history.length >= 6 && avg6 > records.maxIncome) {
      events.push({ type: 'record_income', value: avg6 });
    }
    if (s.streak > records.maxStreak) {
      events.push({ type: 'record_streak', value: s.streak, announce: !s.announcedStreakRecord && s.streak >= 12 });
      if (s.streak >= 12) s.announcedStreakRecord = true;
    }
  }
  if (!s.autonomyAchieved) {
    const list = autonomyChecklist(s);
    if (list.every((c) => c.done)) {
      s.autonomyAchieved = true;
      pushLog(s, 'success', 'ПОЛНАЯ АВТОНОМИЯ! Система зарабатывает, чинит и масштабирует себя сама. Вы — архитектор ИИ-будущего.');
      events.push({ type: 'autonomy' });
    }
  }

  return { state: s, events };
}

// ────────────────────────────────────────────────────────────────────────────
// Действия игрока (все возвращают новый state или null, если действие невозможно)
// ────────────────────────────────────────────────────────────────────────────

function manual(s) {
  s.lastManualHour = s.hour;
  return s;
}

export function actDeployAgent(prev, taskId, modelId) {
  if (prev.agents.length >= agentSlots(prev)) return null;
  if (!isTaskAvailable(prev, taskId) || !isModelOwned(prev, modelId)) return null;
  const cost = agentDeployCost(prev);
  if (prev.money < cost) return null;
  const s = cloneState(prev);
  s.money -= cost;
  const agent = createAgent(taskId, modelId, s.agents);
  s.agents.push(agent);
  pushLog(s, 'system', `Развёрнут агент «${agent.name}» (${TASKS[taskId].name}, ${MODELS[modelId].name}). ${money(-cost, 0)}.`);
  return manual(s);
}

export function actUpdateAgent(prev, agentId, patch) {
  const s = cloneState(prev);
  const agent = s.agents.find((a) => a.id === agentId);
  if (!agent) return null;
  if (patch.model && !isModelOwned(s, patch.model)) return null;
  const changes = [];
  if (patch.model && patch.model !== agent.model) changes.push(`модель → ${MODELS[patch.model].name}`);
  if (patch.ctx !== undefined && patch.ctx !== agent.ctx) changes.push(`промт ${agent.ctx} → ${patch.ctx} ток.`);
  if (patch.temp !== undefined && patch.temp !== agent.temp) changes.push(`температура ${agent.temp.toFixed(2)} → ${patch.temp.toFixed(2)}`);
  if (patch.name && patch.name !== agent.name) changes.push(`переименован в «${patch.name}»`);
  Object.assign(agent, patch);
  if (changes.length) pushLog(s, 'system', `Конфиг «${agent.name}» обновлён: ${changes.join(', ')}.`);
  return manual(s);
}

export function actToggleAgent(prev, agentId) {
  const s = cloneState(prev);
  const agent = s.agents.find((a) => a.id === agentId);
  if (!agent) return null;
  agent.active = !agent.active;
  pushLog(s, 'system', `Агент «${agent.name}» ${agent.active ? 'запущен' : 'поставлен на паузу'}.`);
  return manual(s);
}

export function actRemoveAgent(prev, agentId) {
  const s = cloneState(prev);
  const agent = s.agents.find((a) => a.id === agentId);
  if (!agent) return null;
  s.agents = s.agents.filter((a) => a.id !== agentId);
  pushLog(s, 'system', `Агент «${agent.name}» выведен из эксплуатации.`);
  return manual(s);
}

export function actBuyKey(prev, modelId) {
  const m = MODELS[modelId];
  if (!isModelAvailable(prev, modelId) || isModelOwned(prev, modelId)) return null;
  if (prev.money < m.keyCost) return null;
  const s = cloneState(prev);
  s.money -= m.keyCost;
  s.apiKeys.push(modelId);
  pushLog(s, 'system', `Куплен API-ключ: ${m.name} (${m.tag}). ${money(-m.keyCost, 0)}.`);
  return manual(s);
}

export function actBuyServer(prev, serverId) {
  const sv = SERVERS[serverId];
  if (!isServerAvailable(prev, serverId) || prev.money < sv.price) return null;
  const s = cloneState(prev);
  s.money -= sv.price;
  s.servers[serverId] = (s.servers[serverId] || 0) + 1;
  pushLog(s, 'system', `Подключён ${sv.name}: +${sv.tflops} TFLOPS, аренда ${money(sv.rent, 0)}/ч.`);
  return manual(s);
}

export function actSellServer(prev, serverId) {
  const sv = SERVERS[serverId];
  if (!(prev.servers[serverId] > 0)) return null;
  const s = cloneState(prev);
  s.servers[serverId] -= 1;
  const refund = sv.price * ECONOMY.serverRefund;
  s.money += refund;
  pushLog(s, 'system', `Продан ${sv.name}: возврат ${signedMoney(refund, 0)}.`);
  return manual(s);
}

export function actResearch(prev, techId) {
  const t = TECHS[techId];
  if (hasTech(prev, techId)) return null;
  if (t.requires && !hasTech(prev, t.requires)) return null;
  if (prev.money < t.cost) return null;
  const s = cloneState(prev);
  s.money -= t.cost;
  s.techs.push(techId);
  pushLog(s, 'success', `Технология открыта: «${t.name}». ${t.desc}`);
  return manual(s);
}

export function actStartBuild(prev, moduleId) {
  if (prev.job) return null;
  const m = MODULES[moduleId];
  if (!isModuleAvailable(prev, moduleId)) return null;
  if (moduleLevel(prev, moduleId) >= m.maxLevel) return null;
  const cost = moduleBuildCost(prev, moduleId);
  if (prev.money < cost) return null;
  const s = cloneState(prev);
  s.money -= cost;
  s.job = {
    type: 'build',
    moduleId,
    mode: s.buildMode,
    progress: 0,
    duration: moduleBuildHours(prev, moduleId),
    debt: moduleBuildDebt(prev, moduleId),
    cost,
    startedHour: s.hour,
  };
  pushLog(s, 'system', `> vibe "${m.name.toLowerCase()}" --mode=${s.buildMode} — ИИ пишет код (${s.job.duration} ч, ${money(-cost, 0)}).`);
  return manual(s);
}

export function actRefactor(prev) {
  if (prev.job) return null;
  if (prev.debt < 1) return null;
  const cost = refactorCost(prev);
  if (prev.money < cost) return null;
  const s = cloneState(prev);
  s.money -= cost;
  s.job = { type: 'refactor', progress: 0, duration: refactorHours(prev), cost, startedHour: s.hour };
  pushLog(s, 'system', `> vibe clean --deep — ИИ рефакторит кодовую базу (${s.job.duration} ч, ${money(-cost, 0)}).`);
  return manual(s);
}

export function actCancelJob(prev) {
  if (!prev.job) return null;
  const s = cloneState(prev);
  const refund = Math.round(s.job.cost * 0.5 * (1 - s.job.progress / s.job.duration));
  s.money += refund;
  pushLog(s, 'warn', `Задача ИИ-ассистента отменена. Возврат неизрасходованных токенов ${signedMoney(refund, 0)}.`);
  s.job = null;
  return manual(s);
}

export function actSetBuildMode(prev, modeId) {
  const s = cloneState(prev);
  s.buildMode = modeId;
  return s;
}

// Миграция/валидация сохранения
export function hydrate(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== SAVE_VERSION) return null;
  const base = createNewGame();
  const s = { ...base, ...raw };
  s.servers = { ...base.servers, ...(raw.servers || {}) };
  s.totals = { ...base.totals, ...(raw.totals || {}) };
  s.agents = (raw.agents || [])
    .filter((a) => MODELS[a.model] && TASKS[a.task])
    .map((a) => ({ ...createAgent(a.task, a.model, []), ...a, stats: { ...createAgent(a.task, a.model, []).stats, ...(a.stats || {}) } }));
  s.techs = (raw.techs || []).filter((t) => TECHS[t]);
  s.apiKeys = (raw.apiKeys || ['micro']).filter((k) => MODELS[k]);
  s.modules = Object.fromEntries(Object.entries(raw.modules || {}).filter(([k]) => MODULES[k]));
  if (s.job && s.job.type === 'build' && !MODULES[s.job.moduleId]) s.job = null;
  if (!Array.isArray(s.logs)) s.logs = [];
  if (!Array.isArray(s.history)) s.history = [];
  return s;
}
