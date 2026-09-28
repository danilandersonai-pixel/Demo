/**
 * Экран Game Over: глитч-заголовок, счёт с анимированным набором, бейдж
 * рекорда, место в топ-5, статистика забега и кошелёк. Фон под ним живёт:
 * движок в режиме over доигрывает частицы взрыва.
 */
import {
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
  type Variants,
} from 'framer-motion';
import {
  Crown,
  Flame,
  Gauge,
  Gem,
  House,
  Medal,
  RotateCcw,
  Sparkles,
  Store,
  Timer,
  Trophy,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { RunResult } from '../game/types';
import type { RecordOutcome } from '../state/progress';
import { GAME_OVER_ARM_MS, HIDE_KBD_ON_PHONE } from './hud/constants';
import { NeonCard } from './hud/NeonCard';
import { ScoreDigits } from './hud/ScoreDigits';
import './hud/hud.css';
import { CrystalCount } from './ui/CrystalCount';
import { formatDuration, formatNumber, formatSpeed, padScore, plural } from './ui/format';
import { NeonButton } from './ui/NeonButton';
import { Overlay } from './ui/Overlay';

export interface GameOverOverlayProps {
  result: RunResult;
  outcome: RecordOutcome;
  /** Кошелёк после начисления кристаллов забега. */
  wallet: number;
  onRetry(): void;
  onShop(): void;
  onLeaderboard(): void;
  onMenu(): void;
  /**
   * Поверх открыта панель («Рекорды»): карточка со своими кнопками уходит из
   * дерева доступности и из фокуса — модальным остаётся только диалог панели.
   */
  covered?: boolean;
}

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.35 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.4, ease: EASE_OUT } },
};

// ─── Заголовок с глитчем ─────────────────────────────────────────────────────

