import { AnimatePresence, motion } from 'framer-motion';
import { Check, FlaskConical, Lock, Timer } from 'lucide-react';
import { useState } from 'react';
import { RESEARCH, RESEARCH_ORDER } from '../game/config.ts';
import { hasResearch } from '../game/economy.ts';
import { fmt } from '../game/format.ts';
import { checkResearch, researchStatus } from '../game/rules.ts';
import type { ResearchId } from '../game/types.ts';
import { useGameContext } from './GameContext.tsx';
import { cn } from './ui/cn.ts';
import { RESEARCH_ICONS } from './ui/icons.ts';
import { NeonButton } from './ui/NeonButton.tsx';
import { Panel } from './ui/Panel.tsx';

const NODE_H = 82;
const GAP_Y = 26;
const ROWS = 4;
const COLS = 3;

const colX = (col: number) => `${((col * 2 + 1) / (COLS * 2)) * 100}%`;
const rowTop = (row: number) => row * (NODE_H + GAP_Y);

/** Модуль 3 — научно-технический отдел: дерево исследований 3×4. */
export function ResearchLab({ className }: { className?: string }) {
  const { state } = useGameContext();
  const [picked, setPicked] = useState<ResearchId | null>(null);
  const firstAvailable = RESEARCH_ORDER.find((id) => researchStatus(state, id) === 'available') ?? RESEARCH_ORDER[0];
  const selected = picked ?? state.research.active ?? firstAvailable;
  const active = state.research.active ? RESEARCH[state.research.active] : null;
  const height = ROWS * NODE_H + (ROWS - 1) * GAP_Y;

  return (
    <Panel
      id="research"
      code="MOD-03 // R&D_DIVISION"
      title="Научно-технический отдел"
      icon={FlaskConical}
      accent="research"
      className={className}
      delay={0.1}
      actions={
        <span className="font-mono text-[10px] tracking-[0.2em] text-dim">
          ИЗУЧЕНО <span className="text-research">{state.research.done.length}</span>/{RESEARCH_ORDER.length}
        </span>
      }
    >
      {active ? (
        <div className="mb-4 border border-research/40 bg-research/[0.06] p-3">
          <div className="flex items-center justify-between gap-2 font-mono text-[10px] tracking-[0.2em]">
            <span className="text-research">ИДЁТ ИССЛЕДОВАНИЕ</span>
            <span className="flex items-center gap-1 text-muted">
              <Timer className="size-3" /> осталось {active.duration - state.research.progress} дн.
            </span>
          </div>
          <div className="mt-1 text-[13px] font-semibold text-ink">{active.name}</div>
          <div className="relative mt-2 h-1.5 overflow-hidden bg-white/[0.06]">
            <motion.div
              className="absolute inset-y-0 left-0 bg-research shadow-[0_0_12px_var(--color-research)]"
              initial={false}
              animate={{ width: `${(state.research.progress / active.duration) * 100}%` }}
              transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
            />
            <div className="sheen absolute inset-0" />
          </div>
        </div>
      ) : (
        <div className="mb-4 border border-dashed border-line p-3 font-mono text-[11px] text-dim">
          Отдел простаивает — выберите исследование в дереве.
        </div>
      )}

      <div className="relative" style={{ height }}>
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {RESEARCH_ORDER.flatMap((id) =>
            RESEARCH[id].requires.map((parentId) => {
              const parent = RESEARCH[parentId];
              const child = RESEARCH[id];
              const lit = hasResearch(state, parentId);
              return (
                <line
                  key={`${parentId}-${id}`}
                  x1={colX(parent.col)}
                  y1={rowTop(parent.row) + NODE_H}
                  x2={colX(child.col)}
                  y2={rowTop(child.row)}
                  stroke={lit ? 'var(--color-research)' : 'rgb(148 180 220 / 0.22)'}
                  strokeWidth={lit ? 1.5 : 1}
                  strokeDasharray={lit ? undefined : '4 4'}
                  style={lit ? { filter: 'drop-shadow(0 0 4px var(--color-research))' } : undefined}
                />
              );
            }),
          )}
        </svg>
        {RESEARCH_ORDER.map((id) => (
          <ResearchNode key={id} id={id} selected={selected === id} onPick={setPicked} />
        ))}
      </div>

      <ResearchDetail id={selected} />
    </Panel>
  );
}

