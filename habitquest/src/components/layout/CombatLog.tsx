import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Coins,
  Eraser,
  HeartPulse,
  Info,
  ScrollText,
  Skull,
  Sparkles,
  Swords,
  TrendingUp,
  Undo2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatTime } from '../../game/dates';
import type { LogEntry, LogKind } from '../../types';
import { IconButton } from '../ui/Button';

const KIND_STYLE: Record<LogKind, { icon: LucideIcon; color: string }> = {
  quest: { icon: Swords, color: 'text-violet-300' },
  damage: { icon: Zap, color: 'text-rose-400' },
  level: { icon: Sparkles, color: 'text-fuchsia-300 font-semibold' },
  shop: { icon: Coins, color: 'text-amber-300' },
  system: { icon: Info, color: 'text-slate-300/80' },
  death: { icon: Skull, color: 'text-rose-300 font-semibold' },
  heal: { icon: HeartPulse, color: 'text-emerald-300' },
  stat: { icon: TrendingUp, color: 'text-cyan-300' },
  undo: { icon: Undo2, color: 'text-orange-300/90' },
};

type Filter = 'all' | 'quest' | 'damage' | 'shop' | 'system';

const FILTERS: Array<{ id: Filter; label: string; kinds: LogKind[] | null }> = [
  { id: 'all', label: 'Все', kinds: null },
  { id: 'quest', label: 'Квесты', kinds: ['quest', 'level', 'stat', 'undo'] },
  { id: 'damage', label: 'Урон', kinds: ['damage', 'death', 'heal'] },
  { id: 'shop', label: 'Магазин', kinds: ['shop', 'heal'] },
  { id: 'system', label: 'Система', kinds: ['system'] },
];

interface CombatLogProps {
  entries: LogEntry[];
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
}

/** Журнал событий — лента в нижней части экрана, новые записи сверху. */
export function CombatLog({ entries, open, onToggle, onClear }: CombatLogProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    const rule = FILTERS.find((f) => f.id === filter)?.kinds;
    const list = rule ? entries.filter((e) => rule.includes(e.kind)) : entries;
    return list.slice(0, 80);
  }, [entries, filter]);

  const latest = entries[0];

  return (
    <section
      className="glass-strong fixed right-0 bottom-0 left-0 z-50 border-x-0 border-b-0 bg-[#0a0818]/95 pb-[env(safe-area-inset-bottom,0px)] lg:left-64"
      aria-label="Журнал событий"
    >
      <div className="flex items-center gap-2 px-3 py-2 sm:px-5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="focus-ring flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg py-1 text-left"
        >
          <ScrollText size={16} className="shrink-0 text-cyan-300" />
          <span className="shrink-0 font-display text-xs tracking-[0.2em] text-cyan-200 uppercase neon-cyber">Combat log</span>
          {!open && latest && (
            <motion.span
              key={latest.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`ml-2 truncate font-mono text-xs ${KIND_STYLE[latest.kind].color}`}
            >
              {latest.text}
            </motion.span>
          )}
        </button>

        {open && (
          <div className="hidden gap-1 sm:flex" role="tablist" aria-label="Фильтр журнала">
            {FILTERS.map((f) => (
              <motion.button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                whileTap={{ scale: 0.92 }}
                className={`focus-ring cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                  filter === f.id ? 'bg-cyan-500/20 text-cyan-100' : 'text-violet-200/50 hover:text-violet-100'
                }`}
              >
                {f.label}
              </motion.button>
            ))}
          </div>
        )}
        {open && (
          <IconButton label="Очистить журнал" tone="danger" onClick={onClear}>
            <Eraser size={16} />
          </IconButton>
        )}
        <IconButton label={open ? 'Свернуть журнал' : 'Развернуть журнал'} onClick={onToggle}>
          {open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </IconButton>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 34 }}
            className="overflow-hidden"
          >
            <ol className="h-40 overflow-y-auto border-t border-violet-400/10 px-3 py-2 font-mono text-xs sm:h-44 sm:px-5" aria-live="polite">
              <AnimatePresence initial={false}>
                {visible.map((entry) => {
                  const style = KIND_STYLE[entry.kind];
                  const Icon = style.icon;
                  return (
                    <motion.li
                      key={entry.id}
                      layout="position"
                      initial={{ opacity: 0, x: -14, backgroundColor: 'rgba(168,85,247,0.18)' }}
                      animate={{ opacity: 1, x: 0, backgroundColor: 'rgba(168,85,247,0)' }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.5 }}
                      className="flex items-start gap-2 rounded-md px-1.5 py-1"
                    >
                      <span className="shrink-0 pt-px text-violet-300/40 tabular-nums">[{formatTime(entry.ts)}]</span>
                      <Icon size={13} className={`mt-0.5 shrink-0 ${style.color}`} />
                      <span className={`${style.color} leading-relaxed`}>{entry.text}</span>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
              {visible.length === 0 && <li className="py-6 text-center text-violet-200/40">Здесь пока тихо. Выполните первый квест!</li>}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
