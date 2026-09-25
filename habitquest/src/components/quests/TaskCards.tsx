import { AnimatePresence, motion } from 'framer-motion';
import { Ban, CalendarDays, Check, ChevronDown, ChevronUp, Flame, Minus, Pencil, Plus, Trash2, Trophy } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
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

/** Цвет полосы сложности слева: зелёный — легко, синий — средне, фиолетовый неон — эпично. */
const DIFFICULTY_STRIPE: Record<Difficulty, string> = {
  easy: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.75)]',
  medium: 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]',
  epic: 'bg-gradient-to-b from-fuchsia-400 to-violet-600 shadow-[0_0_14px_rgba(217,70,239,0.95)]',
};

const DIFFICULTY_CHIP: Record<Difficulty, string> = {
  easy: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  medium: 'border-blue-400/25 bg-blue-500/10 text-blue-300',
  epic: 'border-fuchsia-400/35 bg-fuchsia-500/15 text-fuchsia-200 shadow-[0_0_10px_-2px_rgba(217,70,239,0.7)]',
};

// ---------------------------------------------------------------------------
// Общие части карточки
// ---------------------------------------------------------------------------

interface CardActionsProps {
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

function CardActions({ onEdit, onDelete, onMoveUp, onMoveDown }: CardActionsProps) {
  return (
    <div className="-my-1 -mr-1 flex shrink-0 items-center gap-0.5 transition-opacity duration-300 group-focus-within:opacity-100 group-hover:opacity-100 sm:opacity-0">
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
    <span className="flex flex-wrap items-center gap-x-2.5 font-mono text-[10px] tracking-wider">
      {xp !== undefined && <span className="text-fuchsia-300/80">+{xp} XP</span>}
      {gold !== undefined && <span className="text-amber-300/80">+{gold} G</span>}
      {damage !== undefined && <span className="text-red-400/80">−{damage} HP</span>}
    </span>
  );
}

/** Нижняя строка карточки: прогноз награды слева, кнопки управления справа. */
function CardFooter({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mt-2 flex min-h-7 items-center justify-between gap-2">
      {children}
      {actions}
    </div>
  );
}

function Notes({ text }: { text: string }) {
  if (!text) return null;
  return <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{text}</p>;
}

interface CardShellProps {
  children: ReactNode;
  difficulty: Difficulty;
  /** Порядковый номер в списке — даёт лёгкий каскад при появлении. */
  index?: number;
  tone?: 'default' | 'done' | 'muted' | 'danger';
}

const SHELL_TONES = {
  default: 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.2]',
  done: 'border-cyan-400/20 bg-cyan-400/[0.04] hover:border-cyan-300/40',
  muted: 'border-white/[0.05] bg-white/[0.015] opacity-55 hover:opacity-80',
  danger: 'border-red-500/15 bg-white/[0.03] hover:border-red-400/35',
};

/** Карточка задачи: полоса сложности слева, подъём и отблеск при наведении, появление снизу. */
function CardShell({ children, difficulty, index = 0, tone = 'default' }: CardShellProps) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -30, scale: 0.96, transition: { duration: 0.2 } }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32, delay: Math.min(index * 0.045, 0.35) }}
      className={`group card-shine flex items-center gap-3 rounded-xl border py-3 pr-3 pl-4 shadow-lg shadow-black/20 backdrop-blur-xl transition-[border-color,background-color,opacity,box-shadow] duration-300 hover:shadow-2xl hover:shadow-black/40 ${SHELL_TONES[tone]}`}
    >
      <span aria-hidden="true" className={`absolute top-2.5 bottom-2.5 left-1.5 w-[3px] rounded-full ${DIFFICULTY_STRIPE[difficulty]}`} />
      {children}
    </motion.li>
  );
}

// ---------------------------------------------------------------------------
// Кнопки выполнения
// ---------------------------------------------------------------------------

