/**
 * Холст на весь экран и игровой цикл requestAnimationFrame.
 *
 * Движок, рендер и ввод создаются один раз на всё время жизни компонента и
 * переживают двойной mount в StrictMode: при «размонтировании» снимаются только
 * цикл, наблюдатели и слушатели, а при повторном mount всё цепляется обратно.
 * Пропсы читаются внутри цикла через ref — смена экрана или настроек не
 * перезапускает цикл, а React не перерисовывается на каждом кадре.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../game/audio';
import { GAME } from '../game/config';
import { GameEngine } from '../game/engine';
import { hudStore } from '../game/hudStore';
import { InputController } from '../game/input';
import { Renderer } from '../game/renderer';
import type { GameEvent, GameState, Loadout, RunResult, Screen, Settings, Viewport } from '../game/types';
import { computeViewport, screenToWorldX, worldToScreen } from '../game/viewport';
import { formatNumber, formatSpeed } from './ui/format';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface GameCanvasProps {
  screen: Screen;
  /** Номер забега: каждое новое значение (> 0) запускает engine.startRun. */
  runId: number;
  loadout: Loadout;
  settings: Settings;
  /** Итог забега — ровно один раз на каждый runId. */
  onGameOver(result: RunResult): void;
  /** Корабль взорвался: точка взрыва в CSS-пикселях экрана. */
  onDeath(at: ScreenPoint): void;
  /** Вкладка скрыта или окно потеряло фокус посреди забега. */
  onRequestPause(): void;
}

/** HUD обновляется не чаще 30 раз в секунду. */
const HUD_INTERVAL = 1 / 30;
/** Как часто обновлять число FPS на экране (сек) — иначе оно рябит. */
const FPS_SAMPLE = 0.5;
/** Кадры длиннее этого (сворачивание вкладки, отладчик) не портят среднее FPS. */
const FPS_MAX_DT = 0.25;
/** Вес нового кадра в скользящем среднем длительности кадра. */
const FPS_SMOOTHING = 0.08;
/** Баннер комбо — только для «весомых» множителей, иначе он мелькает каждые 3 сферы. */
const COMBO_BANNER_FROM = 4;

let fontsRequested = false;

/** Шрифт Orbitron нужен холсту до первой всплывашки — просим браузер загрузить его заранее. */
function requestFonts(): void {
  if (fontsRequested || typeof document === 'undefined' || !document.fonts) return;
  fontsRequested = true;
  for (const spec of ['700 32px "Orbitron"', '900 32px "Orbitron"']) {
    // Неудача не критична: холст нарисует текст запасным моноширинным шрифтом.
    document.fonts.load(spec).catch(() => undefined);
  }
}

interface Core {
  canvas: HTMLCanvasElement;
  engine: GameEngine;
  renderer: Renderer;
  input: InputController;
}

/**
 * Всё императивное хозяйство холста: цикл, размеры, события движка. Живёт в
 * useState, поэтому один на компонент; attach/detach идемпотентны.
 */
class GameDriver {
  private core: Core | null = null;
  private box: HTMLElement | null = null;
  private viewport: Viewport | null = null;
  private rectLeft = 0;
  private raf = 0;
  private last = 0;
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;

  // Забег: какой идёт и о каком уже сообщили наверх.
  private runId = 0;
  private reportedRun = 0;
  private diedRun = 0;
  private readyBanner = 0;

  // HUD и FPS.
  private hudClock = 0;
  private forceHud = false;
  private frameAvg = 1 / 60;
  private fpsClock = 0;
  private fps = 0;

  private readonly props: { readonly current: GameCanvasProps };

  constructor(props: { readonly current: GameCanvasProps }) {
    this.props = props;
  }

