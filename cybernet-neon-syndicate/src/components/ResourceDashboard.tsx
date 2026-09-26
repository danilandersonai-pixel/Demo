import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  ChevronDown,
  Coins,
  Database,
  Gauge,
  Landmark,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BANKRUPTCY_DAYS, BUY_SPREAD, WEALTH_FREE, severityAt, threatAt } from '../game/config.ts';
import { effectiveDataPrice, hasResearch, netWorth, structuralEnergyNet } from '../game/economy.ts';
import { fmt, fmtRate } from '../game/format.ts';
import { useGameContext } from './GameContext.tsx';
import { ACCENT } from './ui/accent.ts';
import { AnimatedNumber } from './ui/AnimatedNumber.tsx';
import { cn } from './ui/cn.ts';
import { FloatingDelta } from './ui/FloatingDelta.tsx';
import { Meter } from './ui/Meter.tsx';
import { NeonButton } from './ui/NeonButton.tsx';
import { Panel } from './ui/Panel.tsx';
import { Sparkline } from './ui/Sparkline.tsx';

/** Модуль 1 — главный дашборд ресурсов: счётчики в реальном времени. */
export function ResourceDashboard({ className }: { className?: string }) {
  const { state } = useGameContext();
  return (
    <Panel
      id="resources"
      code="MOD-01 // RESOURCE_BUS"
      title="Дашборд ресурсов"
      icon={Gauge}
      accent="credit"
      className={className}
      actions={
        <span className="font-mono text-[10px] tracking-[0.2em] text-dim">
          ТИК 1 СЕК · СЕССИЯ #{state.runId}
        </span>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CreditsCard />
        <DataCard />
        <EnergyCard />
        <SyndicateCard />
      </div>
    </Panel>
  );
}

/** Время полёта «+15» — не дольше одного тика, иначе на 4× цифры наслаиваются. */
function flight(speed: number): number {
  return Math.min(1.1, 0.95 / Math.max(1, speed));
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('relative flex min-w-0 flex-col border border-line bg-void/40 p-3.5', className)}>{children}</div>;
}

function CardHead({ icon, label, tag, accent, right }: { icon: ReactNode; label: string; tag: string; accent: keyof typeof ACCENT; right?: ReactNode }) {
  const a = ACCENT[accent];
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className={a.text}>{icon}</span>
        <span className="font-mono text-[11px] font-semibold tracking-[0.22em] text-muted">{label}</span>
        <span className={cn('border px-1 font-mono text-[9px] tracking-widest', a.border, a.text)}>{tag}</span>
      </div>
      {right}
    </div>
  );
}

function Rate({ value, unit = '/день' }: { value: number; unit?: string }) {
  return (
    <span className={cn('font-mono text-xs font-medium', value >= 0 ? 'text-credit' : 'text-danger')}>
      {fmtRate(value)}
      <span className="text-[10px] opacity-70">{unit}</span>
    </span>
  );
}

function Row({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 font-mono text-[11px]">
      <span className="text-dim">{label}</span>
      <span className={cn('tabular', cls ?? 'text-muted')}>{value}</span>
    </div>
  );
}

