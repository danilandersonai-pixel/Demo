import { Trophy } from 'lucide-react';
import { fmt } from '../game/format.ts';
import { useGameContext } from './GameContext.tsx';
import { cn } from './ui/cn.ts';

/** Зал славы: лучшие забеги из localStorage. */
export function HallOfFame({ highlight, className }: { highlight?: number; className?: string }) {
  const { state } = useGameContext();
  const { records } = state;
  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between font-mono text-[10px] tracking-[0.2em] text-dim">
        <span className="flex items-center gap-1.5">
          <Trophy className="size-3.5 text-energy" /> ЗАЛ СЛАВЫ
        </span>
        <span>
          РЕКОРДЫ: <span className="text-ink">{records.bestDays} дн.</span> · <span className="text-credit">{fmt(records.bestCapital)}₵</span>
        </span>
      </div>
      {records.runs.length === 0 ? (
        <p className="border border-dashed border-line px-3 py-2 font-mono text-[11px] text-dim">
          Пока пусто. Сюда попадают забеги длиной от 10 дней.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] font-mono text-[11px]">
            <thead>
              <tr className="text-left text-dim">
                <th className="py-1 pr-2 font-normal">#</th>
                <th className="py-1 pr-2 font-normal">СЕССИЯ</th>
                <th className="py-1 pr-2 text-right font-normal">ДНЕЙ</th>
                <th className="py-1 pr-2 text-right font-normal">ПИК ₵</th>
                <th className="py-1 pr-2 text-right font-normal">НИО</th>
                <th className="py-1 text-right font-normal">ИТОГ</th>
              </tr>
            </thead>
            <tbody>
              {records.runs.map((run, i) => (
                <tr key={`${run.runId}-${run.endedAt}`} className={cn('border-t border-line', run.runId === highlight && 'bg-credit/[0.07] text-credit')}>
                  <td className="py-1.5 pr-2 text-dim">{i + 1}</td>
                  <td className="py-1.5 pr-2">#{run.runId}</td>
                  <td className="tabular py-1.5 pr-2 text-right text-ink">{run.days}</td>
                  <td className="tabular py-1.5 pr-2 text-right text-credit">{fmt(run.peakCapital)}</td>
                  <td className="tabular py-1.5 pr-2 text-right text-research">{run.researchDone}</td>
                  <td className="py-1.5 text-right text-dim">{run.cause === 'bankrupt' ? 'банкрот' : 'сброс'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