function GlitchTitle({ id }: { id: string }) {
  const text = 'GAME OVER';
  return (
    <motion.h2
      id={id}
      initial={{ opacity: 0, scale: 1.5, filter: 'blur(12px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      transition={{ duration: 0.55, ease: EASE_OUT }}
      className="relative whitespace-nowrap font-display text-[length:min(40px,9.5vw)] font-black leading-none tracking-[0.12em] text-neon-pink text-glow-pink sm:text-6xl [@media(max-height:720px)_and_(orientation:landscape)]:text-[40px]"
    >
      {text}
      <span aria-hidden className="nv-glitch-layer nv-glitch-a">
        {text}
      </span>
      <span aria-hidden className="nv-glitch-layer nv-glitch-b">
        {text}
      </span>
    </motion.h2>
  );
}

// ─── Счёт с набором ──────────────────────────────────────────────────────────

function CountUpScore({ value }: { value: number }) {
  const reduce = useReducedMotionConfig();
  const mv = useMotionValue(reduce ? value : 0);
  const lead = useTransform(mv, (v) => padScore(v).lead);
  const digits = useTransform(mv, (v) => padScore(v).digits);

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    // Чем больше счёт, тем дольше «крутится» счётчик — но не дольше 1.8 с.
    const duration = Math.min(1.8, 0.7 + Math.log10(value + 1) * 0.18);
    const controls = animate(mv, value, { duration, delay: 0.35, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [mv, value, reduce]);

  return (
    <div className="relative">
      <span className="sr-only">
        {formatNumber(value)} {plural(value, ['очко', 'очка', 'очков'])}
      </span>
      <span
        aria-hidden
        className="nv-digits inline-flex font-mono text-[44px] font-extrabold leading-none tracking-wider sm:text-6xl sm:tracking-widest"
      >
        <motion.span className="text-ink-faint/40">{lead}</motion.span>
        <motion.span className="text-white text-glow-cyan">{digits}</motion.span>
      </span>
    </div>
  );
}

// ─── Бейджи ─────────────────────────────────────────────────────────────────

function RecordBadge({ first }: { first: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.3, rotate: -6 }}
      animate={{ opacity: 1, scale: 1, rotate: -2 }}
      transition={{ delay: 0.3, type: 'spring', stiffness: 420, damping: 14 }}
      className="nv-record-flicker nv-settle inline-flex items-center gap-2 rounded-[3px] bg-neon-yellow px-3 py-1 font-display text-xs font-black tracking-[0.25em] text-void shadow-[0_0_0_1px_#fff8b0,0_0_18px_rgba(255,233,74,0.8),0_0_42px_rgba(255,43,214,0.45)] sm:text-sm"
    >
      <Crown size={15} strokeWidth={3} aria-hidden />
      {first ? 'ПЕРВЫЙ РЕКОРД' : 'NEW RECORD!'}
    </motion.div>
  );
}

function RankLine({ result, outcome }: { result: RunResult; outcome: RecordOutcome }) {
  const board = outcome.save.leaderboard;
  if (outcome.rank !== null) {
    const top = outcome.rank === 1;
    const Icon = top ? Crown : Medal;
    return (
      <span className={`flex items-center gap-1.5 ${top ? 'text-neon-yellow' : 'text-neon-cyan'}`}>
        <Icon size={14} strokeWidth={2.5} aria-hidden />
        <span className="font-bold">#{outcome.rank}</span>
        <span className="text-ink-dim">{top ? 'лучший забег за всё время' : 'в топ-5 за всё время'}</span>
      </span>
    );
  }
  if (result.score <= 0) return <span className="text-ink-dim">без очков — в таблицу не попадает</span>;
  const last = board[board.length - 1];
  const need = last ? last.score - result.score + 1 : 0;
  return (
    <span className="flex items-center gap-1.5 text-ink-dim">
      <Trophy size={13} aria-hidden />
      до топ-5 не хватило <span className="nv-digits font-bold text-ink">{formatNumber(need)}</span>
    </span>
  );
}

// ─── Статистика ─────────────────────────────────────────────────────────────

interface StatProps {
  icon: LucideIcon;
  label: string;
  /** Подпись для узкого или низкого экрана, если полная не влезает в ячейку. */
  short?: string;
  tone: string;
  children: ReactNode;
  note?: string;
}

function Stat({ icon: Icon, label, short, tone, children, note }: StatProps) {
  return (
    <motion.div
      variants={item}
      className="flex min-w-0 flex-col gap-0.5 rounded-[3px] border border-white/10 bg-void/45 px-2 py-1.5 sm:gap-1 sm:px-3 sm:py-2"
    >
      <span className="flex min-w-0 items-center gap-1 text-[9px] font-bold uppercase tracking-[0.14em] text-ink-faint sm:gap-1.5 sm:text-[10px] sm:tracking-[0.2em]">
        <Icon size={12} className={`shrink-0 ${tone}`} strokeWidth={2.5} aria-hidden />
        {short ? (
          <>
            <span className="truncate sm:hidden [@media(max-height:720px)_and_(orientation:landscape)]:inline">{short}</span>
            <span className="hidden truncate sm:inline [@media(max-height:720px)_and_(orientation:landscape)]:hidden">
              {label}
            </span>
          </>
        ) : (
          <span className="truncate">{label}</span>
        )}
      </span>
      <span className={`nv-digits truncate text-[15px] font-bold tracking-wider sm:text-lg ${tone}`}>{children}</span>
      {note && (
        <span className="truncate text-[9px] tracking-wide text-ink-faint sm:text-[10px] [@media(max-height:720px)_and_(orientation:landscape)]:hidden">
          {note}
        </span>
      )}
    </motion.div>
  );
}

// ─── Экран ──────────────────────────────────────────────────────────────────

export function GameOverOverlay({
  result,
  outcome,
  wallet,
  onRetry,
  onShop,
  onLeaderboard,
  onMenu,
  covered = false,
}: GameOverOverlayProps) {
  const titleId = useId();
  const retryRef = useRef<HTMLButtonElement>(null);
  // Экран уже уходит (анимация выхода): кнопки не ловят клики.
  const isPresent = useIsPresent();
  /**
   * Первые GAME_OVER_ARM_MS кнопки «спят» — не только для клавиш (их держит
   * App), но и для касаний: на телефоне боком «Ещё раз» лежит ровно на полосе
   * корабля, и рефлекторный тап сразу после взрыва перезапускал забег.
   */
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setArmed(true), GAME_OVER_ARM_MS);
    return () => clearTimeout(t);
  }, []);

  // Фокус на «Ещё раз», когда экран взвёлся, — если его ещё никто не занял:
  // открытая за это время панель («Рекорды») или Tab игрока важнее.
  useEffect(() => {
    const btn = retryRef.current;
    if (!armed || !isPresent || !btn) return;
    const active = document.activeElement;
    const card = btn.closest('[role="dialog"]');
    if (active && active !== document.body && !card?.contains(active)) return;
    btn.focus({ preventScroll: true });
  }, [armed, isPresent]);

  const first = outcome.isHighscore && outcome.previousHighscore === 0;
  const best = Math.max(outcome.previousHighscore, result.score);

  return (
    <Overlay blur="lg" label="Итоги забега" inert={covered} className={isPresent ? '' : 'pointer-events-none'}>
      <NeonCard
        accent="pink"
        labelledBy={titleId}
        className="max-w-lg [@media(max-height:720px)_and_(orientation:landscape)]:max-w-3xl"
      >
        {/* Низкий широкий экран (телефон боком, невысокое окно): две колонки — итог слева, статистика и кнопки справа. */}
        <div className="flex flex-col items-center px-4 pb-4 pt-6 sm:px-7 sm:pb-6 sm:pt-8 [@media(max-height:720px)_and_(orientation:landscape)]:flex-row [@media(max-height:720px)_and_(orientation:landscape)]:gap-6 [@media(max-height:720px)_and_(orientation:landscape)]:py-4">
          <div className="flex w-full flex-col items-center [@media(max-height:720px)_and_(orientation:landscape)]:min-w-0 [@media(max-height:720px)_and_(orientation:landscape)]:flex-1">
            <GlitchTitle id={titleId} />

            <div className="mt-3 flex min-h-7 items-center justify-center">
              {outcome.isHighscore ? (
                <RecordBadge first={first} />
              ) : (
                <span className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-ink-dim sm:text-xs">
                  BEST
                  <ScoreDigits value={best} digitsClassName="text-neon-yellow" leadClassName="text-neon-yellow/30" />
                </span>
              )}
            </div>

            <span className="mt-3 text-[10px] font-bold tracking-[0.45em] text-neon-cyan/80 sm:text-xs">SCORE</span>
            <CountUpScore value={result.score} />

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-2 text-[11px] tracking-wide sm:text-xs"
            >
              <RankLine result={result} outcome={outcome} />
            </motion.div>
          </div>

          <div className="flex w-full flex-col items-center [@media(max-height:720px)_and_(orientation:landscape)]:min-w-0 [@media(max-height:720px)_and_(orientation:landscape)]:flex-1">
            <motion.div
              variants={list}
              initial="hidden"
              animate="show"
              className="mt-4 grid w-full grid-cols-3 gap-1.5 sm:mt-5 sm:gap-2 [@media(max-height:720px)_and_(orientation:landscape)]:mt-0"
            >
              <Stat icon={Gauge} label="Уровень" tone="text-theme-a" note={`скорость ${formatSpeed(result.speedMult)}`}>
                LV {result.level}
              </Stat>
              {/* «Комбо» — как в HUD и в колонке таблицы рекордов; «Лучший множитель» в ячейку не влезает. */}
              <Stat icon={Flame} label="Лучшее комбо" short="Комбо" tone="text-neon-pink" note={`цепочка ${result.maxChain}`}>
                x{result.maxMultiplier}
              </Stat>
              <Stat
                icon={Sparkles}
                label="Сферы"
                tone="text-neon-cyan"
                note={plural(result.crystalsCollected, ['собрана', 'собраны', 'собрано'])}
              >
                {formatNumber(result.crystalsCollected)}
              </Stat>
              <Stat icon={Gem} label="Кристаллы" short="Валюта" tone="text-neon-cyan" note="в кошелёк">
                +{formatNumber(result.crystals)}
              </Stat>
              <Stat icon={Timer} label="Время" tone="text-neon-yellow" note="в забеге">
                {formatDuration(result.duration)}
              </Stat>
              <Stat icon={Wind} label="Near miss" short="Near" tone="text-neon-violet" note="на волоске">
                {formatNumber(result.nearMisses)}
              </Stat>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.4, ease: EASE_OUT }}
              className="mt-3 flex w-full items-center justify-between gap-3 rounded-[3px] border border-neon-cyan/25 bg-neon-cyan/5 px-3 py-2 [@media(max-height:720px)_and_(orientation:landscape)]:mt-2 [@media(max-height:720px)_and_(orientation:landscape)]:py-1.5"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-ink-dim sm:text-xs">Кошелёк</span>
              <CrystalCount value={wallet} size="md" />
            </motion.div>

            {/* До взвода — inert: ни тапа, ни Tab, ни нажатия; тап проходит на подложку без обработчика. */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.4, ease: EASE_OUT }}
              inert={!armed}
              className={`mt-4 flex w-full flex-col gap-2 sm:mt-5 ${armed ? '' : 'pointer-events-none'} ${HIDE_KBD_ON_PHONE} [@media(max-height:720px)_and_(orientation:landscape)]:mt-3 [@media(max-height:720px)_and_(orientation:landscape)]:[&_kbd]:hidden`}
            >
              <NeonButton
                ref={retryRef}
                variant="pink"
                size="lg"
                icon={RotateCcw}
                hotkey="Enter"
                fullWidth
                className="[@media(max-height:720px)_and_(orientation:landscape)]:h-11"
                onClick={onRetry}
              >
                Ещё раз
              </NeonButton>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <NeonButton variant="cyan" icon={Store} hotkey="S" onClick={onShop}>
                  Магазин
                </NeonButton>
                <NeonButton variant="yellow" icon={Trophy} hotkey="L" onClick={onLeaderboard}>
                  Рекорды
                </NeonButton>
                <NeonButton
                  variant="ghost"
                  icon={House}
                  hotkey="Esc"
                  sound="back"
                  className="col-span-2 sm:col-span-1"
                  onClick={onMenu}
                >
                  Меню
                </NeonButton>
              </div>
            </motion.div>
          </div>
        </div>
      </NeonCard>
    </Overlay>
  );
}
