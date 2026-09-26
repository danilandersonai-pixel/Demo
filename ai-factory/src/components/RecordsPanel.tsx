import { Check, Crown, Target, Trophy } from 'lucide-react';
import { GOALS } from '../game/goals';
import { clock, int, money, num, pct } from '../game/format';
import { BUILT_MILESTONES, type Records } from '../game/records';
import { avgIncome } from '../game/selectors';
import type { GameState } from '../game/types';
import { Meter, Sparkline } from '../ui/primitives';

function when(ts: number | null): string {
  if (!ts) return 'ещё не установлен';
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts);
  } catch {
    return '';
  }
}

export function RecordsPanel({ state, records }: { state: GameState; records: Records }) {
  const next = BUILT_MILESTONES.find((m) => m > records.totalBuilt);
  const income = avgIncome(state);
  const st = state.stats;
  const doneGoals = GOALS.filter((g) => state.goals.includes(g.id)).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-1 2xl:grid-cols-2">
        <div className="relative overflow-hidden rounded-md border border-cash/50 bg-cash/10 p-3">
          <Trophy className="absolute -right-2 -top-2 text-cash/15" size={64} aria-hidden />
          <div className="font-mono text-[9.5px] uppercase tracking-wider text-cash">Рекорд пассивного дохода</div>
          <div className="num mt-0.5 text-xl font-bold text-cash text-glow">{money(records.maxIncome)}/с</div>
          <div className="num mt-0.5 text-[10.5px] text-steel-400">{when(records.maxIncomeAt)}</div>
          <div className="num mt-1 text-[10.5px] text-steel-300">
            сейчас {money(income)}/с · {records.maxIncome > 0 ? pct(income / records.maxIncome) : '—'} от рекорда
          </div>
        </div>
        <div className="relative overflow-hidden rounded-md border border-data/50 bg-data/10 p-3">
          <Crown className="absolute -right-2 -top-2 text-data/15" size={64} aria-hidden />
          <div className="font-mono text-[9.5px] uppercase tracking-wider text-data">Запущено узлов за всё время</div>
          <div className="num mt-0.5 text-xl font-bold text-data text-glow">{int(records.totalBuilt)}</div>
          <div className="num mt-0.5 text-[10.5px] text-steel-400">
            {next ? `следующий рубеж — ${next}` : 'все рубежи взяты'} · узел засчитывается после 30 с работы
          </div>
          {next && <Meter value={records.totalBuilt / next} color="#22d3ee" height={4} className="mt-1.5" label="До рубежа" />}
        </div>
      </div>

      <div className="num grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10.5px] text-steel-400">
        <span>Самый быстрый AGI</span>
        <span className="text-right text-agi">{records.fastestAgi !== null ? clock(records.fastestAgi) : '—'}</span>
        <span>Запущено фабрик</span>
        <span className="text-right text-steel-200">{records.factories}</span>
      </div>

      <section aria-label="Доход за последние минуты">
        <h3 className="mb-1 font-display text-[11px] uppercase tracking-[0.14em] text-steel-200">Доход, последние 2 минуты</h3>
        <Sparkline values={state.incomeHistory} color="#34d399" height={56} />
      </section>

      <section aria-label="Статистика смены">
        <h3 className="mb-1 font-display text-[11px] uppercase tracking-[0.14em] text-steel-200">Эта фабрика</h3>
        <dl className="num grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10.5px]">
          <dt className="text-steel-400">Время смены</dt>
          <dd className="text-right text-steel-200">{clock(state.tick)}</dd>
          <dt className="text-steel-400">Заработано</dt>
          <dd className="text-right text-cash">{money(st.earned)}</dd>
          <dt className="text-steel-400">Добыто данных</dt>
          <dd className="text-right text-data">{num(st.dataMined)} ТБ</dd>
          <dt className="text-steel-400">Написано кода</dt>
          <dd className="text-right text-code">{num(st.codeWritten)} KLOC</dd>
          <dt className="text-steel-400">Обучено моделей</dt>
          <dd className="text-right text-model">{num(st.modelsTrained)}</dd>
          <dt className="text-steel-400">Построено узлов</dt>
          <dd className="text-right text-steel-200">{st.built}</dd>
          <dt className="text-steel-400">Рефакторингов</dt>
          <dd className="text-right text-steel-200">
            {st.refactors} + {st.autoRefactors} авто
          </dd>
          <dt className="text-steel-400">Без питания</dt>
          <dd className="text-right text-alert">{st.blackoutTicks} с</dd>
        </dl>
      </section>

      <section aria-label="Контракты">
        <h3 className="mb-1.5 flex items-center justify-between font-display text-[11px] uppercase tracking-[0.14em] text-steel-200">
          <span className="flex items-center gap-1.5">
            <Target size={12} aria-hidden /> Контракты
          </span>
          <span className="num text-steel-400">
            {doneGoals}/{GOALS.length}
          </span>
        </h3>
        <ol className="flex flex-col gap-1">
          {GOALS.map((g) => {
            const done = state.goals.includes(g.id);
            const [cur, target] = g.progress(state);
            return (
              <li
                key={g.id}
                className={`flex items-center gap-2 rounded border px-2 py-1.5 text-[11.5px] ${
                  done ? 'border-cash/30 bg-cash/5 text-steel-400' : 'border-steel-750 text-steel-200'
                }`}
              >
                <span
                  className="grid h-4 w-4 shrink-0 place-items-center rounded-sm border"
                  style={{ borderColor: done ? '#34d399' : '#4b5667', background: done ? '#34d39933' : 'transparent' }}
                >
                  {done && <Check size={11} className="text-cash" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={done ? 'line-through decoration-steel-600' : ''}>{g.title}</span>
                  {!done && (
                    <span className="num ml-1.5 text-[10px] text-steel-500">
                      {g.unit === 'income' ? `${money(cur)}/${money(target)}/с` : `${num(Math.min(cur, target))}/${num(target)}`}
                    </span>
                  )}
                </span>
                <span className="num shrink-0 text-[10.5px] text-cash">{money(g.reward)}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