function CreditsCard() {
  const { state, projection, running } = useGameContext();
  const [open, setOpen] = useState(false);
  const last = state.lastTick;
  const debt = state.bankruptDays > 0;
  const left = BANKRUPTCY_DAYS - state.bankruptDays;

  return (
    <Card className={cn(debt && 'border-danger/60 danger-pulse')}>
      <CardHead
        icon={<Coins className="size-4" />}
        label="КРЕДИТЫ"
        tag="CR"
        accent="credit"
        right={
          debt ? (
            <span className="flicker font-mono text-[10px] font-bold tracking-wider text-danger">ДЕФОЛТ ЧЕРЕЗ {left} ДН.</span>
          ) : null
        }
      />
      <div className="relative mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <AnimatedNumber
          value={state.credits}
          digits={state.credits < 1000 && state.credits > -1000 ? 1 : 0}
          className={cn('tabular font-mono text-[28px] font-bold leading-none', state.credits < 0 ? 'text-danger glow-danger' : 'text-credit glow-credit')}
        />
        <span className="font-mono text-sm text-credit/70">₵</span>
        <span className="relative inline-flex">
          <Rate value={projection.creditsDelta} />
          <FloatingDelta value={last?.credits.net ?? 0} tick={state.day} show={running} duration={flight(state.speed)} className="left-full top-0 ml-2" />
        </span>
      </div>
      <Sparkline values={state.history.credits} color={state.credits < 0 ? ACCENT.danger.hex : ACCENT.credit.hex} className="mt-3 h-10 w-full" label="История кредитов за 60 дней" />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-2 flex items-center gap-1 self-start font-mono text-[10px] tracking-[0.2em] text-dim transition-colors hover:text-muted"
      >
        ДЕТАЛИЗАЦИЯ <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1 border-t border-line pt-2">
              <Row label="Добыча (фермы, ядра)" value={fmtRate(projection.creditProduction)} cls="text-credit" />
              <Row label="Экспорт энергии" value={fmtRate(projection.exportIncome)} cls="text-credit" />
              <Row label="Авто-Брокер (посл. день)" value={fmtRate(last?.credits.broker ?? 0)} cls="text-credit" />
              <Row label="Содержание объектов" value={fmtRate(-projection.upkeep)} cls="text-danger" />
              <Row label="Накладные расходы" value={fmtRate(-projection.overhead)} cls="text-danger" />
              <Row label={`Отмывание капитала (сверх ${fmt(WEALTH_FREE)}₵)`} value={fmtRate(-projection.wealth)} cls="text-danger" />
              <Row label="Инфляция содержания" value={`×${projection.econ.inflation.toFixed(2)}`} cls="text-energy" />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
}

function DataCard() {
  const { state, econ, projection, dispatch, running } = useGameContext();
  const price = effectiveDataPrice(state);
  const history = state.market.history;
  const prev = history.length > 1 ? history[history.length - 2] : state.market.price;
  const up = state.market.price >= prev;
  const brokerReady = hasResearch(state, 'autoBroker');
  const playing = state.status === 'playing';
  const buyUnit = price * BUY_SPREAD;
  const room = Math.floor(econ.dataCap - state.data);
  const buyAmount = Math.min(50, room, Math.floor(Math.max(0, state.credits) / buyUnit));

  return (
    <Card>
      <CardHead
        icon={<Database className="size-4" />}
        label="ДАННЫЕ"
        tag="DB"
        accent="data"
        right={
          <span className="font-mono text-[10px] text-dim">
            {Math.round((state.data / Math.max(1, econ.dataCap)) * 100)}%
          </span>
        }
      />
      <div className="relative mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <AnimatedNumber value={state.data} className="tabular font-mono text-[28px] font-bold leading-none text-data glow-data" />
        <span className="font-mono text-sm text-dim">/ {fmt(econ.dataCap)}</span>
        <span className="relative inline-flex">
          <Rate value={projection.dataGain} />
          <FloatingDelta value={state.lastTick?.data.net ?? 0} tick={state.day} show={running} duration={flight(state.speed)} className="left-full top-0 ml-2" />
        </span>
      </div>
      <Meter value={state.data} max={econ.dataCap} color={ACCENT.data.hex} className="mt-3" label="Заполнение хранилища данных" />
      {projection.dataOverflow > 0.05 ? (
        <p className="mt-1.5 font-mono text-[10px] text-energy">Хранилище полно: теряется {fmt(projection.dataOverflow, 1)}/день</p>
      ) : null}

      <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] tracking-[0.2em] text-dim">ДАТА-БИРЖА</div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-sm">
            <span className="text-ink">1 ед. = {price.toFixed(2)}₵</span>
            {up ? <ArrowUpRight className="size-3.5 text-credit" aria-label="растёт" /> : <ArrowDownRight className="size-3.5 text-danger" aria-label="падает" />}
          </div>
        </div>
        <Sparkline values={history.slice(-40)} color={ACCENT.data.hex} width={120} height={32} className="h-8 w-24 shrink-0" label="Курс данных" />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <NeonButton size="xs" accent="data" disabled={!playing || state.data < 4} onClick={() => dispatch({ type: 'SELL_DATA', fraction: 0.25 })}>
          −25%
        </NeonButton>
        <NeonButton size="xs" accent="data" disabled={!playing || state.data < 2} onClick={() => dispatch({ type: 'SELL_DATA', fraction: 0.5 })}>
          −50%
        </NeonButton>
        <NeonButton size="xs" accent="data" disabled={!playing || state.data < 1} onClick={() => dispatch({ type: 'SELL_DATA', fraction: 1 })}>
          Всё
        </NeonButton>
        <NeonButton
          size="xs"
          accent="credit"
          disabled={!playing || buyAmount <= 0}
          onClick={() => dispatch({ type: 'BUY_DATA', amount: 50 })}
          title={`Купить до 50 ед. по ${buyUnit.toFixed(2)}₵ (наценка ×${BUY_SPREAD})`}
        >
          +{buyAmount > 0 ? buyAmount : 50} за {fmt((buyAmount > 0 ? buyAmount : 50) * buyUnit)}₵
        </NeonButton>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 font-mono text-[11px]">
        <span className="flex items-center gap-1.5 text-dim">
          <Bot className="size-3.5" /> Авто-Брокер
        </span>
        {brokerReady ? (
          <button
            type="button"
            role="switch"
            aria-checked={state.autoBrokerEnabled}
            onClick={() => dispatch({ type: 'TOGGLE_AUTOBROKER' })}
            className={cn(
              'relative h-5 w-10 border transition-colors',
              state.autoBrokerEnabled ? 'border-data/60 bg-data/20' : 'border-line bg-white/5',
            )}
          >
            <motion.span
              className={cn('absolute top-0.5 size-3.5', state.autoBrokerEnabled ? 'bg-data' : 'bg-dim')}
              animate={{ left: state.autoBrokerEnabled ? 22 : 2 }}
              transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            />
          </button>
        ) : (
          <span className="text-dim">нужно исследование</span>
        )}
      </div>
    </Card>
  );
}