function ResearchNode({ id, selected, onPick }: { id: ResearchId; selected: boolean; onPick: (id: ResearchId) => void }) {
  const { state } = useGameContext();
  const def = RESEARCH[id];
  const Icon = RESEARCH_ICONS[id];
  const status = researchStatus(state, id);
  const affordable = status === 'available' && checkResearch(state, id).ok;
  const progress = status === 'active' ? state.research.progress / def.duration : status === 'done' ? 1 : 0;

  return (
    <button
      type="button"
      onClick={() => onPick(id)}
      aria-pressed={selected}
      aria-label={`${def.name}: ${status === 'done' ? 'изучено' : status === 'active' ? 'исследуется' : status === 'locked' ? 'заблокировано' : 'доступно'}`}
      className={cn(
        'absolute flex flex-col items-start justify-between overflow-hidden border p-2 text-left transition-colors',
        status === 'done' && 'border-research/50 bg-research/[0.12]',
        status === 'active' && 'border-research bg-research/[0.08]',
        status === 'available' && (affordable ? 'border-research/60 bg-white/[0.03] shadow-[0_0_18px_-8px_var(--color-research)] hover:bg-research/10' : 'border-line bg-white/[0.02] hover:bg-white/[0.04]'),
        status === 'locked' && 'border-line/70 bg-void/60 opacity-45 hover:opacity-70',
        selected && 'ring-1 ring-research ring-offset-2 ring-offset-void',
      )}
      style={{
        left: `calc(${(def.col / COLS) * 100}% + 4px)`,
        width: `calc(${100 / COLS}% - 8px)`,
        top: rowTop(def.row),
        height: NODE_H,
      }}
    >
      <div className="flex w-full items-center justify-between gap-1">
        <Icon className={cn('size-4 shrink-0', status === 'locked' ? 'text-dim' : 'text-research')} aria-hidden />
        {status === 'done' ? <Check className="size-3.5 text-credit" aria-hidden /> : null}
        {status === 'locked' ? <Lock className="size-3 text-dim" aria-hidden /> : null}
        {status !== 'done' && status !== 'locked' ? <span className="font-mono text-[9px] text-dim">{def.tag}</span> : null}
      </div>
      <div className="line-clamp-2 w-full text-[11px] font-semibold leading-tight text-ink sm:text-[12px]">{def.name}</div>
      <div className="w-full font-mono text-[9px] text-dim">
        {status === 'done' ? (
          <span className="text-research">ИЗУЧЕНО</span>
        ) : status === 'active' ? (
          <span className="text-research">{Math.round(progress * 100)}%</span>
        ) : (
          <span className={affordable ? 'text-muted' : undefined}>
            {fmt(def.cost.data)}DB · {def.duration}д
          </span>
        )}
      </div>
      {status === 'active' ? (
        <motion.span
          className="absolute inset-x-0 bottom-0 h-0.5 bg-research"
          initial={false}
          animate={{ width: `${progress * 100}%` }}
          transition={{ duration: 0.5 }}
        />
      ) : null}
    </button>
  );
}

function ResearchDetail({ id }: { id: ResearchId }) {
  const { state, dispatch } = useGameContext();
  const def = RESEARCH[id];
  const Icon = RESEARCH_ICONS[id];
  const status = researchStatus(state, id);
  const check = checkResearch(state, id);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="mt-4 border border-line bg-void/40 p-3"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center border border-research/40 bg-research/10">
            <Icon className="size-4 text-research" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-ink">{def.name}</div>
            <div className="text-[12px] text-muted">{def.description}</div>
          </div>
        </div>
        <p className="mt-2.5 border-l-2 border-research/70 pl-2.5 text-[12.5px] leading-snug text-research">{def.effect}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="font-mono text-[11px] text-dim">
            <span className={state.credits >= def.cost.credits || status === 'done' ? 'text-credit' : 'text-danger'}>{fmt(def.cost.credits)}₵</span>
            {' + '}
            <span className={state.data >= def.cost.data || status === 'done' ? 'text-data' : 'text-danger'}>{fmt(def.cost.data)} DB</span>
            {' · '}
            {def.duration} дн.
            {def.requires.length ? ` · требует: ${def.requires.map((r) => RESEARCH[r].name).join(', ')}` : ''}
          </div>
          {status === 'done' ? (
            <span className="flex items-center gap-1 font-mono text-[11px] text-credit">
              <Check className="size-3.5" /> Технология внедрена
            </span>
          ) : status === 'active' ? (
            <span className="font-mono text-[11px] text-research">Исследуется: {state.research.progress}/{def.duration} дн.</span>
          ) : (
            <NeonButton size="sm" variant="solid" accent="research" disabled={!check.ok} onClick={() => dispatch({ type: 'START_RESEARCH', id })}>
              <FlaskConical className="size-3.5" /> Запустить
            </NeonButton>
          )}
        </div>
        {!check.ok && status !== 'done' && status !== 'active' ? <p className="mt-1.5 font-mono text-[10px] text-danger/90">{check.reason}</p> : null}
      </motion.div>
    </AnimatePresence>
  );
}
