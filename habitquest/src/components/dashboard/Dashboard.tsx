import { motion } from 'framer-motion';
import {
  Activity,
  CalendarCheck,
  Coins,
  Crown,
  Flame,
  Heart,
  Hourglass,
  Medal,
  Pencil,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Target,
  Zap,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import {
  STAT_META,
  STAT_ORDER,
  damageReduction,
  goldMultiplier,
  heroTitle,
  statPointsToNext,
  xpMultiplier,
} from '../../game/constants';
import { diffDays } from '../../game/dates';
import { isDailyDue } from '../../game/engine';
import { AVATARS, STAT_COLORS, STAT_ICONS } from '../../game/icons';
import type { GameActions } from '../../hooks/useGame';
import type { DateKey, GameState, StatKey, TabId } from '../../types';
import { Button } from '../ui/Button';
import { AnimatedNumber, Avatar, EmptyState, Panel } from '../ui/Misc';
import { NeonBar } from '../ui/NeonBar';
import { DailyCard, originFrom } from '../quests/TaskCards';

interface DashboardProps {
  state: GameState;
  today: DateKey;
  maxHp: number;
  xpNeeded: number;
  actions: GameActions;
  onOpenProfile: () => void;
  onNavigate: (tab: TabId) => void;
}

const STAT_SOURCE: Record<StatKey, string> = {
  strength: 'Дейлики и квесты с пометкой «Сила»',
  intellect: 'Дейлики и квесты с пометкой «Интеллект»',
  discipline: 'Все привычки + задачи с пометкой «Дисциплина»',
};

export function Dashboard({ state, today, maxHp, xpNeeded, actions, onOpenProfile, onNavigate }: DashboardProps) {
  const { hero, totals } = state;
  const dueDailies = useMemo(() => state.dailies.filter((d) => isDailyDue(d, today)), [state.dailies, today]);
  const dailiesDone = dueDailies.filter((d) => d.completed).length;
  const urgentTodos = useMemo(
    () =>
      state.todos
        .filter((t) => !t.completed && t.dueDate !== null && diffDays(today, t.dueDate) <= 1)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    [state.todos, today],
  );
  const bestStreak = state.dailies.reduce((max, d) => Math.max(max, d.bestStreak), 0);
  const avatarMeta = AVATARS[hero.avatar];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      {/* Профиль героя */}
      <Panel className="overflow-hidden xl:col-span-7">
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-fuchsia-600/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
          <motion.div
            className="self-center"
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Avatar avatar={hero.avatar} size="lg" level={hero.level} />
          </motion.div>
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-[11px] tracking-[0.3em] text-cyan-300/80 uppercase">{avatarMeta.label}</p>
                <h1 className="truncate font-display text-2xl text-white sm:text-3xl">{hero.name}</h1>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-violet-200/70">
                  <Crown size={14} className="text-amber-300" /> Уровень {hero.level} · {heroTitle(hero.level)}
                </p>
              </div>
              <Button variant="ghost" size="sm" icon={<Pencil size={14} />} onClick={onOpenProfile}>
                Профиль
              </Button>
            </div>
            <NeonBar tone="hp" label="Здоровье" icon={<Heart size={13} />} value={hero.hp} max={maxHp} size="lg" warnBelow={0.3} />
            <NeonBar
              tone="xp"
              label="Опыт"
              icon={<Sparkles size={13} />}
              value={hero.xp}
              max={xpNeeded}
              size="lg"
              valueText={`${hero.xp} / ${xpNeeded} · ещё ${xpNeeded - hero.xp}`}
            />
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2">
                <Coins size={18} className="text-amber-300" />
                <AnimatedNumber value={hero.gold} className="font-display text-xl text-amber-200 neon-gold" />
                <span className="text-xs text-amber-200/60">золота</span>
              </div>
              <p className="text-xs text-violet-200/50">
                Каждый уровень требует на 25 XP больше. Новый уровень восстанавливает HP и даёт бонус золота.
              </p>
            </div>
          </div>
        </div>
      </Panel>

      {/* Сегодня */}
      <Panel title="Сегодня" icon={<Activity size={16} className="text-cyan-300" />} className="xl:col-span-5" delay={0.05}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
          <MiniStat icon={<Sparkles size={15} />} label="Опыт" value={state.today.xp} tone="text-violet-300" />
          <MiniStat icon={<Coins size={15} />} label="Золото" value={state.today.gold} tone="text-amber-300" />
          <MiniStat icon={<Swords size={15} />} label="Квестов" value={state.today.quests} tone="text-cyan-300" />
          <MiniStat icon={<Zap size={15} />} label="Урон" value={state.today.damage} tone="text-rose-400" />
        </div>
        <div className="mt-4">
          <NeonBar
            tone="cyber"
            label="Дейлики"
            icon={<CalendarCheck size={13} />}
            value={dailiesDone}
            max={Math.max(1, dueDailies.length)}
            valueText={`${dailiesDone} / ${dueDailies.length}`}
          />
          <p className="mt-2 text-xs text-violet-200/50">
            {dueDailies.length === 0
              ? 'Сегодня дейликов по расписанию нет.'
              : dailiesDone === dueDailies.length
                ? 'Все дейлики закрыты — ночь пройдёт без урона.'
                : `Осталось ${dueDailies.length - dailiesDone}. Невыполненные в полночь нанесут урон.`}
          </p>
        </div>
        {urgentTodos.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
              <Hourglass size={13} /> Горящие квесты
            </p>
            <ul className="mt-2 space-y-1.5">
              {urgentTodos.slice(0, 4).map((todo) => {
                const days = diffDays(today, todo.dueDate ?? today);
                return (
                  <li key={todo.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-violet-50">{todo.title}</span>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.9 }}
                      onClick={(e) => actions.toggleTodo(todo.id, originFrom(e))}
                      className={`focus-ring shrink-0 cursor-pointer rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                        days < 0 ? 'border-rose-400/40 bg-rose-500/15 text-rose-200' : 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                      }`}
                    >
                      {days < 0 ? 'просрочен' : days === 0 ? 'сегодня' : 'завтра'} · выполнить
                    </motion.button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Panel>

      {/* Характеристики */}
      <Panel title="Характеристики" icon={<Target size={16} className="text-emerald-300" />} className="xl:col-span-7" delay={0.1}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {STAT_ORDER.map((stat, i) => (
            <StatCard key={stat} stat={stat} level={hero.stats[stat].level} xp={hero.stats[stat].xp} delay={0.12 + i * 0.05} />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Bonus icon={<Heart size={14} />} label="Макс. HP" value={`${maxHp}`} tone="text-rose-300" />
          <Bonus icon={<Shield size={14} />} label="Защита" value={`${Math.round(damageReduction(hero) * 100)}%`} tone="text-rose-200" />
          <Bonus icon={<Sparkles size={14} />} label="Бонус XP" value={`+${Math.round((xpMultiplier(hero) - 1) * 100)}%`} tone="text-cyan-300" />
          <Bonus icon={<Coins size={14} />} label="Бонус золота" value={`+${Math.round((goldMultiplier(hero) - 1) * 100)}%`} tone="text-emerald-300" />
        </div>
      </Panel>

      {/* Дейлики на сегодня */}
      <Panel
        title="Квесты дня"
        icon={<CalendarCheck size={16} className="text-cyan-300" />}
        className="xl:col-span-5"
        delay={0.15}
        actions={
          <Button variant="ghost" size="sm" onClick={() => onNavigate('quests')}>
            Все квесты
          </Button>
        }
      >
        {dueDailies.length === 0 ? (
          <EmptyState icon={<CalendarCheck size={26} />} title="Выходной" hint="На сегодня нет дейликов по расписанию." />
        ) : (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
            {dueDailies.map((daily) => (
              <DailyCard key={daily.id} daily={daily} hero={hero} today={today} onToggle={(o) => actions.toggleDaily(daily.id, o)} />
            ))}
          </ul>
        )}
      </Panel>

      {/* Летопись */}
      <Panel title="Летопись героя" icon={<Medal size={16} className="text-amber-300" />} className="xl:col-span-12" delay={0.2}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Record icon={<Swords size={16} />} label="Квестов выполнено" value={totals.questsCompleted} tone="text-violet-300" />
          <Record icon={<Sparkles size={16} />} label="Опыта заработано" value={totals.xpEarned} tone="text-fuchsia-300" />
          <Record icon={<Coins size={16} />} label="Золота добыто" value={totals.goldEarned} tone="text-amber-300" />
          <Record icon={<Coins size={16} />} label="Золота потрачено" value={totals.goldSpent} tone="text-amber-500" />
          <Record icon={<Medal size={16} />} label="Наград куплено" value={totals.rewardsBought} tone="text-emerald-300" />
          <Record icon={<Flame size={16} />} label="Лучшая серия" value={bestStreak} tone="text-orange-300" />
          <Record icon={<Zap size={16} />} label="Критов" value={totals.crits} tone="text-cyan-300" />
          <Record icon={<Target size={16} />} label="Срывов («−»)" value={totals.habitsMinus} tone="text-rose-300" />
          <Record icon={<Heart size={16} />} label="Урона получено" value={totals.damageTaken} tone="text-rose-400" />
          <Record icon={<Skull size={16} />} label="Гибелей" value={totals.deaths} tone="text-slate-300" />
        </div>
      </Panel>
    </div>
  );
}

function MiniStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-violet-400/15 bg-black/25 p-3">
      <p className={`flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase ${tone}`}>
        {icon}
        {label}
      </p>
      <AnimatedNumber value={value} className="mt-1 block font-display text-2xl text-white" />
    </div>
  );
}

function StatCard({ stat, level, xp, delay }: { stat: StatKey; level: number; xp: number; delay: number }) {
  const Icon = STAT_ICONS[stat];
  const colors = STAT_COLORS[stat];
  const need = statPointsToNext(level);
  const pct = Math.min(100, (xp / need) * 100);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ y: -3 }}
      className={`rounded-xl border p-3.5 ${colors.soft}`}
    >
      <div className="flex items-center justify-between">
        <p className={`flex items-center gap-2 font-display text-sm tracking-wide ${colors.text}`}>
          <Icon size={18} /> {STAT_META[stat].label}
        </p>
        <motion.span key={level} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="font-display text-2xl text-white">
          {level}
        </motion.span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/40" role="progressbar" aria-label={STAT_META[stat].label} aria-valuenow={xp} aria-valuemax={need}>
        <motion.div
          className={`h-full rounded-full bg-gradient-to-r ${colors.bar} ${colors.glow}`}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-violet-200/50">
        {xp} / {need} до ур. {level + 1}
      </p>
      <p className="mt-2 text-xs text-violet-100/70">{STAT_META[stat].bonus}</p>
      <p className="mt-1 text-[11px] text-violet-200/45">Качается: {STAT_SOURCE[stat]}</p>
    </motion.div>
  );
}

function Bonus({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-violet-400/10 bg-black/20 px-3 py-2">
      <span className={`flex items-center gap-1.5 text-xs ${tone}`}>
        {icon}
        {label}
      </span>
      <span className="font-mono text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

function Record({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <motion.div whileHover={{ scale: 1.03 }} className="rounded-xl border border-violet-400/10 bg-black/25 p-3">
      <p className={`flex items-center gap-1.5 text-[11px] ${tone}`}>
        {icon}
        {label}
      </p>
      <AnimatedNumber value={value} className="mt-1 block font-display text-xl text-white" />
    </motion.div>
  );
}
