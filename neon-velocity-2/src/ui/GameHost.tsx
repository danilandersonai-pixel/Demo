/**
 * Холст на весь экран и игровой цикл requestAnimationFrame с фиксированным
 * шагом симуляции (см. SPEC, раздел 1).
 *
 * Симуляция, рендер и ввод создаются один раз на всё время жизни компонента и
 * переживают двойной mount StrictMode: при «размонтировании» снимаются только
 * цикл, наблюдатели и слушатели, при повторном mount всё цепляется обратно.
 * Пропсы цикл читает через ref — смена экрана или настроек его не
 * перезапускает, а React не перерисовывается ни на одном кадре.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../audio/audio';
import { planMove, type BotOptions } from '../core/bot';
import { GAME, toSimLoadout } from '../core/config';
import { randomSeed } from '../core/rng';
import { Simulation } from '../core/sim';
import { LEAD_IN_TICKS, TICK_DT } from '../core/timing';
import type { BannerKind, InputFrame, Loadout, RunResult, Screen, Settings, SimEvent, SimMode, SimState } from '../core/types';
import { debugEnabled, installDebug } from '../debug';
import { InputController } from '../input/input';
import { makeCamera, roadToScreenX, screenToRoadX, type Camera } from '../render/camera';
import { Renderer } from '../render/renderer';
import { BANNER_SHELF, type BannerShelf } from './hud/constants';
import { coarsenHud, FixedStep, shieldNote, withBankedRecord } from './hud/loop';
import { hudPulse, prefersReducedMotion } from './hud/pulse';
import { hudStore } from './hudStore';
import { formatNumber, formatSpeed } from './kit/format';

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Почему забег оборвался без гибели: «Заново», «В меню» или уход со страницы. */
export type AbandonReason = 'restart' | 'menu' | 'unload';

export interface GameHostProps {
  screen: Screen;
  /** Номер забега: каждое новое значение (> 0) начинает забег. */
  runId: number;
  loadout: Loadout;
  settings: Settings;
  /** Забег окончен гибелью — ровно один раз на забег. */
  onGameOver(result: RunResult): void;
  /**
   * Игрок бросил идущий забег. result — итог, который нужно записать, или null,
   * если записывать нечего (пустой забег). Вызывается ровно один раз на
   * брошенный забег; события gameOver после этого не будет. При 'unload'
   * забег мёртв — экран забега нужно покинуть.
   */
  onRunAbandoned(result: RunResult | null, reason: AbandonReason): void;
  /** Корабль взорвался: точка взрыва в CSS-пикселях окна. */
  onDeath(at: ScreenPoint): void;
  /** Вкладка скрыта или окно потеряло фокус посреди забега. */
  onRequestPause(): void;
}

/** Кадр длиннее этого (вкладка спала, отладчик) считается таким. */
const MAX_FRAME_DT = 0.1;
/** HUD публикуется не чаще 30 раз в секунду. */
const HUD_INTERVAL = 1 / 30;
/** Как часто обновлять число FPS (сек) и вес нового кадра в скользящем среднем. */
const FPS_SAMPLE = 0.5;
const FPS_SMOOTHING = 0.08;
/**
 * Сколько секунд мир ещё живёт под экраном Game Over. Экран размывает фон
 * (backdrop-filter), а размытие пересчитывается при каждой смене картинки под
 * ним, поэтому после въезда карточки холст замирает стоп-кадром.
 */
const OVER_LIVE = 0.8;
/** Затемнение при смене сцены (меню ⇄ забег): прячет исчезновение объектов и перенос корабля в центр. */
const VEIL_MS = 420;
/** Сколько событий держит отладочный журнал, если его никто не забирает. */
const LOG_LIMIT = 20_000;

/** Время жизни баннеров, мс. NEW RECORD! — не дольше двух секунд. */
const BANNER_MS = {
  go: 900,
  levelUp: 1900,
  newRecord: 2000,
  shield: 1700,
  comboBreak: 1300,
  comboUp: 900,
  overdrive: 1700,
} as const;
/** Баннер роста комбо — только для весомых множителей: x2 и x3 мелькали бы каждую секунду. */
const COMBO_BANNER_FROM = 4;

