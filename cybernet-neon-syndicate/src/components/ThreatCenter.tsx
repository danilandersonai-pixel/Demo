import { motion } from 'framer-motion';
import { Radar, Siren } from 'lucide-react';
import { EVENT_INTERVAL, severityAt, threatAt } from '../game/config.ts';
import { fmtPct } from '../game/format.ts';
import type { Modifier } from '../game/types.ts';
import { useGameContext } from './GameContext.tsx';
import { TONE_TEXT } from './ui/accent.ts';
import { cn } from './ui/cn.ts';
import { EVENT_ICONS } from './ui/icons.ts';
import { NeonButton } from './ui/NeonButton.tsx';
import { Panel } from './ui/Panel.tsx';

const TARGET_LABEL: Record<Modifier['target'], string> = {
  energyProd: 'Выработка энергии',
  solarOutput: 'Солнечные панели',
  energyUse: 'Энергопотребление',
  minerOutput: 'Доход майнинга',
  creditOutput: 'Добыча кредитов',
  dataOutput: 'Генерация данных',
  dataPrice: 'Цена данных',
  upkeep: 'Содержание',
};

/** Хорош ли эффект для игрока: рост потребления и содержания — плохо, остальное — наоборот. */
function isGood(mod: Modifier): boolean {
  const inverse = mod.target === 'energyUse' || mod.target === 'upkeep';
  return inverse ? mod.value < 0 : mod.value > 0;
}

export function describeModifier(mod: Modifier): string {
  return `${TARGET_LABEL[mod.target]} ${fmtPct(mod.value)}`;
}

const LEVELS = ['НИЗКИЙ', 'УМЕРЕННЫЙ', 'ВЫСОКИЙ', 'КРИТИЧЕСКИЙ'];

