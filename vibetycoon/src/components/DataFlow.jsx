import React, { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

// Анимация потока данных через агента: задачи → модель → результат.
// Скорость частиц пропорциональна TPS, красные частицы — доля ошибок.
export default function DataFlow({ tps, errRate, running, modelColor = 'cyan', crit }) {
  const reduce = useReducedMotion();
  const particles = 6;
  const duration = Math.max(0.9, 3.6 - Math.min(tps, 200) / 70);

  // Детерминированно помечаем часть частиц как «ошибки»
  const flags = useMemo(() => {
    const bad = Math.min(particles, Math.round(errRate * particles * 3));
    return Array.from({ length: particles }, (_, i) => i < bad);
  }, [errRate]);

  const core = {
    cyan: 'border-cyan-400/60 bg-cyan-400/15 text-cyan-200 shadow-[0_0_18px_-2px_rgba(34,211,238,0.7)]',
    sky: 'border-sky-400/60 bg-sky-400/15 text-sky-200 shadow-[0_0_18px_-2px_rgba(56,189,248,0.7)]',
    violet: 'border-violet-400/60 bg-violet-400/15 text-violet-200 shadow-[0_0_18px_-2px_rgba(167,139,250,0.7)]',
    emerald: 'border-emerald-400/60 bg-emerald-400/15 text-emerald-200 shadow-[0_0_18px_-2px_rgba(52,211,153,0.7)]',
  }[modelColor];

  const lane = (side) => (
    <div className="relative h-5 flex-1 overflow-hidden">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700" />
      {running &&
        !reduce &&
        flags.map((isBad, i) => {
          const color = side === 'in' ? 'bg-violet-300 shadow-[0_0_8px_#c4b5fd]' : isBad ? 'bg-rose-400 shadow-[0_0_8px_#fb7185]' : 'bg-amber-300 shadow-[0_0_8px_#fcd34d]';
          return (
            // Контейнер шириной с дорожку сдвигается на 0…100% своей ширины,
            // а точка сидит у его левого края — так частица пробегает всю линию.
            <motion.span
              key={`${side}-${i}`}
              className="absolute inset-0"
              initial={{ x: '0%', opacity: 0 }}
              animate={{ x: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
              transition={{ duration, repeat: Infinity, repeatType: 'loop', delay: (i * duration) / particles, ease: 'linear' }}
            >
              <span className={`absolute left-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full ${color}`} />
            </motion.span>
          );
        })}
      {running && reduce && <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-cyan-400/40" />}
    </div>
  );

  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <span className="rounded-md border border-violet-400/30 bg-violet-400/10 px-1.5 py-0.5 text-[10px] text-violet-200">IN</span>
      {lane('in')}
      <motion.div
        className={`grid h-7 w-7 place-items-center rounded-lg border text-[10px] font-bold ${running ? core : 'border-slate-600 bg-slate-800 text-slate-500'}`}
        animate={crit && !reduce ? { x: [0, -3, 3, -2, 2, 0], borderColor: ['#fb7185', '#fb7185', '#fb7185'] } : running && !reduce ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={crit ? { duration: 0.5 } : { duration: Math.max(0.8, duration / 2), repeat: Infinity }}
      >
        AI
      </motion.div>
      {lane('out')}
      <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-200">$</span>
    </div>
  );
}
