import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, Check, KeyRound, Lock, Thermometer, FileText, X } from 'lucide-react';
import { MODELS, TASKS } from '../game/config.js';
import { isModelAvailable, isModelOwned, projectAgent } from '../game/engine.js';
import { money, num, signedMoney } from '../game/format.js';
import { Button, Slider, Tag } from './ui.jsx';

function tempLabel(t) {
  if (t <= 0.2) return 'детерминированно';
  if (t <= 0.5) return 'сдержанно';
  if (t <= 0.8) return 'креативно';
  if (t <= 1.1) return 'смело';
  return 'хаос';
}

// Строка сравнения «было → станет»
function Delta({ label, before, after, fmt, goodWhenHigher = true, hint }) {
  const diff = after - before;
  const same = Math.abs(diff) < 1e-6 || Math.abs(diff / (Math.abs(before) + 1e-9)) < 0.005;
  const good = goodWhenHigher ? diff > 0 : diff < 0;
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5" title={hint}>
      <span className="text-slate-500">{label}</span>
      <span className="tabular-nums">
        {!same && <span className="text-slate-600 line-through decoration-slate-600/70">{fmt(before)}</span>}
        <span className={`ml-1.5 font-semibold ${same ? 'text-slate-200' : good ? 'text-emerald-300' : 'text-rose-300'}`}>{fmt(after)}</span>
      </span>
    </div>
  );
}

