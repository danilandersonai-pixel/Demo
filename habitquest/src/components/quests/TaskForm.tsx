import { CalendarCheck, ListTodo, Repeat, Save, Trash2 } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { ALL_DAYS, DEFAULT_STAT, STAT_META } from '../../game/constants';
import { previewDamage, previewGrant } from '../../game/engine';
import type { GameActions } from '../../hooks/useGame';
import type { Daily, DateKey, Difficulty, Habit, Hero, StatKey, TaskType, Todo } from '../../types';
import { Button } from '../ui/Button';
import { DifficultyPicker, FieldLabel, StatPicker, Toggle, WeekdayPicker } from '../ui/Controls';
import { Modal } from '../ui/Modal';

export type FormTarget =
  | { type: 'habit'; task: Habit | null }
  | { type: 'daily'; task: Daily | null }
  | { type: 'todo'; task: Todo | null };

interface FormValues {
  title: string;
  notes: string;
  difficulty: Difficulty;
  positive: boolean;
  negative: boolean;
  penalizeSkip: boolean;
  stat: StatKey;
  days: number[];
  dueDate: string;
}

const TYPE_META: Record<TaskType, { create: string; edit: string; icon: typeof Repeat }> = {
  habit: { create: 'Новая привычка', edit: 'Редактировать привычку', icon: Repeat },
  daily: { create: 'Новый дейлик', edit: 'Редактировать дейлик', icon: CalendarCheck },
  todo: { create: 'Новый квест', edit: 'Редактировать квест', icon: ListTodo },
};

function initialValues(target: FormTarget): FormValues {
  const base: FormValues = {
    title: '',
    notes: '',
    difficulty: target.type === 'todo' ? 'medium' : 'easy',
    positive: true,
    negative: false,
    penalizeSkip: false,
    stat: DEFAULT_STAT[target.type],
    days: [...ALL_DAYS],
    dueDate: '',
  };
  if (!target.task) return base;
  const { title, notes, difficulty } = target.task;
  if (target.type === 'habit') {
    return { ...base, title, notes, difficulty, positive: target.task.positive, negative: target.task.negative, penalizeSkip: target.task.penalizeSkip };
  }
  if (target.type === 'daily') {
    return { ...base, title, notes, difficulty, stat: target.task.stat, days: [...target.task.days] };
  }
  return { ...base, title, notes, difficulty, stat: target.task.stat, dueDate: target.task.dueDate ?? '' };
}

interface TaskFormModalProps {
  target: FormTarget | null;
  hero: Hero;
  today: DateKey;
  actions: GameActions;
  onClose: () => void;
  onRequestDelete: (type: TaskType, id: string, title: string) => void;
}

/** Модальное окно создания/редактирования. Тело пересоздаётся для каждой задачи через key. */
export function TaskFormModal({ target, ...rest }: TaskFormModalProps) {
  const lastTarget = useRef<FormTarget | null>(target);
  if (target) lastTarget.current = target;
  const shown = target ?? lastTarget.current;
  const meta = shown ? TYPE_META[shown.type] : TYPE_META.habit;
  const Icon = meta.icon;
  const formId = useId();

  return (
    <Modal
      open={target !== null}
      onClose={rest.onClose}
      title={shown?.task ? meta.edit : meta.create}
      icon={<Icon size={18} className="text-cyan-300" />}
      width="lg"
      footer={
        shown && (
          <>
            {shown.task && (
              <Button
                variant="danger"
                icon={<Trash2 size={16} />}
                className="mr-auto"
                onClick={() => {
                  if (shown.task) rest.onRequestDelete(shown.type, shown.task.id, shown.task.title);
                }}
              >
                Удалить
              </Button>
            )}
            <Button variant="ghost" onClick={rest.onClose}>
              Отмена
            </Button>
            <Button variant="primary" type="submit" form={formId} icon={<Save size={16} />}>
              {shown.task ? 'Сохранить' : 'Создать'}
            </Button>
          </>
        )
      }
    >
      {shown && <TaskFormBody key={`${shown.type}-${shown.task?.id ?? 'new'}`} formId={formId} target={shown} {...rest} />}
    </Modal>
  );
}

