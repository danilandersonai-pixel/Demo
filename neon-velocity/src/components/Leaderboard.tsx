/**
 * Топ-5 забегов за всё время: место (1 — корона), счёт, уровень скорости,
 * дата и время, лучший комбо, корабль. Последний забег подсвечен и пульсирует.
 * Свободные места показаны пустыми строками, как на аркадном автомате.
 * Внизу — общая статистика игрока.
 */
import { motion, type Variants } from 'framer-motion';
import { CalendarClock, Crown, Flame, Gamepad2, Gauge, Gem, Hourglass, Medal, Trophy, type LucideIcon } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { SKINS, THEMES } from '../game/config';
import type { LeaderboardEntry, SaveData, Theme } from '../game/types';
import { LEADERBOARD_SIZE } from '../state/storage';
import './menu/menu.css';
import { EASE_OUT, formatPlayTime } from './menu/shared';
import { useDialogFocus } from './menu/useDialogFocus';
import { ShipPreview } from './ShipPreview';
import { CrystalCount } from './ui/CrystalCount';
import { formatDate, formatNumber, formatSpeed, padScore, plural } from './ui/format';
import { Kbd } from './ui/Kbd';
import { NeonButton } from './ui/NeonButton';
import { Overlay } from './ui/Overlay';
import { Panel } from './ui/Panel';

export interface LeaderboardProps {
  save: SaveData;
  /** id записи последнего забега — подсветить строку. */
  highlightId?: string | null;
  onClose(): void;
}

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.12 } },
};

const row: Variants = {
  hidden: { opacity: 0, x: -22, filter: 'blur(4px)' },
  show: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.42, ease: EASE_OUT } },
};

/** Сетка колонок строки на широком экране: место · счёт · скорость · комбо · корабль · дата. */
const COLUMNS = 'sm:grid-cols-[3rem_minmax(0,1.5fr)_minmax(0,1fr)_4rem_minmax(0,1.15fr)_minmax(0,0.95fr)]';

// ─── Место ──────────────────────────────────────────────────────────────────

const RANK_STYLE: Record<number, { icon: LucideIcon; tone: string; frame: string }> = {
  1: {
    icon: Crown,
    tone: 'text-neon-yellow',
    frame: 'border-neon-yellow/70 bg-neon-yellow/10 shadow-[0_0_14px_rgba(255,233,74,0.45)]',
  },
  2: {
    icon: Medal,
    tone: 'text-neon-cyan',
    frame: 'border-neon-cyan/60 bg-neon-cyan/10 shadow-[0_0_12px_rgba(34,240,255,0.35)]',
  },
  3: {
    icon: Medal,
    tone: 'text-neon-pink',
    frame: 'border-neon-pink/60 bg-neon-pink/10 shadow-[0_0_12px_rgba(255,43,214,0.35)]',
  },
};

function RankBadge({ rank }: { rank: number }) {
  const style = RANK_STYLE[rank];
  if (!style) {
    return (
      <span className="nvm-digits flex h-10 w-10 items-center justify-center rounded-[3px] border border-white/10 font-display text-sm font-bold text-ink-dim">
        {rank}
      </span>
    );
  }
  const Icon = style.icon;
  return (
    <span
      className={`relative flex h-10 w-10 flex-col items-center justify-center rounded-[3px] border ${style.frame} ${style.tone}`}
    >
      <Icon size={rank === 1 ? 17 : 15} strokeWidth={2.4} className={rank === 1 ? 'nvm-crown' : ''} aria-hidden />
      <span className="nvm-digits font-display text-[10px] font-black leading-none">{rank}</span>
    </span>
  );
}

// ─── Ячейка с подписью (подпись видна только на телефоне) ──────────────────

function Cell({
  label,
  icon: Icon,
  children,
  className = '',
}: {
  label: string;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={['flex min-w-0 flex-col gap-0.5', className].join(' ')}>
      <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.2em] text-ink-faint sm:hidden">
        <Icon size={10} strokeWidth={2.5} aria-hidden />
        {label}
      </span>
      {children}
    </div>
  );
}

// ─── Строка ─────────────────────────────────────────────────────────────────

