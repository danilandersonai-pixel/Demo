/**
 * Экран Game Over: размытый фон (холст под ним замирает через долю секунды) и
 * неоновая карточка с итогом забега. Первые GAME_OVER_ARM_MS экран не ловит
 * указатель — игрок ещё жмёт клавиши и тапает по инерции забега; хоткеи на это
 * же время глушит App. Все анимации конечны: под карточкой размытие, и ничто
 * не должно двигаться вечно.
 */
import { motion, useIsPresent, type Variants } from 'framer-motion';
import { Crown, Flame, Gauge, Gem, Orbit, RotateCcw, Timer, Trophy, Wallet, Zap, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { RunResult } from '../core/types';
import type { RecordOutcome } from '../state/progress';
import { LEADERBOARD_SIZE } from '../state/storage';
import { EASE_OUT, GAME_OVER_ARM_MS, HIDE_KBD_ON_TOUCH, POINT_FORMS } from './hud/constants';
import { CountUp } from './hud/CountUp';
import './hud/hud.css';
import { CrystalCount } from './kit/CrystalCount';
import { formatDuration, formatNumber, formatSpeed, plural } from './kit/format';
import { NeonButton } from './kit/NeonButton';
import { Overlay } from './kit/Overlay';

export interface GameOverOverlayProps {
  result: RunResult;
  outcome: RecordOutcome;
  /** Кошелёк после начисления кристаллов забега. */
  wallet: number;
  onRetry(): void;
  onShop(): void;
  onLeaderboard(): void;
  onMenu(): void;
  /** Поверх открыта панель («Рекорды»): слой инертен — диалог на экране один. */
  covered: boolean;
}

const CORNERS = [
  '-left-1 -top-1 border-l-2 border-t-2',
  '-right-1 -top-1 border-r-2 border-t-2',
  '-bottom-1 -left-1 border-b-2 border-l-2',
  '-bottom-1 -right-1 border-b-2 border-r-2',
];

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.3 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.36, ease: EASE_OUT } },
};

function Stat({ icon: Icon, label, children, note }: { icon: LucideIcon; label: string; children: ReactNode; note?: string }) {
  return (
    <motion.div
      variants={item}
      className="flex min-w-0 flex-col gap-1 rounded-[3px] border border-white/10 bg-white/[0.03] px-2 py-1.5 sm:px-3 sm:py-2 [@media(max-height:560px)]:py-1.5"
    >
      {/* На узком телефоне подписи идут без иконок и плотнее — «Кристаллы» не обрезается. */}
      <dt className="flex items-center gap-1.5 whitespace-nowrap text-[9px] font-bold uppercase leading-none tracking-[0.06em] text-ink-dim sm:tracking-[0.14em]">
        <Icon size={11} strokeWidth={2.4} className="shrink-0 text-theme-b max-[389px]:hidden" aria-hidden />
        <span>{label}</span>
      </dt>
      <dd className="nvh-digits m-0 flex items-baseline gap-1.5 whitespace-nowrap text-sm font-bold leading-none text-ink sm:text-base">
        {children}
        {note && <span className="text-[10px] font-semibold text-ink-dim">{note}</span>}
      </dd>
    </motion.div>
  );
}

/** Строка про рекорд: побит, первый, повторён или сколько до него не хватило. */
function RecordLine({ result, outcome }: { result: RunResult; outcome: RecordOutcome }) {
  if (outcome.isHighscore) {
    const first = outcome.previousHighscore <= 0;
    return (
      <div className="flex flex-col items-center gap-1">
        {/* Размер — от ширины экрана: «ПЕРВЫЙ РЕКОРД» с коронами помещается в строку и на 320 px, и в колонке телефона боком. */}
        <p className="nvh-sign nvh-over-sign m-0 flex items-center gap-[0.45em] whitespace-nowrap font-display font-black italic leading-none tracking-[0.08em] text-neon-yellow text-glow-yellow">
          <Crown strokeWidth={2.6} aria-hidden />
          <span>{first ? 'ПЕРВЫЙ РЕКОРД' : 'NEW RECORD!'}</span>
          <Crown strokeWidth={2.6} aria-hidden />
        </p>
        {!first && <p className="m-0 text-[11px] tracking-wide text-ink-dim">прошлый рекорд {formatNumber(outcome.previousHighscore)}</p>}
      </div>
    );
  }
  const gap = Math.max(0, outcome.previousHighscore - Math.floor(result.score));
  return (
    <p className="m-0 text-center text-[11px] leading-snug tracking-wide text-ink-dim sm:text-xs">
      {gap === 0 ? (
        'Рекорд повторён — ещё чуть-чуть!'
      ) : (
        <>
          До рекорда{' '}
          <span className="nvh-digits font-bold text-ink">
            {formatNumber(gap)} {plural(gap, POINT_FORMS)}
          </span>
        </>
      )}
    </p>
  );
}

