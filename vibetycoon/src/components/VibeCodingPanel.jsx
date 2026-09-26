import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, CodeXml, Eraser, Hammer, Lock, Sparkles, Wand2, X } from 'lucide-react';
import { BUILD_MODES, MODULES, TECHS } from '../game/config.js';
import {
  isModuleAvailable,
  moduleBuildCost,
  moduleBuildDebt,
  moduleBuildHours,
  moduleLevel,
  refactorCost,
  refactorHours,
  refactorKeep,
} from '../game/engine.js';
import { money } from '../game/format.js';
import { SNIPPETS } from '../game/snippets.js';
import { Bar, Button, Panel, PanelHeader, Tag } from './ui.jsx';

// Окно «ИИ пишет код»: символы печатаются плавно, догоняя реальный прогресс задачи
function CodeWriter({ job, speed }) {
  const reduce = useReducedMotion();
  const lines = job.type === 'refactor' ? SNIPPETS.refactor : SNIPPETS[job.moduleId] || [];
  const full = lines.join('\n');
  const target = Math.floor(full.length * Math.min(1, (job.progress + 0.999) / job.duration));
  const [shown, setShown] = useState(Math.floor(full.length * (job.progress / job.duration)));
  const boxRef = useRef(null);

  useEffect(() => {
    if (reduce) {
      setShown(target);
      return undefined;
    }
    if (speed === 0) return undefined;
    const id = setInterval(() => {
      setShown((s) => (s >= target ? s : Math.min(target, s + Math.max(1, Math.ceil(full.length / (job.duration * 18 / speed))))));
    }, 55);
    return () => clearInterval(id);
  }, [target, full.length, job.duration, speed, reduce]);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [shown]);

  const text = full.slice(0, shown);
  const visible = text.split('\n');
  return (
    <div ref={boxRef} className="ide-scroll h-48 overflow-y-auto rounded-lg border border-slate-800 bg-[#0a0e14] p-3 text-[11px] leading-5">
      {visible.map((line, i) => (
        <div key={i} className="flex">
          <span className="mr-3 w-5 shrink-0 select-none text-right text-slate-600">{i + 1}</span>
          <span className={`whitespace-pre-wrap break-all ${colorize(line)} ${i === visible.length - 1 ? 'caret' : ''}`}>{line}</span>
        </div>
      ))}
    </div>
  );
}

// Простейшая «подсветка синтаксиса» по первому токену строки
function colorize(line) {
  const t = line.trim();
  if (t.startsWith('#') || t.startsWith('//') || t.startsWith('→')) return 'text-slate-500';
  if (t.startsWith('✔')) return 'text-emerald-300';
  if (t.startsWith('$')) return 'text-amber-300';
  if (/^(import|from|export|package|const|def|class|async|func|return|if|with|for|resource|name:|on:|jobs:)/.test(t)) return 'text-violet-300';
  if (/^-/.test(t)) return 'text-cyan-300';
  return 'text-slate-200';
}

