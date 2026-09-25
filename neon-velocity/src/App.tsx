/**
 * Корневой компонент: экраны (menu → playing ⇄ paused → gameover), панели
 * меню, горячие клавиши и прогресс. Холст живёт всегда, всё остальное —
 * React-слои поверх него:
 *   z-0 холст · z-10 HUD · z-20 вспышка смерти · z-30 экраны · z-40 панели · z-50 ЭЛТ-эффекты.
 */
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DeathFlash } from './components/DeathFlash';
import { GameCanvas, type ScreenPoint } from './components/GameCanvas';
import { GameOverOverlay } from './components/GameOverOverlay';
import { HowToPlay } from './components/HowToPlay';
import { Hud } from './components/Hud';
import { GAME_OVER_ARM_MS } from './components/hud/constants';
import { Leaderboard } from './components/Leaderboard';
import { MainMenu } from './components/MainMenu';
import { PauseOverlay } from './components/PauseOverlay';
import { ScreenFx } from './components/ScreenFx';
import { SettingsPanel } from './components/SettingsPanel';
import { Shop } from './components/Shop';
import { applyThemeCss } from './components/ui/themeCss';
import { audio } from './game/audio';
import { hudStore } from './game/hudStore';
import type { MenuPanel, RunResult, Screen } from './game/types';
import { playUiSound } from './game/uiSound';
import { getLoadout, type RecordOutcome } from './state/progress';
import { useProgress } from './state/useProgress';

interface LastRun {
  result: RunResult;
  outcome: RecordOutcome;
}

interface Burst {
  id: number;
  x: number;
  y: number;
}

/** Фокус в поле ввода: буквенные хоткеи не перехватываем. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color'].includes(target.type);
  }
  return false;
}

/** Enter/Space на кнопке или контроле — это нажатие самого контрола, а не хоткей экрана. */
function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'button, a[href], input, select, textarea, summary, [role="button"], [role="switch"], [role="slider"], [role="tab"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="option"]',
    ) !== null
  );
}

