import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Siren, ZapOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BootScreen } from './components/BootScreen.tsx';
import { DecisionModal } from './components/DecisionModal.tsx';
import { GameContext, type GameContextValue } from './components/GameContext.tsx';
import { GameOverModal } from './components/GameOverModal.tsx';
import { Header } from './components/Header.tsx';
import { HelpModal } from './components/HelpModal.tsx';
import { ProductionSector } from './components/ProductionSector.tsx';
import { ResearchLab } from './components/ResearchLab.tsx';
import { ResourceDashboard } from './components/ResourceDashboard.tsx';
import { TerminalLog } from './components/TerminalLog.tsx';
import { ThreatCenter } from './components/ThreatCenter.tsx';
import { Toasts } from './components/Toasts.tsx';
import { BANKRUPTCY_DAYS } from './game/config.ts';
import { freshSeed } from './game/rng.ts';
import type { Speed } from './game/types.ts';
import { useGame } from './hooks/useGame.ts';
import { useGameLoop } from './hooks/useGameLoop.ts';
import { usePageVisible } from './hooks/usePageVisible.ts';

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, button, a, [role="switch"], [contenteditable="true"]'));
}

export default function App() {
  const { state, dispatch, econ, projection, restored } = useGame();
  const [booted, setBooted] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [minimizedDecision, setMinimizedDecision] = useState<number | null>(null);
  const visible = usePageVisible();
  const lastSpeed = useRef<Speed>(state.speed > 0 ? state.speed : 1);

  const autoPaused = state.settings.autoPause && !visible;
  const running = booted && state.status === 'playing' && state.speed > 0 && !autoPaused && !helpOpen;

  const tick = useCallback(() => dispatch({ type: 'TICK', now: Date.now() }), [dispatch]);
  useGameLoop(tick, running, state.speed);

  useEffect(() => {
    if (state.speed > 0) lastSpeed.current = state.speed;
  }, [state.speed]);

  const setSpeed = useCallback(
    (speed: Speed) => dispatch({ type: 'SET_SPEED', speed: speed === 0 && state.speed === 0 ? lastSpeed.current : speed }),
    [dispatch, state.speed],
  );

  const newGame = useCallback(() => {
    dispatch({ type: 'NEW_GAME', seed: freshSeed(), now: Date.now() });
    setMinimizedDecision(null);
    setBooted(true);
  }, [dispatch]);

  // Горячие клавиши: пробел — пауза, 1/2/3 — скорость, H — справка.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!booted || event.ctrlKey || event.metaKey || event.altKey || isInteractive(event.target)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (state.status === 'playing') dispatch({ type: 'SET_SPEED', speed: state.speed === 0 ? lastSpeed.current : 0 });
      } else if (event.key === '1' || event.key === '2' || event.key === '3') {
        if (state.status === 'playing') dispatch({ type: 'SET_SPEED', speed: event.key === '1' ? 1 : event.key === '2' ? 2 : 4 });
      } else if (event.key === 'h' || event.key === 'H' || event.key === 'р' || event.key === 'Р' || event.key === '?') {
        setHelpOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [booted, dispatch, state.speed, state.status]);

  const pausedReason = !booted ? 'ЗАГРУЗКА' : helpOpen ? 'СПРАВКА' : autoPaused ? 'ВКЛАДКА СКРЫТА' : state.speed === 0 ? 'ПАУЗА' : null;
  const decisionOpen = booted && state.pending !== null && minimizedDecision !== state.pending.startDay;

  const context = useMemo<GameContextValue>(
    () => ({ state, dispatch, econ, projection, running }),
    [state, dispatch, econ, projection, running],
  );

  return (
    <GameContext.Provider value={context}>
      <MotionConfig reducedMotion="user">
        <div className="relative min-h-screen overflow-x-clip bg-void text-ink">
          <div className="bg-grid pointer-events-none fixed inset-0" aria-hidden />
          <div className="bg-vignette pointer-events-none fixed inset-0" aria-hidden />

          <Header pausedReason={pausedReason} onSpeed={setSpeed} onHelp={() => setHelpOpen(true)} onNewGame={newGame} />

          <AnimatePresence>
            {state.status === 'playing' && (state.blackout || state.bankruptDays > 0) ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="relative overflow-hidden border-b border-danger/50 bg-danger/[0.12]"
                role="alert"
              >
                <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 font-mono text-[11px] font-semibold tracking-wider text-danger sm:px-6">
                  {state.blackout ? (
                    <span className="flicker flex items-center gap-2">
                      <ZapOff className="size-3.5" /> БЛЭКАУТ: производство остановлено, содержание списывается
                    </span>
                  ) : null}
                  {state.bankruptDays > 0 ? (
                    <span className="flex items-center gap-2">
                      <Siren className="size-3.5" /> БАЛАНС В МИНУСЕ: банкротство через {BANKRUPTCY_DAYS - state.bankruptDays} дн. — продайте данные или
                      демонтируйте лишнее
                    </span>
                  ) : null}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <main className="relative mx-auto grid max-w-[1680px] grid-cols-12 gap-4 px-4 py-4 sm:px-6 sm:py-6">
            <ResourceDashboard className="col-span-12" />
            <ProductionSector className="col-span-12 xl:col-span-7" />
            <ResearchLab className="col-span-12 lg:col-span-6 xl:col-span-5" />
            <ThreatCenter className="col-span-12 lg:col-span-6 xl:col-span-4" onOpenDecision={() => setMinimizedDecision(null)} />
            <TerminalLog className="col-span-12 lg:col-span-6 xl:col-span-8" />
          </main>

          <footer className="relative mx-auto max-w-[1680px] px-4 pb-8 font-mono text-[10px] tracking-[0.2em] text-dim sm:px-6">
            CYBERNET: NEON SYNDICATE · АВТОСОХРАНЕНИЕ В ЭТОМ БРАУЗЕРЕ · ПРОБЕЛ — ПАУЗА · H — СПРАВКА
          </footer>

          <Toasts />
          <DecisionModal open={decisionOpen} onMinimize={() => setMinimizedDecision(state.pending?.startDay ?? null)} />
          <GameOverModal open={booted && state.status === 'gameover'} onNewGame={newGame} />
          <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
          <BootScreen
            open={!booted}
            restored={restored}
            onContinue={() => setBooted(true)}
            onNewGame={newGame}
            onHelp={() => setHelpOpen(true)}
          />
        </div>
      </MotionConfig>
    </GameContext.Provider>
  );
}
