// Проверка баланса: прогон стратегий без UI.
// Запуск: npm run simulate
import * as E from '../src/game/engine.js';
import { MODELS, TASKS } from '../src/game/config.js';

function seeded(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

// 1. Экономика одного агента в каждой связке «задача × модель»
console.log('\n=== Агент: задача × модель (ctx 1200, T 0.4, пустая система) ===');
const base = E.createNewGame();
base.agents = [];
base.servers.t4 = 10;
for (const t of Object.keys(TASKS)) {
  const row = [];
  for (const m of Object.keys(MODELS)) {
    const a = { ...E.createAgent(t, m, []), ctx: 1200, temp: 0.4 };
    const p = E.projectAgent(base, a);
    row.push(`${m}: net ${p.net.toFixed(0).padStart(5)} crit ${(p.critChance * 100).toFixed(1).padStart(4)}% err ${(p.errRate * 100).toFixed(1)}%`);
  }
  console.log(t.padEnd(10), row.join(' | '));
}

console.log('\n=== Влияние температуры (поддержка, микро, ctx 1000) ===');
for (const T of [0, 0.3, 0.6, 0.9, 1.2, 1.5]) {
  const a = { ...E.createAgent('support', 'micro', []), ctx: 1000, temp: T };
  const p = E.projectAgent(base, a);
  console.log(`T=${T.toFixed(1)} выручка ${p.revenue.toFixed(1)} крит ${(p.critChance * 100).toFixed(1)}%/ч, ожид. штраф ${p.expectedPenalty.toFixed(1)}, net ${p.net.toFixed(1)}`);
}
console.log('\n=== Влияние длины промта (копирайтер, balanced, T 0.6) ===');
for (const c of [200, 600, 1200, 2500, 5000, 8000]) {
  const a = { ...E.createAgent('copywriter', 'balanced', []), ctx: c, temp: 0.6 };
  const p = E.projectAgent(base, a);
  console.log(`ctx=${String(c).padStart(4)} задач ${p.tasks.toFixed(0)} токены $${p.tokenCost.toFixed(1)} (промт $${p.ctxCost.toFixed(1)}) крит ${(p.critChance * 100).toFixed(2)}% net ${p.net.toFixed(1)}`);
}

// 2. Прогон партии «разумным игроком»
function play(strategy, hours, seed) {
  const rng = seeded(seed);
  let s = E.createNewGame();
  const records = { maxIncome: 0, maxStreak: 0 };
  let crits = 0;
  const try_ = (next) => { if (next) s = next; return !!next; };
  for (let h = 0; h < hours; h++) {
    strategy(() => s, try_);
    const r = E.tick(s, rng, records);
    s = r.state;
    for (const e of r.events) {
      if (e.type === 'record_income') records.maxIncome = e.value;
      if (e.type === 'record_streak') records.maxStreak = e.value;
      if (e.type === 'crit') crits++;
    }
    if (s.bankrupt) break;
    if (h % 48 === 47) {
      const d = E.computeDerived(s);
      console.log(`  ч${String(h + 1).padStart(4)} $${s.money.toFixed(0).padStart(7)} net/ч ${d.net.toFixed(0).padStart(5)} агентов ${s.agents.length} q ${s.quality.toFixed(0)} долг ${s.debt.toFixed(0)} TF ${d.factors.usage}/${d.factors.cap} техн ${s.techs.length} мод ${E.totalModuleLevels(s)} крит ${crits} авто ${s.autonomyAchieved}`);
    }
  }
  return { s, records };
}

const smart = (g, t) => {
  let s = g();
  const t0 = t; t = (x) => { const ok = t0(x); s = g(); return ok; };
  const d = E.computeDerived(s);
  // рефакторинг при долге > 40
  if (s.debt > 40 && !s.job) t(E.actRefactor(s));
  // ключи и агенты
  if (!E.isModelOwned(s, 'balanced') && s.money > 400) t(E.actBuyKey(s, 'balanced'));
  if (!E.isModelOwned(s, 'reasoning') && s.money > 900 && s.hour > 40) t(E.actBuyKey(s, 'reasoning'));
  const plan = [['support', 'micro'], ['copywriter', 'balanced'], ['code', 'reasoning'], ['sales', 'balanced'], ['code', 'reasoning'], ['data', 'reasoning'], ['copywriter', 'balanced'], ['data', 'reasoning'], ['code', 'reasoning'], ['sales', 'balanced']];
  const next = plan[s.agents.length];
  if (next && E.isModelOwned(s, next[1]) && E.isTaskAvailable(s, next[0]) && s.money > E.agentDeployCost(s) + 200) {
    const load = (d.factors.usage + MODELS[next[1]].compute) / d.factors.cap;
    if (load <= 1) {
      if (t(E.actDeployAgent(s, next[0], next[1]))) {
        const a = s.agents[s.agents.length - 1];
        t(E.actUpdateAgent(s, a.id, { ctx: next[0] === 'support' ? 900 : 1600, temp: next[0] === 'copywriter' ? 0.7 : 0.3 }));
      }
    }
  }
  if (d.factors.load > 0.85) {
    if (E.isServerAvailable(s, 'h100') && s.money > 6000) t(E.actBuyServer(s, 'h100'));
    else if (s.money > 1100) t(E.actBuyServer(s, 'a100'));
    else if (s.money > 300) t(E.actBuyServer(s, 't4'));
  }
  const techOrder = ['prompt_eng', 'crm_integration', 'multi_agent', 'prompt_cache', 'observability', 'ai_linters', 'data_platform', 'adaptive_prompts', 'infra_as_code', 'self_healing', 'h100', 'api_market', 'swarm', 'speculative'];
  for (const id of techOrder) { if (s.techs.includes(id)) continue; const c = { prompt_eng: 350, crm_integration: 600, multi_agent: 800, prompt_cache: 1200, observability: 900, ai_linters: 1000, data_platform: 1500, adaptive_prompts: 1800, infra_as_code: 2000, self_healing: 4000, h100: 3000, api_market: 3000, swarm: 6000, speculative: 5000 }[id]; if (s.money > c * 1.6 + 300) t(E.actResearch(s, id)); break; }
  const modOrder = ['db_cleanup', 'auto_reports', 'guardrails', 'ci_cd', 'monitoring', 'vector_db', 'response_cache', 'temp_autopilot', 'autoscaler', 'auto_refactor', 'api_marketplace', 'db_cleanup', 'auto_reports'];
  if (!s.job && s.debt < 30) for (const id of modOrder) {
    if (E.isModuleAvailable(s, id) && E.moduleLevel(s, id) < 1 || (E.isModuleAvailable(s, id) && ['db_cleanup','auto_reports','api_marketplace'].includes(id) && E.moduleLevel(s,id)<3)) {
      if (s.money > E.moduleBuildCost(s, id) + 300) { t(E.actStartBuild(s, id)); }
      break;
    }
  }
};

const careless = (g, t) => {
  let s = g();
  const t0 = t; t = (x) => { const ok = t0(x); s = g(); return ok; };
  // жадный игрок: микро-модели везде, высокая температура, без рефакторинга
  const plan = [['support', 'micro'], ['copywriter', 'micro'], ['code', 'micro']];
  const next = plan[s.agents.length];
  if (next && s.money > E.agentDeployCost(s) + 50) {
    if (t(E.actDeployAgent(s, next[0], next[1]))) {
      const a = s.agents[s.agents.length - 1];
      t(E.actUpdateAgent(s, a.id, { ctx: 300, temp: 1.2 }));
    }
  }
  if (E.computeDerived(s).factors.load > 1 && s.money > 300) t(E.actBuyServer(s, 't4'));
  if (!s.job && s.money > 200) t(E.actStartBuild(s, 'db_cleanup')) || t(E.actStartBuild(s, 'auto_reports'));
};

for (const [name, strat] of [['Разумный игрок', smart], ['Жадный игрок', careless]]) {
  console.log(`\n=== ${name} ===`);
  const { s, records } = play(strat, 600, 7);
  console.log(`  итог: $${s.money.toFixed(0)}, рекорд дохода $${records.maxIncome.toFixed(0)}/ч, рекорд стабильности ${records.maxStreak} ч, банкрот ${s.bankrupt}`);
}
