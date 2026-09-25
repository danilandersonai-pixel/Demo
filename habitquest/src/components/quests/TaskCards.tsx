import { AnimatePresence, motion } from 'framer-motion';
import { Ban, CalendarDays, Check, ChevronDown, ChevronUp, Flame, Minus, Pencil, Plus, Trash2, Trophy } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { DIFFICULTY_META, STAT_META, WEEKDAYS_SHORT } from '../../game/constants';
import { diffDays, formatShortDate } from '../../game/dates';
import { isDailyDue, previewDamage, previewGrant } from '../../game/engine';
import { STAT_COLORS, STAT_ICONS } from '../../game/icons';
import type { Daily, DateKey, Difficulty, Habit, Hero, Origin, StatKey, Todo } from '../../types';
import { IconButton } from '../ui/Button';
import { DifficultyStars } from '../ui/Controls';
import { Chip } from '../ui/Misc';

export function originFrom(event: MouseEvent<HTMLElement>): Origin {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top };
}

interface CardActionsProps {
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

function CardActions({ onEdit, onDelete, onMoveUp, onMoveDown }: CardActionsProps) {
  return (
    <div className="-my-1 -mr-1 flex shrink-0 items-center gap-0.5 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 sm:opacity-0">
      {onMoveUp && (
        <IconButton label="Выше" onClick={onMoveUp} className="h-7 w-7">
          <ChevronUp size={15} />
        </IconButton>
      )}
      {onMoveDown && (
        <IconButton label="Ниже" onClick={onMoveDown} className="h-7 w-7">
          <ChevronDown size={15} />
        </IconButton>
      )}
      <IconButton label="Редактировать" tone="cyber" onClick={onEdit} className="h-7 w-7">
        <Pencil size={14} />
      </IconButton>
      <IconButton label="Удалить" tone="danger" onClick={onDelete} className="h-7 w-7">
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}

function StatChip({ stat }: { stat: StatKey }) {
  const Icon = STAT_ICONS[stat];
  return (
    <Chip className={`${STAT_COLORS[stat].soft} ${STAT_COLORS[stat].text}`}>
      <Icon size={10} /> {STAT_META[stat].short}
    </Chip>
  );
}

function RewardHint({ xp, gold, damage }: { xp?: number; gold?: number; damage?: number }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 font-mono text-[10px] text-violet-200/45">
      {xp !== undefined && <span className="text-violet-300/70">+{xp} XP</span>}
      {gold !== undefined && <span className="text-amber-300/70">+{gold} з.</span>}
      {damage !== undefined && <span className="text-rose-400/75">−{damage} HP</span>}
    </span>
  );
}

const cardMotion = {
  layout: true,
  initial: { opacity: 0, y: 12, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, x: -30, scale: 0.95, transition: { duration: 0.2 } },
  transition: { type: 'spring' as const, stiffness: 420, damping: 34 },
};

function CardShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.li
      {...cardMotion}
      className={`group relative flex items-stretch gap-3 overflow-hidden rounded-xl border bg-black/25 p-3 transition-colors hover:bg-white/[0.04] ${className}`}
    >
      {children}
    </motion.li>
  );
}

/** Нижняя строка карточки: прогноз награды слева, кнопки управления справа. */
function CardFooter({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mt-1.5 flex min-h-7 items-center justify-between gap-2">
      {children}
      {actions}
    </div>
  );
}

function Notes({ text }: { text: string }) {
  if (!text) return null;
  return <p className="mt-0.5 line-clamp-2 text-xs text-violet-200/50">{text}</p>;
}

// ---------------------------------------------------------------------------

