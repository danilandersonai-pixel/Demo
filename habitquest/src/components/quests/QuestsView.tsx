import { AnimatePresence, motion } from 'framer-motion';
import { CalendarCheck, Eraser, ListTodo, Plus, Repeat, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ALL_DAYS, DEFAULT_STAT } from '../../game/constants';
import { isDailyDue } from '../../game/engine';
import type { GameActions } from '../../hooks/useGame';
import type { DateKey, GameState, TaskType } from '../../types';
import { Button, IconButton } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Segmented } from '../ui/Controls';
import { EmptyState } from '../ui/Misc';
import { DailyCard, HabitCard, TodoCard } from './TaskCards';
import { TaskFormModal, type FormTarget } from './TaskForm';

interface QuestsViewProps {
  state: GameState;
  today: DateKey;
  actions: GameActions;
}

interface PendingDelete {
  type: TaskType;
  id: string;
  title: string;
}

const COLUMN_META: Record<TaskType, { title: string; subtitle: string; icon: LucideIcon; accent: string; placeholder: string }> = {
  habit: {
    title: 'Привычки',
    subtitle: 'Многоразовые «+» и «−». Качают Дисциплину.',
    icon: Repeat,
    accent: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10 shadow-[0_0_14px_-4px_rgba(52,211,153,0.8)]',
    placeholder: 'Новая привычка + Enter',
  },
  daily: {
    title: 'Дейлики',
    subtitle: 'Обновляются каждые сутки. Пропуск ранит.',
    icon: CalendarCheck,
    accent: 'text-cyan-300 border-cyan-400/30 bg-cyan-400/10 shadow-[0_0_14px_-4px_rgba(34,211,238,0.8)]',
    placeholder: 'Новый дейлик + Enter',
  },
  todo: {
    title: 'Разовые квесты',
    subtitle: 'Сложность определяет награду.',
    icon: ListTodo,
    accent: 'text-fuchsia-300 border-fuchsia-400/30 bg-fuchsia-500/10 shadow-[0_0_14px_-4px_rgba(217,70,239,0.8)]',
    placeholder: 'Новый квест + Enter',
  },
};