function EntryRow({
  entry,
  rank,
  highlight,
  theme,
}: {
  entry: LeaderboardEntry;
  rank: number;
  highlight: boolean;
  theme: Theme;
}) {
  const { lead, digits } = padScore(entry.score);
  const { date, time } = formatDate(entry.date);
  const skin = SKINS[entry.skinId];
  const top = rank === 1;
  return (
    <motion.li
      variants={row}
      aria-current={highlight ? 'true' : undefined}
      className={[
        'relative grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-[3px] border px-2.5 py-2.5 sm:gap-x-4 sm:px-3',
        COLUMNS,
        highlight
          ? 'nvm-row-pulse border-transparent bg-theme-a/[0.08]'
          : top
            ? 'border-neon-yellow/30 bg-neon-yellow/[0.04]'
            : 'border-white/10 bg-void/45',
      ].join(' ')}
    >
      {highlight && (
        <span className="absolute -top-2 right-2 rounded-[2px] bg-theme-a px-1.5 py-0.5 text-[9px] font-black tracking-[0.2em] text-void shadow-[0_0_12px_var(--theme-a)] sm:right-3">
          ПОСЛЕДНИЙ ЗАБЕГ
        </span>
      )}

      <div className="row-span-2 self-center sm:row-span-1">
        <RankBadge rank={rank} />
      </div>

      {/* Счёт — главный; на телефоне занимает всю верхнюю строку карточки. */}
      <div className="min-w-0">
        <span className="sr-only">
          Место {rank}: {formatNumber(entry.score)} очков
        </span>
        <span
          aria-hidden
          className="nvm-digits block truncate font-mono text-[26px] font-extrabold leading-none tracking-wider sm:text-[28px] lg:text-[30px]"
        >
          <span className={top ? 'text-neon-yellow/25' : 'text-ink-faint/40'}>{lead}</span>
          <span
            className={
              top ? 'text-neon-yellow text-glow-yellow' : highlight ? 'text-white text-glow-theme' : 'text-white text-glow-soft'
            }
          >
            {digits}
          </span>
        </span>
      </div>

      {/* На телефоне детали — сетка 2×2 под счётом; на широком экране — колонки таблицы. */}
      <div className="col-start-2 grid min-w-0 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-x-3 gap-y-2 sm:col-span-4 sm:col-start-3 sm:grid-cols-subgrid sm:gap-y-1">
        <Cell label="Скорость" icon={Gauge}>
          <span className="nvm-digits truncate text-[13px] font-bold tracking-wider">
            <span className="text-theme-a">LV {entry.level}</span>
            <span className="text-ink-faint"> · </span>
            <span className="text-neon-cyan">{formatSpeed(entry.speedMult)}</span>
          </span>
        </Cell>
        <Cell label="Комбо" icon={Flame}>
          <span className="nvm-digits text-[13px] font-bold tracking-wider text-neon-pink">x{entry.maxMultiplier}</span>
        </Cell>
        <Cell label="Корабль" icon={Gamepad2}>
          <span className="flex min-w-0 items-center gap-1.5">
            <ShipPreview skin={skin} theme={theme} size={22} animated={false} className="-my-1" />
            <span className="truncate font-display text-[11px] font-bold tracking-wider text-ink">{skin.name}</span>
          </span>
        </Cell>
        <Cell label="Дата" icon={CalendarClock}>
          <span className="nvm-digits flex flex-wrap items-baseline gap-x-1.5 whitespace-nowrap text-[11px] tracking-wide sm:flex-col sm:flex-nowrap lg:flex-row">
            <span className="text-ink">{date}</span>
            <span className="text-ink-faint">{time}</span>
          </span>
        </Cell>
      </div>
    </motion.li>
  );
}

function EmptyRow({ rank }: { rank: number }) {
  return (
    <motion.li
      variants={row}
      aria-hidden
      className={`grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-3 rounded-[3px] border border-dashed border-white/[0.07] px-2.5 py-2.5 sm:gap-x-4 sm:px-3 ${COLUMNS}`}
    >
      <span className="nvm-digits flex h-10 w-10 items-center justify-center rounded-[3px] border border-white/5 font-display text-sm font-bold text-ink-faint/50">
        {rank}
      </span>
      <span className="nvm-digits font-mono text-[26px] font-extrabold leading-none tracking-wider text-ink-faint/20 sm:text-[28px] lg:text-[30px]">
        -------
      </span>
      <span className="hidden text-[10px] uppercase tracking-[0.3em] text-ink-faint/50 sm:col-span-4 sm:block">
        свободное место
      </span>
    </motion.li>
  );
}

// ─── Пустая таблица ─────────────────────────────────────────────────────────

