import { motion } from 'framer-motion';
import { Lock, Snowflake, Timer } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ELEMENTS, ELEMENT_META } from '../../game/constants';
import { applyInputKey, parseAnswer } from '../../game/problems';
import type { Element, Problem } from '../../types';
import { ELEMENT_ICONS, ELEMENT_STYLE } from '../ui/Icons';
import { Meter } from '../ui/Meter';
import { Numpad } from './Numpad';

interface ForgeProps {
  problem: Problem;
  timeLeft: number;
  timeLimit: number;
  frozenMs?: number;
  /** Принимать ли ввод (бой идёт и не на паузе). */
  active: boolean;
  onSubmit: (input: string) => void;
  /** Выбор школы магии; не передаётся в блице с фиксированной школой. */
  selectedElement?: Element;
  onSelectElement?: (element: Element) => void;
  isUnlocked?: (element: Element) => boolean;
  /** Особое правило текущего врага. */
  rule?: string | null;
}

/** Нажата ли клавиша внутри поля ввода или открыт диалог — тогда горн не перехватывает клавиатуру. */
function keyboardBlocked(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return true;
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/** Алхимический Горн: выбор школы, пример, таймер, поле ответа и Numpad. */
export function Forge({ problem, timeLeft, timeLimit, frozenMs = 0, active, onSubmit, selectedElement, onSelectElement, isUnlocked, rule }: ForgeProps) {
  const [input, setInput] = useState('');
  // Ref держит актуальный ввод для обработчиков клавиатуры и отправки без побочных эффектов в setState.
  const inputRef = useRef('');
  const element = problem.element;
  const style = ELEMENT_STYLE[element];
  const canSubmit = parseAnswer(input) !== null;
  const ratio = timeLimit > 0 ? timeLeft / timeLimit : 0;

  // Новый пример — чистое поле.
  useEffect(() => {
    inputRef.current = '';
    setInput('');
  }, [problem.id]);

  const press = useCallback((key: string) => {
    const next = applyInputKey(inputRef.current, key);
    inputRef.current = next;
    setInput(next);
  }, []);

  const submit = useCallback(() => {
    const current = inputRef.current;
    if (parseAnswer(current) === null) return;
    // Сразу очищаем поле: повторный Enter не отправит тот же ответ на следующий пример.
    inputRef.current = '';
    setInput('');
    onSubmit(current);
  }, [onSubmit]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || keyboardBlocked(event)) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (event.key === '-' || event.key === '−') {
        event.preventDefault();
        press('-');
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        press('back');
      } else if (event.key === 'Escape' || event.key === 'Delete') {
        press('clear');
      } else if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, press, submit]);

  return (
    <div className="flex flex-col gap-4">
      {onSelectElement && selectedElement && (
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Школа магии">
          {ELEMENTS.map((el) => {
            const Icon = ELEMENT_ICONS[el];
            const unlocked = isUnlocked ? isUnlocked(el) : true;
            const selected = el === selectedElement;
            return (
              <motion.button
                key={el}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!unlocked || !active}
                onClick={() => onSelectElement(el)}
                whileTap={{ scale: 0.95 }}
                title={`${ELEMENT_META[el].magic}: ${ELEMENT_META[el].operation}${unlocked ? '' : ` (с ${ELEMENT_META[el].unlockLevel} уровня)`}`}
                className={`focus-brass flex cursor-pointer flex-col items-center gap-0.5 rounded-xl border px-1 py-2 transition-[border-color,background-color,box-shadow] duration-200 disabled:cursor-not-allowed ${
                  selected
                    ? `${ELEMENT_STYLE[el].soft} ${ELEMENT_STYLE[el].glow}`
                    : 'border-amber-700/30 bg-black/25 hover:border-amber-500/50'
                } ${!unlocked ? 'opacity-40' : ''}`}
              >
                {unlocked ? <Icon size={20} className={ELEMENT_STYLE[el].text} /> : <Lock size={18} className="text-amber-200/60" />}
                <span className="font-display text-[12px] font-bold text-amber-50">{ELEMENT_META[el].name}</span>
                <span className="hidden text-[10px] leading-tight text-amber-200/55 sm:block">{ELEMENT_META[el].operation}</span>
              </motion.button>
            );
          })}
        </div>
      )}

      <div className="glass-vial relative overflow-hidden px-4 pt-3 pb-4">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className={`flex items-center gap-1.5 font-display font-bold tracking-wider uppercase ${style.text}`}>
            {(() => {
              const Icon = ELEMENT_ICONS[element];
              return <Icon size={14} />;
            })()}
            {ELEMENT_META[element].magic}
          </span>
          <span className="font-mono text-[11px] text-amber-200/60">сложность {problem.difficulty}</span>
        </div>

        {/* Новый пример сразу проявляется на месте старого — без задержки на анимацию исчезновения. */}
        <motion.p
          key={problem.id}
          initial={{ opacity: 0, scale: 0.85, filter: 'blur(6px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.22 }}
          className={`mt-3 text-center font-mono text-3xl font-bold tracking-wide sm:text-4xl ${style.text}`}
          style={{ textShadow: '0 0 18px currentColor' }}
          aria-live="polite"
        >
          {problem.display}
          {problem.kind !== 'eq' && <span className="text-amber-100/70"> = ?</span>}
        </motion.p>

        <div
          className={`mx-auto mt-4 flex h-14 max-w-56 items-center justify-center rounded-xl border bg-black/50 font-mono text-3xl font-bold tabular-nums ${
            input ? 'border-amber-400/60 text-amber-50' : 'border-amber-700/40 text-amber-200/30'
          }`}
          aria-label="Ваш ответ"
        >
          {problem.kind === 'eq' && <span className="mr-2 text-lg text-violet-300/80">x =</span>}
          {input ? input.replace('-', '−') : '?'}
          {active && <span className="ml-1 inline-block h-7 w-0.5 animate-pulse bg-amber-300/80" aria-hidden="true" />}
        </div>

        <div className="mt-4">
          {frozenMs > 0 ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-cyan-300/40 bg-cyan-400/10 py-1.5 font-mono text-sm text-cyan-100">
              <Snowflake size={15} className="animate-spin" /> Время заморожено · {(frozenMs / 1000).toFixed(1)} с
            </div>
          ) : (
            <Meter
              tone={ratio < 0.3 ? 'danger' : 'time'}
              icon={<Timer size={12} />}
              label="До атаки"
              value={timeLeft}
              max={timeLimit}
              valueText={`${(Math.max(0, timeLeft) / 1000).toFixed(1)} с`}
              linear
            />
          )}
        </div>

        {rule && <p className="mt-3 rounded-lg border border-amber-600/30 bg-amber-500/5 px-3 py-1.5 text-center text-xs text-amber-200/90 italic">{rule}</p>}
      </div>

      <Numpad onKey={press} onSubmit={submit} disabled={!active} canSubmit={canSubmit} />
      <p className="hidden text-center text-xs text-amber-200/45 sm:block">Клавиатура: цифры, «−» — знак, Backspace, Esc — очистить, Enter — применить</p>
    </div>
  );
}
