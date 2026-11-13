/**
 * Корневой компонент: экраны (menu → playing ⇄ paused → gameover), панели
 * меню, горячие клавиши и прогресс. Холст живёт всегда, всё остальное —
 * React-слои поверх него:
 *   z-0 холст · z-10 HUD · z-20 вспышка гибели · z-30 экраны · z-40 панели · z-50 эффекты экрана.
 */
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { audio } from './audio/audio';
import { playUiSound } from './audio/uiSound';
import type { MenuPanel, RunResult, Screen } from './core/types';
import { getLoadout, type RecordOutcome } from './state/progress';
import { useProgress } from './state/useProgress';
import { DeathFlash } from './ui/DeathFlash';
import { GameHost, type AbandonReason, type ScreenPoint } from './ui/GameHost';
import { GameOverOverlay } from './ui/GameOverOverlay';
import { HowToPlay } from './ui/HowToPlay';
import { Hud } from './ui/Hud';
import { GAME_OVER_ARM_MS } from './ui/hud/constants';
import { applyThemeCss } from './ui/kit/themeCss';
import { Leaderboard } from './ui/Leaderboard';
import { MainMenu } from './ui/MainMenu';
import { PauseOverlay } from './ui/PauseOverlay';
import { ScreenFx } from './ui/ScreenFx';
import { SettingsPanel } from './ui/SettingsPanel';
import { Shop } from './ui/Shop';

interface LastRun {
  result: RunResult;
  outcome: RecordOutcome;
}

interface Burst extends ScreenPoint {
  id: number;
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

/** Enter и пробел на кнопке или контроле — нажатие самого контрола, а не хоткей экрана. */
function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'button, a[href], input, select, textarea, summary, [role="button"], [role="switch"], [role="slider"], [role="tab"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="option"]',
    ) !== null
  );
}

/**
 * Слой главного меню. Пока поверх открыта панель, меню инертно: его кнопки не
 * читаются скринридером и не берут фокус из-под модального диалога.
 * display: contents — обёртка не создаёт своего бокса, инертность наследуется.
 */
function MenuLayer({ covered, children }: { covered: boolean; children: ReactNode }) {
  return (
    // React 19 снимает атрибут при false.
    <div inert={covered} className="contents">
      {children}
    </div>
  );
}

