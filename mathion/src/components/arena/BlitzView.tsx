import { motion } from 'framer-motion';
import { Coins, Flag, Flame, Pause, Play, RotateCcw, Timer, Trophy, X, Zap } from 'lucide-react';
import { ELEMENT_META } from '../../game/constants';
import type { Blitz, BlitzElement, GameState } from '../../types';
import type { GameActions, GameFx } from '../../hooks/useGame';
import { Button } from '../ui/Button';
import { EssenceRow } from '../ui/Icons';
import { Modal } from '../ui/Modal';
import { Panel } from '../ui/Panel';
import { FloatingLayer } from './FloatingLayer';
import { Forge } from './Forge';

interface BlitzViewProps {
  state: GameState;
  blitz: Blitz;
  actions: GameActions;
  fx: GameFx;
  paused: boolean;
}

export function blitzElementName(element: BlitzElement): string {
  return element === 'chaos' ? 'Хаос (все школы)' : ELEMENT_META[element].magic;
}

/** Режим выживания: время тает, верные ответы продлевают его на 3 секунды. */
export function BlitzView({ state, blitz, actions, fx, paused }: BlitzViewProps) {
  const active = blitz.status === 'active' && !paused;
  const seconds = Math.max(0, blitz.timeLeft) / 1000;
  const danger = seconds < 10;
  const total = blitz.correct + blitz.wrong;
  const accuracy = total > 0 ? Math.round((blitz.correct / total) * 100) : 100;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <Panel title="Математический Блиц" icon={<Zap size={15} />}>
        <div className="relative flex flex-col items-center gap-2 py-4 text-center">
          <FloatingLayer floaters={fx.floaters} target="blitz" />
          <p className="font-display text-xs tracking-[0.25em] text-amber-300/70 uppercase">{blitzElementName(blitz.element)}</p>
          <motion.p
            className={`font-mono text-6xl font-bold tabular-nums ${danger ? 'text-red-400' : 'text-emerald-200 mystic-glow'}`}
            animate={danger && active ? { scale: [1, 1.06, 1] } : { scale: 1 }}
            transition={danger && active ? { duration: 0.8, repeat: Infinity } : undefined}
            aria-label={`Осталось ${seconds.toFixed(1)} секунд`}
          >
            {seconds.toFixed(1)}
          </motion.p>
          <p className="flex items-center gap-1 text-sm text-amber-200/60">
            <Timer size={14} /> секунд до конца
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-2">
          <div className="glass-vial p-3 text-center">
            <dt className="text-xs text-amber-200/60">Очки</dt>
            <dd className="font-mono text-3xl font-bold text-amber-200 gold-glow">{blitz.score}</dd>
          </div>
          <div className="glass-vial p-3 text-center">
            <dt className="text-xs text-amber-200/60">Комбо</dt>
            <dd className="flex items-center justify-center gap-1 font-mono text-3xl font-bold text-orange-300">
              <Flame size={20} />×{blitz.combo}
            </dd>
          </div>
          <div className="glass-vial p-3 text-center">
            <dt className="text-xs text-amber-200/60">Верно / ошибок</dt>
            <dd className="font-mono text-xl font-bold text-amber-50">
              {blitz.correct} / {blitz.wrong}
            </dd>
          </div>
          <div className="glass-vial p-3 text-center">
            <dt className="text-xs text-amber-200/60">Точность</dt>
            <dd className="font-mono text-xl font-bold text-amber-50">{accuracy}%</dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-amber-200/55">Очки = база школы × сложность × (1 + 0.1 × комбо). Каждые 4 верных ответа сложность растёт.</p>

        {blitz.status === 'active' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="wood" icon={paused ? <Play size={14} /> : <Pause size={14} />} onClick={paused ? actions.resume : actions.pause}>
              {paused ? 'Продолжить' : 'Пауза'}
            </Button>
            <Button size="sm" variant="danger" icon={<Flag size={14} />} onClick={actions.endBlitz}>
              Завершить
            </Button>
          </div>
        )}
      </Panel>

      <div className="wood-panel relative p-4 sm:p-5">
        <p className="brass-plaque relative mx-auto mb-4 w-fit rounded-md px-4 py-1 font-display text-sm font-bold">Алхимический Горн</p>
        <div className="relative">
          <Forge problem={blitz.problem} timeLeft={blitz.timeLeft} timeLimit={Math.max(60_000, blitz.timeLeft)} active={active} onSubmit={actions.submitBlitz} />
          {paused && blitz.status === 'active' && (
            <div className="absolute -inset-2 z-20 flex flex-col items-center justify-center gap-3 rounded-xl bg-[#0c111a]/92 text-center backdrop-blur-md">
              <Pause size={36} className="text-amber-300" />
              <p className="font-display text-xl font-bold text-amber-100">Блиц на паузе</p>
              <Button variant="brass" icon={<Play size={16} />} onClick={actions.resume}>
                Продолжить
              </Button>
            </div>
          )}
        </div>
      </div>

      <BlitzResult state={state} blitz={blitz} actions={actions} />
    </div>
  );
}

function BlitzResult({ state, blitz, actions }: { state: GameState; blitz: Blitz; actions: GameActions }) {
  const open = blitz.status === 'over';
  const newRecord = blitz.recordRank === 1;
  return (
    <Modal
      open={open}
      persistent
      title={newRecord ? 'Новый рекорд!' : 'Время вышло'}
      icon={newRecord ? <Trophy size={22} className="text-amber-300" /> : <Timer size={22} className="text-amber-300" />}
      footer={
        <>
          <Button variant="wood" icon={<X size={15} />} onClick={actions.closeBlitz}>
            Закрыть
          </Button>
          <Button
            variant="brass"
            data-autofocus
            icon={<RotateCcw size={15} />}
            onClick={() => {
              actions.closeBlitz();
              actions.startBlitz(blitz.element);
            }}
          >
            Ещё раз
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-center font-mono text-5xl font-bold text-amber-200 gold-glow">{blitz.score}</p>
        <p className="text-center text-sm text-amber-100/75">
          {blitz.correct} верных · {blitz.wrong} ошибок · комбо ×{blitz.maxCombo} · {Math.round(blitz.elapsed / 1000)} с в строю
        </p>
        {blitz.recordRank && <p className="text-center font-display text-amber-300">Место в таблице рекордов: {blitz.recordRank}</p>}
        {blitz.rewards && (
          <div className="glass-vial flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span className="flex items-center gap-1.5 text-amber-200">
              <Coins size={15} /> +{blitz.rewards.gold} золота
            </span>
            <EssenceRow essences={blitz.rewards.essences} hideEmpty size="sm" />
          </div>
        )}
        <ol className="space-y-1 text-sm">
          {state.records.slice(0, 5).map((r, i) => (
            <li
              key={r.id}
              className={`flex justify-between rounded-md px-3 py-1 font-mono ${blitz.recordRank === i + 1 ? 'bg-amber-500/15 text-amber-100' : 'text-amber-200/70'}`}
            >
              <span>
                {i + 1}. {r.element === 'chaos' ? 'Хаос' : ELEMENT_META[r.element].name}
              </span>
              <span>{r.score}</span>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}
