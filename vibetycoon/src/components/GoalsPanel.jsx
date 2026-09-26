import React from 'react';
import { CircleCheck, Circle, Lightbulb, Target, Trophy } from 'lucide-react';
import { ECONOMY, MODELS, TASKS } from '../game/config.js';
import { autonomyChecklist, averageNet, moduleLevel } from '../game/engine.js';
import { hoursLabel, money, stamp } from '../game/format.js';
import { Bar, Panel, PanelHeader } from './ui.jsx';

// Подсказки наставника на основе текущего состояния системы
function mentorTips(game, derived) {
  const tips = [];
  const f = derived.factors;
  const worst = derived.agents
    .map(({ id, p }) => ({ agent: game.agents.find((a) => a.id === id), p }))
    .filter((x) => x.agent && x.agent.active);

  if (game.money < 0) tips.push('Баланс отрицательный — продайте лишний сервер, пока долг не превысил $400.');
  if (game.outage > 0) tips.push('Прод лежит. После подъёма сразу запустите Vibe Clean.');
  if (f.usage > f.cap) tips.push(`Кластер перегружен (${f.usage}/${f.cap} TFLOPS): каждый агент работает на ${(f.throttle * 100).toFixed(0)}% скорости. Купите сервер.`);
  if (game.debt >= 60) tips.push(`Тех-долг ${game.debt.toFixed(0)}%: токены дороже в ×${f.debt.tokenCost.toFixed(2)}. Пора делать Vibe Clean.`);
  for (const { agent, p } of worst) {
    const task = TASKS[agent.task];
    const model = MODELS[agent.model];
    if (p.solve < 0.6) {
      tips.push(`«${agent.name}»: ${model.tag} решает лишь ${(p.solve * 100).toFixed(0)}% задач «${task.short}». Нужна модель умнее.`);
    } else if (p.critChance > 0.12) {
      tips.push(`«${agent.name}»: риск инцидента ${(p.critChance * 100).toFixed(0)}%/ч. Снизьте температуру (${agent.temp.toFixed(2)}) или удлините промт.`);
    } else if (p.net < 0 && p.running) {
      tips.push(`«${agent.name}» убыточен (${money(p.net, 0)}/ч): ${model.price >= 0.15 && task.value < 1 ? 'дорогая модель для дешёвой задачи — попробуйте Fast LLM' : 'проверьте длину промта — он отправляется с каждой задачей'}.`);
    } else if (agent.ctx >= 4000 && p.ctxCost > p.tokenCost * 0.5) {
      tips.push(`«${agent.name}»: ${((p.ctxCost / Math.max(p.tokenCost, 0.01)) * 100).toFixed(0)}% токенов уходит на системный промт. Сократите его или откройте кэширование промтов.`);
    }
  }
  if (game.quality < ECONOMY.slaThreshold + 10) tips.push(`Качество ${game.quality.toFixed(0)}% — близко к порогу SLA (${ECONOMY.slaThreshold}%). Слабые модели и галлюцинации тянут всю систему вниз.`);
  if (!moduleLevel(game, 'guardrails') && game.hour > 60 && game.money > 900) tips.push('Guardrails-фильтр режет шанс критических галлюцинаций на 20% за уровень.');
  if (!tips.length) {
    if (game.agents.length < 2) tips.push('Один агент — это ещё не бизнес. Создайте второго: копирайтер хорошо работает на сбалансированной модели с температурой ~0.7.');
    else tips.push('Система стабильна. Инвестируйте в технологии автономии: мониторинг, автопилот, автоскейлер и авто-рефакторинг.');
  }
  return tips.slice(0, 3);
}

export default function GoalsPanel({ game, derived, records }) {
  const checklist = autonomyChecklist(game);
  const done = checklist.filter((c) => c.done).length;
  const tips = mentorTips(game, derived);
  const avg24 = averageNet(game, 24);

  return (
    <Panel accent="amber" className="flex flex-col">
      <PanelHeader icon={Target} title="Цель: полностью автономная система" accent="amber" right={<span className="text-xs tabular-nums text-slate-400">{done}/{checklist.length}</span>} />
      <div className="space-y-3 p-3 sm:p-4">
        <Bar value={done / checklist.length} tone={game.autonomyAchieved ? 'emerald' : 'amber'} height="h-2" />
        {game.autonomyAchieved && (
          <div className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
            ✔ Автономия достигнута. Продолжайте бить рекорды — система работает сама.
          </div>
        )}
        <ul className="space-y-1.5 text-xs">
          {checklist.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              {c.done ? (
                <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" aria-label="выполнено" />
              ) : (
                <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" aria-label="не выполнено" />
              )}
              <div className="min-w-0 flex-1">
                <span className={c.done ? 'text-slate-300' : 'text-slate-400'}>{c.label}</span>
                {c.kind === 'metric' && !c.done && <Bar value={c.progress} tone="amber" height="h-1" className="mt-1" />}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[10px] leading-snug text-slate-500">
          Средний доход за 24 ч: {money(avg24, 0)}/ч. Ручным вмешательством считается любое действие, кроме смены скорости.
        </p>

        <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
            <Trophy className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" /> Рекорды (localStorage)
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-slate-500">Макс. пассивный доход</div>
              <div className="font-semibold tabular-nums text-amber-200">{money(records.maxIncome, 0)}/ч</div>
              {records.maxIncomeAt !== null && <div className="text-[10px] text-slate-600">{stamp(records.maxIncomeAt)}</div>}
            </div>
            <div>
              <div className="text-slate-500">Самая стабильная система</div>
              <div className="font-semibold tabular-nums text-violet-200">{hoursLabel(records.maxStreak)}</div>
              <div className="text-[10px] text-slate-600">без галлюцинаций</div>
            </div>
            <div>
              <div className="text-slate-500">Автономий достигнуто</div>
              <div className="font-semibold tabular-nums text-emerald-200">{records.autonomyWins}</div>
            </div>
            <div>
              <div className="text-slate-500">Быстрейшая автономия</div>
              <div className="font-semibold tabular-nums text-cyan-200">{records.fastestAutonomy !== null ? hoursLabel(records.fastestAutonomy) : '—'}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-sky-400/25 bg-sky-400/5 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-sky-300">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> ИИ-наставник
          </div>
          <ul className="space-y-1.5 text-[11px] leading-snug text-slate-300">
            {tips.map((t) => (
              <li key={t} className="flex gap-1.5">
                <span className="text-sky-400">›</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