function isLive(mode: SimMode): boolean {
  return mode === 'ready' || mode === 'playing' || mode === 'dying';
}

/**
 * Всё императивное хозяйство холста: цикл, размеры, события симуляции. Живёт в
 * useState, поэтому один на компонент; attach / detach идемпотентны.
 */
class HostDriver {
  private readonly sim = new Simulation();
  private readonly input = new InputController();
  private renderer: Renderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private box: HTMLElement | null = null;
  private veil: HTMLElement | null = null;

  private camera: Camera = makeCamera(1, 1, 1);
  private rectLeft = 0;
  private rectTop = 0;
  private cssW = 0;
  private cssH = 0;
  private dpr = 0;
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;

  private raf = 0;
  /** Время прошлого кадра, сек; 0 — следующий кадр не должен «догонять» простой. */
  private last = 0;
  private readonly stepper = new FixedStep();
  private overTime = 0;

  /** Экран, под который настроены ввод, звук и сцена; null — ещё ни один. */
  private screen: Screen | null = null;
  private runId = 0;
  /** Снаряжение идущего забега: чужая вкладка не переоденет корабль посреди игры. */
  private runLoadout: Loadout | null = null;

  // Баннеры: последний на каждой полке; тик и остаток зарядов последнего удара в щит.
  private readonly shelfBanner: Record<BannerShelf, number> = { top: 0, mid: 0, low: 0 };
  private shieldTick = Number.NEGATIVE_INFINITY;
  private shieldLeft = 0;

  // HUD и FPS.
  private hudClock = 0;
  private forceHud = false;
  private frameAvg = 1 / 60;
  private fpsClock = 0;
  private fps = 0;

  // Отладка.
  private override: ((state: SimState) => InputFrame) | null = null;
  private log: SimEvent[] = [];
  private logging = false;
  private uninstallDebug: (() => void) | null = null;
  private ticks = 0;
  private frames = 0;

  private readonly props: { readonly current: GameHostProps };

  constructor(props: { readonly current: GameHostProps }) {
    this.props = props;
  }

  attach(box: HTMLElement, canvas: HTMLCanvasElement, veil: HTMLElement): void {
    // Повторный attach без detach не должен запустить второй цикл.
    if (this.box) this.detach();
    this.box = box;
    this.veil = veil;
    if (!this.renderer || this.canvas !== canvas) {
      this.canvas = canvas;
      this.renderer = new Renderer(canvas);
      this.cssW = 0;
    }
    this.input.attach(canvas, this.toRoadX);
    this.input.setEnabled(this.props.current.screen === 'playing');

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(box);
    }
    // Запасной путь и смена безопасных зон при повороте: размер бокса мог не измениться.
    window.addEventListener('resize', this.onResize);
    this.watchDpr();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pagehide', this.onPageHide);

    this.logging = debugEnabled();
    this.uninstallDebug = installDebug({
      sim: this.sim,
      screen: () => this.props.current.screen,
      camera: () => this.camera,
      setInput: (fn) => {
        this.override = fn;
      },
      autopilot: (on: boolean, options?: BotOptions) => {
        this.override = on ? (state) => planMove(state, options) : null;
      },
      takeEvents: () => {
        const taken = this.log;
        this.log = [];
        return taken;
      },
      counters: () => ({ ticks: this.ticks, frames: this.frames }),
    });

