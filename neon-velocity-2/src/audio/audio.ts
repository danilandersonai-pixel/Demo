/**
 * Звуковой движок: процедурный синтвейв и эффекты на Web Audio API, без файлов.
 *
 * AudioContext создаётся только в unlock() из жеста пользователя (модуль сам ловит
 * первый жест на странице, чтобы звучало и меню). До этого все методы безопасно
 * ничего не делают, а настройки и состояние забега просто запоминаются.
 *
 * Музыкой управляет игра: доли симуляции встают в сетку (clock.ts), секвенсор
 * (music.ts) раскладывает их на слои по множителю комбо (arrangement.ts), сферы
 * играют мелодию в текущем аккорде (harmony.ts). Граф и голоса — mixer.ts,
 * эффекты — sfx.ts.
 */
import { GAME, WORLD } from '../core/config';
import { clamp } from '../core/math';
import { LEAD_IN_TICKS, TICK_DT, TICKS_PER_STEP } from '../core/timing';
import type { SimEvent } from '../core/types';
import { BeatGrid, measuredTime } from './clock';
import { chordAtTick, levelRootChord, melodyNote, sparkleNotes } from './harmony';
import { Mixer, type MixerStats, type Voice } from './mixer';
import { MIN_LEAD, Music, type Probe } from './music';
import {
  sfxCollect,
  sfxCollectRare,
  sfxComboBreak,
  sfxComboUp,
  sfxCount,
  sfxDeath,
  sfxGameOver,
  sfxGo,
  sfxLevelUp,
  sfxMiss,
  sfxNearMiss,
  sfxNewRecord,
  sfxOverdrive,
  sfxReady,
  sfxShieldBreak,
  sfxUi,
} from './sfx';
import { setUiSoundHandler, type UiSound } from './uiSound';

export interface AudioSettings {
  enabled: boolean;
  /** 0..1 */
  music: number;
  /** 0..1 */
  sfx: number;
}

/** Диагностика движка — для отладки и автотестов в браузере. */
export interface AudioStats extends MixerStats {
  /** Состояние контекста; 'locked' — unlock() ещё не было. */
  state: AudioContextState | 'locked';
  /** Сетка долей привязана к часам контекста. */
  gridLocked: boolean;
  multiplier: number;
  overdrive: boolean;
  /** Забег окончен (гибель): музыка молчит до следующего ready. */
  dead: boolean;
}

/** Запас планирования эффектов «сейчас», чтобы атака не срезалась. */
const SFX_LEAD = 0.006;
/** Музыка затухает при гибели за столько секунд. */
const DEATH_FADE = 1.4;
/** Сколько сфер могут прозвучать в одной шестнадцатой (магнит собирает пачками). */
const COLLECTS_PER_STEP = 2;
/**
 * Сколько миллисекунд после запроса resume() звук планируется в ещё не запущенный контекст:
 * его часы стоят, и запланированное сыграет в момент запуска — первый щелчок и первая доля
 * не теряются. Дольше ждать нельзя: накопившееся прозвучало бы разом.
 */
const RESUME_GRACE_MS = 500;

/** Сколько запросов звука держать, пока строится граф, и сколько секунд они остаются к месту. */
const PENDING_MAX = 48;
const PENDING_MAX_AGE = 0.4;

/** Звук, запрошенный между жестом и готовностью графа. waited — сколько секунд он прождал. */
interface Pending {
  at: number;
  play: (waited: number) => void;
}

/** Минимальные интервалы между повторами одного звука, сек. */
const MIN_GAP = {
  hover: 0.05,
  miss: 0.05,
  nearMiss: 0.07,
  comboBreak: 0.12,
  comboUp: 0.06,
} as const;
type Throttled = keyof typeof MIN_GAP;

/** События, по которым браузер разрешает запуск звука (активация пользователем). */
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'] as const;

