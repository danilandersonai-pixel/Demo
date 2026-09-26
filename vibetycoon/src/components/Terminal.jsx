import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, Terminal as TerminalIcon, Trash2 } from 'lucide-react';
import { stamp } from '../game/format.js';
import { Panel, PanelHeader } from './ui.jsx';

const LEVELS = {
  income: { label: 'INFO', cls: 'text-emerald-300', tag: 'text-emerald-400' },
  system: { label: 'SYS ', cls: 'text-slate-300', tag: 'text-cyan-400' },
  success: { label: 'DONE', cls: 'text-cyan-200', tag: 'text-cyan-300' },
  auto: { label: 'AUTO', cls: 'text-violet-200', tag: 'text-violet-300' },
  warn: { label: 'WARN', cls: 'text-amber-200', tag: 'text-amber-400' },
  crit: { label: 'CRIT', cls: 'text-rose-200 font-semibold', tag: 'text-rose-400' },
  hint: { label: 'TIP ', cls: 'text-sky-200', tag: 'text-sky-300' },
};

const FILTERS = [
  { id: 'all', label: 'Все', match: () => true },
  { id: 'money', label: 'Доход', match: (l) => l.level === 'income' },
  { id: 'incidents', label: 'Инциденты', match: (l) => l.level === 'crit' || l.level === 'warn' },
  { id: 'system', label: 'Система', match: (l) => ['system', 'success', 'auto', 'hint'].includes(l.level) },
];

export default function Terminal({ logs, onClear }) {
  const [filter, setFilter] = useState('all');
  const [follow, setFollow] = useState(true);
  const boxRef = useRef(null);
  const shown = useMemo(() => logs.filter(FILTERS.find((f) => f.id === filter).match).slice(-160), [logs, filter]);
  const critCount = useMemo(() => logs.filter((l) => l.level === 'crit').length, [logs]);

  useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [shown, follow]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setFollow(atBottom);
  };

  return (
    <Panel accent="slate" className="flex flex-col">
      <PanelHeader
        icon={TerminalIcon}
        title="Терминал логов и инцидентов"
        file="tail -f /var/log/agents.log"
        accent="emerald"
        right={
          <div className="flex items-center gap-1.5">
            <div role="tablist" aria-label="Фильтр логов" className="flex rounded-lg border border-slate-700/60 bg-slate-950/50 p-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                    filter === f.id ? 'bg-slate-700/70 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f.label}
                  {f.id === 'incidents' && critCount > 0 && <span className="ml-1 text-rose-300">{critCount}</span>}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClear}
              title="Очистить терминал"
              aria-label="Очистить терминал"
              className="rounded-md p-1 text-slate-500 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        }
      />
      <div className="relative">
        <div
          ref={boxRef}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-label="Лог событий"
          className="ide-scroll h-72 overflow-y-auto bg-[#0a0e14]/80 px-3 py-2 text-[11.5px] leading-5 sm:h-80"
        >
          {shown.length === 0 && <div className="text-slate-600">$ tail -f — пока тихо…</div>}
          {shown.map((l) => {
            const lv = LEVELS[l.level] || LEVELS.system;
            return (
              <motion.div
                key={l.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
                className={`flex gap-2 rounded px-1 ${l.level === 'crit' ? 'bg-rose-500/10' : ''}`}
              >
                <span className="shrink-0 tabular-nums text-slate-600">[{stamp(l.hour)}]</span>
                <span className={`shrink-0 ${lv.tag}`}>{lv.label}</span>
                <span className={`min-w-0 break-words ${lv.cls}`}>{l.text}</span>
              </motion.div>
            );
          })}
          <div className="caret h-5 text-slate-600" aria-hidden="true">
            $
          </div>
        </div>
        {!follow && (
          <button
            type="button"
            onClick={() => {
              setFollow(true);
              if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
            }}
            className="absolute bottom-3 right-4 flex items-center gap-1 rounded-full border border-cyan-400/40 bg-slate-900/90 px-2.5 py-1 text-[11px] text-cyan-200 shadow-lg"
          >
            <ArrowDown className="h-3 w-3" aria-hidden="true" /> к новым
          </button>
        )}
      </div>
    </Panel>
  );
}