  attach(box: HTMLElement, canvas: HTMLCanvasElement): void {
    // Повторный attach без detach не должен запустить второй цикл.
    if (this.box) this.detach();
    this.box = box;
    requestFonts();
    if (!this.core || this.core.canvas !== canvas) {
      const vp = this.measure(box);
      this.viewport = vp;
      const renderer = new Renderer(canvas);
      renderer.resize(vp);
      this.core = {
        canvas,
        engine: new GameEngine(vp, this.props.current.loadout),
        renderer,
        input: new InputController(),
      };
    }
    const { input } = this.core;
    input.attach(canvas, this.toWorldX);
    input.setEnabled(this.props.current.screen === 'playing');

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(box);
    } else {
      window.addEventListener('resize', this.onResize);
    }
    this.watchDpr();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);

    // Пока были отцеплены (StrictMode, HMR), размер окна мог измениться.
    this.onResize();
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.onResize);
    this.unwatchDpr();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
    if (this.core) {
      this.core.input.detach();
      this.core.renderer.dispose();
    }
    this.box = null;
  }

  /** Смена экрана приложения: ввод, пауза звука, демо-сцена в меню. */
  applyScreen(screen: Screen): void {
    const core = this.core;
    if (!core) return;
    core.input.setEnabled(screen === 'playing');
    if (screen !== 'playing') core.input.reset();
    audio.setPaused(screen === 'paused');
    if (screen === 'menu') {
      if (core.engine.state) {
        core.engine.setLoadout(this.props.current.loadout);
        core.engine.enterAttract();
      }
      audio.setMusicActive(false);
      hudStore.clearBanners();
    }
    // После паузы первый кадр не должен «догонять» простой.
    if (screen === 'playing') this.last = 0;
  }

  /** Новый забег. Повторный вызов с тем же номером ничего не делает (StrictMode). */
  startRun(runId: number): void {
    if (runId <= 0 || runId === this.runId) return;
    const core = this.core;
    if (!core || !core.engine.state) return;
    this.runId = runId;
    hudStore.clearBanners();
    core.engine.startRun(this.props.current.loadout);
    core.input.reset();
    audio.setPaused(false);
    audio.setMusicActive(true);
    this.last = 0;
    this.hudClock = 0;
    // HUD сразу показывает новый забег — без кадра со счётом прошлого.
    this.publishHud(core.engine);
  }

  /** Живое превью покупок в меню: тема и корабль меняются без перезапуска сцены. */
  setLoadout(loadout: Loadout): void {
    const engine = this.core?.engine;
    if (engine?.state) engine.setLoadout(loadout);
  }

  // ─── Цикл ─────────────────────────────────────────────────────────────────

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const core = this.core;
    if (!core) return;
    const state = core.engine.state;
    if (!state) return;

    const dt = this.last > 0 ? Math.max(0, (now - this.last) / 1000) : 0;
    this.last = now;
    this.measureFps(dt);

    const p = this.props.current;
    const paused = p.screen === 'paused';
    if (!paused) {
      core.engine.setInput(core.input.getState());
      core.engine.update(dt);
      const events = core.engine.drainEvents();
      for (let i = 0; i < events.length; i++) this.handleEvent(events[i], state);
    }
    core.renderer.render(state, { shake: p.settings.screenShake, paused });

    if (p.screen === 'playing') {
      this.hudClock += dt;
      if (this.forceHud || this.hudClock >= HUD_INTERVAL) this.publishHud(core.engine);
    }
  };

  private measureFps(dt: number): void {
    if (dt <= 0 || dt > FPS_MAX_DT) return;
    this.frameAvg += (dt - this.frameAvg) * FPS_SMOOTHING;
    this.fpsClock += dt;
    if (this.fpsClock >= FPS_SAMPLE) {
      this.fpsClock = 0;
      this.fps = Math.round(1 / this.frameAvg);
    }
  }

  private publishHud(engine: GameEngine): void {
    this.hudClock = 0;
    this.forceHud = false;
    const snapshot = engine.getHud();
    if (!snapshot) return;
    snapshot.fps = this.fps;
    hudStore.setSnapshot(snapshot);
  }

  // ─── События движка ───────────────────────────────────────────────────────

  private handleEvent(e: GameEvent, state: GameState): void {
    audio.handleEvent(e);
    const p = this.props.current;
    switch (e.type) {
      case 'beat':
        return;
      case 'runStart':
        this.readyBanner = hudStore.pushBanner('ready', 'READY', 'ГОТОВЬСЯ', GAME.startGrace * 1000 + 400);
        break;
      case 'go':
        hudStore.dismissBanner(this.readyBanner);
        hudStore.pushBanner('go', 'GO!', undefined, 950);
        break;
      case 'levelUp':
        hudStore.pushBanner('levelUp', `LEVEL ${e.level}`, `SPEED ${formatSpeed(e.speedMult)}`, 2000);
        break;
      case 'newRecord':
        hudStore.pushBanner(
          'newRecord',
          'NEW RECORD!',
          state.highscore > 0 ? `прошлый рекорд ${formatNumber(state.highscore)}` : undefined,
          2900,
        );
        break;
      case 'shieldBreak':
        hudStore.pushBanner(
          'shield',
          'SHIELD DOWN',
          e.chargesLeft > 0 ? `зарядов щита: ${e.chargesLeft}` : 'щит принял удар на себя',
          1600,
        );
        break;
      case 'comboBreak':
        // Потеря x1 — не событие: баннер только когда сгорел настоящий множитель.
        if (e.lostMultiplier >= 2) hudStore.pushBanner('comboBreak', 'COMBO BREAK', `x${e.lostMultiplier} сгорел`, 1200);
        break;
      case 'comboUp':
        if (e.multiplier >= COMBO_BANNER_FROM) {
          const max = e.multiplier >= GAME.combo.maxMultiplier;
          hudStore.pushBanner('comboUp', `x${e.multiplier}`, max ? 'MAX COMBO' : 'COMBO', 950);
        }
        break;
      case 'collect':
      case 'nearMiss':
        break;
      case 'death':
        if (this.diedRun !== this.runId) {
          this.diedRun = this.runId;
          p.onDeath(worldToScreen(state.viewport, e.x, e.y));
        }
        break;
      case 'gameOver':
        if (this.reportedRun !== this.runId) {
          this.reportedRun = this.runId;
          audio.setMusicActive(false);
          p.onGameOver(e.result);
        }
        return;
    }
    // Важные события HUD показывает сразу, не дожидаясь очередного тика.
    this.forceHud = true;
  }

  // ─── Размеры и окно ───────────────────────────────────────────────────────

  private measure(box: HTMLElement): Viewport {
    const rect = box.getBoundingClientRect();
    this.rectLeft = rect.left;
    return computeViewport(rect.width || window.innerWidth, rect.height || window.innerHeight, window.devicePixelRatio || 1);
  }

  private readonly onResize = (): void => {
    const core = this.core;
    if (!core || !this.box) return;
    const vp = this.measure(this.box);
    const old = this.viewport;
    if (old && old.cssW === vp.cssW && old.cssH === vp.cssH && old.dpr === vp.dpr) return;
    this.viewport = vp;
    core.renderer.resize(vp);
    const state = core.engine.state;
    if (!state) return;
    core.engine.resize(vp);
    // Смена размера очищает холст — перерисовать сразу, чтобы не мигнул пустой кадр.
    const p = this.props.current;
    core.renderer.render(state, { shake: p.settings.screenShake, paused: p.screen === 'paused' });
  };

  /** Перенос окна на другой монитор меняет devicePixelRatio без смены размера. */
  private watchDpr(): void {
    this.unwatchDpr();
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query.addEventListener('change', this.onDprChange);
    this.dprQuery = query;
  }

  private unwatchDpr(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
  }

  private readonly onDprChange = (): void => {
    this.onResize();
    this.watchDpr();
  };

  private readonly toWorldX = (clientX: number): number => {
    const vp = this.viewport;
    return vp ? screenToWorldX(vp, clientX - this.rectLeft) : 0;
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.requestPause();
    else this.last = 0;
  };

  private readonly onBlur = (): void => {
    this.requestPause();
  };

  private requestPause(): void {
    this.core?.input.reset();
    const p = this.props.current;
    if (p.screen === 'playing') p.onRequestPause();
  }
}