function TaskFormBody({ target, hero, actions, onClose, formId }: Omit<TaskFormModalProps, 'target' | 'onRequestDelete' | 'today'> & { target: FormTarget; formId: string }) {
  const [values, setValues] = useState<FormValues>(() => initialValues(target));
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const notesId = useId();
  const dueId = useId();

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setError(null);
  };

  const reward = previewGrant(hero, target.type, values.difficulty);
  const damage = target.type === 'todo' ? 0 : previewDamage(hero, target.type, values.difficulty);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const title = values.title.trim();
    if (!title) {
      setError('Дайте квесту название.');
      return;
    }
    if (title.length > 80) {
      setError('Название длиннее 80 символов — сократите его.');
      return;
    }
    if (target.type === 'habit' && !values.positive && !values.negative) {
      setError('Привычке нужна хотя бы одна кнопка: «+» или «−».');
      return;
    }
    if (target.type === 'daily' && values.days.length === 0) {
      setError('Выберите хотя бы один день недели.');
      return;
    }

    const common = { title, notes: values.notes, difficulty: values.difficulty };
    if (target.type === 'habit') {
      const draft = { ...common, positive: values.positive, negative: values.negative, penalizeSkip: values.penalizeSkip };
      if (target.task) actions.updateHabit(target.task.id, draft);
      else actions.createHabit(draft);
    } else if (target.type === 'daily') {
      const draft = { ...common, stat: values.stat, days: values.days };
      if (target.task) actions.updateDaily(target.task.id, draft);
      else actions.createDaily(draft);
    } else {
      const draft = { ...common, stat: values.stat, dueDate: values.dueDate || null };
      if (target.task) actions.updateTodo(target.task.id, draft);
      else actions.createTodo(draft);
    }
    onClose();
  };

  return (
    <form id={formId} onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <FieldLabel htmlFor={titleId}>Название</FieldLabel>
        <input
          id={titleId}
          data-autofocus
          className="field"
          value={values.title}
          maxLength={80}
          placeholder={target.type === 'habit' ? 'Например: выпить воды' : target.type === 'daily' ? 'Например: зарядка' : 'Например: сдать отчёт'}
          onChange={(e) => set('title', e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor={notesId}>Заметка</FieldLabel>
        <textarea
          id={notesId}
          className="field min-h-20 resize-y"
          value={values.notes}
          maxLength={240}
          placeholder="Детали, условия, мотивация…"
          onChange={(e) => set('notes', e.target.value)}
        />
      </div>

      <div>
        <FieldLabel>Сложность</FieldLabel>
        <DifficultyPicker value={values.difficulty} onChange={(d) => set('difficulty', d)} />
        <p className="mt-2 font-mono text-xs text-violet-200/60">
          Награда: <span className="text-violet-300">+{reward.xp} XP</span> · <span className="text-amber-300">+{reward.gold} золота</span>
          {damage > 0 && (
            <>
              {' '}· Штраф: <span className="text-rose-400">−{damage} HP</span>
            </>
          )}
        </p>
      </div>

      {target.type === 'habit' ? (
        <div className="space-y-4 rounded-xl border border-violet-400/15 bg-black/20 p-4">
          <p className="text-xs text-violet-200/60">
            Привычки всегда прокачивают <span className="text-emerald-300">{STAT_META.discipline.label}</span>.
          </p>
          <Toggle label="Кнопка «+» — полезное действие" hint="Даёт опыт и золото." checked={values.positive} onChange={(v) => set('positive', v)} />
          <Toggle label="Кнопка «−» — вредное действие" hint="Каждое нажатие снимает HP." checked={values.negative} onChange={(v) => set('negative', v)} />
          {values.positive && (
            <Toggle
              label="Штраф за пропуск дня"
              hint="Если за игровой день ни разу не нажать «+», утром снимется половина урона."
              checked={values.penalizeSkip}
              onChange={(v) => set('penalizeSkip', v)}
            />
          )}
        </div>
      ) : (
        <div>
          <FieldLabel>Качает характеристику</FieldLabel>
          <StatPicker value={values.stat} onChange={(s) => set('stat', s)} />
          <p className="mt-2 text-xs text-violet-200/50">{STAT_META[values.stat].description}</p>
        </div>
      )}

      {target.type === 'daily' && (
        <div>
          <FieldLabel>Расписание</FieldLabel>
          <WeekdayPicker value={values.days} onChange={(d) => set('days', d)} />
          <p className="mt-2 text-xs text-violet-200/50">Пропуск дейлика в запланированный день снимает HP и обнуляет серию.</p>
        </div>
      )}

      {target.type === 'todo' && (
        <div>
          <FieldLabel htmlFor={dueId}>Дедлайн (необязательно)</FieldLabel>
          <div className="flex gap-2">
            <input id={dueId} type="date" className="field" value={values.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
            {values.dueDate && (
              <Button variant="ghost" onClick={() => set('dueDate', '')}>
                Сбросить
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}
    </form>
  );
}
