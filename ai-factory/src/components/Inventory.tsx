import { Boxes, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { RES_META } from '../game/config';
import { money, num, perSec, signed } from '../game/format';
import { avgIncome } from '../game/selectors';
import type { GameState, SellableRes } from '../game/types';
import { RES_ICONS } from '../ui/icons';
import { AnimatedNumber, Meter, Panel, Switch } from '../ui/primitives';

function deltaClass(v: number): string {
  if (v > 0.005) return 'text-cash';
  if (v < -0.005) return 'text-alert';
  return 'text-steel-400';
}

function Row({
  icon: Icon,
  name,
  color,
  value,
  total,
  unit,
  fill,
  delta,
  detail,
  extra,
}: {
  icon: LucideIcon;
  name: string;
  color: string;
  value: ReactNode;
  total?: string;
  unit: string;
  fill?: number;
  delta: { text: string; className: string };
  detail?: string;
  extra?: ReactNode;
}) {
  const full = fill !== undefined && fill >= 0.995;
  return (
    <div className="border-b border-steel-800/80 py-2 first:pt-0 last:border-0 last:pb-0">
      <div className="flex items-center gap-2">
        <Icon size={14} color={color} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-steel-200">{name}</span>
        <span className="num text-[13px] font-semibold" style={{ color }}>
          {value}
        </span>
        {total !== undefined && <span className="num text-[10px] text-steel-500">/ {total}</span>}
        <span className="num w-10 text-[10px] text-steel-500">{unit}</span>
      </div>
      {fill !== undefined && (
        <Meter value={fill} color={full ? '#fb923c' : color} height={4} className="mt-1.5" label={`${name}: заполнение`} />
      )}
      <div className="num mt-1 flex items-center justify-between gap-2 text-[10.5px]">
        <span className={`font-semibold ${delta.className}`}>{delta.text}</span>
        <span className="truncate text-steel-400">{full ? 'СКЛАД ПОЛОН' : detail}</span>
      </div>
      {extra}
    </div>
  );
}

export function Inventory({
  state,
  onAutoSell,
}: {
  state: GameState;
  onAutoSell: (res: SellableRes, on: boolean) => void;
}) {
  const f = state.flow;
  const net = (k: 'data' | 'code' | 'models') => f.prod[k] - f.cons[k] - (k === 'models' ? 0 : f.sold[k]);
  const detail = (k: 'data' | 'code' | 'models') => {
    const parts = [`▲${num(f.prod[k])}`, `▼${num(f.cons[k])}`];
    if (k !== 'models' && f.sold[k] > 0.005) parts.push(`⇄${num(f.sold[k])}`);
    return parts.join(' ');
  };
  const reserve = f.gen - f.load;
  const computeFree = f.computeSupply - f.computeDemand;
  const income = avgIncome(state);

  return (
    <Panel code="MOD-01" title="Склад" icon={Boxes} color="#22d3ee">
      {(['data', 'code', 'models'] as const).map((k) => {
        const meta = RES_META[k];
        const d = net(k);
        return (
          <Row
            key={k}
            icon={RES_ICONS[k]}
            name={meta.name}
            color={meta.color}
            value={num(state.res[k])}
            total={num(f.caps[k])}
            unit={meta.unit}
            fill={state.res[k] / f.caps[k]}
            delta={{ text: `${perSec(d)} ${meta.unit}`, className: deltaClass(d) }}
            detail={detail(k)}
            extra={
              k !== 'models' ? (
                <div className="mt-1.5">
                  <Switch
                    id={`autosell-${k}`}
                    checked={state.autoSell[k]}
                    onChange={(v) => onAutoSell(k, v)}
                    label="Автопродажа излишков"
                    color={meta.color}
                  />
                </div>
              ) : undefined
            }
          />
        );
      })}
      <Row
        icon={RES_ICONS.energy}
        name={RES_META.energy.name}
        color={RES_META.energy.color}
        value={num(f.load)}
        total={num(f.gen)}
        unit="МВт"
        fill={f.gen > 0 ? f.load / f.gen : f.load > 0 ? 1 : 0}
        delta={{
          text: reserve >= 0 ? `${signed(reserve)} МВт резерв` : `${signed(reserve)} МВт дефицит`,
          className: reserve >= 0 ? 'text-cash' : 'text-alert',
        }}
        detail="нагрузка / генерация"
      />
      <Row
        icon={RES_ICONS.compute}
        name={RES_META.compute.name}
        color={RES_META.compute.color}
        value={num(f.computeDemand)}
        total={num(f.computeSupply)}
        unit="PFLOPS"
        fill={f.computeSupply > 0 ? f.computeDemand / f.computeSupply : f.computeDemand > 0 ? 1 : 0}
        delta={{
          text: computeFree >= 0 ? `${signed(computeFree)} свободно` : `${signed(computeFree)} не хватает`,
          className: computeFree >= 0 ? 'text-cash' : 'text-alert',
        }}
        detail="спрос / мощность"
      />
      <Row
        icon={RES_ICONS.credits}
        name={RES_META.credits.name}
        color={RES_META.credits.color}
        value={<AnimatedNumber value={state.credits} format={money} />}
        unit=""
        delta={{ text: `${income >= 0 ? '+' : ''}${money(income)}/с`, className: deltaClass(income) }}
        detail="пассивный доход"
      />
    </Panel>
  );
}