export default function App() {
  const { save, actions, storageOk } = useProgress();
  const [screen, setScreen] = useState<Screen>('menu');
  const [panel, setPanel] = useState<MenuPanel | null>(null);
  const [runId, setRunId] = useState(0);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [burst, setBurst] = useState<Burst | null>(null);
  /** Корабль взорвался, до экрана Game Over — пауза недоступна. */
  const [dying, setDying] = useState(false);
  const gameOverAt = useRef(0);

  const { equippedSkin, equippedTheme, upgrades, highscore, settings } = save;
  // getLoadout читает только снаряжение, улучшения и рекорд — мемо ровно по ним:
  // трата кристаллов или смена настроек не пересоздают loadout и не трогают сцену.
  const loadout = useMemo(() => getLoadout(save), [equippedSkin, equippedTheme, upgrades, highscore]);
  const theme = loadout.theme;
  const burstColors = useMemo(
    () => [theme.colors.accent, theme.colors.accent2, theme.colors.accent3] as const,
    [theme],
  );

  // До первой отрисовки — чтобы интерфейс не мигнул цветами темы по умолчанию.
  useLayoutEffect(() => {
    applyThemeCss(theme);
  }, [theme]);

  useEffect(() => {
    audio.setSettings({ enabled: settings.sound, music: settings.music, sfx: settings.sfx });
  }, [settings.sound, settings.music, settings.sfx]);

  // AudioContext можно запустить только из жеста: любой первый клик или клавиша —
  // и у кнопок меню тоже появляется звук. Повторные вызовы дёшевы и возобновляют
  // контекст, если браузер его усыпил.
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);

  // ─── Переходы ─────────────────────────────────────────────────────────────

  const play = useCallback(() => {
    audio.unlock();
    // Снимок прошлого забега не должен мелькнуть в HUD нового.
    hudStore.resetSnapshot();
    setPanel(null);
    setBurst(null);
    setDying(false);
    setRunId((n) => n + 1);
    setScreen('playing');
  }, []);

  const pause = useCallback(() => {
    if (dying) return;
    setScreen((s) => (s === 'playing' ? 'paused' : s));
  }, [dying]);

  const resume = useCallback(() => {
    setScreen((s) => (s === 'paused' ? 'playing' : s));
  }, []);

  const toMenu = useCallback(() => {
    setPanel(null);
    setBurst(null);
    setDying(false);
    setScreen('menu');
  }, []);

  const openShopFromGameOver = useCallback(() => {
    setScreen('menu');
    setPanel('shop');
  }, []);

  const openLeaderboard = useCallback(() => setPanel('leaderboard'), []);
  const openPanel = useCallback((next: MenuPanel) => setPanel(next), []);
  const closePanel = useCallback(() => setPanel(null), []);
  const clearBurst = useCallback(() => setBurst(null), []);

  const toggleSound = useCallback(() => {
    audio.unlock();
    actions.updateSettings({ sound: !settings.sound });
  }, [actions, settings.sound]);

  const handleDeath = useCallback((at: ScreenPoint) => {
    setDying(true);
    setBurst({ id: performance.now(), x: at.x, y: at.y });
  }, []);

  const handleGameOver = useCallback(
    (result: RunResult) => {
      const outcome = actions.recordRun(result);
      gameOverAt.current = performance.now();
      setLastRun({ result, outcome });
      setDying(false);
      setPanel(null);
      setScreen('gameover');
    },
    [actions],
  );

  // ─── Горячие клавиши ──────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Панели сами решают, что делать с Esc (например, отменить подтверждение сброса).
      if (e.repeat || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const typing = isTypingTarget(e.target);
      const esc = e.key === 'Escape';
      const confirm = (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') && !typing && !isActivatable(e.target);
      // e.code не зависит от раскладки: P/R/M/S/L работают и на русской.
      const letter = typing ? '' : e.code;

      if (panel) {
        if (esc) {
          e.preventDefault();
          playUiSound('back');
          setPanel(null);
        }
        return;
      }

      switch (screen) {
        case 'menu':
          if (confirm) {
            e.preventDefault();
            play();
          }
          return;
        case 'playing':
          if (esc || letter === 'KeyP') {
            e.preventDefault();
            pause();
          }
          return;
        case 'paused':
          if (esc || letter === 'KeyP' || confirm) {
            e.preventDefault();
            playUiSound('click');
            resume();
          } else if (letter === 'KeyR') {
            e.preventDefault();
            playUiSound('click');
            play();
          } else if (letter === 'KeyM') {
            e.preventDefault();
            playUiSound('back');
            toMenu();
          }
          return;
        case 'gameover':
          if (performance.now() - gameOverAt.current < GAME_OVER_ARM_MS) return;
          if (confirm || letter === 'KeyR') {
            e.preventDefault();
            playUiSound('click');
            play();
          } else if (letter === 'KeyS') {
            e.preventDefault();
            playUiSound('click');
            openShopFromGameOver();
          } else if (letter === 'KeyL') {
            e.preventDefault();
            playUiSound('click');
            openLeaderboard();
          } else if (esc) {
            e.preventDefault();
            playUiSound('back');
            toMenu();
          }
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen, panel, play, pause, resume, toMenu, openShopFromGameOver, openLeaderboard]);

  // ─── Слои ─────────────────────────────────────────────────────────────────

  const hudVisible = screen === 'playing' || screen === 'paused';

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative h-full w-full overflow-hidden bg-void font-mono text-ink">
        <GameCanvas
          screen={screen}
          runId={runId}
          loadout={loadout}
          settings={settings}
          onGameOver={handleGameOver}
          onDeath={handleDeath}
          onRequestPause={pause}
        />

        <AnimatePresence>
          {hudVisible && (
            <Hud
              key="hud"
              runId={runId}
              showFps={settings.showFps}
              showHint={!save.seenTutorial}
              onHintDone={actions.markTutorialSeen}
              onPause={pause}
              canPause={screen === 'playing' && !dying}
            />
          )}
        </AnimatePresence>

        {burst && <DeathFlash key={burst.id} x={burst.x} y={burst.y} colors={burstColors} onDone={clearBurst} />}

        <AnimatePresence>
          {screen === 'menu' && (
            <MainMenu key="menu" save={save} storageOk={storageOk} onPlay={play} onOpenPanel={openPanel} onToggleSound={toggleSound} />
          )}
          {screen === 'paused' && (
            <PauseOverlay
              key="pause"
              soundOn={settings.sound}
              onToggleSound={toggleSound}
              onResume={resume}
              onRestart={play}
              onMenu={toMenu}
            />
          )}
          {screen === 'gameover' && lastRun && (
            <GameOverOverlay
              key={`over-${runId}`}
              result={lastRun.result}
              outcome={lastRun.outcome}
              wallet={save.crystals}
              onRetry={play}
              onShop={openShopFromGameOver}
              onLeaderboard={openLeaderboard}
              onMenu={toMenu}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {panel === 'shop' && <Shop key="shop" save={save} actions={actions} onClose={closePanel} />}
          {panel === 'leaderboard' && (
            <Leaderboard key="leaderboard" save={save} highlightId={lastRun?.outcome.entryId ?? null} onClose={closePanel} />
          )}
          {panel === 'settings' && (
            <SettingsPanel key="settings" save={save} actions={actions} storageOk={storageOk} onClose={closePanel} />
          )}
          {panel === 'howto' && <HowToPlay key="howto" onClose={closePanel} />}
        </AnimatePresence>

        <ScreenFx />
      </main>
    </MotionConfig>
  );
}