export function QuestsView({ state, today, actions }: QuestsViewProps) {
  const [mobileColumn, setMobileColumn] = useState<TaskType>('habit');
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [dailyFilter, setDailyFilter] = useState<'due' | 'all'>('due');
  const [todoFilter, setTodoFilter] = useState<'active' | 'done'>('active');

  const dueDailies = useMemo(() => state.dailies.filter((d) => isDailyDue(d, today)), [state.dailies, today]);
  const shownDailies = dailyFilter === 'due' ? dueDailies : state.dailies;
  const activeTodos = useMemo(() => state.todos.filter((t) => !t.completed), [state.todos]);
  const doneTodos = useMemo(
    () => state.todos.filter((t) => t.completed).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    [state.todos],
  );
  const shownTodos = todoFilter === 'active' ? activeTodos : doneTodos;
  const dailiesDone = dueDailies.filter((d) => d.completed).length;

  const quickAdd = (type: TaskType, title: string) => {
    if (type === 'habit') {
      actions.createHabit({ title, notes: '', difficulty: 'easy', positive: true, negative: false, penalizeSkip: false });
    } else if (type === 'daily') {
      actions.createDaily({ title, notes: '', difficulty: 'easy', stat: DEFAULT_STAT.daily, days: [...ALL_DAYS] });
    } else {
      actions.createTodo({ title, notes: '', difficulty: 'medium', stat: DEFAULT_STAT.todo, dueDate: null });
      setTodoFilter('active');
    }
  };

  const requestDelete = (type: TaskType, id: string, title: string) => setPendingDelete({ type, id, title });

  const columnClass = (type: TaskType) => (mobileColumn === type ? 'flex' : 'hidden xl:flex');

  return (
    <div className="flex flex-col gap-4">
      <div className="xl:hidden">
        <Segmented<TaskType>
          ariaLabel="Тип квестов"
          value={mobileColumn}
          onChange={setMobileColumn}
          options={[
            { value: 'habit', label: <><Repeat size={14} /> Привычки</> },
            { value: 'daily', label: <><CalendarCheck size={14} /> Дейлики {dailiesDone}/{dueDailies.length}</> },
            { value: 'todo', label: <><ListTodo size={14} /> To-do {activeTodos.length}</> },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Column
          key={`habit-${mobileColumn === 'habit'}`}
          type="habit"
          className={columnClass('habit')}
          count={state.habits.length}
          onQuickAdd={quickAdd}
          onOpenForm={() => setFormTarget({ type: 'habit', task: null })}
          delay={0}
        >
          {state.habits.length === 0 ? (
            <EmptyState icon={<Repeat size={28} />} title="Привычек нет" hint="Добавьте то, что хотите делать чаще — или реже." />
          ) : (
            <ul className="flex flex-col gap-2.5">
              <AnimatePresence>
                {state.habits.map((habit, index) => (
                  <HabitCard
                    key={habit.id}
                    index={index}
                    habit={habit}
                    hero={state.hero}
                    today={today}
                    onPlus={(o) => actions.habitPlus(habit.id, o)}
                    onMinus={(o) => actions.habitMinus(habit.id, o)}
                    onEdit={() => setFormTarget({ type: 'habit', task: habit })}
                    onDelete={() => requestDelete('habit', habit.id, habit.title)}
                    onMoveUp={index > 0 ? () => actions.moveTask('habit', habit.id, -1) : undefined}
                    onMoveDown={index < state.habits.length - 1 ? () => actions.moveTask('habit', habit.id, 1) : undefined}
                  />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Column>

        <Column
          key={`daily-${mobileColumn === 'daily'}`}
          type="daily"
          className={columnClass('daily')}
          count={`${dailiesDone}/${dueDailies.length}`}
          onQuickAdd={quickAdd}
          onOpenForm={() => setFormTarget({ type: 'daily', task: null })}
          delay={0.06}
          toolbar={
            <Segmented
              ariaLabel="Фильтр дейликов"
              value={dailyFilter}
              onChange={setDailyFilter}
              options={[
                { value: 'due', label: `На сегодня (${dueDailies.length})` },
                { value: 'all', label: `Все (${state.dailies.length})` },
              ]}
            />
          }
          progress={dueDailies.length > 0 ? dailiesDone / dueDailies.length : 0}
        >
          {shownDailies.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck size={28} />}
              title={dailyFilter === 'due' ? 'На сегодня дейликов нет' : 'Дейликов нет'}
              hint={dailyFilter === 'due' ? 'Свободный день — или время добавить новый ритуал.' : 'Добавьте ежедневный ритуал.'}
            />
          ) : (
            <ul key={dailyFilter} className="flex flex-col gap-2.5">
              <AnimatePresence>
                {shownDailies.map((daily, position) => {
                  const index = state.dailies.findIndex((d) => d.id === daily.id);
                  return (
                    <DailyCard
                      key={daily.id}
                      index={position}
                      daily={daily}
                      hero={state.hero}
                      today={today}
                      onToggle={(o) => actions.toggleDaily(daily.id, o)}
                      onEdit={() => setFormTarget({ type: 'daily', task: daily })}
                      onDelete={() => requestDelete('daily', daily.id, daily.title)}
                      onMoveUp={dailyFilter === 'all' && index > 0 ? () => actions.moveTask('daily', daily.id, -1) : undefined}
                      onMoveDown={
                        dailyFilter === 'all' && index < state.dailies.length - 1 ? () => actions.moveTask('daily', daily.id, 1) : undefined
                      }
                    />
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </Column>

        <Column
          key={`todo-${mobileColumn === 'todo'}`}
          type="todo"
          className={columnClass('todo')}
          count={activeTodos.length}
          onQuickAdd={quickAdd}
          onOpenForm={() => setFormTarget({ type: 'todo', task: null })}
          delay={0.12}
          toolbar={
            <div className="flex items-center gap-2">
              <Segmented
                ariaLabel="Фильтр квестов"
                value={todoFilter}
                onChange={setTodoFilter}
                options={[
                  { value: 'active', label: `Активные (${activeTodos.length})` },
                  { value: 'done', label: `Выполненные (${doneTodos.length})` },
                ]}
              />
              {todoFilter === 'done' && doneTodos.length > 0 && (
                <IconButton label="Очистить выполненные" tone="danger" onClick={actions.clearCompletedTodos}>
                  <Eraser size={16} />
                </IconButton>
              )}
            </div>
          }
        >
          {shownTodos.length === 0 ? (
            <EmptyState
              icon={<ListTodo size={28} />}
              title={todoFilter === 'active' ? 'Все квесты выполнены!' : 'Пока ничего не выполнено'}
              hint={todoFilter === 'active' ? 'Добавьте новую цель — эпичные квесты дают больше всего наград.' : 'Выполненные квесты появятся здесь, их можно вернуть в работу.'}
            />
          ) : (
            <ul key={todoFilter} className="flex flex-col gap-2.5">
              <AnimatePresence>
                {shownTodos.map((todo, position) => {
                  const index = activeTodos.findIndex((t) => t.id === todo.id);
                  const fullIndex = state.todos.findIndex((t) => t.id === todo.id);
                  return (
                    <TodoCard
                      key={todo.id}
                      index={position}
                      todo={todo}
                      hero={state.hero}
                      today={today}
                      onToggle={(o) => actions.toggleTodo(todo.id, o)}
                      onEdit={() => setFormTarget({ type: 'todo', task: todo })}
                      onDelete={() => requestDelete('todo', todo.id, todo.title)}
                      onMoveUp={index > 0 && fullIndex > 0 ? () => actions.moveTask('todo', todo.id, -1) : undefined}
                      onMoveDown={index >= 0 && index < activeTodos.length - 1 ? () => actions.moveTask('todo', todo.id, 1) : undefined}
                    />
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </Column>
      </div>

      <TaskFormModal
        target={formTarget}
        hero={state.hero}
        today={today}
        actions={actions}
        onClose={() => setFormTarget(null)}
        onRequestDelete={(type, id, title) => {
          setFormTarget(null);
          requestDelete(type, id, title);
        }}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить квест?"
        message={pendingDelete ? `«${pendingDelete.title}» исчезнет навсегда. Полученные за него награды останутся у героя.` : ''}
        confirmLabel="Удалить"
        onConfirm={() => {
          if (pendingDelete) actions.deleteTask(pendingDelete.type, pendingDelete.id);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

interface ColumnProps {
  type: TaskType;
  className: string;
  count: number | string;
  onQuickAdd: (type: TaskType, title: string) => void;
  onOpenForm: () => void;
  toolbar?: ReactNode;
  progress?: number;
  delay: number;
  children: ReactNode;
}

function Column({ type, className, count, onQuickAdd, onOpenForm, toolbar, progress, delay, children }: ColumnProps) {
  const meta = COLUMN_META[type];
  const Icon = meta.icon;
  const [title, setTitle] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onQuickAdd(type, trimmed.slice(0, 80));
    setTitle('');
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`glass flex-col gap-3 rounded-2xl p-4 ${className}`}
      aria-label={meta.title}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${meta.accent}`}>
            <Icon size={17} />
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-[12px] font-medium tracking-[0.14em] text-slate-100 uppercase">
              {meta.title}
              <span className="rounded border border-white/[0.08] bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-slate-300">{count}</span>
            </h2>
            <p className="mt-1 text-xs text-slate-400">{meta.subtitle}</p>
          </div>
        </div>
        <Button variant="cyber" size="sm" icon={<SlidersHorizontal size={14} />} onClick={onOpenForm} aria-label={`Создать: ${meta.title}`}>
          Создать
        </Button>
      </header>

      {progress !== undefined && (
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.05]" aria-hidden="true">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 shadow-[0_0_10px_rgba(34,211,238,0.8)]"
            initial={false}
            animate={{ width: `${Math.round(progress * 100)}%` }}
            transition={{ type: 'spring', stiffness: 110, damping: 20 }}
          />
        </div>
      )}

      <form onSubmit={submit} className="flex gap-2">
        <input
          className="field h-10 py-0 text-sm"
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={meta.placeholder}
          aria-label={`Быстро добавить: ${meta.title}`}
        />
        <Button type="submit" variant="primary" size="md" square disabled={!title.trim()} aria-label="Добавить">
          <Plus size={18} />
        </Button>
      </form>

      {toolbar}
      <div className="-mx-1 max-h-[calc(100vh-24rem)] min-h-40 overflow-y-auto px-1 pt-1 pb-2 xl:max-h-[calc(100vh-26rem)]">{children}</div>
    </motion.section>
  );
}
