import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheck, Info, OctagonAlert, ScrollText, Target, TriangleAlert, X } from 'lucide-react';
import { GOALS, currentGoal } from '../game/goals';
import { clock, money, num } from '../game/format';
import type { GameState, LogKind, Tone } from '../game/types';
import type { ToastItem } from '../hooks/useGame';
import { Meter, Panel } from '../ui/primitives';

const TAG: Record<LogKind, { label: string; color: string }> = {
  info: { label: 'ИНФО', color: '#8f9bad' },
  build: { label: 'СТРОЙКА', color: '#22d3ee' },
  research: { label: 'НИОКР', color: '#a855f7' },
  market: { label: 'РЫНОК', color: '#f472b6' },
  alert: { label: 'АВАРИЯ', color: '#f43f5e' },
  record: { label: 'РЕКОРД', color: '#34d399' },
  goal: { label: 'КОНТРАКТ', color: '#facc15' },
};

export function GoalStrip({ state }: { state: GameState }) {
  const g = currentGoal(state);
  if (!g) {
    return (
      <div className="panel flex items-center gap-3 px-4 py-2.5 text-[12px] text-steel-300">
        <Target size={16} className="text-cash" aria-hidden />
        Все контракты выполнены. Дальше — только рекорды: максимальный доход и число узлов.
      </div>
    );
  }
  const [cur, target] = g.progress(state);
  const idx = GOALS.indexOf(g);
  return (
    <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <Target size={18} className="shrink-0 text-energy" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-steel-500">
          Контракт {idx + 1}/{GOALS.length}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-[13px] text-steel-100">{g.title}</span>
          <span className="text-[12px] text-steel-300">{g.desc}</span>
        </div>
      </div>
      <div className="w-36 shrink-0">
        <Meter value={target > 0 ? cur / target : 0} color="#facc15" height={5} label="Прогресс контракта" />
        <div className="num mt-0.5 text-right text-[10px] text-steel-400">
          {g.unit === 'income' ? `${money(cur)} / ${money(target)}/с` : `${num(Math.min(cur, target))} / ${num(target)}`}
        </div>
      </div>
      <div className="num shrink-0 text-[12px] font-semibold text-cash">+{money(g.reward)}</div>
    </div>
  );
}

export function EventLog({ state }: { state: GameState }) {
  const items = [...state.log].reverse().slice(0, 40);
  return (
    <Panel
      code="MOD-06"
      title="Журнал смены"
      icon={ScrollText}
      bodyClassName="scroll-thin h-40 overflow-y-auto px-3 py-2"
    >
      <ol className="font-mono text-[10.5px] leading-relaxed" aria-live="off">
        <AnimatePresence initial={false}>
          {items.map((e) => (
            <motion.li
              key={e.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex gap-2"
            >
              <span className="shrink-0 text-steel-600">{clock(e.t)}</span>
              <span className="w-[4.6rem] shrink-0" style={{ color: TAG[e.kind].color }}>
                [{TAG[e.kind].label}]
              </span>
              <span className="min-w-0 text-steel-300">{e.text}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </Panel>
  );
}

const TONE: Record<Tone, { color: string; icon: typeof Info }> = {
  info: { color: '#22d3ee', icon: Info },
  good: { color: '#34d399', icon: CircleCheck },
  warn: { color: '#facc15', icon: TriangleAlert },
  bad: { color: '#f43f5e', icon: OctagonAlert },
};

export function Toasts({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div
      className="pointer-events-none fixed bottom-3 right-3 z-[60] flex w-[min(360px,calc(100vw-1.5rem))] flex-col gap-2 sm:bottom-auto sm:top-20"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const tone = TONE[t.tone];
          const Icon = tone.icon;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 48, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 48, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              role={t.tone === 'bad' ? 'alert' : 'status'}
              className="panel pointer-events-auto flex gap-2.5 overflow-hidden py-2.5 pl-3 pr-2"
              style={{ borderColor: `${tone.color}77`, boxShadow: `0 0 24px ${tone.color}22, 0 10px 30px rgba(0,0,0,.45)` }}
            >
              <span className="absolute inset-y-0 left-0 w-1" style={{ background: tone.color }} />
              <Icon size={17} color={tone.color} className="mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[12px] tracking-wide" style={{ color: tone.color }}>
                  {t.title}
                </div>
                {t.text && <div className="mt-0.5 text-[12px] leading-snug text-steel-300">{t.text}</div>}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                className="h-6 w-6 shrink-0 rounded text-steel-400 hover:bg-steel-800 hover:text-steel-100"
                aria-label="Скрыть уведомление"
              >
                <X size={14} className="mx-auto" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
