import { motion } from 'framer-motion';
import { Clock, Minimize2 } from 'lucide-react';
import { DECISION_WINDOW } from '../game/config.ts';
import { canChoose } from '../game/events.ts';
import { fmt } from '../game/format.ts';
import type { OptionTone } from '../game/types.ts';
import { useGameContext } from './GameContext.tsx';
import { cn } from './ui/cn.ts';
import { EVENT_ICONS } from './ui/icons.ts';
import { Modal } from './ui/Modal.tsx';

const TONE: Record<OptionTone, { border: string; label: string; badge: string }> = {
  safe: { border: 'border-credit/40 hover:bg-credit/10', label: 'text-credit', badge: 'НАДЁЖНО' },
  risky: { border: 'border-energy/40 hover:bg-energy/10', label: 'text-energy', badge: 'РИСК' },
  danger: { border: 'border-danger/40 hover:bg-danger/10', label: 'text-danger', badge: 'ПОТЕРИ' },
  neutral: { border: 'border-line hover:bg-white/[0.05]', label: 'text-ink', badge: 'БАЗОВО' },
};

/** Окно решения по событию. Время идёт: не ответите — сработает вариант по умолчанию. */
export function DecisionModal({ open, onMinimize }: { open: boolean; onMinimize: () => void }) {
  const { state, dispatch } = useGameContext();
  const pending = state.pending;
  const visible = open && pending !== null && state.status === 'playing';
  const left = pending ? Math.max(0, pending.expiresDay - state.day) : 0;
  const Icon = pending ? EVENT_ICONS[pending.eventId] : Clock;
  const fallback = pending?.options.find((o) => o.id === pending.defaultOption);

  return (
    <Modal open={visible} onClose={onMinimize} labelledBy="decision-title" tone="danger" className="max-w-2xl">
      {pending ? (
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center border border-danger/50 bg-danger/10">
                <Icon className="size-5 text-danger" />
              </div>
              <div>
                <div className="font-mono text-[10px] tracking-[0.3em] text-danger">ГЛОБАЛЬНОЕ СОБЫТИЕ · ДЕНЬ {pending.startDay}</div>
                <h2 id="decision-title" className="font-display text-lg font-bold uppercase tracking-wide text-ink sm:text-xl">
                  {pending.title}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onMinimize}
              aria-label="Свернуть окно решения"
              className="grid size-8 shrink-0 place-items-center border border-line text-muted transition-colors hover:text-ink"
            >
              <Minimize2 className="size-4" />
            </button>
          </div>

          <p className="mt-4 text-[14px] leading-relaxed text-muted">{pending.description}</p>

          <div className="mt-4">
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="flex items-center gap-1.5 text-danger">
                <Clock className="size-3.5" /> На решение: {left} дн.
              </span>
              <span className="text-dim">по умолчанию: «{fallback?.label}»</span>
            </div>
            <div className="mt-1.5 h-1 bg-white/[0.06]">
              <motion.div
                className="h-full bg-danger shadow-[0_0_10px_var(--color-danger)]"
                initial={false}
                animate={{ width: `${(left / DECISION_WINDOW) * 100}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
            <p className="mt-1.5 font-mono text-[10px] text-dim">Игра не на паузе — время идёт, пока вы думаете.</p>
          </div>

          <div className="mt-5 grid gap-2">
            {pending.options.map((option, i) => {
              const allowed = canChoose(state, option.id);
              const tone = TONE[option.tone];
              const missing: string[] = [];
              if (state.credits < option.cost.credits) missing.push(`${fmt(option.cost.credits - state.credits)}₵`);
              if (state.data < option.cost.data) missing.push(`${fmt(option.cost.data - state.data)} ед. данных`);
              return (
                <motion.button
                  key={option.id}
                  type="button"
                  disabled={!allowed}
                  data-autofocus={i === 0 ? true : undefined}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 + i * 0.06 }}
                  onClick={() => dispatch({ type: 'RESOLVE_DECISION', option: option.id })}
                  className={cn(
                    'chamfer w-full border p-3.5 text-left transition-colors',
                    allowed ? tone.border : 'cursor-not-allowed border-line opacity-50',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={cn('text-[14px] font-semibold', tone.label)}>{option.label}</span>
                    <span className="flex items-center gap-2 font-mono text-[10px]">
                      {option.cost.credits > 0 ? <span className="text-credit">−{fmt(option.cost.credits)}₵</span> : null}
                      {option.cost.data > 0 ? <span className="text-data">−{fmt(option.cost.data)} DB</span> : null}
                      <span className={cn('border px-1 tracking-widest', tone.label, 'border-current/40')}>{tone.badge}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-muted">{option.detail}</p>
                  {!allowed ? <p className="mt-1 font-mono text-[10px] text-danger">Не хватает: {missing.join(', ')}</p> : null}
                </motion.button>
              );
            })}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