/** Шаг подготовки микшера ждёт свободного времени главного потока не дольше, мс. */
const WARM_UP_TIMEOUT = 50;

/** Выполнить fn отдельной задачей в свободное время главного потока (но не позже WARM_UP_TIMEOUT). */
function whenIdle(fn: () => void): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(fn, { timeout: WARM_UP_TIMEOUT });
  } else {
    // Safari без requestIdleCallback: сразу после ближайшего кадра.
    window.requestAnimationFrame(() => window.setTimeout(fn, 0));
  }
}

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const legacy = (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return window.AudioContext ?? legacy ?? null;
}

/** Был ли на странице жест пользователя: без него браузер создаст «спящий» контекст и выругается в консоль. */
function hasUserActivation(): boolean {
  if (typeof navigator === 'undefined' || !('userActivation' in navigator)) return true;
  return navigator.userActivation.hasBeenActive;
}

function sanitize(s: AudioSettings, fallback: AudioSettings): AudioSettings {
  const vol = (x: number, d: number) => (Number.isFinite(x) ? clamp(x, 0, 1) : d);
  return { enabled: Boolean(s.enabled), music: vol(s.music, fallback.music), sfx: vol(s.sfx, fallback.sfx) };
}

/** X на дороге → панорама: звук идёт с той стороны, где это случилось. */
function panFor(x: number): number {
  return Number.isFinite(x) ? clamp((x / WORLD.roadW) * 2 - 1, -1, 1) * 0.6 : 0;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private mix: Mixer | null = null;
  private music: Music | null = null;
  private readonly grid = new BeatGrid();
  private settings: AudioSettings = { enabled: true, music: 0.7, sfx: 0.8 };
  private musicActive = false;
  private paused = false;

  // Состояние забега — ведётся по событиям всегда, даже пока звук не разблокирован.
  private multiplier = 1;
  private overdrive = false;
  /** Корабль взорван: доли продолжают приходить, но музыка молчит до следующего ready. */
  private dead = false;

  /** «Зарядка» вступления — обрывается, если забег бросили до GO. */
  private readyVoice: Voice | null = null;
  /** Шестнадцатая, в которую прозвучала последняя сфера, и сколько сфер в ней уже было. */
  private collectStep = Number.NEGATIVE_INFINITY;
  private collectCount = 0;
  private readonly lastPlayed: Record<Throttled, number> = { hover: -1, miss: -1, nearMiss: -1, comboBreak: -1, comboUp: -1 };
  /** Звук переключили в этой вкладке — ближайший setSettings подтвердит включение щелчком. */
  private confirmNextToggle = false;
  /** Когда последний раз просили контекст запуститься (performance.now()). */
  private resumeAt = Number.NEGATIVE_INFINITY;
  private probe: Probe | null = null;
  private gestureListeners: AbortController | null = null;
  /** Таймер отложенного создания контекста; не null — жест уже был, граф вот-вот появится. */
  private startTimer: number | null = null;
  /** Запросы звука, пришедшие, пока граф строится: первый щелчок и первая доля не теряются. */
  private pending: Pending[] = [];

  /**
   * Создать или возобновить AudioContext. Вызывать из обработчика жеста (клик, тап, клавиша).
   *
   * Сам обработчик жеста не делает почти ничего: создание контекста (десятки миллисекунд на
   * слабой машине — это запуск звукового потока браузера) и узлов шин уходит в отдельную
   * задачу сразу после жеста, а тяжёлая подготовка микшера — ещё дальше, в свободное время.
   * Браузеру достаточно, что жест уже был (Safari передаёт жест таймеру, заведённому из
   * обработчика). Звуки, запрошенные в этот промежуток, не теряются — см. pending.
   */
  unlock(): void {
    const ctx = this.ctx;
    if (ctx) {
      this.wake(ctx);
      return;
    }
    if (this.startTimer !== null || !audioContextCtor() || !hasUserActivation()) return;
    this.startTimer = window.setTimeout(this.start, 0);
  }

  /**
   * Звать из обработчика своего переключателя звука прямо перед сохранением новой настройки:
   * если следующий setSettings включит звук, он подтвердит это щелчком. Настройки, принятые
   * из другой вкладки (событие storage), флаг не взводят и применяются молча — иначе щелчок
   * звучал бы в каждой открытой вкладке, хотя нажимали только в одной.
   */
  armToggleConfirm(): void {
    this.confirmNextToggle = true;
  }

  setSettings(settings: AudioSettings): void {
    const wasEnabled = this.settings.enabled;
    // Флаг одноразовый: гаснет при любом применении настроек, даже пока контекста ещё нет,
    // чтобы не дожить до чужого включения.
    const confirm = this.confirmNextToggle;
    this.confirmNextToggle = false;
    this.settings = sanitize(settings, this.settings);
    if (this.mix && this.ctx) this.mix.setLevels(this.settings, this.ctx.currentTime);
    // Щелчок самой кнопки звучал бы при старой настройке (в заглушённый микшер),
    // поэтому подтверждение включения играет здесь — когда мастер уже открывается.
    if (confirm && !wasEnabled && this.settings.enabled && !this.defer(this.confirmToggle)) this.confirmToggle();
  }

  /** Музыка звучит только в забеге; вне его beat-события не играют. */
  setMusicActive(active: boolean): void {
    if (this.musicActive === active) return;
    this.musicActive = active;
    const mix = this.mix;
    const ctx = this.ctx;
    if (!mix || !ctx) return;
    const now = ctx.currentTime;
    this.music?.silence(now);
    if (!active) {
      mix.musicDown(now, 0.3);
      mix.stopBus('music', now + 0.35, 0.08);
      this.dropReady(now);
    } else if (!this.dead) {
      mix.musicUp(now);
    }
  }

  /** Пауза: плавно заглушить всё звучащее, не теряя состояния. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    // За время паузы часы звука ушли вперёд, а часы симуляции стояли — сетка привяжется заново.
    this.grid.reset();
    const mix = this.mix;
    const ctx = this.ctx;
    if (!mix || !ctx) return;
    const now = ctx.currentTime;
    mix.setGate(!paused, now);
    if (paused) {
      // Запланированное наперёд (остаток доли, хвост райзера) после паузы прозвучало бы невпопад.
      mix.stopBus('music', now, 0.12);
      mix.stopBus('sfx', now, 0.12);
      this.music?.silence(now);
      this.readyVoice = null;
    }
  }

  /**
   * Событие симуляции. late — сколько секунд назад (по часам симуляции) оно
   * произошло: звук ставится на ctx.currentTime + LATENCY − late и попадает в сетку.
   */
  onEvent(event: SimEvent, late: number): void {
    const wasDead = this.dead;
    this.follow(event);
    if (this.defer((waited) => this.play(event, late + waited, wasDead))) return;
    this.play(event, late, wasDead);
  }

  /** Звуки интерфейса. */
  ui(sound: UiSound): void {
    if (this.defer(() => this.ui(sound))) return;
    const mix = this.mix;
    const ctx = this.ctx;
    if (!mix || !ctx || !this.canPlay(ctx)) return;
    const now = ctx.currentTime;
    if (sound === 'hover' && !this.gap('hover', now)) return;
    sfxUi(mix, now + 0.003, sound);
  }

  /** Диагностика: состояние контекста, сетки и голосов. */
  stats(): AudioStats {
    const mixer: MixerStats = this.mix?.stats() ?? { voices: 0, fading: 0, nodes: 0, peakVoices: 0, started: 0, stolen: 0, warmed: false };
    return {
      ...mixer,
      state: this.ctx ? this.ctx.state : 'locked',
      gridLocked: this.grid.isLocked,
      multiplier: this.multiplier,
      overdrive: this.overdrive,
      dead: this.dead,
    };
  }

  /** Диагностика: получать каждую запланированную ноту музыки (null — выключить). */
  setProbe(probe: Probe | null): void {
    this.probe = probe;
    if (this.music) this.music.probe = probe;
  }

  /** Ловить первый жест на странице, чтобы звук интерфейса работал ещё до первого забега. */
  listenForGestures(): void {
    if (typeof window === 'undefined' || this.gestureListeners) return;
    if (this.ctx && this.ctx.state === 'running') return;
    const ac = new AbortController();
    this.gestureListeners = ac;
    for (const type of GESTURE_EVENTS) {
      window.addEventListener(type, this.onGesture, { capture: true, passive: true, signal: ac.signal });
    }
  }

  /** Закрыть контекст и снять слушатели (горячая перезагрузка модуля). */
  dispose(): void {
    this.gestureListeners?.abort();
    this.gestureListeners = null;
    if (this.startTimer !== null) window.clearTimeout(this.startTimer);
    this.startTimer = null;
    this.pending = [];
    this.mix?.dispose();
    const ctx = this.ctx;
    if (ctx) {
      ctx.removeEventListener('statechange', this.onStateChange);
      if (ctx.state !== 'closed') ctx.close().catch(() => undefined);
    }
    this.ctx = null;
    this.mix = null;
    this.music = null;
    this.readyVoice = null;
  }

  // ── Внутреннее ──

  /** Отложенная часть unlock(): контекст, узлы шин и всё, что успели попросить до их появления. */
  private readonly start = (): void => {
    this.startTimer = null;
    const queue = this.pending;
    this.pending = [];
    const Ctor = audioContextCtor();
    if (this.ctx || !Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    this.ctx = ctx;
    const mix = new Mixer(ctx);
    this.mix = mix;
    this.music = new Music(mix);
    this.music.probe = this.probe;
    // Всё, что успели выставить до разблокировки, применяется сразу.
    const now = ctx.currentTime;
    mix.setLevels(this.settings, now);
    mix.setGate(!this.paused, now);
    if (!this.musicActive || this.dead) mix.musicDown(now, 0.01);
    ctx.addEventListener('statechange', this.onStateChange);
    this.primeOutput(ctx);
    this.warmUp(mix, ctx);
    this.wake(ctx);
    const nowMs = performance.now();
    for (const p of queue) {
      const waited = (nowMs - p.at) / 1000;
      if (waited <= PENDING_MAX_AGE) p.play(waited);
    }
  };

  /** Щелчок-подтверждение включения звука: чуть позже «сейчас», когда мастер уже открылся. */
  private readonly confirmToggle = (): void => {
    const mix = this.mix;
    const ctx = this.ctx;
    if (mix && ctx && this.canPlay(ctx)) sfxUi(mix, ctx.currentTime + 0.06, 'toggle');
  };

  /** Попросить контекст запуститься, если он спит. */
  private wake(ctx: AudioContext): void {
    if (ctx.state !== 'running' && ctx.state !== 'closed') {
      this.resumeAt = performance.now();
      ctx.resume().then(this.onStateChange, this.onStateChange);
    }
    this.onStateChange();
  }

  /** Граф ещё строится — запомнить запрос звука. true — запрос отложен. */
  private defer(play: (waited: number) => void): boolean {
    if (this.startTimer === null) return false;
    if (this.pending.length < PENDING_MAX) this.pending.push({ at: performance.now(), play });
    return true;
  }

  /** Звук события: late — давность события на момент вызова, сек. */
  private play(event: SimEvent, late: number, wasDead: boolean): void {
    const mix = this.mix;
    const ctx = this.ctx;
    const music = this.music;
    if (!mix || !ctx || !music || this.paused || !this.canPlay(ctx)) return;
    const now = ctx.currentTime;
    const measured = measuredTime(now, late);
    const soon = now + SFX_LEAD;

    switch (event.type) {
      case 'ready':
        music.reset(now);
        if (this.musicActive) mix.musicUp(now);
        this.dropReady(now);
        this.readyVoice = sfxReady(mix, Math.max(measured, now + MIN_LEAD), measured + LEAD_IN_TICKS * TICK_DT);
        break;
      case 'beat': {
        if (this.dead) break;
        // В ещё не запущенный контекст ставится только первая доля: его часы стоят,
        // и вторая легла бы точно поверх первой.
        if (ctx.state !== 'running' && this.grid.isLocked) break;
        const t0 = this.grid.sync(event.tick, measured);
        if (event.beat < 0) sfxCount(mix, Math.max(t0, now + MIN_LEAD), event.beat);
        if (this.musicActive) music.beat(event, t0, now, this.multiplier, this.overdrive);
        break;
      }
      case 'go':
        this.readyVoice = null;
        sfxGo(mix, Math.max(this.grid.at(event.tick, measured), now + MIN_LEAD));
        break;
      case 'collect': {
        // Сфера пересекает линию корабля ровно на шестнадцатой, а подбирается на пару тиков
        // раньше — нота ставится в саму шестнадцатую и звучит в ритм с музыкой.
        const step = Math.round(event.tick / TICKS_PER_STEP) * TICKS_PER_STEP;
        if (step !== this.collectStep) {
          this.collectStep = step;
          this.collectCount = 0;
        }
        if (++this.collectCount > COLLECTS_PER_STEP && !event.rare) break;
        const at = Math.max(this.grid.at(event.tick, measured, step), now + MIN_LEAD);
        const chord = chordAtTick(step);
        if (event.rare) {
          sfxCollectRare(mix, at, sparkleNotes(event.note, chord), panFor(event.x));
        } else {
          const energy = clamp((event.multiplier - 1) / (GAME.combo.maxMultiplier - 1), 0, 1);
          sfxCollect(mix, at, melodyNote(event.note, chord), panFor(event.x), energy, this.overdrive);
        }
        break;
      }
      case 'miss':
        if (this.gap('miss', now)) sfxMiss(mix, soon, panFor(event.x));
        break;
      case 'comboUp':
        music.raise(this.multiplier, this.overdrive, now);
        // На максимуме вместо аккорда множителя звучит вступление OVERDRIVE (событие придёт следом).
        if (event.multiplier < GAME.combo.maxMultiplier && this.gap('comboUp', now)) {
          sfxComboUp(mix, this.onStep(event.tick, measured, now), event.multiplier);
        }
        break;
      case 'overdrive':
        if (!event.on) break;
        music.raise(this.multiplier, true, now);
        sfxOverdrive(mix, this.onStep(event.tick, measured, now));
        break;
      case 'comboBreak': {
        music.collapse(now);
        if (!this.gap('comboBreak', now)) break;
        // При ударе в щит главный звук — стекло; срыв комбо звучит тише и чуть позже.
        const hit = event.reason === 'hit';
        sfxComboBreak(mix, hit ? soon + 0.08 : soon, event.lost, hit);
        break;
      }
      case 'dodge':
        if (event.near && this.gap('nearMiss', now)) sfxNearMiss(mix, soon, panFor(event.x));
        break;
      case 'shieldBreak':
        sfxShieldBreak(mix, soon, panFor(event.x));
        mix.duckMusic(now, 0.5, 0.25, 0.5);
        break;
      case 'levelUp': {
        const at = Math.max(this.grid.at(event.tick, measured), now + MIN_LEAD);
        // Райзер звучит в музыке; без неё удар получает собственный короткий взлёт.
        const riserHeard = this.musicActive && mix.audible('music');
        sfxLevelUp(mix, at, levelRootChord(event.level).bass + 24, !riserHeard);
        mix.duckMusic(at, 0.6, 0.2, 0.5);
        break;
      }
      case 'newRecord':
        sfxNewRecord(mix, soon);
        mix.duckMusic(now, 0.5, 0.9, 0.6);
        break;
      case 'death':
        this.fadeMusic(mix, music, now);
        sfxDeath(mix, soon, panFor(event.x));
        break;
      case 'gameOver':
        if (!wasDead) this.fadeMusic(mix, music, now);
        sfxGameOver(mix, soon + 0.05);
        break;
    }
  }

  /** Состояние забега по событию — без звука, поэтому работает и до разблокировки. */
  private follow(event: SimEvent): void {
    switch (event.type) {
      case 'ready':
        this.dead = false;
        this.multiplier = 1;
        this.overdrive = false;
        this.collectStep = Number.NEGATIVE_INFINITY;
        this.grid.reset();
        break;
      case 'comboUp':
        this.multiplier = event.multiplier;
        break;
      case 'overdrive':
        this.overdrive = event.on;
        break;
      case 'comboBreak':
        this.multiplier = 1;
        this.overdrive = false;
        break;
      case 'death':
      case 'gameOver':
        // После гибели симуляция не шлёт overdrive(off) и не сбрасывает комбо, а время
        // течёт замедленно — музыка и сетка выключаются здесь.
        this.dead = true;
        this.grid.reset();
        break;
      default:
        break;
    }
  }

  private fadeMusic(mix: Mixer, music: Music, now: number): void {
    mix.musicDown(now, DEATH_FADE);
    mix.stopBus('music', now + DEATH_FADE + 0.2, 0.1);
    music.silence(now);
  }

  /** Момент ближайшей к событию шестнадцатой в сетке (не раньше «сейчас»). */
  private onStep(tick: number, measured: number, now: number): number {
    const step = Math.round(tick / TICKS_PER_STEP) * TICKS_PER_STEP;
    return Math.max(this.grid.at(tick, measured, step), now + MIN_LEAD);
  }

  private dropReady(now: number): void {
    if (this.readyVoice && this.mix) this.mix.kill(this.readyVoice, now, 0.06);
    this.readyVoice = null;
  }

  /** Можно ли планировать звук: контекст запущен или вот-вот запустится (см. RESUME_GRACE_MS). */
  private canPlay(ctx: AudioContext): boolean {
    if (ctx.state === 'running') return true;
    return ctx.state !== 'closed' && performance.now() - this.resumeAt < RESUME_GRACE_MS;
  }

  private gap(key: Throttled, now: number): boolean {
    if (now - this.lastPlayed[key] < MIN_GAP[key]) return false;
    this.lastPlayed[key] = now;
    return true;
  }

  /**
   * Подготовить микшер (шум, импульс реверберации, свёртки) по шагу за задачу в свободное
   * время главного потока — вне обработчика жеста и не одним длинным куском.
   */
  private warmUp(mix: Mixer, ctx: AudioContext): void {
    const step = (): void => {
      // Движок закрыт (горячая перезагрузка модуля) — готовить уже нечего.
      if (this.mix !== mix || ctx.state === 'closed') return;
      if (mix.warmUp()) whenIdle(step);
    };
    whenIdle(step);
  }

  /** Пустой буфер в момент разблокировки — старые iOS иначе не «просыпаются». */
  private primeOutput(ctx: AudioContext): void {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.onended = () => src.disconnect();
    src.start();
  }

  private readonly onGesture = (): void => {
    this.unlock();
  };

  /** Контекст запущен — ловить жесты больше незачем; усыплён системой — снова ждать жеста. */
  private readonly onStateChange = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'running') {
      this.gestureListeners?.abort();
      this.gestureListeners = null;
    } else if (ctx.state !== 'closed') {
      this.listenForGestures();
    }
  };
}

/** Единственный экземпляр на приложение. */
export const audio = new AudioEngine();

setUiSoundHandler((sound) => audio.ui(sound));
audio.listenForGestures();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    setUiSoundHandler(null);
    audio.dispose();
  });
}
