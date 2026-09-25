import { motion } from 'framer-motion';
import { CornerDownLeft, Delete } from 'lucide-react';

interface NumpadProps {
  onKey: (key: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  canSubmit: boolean;
}

const DIGIT_ROWS = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
];

/** Встроенная клавиатура из рунических клавиш. */
export function Numpad({ onKey, onSubmit, disabled, canSubmit }: NumpadProps) {
  const key = (label: string, value: string, extra = '', aria?: string) => (
    <motion.button
      key={value}
      type="button"
      disabled={disabled}
      onClick={() => onKey(value)}
      whileTap={{ scale: 0.95 }}
      aria-label={aria ?? label}
      className={`rune-key focus-brass grid h-12 cursor-pointer place-items-center rounded-xl font-mono text-xl font-bold text-amber-100 disabled:cursor-not-allowed disabled:opacity-40 sm:h-13 ${extra}`}
    >
      {label}
    </motion.button>
  );

  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Цифровая клавиатура">
      {DIGIT_ROWS.map((row, i) => (
        <div key={row.join('')} className="contents">
          {row.map((d) => key(d, d))}
          {i === 0 && (
            <motion.button
              type="button"
              disabled={disabled}
              onClick={() => onKey('back')}
              whileTap={{ scale: 0.95 }}
              aria-label="Стереть цифру"
              className="rune-key focus-brass grid h-12 cursor-pointer place-items-center rounded-xl text-amber-200 disabled:cursor-not-allowed disabled:opacity-40 sm:h-13"
            >
              <Delete size={20} />
            </motion.button>
          )}
          {i === 1 && key('C', 'clear', 'text-base text-red-300', 'Очистить')}
          {i === 2 && key('±', '-', 'text-amber-300', 'Сменить знак')}
        </div>
      ))}
      {key('0', '0', 'col-span-2')}
      <motion.button
        type="button"
        disabled={disabled || !canSubmit}
        onClick={onSubmit}
        whileTap={{ scale: 0.95 }}
        aria-label="Применить ответ"
        className="brass-plaque focus-brass col-span-2 flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl font-display text-base font-bold disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale sm:h-13"
      >
        <CornerDownLeft size={18} /> Применить
      </motion.button>
    </div>
  );
}
