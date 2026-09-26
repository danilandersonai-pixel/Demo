import { AnimatePresence, motion } from 'framer-motion';
import { CircleHelp, Coins, Database, FastForward, Hexagon, Pause, Play, RotateCcw, Trophy, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EVENT_INTERVAL } from '../game/config.ts';
import { fmt, fmtRate, padDay } from '../game/format.ts';
import type { Speed } from '../game/types.ts';
import { useGameContext } from './GameContext.tsx';
import { AnimatedNumber } from './ui/AnimatedNumber.tsx';
import { cn } from './ui/cn.ts';
import { NeonButton } from './ui/NeonButton.tsx';

interface HeaderProps {
  pausedReason: string | null;
  onSpeed: (speed: Speed) => void;
  onHelp: () => void;
  onNewGame: () => void;
  /** Шапка под открытым окном — убрать её из порядка фокуса. */
  inert?: boolean;
}

const SPEEDS: Array<{ speed: Speed; label: string }> = [
  { speed: 1, label: '1×' },
  { speed: 2, label: '2×' },
  { speed: 4, label: '4×' },
];

export function Header({ pausedReason, onSpeed, onHelp, onNewGame, inert }: HeaderProps) {
  const { state, projection, running } = useGameContext();
  const [confirming, setConfirming] = useState(false);
  const popover = useRef<HTMLDivElement>(null);

  // Подтверждение «Новой игры» закрывается по Esc и по клику мимо.
  useEffect(() => {
    if (!confirming) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirming(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (popover.current && !popover.current.contains(event.target as Node)) setConfirming(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [confirming]);
  const cycle = state.day % EVENT_INTERVAL;
  const status = state.status === 'gameover'
    ? { text: 'ЛИКВИДИРОВАН', cls: 'text-danger' }
    : state.blackout
      ? { text: 'БЛЭКАУТ', cls: 'text-danger' }
      : running
        ? { text: 'ОНЛАЙН', cls: 'text-credit' }
        : { text: pausedReason ?? 'ПАУЗА', cls: 'text-energy' };

  return (
    <header
      className="sticky z-40 border-b border-line bg-void/80 backdrop-blur-xl"
      style={{ top: 'env(safe-area-inset-top, 0px)' }}
      inert={inert}
    >
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-6">
        {/* Логотип */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative grid size-10 shrink-0 place-items-center">
            <Hexagon className="absolute size-10 text-credit/80" strokeWidth={1.25} aria-hidden />
            <Hexagon className="size-4 fill-data/80 text-data" strokeWidth={1.5} aria-hidden />
          </div>
          <div className="min-w-0 leading-none">
            <div className="font-display text-[17px] font-bold tracking-[0.08em] text-ink sm:text-lg">CYBERNET</div>
            <div className="mt-1 font-mono text-[10px] tracking-[0.34em] text-muted">// NEON SYNDICATE</div>
          </div>
        </div>

        {/* День и статус */}
        <div className="flex items-center gap-4 border-line sm:border-l sm:pl-5">
          <div className="leading-none">
            <div className="font-mono text-[10px] tracking-[0.3em] text-dim">ДЕНЬ</div>
            <div className="tabular mt-1 font-mono text-2xl font-bold text-ink">{padDay(state.day)}</div>
          </div>
          <div className="hidden leading-none md:block">
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.25em]">
              <span className={cn('led inline-block size-1.5 rounded-full', status.cls, 'bg-current')} />
              <span className={status.cls}>{status.text}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1 w-28 overflow-hidden bg-white/5">
                <motion.div
                  className="h-full bg-research"
                  initial={false}
                  animate={{ width: `${(cycle / EVENT_INTERVAL) * 100}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              <span className="font-mono text-[10px] text-dim">событие через {EVENT_INTERVAL - cycle} дн.</span>
            </div>
          </div>
        </div>

        {/* Скорость */}
        <div className="flex items-center gap-1" role="group" aria-label="Скорость игры">
          <button
            type="button"
            onClick={() => onSpeed(0)}
            disabled={state.status !== 'playing'}
            aria-label={state.speed === 0 ? 'Продолжить' : 'Пауза'}
            title="Пауза — пробел"
            className={cn(
              'chamfer-sm grid size-8 place-items-center border transition-colors',
              state.speed === 0 ? 'border-energy/60 bg-energy/15 text-energy' : 'border-line text-muted hover:text-ink',
            )}
          >
            {state.speed === 0 ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </button>
          {SPEEDS.map(({ speed, label }) => (
            <button
              key={speed}
              type="button"
              onClick={() => onSpeed(speed)}
              disabled={state.status !== 'playing'}
              aria-pressed={state.speed === speed}
              title={`Скорость ${label} — клавиша ${speed === 4 ? 3 : speed}`}
              className={cn(
                'chamfer-sm h-8 min-w-9 border px-2 font-mono text-xs font-semibold transition-colors',
                state.speed === speed ? 'border-data/60 bg-data/15 text-data' : 'border-line text-muted hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
          <FastForward className="ml-1 hidden size-3.5 text-dim lg:block" aria-hidden />
          <span className="hidden font-mono text-[10px] text-dim lg:block">1 сек = 1 день</span>
        </div>

        {/* Рекорды и меню */}
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-3 border border-line bg-white/[0.02] px-3 py-1.5 sm:flex" title="Зал славы">
            <Trophy className="size-4 text-energy" aria-hidden />
            <div className="font-mono text-[11px] leading-tight">
              <div className="text-dim">
                РЕКОРД <span className="text-ink">{state.records.bestDays}</span> дн.
              </div>
              <div className="text-dim">
                КАПИТАЛ <span className="text-credit">{fmt(state.records.bestCapital)}₵</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onHelp}
            aria-label="Как играть"
            title="Как играть — H"
            className="chamfer-sm grid size-9 place-items-center border border-line text-muted transition-colors hover:text-ink"
          >
            <CircleHelp className="size-4" />
          </button>
          <div className="relative" ref={popover}>
            <button
              type="button"
              onClick={() => setConfirming((v) => !v)}
              aria-label="Новая игра"
              aria-expanded={confirming}
              title="Новая игра"
              className="chamfer-sm grid size-9 place-items-center border border-line text-muted transition-colors hover:border-danger/50 hover:text-danger"
            >
              <RotateCcw className="size-4" />
            </button>
            <AnimatePresence>
              {confirming ? (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="panel absolute right-0 top-11 z-50 w-64 border-danger/40 bg-deep p-3"
                  role="dialog"
                  aria-label="Подтверждение новой игры"
                >
                  <p className="text-[13px] leading-snug text-ink">Начать новую игру?</p>
                  <p className="mt-1 text-xs leading-snug text-muted">
                    Текущий забег закончится. Если он длился 10+ дней, он попадёт в Зал славы.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <NeonButton
                      accent="danger"
                      variant="solid"
                      size="xs"
                      onClick={() => {
                        setConfirming(false);
                        onNewGame();
                      }}
                    >
                      Заново
                    </NeonButton>
                    <NeonButton variant="ghost" size="xs" onClick={() => setConfirming(false)}>
                      Отмена
                    </NeonButton>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Компактные ресурсы — всегда на виду, даже когда дашборд уехал вверх при прокрутке. */}
      <div className="border-t border-line">
        <div className="mx-auto grid max-w-[1680px] grid-cols-3 divide-x divide-line px-2 sm:px-4">
          <MiniResource icon={<Coins className="size-3.5" />} cls="text-credit" value={state.credits} rate={projection.creditsDelta} />
          <MiniResource icon={<Database className="size-3.5" />} cls="text-data" value={state.data} rate={projection.dataGain} />
          <MiniResource icon={<Zap className="size-3.5" />} cls="text-energy" value={state.energy} rate={projection.energyDelta} />
        </div>
      </div>
    </header>
  );
}

function MiniResource({ icon, cls, value, rate }: { icon: ReactNode; cls: string; value: number; rate: number }) {
  return (
    <div className="flex min-w-0 items-center justify-center gap-1.5 px-2 py-1.5 font-mono text-xs">
      <span className={cls}>{icon}</span>
      <AnimatedNumber value={value} className={cn('tabular truncate font-semibold', cls)} />
      <span className={cn('hidden text-[10px] sm:inline', rate >= 0 ? 'text-credit/80' : 'text-danger')}>{fmtRate(rate)}</span>
    </div>
  );
}
