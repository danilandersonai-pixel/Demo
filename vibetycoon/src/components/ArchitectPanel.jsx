import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bot,
  Check,
  Cpu,
  FlaskConical,
  KeyRound,
  Lock,
  Pause,
  Play,
  Plus,
  Server,
  Settings2,
  Trash2,
  Workflow,
} from 'lucide-react';
import { MODELS, SERVERS, TASKS, TECHS, ECONOMY } from '../game/config.js';
import {
  agentDeployCost,
  agentSlots,
  capacity,
  hasTech,
  isModelOwned,
  isModelAvailable,
  isServerAvailable,
  isTaskAvailable,
  projectAgent,
} from '../game/engine.js';
import { money, num, signedMoney } from '../game/format.js';
import AgentEditor from './AgentEditor.jsx';
import DataFlow from './DataFlow.jsx';
import { Bar, Button, Panel, PanelHeader, Stat, Tag } from './ui.jsx';

const MODEL_TAG_TONE = { cyan: 'cyan', sky: 'sky', violet: 'violet', emerald: 'emerald' };

function riskTone(c) {
  if (c < 0.03) return 'text-emerald-300';
  if (c < 0.1) return 'text-amber-300';
  return 'text-rose-300';
}

function AgentCard({ game, agent, projection, critFlash, actions }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const model = MODELS[agent.model];
  const task = TASKS[agent.task];
  const p = projection;
  const last = agent.last;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className={`rounded-xl border p-3 transition-colors ${
        critFlash ? 'border-rose-500/70 bg-rose-500/10' : agent.active ? 'border-slate-700/70 bg-slate-950/40 hover:border-cyan-400/40' : 'border-slate-800 bg-slate-950/20 opacity-70'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bot className={`h-4 w-4 shrink-0 ${agent.active ? 'text-cyan-300' : 'text-slate-500'}`} aria-hidden="true" />
            <h3 className="truncate text-sm font-semibold text-slate-100">{agent.name}</h3>
            {!agent.active && <Tag>пауза</Tag>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Tag tone="slate">{task.name}</Tag>
            <Tag tone={MODEL_TAG_TONE[model.color]}>{model.tag}</Tag>
            <Tag tone="violet">промт {num(agent.ctx)}</Tag>
            <Tag tone={agent.temp > 1 ? 'rose' : agent.temp > 0.7 ? 'amber' : 'cyan'}>T {agent.temp.toFixed(2)}</Tag>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" tone={open ? 'violet' : 'ghost'} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Настроить
          </Button>
          <Button size="sm" tone="ghost" onClick={() => actions.toggle(agent.id)} aria-label={agent.active ? 'Пауза' : 'Запустить'} title={agent.active ? 'Поставить на паузу' : 'Запустить'}>
            {agent.active ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
          </Button>
          {confirmDelete ? (
            <Button size="sm" tone="rose" onClick={() => actions.remove(agent.id)} onBlur={() => setConfirmDelete(false)}>
              Удалить?
            </Button>
          ) : (
            <Button size="sm" tone="ghost" onClick={() => setConfirmDelete(true)} aria-label="Удалить агента" title="Удалить агента">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3">
        <DataFlow tps={p.tps} errRate={p.errRate} running={p.running && p.tps > 0} modelColor={model.color} crit={critFlash} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="TPS" value={num(p.tps, 0)} tone="text-cyan-200" />
        <Stat label={`${task.unit}/ч`} value={num(last ? last.tasks : p.tasks, 0)} />
        <Stat label="выручка/ч" value={money(last ? last.revenue : p.revenue, 0)} tone="text-emerald-300" />
        <Stat label="токены/ч" value={money(-(last ? last.cost : p.tokenCost), 0)} tone="text-rose-300" />
        <Stat label="ошибки" value={`${(p.errRate * 100).toFixed(1)}%`} tone={p.errRate > 0.05 ? 'text-rose-300' : 'text-slate-200'} sub={`решает ${(p.solve * 100).toFixed(0)}%`} />
        <Stat label="риск инцидента" value={`${(p.critChance * 100).toFixed(1)}%/ч`} tone={riskTone(p.critChance)} sub={`штраф ${money(task.critPenalty, 0)}`} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-slate-500">
          всего: {num(agent.stats.tasks, 0)} {task.unit}, инцидентов {agent.stats.crits}
        </span>
        <span className={`font-semibold tabular-nums ${p.net >= 0 ? 'text-amber-300' : 'text-rose-300'}`}>
          {signedMoney(p.net, 0)}/ч чистыми
        </span>
      </div>

      <AnimatePresence>
        {open && (
          <AgentEditor
            game={game}
            agent={agent}
            onBuyKey={actions.buyKey}
            onClose={() => setOpen(false)}
            onApply={(draft) => {
              actions.update(agent.id, draft);
              setOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function NewAgentForm({ game, onDeploy, onBuyKey, onCancel }) {
  const [taskId, setTaskId] = useState('support');
  const [modelId, setModelId] = useState('micro');
  const cost = agentDeployCost(game);
  const preview = projectAgent(game, { task: taskId, model: modelId, ctx: 1000, temp: 0.5, active: true });
  const owned = isModelOwned(game, modelId);
  const load = capacity(game) > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-xl border border-dashed border-cyan-400/40 bg-cyan-400/5 p-3"
    >
      <div className="mb-2 text-xs font-semibold text-cyan-200">Новый агент — выберите бизнес-задачу и модель</div>
      <div className="grid gap-3 md:grid-cols-2">
        <fieldset>
          <legend className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">Задача</legend>
          <div className="grid gap-1.5">
            {Object.values(TASKS).map((t) => {
              const ok = isTaskAvailable(game, t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={!ok}
                  onClick={() => setTaskId(t.id)}
                  aria-pressed={taskId === t.id}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    taskId === t.id ? 'border-cyan-400/70 bg-cyan-400/10 text-cyan-100' : 'border-slate-700/70 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <span>{t.name}</span>
                  <span className="text-[10px] text-slate-500">
                    {ok ? `$${t.value}/задача · сложн. ${t.complexity}` : (
                      <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" aria-hidden="true" />{TECHS[t.requires].name}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">Модель</legend>
          <div className="grid gap-1.5">
            {Object.values(MODELS).map((m) => {
              const avail = isModelAvailable(game, m.id);
              const has = isModelOwned(game, m.id);
              return (
                <div key={m.id} className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={!avail}
                    onClick={() => setModelId(m.id)}
                    aria-pressed={modelId === m.id}
                    className={`flex flex-1 items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      modelId === m.id ? 'border-cyan-400/70 bg-cyan-400/10 text-cyan-100' : 'border-slate-700/70 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <span>
                      {m.name} <span className="text-slate-500">({m.tag})</span>
                    </span>
                    <span className="text-[10px] text-slate-500">{avail ? (has ? `$${m.price}/1k` : 'нет ключа') : <Lock className="h-3 w-3" aria-hidden="true" />}</span>
                  </button>
                  {avail && !has && (
                    <Button tone="amber" size="sm" disabled={game.money < m.keyCost} onClick={() => onBuyKey(m.id)} title={`Купить API-ключ за ${money(m.keyCost, 0)}`}>
                      <KeyRound className="h-3 w-3" aria-hidden="true" />{money(m.keyCost, 0)}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-500">{MODELS[modelId].blurb}</p>
        </fieldset>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950/50 px-3 py-2 text-[11px]">
        <span className="text-slate-400">
          Прогноз (промт 1000, T 0.5): <span className={preview.net >= 0 ? 'text-amber-300' : 'text-rose-300'}>{signedMoney(preview.net, 0)}/ч</span>, риск{' '}
          <span className={riskTone(preview.critChance)}>{(preview.critChance * 100).toFixed(1)}%/ч</span>, +{MODELS[modelId].compute} TFLOPS
        </span>
        <div className="flex gap-2">
          <Button tone="ghost" size="sm" onClick={onCancel}>Отмена</Button>
          <Button
            tone="cyan"
            size="sm"
            disabled={!owned || !isTaskAvailable(game, taskId) || game.money < cost || !load}
            onClick={() => onDeploy(taskId, modelId)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Развернуть за {money(cost, 0)}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function AgentsTab({ game, derived, critFlash, actions }) {
  const [adding, setAdding] = useState(false);
  const slots = agentSlots(game);
  const full = game.agents.length >= slots;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          Слоты агентов: <span className="font-semibold text-slate-200">{game.agents.length} / {slots}</span>
          {full && <span className="text-slate-500"> — больше слотов дают технологии оркестрации</span>}
        </p>
        <Button tone="cyan" size="sm" disabled={full} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Создать агента
        </Button>
      </div>
      <AnimatePresence>
        {adding && !full && (
          <NewAgentForm
            game={game}
            onBuyKey={actions.buyKey}
            onCancel={() => setAdding(false)}
            onDeploy={(t, m) => {
              if (actions.deploy(t, m)) setAdding(false);
            }}
          />
        )}
      </AnimatePresence>
      {game.agents.length === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-xs text-slate-500">
          Агентов нет. Нажмите «Создать агента», чтобы собрать первый конвейер.
        </div>
      )}
      <motion.div layout className="grid gap-3">
        <AnimatePresence>
          {game.agents.map((a, i) => (
            <AgentCard key={a.id} game={game} agent={a} projection={derived.agents[i].p} critFlash={critFlash[a.id]} actions={actions} />
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function InfraTab({ game, derived, actions }) {
  const f = derived.factors;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-slate-400">Загрузка кластера</span>
          <span className="tabular-nums text-slate-200">
            {f.usage} / {f.cap} TFLOPS
          </span>
        </div>
        <Bar value={f.cap ? f.usage / f.cap : 1} tone={f.usage > f.cap ? 'rose' : f.usage / Math.max(1, f.cap) > 0.85 ? 'amber' : 'cyan'} height="h-2" />
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          Каждая модель занимает TFLOPS, модули кода — тоже. При перегрузке все агенты замедляются пропорционально. Энергия: {money(ECONOMY.energyPerTflop, 2)} за TFLOPS в час от фактической загрузки.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.values(SERVERS).map((sv) => {
          const avail = isServerAvailable(game, sv.id);
          const count = game.servers[sv.id] || 0;
          return (
            <div key={sv.id} className={`rounded-xl border p-3 ${avail ? 'border-slate-700/70 bg-slate-950/40' : 'border-slate-800 bg-slate-950/20 opacity-60'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  <span className="text-sm font-semibold text-slate-100">{sv.name}</span>
                </div>
                <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-xs tabular-nums text-slate-200">×{count}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Stat label="мощность" value={`${sv.tflops} TF`} tone="text-cyan-200" />
                <Stat label="аренда" value={`${money(sv.rent, 0)}/ч`} tone="text-rose-300" />
                <Stat label="$/TF·ч" value={(sv.rent / sv.tflops).toFixed(2)} />
              </div>
              {avail ? (
                <div className="mt-2 flex gap-2">
                  <Button tone="amber" size="sm" className="flex-1" disabled={game.money < sv.price} onClick={() => actions.buyServer(sv.id)}>
                    Купить {money(sv.price, 0)}
                  </Button>
                  <Button tone="ghost" size="sm" disabled={count === 0} onClick={() => actions.sellServer(sv.id)} title={`Вернуть ${money(sv.price * ECONOMY.serverRefund, 0)}`}>
                    Продать
                  </Button>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-500">
                  <Lock className="h-3 w-3" aria-hidden="true" /> Технология «{TECHS[sv.requires].name}»
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">API-ключи моделей</div>
        <div className="grid gap-1.5">
          {Object.values(MODELS).map((m) => {
            const avail = isModelAvailable(game, m.id);
            const has = isModelOwned(game, m.id);
            return (
              <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                <span className={avail ? 'text-slate-300' : 'text-slate-600'}>
                  {m.name} <span className="text-slate-500">({m.tag})</span>
                </span>
                {has ? (
                  <span className="inline-flex items-center gap-1 text-emerald-300"><Check className="h-3.5 w-3.5" aria-hidden="true" /> активен</span>
                ) : avail ? (
                  <Button tone="amber" size="sm" disabled={game.money < m.keyCost} onClick={() => actions.buyKey(m.id)}>
                    <KeyRound className="h-3 w-3" aria-hidden="true" /> {money(m.keyCost, 0)}
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-slate-600"><Lock className="h-3 w-3" aria-hidden="true" /> {TECHS[m.requires].name}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TechTab({ game, actions }) {
  const list = Object.values(TECHS).sort((a, b) => a.cost - b.cost);
  const done = game.techs.length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">
          Открыто технологий: <span className="font-semibold text-slate-200">{done} / {list.length}</span>
        </span>
        <Bar value={done / list.length} tone="violet" className="max-w-[160px]" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((t) => {
          const owned = hasTech(game, t.id);
          const locked = t.requires && !hasTech(game, t.requires);
          return (
            <div
              key={t.id}
              className={`flex flex-col rounded-xl border p-3 ${
                owned ? 'border-emerald-400/30 bg-emerald-400/5' : locked ? 'border-slate-800 bg-slate-950/20 opacity-60' : 'border-violet-400/25 bg-slate-950/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold text-slate-100">{t.name}</span>
                {owned ? <Check className="h-4 w-4 shrink-0 text-emerald-300" aria-label="открыто" /> : <FlaskConical className="h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />}
              </div>
              <p className="mt-1 flex-1 text-[11px] leading-snug text-slate-400">{t.desc}</p>
              {!owned && (
                <div className="mt-2">
                  {locked ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                      <Lock className="h-3 w-3" aria-hidden="true" /> сначала «{TECHS[t.requires].name}»
                    </span>
                  ) : (
                    <Button tone="violet" size="sm" className="w-full" disabled={game.money < t.cost} onClick={() => actions.research(t.id)}>
                      Исследовать {money(t.cost, 0)}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TABS = [
  { id: 'agents', label: 'Агенты', icon: Bot },
  { id: 'infra', label: 'Инфраструктура', icon: Cpu },
  { id: 'tech', label: 'Технологии', icon: FlaskConical },
];

export default function ArchitectPanel({ game, derived, critFlash, actions }) {
  const [tab, setTab] = useState('agents');
  return (
    <Panel accent="cyan" className="flex flex-col">
      <PanelHeader
        icon={Workflow}
        title="Песочница Архитектора ИИ"
        file="pipelines.yaml"
        accent="cyan"
        right={
          <div role="tablist" aria-label="Разделы песочницы" className="flex rounded-lg border border-slate-700/60 bg-slate-950/50 p-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                  tab === t.id ? 'text-cyan-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab === t.id && <motion.span layoutId="arch-tab" className="absolute inset-0 rounded-md bg-cyan-400/15" transition={{ type: 'spring', duration: 0.4 }} />}
                <t.icon className="relative h-3.5 w-3.5" aria-hidden="true" />
                <span className="relative hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>
        }
      />
      <div className="ide-scroll flex-1 overflow-y-auto p-3 sm:p-4 lg:max-h-[860px]">
        {tab === 'agents' && <AgentsTab game={game} derived={derived} critFlash={critFlash} actions={actions} />}
        {tab === 'infra' && <InfraTab game={game} derived={derived} actions={actions} />}
        {tab === 'tech' && <TechTab game={game} actions={actions} />}
      </div>
    </Panel>
  );
}
