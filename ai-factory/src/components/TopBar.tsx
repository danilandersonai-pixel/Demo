import { CircleHelp, Pause, RotateCcw, Save, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { clock, money, num } from '../game/format';
import type { Records } from '../game/records';
import { avgIncome } from '../game/selectors';
import type { GameState } from '../game/types';
import { AnimatedNumber } from '../ui/primitives';

const SPEEDS = [
  { v: 0, label: 'Пауза' },
  { v: 1, label: '×1' },
  { v: 2, label: '×2' },
  { v: 4, label: '×4' },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="34" height="38" viewBox="0 0 34 38" aria-hidden className="shrink-0">
        <polygon points="17,1 33,10 33,28 17,37 1,28 1,10" fill="#0f141b" stroke="#22d3ee" strokeWidth="1.5" />
        <polygon points="17,6 28.5,12.5 28.5,25.5 17,32 5.5,25.5 5.5,12.5" fill="none" stroke="#a855f7" strokeOpacity="0.6" />
        <text x="17" y="23.5" textAnchor="middle" fontFamily="Russo One, sans-serif" fontSize="11" fill="#dde3ec">
          AI
        </text>
      </svg>
      <div className="leading-none">
        <div className="font-display text-[17px] tracking-[0.08em] text-steel-100">
          AI<span className="text-data">-</span>FACTORY
        </div>
        <div className="mt-1 font-mono text-[9px] tracking-[0.28em] text-steel-400">AUTOMATION SANDBOX</div>
      </div>
    </div>
  );
}

function Kpi({ label, children, sub, className = '' }: { label: string; children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 leading-tight ${className}`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-steel-500">{label}</div>
      <div className="num text-[15px] font-semibold">{children}</div>
      {sub && <div className="num text-[10px] text-steel-400">{sub}</div>}
    </div>
  );
}

export function TopBar({
  state,
  records,
  speed,
  onSpeed,
  onHelp,
  onReset,
  lastSave,
  storageOk,
}: {
  state: GameState;
  records: Records;
  speed: number;
  onSpeed: (v: number) => void;
  onHelp: () => void;
  onReset: () => void;
  lastSave: number | null;
  storageOk: boolean;
}) {
  const f = state.flow;
  const income = avgIncome(state);
  const powerColor = f.blackout ? '#f43f5e' : f.brownout || (f.gen > 0 && f.load / f.gen > 0.9) ? '#facc15' : '#34d399';
  const secsAgo = lastSave ? Math.max(0, Math.round((Date.now() - lastSave) / 1000)) : null;

  return (
    <header className="relative z-20 border-b border-steel-750 bg-steel-950/95 px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Logo />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
          <Kpi label="Кредиты">
            <span className="text-[18px] text-cash text-glow">
              <AnimatedNumber value={state.credits} format={money} />
            </span>
          </Kpi>
          <Kpi label="Пассивный доход" sub={`рекорд ${money(records.maxIncome)}/с`}>
            <span className="text-cash">{money(income)}/с</span>
          </Kpi>
          <Kpi label="Энергосеть" sub={f.blackout ? 'ОБЕСТОЧЕНО' : f.brownout ? 'дефицит' : 'нагрузка / генерация'}>
            <span style={{ color: powerColor }}>
              {num(f.load)}/{num(f.gen)} МВт
            </span>
          </Kpi>
          <Kpi label="Смена" className="hidden sm:block" sub={`${state.buildings.length} узлов на сетке`}>
            <span className="text-steel-200">{clock(state.tick)}</span>
          </Kpi>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div role="group" aria-label="Скорость времени" className="flex overflow-hidden rounded border border-steel-700">
            {SPEEDS.map((s) => (
              <button
                key={s.v}
                type="button"
                aria-pressed={speed === s.v}
                onClick={() => onSpeed(s.v)}
                className={`flex h-8 min-w-9 items-center justify-center px-2 font-mono text-[11px] font-semibold transition-colors ${
                  speed === s.v
                    ? s.v === 0
                      ? 'bg-energy/20 text-energy'
                      : 'bg-data/15 text-data'
                    : 'bg-steel-900 text-steel-400 hover:text-steel-100'
                }`}
                title={s.v === 0 ? 'Пауза (пробел)' : `Скорость ${s.label}`}
              >
                {s.v === 0 ? <Pause size={13} aria-label="Пауза" /> : s.label}
              </button>
            ))}
          </div>
          <span
            className="hidden items-center gap-1 font-mono text-[10px] text-steel-500 lg:flex"
            title={storageOk ? 'Фабрика и рекорды сохраняются в localStorage' : 'Браузер не даёт сохранять данные'}
          >
            {storageOk ? (
              <>
                <Save size={12} aria-hidden /> {secsAgo === null ? 'автосейв' : secsAgo < 2 ? 'сохранено' : `сейв ${secsAgo} с назад`}
              </>
            ) : (
              <>
                <TriangleAlert size={12} className="text-energy" aria-hidden /> без сохранения
              </>
            )}
          </span>
          <button type="button" className="btn !min-h-8 !px-2" onClick={onHelp} aria-label="Справочник инженера">
            <CircleHelp size={15} />
          </button>
          <button type="button" className="btn btn-danger !min-h-8 !px-2" onClick={onReset} aria-label="Новая фабрика">
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