function EnergyCard() {
  const { state, econ, projection, running } = useGameContext();
  const spare = structuralEnergyNet(state);
  const load = econ.energyProd > 0 ? econ.energyUse / econ.energyProd : econ.energyUse > 0 ? 1 : 0;
  const status = state.blackout
    ? { text: 'БЛЭКАУТ', cls: 'text-danger border-danger/50 bg-danger/10 flicker' }
    : projection.energyDelta < -0.05
      ? { text: 'ДЕФИЦИТ', cls: 'text-energy border-energy/50 bg-energy/10' }
      : projection.energyExported > 0.05
        ? { text: 'ЭКСПОРТ', cls: 'text-credit border-credit/40 bg-credit/10' }
        : { text: 'СТАБИЛЬНО', cls: 'text-data border-data/40 bg-data/10' };

  return (
    <Card className={cn(state.blackout && 'border-danger/60')}>
      <CardHead
        icon={<Zap className="size-4" />}
        label="ЭНЕРГИЯ"
        tag="PWR"
        accent="energy"
        right={<span className={cn('border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest', status.cls)}>{status.text}</span>}
      />
      <div className="relative mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <AnimatedNumber value={state.energy} className={cn('tabular font-mono text-[28px] font-bold leading-none', state.blackout ? 'text-danger glow-danger' : 'text-energy glow-energy')} />
        <span className="font-mono text-sm text-dim">/ {fmt(econ.energyCap)}</span>
        <span className="relative inline-flex">
          <Rate value={projection.energyDelta} />
          <FloatingDelta value={state.lastTick?.energy.net ?? 0} tick={state.day} show={running} duration={flight(state.speed)} className="left-full top-0 ml-2" />
        </span>
      </div>
      <Meter value={state.energy} max={econ.energyCap} color={state.blackout ? ACCENT.danger.hex : ACCENT.energy.hex} className="mt-3" label="Заряд энергохранилища" />
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 font-mono text-[11px]">
        <div>
          <div className="text-dim">ВЫРАБОТКА</div>
          <div className="tabular text-sm text-energy">▲ {fmt(econ.energyProd, 1)}⚡</div>
        </div>
        <div>
          <div className="text-dim">ПОТРЕБЛЕНИЕ</div>
          <div className="tabular text-sm text-muted">▼ {fmt(econ.energyUse, 1)}⚡</div>
        </div>
      </div>
      <div className="mt-2.5">
        <div className="mb-1 flex justify-between font-mono text-[10px] text-dim">
          <span>НАГРУЗКА СЕТИ</span>
          <span className={cn('tabular', load > 1 ? 'text-danger' : load > 0.85 ? 'text-energy' : 'text-muted')}>{Math.round(load * 100)}%</span>
        </div>
        <Meter value={Math.min(load, 1)} max={1} color={load > 1 ? ACCENT.danger.hex : load > 0.85 ? ACCENT.energy.hex : ACCENT.data.hex} label="Нагрузка сети" segments={10} />
      </div>
      <p className="mt-2.5 font-mono text-[11px] text-dim">
        Свободная мощность:{' '}
        <span className={cn('tabular', spare > 0 ? 'text-credit' : 'text-danger')}>
          {spare >= 0 ? '+' : ''}
          {fmt(spare, 1)}⚡
        </span>
      </p>
      {state.blackout ? (
        <p className="mt-1 text-[11px] leading-snug text-danger">
          Производство стоит. Сеть перезапустится при заряде {Math.round(econ.energyCap * (hasResearch(state, 'grapheneCells') ? 0.15 : 0.25))}⚡.
        </p>
      ) : null}
    </Card>
  );
}

