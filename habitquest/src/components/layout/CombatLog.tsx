import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronUp, Eraser, SquareTerminal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime } from '../../game/dates';
import type { LogEntry, LogKind } from '../../types';
import { IconButton } from '../ui/Button';

/** Короткий тег и приглушённый цвет для каждого типа записи. */
const KIND_TAG: Record<LogKind, { tag: string; color: string; text: string }> = {
  quest: { tag: 'QUEST', color: 'text-cyan-400/80', text: 'text-emerald-200/80' },
  damage: { tag: 'DMG', color: 'text-red-400/85', text: 'text-red-200/75' },
  level: { tag: 'LVL', color: 'text-fuchsia-400', text: 'text-fuchsia-200/90' },
  shop: { tag: 'SHOP', color: 'text-amber-400/85', text: 'text-amber-100/75' },
  system: { tag: 'SYS', color: 'text-slate-500', text: 'text-emerald-300/55' },
  death: { tag: 'KIA', color: 'text-red-500', text: 'text-red-300/90' },
  heal: { tag: 'HEAL', color: 'text-emerald-400', text: 'text-emerald-200/80' },
  stat: { tag: 'STAT', color: 'text-sky-400/85', text: 'text-sky-100/75' },
  undo: { tag: 'UNDO', color: 'text-orange-400/80', text: 'text-orange-100/70' },
};

type Filter = 'all' | 'quest' | 'damage' | 'shop' | 'system';

const FILTERS: Array<{ id: Filter; label: string; kinds: LogKind[] | null }> = [
  { id: 'all', label: 'ALL', kinds: null },
  { id: 'quest', label: 'QUEST', kinds: ['quest', 'level', 'stat', 'undo'] },
  { id: 'damage', label: 'DMG', kinds: ['damage', 'death', 'heal'] },
  { id: 'shop', label: 'SHOP', kinds: ['shop', 'heal'] },
  { id: 'system', label: 'SYS', kinds: ['system'] },
];

const VISIBLE_LIMIT = 80;
/** Максимальная длительность «печати» одной строки, мс. */
const TYPE_DURATION = 900;

/** Строка, которая «печатается» посимвольно. При reduced-motion выводится сразу. */
function TypeLine({ text, animate, onDone }: { text: string; animate: boolean; onDone: () => void }) {
  const reduceMotion = useReducedMotion();
  const instant = !animate || reduceMotion === true;
  const [shown, setShown] = useState(instant ? text.length : 0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (instant) {
      setShown(text.length);
      return;
    }
    // Прогресс считается по реальному времени, а не по кадрам: строка допечатывается
    // за TYPE_DURATION мс даже при низком FPS (тяжёлый blur, слабое устройство).
    const duration = Math.min(TYPE_DURATION, text.length * 28);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setShown(Math.ceil(text.length * progress));
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        onDoneRef.current();
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [text, instant]);

  const typing = shown < text.length;
  return (
    <>
      {text.slice(0, shown)}
      {typing && <span className="ml-px inline-block h-3 w-1.5 translate-y-0.5 bg-emerald-300/80" aria-hidden="true" />}
    </>
  );
}

interface CombatLogProps {
  entries: LogEntry[];
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
}

/** Журнал событий в виде терминала: хронологическая лента, новые строки печатаются снизу. */
export function CombatLog({ entries, open, onToggle, onClear }: CombatLogProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const mountedAt = useRef(Date.now());
  const typed = useRef(new Set<string>());
  const scrollRef = useRef<HTMLOListElement>(null);

  // Журнал хранится от новых к старым; терминал показывает от старых к новым.
  const visible = useMemo(() => {
    const rule = FILTERS.find((f) => f.id === filter)?.kinds;
    const list = rule ? entries.filter((e) => rule.includes(e.kind)) : entries;
    return list.slice(0, VISIBLE_LIMIT).reverse();
  }, [entries, filter]);

  const latest = entries[0];

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [latest?.id, open, filter]);

  return (
    <section
      className="fixed right-0 bottom-0 left-0 z-50 border-t border-emerald-400/10 bg-[#05070d]/95 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl lg:left-64"
      aria-label="Журнал событий"
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent" />
      <div className="flex items-center gap-2 px-3 py-2 sm:px-5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="focus-ring flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg py-1 text-left"
        >
          <span className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-red-500/70" />
            <span className="h-2 w-2 rounded-full bg-amber-400/70" />
            <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
          </span>
          <SquareTerminal size={15} className="shrink-0 text-emerald-300/80" />
          <span className="shrink-0 font-mono text-[11px] font-bold tracking-[0.18em] text-emerald-300/90 uppercase">combat.log</span>
          <span className="hidden shrink-0 font-mono text-[10px] text-slate-600 sm:inline">— tail -f</span>
          {!open && latest && (
            <motion.span
              key={latest.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`ml-2 truncate font-mono text-[11px] ${KIND_TAG[latest.kind].text}`}
            >
              <span className={KIND_TAG[latest.kind].color}>[{KIND_TAG[latest.kind].tag}]</span> {latest.text}
            </motion.span>
          )}
        </button>

        {open && (
          <div className="hidden gap-0.5 sm:flex" role="tablist" aria-label="Фильтр журнала">
            {FILTERS.map((f) => (
              <motion.button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                whileTap={{ scale: 0.92 }}
                className={`focus-ring cursor-pointer rounded px-2 py-1 font-mono text-[10px] font-bold tracking-wider transition-colors duration-300 ${
                  filter === f.id ? 'bg-emerald-400/15 text-emerald-200' : 'text-slate-500 hover:text-emerald-200/80'
                }`}
              >
                {filter === f.id ? `[${f.label}]` : f.label}
              </motion.button>
            ))}
          </div>
        )}
        {open && (
          <IconButton label="Очистить журнал" tone="danger" onClick={onClear}>
            <Eraser size={15} />
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
            className="scanlines overflow-hidden border-t border-white/[0.04]"
          >
            <ol
              ref={scrollRef}
              className="terminal-scroll h-40 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-relaxed sm:h-44 sm:px-5"
              aria-live="polite"
            >
              {visible.map((entry) => {
                const style = KIND_TAG[entry.kind];
                const animate = entry.ts >= mountedAt.current && !typed.current.has(entry.id);
                return (
                  <motion.li
                    key={entry.id}
                    initial={{ opacity: 0, filter: 'blur(3px)' }}
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    transition={{ duration: 0.35 }}
                    className="flex items-start gap-2 py-0.5"
                  >
                    <span className="hidden shrink-0 text-slate-600 tabular-nums sm:inline">{formatTime(entry.ts)}</span>
                    <span className={`w-12 shrink-0 font-bold ${style.color}`}>{style.tag}</span>
                    <span className={style.text}>
                      <TypeLine text={entry.text} animate={animate} onDone={() => typed.current.add(entry.id)} />
                    </span>
                  </motion.li>
                );
              })}
              {visible.length === 0 && <li className="py-2 text-slate-600">// пусто — выполните первый квест</li>}
              <li className="flex items-center gap-2 py-0.5 text-emerald-300/70" aria-hidden="true">
                <span>hero@habitquest:~$</span>
                <span className="inline-block h-3.5 w-2 animate-blink bg-emerald-300/80" />
              </li>
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
