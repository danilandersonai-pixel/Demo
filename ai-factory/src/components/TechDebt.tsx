import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bug, GitMerge, WandSparkles } from 'lucide-react';
import { useState } from 'react';
import { BAL } from '../game/config';
import { money, num, pct } from '../game/format';
import { getMods, refactorCost, serialOf, totalDebt } from '../game/selectors';
import type { GameState } from '../game/types';
import { Badge, Meter, Panel } from '../ui/primitives';

function debtColor(d: number): string {
  if (d >= 60) return '#f43f5e';
  if (d >= 25) return '#fb923c';
  return '#34d399';
}

export function TechDebt({ state, onRefactor }: { state: GameState; onRefactor: () => boolean }) {
  const mods = getMods(state);
  const debt = totalDebt(state);
  const cost = refactorCost(state);
  const coders = state.buildings.filter((b) => b.type === 'coder').sort((a, b) => b.debt - a.debt);
  const [sweep, setSweep] = useState(0);
  const reduce = useReducedMotion();

  let lost = 0;
  for (const b of coders) {
    const bf = state.flow.b[b.id];
    if (bf && bf.eff > 0) lost += bf.out / bf.eff - bf.out;
  }

  const run = () => {
    if (onRefactor()) setSweep((n) => n + 1);
  };

  return (
    <Panel
      code="MOD-03"
      title="Техдолг"
      icon={Bug}
      color="#fb923c"
      right={mods.autoRefactor ? <Badge color="#34d399">CI/CD</Badge> : null}
      className="relative overflow-hidden"
    >
      <AnimatePresence>
        {sweep > 0 && !reduce && (
          <motion.div
            key={sweep}
            className="pointer-events-none absolute inset-y-0 z-10 w-1/3"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(52,211,153,0.35), transparent)' }}
            initial={{ left: '-35%' }}
            animate={{ left: '110%' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeInOut' }}
          />
        )}
      </AnimatePresence>

      {coders.length === 0 ? (
        <p className="text-[12px] leading-snug text-steel-400">
          Блоки вайбкодинга со временем копят «мусор» в коде, и их КПД падает. Здесь появится сводка, как только
          построите первый блок.
        </p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-steel-400">Средний долг</div>
              <div className="num text-2xl font-bold leading-none" style={{ color: debtColor(debt.avg) }}>
                {Math.round(debt.avg)}%
              </div>
            </div>
            <div className="num text-right text-[10.5px] text-steel-400">
              <div>
                потери кода: <span className="text-alert">−{num(lost)} KLOC/с</span>
              </div>
              <div>
                рост долга: {num(BAL.debtRate * mods.debtMult * 60)} п.п./мин
              </div>
            </div>
          </div>
          <Meter value={debt.avg / 100} color={debtColor(debt.avg)} height={6} className="mt-2" label="Средний техдолг" />

          <ul className="mt-2.5 space-y-1">
            {coders.slice(0, 4).map((b) => (
              <li key={b.id} className="num flex items-center gap-2 text-[10.5px]">
                <span className="w-14 shrink-0 text-steel-400">{serialOf(b)}</span>
                <Meter value={b.debt / 100} color={debtColor(b.debt)} height={4} className="flex-1" label={`Техдолг ${serialOf(b)}`} />
                <span className="w-16 shrink-0 text-right" style={{ color: debtColor(b.debt) }}>
                  {Math.round(b.debt)}% · {pct(state.flow.b[b.id]?.eff ?? 1)}
                </span>
              </li>
            ))}
            {coders.length > 4 && (
              <li className="font-mono text-[10px] text-steel-500">…и ещё {coders.length - 4} блок(ов)</li>
            )}
          </ul>

          <button
            type="button"
            className={`btn btn-warn mt-3 w-full ${debt.avg >= 50 ? 'shadow-[0_0_18px_rgba(251,146,60,0.35)]' : ''}`}
            disabled={cost <= 0 || state.credits < cost}
            onClick={run}
          >
            <WandSparkles size={15} aria-hidden />
            {cost <= 0 ? 'Код чистый' : `Запустить ИИ-рефакторинг · ${money(cost)}`}
          </button>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-steel-400">
            <GitMerge size={13} className="mt-[1px] shrink-0" aria-hidden />
            {mods.autoRefactor
              ? `CI/CD чистит блоки сам при долге от ${BAL.autoRefactorAt}% за полцены. Авто-чисток: ${state.stats.autoRefactors}.`
              : 'Изучите «CI/CD-конвейер», и чистка пойдёт без ваших кликов.'}
          </p>
        </>
      )}
    </Panel>
  );
}
