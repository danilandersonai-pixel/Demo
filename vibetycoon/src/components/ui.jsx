// Общие UI-примитивы в стиле «IDE будущего»

import React from 'react';
import { motion } from 'framer-motion';

const ACCENTS = {
  cyan: 'border-cyan-400/25 shadow-[0_0_0_1px_rgba(34,211,238,0.04),0_10px_40px_-20px_rgba(34,211,238,0.35)]',
  violet: 'border-violet-400/25 shadow-[0_0_0_1px_rgba(167,139,250,0.04),0_10px_40px_-20px_rgba(167,139,250,0.35)]',
  amber: 'border-amber-400/25 shadow-[0_0_0_1px_rgba(245,158,11,0.04),0_10px_40px_-20px_rgba(245,158,11,0.35)]',
  rose: 'border-rose-400/25',
  slate: 'border-slate-700/60',
};

export function Panel({ accent = 'slate', className = '', children, ...rest }) {
  return (
    <section
      className={`relative rounded-2xl border bg-slate-900/60 backdrop-blur-md ${ACCENTS[accent]} ${className}`}
      {...rest}
    >
      {children}
    </section>
  );
}

const DOTS = {
  cyan: 'bg-cyan-400 shadow-[0_0_10px_#22d3ee]',
  violet: 'bg-violet-400 shadow-[0_0_10px_#a78bfa]',
  amber: 'bg-amber-400 shadow-[0_0_10px_#f59e0b]',
  rose: 'bg-rose-400 shadow-[0_0_10px_#fb7185]',
  emerald: 'bg-emerald-400 shadow-[0_0_10px_#34d399]',
};

// Заголовок панели в виде вкладки редактора
export function PanelHeader({ icon: Icon, title, file, accent = 'cyan', right }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-700/50 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOTS[accent]}`} />
        {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />}
        <h2 className="truncate text-sm font-semibold tracking-wide text-slate-100">{title}</h2>
        {file && <span className="hidden truncate text-xs text-slate-500 sm:inline">— {file}</span>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  );
}

const BTN = {
  cyan: 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20 hover:border-cyan-300/70',
  violet: 'border-violet-400/40 bg-violet-400/10 text-violet-200 hover:bg-violet-400/20 hover:border-violet-300/70',
  amber: 'border-amber-400/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 hover:border-amber-300/70',
  rose: 'border-rose-400/40 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20 hover:border-rose-300/70',
  emerald: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 hover:border-emerald-300/70',
  ghost: 'border-slate-600/50 bg-slate-800/40 text-slate-300 hover:bg-slate-700/50 hover:border-slate-500',
};

export function Button({ tone = 'ghost', size = 'md', className = '', disabled, children, ...rest }) {
  const sz = size === 'sm' ? 'px-2.5 py-1 text-xs' : size === 'lg' ? 'px-4 py-2.5 text-sm' : 'px-3 py-1.5 text-xs';
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.96 }}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-40 ${sz} ${BTN[tone]} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function Tag({ tone = 'slate', children, className = '' }) {
  const tones = {
    slate: 'border-slate-600/60 text-slate-300 bg-slate-800/60',
    cyan: 'border-cyan-400/30 text-cyan-300 bg-cyan-400/10',
    violet: 'border-violet-400/30 text-violet-300 bg-violet-400/10',
    amber: 'border-amber-400/30 text-amber-300 bg-amber-400/10',
    rose: 'border-rose-400/30 text-rose-300 bg-rose-400/10',
    emerald: 'border-emerald-400/30 text-emerald-300 bg-emerald-400/10',
    sky: 'border-sky-400/30 text-sky-300 bg-sky-400/10',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tones[tone] || tones.slate} ${className}`}>
      {children}
    </span>
  );
}

// Полоса прогресса с неоновым свечением
export function Bar({ value, tone = 'cyan', className = '', height = 'h-1.5' }) {
  const fills = {
    cyan: 'from-cyan-500 to-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.7)]',
    violet: 'from-violet-500 to-fuchsia-400 shadow-[0_0_10px_rgba(167,139,250,0.7)]',
    amber: 'from-amber-500 to-yellow-300 shadow-[0_0_10px_rgba(245,158,11,0.7)]',
    rose: 'from-rose-600 to-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.7)]',
    emerald: 'from-emerald-500 to-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.7)]',
  };
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={`w-full overflow-hidden rounded-full bg-slate-800/80 ${height} ${className}`}>
      <motion.div
        className={`h-full rounded-full bg-gradient-to-r ${fills[tone]}`}
        initial={false}
        animate={{ width: `${v * 100}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />
    </div>
  );
}

// Слайдер с подписью
export function Slider({ label, value, min, max, step, onChange, format, thumb = '#a855f7', hint, id }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs text-slate-400">
          {label}
        </label>
        <span className="text-xs font-semibold text-slate-100">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        className="ide-range"
        style={{ '--thumb': thumb }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

export function Stat({ label, value, tone = 'text-slate-100', sub }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`truncate text-sm font-semibold ${tone}`}>{value}</div>
      {sub && <div className="truncate text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
