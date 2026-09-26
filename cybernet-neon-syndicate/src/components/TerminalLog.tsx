import { motion, useReducedMotion } from 'framer-motion';
import { SquareTerminal } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LogCategory, LogEntry } from '../game/types.ts';
import { useGameContext } from './GameContext.tsx';
import { TONE_TEXT } from './ui/accent.ts';
import { cn } from './ui/cn.ts';
import { Panel } from './ui/Panel.tsx';

type Filter = 'all' | LogCategory;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'ВСЕ' },
  { id: 'build', label: 'СТРОЙКА' },
  { id: 'economy', label: 'ЭКОНОМИКА' },
  { id: 'research', label: 'НИО' },
  { id: 'event', label: 'СОБЫТИЯ' },
];

/** Печатает строку посимвольно — эффект живого терминала. */
function Typewriter({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const [count, setCount] = useState(reduce ? text.length : 0);

  useEffect(() => {
    if (reduce) {
      setCount(text.length);
      return undefined;
    }
    setCount(0);
    const step = Math.max(1, Math.ceil(text.length / 28));
    const id = window.setInterval(() => {
      setCount((c) => {
        if (c + step >= text.length) {
          window.clearInterval(id);
          return text.length;
        }
        return c + step;
      });
    }, 16);
    return () => window.clearInterval(id);
  }, [text, reduce]);

  return (
    <>
      {text.slice(0, count)}
      <span className="sr-only">{text.slice(count)}</span>
    </>
  );
}

function LogLine({ entry, latest }: { entry: LogEntry; latest: boolean }) {
  return (
    <motion.li
      initial={latest ? { opacity: 0, x: -6 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="flex gap-2 py-[3px] leading-snug"
    >
      <span className="tabular shrink-0 whitespace-nowrap text-dim">[День {entry.day}]:</span>
      <span className={cn('min-w-0 break-words', TONE_TEXT[entry.tone], entry.tone === 'danger' && 'glow-danger')}>
        {latest ? <Typewriter text={entry.text} /> : entry.text}
      </span>
    </motion.li>
  );
}

/** Нижний модуль — Синдикат-Лог: журнал событий в стиле терминала (бегущая строка — у нижнего края экрана). */
export function TerminalLog({ className }: { className?: string }) {
  const { state } = useGameContext();
  const [filter, setFilter] = useState<Filter>('all');
  const [stick, setStick] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const entries = filter === 'all' ? state.log : state.log.filter((e) => e.category === filter);
  const shown = entries.slice(-120);
  const lastId = state.log.length ? state.log[state.log.length - 1].id : -1;

  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && stick) node.scrollTop = node.scrollHeight;
  }, [shown.length, lastId, stick, filter]);

  return (
    <Panel
      id="terminal"
      code="SYS // SYNDICATE-LOG tty0"
      title="Синдикат-Лог"
      icon={SquareTerminal}
      accent="data"
      className={className}
      bodyClassName="p-0 flex flex-col"
      delay={0.2}
      actions={
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Фильтр журнала">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'chamfer-sm border px-2 py-1 font-mono text-[10px] tracking-wider transition-colors',
                filter === f.id ? 'border-data/60 bg-data/15 text-data' : 'border-line text-dim hover:text-muted',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="relative min-h-64 flex-1 sm:min-h-72">
        <div className="scanlines pointer-events-none absolute inset-0 z-10" aria-hidden />
        <div
          ref={scroller}
          onScroll={(event) => {
            const node = event.currentTarget;
            setStick(node.scrollHeight - node.scrollTop - node.clientHeight < 24);
          }}
          className="scroll-thin absolute inset-0 overflow-y-auto px-4 py-3 font-mono text-[12px]"
          role="log"
          aria-live="polite"
          aria-label="Журнал событий синдиката"
        >
          <ul>
            {shown.map((entry) => (
              <LogLine key={entry.id} entry={entry} latest={entry.id === lastId} />
            ))}
          </ul>
          <div className="mt-1 flex items-center gap-2 text-data">
            <span>syndicate@neon:~$</span>
            <span className="caret inline-block h-3.5 w-2 bg-data" />
          </div>
        </div>
        {!stick ? (
          <button
            type="button"
            onClick={() => setStick(true)}
            className="absolute bottom-3 right-4 z-20 border border-data/50 bg-deep/90 px-2 py-1 font-mono text-[10px] text-data"
          >
            ↓ к последним
          </button>
        ) : null}
      </div>
    </Panel>
  );
}
