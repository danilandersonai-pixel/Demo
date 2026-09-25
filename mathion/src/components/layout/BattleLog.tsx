import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Eraser, ScrollText } from 'lucide-react';
import type { LogEntry, LogKind } from '../../types';

const KIND_STYLE: Record<LogKind, { mark: string; text: string }> = {
  attack: { mark: '✦', text: 'text-[#3a2913]' },
  crit: { mark: '✸', text: 'text-purple-900 font-bold' },
  hurt: { mark: '✕', text: 'text-red-900' },
  heal: { mark: '✚', text: 'text-emerald-900' },
  loot: { mark: '◆', text: 'text-amber-900' },
  level: { mark: '▲', text: 'text-blue-900 font-bold' },
  boss: { mark: '☠', text: 'text-fuchsia-900 font-bold' },
  craft: { mark: '⚗', text: 'text-teal-900' },
  system: { mark: '·', text: 'text-[#5a4526] italic' },
  victory: { mark: '♛', text: 'text-amber-900 font-bold' },
  defeat: { mark: '✝', text: 'text-red-950 font-bold' },
};

const timeFormatter = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

interface BattleLogProps {
  entries: LogEntry[];
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
}

/** Лог боя в виде развёрнутого свитка в нижней части экрана. Новые строки «раскатываются» сверху. */
export function BattleLog({ entries, open, onToggle, onClear }: BattleLogProps) {
  const visible = entries.slice(0, open ? 40 : 3);
  return (
    <section className="fixed right-0 bottom-0 left-0 z-40 px-2 pb-[env(safe-area-inset-bottom,0px)] sm:px-4" aria-label="Лог боя">
      <div className="relative mx-auto max-w-[1400px]">
        <span className="scroll-rod absolute top-0 -left-1 z-10 h-full w-3 rounded-full" aria-hidden="true" />
        <span className="scroll-rod absolute top-0 -right-1 z-10 h-full w-3 rounded-full" aria-hidden="true" />
        <div className="parchment rounded-t-lg px-5 pt-2 pb-2 sm:px-7">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className="focus-brass flex flex-1 cursor-pointer items-center gap-2 rounded text-left font-display text-sm font-bold text-[#4a3317]"
            >
              <ScrollText size={16} /> Свиток битв
              <span className="font-serif text-xs font-normal text-[#6b5230] italic">{open ? 'свернуть' : 'развернуть'}</span>
            </button>
            {open && (
              <button
                type="button"
                onClick={onClear}
                aria-label="Очистить свиток"
                className="focus-brass grid h-7 w-7 cursor-pointer place-items-center rounded text-[#6b4a22] hover:bg-[#caa970]/40"
              >
                <Eraser size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={onToggle}
              aria-label={open ? 'Свернуть свиток' : 'Развернуть свиток'}
              className="focus-brass grid h-7 w-7 cursor-pointer place-items-center rounded text-[#6b4a22] hover:bg-[#caa970]/40"
            >
              {open ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
            </button>
          </div>
          <ol className={`mt-1 overflow-y-auto font-serif text-[14px] leading-snug ${open ? 'max-h-56' : 'max-h-[4.6rem]'}`} aria-live="polite">
            <AnimatePresence initial={false}>
              {visible.map((entry) => {
                const style = KIND_STYLE[entry.kind];
                return (
                  <motion.li
                    key={entry.id}
                    layout="position"
                    initial={{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
                    animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0)' }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className={`flex gap-2 py-0.5 ${style.text}`}
                  >
                    <span className="w-4 shrink-0 text-center" aria-hidden="true">
                      {style.mark}
                    </span>
                    {open && <span className="shrink-0 font-mono text-[11px] text-[#7a6040] tabular-nums">{timeFormatter.format(new Date(entry.ts))}</span>}
                    <span className={open ? '' : 'truncate'}>{entry.text}</span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
            {visible.length === 0 && <li className="text-[#6b5230] italic">Свиток пуст.</li>}
          </ol>
        </div>
      </div>
    </section>
  );
}
