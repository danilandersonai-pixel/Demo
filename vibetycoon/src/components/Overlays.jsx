import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Infinity as InfinityIcon, Rocket, Skull, Trophy, X, Zap } from 'lucide-react';
import { hoursLabel, money } from '../game/format.js';
import { Button } from './ui.jsx';

// Неоновый баннер рекорда
export function RecordBanner({ banner, onClose }) {
  useEffect(() => {
    if (!banner) return undefined;
    const id = setTimeout(onClose, 5200);
    return () => clearTimeout(id);
  }, [banner, onClose]);

  const theme = banner && {
    income: { icon: Zap, from: 'from-amber-400', via: 'via-fuchsia-500', to: 'to-cyan-400', title: 'НОВЫЙ РЕКОРД ДОХОДА', glow: 'shadow-[0_0_60px_-5px_rgba(245,158,11,0.8)]' },
    streak: { icon: InfinityIcon, from: 'from-violet-500', via: 'via-cyan-400', to: 'to-emerald-400', title: 'РЕКОРД СТАБИЛЬНОСТИ', glow: 'shadow-[0_0_60px_-5px_rgba(167,139,250,0.8)]' },
    autonomy: { icon: Rocket, from: 'from-emerald-400', via: 'via-cyan-400', to: 'to-fuchsia-500', title: 'ПОЛНАЯ АВТОНОМИЯ', glow: 'shadow-[0_0_70px_-5px_rgba(52,211,153,0.9)]' },
  }[banner.kind];

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4" aria-live="assertive">
      <AnimatePresence>
        {banner && (
          <motion.div
            key={banner.id}
            initial={{ opacity: 0, y: -40, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -30, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className={`pointer-events-auto relative w-full max-w-xl rounded-2xl bg-gradient-to-r p-[2px] ${theme.from} ${theme.via} ${theme.to} ${theme.glow}`}
          >
            <div className="relative overflow-hidden rounded-2xl bg-[#0b0f16]/95 px-5 py-4">
              <motion.div
                className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                animate={{ left: ['-33%', '120%'] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              />
              <div className="relative flex items-center gap-4">
                <motion.div
                  animate={{ rotate: [0, -8, 8, 0], scale: [1, 1.15, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/5"
                >
                  <theme.icon className="h-7 w-7 text-amber-200" aria-hidden="true" />
                </motion.div>
                <div className="min-w-0 flex-1">
                  <div className={`bg-gradient-to-r bg-clip-text text-lg font-extrabold tracking-wider text-transparent ${theme.from} ${theme.via} ${theme.to}`}>
                    {theme.title}
                  </div>
                  <div className="text-sm text-slate-200 neon-text-fuchsia">{banner.text}</div>
                  {banner.sub && <div className="mt-0.5 text-xs text-slate-400">{banner.sub}</div>}
                </div>
                <button type="button" onClick={onClose} aria-label="Закрыть баннер" className="rounded-md p-1 text-slate-400 hover:text-white">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Modal({ open, onClose, children, label, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    document.addEventListener('keydown', onKey);
    setTimeout(() => ref.current && ref.current.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (prev && prev.focus) prev.focus();
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
            className={`ide-scroll max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-cyan-400/30 bg-slate-900/95 p-5 shadow-2xl outline-none backdrop-blur-md ${wide ? 'max-w-3xl' : 'max-w-md'}`}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function HelpModal({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} label="Как играть" wide>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-cyan-300" aria-hidden="true" />
          <h2 className="text-lg font-bold text-slate-100">Как устроен VibeTycoon</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-md p-1 text-slate-400 hover:text-white">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="space-y-4 text-sm leading-relaxed text-slate-300">
        <p>
          Вы — вайбкодер, который строит бизнес на ИИ-агентах. <b className="text-cyan-200">1 секунда = 1 час</b> рабочего времени. Каждый час агенты тратят токены, зарабатывают деньги и иногда галлюцинируют.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-violet-400/30 bg-violet-400/5 p-3">
            <div className="mb-1 font-semibold text-violet-200">Урок 1. Длинный промт = дорого</div>
            <p className="text-xs text-slate-400">Системный промт отправляется с каждой задачей. Чем он длиннее, тем меньше задач агент успевает за час и тем больше вы платите. Но слишком короткий промт даёт нерелевантные ответы и галлюцинации. Ищите золотую середину.</p>
          </div>
          <div className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-3">
            <div className="mb-1 font-semibold text-rose-200">Урок 2. Температура = риск</div>
            <p className="text-xs text-slate-400">Высокая температура делает ответы уникальнее (копирайтеру это приносит деньги), но риск ошибок растёт квадратично. При T 1.2 поддержка ошибается в 3–4 раза чаще, чем при T 0.3.</p>
          </div>
          <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-3">
            <div className="mb-1 font-semibold text-cyan-200">Урок 3. Модель под задачу</div>
            <p className="text-xs text-slate-400">Fast LLM дешёвая, но не тянет сложные задачи: на код-ревью она решает ~15% и генерирует мусор. Reasoning LLM дорога для тикетов, но окупается там, где ошибка стоит $450.</p>
          </div>
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
            <div className="mb-1 font-semibold text-amber-200">Урок 4. Тех-долг копится</div>
            <p className="text-xs text-slate-400">Каждая фича, написанная «на вайбе», добавляет долг. Он замедляет агентов, раздувает расход токенов и роняет прод. Вовремя жмите «Рефакторинг ИИ (Vibe Clean)».</p>
          </div>
        </div>
        <div>
          <div className="mb-1 font-semibold text-slate-100">Цель игры</div>
          <p className="text-xs text-slate-400">
            Постройте систему, которая зарабатывает ≥ $400/ч в среднем за сутки, 48 часов работает без критических галлюцинаций и 24 часа обходится без вашего вмешательства. Для этого нужны модули автономии: мониторинг, Guardrails, автопилот температуры, автоскейлер и авто-рефакторинг.
          </p>
        </div>
        <div>
          <div className="mb-1 font-semibold text-slate-100">Управление</div>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-slate-400">
            <li><b className="text-slate-300">Пробел</b> — пауза / продолжить, <b className="text-slate-300">1 / 2 / 3</b> — скорость 1×, 2×, 4×.</li>
            <li>В редакторе агента прогноз «было → станет» пересчитывается мгновенно — экспериментируйте на паузе.</li>
            <li>Прогресс, технологии и рекорды автоматически сохраняются в localStorage браузера.</li>
          </ul>
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button tone="cyan" size="lg" onClick={onClose}>
          Поехали <Rocket className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </Modal>
  );
}

export function BankruptModal({ open, game, onRestart }) {
  return (
    <Modal open={open} label="Банкротство">
      <div className="text-center">
        <Skull className="mx-auto h-12 w-12 text-rose-400" aria-hidden="true" />
        <h2 className="mt-3 text-xl font-extrabold text-rose-300">Банкротство</h2>
        <p className="mt-2 text-sm text-slate-300">
          Кредитная линия исчерпана. Система проработала {hoursLabel(game.hour)} и заработала {money(game.totals.revenue, 0)}, но расходы составили {money(game.totals.cost, 0)}.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Частые причины: дорогие модели на дешёвых задачах, высокая температура, перегруженный кластер и неоплаченный тех-долг. Рекорды сохранены.
        </p>
        <Button tone="cyan" size="lg" className="mt-5 w-full" onClick={onRestart}>
          Начать новую партию
        </Button>
      </div>
    </Modal>
  );
}

export function ConfirmResetModal({ open, onCancel, onConfirm }) {
  return (
    <Modal open={open} onClose={onCancel} label="Новая игра">
      <h2 className="text-lg font-bold text-slate-100">Начать заново?</h2>
      <p className="mt-2 text-sm text-slate-400">Текущая партия (деньги, агенты, технологии) будет удалена. Рекорды сохранятся.</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button tone="ghost" onClick={onCancel}>Отмена</Button>
        <Button tone="rose" onClick={onConfirm}>Сбросить партию</Button>
      </div>
    </Modal>
  );
}

export function AutonomyModal({ open, game, onClose }) {
  return (
    <Modal open={open} onClose={onClose} label="Полная автономия">
      <div className="text-center">
        <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
          <Trophy className="mx-auto h-14 w-14 text-amber-300 drop-shadow-[0_0_20px_rgba(245,158,11,0.8)]" aria-hidden="true" />
        </motion.div>
        <h2 className="mt-3 bg-gradient-to-r from-emerald-300 via-cyan-300 to-fuchsia-400 bg-clip-text text-2xl font-extrabold text-transparent">Система автономна!</h2>
        <p className="mt-2 text-sm text-slate-300">
          За {hoursLabel(game.hour)} вы построили бизнес, который сам зарабатывает, чинит свой код, масштабирует кластер и укрощает галлюцинации.
        </p>
        <p className="mt-2 text-xs text-slate-500">Игра продолжается — попробуйте побить рекорды дохода и стабильности.</p>
        <Button tone="emerald" size="lg" className="mt-5 w-full" onClick={onClose}>
          Продолжить
        </Button>
      </div>
    </Modal>
  );
}
