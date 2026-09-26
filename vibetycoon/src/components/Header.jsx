import React from 'react';
import { motion } from 'framer-motion';
import { CircleHelp, Clock, FastForward, Pause, Play, RotateCcw, Save } from 'lucide-react';
import { SPEEDS } from '../game/config.js';
import { gameTime } from '../game/format.js';

export default function Header({ hour, speed, onSpeed, onHelp, onReset, savedAt }) {
  const t = gameTime(hour);
  const dayProgress = ((hour + 9) % 24) / 24;
  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 border-b border-slate-800/80 bg-[#0F141C]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="relative grid h-9 w-9 place-items-center rounded-xl border border-cyan-400/40 bg-cyan-400/10 shadow-[0_0_20px_-4px_rgba(34,211,238,0.6)]">
            <span className="text-sm font-extrabold text-cyan-300">&gt;_</span>
          </div>
          <div className="leading-tight">
            <h1 className="text-base font-extrabold tracking-tight text-slate-100">
              Vibe<span className="text-cyan-300 neon-text-cyan">Tycoon</span>
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">AI Automation Simulator</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-1.5">
            <Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <span className="text-xs text-slate-400">День {t.day}</span>
            <span className="text-sm font-bold tabular-nums text-slate-100">{t.hh}</span>
            <div className="hidden h-1 w-16 overflow-hidden rounded-full bg-slate-800 sm:block" aria-hidden="true">
              <motion.div className="h-full bg-cyan-400/70" animate={{ width: `${dayProgress * 100}%` }} transition={{ duration: 0.4 }} />
            </div>
          </div>

          <div role="group" aria-label="Скорость времени" className="flex overflow-hidden rounded-lg border border-slate-700/60 bg-slate-900/60">
            {SPEEDS.map((s) => {
              const active = s.id === speed;
              const Icon = s.id === 0 ? Pause : s.id === 1 ? Play : FastForward;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSpeed(s.id)}
                  aria-pressed={active}
                  title={s.id === 0 ? 'Пауза (пробел)' : `${s.label}: ${s.mult} игр. ч за секунду`}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/60 ${
                    active ? (s.id === 0 ? 'bg-amber-400/20 text-amber-200' : 'bg-cyan-400/20 text-cyan-200') : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {s.id !== 0 && <span>{s.label}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1 text-[10px] text-slate-500 md:flex" title="Автосохранение в localStorage">
            <Save className="h-3 w-3" aria-hidden="true" />
            {savedAt ? 'сохранено' : 'не сохранено'}
          </span>
          <button
            type="button"
            onClick={onHelp}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/60 px-2.5 py-1.5 text-xs text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" /> Как играть
          </button>
          <button
            type="button"
            onClick={onReset}
            title="Новая игра (рекорды сохранятся)"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/60 px-2.5 py-1.5 text-xs text-slate-400 hover:border-rose-400/50 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> <span className="hidden sm:inline">Заново</span>
          </button>
        </div>
      </div>
    </header>
  );
}
