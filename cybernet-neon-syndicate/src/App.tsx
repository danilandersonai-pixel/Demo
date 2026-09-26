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
import { TakeoverModal } from './components/TakeoverModal.tsx';
import { TerminalLog } from './components/TerminalLog.tsx';
import { ThreatCenter } from './components/ThreatCenter.tsx';
import { TickerBar } from './components/TickerBar.tsx';
import { Toasts } from './components/Toasts.tsx';
import { BANKRUPTCY_DAYS } from './game/config.ts';
import { freshSeed } from './game/rng.ts';
import type { Speed } from './game/types.ts';
import { useGame } from './hooks/useGame.ts';
import { useGameLoop } from './hooks/useGameLoop.ts';
import { usePageVisible } from './hooks/usePageVisible.ts';

/** Всё, что пробел может «нажать»: кнопки, ссылки, вкладки, переключатели. */
const CONTROLS = 'button, a, [role="tab"], [role="switch"], input[type="checkbox"], input[type="radio"]';

/** Поля ввода текста — там горячие клавиши не перехватываем вообще. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(target.type);
}


export default function App() {
  const { state, dispatch, econ, projection, restored, stale, takeOver } = useGame();
  const [booted, setBooted] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [minimizedDecision, setMinimizedDecision] = useState<number | null>(null);
  const visible = usePageVisible();
  const lastSpeed = useRef<Speed>(state.speed > 0 ? state.speed : 1);
  const spaceHandled = useRef(false);

  const autoPaused = state.settings.autoPause && !visible;
  const running = booted && !stale && state.status === 'playing' && state.speed > 0 && !autoPaused && !helpOpen;
  const decisionOpen = booted && !stale && state.status === 'playing' && state.pending !== null && minimizedDecision !== state.pending.startDay;
  const gameOverOpen = booted && !stale && state.status === 'gameover';
  const overlay = !booted || stale || helpOpen || decisionOpen || gameOverOpen;

  const tick = useCallback(() => dispatch({ type: 'TICK', now: Date.now() }), [dispatch]);
  useGameLoop(tick, running, state.speed);

  useEffect(() => {
    if (state.speed > 0) lastSpeed.current = state.speed;
  }, [state.speed]);

  /** 0 — переключить паузу: из паузы возвращаемся на прежнюю скорость. */
  const setSpeed = useCallback(
    (speed: Speed) => {
      if (state.status !== 'playing') return;
      dispatch({ type: 'SET_SPEED', speed: speed === 0 && state.speed === 0 ? lastSpeed.current : speed });
    },
    [dispatch, state.speed, state.status],
  );

  const newGame = useCallback(() => {
    dispatch({ type: 'NEW_GAME', seed: freshSeed(), now: Date.now() });
    setMinimizedDecision(null);
    setBooted(true);
  }, [dispatch]);

  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const pendingStart = state.pending?.startDay ?? null;
  const minimizeDecision = useCallback(() => setMinimizedDecision(pendingStart), [pendingStart]);
  const openDecision = useCallback(() => setMinimizedDecision(null), []);
  const openLog = useCallback(() => {
    document.getElementById('terminal-title')?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Какой элемент последним нажали мышью. :focus-visible тут не помогает: Chrome включает его
  // в момент нажатия любой клавиши, поэтому источник фокуса запоминаем сами. lastPressed
  // переживает открытие окна: когда окно закроется и вернёт фокус на кнопку, она всё ещё «мышиная».
  const pointerFocus = useRef<Element | null>(null);
  const lastPressed = useRef<Element | null>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const control = event.target instanceof Element ? event.target.closest(CONTROLS) : null;
      pointerFocus.current = control;
      lastPressed.current = control;
    };
    const onFocusIn = (event: FocusEvent) => {
      pointerFocus.current = event.target === lastPressed.current ? lastPressed.current : null;
    };
    const onTab = (event: KeyboardEvent) => {
      if (event.key === 'Tab') lastPressed.current = null;
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('keydown', onTab, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('focusin', onFocusIn, true);
      window.removeEventListener('keydown', onTab, true);
    };
  }, []);

  // Вкладка замерла — справку закрываем, чтобы она не осталась открытой под окном перехвата.
  useEffect(() => {
    if (stale) setHelpOpen(false);
  }, [stale]);

  // Горячие клавиши: пробел — пауза, 1/2/3 — скорость, H — справка.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTextEntry(event.target)) return;
      if (stale) return;
      // Автоповтор зажатой клавиши не должен дёргать паузу туда-сюда.
      if (event.repeat) {
        if (event.code === 'Space' && spaceHandled.current) event.preventDefault();
        return;
      }
      if (['h', 'H', 'р', 'Р', '?'].includes(event.key)) {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }
      if (!booted || stale || state.status !== 'playing') return;
      if (event.code === 'Space') {
        // В окнах пробел нажимает выбранную кнопку — это нужно для выбора с клавиатуры.
        if (overlay) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        const control = target?.closest(CONTROLS) ?? null;
        // Элемент выбрали с клавиатуры (Tab) — пробел его нажимает, как обычно.
        if (control && control !== pointerFocus.current) return;
        // Кнопку просто кликнули мышью — не даём пробелу нажать её повторно (второе здание, демонтаж).
        event.preventDefault();
        spaceHandled.current = true;
        if (control instanceof HTMLElement) control.blur();
        dispatch({ type: 'SET_SPEED', speed: state.speed === 0 ? lastSpeed.current : 0 });
      } else if (event.key === '1' || event.key === '2' || event.key === '3') {
        dispatch({ type: 'SET_SPEED', speed: event.key === '1' ? 1 : event.key === '2' ? 2 : 4 });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' && spaceHandled.current) {
        event.preventDefault();
        spaceHandled.current = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [booted, stale, overlay, dispatch, state.speed, state.status]);

  const pausedReason = !booted
    ? 'ЗАГРУЗКА'
    : stale
      ? 'ДРУГАЯ ВКЛАДКА'
      : helpOpen
        ? 'СПРАВКА'
        : autoPaused
          ? 'ВКЛАДКА СКРЫТА'
          : state.speed === 0
            ? 'ПАУЗА'
            : null;

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

          <Header pausedReason={pausedReason} onSpeed={setSpeed} onHelp={openHelp} onNewGame={newGame} inert={overlay} />

          <AnimatePresence>
            {state.status === 'playing' && (state.blackout || state.bankruptDays > 0) ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="relative overflow-hidden border-b border-danger/50 bg-danger/[0.12]"
                role="alert"
                inert={overlay}
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

          <main className="relative mx-auto grid max-w-[1680px] grid-cols-12 gap-4 px-4 py-4 sm:px-6 sm:py-6" inert={overlay}>
            <ResourceDashboard className="col-span-12" />
            <ProductionSector className="col-span-12 xl:col-span-7 min-[1800px]:col-span-5" />
            <ResearchLab className="col-span-12 lg:col-span-6 xl:col-span-5 min-[1800px]:col-span-4" />
            <ThreatCenter className="col-span-12 lg:col-span-6 xl:col-span-4 min-[1800px]:col-span-3" onOpenDecision={openDecision} />
            <TerminalLog className="col-span-12 xl:col-span-8 min-[1800px]:col-span-12" />
          </main>

          <footer className="relative mx-auto max-w-[1680px] px-4 pb-16 font-mono text-[10px] tracking-[0.2em] text-dim sm:px-6" inert={overlay}>
            CYBERNET: NEON SYNDICATE · АВТОСОХРАНЕНИЕ В ЭТОМ БРАУЗЕРЕ · ПРОБЕЛ — ПАУЗА · H — СПРАВКА
          </footer>

          <TickerBar onOpenLog={openLog} inert={overlay} />
          <Toasts underOverlay={overlay} />
          <DecisionModal open={decisionOpen} onMinimize={minimizeDecision} inert={helpOpen} />
          <GameOverModal open={gameOverOpen} onNewGame={newGame} inert={helpOpen} />
          <HelpModal open={helpOpen} onClose={closeHelp} inert={stale} />
          <BootScreen
            open={!booted}
            restored={restored}
            onContinue={() => setBooted(true)}
            onNewGame={newGame}
            onHelp={openHelp}
            inert={helpOpen || stale}
          />
          <TakeoverModal open={stale} onTakeOver={takeOver} />
        </div>
      </MotionConfig>
    </GameContext.Provider>
  );
}