function EmptyState({ onClose }: { onClose(): void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE_OUT, delay: 0.1 }}
      className="flex flex-col items-center px-2 py-6 text-center sm:py-10"
    >
      <div className="relative mb-5">
        <span aria-hidden className="absolute inset-0 -m-6 rounded-full bg-neon-yellow/10 blur-2xl" />
        <Trophy size={64} strokeWidth={1.5} className="nvm-crown relative text-neon-yellow" aria-hidden />
      </div>
      <p className="font-display text-lg font-black tracking-[0.3em] text-neon-yellow text-glow-yellow sm:text-2xl">
        NO SCORES YET
      </p>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-dim">
        Таблица пока пуста. Сыграйте первый забег — пять лучших результатов останутся здесь навсегда, с датой и достигнутой
        скоростью.
      </p>
      <div className="mt-6 flex flex-col items-center gap-3">
        <NeonButton variant="yellow" icon={Gamepad2} sound="back" onClick={onClose}>
          К игре
        </NeonButton>
        <span className="hidden items-center gap-1.5 text-[10px] tracking-widest text-ink-faint sm:flex">
          в меню нажмите <Kbd>Enter</Kbd> — и вперёд
        </span>
      </div>
    </motion.div>
  );
}

// ─── Статистика ─────────────────────────────────────────────────────────────

function Stat({ icon: Icon, label, tone, children }: { icon: LucideIcon; label: string; tone: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[3px] border border-white/10 bg-void/45 px-3 py-2">
      <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-ink-faint">
        <Icon size={12} strokeWidth={2.5} className={`shrink-0 ${tone}`} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <span className={`nvm-digits truncate text-base font-bold tracking-wider sm:text-lg ${tone}`}>{children}</span>
    </div>
  );
}

// ─── Панель ─────────────────────────────────────────────────────────────────

/** Топ-5 забегов. Рендерит свой <Overlay layer={40}> + <Panel>. */
export function Leaderboard({ save, highlightId = null, onClose }: LeaderboardProps) {
  const anchor = useRef<HTMLDivElement>(null);
  useDialogFocus(anchor);
  const theme = THEMES[save.equippedTheme];
  const entries = save.leaderboard.slice(0, LEADERBOARD_SIZE);
  const { stats } = save;
  const games = stats.gamesPlayed;

  return (
    <Overlay layer={40} onBackdropClick={onClose} label="Рекорды">
      <Panel
        title="Рекорды"
        subtitle="High Scores — пять лучших забегов за всё время"
        icon={Trophy}
        accent="yellow"
        width="xl"
        onClose={onClose}
      >
        <div ref={anchor}>
          {entries.length === 0 ? (
            <EmptyState onClose={onClose} />
          ) : (
            <>
              {/* Заголовки колонок — только на широком экране; на телефоне подписи внутри ячеек. */}
              <div
                aria-hidden
                className={`mb-2 hidden gap-x-4 px-3 text-[9px] font-bold uppercase tracking-[0.25em] text-ink-faint sm:grid ${COLUMNS}`}
              >
                <span>#</span>
                <span>Счёт</span>
                <span>Скорость</span>
                <span>Комбо</span>
                <span>Корабль</span>
                <span>Дата</span>
              </div>
              <motion.ol
                variants={list}
                initial="hidden"
                animate="show"
                className="flex flex-col gap-2"
                aria-label="Топ-5 забегов"
              >
                {entries.map((entry, i) => (
                  <EntryRow key={entry.id} entry={entry} rank={i + 1} highlight={entry.id === highlightId} theme={theme} />
                ))}
                {Array.from({ length: LEADERBOARD_SIZE - entries.length }, (_, i) => (
                  <EmptyRow key={`empty-${i}`} rank={entries.length + i + 1} />
                ))}
              </motion.ol>
            </>
          )}

          <motion.section
            aria-label="Общая статистика"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.4, ease: EASE_OUT }}
            className="mt-5 border-t border-white/10 pt-4"
          >
            <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.3em] text-ink-dim">Статистика за всё время</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat icon={Gamepad2} label="Игр сыграно" tone="text-theme-a">
                {formatNumber(games)}
                <span className="ml-1.5 text-[10px] font-semibold tracking-normal text-ink-faint">
                  {plural(games, ['забег', 'забега', 'забегов'])}
                </span>
              </Stat>
              <Stat icon={Gem} label="Всего кристаллов" tone="text-neon-cyan">
                <CrystalCount value={stats.totalCrystals} size="md" className="text-base! sm:text-lg!" />
              </Stat>
              <Stat icon={Hourglass} label="Суммарное время" tone="text-neon-yellow">
                {formatPlayTime(stats.totalTime)}
              </Stat>
              <Stat icon={Flame} label="Лучший множитель" tone="text-neon-pink">
                x{stats.bestMultiplier}
              </Stat>
            </div>
          </motion.section>
        </div>
      </Panel>
    </Overlay>
  );
}