export function GameOverOverlay({ result, outcome, wallet, onRetry, onShop, onLeaderboard, onMenu, covered }: GameOverOverlayProps) {
  // Уходящий экран (анимация выхода) инертен: второй клик по «Ещё раз» не начнёт второй забег.
  const isPresent = useIsPresent();
  const titleId = useId();
  const card = useRef<HTMLElement>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setArmed(true), GAME_OVER_ARM_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Фокус — на самой карточке, а не на кнопке: скринридер объявляет диалог, Tab
  // идёт к «Ещё раз», а Enter и пробел остаются хоткеями экрана (их ведёт App).
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
  }, []);

  const score = Math.max(0, Math.floor(result.score));
  const record = outcome.isHighscore;

  return (
    <Overlay
      blur="md"
      label="Игра окончена"
      inert={covered || !isPresent}
      className={armed && isPresent ? '' : 'pointer-events-none'}
    >
      <motion.section
        ref={card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ opacity: 0, y: 30, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24, opacity: { type: 'tween', duration: 0.25, ease: 'easeOut' } }}
        className="relative my-auto w-full max-w-md rounded-[4px] bg-[linear-gradient(180deg,rgba(24,14,40,0.92),rgba(8,7,20,0.95))] nvh-quiet font-mono leading-normal box-glow-pink [@media(max-height:560px)]:max-w-3xl"
      >
        {CORNERS.map((c) => (
          <span key={c} aria-hidden className={`pointer-events-none absolute h-4 w-4 border-neon-pink ${c}`} />
        ))}

        <div className="nvh-over-body">
          <div className="nvh-over-main">
            <h2 id={titleId} className="nvh-over-title m-0 whitespace-nowrap font-display font-black leading-none tracking-[0.1em] text-neon-pink text-glow-pink">
              <span className="nvh-glitch">
                GAME OVER
                <span aria-hidden className="nvh-glitch-layer" data-layer="a">
                  GAME OVER
                </span>
                <span aria-hidden className="nvh-glitch-layer" data-layer="b">
                  GAME OVER
                </span>
              </span>
            </h2>

            <div className="flex flex-col items-center gap-1">
              <span className="nvh-label -mr-[0.3em] text-ink-dim">Score</span>
              <CountUp
                value={score}
                delay={0.3}
                className={`nvh-over-score nvh-digits font-extrabold leading-none ${record ? 'text-neon-yellow text-glow-yellow' : 'text-ink text-glow-soft'}`}
              />
              <span className="sr-only">
                Счёт: {formatNumber(score)} {plural(score, POINT_FORMS)}
              </span>
            </div>

            <RecordLine result={result} outcome={outcome} />

            <p
              className={`m-0 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide sm:text-xs ${outcome.rank ? 'text-neon-cyan' : 'text-ink-faint'}`}
            >
              <Trophy size={13} strokeWidth={2.4} aria-hidden />
              {outcome.rank ? `Место №${outcome.rank} в топ-${LEADERBOARD_SIZE}` : `В топ-${LEADERBOARD_SIZE} не попал`}
            </p>
          </div>

          <div className="nvh-over-side">
            <motion.dl variants={list} initial="hidden" animate="show" className="m-0 grid grid-cols-3 gap-1.5 sm:gap-2">
              <Stat icon={Gauge} label="Уровень" note={formatSpeed(result.speedMult)}>
                <span className="text-theme-b">LV {result.level}</span>
              </Stat>
              <Stat icon={Flame} label="Комбо" note={result.maxChain > 0 ? `цепь ${result.maxChain}` : undefined}>
                <span className={result.maxMultiplier > 1 ? 'text-neon-yellow' : ''}>x{result.maxMultiplier}</span>
              </Stat>
              <Stat icon={Orbit} label="Сферы">
                {formatNumber(result.crystalsCollected)}
              </Stat>
              <Stat icon={Gem} label="Кристаллы">
                <span className="text-neon-cyan">+{formatNumber(result.crystals)}</span>
              </Stat>
              <Stat icon={Timer} label="Время">
                {formatDuration(result.duration)}
              </Stat>
              <Stat icon={Zap} label="Near miss">
                {formatNumber(result.nearMisses)}
              </Stat>
            </motion.dl>

            <div className="flex items-center justify-center gap-2 text-[11px] tracking-wide text-ink-dim sm:text-xs">
              <Wallet size={14} strokeWidth={2.2} aria-hidden />
              <span>В кошельке</span>
              <CrystalCount value={wallet} size="md" />
            </div>

            <div className={`flex flex-col gap-2 ${HIDE_KBD_ON_TOUCH}`}>
              <NeonButton variant="pink" size="lg" icon={RotateCcw} hotkey="Enter" fullWidth onClick={onRetry} className="[@media(max-height:560px)]:h-11!">
                Ещё раз
              </NeonButton>
              <div className="grid grid-cols-3 gap-2 [@media(max-height:560px)]:[&_kbd]:hidden">
                <NeonButton variant="cyan" size="sm" hotkey="S" fullWidth onClick={onShop} className="px-1!">
                  Магазин
                </NeonButton>
                <NeonButton variant="yellow" size="sm" hotkey="L" fullWidth onClick={onLeaderboard} className="px-1!">
                  Рекорды
                </NeonButton>
                <NeonButton variant="ghost" size="sm" hotkey="Esc" sound="back" fullWidth onClick={onMenu} className="px-1!">
                  Меню
                </NeonButton>
              </div>
            </div>
          </div>
        </div>
      </motion.section>
    </Overlay>
  );
}