/** Игровое поле: полноэкранный холст (слой z-0), всегда смонтирован. */
export function GameCanvas(props: GameCanvasProps) {
  const { screen, runId, loadout } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const [driver] = useState(() => new GameDriver(propsRef));

  // Первым делом — свежие пропсы для цикла и для эффектов ниже.
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  useLayoutEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    driver.attach(box, canvas);
    return () => driver.detach();
  }, [driver]);

  useLayoutEffect(() => {
    driver.applyScreen(screen);
  }, [driver, screen]);

  // После applyScreen: при «Ещё раз» экран и номер забега меняются в одном коммите.
  useLayoutEffect(() => {
    driver.startRun(runId);
  }, [driver, runId]);

  useLayoutEffect(() => {
    if (screen === 'menu') driver.setLoadout(loadout);
  }, [driver, loadout, screen]);

  return (
    <div ref={boxRef} className="fixed inset-0 z-0 overflow-hidden bg-void">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          screen === 'menu'
            ? 'Демо-сцена Neon Velocity: неоновая трасса с перспективной сеткой'
            : 'Игровое поле Neon Velocity: корабль внизу уворачивается от кубов, пил и лазеров и собирает энергетические сферы'
        }
        className="absolute left-0 top-0 block h-full w-full"
      />
    </div>
  );
}