function ModuleRow({ game, m, busy, onBuild }) {
  const lvl = moduleLevel(game, m.id);
  const avail = isModuleAvailable(game, m.id);
  const maxed = lvl >= m.maxLevel;
  const cost = moduleBuildCost(game, m.id);
  const hours = moduleBuildHours(game, m.id);
  const debt = moduleBuildDebt(game, m.id);
  return (
    <div className={`rounded-lg border p-2.5 ${!avail ? 'border-slate-800 opacity-55' : maxed ? 'border-emerald-400/25 bg-emerald-400/5' : 'border-slate-700/70 bg-slate-950/40'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-100">{m.name}</span>
            {m.autonomy && <Tag tone="violet">автономия</Tag>}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">{m.file}</div>
        </div>
        <div className="flex shrink-0 gap-0.5" aria-label={`Уровень ${lvl} из ${m.maxLevel}`}>
          {Array.from({ length: m.maxLevel }, (_, i) => (
            <span key={i} className={`h-1.5 w-3 rounded-full ${i < lvl ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-700'}`} />
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-slate-400">{m.effect}</p>
      {avail ? (
        !maxed && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">
              {hours} ч · +{m.compute} TF · долг +{debt.toFixed(1)}%
            </span>
            <Button tone="cyan" size="sm" disabled={busy || game.money < cost} onClick={() => onBuild(m.id)}>
              <Hammer className="h-3 w-3" aria-hidden="true" /> {lvl ? 'Улучшить' : 'Сгенерировать'} {money(cost, 0)}
            </Button>
          </div>
        )
      ) : (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
          <Lock className="h-3 w-3" aria-hidden="true" /> Технология «{TECHS[m.requires].name}»
        </div>
      )}
      {maxed && (
        <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-emerald-300">
          <Check className="h-3 w-3" aria-hidden="true" /> максимальный уровень
        </div>
      )}
    </div>
  );
}

export default function VibeCodingPanel({ game, speed, actions }) {
  const job = game.job;
  const busy = !!job;
  const debt = game.debt;
  const rCost = refactorCost(game);
  const rHours = refactorHours(game);
  const after = debt * refactorKeep(game);
  const debtTone = debt < 35 ? 'emerald' : debt < 65 ? 'amber' : 'rose';
  const modules = Object.values(MODULES);

  return (
    <Panel accent="violet" className="flex flex-col">
      <PanelHeader
        icon={CodeXml}
        title="Модуль Вайбкодинга"
        file="copilot.session"
        accent="violet"
        right={
          <div role="group" aria-label="Режим генерации" className="flex rounded-lg border border-slate-700/60 bg-slate-950/50 p-0.5">
            {Object.values(BUILD_MODES).map((mode) => (
              <button
                key={mode.id}
                type="button"
                aria-pressed={game.buildMode === mode.id}
                title={mode.hint}
                onClick={() => actions.setBuildMode(mode.id)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 ${
                  game.buildMode === mode.id ? 'bg-violet-400/20 text-violet-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode.name}
              </button>
            ))}
          </div>
        }
      />
      <div className="space-y-3 p-3 sm:p-4">
        {/* Активная задача ассистента */}
        <AnimatePresence mode="wait">
          {job ? (
            <motion.div key={`${job.type}-${job.startedHour}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-violet-200">
                  <Sparkles className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                  {job.type === 'refactor' ? 'ИИ рефакторит код…' : `ИИ пишет код: ${MODULES[job.moduleId].file}`}
                  {job.auto && <Tag tone="violet">авто</Tag>}
                </span>
                <span className="tabular-nums text-slate-400">
                  {job.progress}/{job.duration} ч
                </span>
              </div>
              <Bar value={job.progress / job.duration} tone={job.type === 'refactor' ? 'emerald' : 'violet'} height="h-2" />
              <CodeWriter job={job} speed={speed} />
              <div className="flex justify-end">
                <Button tone="ghost" size="sm" onClick={actions.cancelJob} title="Вернётся половина неизрасходованных токенов">
                  <X className="h-3 w-3" aria-hidden="true" /> Отменить
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-lg border border-slate-800 bg-[#0a0e14] p-3 text-[11px] leading-5 text-slate-500">
              <div>
                <span className="text-cyan-300">vibe@copilot</span>:<span className="text-violet-300">~/automation</span>$ <span className="caret text-slate-300" />
              </div>
              <div>Ассистент свободен. Выберите команду ниже или запустите Vibe Clean.</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Рефакторинг */}
        <div className={`rounded-xl border p-3 ${debt >= 65 ? 'border-rose-400/40 bg-rose-500/5' : 'border-slate-700/60 bg-slate-950/40'}`}>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-300">
              <Eraser className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> Тех-долг
            </span>
            <span className={`font-semibold tabular-nums ${debt < 35 ? 'text-emerald-300' : debt < 65 ? 'text-amber-300' : 'text-rose-300'}`}>{debt.toFixed(1)}%</span>
          </div>
          <Bar value={debt / 100} tone={debtTone} height="h-2" />
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Долг раздувает расход токенов, замедляет агентов, режет доход модулей и роняет качество. Выше 72% прод начинает падать.
          </p>
          <Button tone="emerald" size="lg" className="mt-2 w-full" disabled={busy || debt < 1 || game.money < rCost} onClick={actions.refactor}>
            <Wand2 className="h-4 w-4" aria-hidden="true" /> Рефакторинг ИИ (Vibe Clean) · {money(rCost, 0)} · {rHours} ч → {after.toFixed(0)}%
          </Button>
        </div>

        {/* Команды автоматизации */}
        <div>
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
            <span>Команды для автоматизации</span>
            <span className="normal-case tracking-normal">режим: {BUILD_MODES[game.buildMode].hint}</span>
          </div>
          <div className="ide-scroll grid max-h-[520px] gap-2 overflow-y-auto pr-1">
            {modules.map((m) => (
              <ModuleRow key={m.id} game={game} m={m} busy={busy} onBuild={actions.build} />
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