function SyndicateCard() {
  const { state, projection } = useGameContext();
  const worth = netWorth(state);
  const threat = threatAt(state.day);
  const threatLabel = threat < 0.25 ? 'НИЗКАЯ' : threat < 0.5 ? 'УМЕРЕННАЯ' : threat < 0.75 ? 'ВЫСОКАЯ' : 'КРИТИЧЕСКАЯ';
  // Сравниваем с рекордом на момент старта забега — иначе шкала всегда полна.
  const record = state.baseline.days;
  const toRecord = record > 0 ? Math.min(1, state.day / record) : 1;

  return (
    <Card>
      <CardHead icon={<Landmark className="size-4" />} label="СИНДИКАТ" tag="HQ" accent="research" />
      <div className="mt-3 font-mono text-[10px] tracking-[0.2em] text-dim">ЧИСТАЯ СТОИМОСТЬ</div>
      <div className="mt-1 flex items-baseline gap-2">
        <AnimatedNumber value={worth} className="tabular font-mono text-[22px] font-bold leading-none text-research glow-research" />
        <span className="font-mono text-sm text-research/70">₵</span>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-dim">
          <span className="flex items-center gap-1">
            <ShieldAlert className="size-3" /> ДОЛГОВОЙ ТАЙМЕР
          </span>
          <span className={state.bankruptDays > 0 ? 'text-danger' : 'text-muted'}>
            {state.bankruptDays}/{BANKRUPTCY_DAYS}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1" aria-label={`Дней в минусе: ${state.bankruptDays} из ${BANKRUPTCY_DAYS}`}>
          {Array.from({ length: BANKRUPTCY_DAYS }, (_, i) => (
            <span key={i} className={cn('h-2', i < state.bankruptDays ? 'bg-danger shadow-[0_0_8px_var(--color-danger)]' : 'bg-white/[0.06]')} />
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-1 border-t border-line pt-3">
        <Row label="Расходы в день" value={fmtRate(-(projection.upkeep + projection.overhead + projection.wealth))} cls="text-danger" />
        <Row label="Инфляция" value={`×${projection.econ.inflation.toFixed(2)}`} cls="text-energy" />
        <Row label="Угроза" value={`${threatLabel} ×${severityAt(state.day).toFixed(1)}`} cls={threat >= 0.5 ? 'text-danger' : 'text-muted'} />
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between font-mono text-[10px] text-dim">
          <span>ДО РЕКОРДА ВЫЖИВАНИЯ</span>
          <span className={cn('tabular', record > 0 && state.day > record ? 'text-credit' : 'text-muted')}>
            {record > 0 ? (state.day > record ? `РЕКОРД +${state.day - record}` : `${state.day}/${record}`) : 'первый забег'}
          </span>
        </div>
        <Meter value={toRecord} max={1} color={ACCENT.research.hex} label="Прогресс к рекорду" segments={12} />
      </div>
    </Card>
  );
}
