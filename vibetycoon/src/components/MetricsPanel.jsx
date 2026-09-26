import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, Cpu, Flame, Gauge, ShieldCheck, TrendingUp, Wallet, Wrench } from 'lucide-react';
import { Bar, Panel } from './ui.jsx';
import { compact, hoursLabel, money, num, signedMoney, stamp } from '../game/format.js';
import { averageNet } from '../game/engine.js';

// Анимированное число: мягко подсвечивается при изменении
function Flash({ value, children, className = '' }) {
  return (
    <motion.span
      key={Math.round(value * 100)}
      initial={{ opacity: 0.55, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={className}
    >
      {children}
    </motion.span>
  );
}

function MetricCard({ icon: Icon, label, accent, children, footer, title }) {
  const ring = {
    amber: 'border-amber-400/25 hover:border-amber-400/50',
    cyan: 'border-cyan-400/25 hover:border-cyan-400/50',
    violet: 'border-violet-400/25 hover:border-violet-400/50',
    rose: 'border-rose-400/30 hover:border-rose-400/60',
    emerald: 'border-emerald-400/25 hover:border-emerald-400/50',
  }[accent];
  const iconTone = {
    amber: 'text-amber-300',
    cyan: 'text-cyan-300',
    violet: 'text-violet-300',
    rose: 'text-rose-300',
    emerald: 'text-emerald-300',
  }[accent];
  return (
    <div title={title} className={`min-w-0 rounded-xl border bg-slate-950/40 p-3 transition-colors ${ring}`}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
        <Icon className={`h-3.5 w-3.5 ${iconTone}`} aria-hidden="true" />
        {label}
      </div>
      {children}
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}

// Столбчатый график чистого дохода по часам (плюс — янтарный, минус — розовый)
function IncomeChart({ history }) {
  const [hover, setHover] = useState(null);
  const data = history.slice(-48);
  const W = 480;
  const H = 96;
  const pad = 2;
  const max = Math.max(1, ...data.map((d) => Math.abs(d.net)));
  const hasNeg = data.some((d) => d.net < 0);
  const zeroY = hasNeg ? H / 2 : H - 4;
  const scale = (hasNeg ? H / 2 - 6 : H - 10) / max;
  const slot = W / 48;
  const barW = Math.max(2, slot - pad);
  const hd = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-24 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Чистый доход по часам за последние ${data.length} ч`}
        onMouseLeave={() => setHover(null)}
      >
        <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="rgba(148,163,184,0.25)" strokeWidth="1" />
        {data.map((d, i) => {
          const h = Math.max(1.5, Math.abs(d.net) * scale);
          const x = i * slot + pad / 2 + (48 - data.length) * slot;
          const y = d.net >= 0 ? zeroY - h : zeroY;
          return (
            <g key={d.hour}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx="1.5"
                fill={d.net >= 0 ? '#f59e0b' : '#fb7185'}
                opacity={hover === null || hover === i ? 0.9 : 0.35}
              />
              <rect x={x - pad / 2} y="0" width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {data.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-xs text-slate-500">Ожидание первых данных…</div>
      )}
      <AnimatePresence>
        {hd && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute right-0 top-0 rounded-lg border border-slate-700 bg-slate-950/95 px-2.5 py-1.5 text-[11px] shadow-xl"
          >
            <div className="text-slate-400">{stamp(hd.hour)}</div>
            <div className="text-slate-300">доход {signedMoney(hd.revenue, 0)}</div>
            <div className="text-slate-300">расходы {money(-hd.cost, 0)}</div>
            <div className="font-semibold text-slate-100">итог {signedMoney(hd.net, 0)}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function MetricsPanel({ game, derived, records }) {
  const f = derived.factors;
  const loadPct = f.cap > 0 ? f.usage / f.cap : 1;
  const avg6 = averageNet(game, 6);
  const q = game.quality;
  const qTone = q >= 80 ? 'emerald' : q >= 55 ? 'amber' : 'rose';
  const debtTone = game.debt < 35 ? 'emerald' : game.debt < 65 ? 'amber' : 'rose';

  return (
    <Panel accent="amber" className="p-3 sm:p-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-7">
        <MetricCard icon={Wallet} label="Баланс" accent="amber" title="Деньги на аренду серверов и API-ключи">
          <div className={`text-xl font-bold tabular-nums ${game.money < 0 ? 'text-rose-300' : 'text-amber-200 neon-text-amber'}`}>
            <Flash value={game.money}>{money(game.money, 0)}</Flash>
          </div>
          <div className={`text-[11px] tabular-nums ${avg6 >= 0 ? 'text-amber-300/80' : 'text-rose-300'}`}>
            {signedMoney(avg6, 0)}/ч (среднее за 6 ч)
          </div>
        </MetricCard>

        <MetricCard
          icon={Cpu}
          label="Compute"
          accent={loadPct > 1 ? 'rose' : 'cyan'}
          title="Загрузка кластера: модели агентов и модули кода"
          footer={<Bar value={loadPct} tone={loadPct > 1 ? 'rose' : loadPct > 0.85 ? 'amber' : 'cyan'} />}
        >
          <div className="text-xl font-bold tabular-nums text-slate-100">
            {f.usage}
            <span className="text-sm text-slate-500"> / {f.cap} TFLOPS</span>
          </div>
          <div className={`text-[11px] ${loadPct > 1 ? 'text-rose-300' : 'text-slate-500'}`}>
            {loadPct > 1 ? `перегрузка! агенты на ${(f.throttle * 100).toFixed(0)}%` : `загрузка ${(loadPct * 100).toFixed(0)}%`}
          </div>
        </MetricCard>

        <MetricCard icon={Gauge} label="Токены / сек" accent="cyan" title="Суммарная скорость генерации всех агентов">
          <div className="text-xl font-bold tabular-nums text-cyan-200 neon-text-cyan">
            <Flash value={derived.tps}>{num(derived.tps, 0)}</Flash>
            <span className="text-sm text-slate-500"> TPS</span>
          </div>
          <div className="text-[11px] text-slate-500">{compact(derived.tps * 3600)} ток./ч · скорость ×{f.speedMult.toFixed(2)}</div>
        </MetricCard>

        <MetricCard
          icon={ShieldCheck}
          label="Качество"
          accent={qTone}
          title="Качество автоматизации: падает от галлюцинаций, тех-долга и слабых моделей"
          footer={<Bar value={q / 100} tone={qTone} />}
        >
          <div className={`text-xl font-bold tabular-nums ${q >= 80 ? 'text-emerald-200' : q >= 55 ? 'text-amber-200' : 'text-rose-300'}`}>
            {q.toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-500">
            цель {derived.qualityTarget.toFixed(0)}% · выручка ×{f.qualityFactor.toFixed(2)}
          </div>
        </MetricCard>

        <MetricCard
          icon={Wrench}
          label="Тех-долг"
          accent={debtTone}
          title="Растёт от новых фич и со временем. Замедляет систему и раздувает расход токенов"
          footer={<Bar value={game.debt / 100} tone={debtTone} />}
        >
          <div className={`text-xl font-bold tabular-nums ${game.debt < 35 ? 'text-emerald-200' : game.debt < 65 ? 'text-amber-200' : 'text-rose-300'}`}>
            {game.debt.toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-500">
            токены ×{f.debt.tokenCost.toFixed(2)} · скорость ×{f.debt.speed.toFixed(2)}
          </div>
        </MetricCard>

        <MetricCard icon={Activity} label="Стабильность" accent="violet" title="Часы без критических галлюцинаций">
          <div className="text-xl font-bold tabular-nums text-violet-200">{hoursLabel(game.streak)}</div>
          <div className="text-[11px] text-slate-500">рекорд {hoursLabel(Math.max(records.maxStreak, game.streak))}</div>
        </MetricCard>

        <MetricCard icon={TrendingUp} label="Прогноз / час" accent={derived.net >= 0 ? 'amber' : 'rose'} title="Ожидаемый чистый доход в следующий час">
          <div className={`text-xl font-bold tabular-nums ${derived.net >= 0 ? 'text-amber-200' : 'text-rose-300'}`}>
            {signedMoney(derived.net, 0)}
          </div>
          <div className="text-[11px] text-slate-500">рекорд {money(Math.max(records.maxIncome, 0), 0)}/ч</div>
        </MetricCard>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 pb-2 pt-2">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
            <span>Чистый доход по часам, последние 48 ч</span>
            <span className="normal-case tracking-normal">наведите на столбец</span>
          </div>
          <IncomeChart history={game.history} />
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[11px]">
          <div className="col-span-2 mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
            <Flame className="h-3 w-3 text-amber-300" aria-hidden="true" /> Юнит-экономика часа
          </div>
          <span className="text-slate-500">Выручка агентов</span>
          <span className="text-right tabular-nums text-emerald-300">{signedMoney(derived.revenue, 0)}</span>
          <span className="text-slate-500">Автоматизации</span>
          <span className="text-right tabular-nums text-emerald-300">{signedMoney(derived.moduleIncome, 0)}</span>
          <span className="text-slate-500">Токены (API)</span>
          <span className="text-right tabular-nums text-rose-300">{money(-derived.tokenCost, 0)}</span>
          <span className="text-slate-500">Аренда серверов</span>
          <span className="text-right tabular-nums text-rose-300">{money(-derived.rent, 0)}</span>
          <span className="text-slate-500">Энергия</span>
          <span className="text-right tabular-nums text-rose-300">{money(-derived.energy, 0)}</span>
          <span className="text-slate-500">Риск штрафов</span>
          <span className="text-right tabular-nums text-rose-300">{money(-derived.expectedPenalty, 0)}</span>
          {derived.sla > 0 && (
            <>
              <span className="text-rose-400">Компенсации SLA</span>
              <span className="text-right tabular-nums text-rose-300">{money(-derived.sla, 0)}</span>
            </>
          )}
        </div>
      </div>
      {(game.outage > 0 || f.broke) && (
        <div role="alert" className="mt-3 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {game.outage > 0
            ? `⚠ Прод лежит ещё ${game.outage} ч — агенты и модули не приносят денег. Запустите Vibe Clean, чтобы это не повторилось.`
            : '⚠ Баланс отрицательный: API-ключи заблокированы, агенты простаивают. Продайте лишние серверы во вкладке «Инфраструктура».'}
        </div>
      )}
    </Panel>
  );
}
