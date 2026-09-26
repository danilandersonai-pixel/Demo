import { AnimatePresence, motion } from 'framer-motion';
import { CircleHelp, Hexagon, Play, RotateCcw, Trophy } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { fmt } from '../game/format.ts';
import { useGameContext } from './GameContext.tsx';
import { NeonButton } from './ui/NeonButton.tsx';

const BOOT_LINES = [
  '> загрузка ядра синдиката............ OK',
  '> подключение к сети мегаполиса...... OK',
  '> калибровка энергосети.............. OK',
  '> сканирование угроз................. АКТИВНО',
  '> синхронизация с дата-биржей........ OK',
];

interface BootScreenProps {
  open: boolean;
  restored: boolean;
  onContinue: () => void;
  onNewGame: () => void;
  onHelp: () => void;
  inert?: boolean;
}

/** Загрузочный экран: продолжить сохранённый забег или начать новый. */
export function BootScreen({ open, restored, onContinue, onNewGame, onHelp, inert }: BootScreenProps) {
  const { state } = useGameContext();
  const canContinue = restored && state.status === 'playing';
  const root = useRef<HTMLDivElement>(null);

  // Фокус сразу на главную кнопку — иначе Tab уходит в скрытые под заставкой элементы.
  useEffect(() => {
    if (!open) return undefined;
    const id = window.setTimeout(() => root.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={root}
          inert={inert}
          className="fixed inset-0 z-[60] overflow-y-auto bg-void/92 backdrop-blur-xl"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.45 } }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="boot-title"
        >
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden />
          <div className="bg-vignette pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto flex min-h-full max-w-3xl flex-col justify-center px-4 py-10 sm:px-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
              className="flex items-center gap-4"
            >
              <div className="relative grid size-16 shrink-0 place-items-center">
                <motion.span
                  className="absolute inset-0"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
                >
                  <Hexagon className="size-16 text-credit/80" strokeWidth={1} />
                </motion.span>
                <Hexagon className="size-6 fill-data/80 text-data" strokeWidth={1.5} />
              </div>
              <div>
                <h1 id="boot-title" className="font-display text-4xl font-extrabold tracking-[0.06em] text-ink sm:text-6xl">
                  CYBER<span className="text-credit glow-credit">NET</span>
                </h1>
                <div className="mt-1 font-mono text-xs tracking-[0.5em] text-data sm:text-sm">NEON SYNDICATE</div>
              </div>
            </motion.div>

            <div className="mt-8 border border-line bg-deep/70 p-4 font-mono text-[12px] leading-relaxed">
              {BOOT_LINES.map((line, i) => (
                <motion.div
                  key={line}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.16 }}
                  className={line.endsWith('АКТИВНО') ? 'text-energy' : 'text-credit/85'}
                >
                  {line}
                </motion.div>
              ))}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="mt-2 text-muted">
                {canContinue
                  ? `> найден сейв: сессия #${state.runId}, день ${state.day}, ${fmt(state.credits)}₵`
                  : restored && state.status === 'gameover'
                    ? `> последний синдикат ликвидирован на ${state.day}-й день`
                    : '> новый оператор. Добро пожаловать в Синдикат.'}
                <span className="caret ml-1 inline-block h-3 w-1.5 bg-data align-middle" />
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.1 }}
              className="mt-6 grid gap-3 text-[13.5px] leading-relaxed text-muted sm:grid-cols-2"
            >
              <p>
                <span className="text-credit">Кредиты</span> добывают майнинг-фермы, <span className="text-data">данные</span> — серверы,{' '}
                <span className="text-energy">энергию</span> — солнечные панели. Фермы и серверы потребляют энергию, а содержание платят все здания.
              </p>
              <p>
                Каждые 30 дней — глобальное событие. Если кредиты уйдут в минус и продержатся так 5 дней —{' '}
                <span className="text-danger">банкротство</span>. Продержитесь как можно дольше.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.3 }}
              className="mt-7 flex flex-wrap items-center gap-3"
            >
              {canContinue ? (
                <>
                  <NeonButton size="md" variant="solid" accent="credit" onClick={onContinue} data-autofocus>
                    <Play className="size-4" /> Продолжить · день {state.day}
                  </NeonButton>
                  <NeonButton size="md" accent="danger" onClick={onNewGame}>
                    <RotateCcw className="size-4" /> Новая игра
                  </NeonButton>
                </>
              ) : (
                <NeonButton size="md" variant="solid" accent="credit" onClick={restored ? onNewGame : onContinue} data-autofocus>
                  <Play className="size-4" /> Запустить синдикат
                </NeonButton>
              )}
              <NeonButton size="md" variant="ghost" onClick={onHelp}>
                <CircleHelp className="size-4" /> Как играть
              </NeonButton>
            </motion.div>

            {state.records.bestDays > 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5 }}
                className="mt-6 flex items-center gap-2 font-mono text-[11px] text-dim"
              >
                <Trophy className="size-3.5 text-energy" />
                Рекорд выживания: <span className="text-ink">{state.records.bestDays} дн.</span> · Рекорд капитала:{' '}
                <span className="text-credit">{fmt(state.records.bestCapital)}₵</span>
              </motion.div>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