interface HabitCardProps {
  habit: Habit;
  hero: Hero;
  today: DateKey;
  onPlus: (origin: Origin) => void;
  onMinus: (origin: Origin) => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function HabitCard({ habit, hero, today, onPlus, onMinus, onEdit, onDelete, onMoveUp, onMoveDown }: HabitCardProps) {
  const reward = previewGrant(hero, 'habit', habit.difficulty);
  const damage = previewDamage(hero, 'habit', habit.difficulty);
  const doneToday = habit.lastPlusDate === today;

  return (
    <CardShell className={habit.negative && !habit.positive ? 'border-rose-500/20' : 'border-violet-400/15'}>
      {habit.positive ? (
        <HabitButton kind="plus" label={`Выполнить привычку «${habit.title}»`} onClick={(e) => onPlus(originFrom(e))} />
      ) : (
        <div className="grid w-10 shrink-0 place-items-center rounded-lg border border-violet-400/10 bg-white/[0.02] text-violet-300/20">
          <Ban size={16} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug font-semibold text-violet-50">{habit.title}</p>
        <Notes text={habit.notes} />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <DifficultyStars difficulty={habit.difficulty} />
          {habit.positive && (
            <Chip className="border-emerald-400/25 bg-emerald-500/10 text-emerald-300">
              <Plus size={10} /> {habit.countUp}
            </Chip>
          )}
          {habit.negative && (
            <Chip className="border-rose-400/25 bg-rose-500/10 text-rose-300">
              <Minus size={10} /> {habit.countDown}
            </Chip>
          )}
          {habit.penalizeSkip && (
            <Chip
              className={doneToday ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200' : 'border-amber-400/30 bg-amber-500/10 text-amber-200'}
            >
              {doneToday ? 'сегодня ✓' : 'нужно сегодня'}
            </Chip>
          )}
        </div>
        <CardFooter actions={<CardActions onEdit={onEdit} onDelete={onDelete} onMoveUp={onMoveUp} onMoveDown={onMoveDown} />}>
          <RewardHint
            xp={habit.positive ? reward.xp : undefined}
            gold={habit.positive ? reward.gold : undefined}
            damage={habit.negative ? damage : undefined}
          />
        </CardFooter>
      </div>

      {habit.negative ? (
        <HabitButton kind="minus" label={`Отметить вредное действие «${habit.title}»`} onClick={(e) => onMinus(originFrom(e))} />
      ) : (
        <div className="grid w-10 shrink-0 place-items-center rounded-lg border border-violet-400/10 bg-white/[0.02] text-violet-300/20">
          <Ban size={16} />
        </div>
      )}
    </CardShell>
  );
}

function HabitButton({ kind, label, onClick }: { kind: 'plus' | 'minus'; label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void }) {
  const plus = kind === 'plus';
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.85, rotate: plus ? 8 : -8 }}
      transition={{ type: 'spring', stiffness: 600, damping: 20 }}
      className={`focus-ring grid w-10 shrink-0 cursor-pointer place-items-center rounded-lg border transition-shadow ${
        plus
          ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:shadow-[0_0_20px_-2px_rgba(52,211,153,0.8)]'
          : 'border-rose-400/40 bg-rose-500/15 text-rose-200 hover:shadow-[0_0_20px_-2px_rgba(255,59,92,0.8)]'
      }`}
    >
      {plus ? <Plus size={20} /> : <Minus size={20} />}
    </motion.button>
  );
}

// ---------------------------------------------------------------------------

function CheckButton({ checked, disabled, label, onClick }: { checked: boolean; disabled?: boolean; label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      whileHover={disabled ? undefined : { scale: 1.08 }}
      whileTap={disabled ? undefined : { scale: 0.85 }}
      className={`focus-ring grid h-10 w-10 shrink-0 cursor-pointer place-items-center self-start rounded-lg border transition-all disabled:cursor-not-allowed disabled:opacity-30 ${
        checked
          ? 'border-cyan-300/60 bg-cyan-500/30 text-white shadow-[0_0_20px_-2px_rgba(34,211,238,0.85)]'
          : 'border-violet-400/35 bg-violet-500/10 text-transparent hover:border-cyan-300/50 hover:shadow-[0_0_16px_-4px_rgba(34,211,238,0.7)]'
      }`}
    >
      <AnimatePresence initial={false}>
        {checked && (
          <motion.span
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            transition={{ type: 'spring', stiffness: 700, damping: 18 }}
          >
            <Check size={20} strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

interface DailyCardProps {
  daily: Daily;
  hero: Hero;
  today: DateKey;
  onToggle: (origin: Origin) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function DailyCard({ daily, hero, today, onToggle, onEdit, onDelete, onMoveUp, onMoveDown }: DailyCardProps) {
  const due = isDailyDue(daily, today);
  const reward = previewGrant(hero, 'daily', daily.difficulty, daily.streak);
  const damage = previewDamage(hero, 'daily', daily.difficulty);
  const everyDay = daily.days.length === 7;

  return (
    <CardShell
      className={
        daily.completed
          ? 'border-cyan-400/30 bg-cyan-500/[0.06]'
          : due
            ? 'border-violet-400/15'
            : 'border-violet-400/10 opacity-60'
      }
    >
      <CheckButton
        checked={daily.completed}
        disabled={!due && !daily.completed}
        label={daily.completed ? `Отменить «${daily.title}»` : `Выполнить «${daily.title}»`}
        onClick={(e) => onToggle(originFrom(e))}
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm leading-snug font-semibold transition-colors ${daily.completed ? 'text-violet-200/50 line-through decoration-cyan-300/60' : 'text-violet-50'}`}>
          {daily.title}
        </p>
        <Notes text={daily.notes} />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <DifficultyStars difficulty={daily.difficulty} />
          <StatChip stat={daily.stat} />
          {daily.streak > 0 && (
            <Chip className="border-orange-400/30 bg-orange-500/10 text-orange-200">
              <Flame size={10} /> {daily.streak}
            </Chip>
          )}
          {daily.bestStreak > 0 && (
            <Chip className="border-violet-400/20 bg-violet-500/5 text-violet-200/60">
              <Trophy size={10} /> {daily.bestStreak}
            </Chip>
          )}
          <Chip className="border-violet-400/15 bg-white/[0.03] text-violet-200/60">
            <CalendarDays size={10} />
            {everyDay ? 'каждый день' : daily.days.map((d) => WEEKDAYS_SHORT[d]).join(' ')}
          </Chip>
          {!due && <Chip className="border-slate-400/20 bg-slate-500/10 text-slate-300">выходной</Chip>}
        </div>
        <CardFooter
          actions={onEdit && onDelete ? <CardActions onEdit={onEdit} onDelete={onDelete} onMoveUp={onMoveUp} onMoveDown={onMoveDown} /> : undefined}
        >
          <RewardHint xp={reward.xp} gold={reward.gold} damage={due && !daily.completed ? damage : undefined} />
        </CardFooter>
      </div>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------

const DIFFICULTY_CHIP: Record<Difficulty, string> = {
  easy: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  medium: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
  epic: 'border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-200 shadow-[0_0_10px_-2px_rgba(232,121,249,0.7)]',
};

function DueChip({ dueDate, today, completed }: { dueDate: DateKey; today: DateKey; completed: boolean }) {
  const days = diffDays(today, dueDate);
  if (completed) {
    return (
      <Chip className="border-violet-400/15 bg-white/[0.03] text-violet-200/50">
        <CalendarDays size={10} /> {formatShortDate(dueDate)}
      </Chip>
    );
  }
  if (days < 0) {
    return (
      <Chip className="animate-pulse-soft border-rose-400/40 bg-rose-500/15 text-rose-200">
        <CalendarDays size={10} /> просрочено · {formatShortDate(dueDate)}
      </Chip>
    );
  }
  if (days === 0) {
    return (
      <Chip className="border-amber-400/40 bg-amber-500/15 text-amber-200">
        <CalendarDays size={10} /> сегодня
      </Chip>
    );
  }
  return (
    <Chip className="border-violet-400/20 bg-white/[0.03] text-violet-200/70">
      <CalendarDays size={10} /> {days === 1 ? 'завтра' : formatShortDate(dueDate)}
    </Chip>
  );
}

interface TodoCardProps {
  todo: Todo;
  hero: Hero;
  today: DateKey;
  onToggle: (origin: Origin) => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function TodoCard({ todo, hero, today, onToggle, onEdit, onDelete, onMoveUp, onMoveDown }: TodoCardProps) {
  const reward = todo.completedGrant ?? previewGrant(hero, 'todo', todo.difficulty);
  return (
    <CardShell className={todo.completed ? 'border-cyan-400/25 bg-cyan-500/[0.05]' : todo.difficulty === 'epic' ? 'border-fuchsia-400/25' : 'border-violet-400/15'}>
      <CheckButton
        checked={todo.completed}
        label={todo.completed ? `Вернуть «${todo.title}» в работу` : `Выполнить «${todo.title}»`}
        onClick={(e) => onToggle(originFrom(e))}
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm leading-snug font-semibold ${todo.completed ? 'text-violet-200/50 line-through decoration-cyan-300/60' : 'text-violet-50'}`}>
          {todo.title}
        </p>
        <Notes text={todo.notes} />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip className={DIFFICULTY_CHIP[todo.difficulty]}>
            <DifficultyStars difficulty={todo.difficulty} /> {DIFFICULTY_META[todo.difficulty].label}
          </Chip>
          <StatChip stat={todo.stat} />
          {todo.dueDate && <DueChip dueDate={todo.dueDate} today={today} completed={todo.completed} />}
        </div>
        <CardFooter
          actions={
            <CardActions
              onEdit={onEdit}
              onDelete={onDelete}
              onMoveUp={todo.completed ? undefined : onMoveUp}
              onMoveDown={todo.completed ? undefined : onMoveDown}
            />
          }
        >
          <RewardHint xp={reward.xp} gold={reward.gold} />
        </CardFooter>
      </div>
    </CardShell>
  );
}
