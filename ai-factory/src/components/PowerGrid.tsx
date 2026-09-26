import { motion } from 'framer-motion';
import { Activity, Atom, TriangleAlert } from 'lucide-react';
import { BUILDINGS } from '../game/config';
import { num, pct } from '../game/format';
import { countType, getMods } from '../game/selectors';
import type { GameState } from '../game/types';
import { Badge, Meter, Panel } from '../ui/primitives';

type GridState = { label: string; color: string; note: string; hazard?: boolean };

function gridState(state: GameState): GridState {
  const f = state.flow;
  if (f.blackout) {
    return {
      label: 'Обесточено',
      color: '#f43f5e',
      note: 'Производство стоит. Постройте реактор или остановите часть зданий.',
      hazard: true,
    };
  }
  if (f.brownout) {
    return {
      label: `Дефицит · ${pct(f.power)}`,
      color: '#facc15',
      note: 'Умная сеть делит мощность, цех замедлен. Нужны реакторы.',
    };
  }
  if (f.gen <= 0 && f.load <= 0) {
    return { label: 'Нет генерации', color: '#6b7788', note: 'Первым делом постройте Квантовый реактор.' };
  }
  if (f.load / f.gen > 0.9) {
    return { label: 'На пределе', color: '#facc15', note: 'Запас меньше 10%: следующая постройка может погасить цех.' };
  }
  return { label: 'Стабильно', color: '#34d399', note: 'Генерация покрывает нагрузку с запасом.' };
}

export function PowerGrid({ state }: { state: GameState }) {
  const f = state.flow;
  const g = gridState(state);
  const reactors = countType(state, 'reactor');
  const mods = getMods(state);
  const reserve = f.gen - f.load;
  const ev = state.market.event;
  const coderMw = BUILDINGS.coder.energy * mods.coderEnergy;
  const ratio = f.gen > 0 ? f.load / f.gen : f.load > 0 ? 1 : 0;

  return (
    <Panel
      code="MOD-02"
      title="Энергосеть"
      icon={Activity}
      color="#facc15"
    >
      <motion.div
        className={`relative overflow-hidden rounded border px-3 py-2 ${g.hazard ? 'hazard-red' : ''}`}
        style={{ borderColor: `${g.color}88`, background: g.hazard ? undefined : `${g.color}12` }}
        animate={g.hazard ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
        transition={g.hazard ? { duration: 0.9, repeat: Infinity } : undefined}
      >
        <div className="flex items-center gap-2">
          {g.hazard && <TriangleAlert size={16} color={g.color} aria-hidden />}
          <span className="font-display text-[14px] uppercase tracking-[0.12em]" style={{ color: g.color }}>
            {g.label}
          </span>
          {mods.smartGrid && (
            <Badge color="#22d3ee" className="ml-auto">
              Умная сеть
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-[11.5px] leading-snug text-steel-300">{g.note}</p>
      </motion.div>

      <div className="mt-3">
        <div className="mb-1 flex justify-between font-mono text-[10px] text-steel-400">
          <span>НАГРУЗКА</span>
          <span className="num text-steel-200">{pct(ratio)}</span>
        </div>
        <Meter
          value={ratio}
          color={ratio > 1 ? '#f43f5e' : ratio > 0.9 ? '#facc15' : '#34d399'}
          height={8}
          label="Нагрузка энергосети"
        />
      </div>

      <dl className="num mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-steel-400">Генерация</dt>
        <dd className="text-right text-energy">{num(f.gen)} МВт</dd>
        <dt className="text-steel-400">Нагрузка</dt>
        <dd className="text-right text-steel-100">{num(f.load)} МВт</dd>
        <dt className="text-steel-400">{reserve >= 0 ? 'Резерв' : 'Дефицит'}</dt>
        <dd className={`text-right ${reserve >= 0 ? 'text-cash' : 'text-alert'}`}>{num(Math.abs(reserve))} МВт</dd>
        <dt className="flex items-center gap-1 text-steel-400">
          <Atom size={11} aria-hidden /> Реакторов
        </dt>
        <dd className="text-right text-steel-100">{reactors}</dd>
      </dl>

      {ev && ev.kind === 'grid' && (
        <div className="mt-2 rounded border border-energy/50 bg-energy/10 px-2.5 py-1.5 text-[11.5px] text-energy">
          {ev.name}: генерация ×{String(ev.factor).replace('.', ',')} ещё {Math.max(0, ev.endsAt - state.tick)} с
        </div>
      )}
      {reserve > 0 && (
        <p className="mt-2 text-[11px] text-steel-500">
          Запаса хватит примерно на {Math.floor(reserve / coderMw)} блок(ов) вайбкодинга по {num(coderMw)} МВт.
        </p>
      )}
    </Panel>
  );
}
