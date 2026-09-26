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
import type { BannerKind, GameEvent, GameState, Loadout, RunResult, Screen, Settings, Viewport } from '../game/types';
import { computeViewport, screenToWorldX, worldToScreen } from '../game/viewport';
import { BANNER_SLOT, type BannerSlot } from './hud/constants';
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
  /** Итог забега — ровно один раз на каждый runId: либо здесь, либо в onRunAbandoned. */
  onGameOver(result: RunResult): void;
  /**
   * Забег оборвался без гибели: «Заново» или «В меню» из паузы (unload = false)
   * либо уход со страницы (unload = true). Итог — чтобы заработанное не пропало;
   * пустой забег (ни очков, ни кристаллов) не сообщается.
   */
  onRunAbandoned(result: RunResult, unload: boolean): void;
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
/**
 * Сколько секунд холст ещё живёт под экраном Game Over. Экран размывает фон
 * (backdrop-filter), и размытие пересчитывается при каждой смене картинки под
 * ним, поэтому после въезда карточки фон замирает стоп-кадром.
 */
const OVER_LIVE = 0.8;
/** Баннер комбо — только для «весомых» множителей, иначе он мелькает каждые 3 сферы. */
const COMBO_BANNER_FROM = 4;
/** Сколько горит «NEW RECORD!»: салют отыгрывает за ~1 с, дольше надпись лишь закрывает верх поля. */
const RECORD_BANNER_MS = 2200;

/** Подпись SHIELD DOWN; сгоревший при ударе множитель дописывается сюда же. */
function shieldNote(chargesLeft: number, lostMultiplier: number): string {
  const lost = lostMultiplier >= 2;
  const shield = chargesLeft > 0 ? `зарядов щита: ${chargesLeft}` : lost ? 'щит принял удар' : 'щит принял удар на себя';
  return lost ? `${shield} · x${lostMultiplier} сгорел` : shield;
}

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

/** Статистика идущего забега по его событиям — для итога забега, прерванного без гибели. */
interface RunTally {
  collected: number;
  maxMultiplier: number;
  maxChain: number;
  nearMisses: number;
}

