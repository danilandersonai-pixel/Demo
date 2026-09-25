import { BookOpen, CalendarClock, CheckCircle2, Database, Download, FastForward, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import {
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  DEATH_GOLD_PENALTY,
  DIFFICULTY_META,
  DIFFICULTY_ORDER,
  REWARD_TABLE,
  STAT_META,
  STAT_ORDER,
  STREAK_BONUS_CAP,
  STREAK_BONUS_PER_DAY,
  levelUpGoldBonus,
  xpToNextLevel,
} from '../../game/constants';
import { formatLongDate, toDateKey } from '../../game/dates';
import { POTION_HEAL } from '../../game/engine';
import { exportState, importStateFile } from '../../game/storage';
import type { GameActions } from '../../hooks/useGame';
import type { GameState, TaskType } from '../../types';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Panel } from '../ui/Misc';

interface SettingsViewProps {
  state: GameState;
  today: string;
  actions: GameActions;
  saveFailed: boolean;
}

const TYPE_LABELS: Record<TaskType, string> = { habit: 'Привычка', daily: 'Дейлик', todo: 'Разовый квест' };

export function SettingsView({ state, today, actions, saveFailed }: SettingsViewProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDay, setConfirmDay] = useState(false);
  const [importMessage, setImportMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const onImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const result = await importStateFile(file, toDateKey(new Date()));
    if (typeof result === 'string') {
      setImportMessage({ ok: false, text: result });
      return;
    }
    actions.importState(result);
    setImportMessage({ ok: true, text: `Герой «${result.hero.name}» загружен (уровень ${result.hero.level}).` });
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title="Игровое время" icon={<CalendarClock size={16} className="text-cyan-300" />}>
        <p className="text-sm text-violet-100/80">
          Сегодня в игре: <span className="font-semibold text-white capitalize">{formatLongDate(today)}</span>
          {state.dayOffset > 0 && <span className="text-amber-300"> (симуляция +{state.dayOffset} дн.)</span>}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-violet-200/55">
          Сутки сменяются автоматически в полночь (проверка каждые 30 секунд и при возвращении во вкладку). Чтобы увидеть механику дейликов
          прямо сейчас, промотайте время вперёд: невыполненные сегодня дейлики и пропущенные привычки нанесут урон.
        </p>
        <Button variant="cyber" className="mt-4" icon={<FastForward size={16} />} onClick={() => setConfirmDay(true)}>
          Симулировать новый день
        </Button>
      </Panel>

      <Panel title="Сохранение" icon={<Database size={16} className="text-violet-300" />} delay={0.05}>
        <p className={`flex items-center gap-2 text-sm ${saveFailed ? 'text-rose-300' : 'text-emerald-300'}`}>
          {saveFailed ? <TriangleAlert size={16} /> : <CheckCircle2 size={16} />}
          {saveFailed ? 'Браузер запретил localStorage — прогресс не сохранится после закрытия.' : 'Автосохранение в localStorage включено.'}
        </p>
        <p className="mt-2 text-xs text-violet-200/55">Экспортируйте героя в JSON, чтобы перенести его в другой браузер или сделать резервную копию.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" icon={<Download size={16} />} onClick={() => exportState(state)}>
            Экспорт
          </Button>
          <Button variant="ghost" icon={<Upload size={16} />} onClick={() => fileRef.current?.click()}>
            Импорт
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImport} aria-hidden="true" tabIndex={-1} />
        </div>
        {importMessage && (
          <p role="status" className={`mt-3 text-sm ${importMessage.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
            {importMessage.text}
          </p>
        )}
        <div className="mt-6 rounded-xl border border-rose-500/25 bg-rose-500/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-rose-200">
            <TriangleAlert size={16} /> Опасная зона
          </p>
          <p className="mt-1 text-xs text-violet-200/55">Начать игру заново со стартовыми квестами и наградами. Текущий герой будет удалён.</p>
          <Button variant="danger" size="sm" className="mt-3" icon={<RotateCcw size={14} />} onClick={() => setConfirmReset(true)}>
            Сбросить прогресс
          </Button>
        </div>
      </Panel>

      <Panel title="Правила игры" icon={<BookOpen size={16} className="text-amber-300" />} className="xl:col-span-2" delay={0.1}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 font-display text-xs tracking-[0.18em] text-violet-200/70 uppercase">Награды и штрафы</h3>
            <div className="overflow-x-auto rounded-xl border border-violet-400/15">
              <table className="w-full min-w-[420px] text-left text-xs">
                <thead className="bg-white/5 text-violet-200/70">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Тип</th>
                    <th className="px-3 py-2 font-semibold">Сложность</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-300">XP</th>
                    <th className="px-3 py-2 text-right font-semibold text-amber-300">Золото</th>
                    <th className="px-3 py-2 text-right font-semibold text-emerald-300">Стат</th>
                    <th className="px-3 py-2 text-right font-semibold text-rose-400">Урон</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {(Object.keys(REWARD_TABLE) as TaskType[]).map((type) =>
                    DIFFICULTY_ORDER.map((difficulty, i) => {
                      const row = REWARD_TABLE[type][difficulty];
                      return (
                        <tr key={`${type}-${difficulty}`} className={i === 0 ? 'border-t border-violet-400/15' : ''}>
                          <td className="px-3 py-1.5 font-sans text-violet-100">{i === 0 ? TYPE_LABELS[type] : ''}</td>
                          <td className="px-3 py-1.5 font-sans text-violet-200/70">{DIFFICULTY_META[difficulty].label}</td>
                          <td className="px-3 py-1.5 text-right">{row.xp}</td>
                          <td className="px-3 py-1.5 text-right">{row.gold}</td>
                          <td className="px-3 py-1.5 text-right">+{row.statPoints}</td>
                          <td className="px-3 py-1.5 text-right">{row.damage > 0 ? `−${row.damage}` : '—'}</td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-violet-200/50">
              Урон для привычки — за нажатие «−»; пропуск дня у привычки со штрафом — половина урона. Для дейлика — за пропуск в запланированный день.
            </p>
          </div>

          <ul className="space-y-3 text-sm text-violet-100/80">
            <li>
              <span className="font-semibold text-violet-300">Уровни.</span> Для уровня 2 нужно {xpToNextLevel(1)} XP, затем лимит растёт на 25:{' '}
              {[2, 3, 4, 5].map((l) => xpToNextLevel(l)).join(', ')}… Излишек опыта переносится. За впервые достигнутый уровень — полное HP и бонус
              золота (уровень × {levelUpGoldBonus(1)}).
            </li>
            <li>
              <span className="font-semibold text-emerald-300">Характеристики.</span>{' '}
              {STAT_ORDER.map((s) => `${STAT_META[s].label}: ${STAT_META[s].bonus}`).join('; ')}. Очки идут в характеристику, привязанную к квесту.
            </li>
            <li>
              <span className="font-semibold text-cyan-300">Криты.</span> С шансом {Math.round(CRIT_CHANCE * 100)}% награда умножается на {CRIT_MULTIPLIER}.
            </li>
            <li>
              <span className="font-semibold text-orange-300">Серии.</span> Каждый день серии дейлика даёт +{Math.round(STREAK_BONUS_PER_DAY * 100)}% опыта (до +
              {Math.round(STREAK_BONUS_PER_DAY * STREAK_BONUS_CAP * 100)}%).
            </li>
            <li>
              <span className="font-semibold text-rose-300">Гибель.</span> Когда HP падает до нуля, герой теряет уровень и{' '}
              {Math.round(DEATH_GOLD_PENALTY * 100)}% золота, затем возрождается. Зелье здоровья в магазине восстанавливает {POTION_HEAL} HP.
            </li>
            <li>
              <span className="font-semibold text-violet-300">Отмена.</span> Выполнение дейлика или квеста можно отменить — награда списывается обратно, если
              золото ещё не потрачено.
            </li>
          </ul>
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmDay}
        tone="primary"
        title="Симулировать новый день?"
        message="Игровой календарь сдвинется на сутки вперёд. Невыполненные дейлики и пропущенные привычки со штрафом нанесут урон, отметки дейликов сбросятся."
        confirmLabel="Промотать сутки"
        onConfirm={actions.simulateNextDay}
        onCancel={() => setConfirmDay(false)}
      />
      <ConfirmDialog
        open={confirmReset}
        title="Сбросить весь прогресс?"
        message="Герой, квесты, награды и журнал будут заменены стартовыми. Это действие нельзя отменить — сделайте экспорт, если сомневаетесь."
        confirmLabel="Сбросить"
        onConfirm={actions.resetGame}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
