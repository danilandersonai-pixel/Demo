import { motion } from 'framer-motion';
import { RotateCcw, Skull, Trophy } from 'lucide-react';
import { fmt } from '../game/format.ts';
import { useGameContext } from './GameContext.tsx';
import { cn } from './ui/cn.ts';
import { HallOfFame } from './HallOfFame.tsx';
import { Modal } from './ui/Modal.tsx';
import { NeonButton } from './ui/NeonButton.tsx';

/** Экран банкротства: итоги забега, побитые рекорды и Зал славы. */
export function GameOverModal({ open, onNewGame }: { open: boolean; onNewGame: () => void }) {
  const { state } = useGameContext();
  const recordDays = state.day > state.baseline.days;
  const recordCapital = state.stats.peakCapital > state.baseline.capital;
  const stats = [
    { label: 'Дней продержались', value: String(state.day), cls: 'text-ink' },
    { label: 'Пиковый капитал', value: `${fmt(state.stats.peakCapital)}₵`, cls: 'text-credit' },
    { label: 'Построено объектов', value: String(state.stats.built), cls: 'text-energy' },
    { label: 'Улучшений', value: String(state.stats.upgrades), cls: 'text-energy' },
    { label: 'Исследований', value: `${state.stats.researchDone}/12`, cls: 'text-research' },
    { label: 'Событий пережито', value: String(state.stats.events), cls: 'text-data' },
    { label: 'Заработано всего', value: `${fmt(state.stats.creditsEarned)}₵`, cls: 'text-credit' },
    { label: 'Блэкаутов', value: String(state.stats.blackouts), cls: 'text-danger' },
  ];

  return (
    <Modal open={open} labelledBy="gameover-title" tone="danger" className="max-w-2xl">
      <div className="p-5 sm:p-7">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ rotate: -20, scale: 0.6 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 12 }}
            className="grid size-12 place-items-center border border-danger/60 bg-danger/10"
          >
            <Skull className="size-6 text-danger" />
          </motion.div>
          <div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-danger">GAME OVER · СЕССИЯ #{state.runId}</div>
            <h2 id="gameover-title" className="glow-danger font-display text-2xl font-extrabold uppercase tracking-wider text-danger sm:text-3xl">
              Банкротство
            </h2>
          </div>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-muted">
          Кредиты держались в минусе 5 дней подряд. Кредиторы ликвидировали синдикат «Neon» на {state.day}-й день.
        </p>

        {recordDays || recordCapital ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.25, type: 'spring', stiffness: 260, damping: 16 }}
            className="mt-4 flex flex-wrap gap-2"
          >
            {recordDays ? (
              <span className="glow-credit flex items-center gap-2 border border-credit/60 bg-credit/10 px-3 py-1.5 font-mono text-xs font-bold tracking-wider text-credit shadow-[0_0_24px_-6px_var(--color-credit)]">
                <Trophy className="size-4" /> НОВЫЙ РЕКОРД: {state.day} ДН.
              </span>
            ) : null}
            {recordCapital ? (
              <span className="glow-data flex items-center gap-2 border border-data/60 bg-data/10 px-3 py-1.5 font-mono text-xs font-bold tracking-wider text-data shadow-[0_0_24px_-6px_var(--color-data)]">
                <Trophy className="size-4" /> РЕКОРД КАПИТАЛА: {fmt(state.stats.peakCapital)}₵
              </span>
            ) : null}
          </motion.div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-deep p-3">
              <div className="font-mono text-[9px] tracking-[0.15em] text-dim uppercase">{s.label}</div>
              <div className={cn('tabular mt-1 font-mono text-lg font-bold', s.cls)}>{s.value}</div>
            </div>
          ))}
        </div>

        <HallOfFame highlight={state.runId} className="mt-5" />

        <div className="mt-6 flex justify-end">
          <NeonButton size="md" variant="solid" accent="credit" onClick={onNewGame} data-autofocus>
            <RotateCcw className="size-4" /> Новая игра
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}