    // Пока были отцеплены (StrictMode, горячая перезагрузка), размер окна мог измениться.
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
    this.uninstallDebug?.();
    this.uninstallDebug = null;
    this.input.detach();
    // Кэши рендера освобождаются, сам он остаётся рабочим: следующий кадр построит их заново.
    this.renderer?.dispose();
    this.box = null;
    this.veil = null;
  }

  /** Смена экрана приложения: ввод, пауза звука, фоновая сцена меню. Повтор с тем же экраном — пустой. */
  applyScreen(screen: Screen): void {
    const prev = this.screen;
    if (screen === prev) return;
    this.screen = screen;
    this.input.setEnabled(screen === 'playing');

    if (screen === 'menu') {
      // «В меню» из паузы: забег ещё идёт — сдать его итог до фоновой сцены.
      this.endRun('menu');
      this.runLoadout = null;
      audio.setMusicActive(false);
      audio.setPaused(false);
      hudStore.clearBanners();
      this.sim.startAttract(randomSeed());
      this.beginScene();
      return;
    }

    audio.setPaused(screen === 'paused');
    if (screen === 'gameover') this.overTime = 0;
    if (screen === 'playing') {
      // После паузы первый кадр не «догоняет» простой, а вступление снова подписано.
      this.last = 0;
      if (prev === 'paused') this.restoreReadyBanner();
    }
  }

  /** Новый забег. Повторный вызов с тем же номером ничего не делает (StrictMode). */
  startRun(runId: number): void {
    if (runId <= 0 || runId === this.runId) return;
    // «Заново» из паузы: прежний забег ещё идёт — сдать его итог.
    const banked = this.endRun('restart');
    this.runId = runId;
    const loadout = withBankedRecord(this.props.current.loadout, banked);
    this.runLoadout = loadout;
    hudStore.clearBanners();
    this.sim.startRun(randomSeed(), toSimLoadout(loadout));
    this.input.reset();
    audio.setPaused(false);
    audio.setMusicActive(true);
    this.beginScene();
    // HUD с первого кадра показывает новый забег — без счёта прошлого.
    this.publishHud();
  }

  /**
   * Игрок бросает идущий забег. Симуляция отдаёт итог один раз и сама
   * переводит забег в over, поэтому каждый забег сообщается наверх ровно
   * однажды — здесь или событием gameOver.
   */
  private endRun(reason: AbandonReason): RunResult | null {
    if (!isLive(this.sim.state.mode)) return null;
    const result = this.sim.abandon();
    this.props.current.onRunAbandoned(result, reason);
    return result;
  }

  /** Общее начало сцены (забег или фон меню): чистая косметика и ровный первый кадр. */
  private beginScene(): void {
    this.renderer?.reset();
    this.stepper.reset();
    this.last = 0;
    this.hudClock = 0;
    this.shieldTick = Number.NEGATIVE_INFINITY;
    const veil = this.veil;
    if (veil && typeof veil.animate === 'function') {
      veil.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: prefersReducedMotion() ? VEIL_MS / 2 : VEIL_MS, easing: 'ease-out' });
    }
  }

  // ─── Цикл ─────────────────────────────────────────────────────────────────

  private readonly frame = (nowMs: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const renderer = this.renderer;
    if (!renderer) return;
    const now = nowMs / 1000;
    const dt = this.last > 0 ? Math.min(Math.max(0, now - this.last), MAX_FRAME_DT) : 0;
    this.last = now;
    this.measureFps(dt);

    const screen = this.props.current.screen;
    if (screen === 'paused') {
      // Тики стоят; рендер сам не перерисовывает неизменившийся кадр паузы.
      this.draw(renderer, now, true);
      return;
    }
    if (screen === 'gameover') {
      this.overTime += dt;
      if (this.overTime >= OVER_LIVE) return;
    }

    this.advance(dt);
    this.draw(renderer, now, false);
    this.frames++;

    if (screen === 'playing') {
      this.hudClock += dt;
      if (this.forceHud || this.hudClock >= HUD_INTERVAL) this.publishHud();
    }
  };

  /** Просчитать тики кадра и разобрать их события. */
  private advance(dt: number): void {
    const sim = this.sim;
    const state = sim.state;
    this.ticks += this.stepper.advance(dt, state, this.stepOnce);
    const events = sim.drainEvents();
    for (let i = 0; i < events.length; i++) this.handleEvent(events[i], state);
  }

  private readonly stepOnce = (): void => {
    const state = this.sim.state;
    // Подмена ввода (отладка, бот) действует только пока кораблём можно управлять.
    const pilot = state.mode === 'ready' || state.mode === 'playing' ? this.override : null;
    this.sim.step(pilot ? pilot(state) : this.input.frame());
  };

  private draw(renderer: Renderer, now: number, paused: boolean): void {
    const p = this.props.current;
    const loadout = this.runLoadout ?? p.loadout;
    renderer.render({
      state: this.sim.state,
      alpha: this.stepper.alpha,
      theme: loadout.theme,
      skin: loadout.skin,
      now,
      paused,
      shake: p.settings.screenShake,
      reducedMotion: prefersReducedMotion(),
    });
  }

  private measureFps(dt: number): void {
    if (dt <= 0 || dt >= MAX_FRAME_DT) return;
    this.frameAvg += (dt - this.frameAvg) * FPS_SMOOTHING;
    this.fpsClock += dt;
    if (this.fpsClock >= FPS_SAMPLE) {
      this.fpsClock = 0;
      this.fps = Math.round(1 / this.frameAvg);
    }
  }

  private publishHud(): void {
    this.hudClock = 0;
    this.forceHud = false;
    const fps = this.props.current.settings.showFps ? this.fps : 0;
    hudStore.setSnapshot(coarsenHud(this.sim.hud(), fps, this.sim.state.player.alive));
  }

  // ─── События симуляции ────────────────────────────────────────────────────

  /** Баннер на свою полку: прежний баннер той же полки уходит. */
  private showBanner(kind: BannerKind, text: string, sub: string | undefined, ms: number): void {
    const shelf = BANNER_SHELF[kind];
    hudStore.dismissBanner(this.shelfBanner[shelf]);
    this.shelfBanner[shelf] = hudStore.pushBanner(kind, text, sub, ms);
  }

  private showReady(ticksLeft: number): void {
    this.showBanner('ready', 'READY', 'ПРИГОТОВЬТЕСЬ', ticksLeft * TICK_DT * 1000 + 250);
  }

  /** Баннер READY живёт по настоящим часам и мог погаснуть за время паузы, а вступление ещё идёт. */
  private restoreReadyBanner(): void {
    const state = this.sim.state;
    if (state.mode !== 'ready') return;
    if (hudStore.getBanners().some((b) => b.kind === 'ready')) return;
    this.showReady(-state.tick);
  }

  private handleEvent(e: SimEvent, state: SimState): void {
    // Сколько секунд назад (по часам симуляции) случилось событие: звук встаёт точно в сетку.
    audio.onEvent(e, (state.tick - e.tick + this.stepper.alpha) * TICK_DT);
    this.renderer?.onEvent(e, state);
    if (this.logging) {
      if (this.log.length >= LOG_LIMIT) this.log.splice(0, LOG_LIMIT / 2);
      this.log.push(e);
    }
    // Фоновая сцена меню шлёт только доли: HUD и баннеров у неё нет.
    if (state.mode === 'attract') return;
    // Любое событие забега меняет цифры HUD — показать их в этом же кадре.
    this.forceHud = true;
    const p = this.props.current;

    switch (e.type) {
      case 'beat':
        hudPulse.emit(e);
        break;
      case 'ready':
        this.showReady(LEAD_IN_TICKS);
        break;
      case 'go':
        // GO! встаёт на полку READY и вытесняет его.
        this.showBanner('go', 'GO!', undefined, BANNER_MS.go);
        break;
      case 'levelUp':
        this.showBanner('levelUp', `LEVEL ${e.level}`, `SPEED ${formatSpeed(e.speedMult)}`, BANNER_MS.levelUp);
        break;
      case 'newRecord':
        this.showBanner('newRecord', 'NEW RECORD!', `прошлый рекорд ${formatNumber(state.highscore)}`, BANNER_MS.newRecord);
        break;
      case 'shieldBreak':
        this.shieldTick = e.tick;
        this.shieldLeft = e.left;
        this.showBanner('shield', 'SHIELD DOWN', shieldNote(e.left, 0), BANNER_MS.shield);
        break;
      case 'comboBreak':
        // Потеря x1 — не событие: баннер только когда сгорел настоящий множитель.
        if (e.lost < 2) break;
        if (e.reason === 'hit' && e.tick === this.shieldTick) {
          // Удар в щит: comboBreak приходит сразу за shieldBreak на том же тике. Потеря
          // множителя дописывается в SHIELD DOWN — на полке остаётся одна надпись, а не две.
          this.showBanner('shield', 'SHIELD DOWN', shieldNote(this.shieldLeft, e.lost), BANNER_MS.shield);
        } else {
          this.showBanner('comboBreak', 'COMBO BREAK', `x${e.lost} сгорел`, BANNER_MS.comboBreak);
        }
        break;
      case 'comboUp':
        // Максимум отмечает баннер OVERDRIVE — он приходит тем же тиком на ту же полку.
        if (e.multiplier >= COMBO_BANNER_FROM && e.multiplier < GAME.combo.maxMultiplier) {
          this.showBanner('comboUp', `x${e.multiplier}`, 'combo', BANNER_MS.comboUp);
        }
        break;
      case 'overdrive':
        if (e.on) this.showBanner('overdrive', 'OVERDRIVE', `очки ×${GAME.combo.overdriveBonus}`, BANNER_MS.overdrive);
        break;
      case 'death':
        p.onDeath({ x: this.rectLeft + roadToScreenX(this.camera, e.x), y: this.rectTop + this.camera.lineY });
        break;
      case 'gameOver':
        p.onGameOver(e.result);
        break;
      default:
        break;
    }
  }

  // ─── Размеры и окно ───────────────────────────────────────────────────────

  private readonly onResize = (): void => {
    const box = this.box;
    const renderer = this.renderer;
    if (!box || !renderer) return;
    const rect = box.getBoundingClientRect();
    this.rectLeft = rect.left;
    this.rectTop = rect.top;
    const cssW = rect.width || window.innerWidth;
    const cssH = rect.height || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    if (cssW === this.cssW && cssH === this.cssH && dpr === this.dpr) return;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    // Размер — дело только камеры: симуляцию он не касается.
    this.camera = renderer.resize(cssW, cssH, dpr);
    // Смена размера очищает холст — перерисовать сразу, не дожидаясь кадра: под
    // Game Over цикл уже не рисует, а пустой кадр мигнул бы и в забеге.
    this.draw(renderer, performance.now() / 1000, this.props.current.screen === 'paused');
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

  private readonly toRoadX = (clientX: number): number => screenToRoadX(this.camera, clientX - this.rectLeft);

  private readonly onVisibility = (): void => {
    if (document.hidden) this.requestPause();
    else this.last = 0;
  };

  private readonly onBlur = (): void => {
    this.requestPause();
  };

  private requestPause(): void {
    const p = this.props.current;
    if (p.screen === 'playing') p.onRequestPause();
  }

  /**
   * Закрытие или перезагрузка вкладки посреди забега: сдать итог, пока страница
   * жива. Забег после этого мёртв (gameOver уже не придёт), поэтому наверх
   * сообщается и пустой итог — вернувшись из bfcache, игра должна стоять в меню.
   */
  private readonly onPageHide = (): void => {
    this.endRun('unload');
  };
}

