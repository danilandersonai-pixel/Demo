/**
 * Локальный топ-5: место, счёт, уровень скорости, дата и время, лучшее комбо и
 * корабль. Строка последнего забега подсвечена. На телефоне строка складывается
 * в три короткие линии — ни одно значение не обрезается.
 */
import { motion } from 'framer-motion';
import { Clock, Crown, Flame, Gauge, Gem, Hash, Sigma, Trophy, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { SKINS, THEMES } from '../core/config';
import type { LeaderboardEntry, SaveData, Theme } from '../core/types';
import { LEADERBOARD_SIZE } from '../state/storage';
import { formatDate, formatNumber, formatSpeed, plural } from './kit/format';
import { Overlay } from './kit/Overlay';
import { Panel } from './kit/Panel';
import { useDialogFocus } from './kit/useDialogFocus';
import './menu/menu.css';
import { formatPlayTime, stagger, staggerItem } from './menu/shared';
import { ShipPreview } from './ShipPreview';

export interface LeaderboardProps {
  save: SaveData;
  /** id записи последнего забега — подсветить строку. */
  highlightId?: string | null;
  onClose(): void;
}

const POINT_FORMS: [string, string, string] = ['очко', 'очка', 'очков'];

// Полные строки классов — чтобы Tailwind увидел их при сборке.
const RANK_TONE = [
  'border-neon-yellow text-neon-yellow text-glow-yellow shadow-[0_0_12px_rgba(255,233,74,0.45)]',
  'border-neon-cyan/80 text-neon-cyan',
  'border-neon-pink/80 text-neon-pink',
  'border-white/20 text-ink-dim',
  'border-white/20 text-ink-dim',
];

const SCORE_TONE = ['text-neon-yellow text-glow-yellow', 'text-neon-cyan', 'text-neon-pink', 'text-ink', 'text-ink'];

/** Сетка строки: на телефоне три линии, с sm — одна строка из шести колонок. */
const ROW_GRID =
  'grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[2.5rem_minmax(0,1fr)_5.75rem_3rem_9.75rem_5.25rem]';

function Row({ entry, rank, theme, fresh }: { entry: LeaderboardEntry; rank: number; theme: Theme; fresh: boolean }) {
  const skin = SKINS[entry.skinId];
  const { date, time } = formatDate(entry.date);
  const ref = useRef<HTMLLIElement>(null);

  // Строка последнего забега должна быть видна сразу, даже если список не влез в панель.
  useEffect(() => {
    if (fresh) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [fresh]);

  return (
    <motion.li
      ref={ref}
      variants={staggerItem}
      aria-current={fresh ? 'true' : undefined}
      className={[
        ROW_GRID,
        'relative rounded-[3px] border px-2.5 py-2 sm:px-3',
        fresh ? 'nvm-row-fresh border-transparent bg-theme-a/[0.09]' : 'border-white/10 bg-void/50',
      ].join(' ')}
    >
      {fresh && (
        <span className="absolute -top-2 right-2 rounded-[2px] bg-theme-a px-1.5 py-px text-[9px] font-extrabold uppercase leading-normal tracking-widest text-void">
          Последний забег
        </span>
      )}

      <span
        className={[
          'row-span-3 flex h-9 w-9 items-center justify-center self-center rounded-[3px] border bg-void/60 font-display text-base font-black sm:row-span-1',
          RANK_TONE[rank - 1] ?? RANK_TONE[RANK_TONE.length - 1],
        ].join(' ')}
      >
        <span className="sr-only">Место </span>
        {rank === 1 ? (
          <>
            <Crown size={18} strokeWidth={2.4} aria-hidden />
            <span className="sr-only">1</span>
          </>
        ) : (
          rank
        )}
      </span>

      <span className={['nvm-digits col-start-2 row-start-1 font-mono text-xl font-extrabold leading-none tracking-wider', SCORE_TONE[rank - 1] ?? 'text-ink'].join(' ')}>
        <span aria-hidden>{formatNumber(entry.score)}</span>
        <span className="sr-only">{`${formatNumber(entry.score)} ${plural(entry.score, POINT_FORMS)}`}</span>
      </span>

      <span className="col-start-3 row-start-1 flex items-center gap-1 justify-self-end text-sm font-extrabold leading-none text-neon-pink sm:col-start-4 sm:justify-self-start">
        <span className="sr-only">Лучшее комбо </span>
        <Flame size={13} strokeWidth={2.4} className="shrink-0" aria-hidden />
        <span className="nvm-digits">x{entry.maxMultiplier}</span>
      </span>

      <span className="col-start-2 row-start-2 flex items-baseline gap-1.5 whitespace-nowrap text-[11px] font-bold leading-none tracking-wider sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-start sm:gap-1">
        <span className="text-neon-cyan">
          <span className="sr-only">Уровень скорости </span>
          <span aria-hidden>LV </span>
          {entry.level}
        </span>
        <span className="nvm-digits text-ink-dim">
          <span className="sr-only">скорость </span>
          {formatSpeed(entry.speedMult)}
        </span>
      </span>

      <span className="col-start-2 row-start-3 flex min-w-0 items-center gap-1.5 sm:col-start-5 sm:row-start-1">
        <span className="sr-only">Корабль </span>
        <ShipPreview skin={skin} theme={theme} size={22} animated={false} perks={false} />
        <span className="font-display text-[11px] font-bold leading-tight tracking-wider text-ink-dim">{skin.name}</span>
      </span>

      {/* На телефоне дата и время — отдельные ячейки второй и третьей линии; с sm — столбик справа. */}
      <span className="contents text-[11px] leading-none text-ink-dim sm:col-start-6 sm:row-start-1 sm:flex sm:flex-col sm:items-end sm:gap-1">
        <span className="nvm-digits col-start-3 row-start-2 justify-self-end whitespace-nowrap">{date}</span>
        <span className="nvm-digits col-start-3 row-start-3 justify-self-end whitespace-nowrap text-ink-faint">{time}</span>
      </span>
    </motion.li>
  );
}

/** Свободное место таблицы: видно, сколько ещё строк можно занять. */
function EmptyRow({ rank }: { rank: number }) {
  return (
    <motion.li variants={staggerItem} className="flex items-center gap-3 rounded-[3px] border border-dashed border-white/8 px-2.5 py-1.5 sm:px-3">
      <span className="flex h-7 w-9 items-center justify-center font-display text-sm font-black text-ink-faint sm:w-10">{rank}</span>
      <span className="text-[11px] tracking-widest text-ink-faint">Место свободно</span>
    </motion.li>
  );
}

function EmptyState() {
  return (
    <motion.div
      variants={staggerItem}
      className="flex flex-col items-center gap-3 rounded-[3px] border border-dashed border-neon-yellow/30 bg-void/50 px-4 py-8 text-center [@media(max-height:560px)]:py-4"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-[3px] border border-neon-yellow/50 bg-neon-yellow/[0.06] text-neon-yellow shadow-[0_0_18px_rgba(255,233,74,0.25)]">
        <Trophy size={28} strokeWidth={2} aria-hidden />
      </span>
      <p className="m-0 font-display text-base font-bold uppercase tracking-widest text-neon-yellow text-glow-yellow">Рекордов пока нет</p>
      <p className="m-0 max-w-xs text-xs leading-relaxed text-ink-dim">
        Сыграйте забег — пять лучших результатов останутся здесь с датой, уровнем скорости и кораблём.
      </p>
    </motion.div>
  );
}

function Stat({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded-[3px] border border-white/8 bg-void/45 px-2.5 py-2 leading-none">
      <Icon size={16} strokeWidth={2.2} className="row-span-2 shrink-0 text-theme-b" aria-hidden />
      <dt className="text-[9px] font-bold uppercase leading-tight tracking-[0.18em] text-ink-faint">{label}</dt>
      <dd className="nvm-digits m-0 text-sm font-extrabold tracking-wide text-ink">{children}</dd>
    </div>
  );
}

/** Топ-5 забегов. Рендерит свой <Overlay layer={40}> + <Panel>. */
export function Leaderboard({ save, highlightId = null, onClose }: LeaderboardProps) {
  const anchor = useRef<HTMLDivElement>(null);
  // Фокус — на прокручиваемом содержимом: стрелки сразу листают таблицу, а
  // зажатый Enter, которым открыли панель, не нажимает «Закрыть».
  useDialogFocus(anchor, anchor);

  const theme = THEMES[save.equippedTheme];
  const entries = save.leaderboard.slice(0, LEADERBOARD_SIZE);
  const { stats } = save;
  const average = stats.gamesPlayed > 0 ? Math.round(stats.totalScore / stats.gamesPlayed) : 0;
  const freeRanks = Array.from({ length: LEADERBOARD_SIZE - entries.length }, (_, i) => entries.length + i + 1);

  return (
    <Overlay layer={40} onBackdropClick={onClose} label="Рекорды">
      <Panel title="Рекорды" subtitle="Пять лучших забегов на этом устройстве" icon={Trophy} accent="yellow" width="lg" onClose={onClose}>
        <motion.div
          ref={anchor}
          tabIndex={-1}
          variants={stagger}
          initial="hidden"
          animate="show"
          className="nvm-focus-quiet flex flex-col gap-4 font-mono leading-normal [@media(max-height:560px)]:gap-3"
        >
          {entries.length === 0 ? (
            <EmptyState />
          ) : (
            <section aria-label="Топ-5" className="flex flex-col gap-1.5">
              {/* Подписи колонок — только там, где строка в одну линию. */}
              <div aria-hidden className={`${ROW_GRID} hidden px-3 text-[9px] font-bold uppercase tracking-[0.2em] text-ink-faint sm:grid`}>
                <span className="text-center">#</span>
                <span>Score</span>
                <span>Level</span>
                <span>Combo</span>
                <span>Корабль</span>
                <span className="text-right">Дата</span>
              </div>
              <ol className="m-0 flex list-none flex-col gap-2 p-0 pt-1">
                {entries.map((entry, i) => (
                  <Row key={entry.id} entry={entry} rank={i + 1} theme={theme} fresh={entry.id === highlightId} />
                ))}
                {freeRanks.map((rank) => (
                  <EmptyRow key={rank} rank={rank} />
                ))}
              </ol>
            </section>
          )}

          <motion.section variants={staggerItem} aria-label="Общая статистика" className="flex flex-col gap-2">
            <h3 className="m-0 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-ink-dim">
              <span aria-hidden className="h-px w-3 bg-theme-a shadow-[0_0_6px_var(--theme-a)]" />
              За всё время
            </h3>
            <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat icon={Hash} label="Забегов сыграно">
                {formatNumber(stats.gamesPlayed)}
              </Stat>
              <Stat icon={Sigma} label="Всего очков">
                {formatNumber(stats.totalScore)}
              </Stat>
              <Stat icon={Gauge} label="Средний счёт">
                {formatNumber(average)}
              </Stat>
              <Stat icon={Flame} label="Лучшее комбо">
                x{stats.bestMultiplier}
              </Stat>
              <Stat icon={Gem} label="Кристаллов собрано">
                {formatNumber(stats.totalCrystals)}
              </Stat>
              <Stat icon={Clock} label="Время в забегах">
                {formatPlayTime(stats.totalTime)}
              </Stat>
            </dl>
          </motion.section>
        </motion.div>
      </Panel>
    </Overlay>
  );
}