/** Вспышка вокруг кнопки: расходящееся кольцо и световое пятно. */
function Burst({ id, shape, color }: { id: number; shape: 'diamond' | 'circle'; color: string }) {
  return (
    <AnimatePresence>
      {id > 0 && (
        <motion.span key={id} className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
          <motion.span
            className={`absolute h-7 w-7 border-2 ${color} ${shape === 'diamond' ? 'rotate-45 rounded-[5px]' : 'rounded-full'}`}
            initial={{ scale: 0.8, opacity: 0.95 }}
            animate={{ scale: 2.3, opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
          <motion.span
            className="absolute h-10 w-10 rounded-full bg-white/60 blur-md"
            initial={{ scale: 0.4, opacity: 0.9 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
          />
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** Футуристичный ромб-чекбокс: неоновая обводка, при выполнении заливается цветом со вспышкой. */
function DiamondCheck({
  checked,
  disabled,
  label,
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const [burst, setBurst] = useState(0);
  const prev = useRef(checked);

  useEffect(() => {
    if (checked && !prev.current) setBurst((b) => b + 1);
    prev.current = checked;
  }, [checked]);

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
      whileTap={disabled ? undefined : { scale: 0.95 }}
      className="focus-ring relative grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl disabled:cursor-not-allowed disabled:opacity-35"
    >
      <Burst id={burst} shape="diamond" color="border-cyan-300" />
      <motion.span
        className={`absolute h-7 w-7 rotate-45 rounded-[6px] border-2 transition-[background-color,border-color,box-shadow] duration-300 ${
          checked
            ? 'border-cyan-200 bg-gradient-to-br from-cyan-400 to-fuchsia-500 shadow-[0_0_18px_rgba(34,211,238,0.85)]'
            : 'border-cyan-400/60 bg-cyan-400/[0.04] shadow-[0_0_10px_-2px_rgba(34,211,238,0.6)] group-hover:border-cyan-300'
        }`}
        animate={checked ? { scale: [1, 1.18, 1] } : { scale: 1 }}
        transition={{ duration: 0.35 }}
      />
      <AnimatePresence initial={false}>
        {checked && (
          <motion.span
            className="relative text-white"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 700, damping: 18 }}
          >
            <Check size={16} strokeWidth={3.2} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/** Круглая неоновая кнопка «+» / «−» для привычек. Каждое нажатие даёт вспышку. */
function OrbButton({ kind, label, onClick }: { kind: 'plus' | 'minus'; label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void }) {
  const [burst, setBurst] = useState(0);
  const plus = kind === 'plus';
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        setBurst((b) => b + 1);
        onClick(e);
      }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 600, damping: 22 }}
      className={`focus-ring relative grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full border-2 transition-[background-color,box-shadow,border-color] duration-300 ${
        plus
          ? 'border-emerald-400/60 bg-emerald-400/[0.07] text-emerald-200 shadow-[0_0_12px_-3px_rgba(52,211,153,0.7)] hover:border-emerald-300 hover:bg-emerald-400/20 hover:shadow-[0_0_22px_-2px_rgba(52,211,153,0.9)]'
          : 'border-red-500/60 bg-red-500/[0.07] text-red-200 shadow-[0_0_12px_-3px_rgba(239,68,68,0.7)] hover:border-red-400 hover:bg-red-500/20 hover:shadow-[0_0_22px_-2px_rgba(239,68,68,0.9)]'
      }`}
    >
      <Burst id={burst} shape="circle" color={plus ? 'border-emerald-300' : 'border-red-400'} />
      {plus ? <Plus size={19} strokeWidth={2.6} /> : <Minus size={19} strokeWidth={2.6} />}
    </motion.button>
  );
}

function OrbPlaceholder() {
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-dashed border-white/[0.08] text-slate-700" aria-hidden="true">
      <Ban size={15} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Привычка
// ---------------------------------------------------------------------------

interface HabitCardProps {
  habit: Habit;
  hero: Hero;
  today: DateKey;
  index?: number;
  onPlus: (origin: Origin) => void;
  onMinus: (origin: Origin) => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function HabitCard({ habit, hero, today, index, onPlus, onMinus, onEdit, onDelete, onMoveUp, onMoveDown }: HabitCardProps) {
  const reward = previewGrant(hero, 'habit', habit.difficulty);
  const damage = previewDamage(hero, 'habit', habit.difficulty);
  const doneToday = habit.lastPlusDate === today;

  return (
    <CardShell difficulty={habit.difficulty} index={index} tone={habit.negative && !habit.positive ? 'danger' : 'default'}>
      {habit.positive ? (
        <OrbButton kind="plus" label={`Выполнить привычку «${habit.title}»`} onClick={(e) => onPlus(originFrom(e))} />
      ) : (
        <OrbPlaceholder />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug font-semibold text-slate-100">{habit.title}</p>
        <Notes text={habit.notes} />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <DifficultyStars difficulty={habit.difficulty} />
          {habit.positive && (
            <Chip className="border-emerald-400/25 bg-emerald-400/10 text-emerald-300">
              <Plus size={10} /> {habit.countUp}
            </Chip>
          )}
          {habit.negative && (
            <Chip className="border-red-400/25 bg-red-500/10 text-red-300">
              <Minus size={10} /> {habit.countDown}
            </Chip>
          )}
          {habit.penalizeSkip && (
            <Chip className={doneToday ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' : 'border-amber-400/30 bg-amber-400/10 text-amber-200'}>
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
        <OrbButton kind="minus" label={`Отметить вредное действие «${habit.title}»`} onClick={(e) => onMinus(originFrom(e))} />
      ) : (
        <OrbPlaceholder />
      )}
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// Дейлик
// ---------------------------------------------------------------------------

interface DailyCardProps {
  daily: Daily;
  hero: Hero;
  today: DateKey;
  index?: number;
  onToggle: (origin: Origin) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function DailyCard({ daily, hero, today, index, onToggle, onEdit, onDelete, onMoveUp, onMoveDown }: DailyCardProps) {
  const due = isDailyDue(daily, today);
  const reward = previewGrant(hero, 'daily', daily.difficulty, daily.streak);
  const damage = previewDamage(hero, 'daily', daily.difficulty);
  const everyDay = daily.days.length === 7;

  return (
    <CardShell difficulty={daily.difficulty} index={index} tone={daily.completed ? 'done' : due ? 'default' : 'muted'}>
      <DiamondCheck
        checked={daily.completed}
        disabled={!due && !daily.completed}
        label={daily.completed ? `Отменить «${daily.title}»` : `Выполнить «${daily.title}»`}
        onClick={(e) => onToggle(originFrom(e))}
      />
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm leading-snug font-semibold transition-colors duration-300 ${
            daily.completed ? 'text-slate-500 line-through decoration-cyan-300/60' : 'text-slate-100'
          }`}
        >
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
            <Chip className="border-white/[0.08] bg-white/[0.03] text-slate-400">
              <Trophy size={10} /> {daily.bestStreak}
            </Chip>
          )}
          <Chip className="border-white/[0.08] bg-white/[0.03] text-slate-400">
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
// Разовый квест
// ---------------------------------------------------------------------------

function DueChip({ dueDate, today, completed }: { dueDate: DateKey; today: DateKey; completed: boolean }) {
  const days = diffDays(today, dueDate);
  if (completed) {
    return (
      <Chip className="border-white/[0.08] bg-white/[0.03] text-slate-500">
        <CalendarDays size={10} /> {formatShortDate(dueDate)}
      </Chip>
    );
  }
  if (days < 0) {
    return (
      <Chip className="animate-pulse-soft border-red-400/40 bg-red-500/15 text-red-200">
        <CalendarDays size={10} /> просрочено · {formatShortDate(dueDate)}
      </Chip>
    );
  }
  if (days === 0) {
    return (
      <Chip className="border-amber-400/40 bg-amber-400/15 text-amber-200">
        <CalendarDays size={10} /> сегодня
      </Chip>
    );
  }
  return (
    <Chip className="border-white/[0.08] bg-white/[0.03] text-slate-300">
      <CalendarDays size={10} /> {days === 1 ? 'завтра' : formatShortDate(dueDate)}
    </Chip>
  );
}

interface TodoCardProps {
  todo: Todo;
  hero: Hero;
  today: DateKey;
  index?: number;
  onToggle: (origin: Origin) => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function TodoCard({ todo, hero, today, index, onToggle, onEdit, onDelete, onMoveUp, onMoveDown }: TodoCardProps) {
  const reward = todo.completedGrant ?? previewGrant(hero, 'todo', todo.difficulty);
  return (
    <CardShell difficulty={todo.difficulty} index={index} tone={todo.completed ? 'done' : 'default'}>
      <DiamondCheck
        checked={todo.completed}
        label={todo.completed ? `Вернуть «${todo.title}» в работу` : `Выполнить «${todo.title}»`}
        onClick={(e) => onToggle(originFrom(e))}
      />
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm leading-snug font-semibold transition-colors duration-300 ${
            todo.completed ? 'text-slate-500 line-through decoration-cyan-300/60' : 'text-slate-100'
          }`}
        >
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
