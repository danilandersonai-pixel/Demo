import { motion } from 'framer-motion';
import { Check, Clock, FlaskConical, Lock } from 'lucide-react';
import { RESEARCH, RESEARCH_ORDER, TIER_NAMES } from '../game/config';
import { researchBlocker } from '../game/engine';
import { duration, money, num, pct, roman } from '../game/format';
import type { GameState, ResearchId } from '../game/types';
import { RESEARCH_ICONS } from '../ui/icons';
import { Badge, Meter } from '../ui/primitives';

type TechStatus = 'done' | 'active' | 'available' | 'locked';

function statusOf(state: GameState, id: ResearchId): TechStatus {
  if (state.research.done.includes(id)) return 'done';
  if (state.research.active?.id === id) return 'active';
  const def = RESEARCH[id];
  return def.requires.every((r) => state.research.done.includes(r)) ? 'available' : 'locked';
}

function ActiveResearch({ state }: { state: GameState }) {
  const act = state.research.active;
  if (!act) {
    return (
      <div className="rounded-md border border-dashed border-steel-600 px-3 py-3 text-[12px] leading-snug text-steel-400">
        Лаборатория свободна. Исследование оплачивается кредитами сразу, а Чистый код лаборатория забирает по ходу
        работы — наравне с Кластерами обучения.
      </div>
    );
  }
  const def = RESEARCH[act.id];
  const Icon = RESEARCH_ICONS[act.id];
  const progress = act.paid / def.code;
  const draw = state.flow.researchDraw;
  const eta = draw > 0.001 ? (def.code - act.paid) / draw : null;
  const rate = def.code / def.time;
  return (
    <div className="relative overflow-hidden rounded-md border border-code/60 bg-code/10 p-3">
      <motion.div
        className="pointer-events-none absolute inset-y-0 w-1/4"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(168,85,247,0.18), transparent)' }}
        animate={{ left: ['-30%', '110%'] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
      />
      <div className="relative flex items-center gap-2">
        <Icon size={18} className="text-code" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9.5px] uppercase tracking-wider text-code">Идёт исследование</div>
          <div className="truncate font-display text-[13px] text-steel-100">{def.name}</div>
        </div>
        <span className="num text-lg font-bold text-code">{pct(progress)}</span>
      </div>
      <Meter value={progress} color="#a855f7" height={7} className="relative mt-2" label="Прогресс исследования" />
      <div className="num relative mt-1.5 flex justify-between text-[10.5px] text-steel-300">
        <span>
          {num(act.paid)} / {num(def.code)} KLOC · {num(draw)} из {num(rate)}/с
        </span>
        <span>{eta !== null ? `≈ ${duration(eta)}` : state.flow.blackout ? 'нет питания' : 'ждёт код'}</span>
      </div>
      {draw < rate * 0.5 && !state.flow.blackout && (
        <p className="relative mt-1.5 text-[11px] leading-snug text-steel-400">
          Кода не хватает на полную скорость: добавьте Блоки вайбкодинга или накопите запас на складе.
        </p>
      )}
    </div>
  );
}

export function ResearchPanel({ state, onResearch }: { state: GameState; onResearch: (id: ResearchId) => void }) {
  const tiers = [1, 2, 3, 4] as const;
  const doneCount = state.research.done.length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between font-mono text-[10.5px] text-steel-400">
        <span className="flex items-center gap-1.5">
          <FlaskConical size={13} className="text-code" aria-hidden /> Открыто технологий
        </span>
        <span className="num text-steel-100">
          {doneCount} / {RESEARCH_ORDER.length}
        </span>
      </div>
      <ActiveResearch state={state} />
      {tiers.map((tier) => (
        <section key={tier} aria-label={`Тир ${tier}`}>
          <h3 className="mb-1.5 flex items-center gap-2 font-display text-[11px] uppercase tracking-[0.14em] text-steel-300">
            <span className="rounded-sm border border-steel-600 px-1 font-mono text-[9.5px] text-steel-400">
              ТИР {roman(tier)}
            </span>
            {TIER_NAMES[tier]}
          </h3>
          <ol className="relative flex flex-col gap-1.5 border-l border-steel-700 pl-3">
            {RESEARCH_ORDER.filter((id) => RESEARCH[id].tier === tier).map((id) => {
              const def = RESEARCH[id];
              const st = statusOf(state, id);
              const Icon = RESEARCH_ICONS[id];
              const blocker = researchBlocker(state, id);
              const color = st === 'done' ? '#34d399' : st === 'active' ? '#a855f7' : st === 'available' ? '#22d3ee' : '#6b7788';
              return (
                <li key={id} className="relative">
                  <span
                    className="absolute -left-[17px] top-3 h-2 w-2 rounded-full border"
                    style={{ borderColor: color, background: st === 'done' ? color : '#0a0c10', boxShadow: `0 0 6px ${color}` }}
                  />
                  <div
                    className={`rounded-md border p-2.5 ${st === 'locked' ? 'opacity-60' : ''}`}
                    style={{ borderColor: `${color}55`, background: st === 'done' ? '#34d39910' : '#0e1218' }}
                  >
                    <div className="flex items-start gap-2">
                      <Icon size={16} color={color} className="mt-0.5 shrink-0" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-display text-[12px] leading-tight text-steel-100">{def.name}</span>
                          {st === 'done' && (
                            <Badge color="#34d399">
                              <Check size={10} aria-hidden /> Открыто
                            </Badge>
                          )}
                          {st === 'active' && <Badge color="#a855f7">{pct(state.research.active!.paid / def.code)}</Badge>}
                          {st === 'locked' && (
                            <Badge color="#6b7788">
                              <Lock size={9} aria-hidden /> Закрыто
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-[12px] leading-snug" style={{ color: st === 'locked' ? '#8f9bad' : '#c7d0dc' }}>
                          {def.effect}
                        </p>
                        {st !== 'done' && <p className="mt-0.5 text-[11px] leading-snug text-steel-500">{def.desc}</p>}
                      </div>
                    </div>
                    {st !== 'done' && st !== 'active' && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="num text-[10.5px] text-steel-300">
                          <span className={state.credits >= def.cost ? 'text-cash' : 'text-alert'}>{money(def.cost)}</span>
                          {' + '}
                          <span className="text-code">{num(def.code)} KLOC</span>
                          <span className="ml-2 inline-flex items-center gap-0.5 text-steel-500">
                            <Clock size={10} aria-hidden /> {duration(def.time)}
                          </span>
                        </span>
                        {st === 'available' ? (
                          <button
                            type="button"
                            className="btn btn-violet ml-auto !min-h-7 !py-1"
                            disabled={!!blocker}
                            onClick={() => onResearch(id)}
                            title={blocker ?? undefined}
                          >
                            {blocker && state.research.active ? 'Лаборатория занята' : blocker ?? 'Исследовать'}
                          </button>
                        ) : (
                          <span className="ml-auto text-right font-mono text-[10px] text-steel-500">
                            нужно: {def.requires.map((r) => RESEARCH[r].name).join(' + ')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