export default function AgentEditor({ game, agent, onApply, onClose, onBuyKey }) {
  const [draft, setDraft] = useState({ model: agent.model, ctx: agent.ctx, temp: agent.temp, name: agent.name });
  const task = TASKS[agent.task];

  const before = useMemo(() => projectAgent(game, { ...agent, active: true }), [game, agent]);
  const after = useMemo(() => projectAgent(game, { ...agent, active: true }, draft), [game, agent, draft]);
  const changed = draft.model !== agent.model || draft.ctx !== agent.ctx || draft.temp !== agent.temp || draft.name !== agent.name;

  const pctFmt = (v) => `${(v * 100).toFixed(1)}%`;
  const moneyFmt = (v) => money(v, 0);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="mt-3 grid gap-4 border-t border-slate-700/50 pt-3 lg:grid-cols-[1fr_260px]">
        <div className="space-y-4">
          <div>
            <label htmlFor={`name-${agent.id}`} className="mb-1 block text-xs text-slate-400">Имя агента</label>
            <input
              id={`name-${agent.id}`}
              value={draft.name}
              maxLength={24}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-400/60"
            />
          </div>

          <fieldset>
            <legend className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-400">
              <Brain className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" /> Модель
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.values(MODELS).map((m) => {
                const available = isModelAvailable(game, m.id);
                const owned = isModelOwned(game, m.id);
                const selected = draft.model === m.id;
                const p = projectAgent(game, { ...agent, active: true }, { ...draft, model: m.id });
                return (
                  <div
                    key={m.id}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      selected ? 'border-cyan-400/70 bg-cyan-400/10' : 'border-slate-700/70 bg-slate-950/40'
                    } ${!available ? 'opacity-50' : ''}`}
                  >
                    <button
                      type="button"
                      disabled={!owned}
                      onClick={() => setDraft({ ...draft, model: m.id })}
                      className="w-full text-left disabled:cursor-not-allowed"
                      aria-pressed={selected}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-slate-100">{m.name}</span>
                        <Tag tone={m.color === 'emerald' ? 'emerald' : m.color === 'violet' ? 'violet' : m.color === 'sky' ? 'sky' : 'cyan'}>{m.tag}</Tag>
                      </div>
                      <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] text-slate-400">
                        <span title="Цена за 1k токенов">${m.price}/1k</span>
                        <span title="Токенов в секунду">{m.tps} TPS</span>
                        <span title="Нагрузка на кластер">{m.compute} TF</span>
                        <span title="Базовый шанс галлюцинации на задачу">галл. {(m.halluc * 100).toFixed(2)}%</span>
                        <span title="Доля задач, которые модель способна решить" className="col-span-2">
                          решает {(p.solve * 100).toFixed(0)}% задач
                        </span>
                      </div>
                    </button>
                    {available && !owned && (
                      <Button tone="amber" size="sm" className="mt-2 w-full" disabled={game.money < m.keyCost} onClick={() => onBuyKey(m.id)}>
                        <KeyRound className="h-3 w-3" aria-hidden="true" /> API-ключ {money(m.keyCost, 0)}
                      </Button>
                    )}
                    {!available && (
                      <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
                        <Lock className="h-3 w-3" aria-hidden="true" /> нужна технология
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <div className="rounded-xl border border-violet-400/25 bg-violet-500/5 p-3">
            <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-violet-200">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Конструктор промта
            </div>
            <div className="space-y-4">
              <Slider
                id={`ctx-${agent.id}`}
                label="Длина контекста (System Prompt)"
                value={draft.ctx}
                min={100}
                max={8000}
                step={100}
                thumb="#a855f7"
                onChange={(v) => setDraft({ ...draft, ctx: v })}
                format={(v) => `${num(v)} ток.`}
                hint={`Промт отправляется с КАЖДОЙ задачей: +${num(after.tokensPerTask - TASKS[agent.task].tokens)} ток. к ${num(TASKS[agent.task].tokens)} на задачу. Качество инструкций ${(after.promptQuality * 100).toFixed(0)}%, релевантность ответов ${(after.relevance * 100).toFixed(0)}%.`}
              />
              <Slider
                id={`temp-${agent.id}`}
                label={
                  <span className="inline-flex items-center gap-1">
                    <Thermometer className="h-3.5 w-3.5 text-rose-300" aria-hidden="true" /> Температура (Temperature)
                  </span>
                }
                value={draft.temp}
                min={0}
                max={1.5}
                step={0.05}
                thumb={draft.temp > 1 ? '#fb7185' : draft.temp > 0.7 ? '#f59e0b' : '#22d3ee'}
                onChange={(v) => setDraft({ ...draft, temp: Math.round(v * 100) / 100 })}
                format={(v) => `${v.toFixed(2)} · ${tempLabel(v)}`}
                hint={`Уникальность ответов ×${after.creativity.toFixed(2)} (для «${task.short}» креативность важна на ${(task.creativity * 100).toFixed(0)}%), риск ошибок ×${after.tempRisk.toFixed(2)}.`}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col rounded-xl border border-slate-700/60 bg-slate-950/50 p-3 text-xs">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Прогноз на 1 час</div>
          <Delta label={`Задач (${task.unit})`} before={before.tasks} after={after.tasks} fmt={(v) => num(v, 0)} />
          <Delta label="Токенов на задачу" before={before.tokensPerTask} after={after.tokensPerTask} fmt={(v) => num(v, 0)} goodWhenHigher={false} />
          <Delta label="Выручка" before={before.revenue} after={after.revenue} fmt={moneyFmt} />
          <Delta label="Затраты на токены" before={before.tokenCost} after={after.tokenCost} fmt={moneyFmt} goodWhenHigher={false} hint="Включая стоимость системного промта" />
          <Delta label="  из них промт" before={before.ctxCost} after={after.ctxCost} fmt={moneyFmt} goodWhenHigher={false} />
          <Delta label="Доля ошибок" before={before.errRate} after={after.errRate} fmt={pctFmt} goodWhenHigher={false} />
          <Delta label="Шанс крит. инцидента" before={before.critChance} after={after.critChance} fmt={pctFmt} goodWhenHigher={false} hint={`Штраф за инцидент ~${money(task.critPenalty, 0)}`} />
          <Delta label="Нагрузка, TFLOPS" before={MODELS[agent.model].compute} after={MODELS[draft.model].compute} fmt={(v) => num(v, 0)} goodWhenHigher={false} />
          <div className="my-2 border-t border-slate-700/60" />
          <Delta label="Чистыми (с учётом риска)" before={before.net} after={after.net} fmt={(v) => signedMoney(v, 0)} />
          <p className="mt-2 text-[10px] leading-snug text-slate-500">
            Прогноз учитывает текущие качество, тех-долг, загрузку кластера и открытые технологии.
          </p>
          <div className="mt-auto flex gap-2 pt-3">
            <Button tone="cyan" className="flex-1" disabled={!changed} onClick={() => onApply({ ...draft, name: draft.name.trim() || agent.name })}>
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> Применить
            </Button>
            <Button tone="ghost" onClick={onClose} aria-label="Закрыть редактор">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