function emptyTally(): RunTally {
  return { collected: 0, maxMultiplier: 1, maxChain: 0, nearMisses: 0 };
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
  private tally: RunTally = emptyTally();

  // Баннеры: последний на каждой полке и заряды щита для подписи SHIELD DOWN.
  private readonly slotBanner: Record<BannerSlot, number> = { top: 0, mid: 0, low: 0 };
  private shieldLeft = 0;

  // HUD и FPS.
  private hudClock = 0;
  /** Сколько секунд уже открыт экран Game Over. */
  private overTime = 0;
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
    window.addEventListener('pagehide', this.onPageHide);

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
    window.removeEventListener('pagehide', this.onPageHide);
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
      // «В меню» из паузы: забег ещё идёт — сдать его итог до демо-сцены.
      this.bankRun(false);
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
    // «Заново» из паузы: прежний забег ещё в движке и в this.runId — сдать его итог.
    this.bankRun(false);
    this.runId = runId;
    this.tally = emptyTally();
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

  /**
   * Забег обрывается без гибели: итог уходит наверх, чтобы кристаллы, рекорд и
   * запись в таблице не пропали. Каждый забег сообщается ровно один раз — здесь
   * или событием gameOver; закончившийся забег сюда уже не попадает.
   */
  private bankRun(unload: boolean): void {
    const engine = this.core?.engine;
    const state = engine?.state;
    if (!engine || !state || this.runId === 0 || this.reportedRun === this.runId) return;
    if (state.mode !== 'playing' && state.mode !== 'dying') return;
    const result = this.abandonedResult(engine, state);
    // Пустой забег (рестарт на READY) не засчитывается. Он и не помечается
    // сданным: вернувшись из bfcache, такой забег доиграет и сообщит итог сам.
    if (result.score <= 0 && result.crystals <= 0) return;
    this.reportedRun = this.runId;
    this.props.current.onRunAbandoned(result, unload);
  }

  /** Итог прерванного забега: счёт и прочее из снимка HUD, статистика — из событий. */
  private abandonedResult(engine: GameEngine, state: GameState): RunResult {
    const hud = engine.getHud();
    const t = this.tally;
    return {
      score: hud.score,
      level: hud.level,
      speedMult: hud.speedMult,
      crystals: hud.crystals,
      crystalsCollected: t.collected,
      maxMultiplier: t.maxMultiplier,
      maxChain: t.maxChain,
      nearMisses: t.nearMisses,
      duration: hud.elapsed,
      newRecord: hud.newRecord,
      skinId: state.skin.id,
    };
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
    if (this.shouldRender(p.screen, dt)) core.renderer.render(state, { shake: p.settings.screenShake, paused });

    if (p.screen === 'playing') {
      this.hudClock += dt;
      if (this.forceHud || this.hudClock >= HUD_INTERVAL) this.publishHud(core.engine);
    }
  };

  /** Под экраном Game Over фон замирает после въезда карточки (см. OVER_LIVE). */
  private shouldRender(screen: Screen, dt: number): boolean {
    if (screen !== 'gameover') {
      this.overTime = 0;
      return true;
    }
    this.overTime += dt;
    return this.overTime < OVER_LIVE;
  }

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

  /** Баннер на свою полку: прежний баннер той же полки уходит (см. BANNER_SLOT). */
  private showBanner(kind: BannerKind, text: string, sub: string | undefined, ms: number): void {
    const slot = BANNER_SLOT[kind];
    hudStore.dismissBanner(this.slotBanner[slot]);
    this.slotBanner[slot] = hudStore.pushBanner(kind, text, sub, ms);
  }

  private handleEvent(e: GameEvent, state: GameState): void {
    audio.handleEvent(e);
    const p = this.props.current;
    switch (e.type) {
      case 'beat':
        return;
      case 'runStart':
        this.showBanner('ready', 'READY', 'ПРИГОТОВЬТЕСЬ', GAME.startGrace * 1000 + 400);
        break;
      case 'go':
        // GO! встаёт на полку READY и вытесняет его.
        this.showBanner('go', 'GO!', undefined, 950);
        break;
      case 'levelUp':
        this.showBanner('levelUp', `LEVEL ${e.level}`, `SPEED ${formatSpeed(e.speedMult)}`, 2000);
        break;
      case 'newRecord':
        this.showBanner(
          'newRecord',
          'NEW RECORD!',
          state.highscore > 0 ? `прошлый рекорд ${formatNumber(state.highscore)}` : undefined,
          RECORD_BANNER_MS,
        );
        break;
      case 'shieldBreak':
        this.shieldLeft = e.chargesLeft;
        this.showBanner('shield', 'SHIELD DOWN', shieldNote(e.chargesLeft, 0), 1600);
        break;
      case 'comboBreak':
        // Потеря x1 — не событие: баннер только когда сгорел настоящий множитель.
        if (e.lostMultiplier < 2) break;
        if (e.reason === 'hit') {
          // Удар в щит: движок шлёт comboBreak сразу за shieldBreak в том же кадре.
          // Потеря множителя дописывается в SHIELD DOWN — до рендера React видит
          // одну надпись, а не две на одной полке.
          this.showBanner('shield', 'SHIELD DOWN', shieldNote(this.shieldLeft, e.lostMultiplier), 1600);
        } else {
          this.showBanner('comboBreak', 'COMBO BREAK', `x${e.lostMultiplier} сгорел`, 1200);
        }
        break;
      case 'comboUp':
        if (e.multiplier >= COMBO_BANNER_FROM) {
          const max = e.multiplier >= GAME.combo.maxMultiplier;
          this.showBanner('comboUp', `x${e.multiplier}`, max ? 'MAX COMBO' : 'COMBO', 950);
        }
        break;
      case 'collect': {
        const t = this.tally;
        t.collected++;
        if (e.chain > t.maxChain) t.maxChain = e.chain;
        if (e.multiplier > t.maxMultiplier) t.maxMultiplier = e.multiplier;
        break;
      }
      case 'nearMiss':
        this.tally.nearMisses++;
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

  /**
   * Закрытие или перезагрузка вкладки посреди забега: сдать итог, пока
   * страница жива. После возврата из bfcache App уводит в меню — сданный
   * забег не продолжается.
   */
  private readonly onPageHide = (): void => {
    this.bankRun(true);
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