/** Модуль 4 — система угроз и глобальных событий. */
export function ThreatCenter({ className, onOpenDecision }: { className?: string; onOpenDecision: () => void }) {
  const { state } = useGameContext();
  const cycle = state.day % EVENT_INTERVAL;
  const left = EVENT_INTERVAL - cycle;
  const threat = threatAt(state.day);
  const level = Math.min(3, Math.floor(threat * 4));
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const pending = state.pending;

  return (
    <Panel
      id="threats"
      code="MOD-04 // THREAT_MATRIX"
      title="Угрозы и события"
      icon={Radar}
      accent="danger"
      className={className}
      delay={0.15}
      actions={
        <span className="font-mono text-[10px] tracking-[0.2em] text-dim">
          ПЕРЕЖИТО <span className="text-ink">{state.stats.events}</span>
        </span>
      }
    >
      <div className="flex items-center gap-4">
        <div className="relative size-24 shrink-0">
          <svg viewBox="0 0 96 96" className="size-24 -rotate-90" aria-hidden>
            <circle cx="48" cy="48" r={radius} fill="none" stroke="rgb(148 180 220 / 0.1)" strokeWidth="6" />
            {Array.from({ length: EVENT_INTERVAL }, (_, i) => {
              const angle = (i / EVENT_INTERVAL) * Math.PI * 2;
              return (
                <line
                  key={i}
                  x1={48 + Math.cos(angle) * 30}
                  y1={48 + Math.sin(angle) * 30}
                  x2={48 + Math.cos(angle) * (i % 5 === 0 ? 26 : 28)}
                  y2={48 + Math.sin(angle) * (i % 5 === 0 ? 26 : 28)}
                  stroke="rgb(148 180 220 / 0.25)"
                  strokeWidth="1"
                />
              );
            })}
            <motion.circle
              cx="48"
              cy="48"
              r={radius}
              fill="none"
              stroke={left <= 5 ? 'var(--color-danger)' : 'var(--color-research)'}
              strokeWidth="6"
              strokeLinecap="butt"
              strokeDasharray={circumference}
              initial={false}
              animate={{ strokeDashoffset: circumference * (1 - cycle / EVENT_INTERVAL) }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              style={{ filter: `drop-shadow(0 0 6px ${left <= 5 ? '#ff4d6d' : '#b18cff'})` }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className={cn('tabular font-mono text-2xl font-bold leading-none', left <= 5 ? 'text-danger glow-danger' : 'text-ink')}>{left}</div>
              <div className="mt-0.5 font-mono text-[9px] tracking-[0.2em] text-dim">ДН.</div>
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] tracking-[0.2em] text-dim">СЛЕДУЮЩЕЕ СОБЫТИЕ</div>
          <div className="text-[13px] text-ink">на {state.day + left}-й день</div>
          <div className="mt-3 font-mono text-[10px] tracking-[0.2em] text-dim">УРОВЕНЬ УГРОЗЫ</div>
          <div className="mt-1 grid grid-cols-4 gap-1" aria-label={`Уровень угрозы: ${LEVELS[level]}`}>
            {LEVELS.map((name, i) => (
              <span
                key={name}
                className={cn(
                  'h-2',
                  i <= level ? (i >= 2 ? 'bg-danger shadow-[0_0_8px_var(--color-danger)]' : i === 1 ? 'bg-energy' : 'bg-credit') : 'bg-white/[0.06]',
                )}
              />
            ))}
          </div>
          <div className={cn('mt-1 font-mono text-[11px]', level >= 2 ? 'text-danger' : 'text-muted')}>
            {LEVELS[level]} · тяжесть ×{severityAt(state.day).toFixed(1)}
          </div>
        </div>
      </div>

      {pending ? (
        <div className="danger-pulse mt-4 border border-danger/60 bg-danger/[0.08] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.2em] text-danger">
              <Siren className="size-3.5" /> ТРЕБУЕТСЯ РЕШЕНИЕ
            </span>
            <span className="font-mono text-[10px] text-danger">{Math.max(0, pending.expiresDay - state.day)} дн.</span>
          </div>
          <div className="mt-1 text-[13px] font-semibold text-ink">{pending.title}</div>
          <NeonButton size="xs" variant="solid" accent="danger" className="mt-2" onClick={onOpenDecision}>
            Принять решение
          </NeonButton>
        </div>
      ) : null}

      <div className="mt-4">
        <div className="mb-2 font-mono text-[10px] tracking-[0.2em] text-dim">АКТИВНЫЕ ЭФФЕКТЫ</div>
        {state.modifiers.length === 0 ? (
          <p className="border border-dashed border-line px-3 py-2 font-mono text-[11px] text-dim">Эфир чист — временных эффектов нет</p>
        ) : (
          <ul className="space-y-1.5">
            {state.modifiers.map((mod) => {
              const Icon = EVENT_ICONS[mod.eventId];
              const good = isGood(mod);
              const total = Math.max(1, mod.endsDay - mod.startDay);
              const remaining = Math.max(0, mod.endsDay - state.day);
              return (
                <li key={mod.id} className={cn('border px-2.5 py-2', good ? 'border-credit/30 bg-credit/[0.05]' : 'border-danger/30 bg-danger/[0.05]')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className={cn('size-3.5 shrink-0', good ? 'text-credit' : 'text-danger')} aria-hidden />
                      <span className="truncate text-[12px] text-ink">{mod.label}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-dim">{remaining} дн.</span>
                  </div>
                  <div className={cn('mt-0.5 font-mono text-[11px]', good ? 'text-credit' : 'text-danger')}>{describeModifier(mod)}</div>
                  <div className="mt-1.5 h-0.5 bg-white/[0.06]">
                    <motion.div
                      className={cn('h-full', good ? 'bg-credit' : 'bg-danger')}
                      initial={false}
                      animate={{ width: `${(remaining / total) * 100}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-2 font-mono text-[10px] tracking-[0.2em] text-dim">ХРОНИКА СОБЫТИЙ</div>
        {state.eventHistory.length === 0 ? (
          <p className="font-mono text-[11px] text-dim">Первое событие — на {EVENT_INTERVAL}-й день.</p>
        ) : (
          <ul className="space-y-2">
            {state.eventHistory.slice(0, 5).map((record) => {
              const Icon = EVENT_ICONS[record.eventId];
              return (
                <li key={`${record.id}-${record.day}`} className="flex gap-2.5">
                  <Icon className={cn('mt-0.5 size-3.5 shrink-0', TONE_TEXT[record.tone])} aria-hidden />
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] text-dim">
                      ДЕНЬ {record.day} · {record.title.toUpperCase()}
                    </div>
                    <div className={cn('text-[12px] leading-snug', TONE_TEXT[record.tone])}>{record.outcome}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}