/** Игровое поле: полноэкранный холст (слой z-0), всегда смонтирован. */
export function GameHost(props: GameHostProps) {
  const { screen, runId } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  const [driver] = useState(() => new HostDriver(propsRef));

  // Первым делом — свежие пропсы для цикла и для эффектов ниже.
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  useLayoutEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    const veil = veilRef.current;
    if (!box || !canvas || !veil) return;
    driver.attach(box, canvas, veil);
    return () => driver.detach();
  }, [driver]);

  useLayoutEffect(() => {
    driver.applyScreen(screen);
  }, [driver, screen]);

  // После applyScreen: при «Ещё раз» экран и номер забега меняются в одном коммите.
  useLayoutEffect(() => {
    driver.startRun(runId);
  }, [driver, runId]);

  return (
    <div ref={boxRef} className="fixed inset-0 z-0 overflow-hidden bg-void">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          screen === 'menu'
            ? 'Фоновая сцена Neon Velocity: неоновая трасса уходит к горизонту'
            : 'Игровое поле Neon Velocity: корабль на трассе уворачивается от кубов, пил и лазеров и собирает энергетические сферы'
        }
        className="absolute left-0 top-0 block h-full w-full"
      />
      <div ref={veilRef} aria-hidden className="pointer-events-none absolute inset-0 bg-void opacity-0" />
    </div>
  );
}