export default function App() {
  const { save, actions, storageOk } = useProgress();
  const [screen, setScreen] = useState<Screen>('menu');
  const [panel, setPanel] = useState<MenuPanel | null>(null);
  const [runId, setRunId] = useState(0);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [burst, setBurst] = useState<Burst | null>(null);
  /** Корабль взорвался, экран Game Over ещё не пришёл — пауза недоступна. */
  const [dying, setDying] = useState(false);
  const dyingRef = useRef(false);
  const gameOverAt = useRef(0);
  /**
   * Экран «на самом деле» — меняется синхронно с переходом, до рендера. Уходящие
   * экраны ещё 0.3 с доигрывают анимацию выхода: переходы сверяются с ним, а не
   * с отрисованным экраном, и двойной клик по «Играть» не запускает второй забег,
   * а «Меню» уходящей паузы не обрывает только что продолженный.
   */
  const screenRef = useRef<Screen>('menu');
  /** Фокус пришёл с клавиатуры (виден фокус-ринг), а не от клика мышью. */
  const keyboardFocus = useRef(false);

  const switchScreen = useCallback((next: Screen) => {
    screenRef.current = next;
    setScreen(next);
  }, []);

  const markDying = useCallback((value: boolean) => {
    dyingRef.current = value;
    setDying(value);
  }, []);

  /** Экран Game Over «взвёлся»: кнопки и клавиши работают. */
  const gameOverArmed = useCallback(() => performance.now() - gameOverAt.current >= GAME_OVER_ARM_MS, []);

  const { equippedSkin, equippedTheme, upgrades, highscore, settings } = save;
  // getLoadout читает только снаряжение, улучшения и рекорд — мемо ровно по ним:
  // трата кристаллов или смена настроек не пересоздают loadout.
  const loadout = useMemo(() => getLoadout(save), [equippedSkin, equippedTheme, upgrades, highscore]);
  const theme = loadout.theme;
  const burstColors = useMemo(() => [theme.colors.accent, theme.colors.accent2, theme.colors.accent3] as const, [theme]);

  // До первой отрисовки — чтобы интерфейс не мигнул цветами темы по умолчанию.
  useLayoutEffect(() => {
    applyThemeCss(theme);
  }, [theme]);

  useEffect(() => {
    audio.setSettings({ enabled: settings.sound, music: settings.music, sfx: settings.sfx });
  }, [settings.sound, settings.music, settings.sfx]);

  // ─── Переходы ─────────────────────────────────────────────────────────────

  const play = useCallback(() => {
    const current = screenRef.current;
    if (current === 'playing' || (current === 'gameover' && !gameOverArmed())) return;
    // Жест пользователя: звук можно запускать.
    audio.unlock();
    setPanel(null);
    setBurst(null);
    markDying(false);
    setRunId((n) => n + 1);
    switchScreen('playing');
  }, [switchScreen, gameOverArmed, markDying]);

  const pause = useCallback(() => {
    if (dyingRef.current || screenRef.current !== 'playing') return;
    switchScreen('paused');
  }, [switchScreen]);

  const resume = useCallback(() => {
    if (screenRef.current === 'paused') switchScreen('playing');
  }, [switchScreen]);

  /** Переход в меню без проверок — общий для кнопок и ухода со страницы. */
  const enterMenu = useCallback(() => {
    setPanel(null);
    setBurst(null);
    markDying(false);
    switchScreen('menu');
  }, [switchScreen, markDying]);

  const toMenu = useCallback(() => {
    const current = screenRef.current;
    // «Меню» уходящей паузы или ещё не взведённого Game Over ничего не делает.
    if (current === 'paused' || (current === 'gameover' && gameOverArmed())) enterMenu();
  }, [enterMenu, gameOverArmed]);

  const openShopFromGameOver = useCallback(() => {
    if (screenRef.current !== 'gameover' || !gameOverArmed()) return;
    switchScreen('menu');
    setPanel('shop');
  }, [switchScreen, gameOverArmed]);

  const openLeaderboard = useCallback(() => {
    if (screenRef.current === 'gameover' && gameOverArmed()) setPanel('leaderboard');
  }, [gameOverArmed]);

  const openPanel = useCallback((next: MenuPanel) => {
    if (screenRef.current === 'menu') setPanel(next);
  }, []);

  const closePanel = useCallback(() => setPanel(null), []);
  const clearBurst = useCallback(() => setBurst(null), []);

  const toggleSound = useCallback(() => {
    audio.unlock();
    // Щелчок-подтверждение включения — только в этой вкладке, не во всех открытых.
    if (!settings.sound) audio.armToggleConfirm();
    actions.updateSettings({ sound: !settings.sound });
  }, [actions, settings.sound]);

  const handleDeath = useCallback(
    (at: ScreenPoint) => {
      markDying(true);
      setBurst({ id: performance.now(), x: at.x, y: at.y });
    },
    [markDying],
  );

  const handleGameOver = useCallback(
    (result: RunResult) => {
      const outcome = actions.recordRun(result);
      gameOverAt.current = performance.now();
      setLastRun({ result, outcome });
      markDying(false);
      setPanel(null);
      switchScreen('gameover');
    },
    [actions, switchScreen, markDying],
  );

  // Забег брошен без гибели: кристаллы, рекорд и запись в топ-5 всё равно
  // засчитываются (пустой итог приходит как null и не записывается). При уходе со
  // страницы — сразу в меню: забег уже мёртв, и страница, восстановленная из
  // bfcache, не должна показывать его как идущий.
  const handleRunAbandoned = useCallback(
    (result: RunResult | null, reason: AbandonReason) => {
      if (result) setLastRun({ result, outcome: actions.recordRun(result) });
      if (reason === 'unload') enterMenu();
    },
    [actions, enterMenu],
  );

  // ─── Горячие клавиши ──────────────────────────────────────────────────────

  // Как контрол получил фокус, запоминаем в момент фокуса: при нажатии клавиши
  // браузер уже считает фокус «клавиатурным» и :focus-visible совпадает всегда.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      keyboardFocus.current = e.target instanceof Element && e.target.matches(':focus-visible');
    };
    window.addEventListener('focusin', onFocusIn, true);
    return () => window.removeEventListener('focusin', onFocusIn, true);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Панели сами решают, что делать с Esc (например, отменить подтверждение сброса).
      if (e.repeat || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const typing = isTypingTarget(e.target);
      // e.code не зависит от раскладки: P / R / M / S / L работают и на русской.
      const code = e.code;
      const esc = code === 'Escape';
      // Enter и пробел на контроле с видимым фокусом нажимают сам контрол. Фокус после
      // клика мышью не виден (например, кнопка звука) — тогда это хоткей экрана, а
      // preventDefault ниже гасит повторное нажатие кнопки браузером.
      const confirm =
        (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') && !typing && !(isActivatable(e.target) && keyboardFocus.current);
      const letter = typing ? '' : code;

      if (panel) {
        if (esc) {
          e.preventDefault();
          playUiSound('back');
          setPanel(null);
        }
        return;
      }

      switch (screenRef.current) {
        case 'menu':
          if (confirm) {
            e.preventDefault();
            playUiSound('click');
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
          if (esc || letter === 'KeyP') {
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
          if (!gameOverArmed()) return;
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
  }, [panel, play, pause, resume, toMenu, openShopFromGameOver, openLeaderboard, gameOverArmed]);

  // ─── Слои ─────────────────────────────────────────────────────────────────

  const hudVisible = screen === 'playing' || screen === 'paused';

  return (
    <MotionConfig reducedMotion="user">
      {/* text-base — свой размер и межстрочный интервал на корне: страница-хост может
          задать body шорткатом font (14px, line-height: normal), и надписи, у которых
          задан только размер, съехали бы по высоте. */}
      <main className="relative h-full w-full overflow-hidden bg-void font-mono text-base text-ink">
        <GameHost
          screen={screen}
          runId={runId}
          loadout={loadout}
          settings={settings}
          onGameOver={handleGameOver}
          onRunAbandoned={handleRunAbandoned}
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
              frozen={screen === 'paused'}
            />
          )}
        </AnimatePresence>

        {burst && <DeathFlash key={burst.id} x={burst.x} y={burst.y} colors={burstColors} onDone={clearBurst} />}

        <AnimatePresence>
          {screen === 'menu' && (
            <MenuLayer key="menu" covered={panel !== null}>
              <MainMenu save={save} storageOk={storageOk} onPlay={play} onOpenPanel={openPanel} onToggleSound={toggleSound} />
            </MenuLayer>
          )}
          {screen === 'paused' && (
            <PauseOverlay key="pause" soundOn={settings.sound} onToggleSound={toggleSound} onResume={resume} onRestart={play} onMenu={toMenu} />
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
              // Панель закрывается синхронно, и inert снимается раньше, чем уходящая
              // панель вернёт фокус на кнопку, которая её открыла.
              covered={panel !== null}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {panel === 'shop' && <Shop key="shop" save={save} actions={actions} onClose={closePanel} />}
          {panel === 'leaderboard' && (
            <Leaderboard key="leaderboard" save={save} highlightId={lastRun?.outcome.entryId ?? null} onClose={closePanel} />
          )}
          {panel === 'settings' && <SettingsPanel key="settings" save={save} actions={actions} storageOk={storageOk} onClose={closePanel} />}
          {panel === 'howto' && <HowToPlay key="howto" onClose={closePanel} />}
        </AnimatePresence>

        <ScreenFx calm={screen === 'paused' || screen === 'gameover' || panel !== null} />
      </main>
    </MotionConfig>
  );
}
