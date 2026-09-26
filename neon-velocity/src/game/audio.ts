/**
 * Звуковой движок: процедурный синтвейв и эффекты на Web Audio API, без файлов.
 *
 * AudioContext создаётся лениво — только в unlock() из жеста пользователя
 * (плюс модуль сам ловит первый жест на странице, чтобы звучало и меню). До
 * этого все методы безопасно ничего не делают, а настройки и флаги просто
 * запоминаются. Музыка собирается из beat-событий движка (audio-music.ts),
 * эффекты и звуки интерфейса — в audio-sfx.ts, граф и голоса — в audio-core.ts.
 */
import { WORLD_W } from './config';
import { clamp } from './math';
import type { GameEvent } from './types';
import { setUiSoundHandler, type UiSound } from './uiSound';
import { Mixer, type Voice } from './audio-core';
import { BeatClock, Music } from './audio-music';
import {
  sfxCollect,
  sfxCollectRare,
  sfxComboBreak,
  sfxComboUp,
  sfxDeath,
  sfxGameOver,
  sfxGo,
  sfxLevelRiser,
  sfxLevelUp,
  sfxNearMiss,
  sfxNewRecord,
  sfxRunStart,
  sfxShieldBreak,
  sfxUi,
} from './audio-sfx';

export interface AudioSettings {
  enabled: boolean;
  /** 0..1 */
  music: number;
  /** 0..1 */
  sfx: number;
}

/** Небольшой запас планирования эффектов, чтобы атака не срезалась. */
const SFX_LEAD = 0.006;
/** Длина райзера перед новым уровнем, сек. */
const RISER_SECONDS = 1.1;
/** Сферы, собранные в одном кадре, звучат лесенкой с таким шагом, а не одним комком. */
const COLLECT_SPACING = 0.035;
/** Дальше этого лесенка не копится — лишние блипы пропускаются. */
const COLLECT_QUEUE = 0.12;
/** Музыка затухает при смерти за столько секунд. */
const DEATH_FADE = 1.4;

/** Минимальные интервалы между повторами одного звука, сек. */
const MIN_GAP = {
  hover: 0.05,
  nearMiss: 0.07,
  comboBreak: 0.12,
  comboUp: 0.06,
} as const;
type Throttled = keyof typeof MIN_GAP;

/** События, по которым браузер разрешает запуск звука (активация пользователем). */
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'] as const;

/**
 * Шаг подготовки микшера ждёт свободного времени главного потока не дольше, мс: на занятом
 * потоке (первые кадры забега, слабый телефон) все шаги всё равно укладываются в доли секунды,
 * и реверберация молчит лишь в самом начале первого забега.
 */
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

/** Мировой X → панорама: звук идёт с той стороны поля, где корабль. */
function panFor(x: number): number {
  return Number.isFinite(x) ? clamp((x / WORLD_W) * 2 - 1, -1, 1) * 0.6 : 0;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private mix: Mixer | null = null;
  private music: Music | null = null;
  private readonly clock = new BeatClock();
  private settings: AudioSettings = { enabled: true, music: 0.7, sfx: 0.8 };
  private musicActive = false;
  /** Корабль взорван: доли продолжают приходить, но музыка уже затухла. */
  private musicDead = false;
  private paused = false;
  private riser: { voice: Voice; level: number; impact: number } | null = null;
  private collectAt = 0;
  private readonly lastPlayed: Record<Throttled, number> = { hover: -1, nearMiss: -1, comboBreak: -1, comboUp: -1 };
  private gestureListeners: AbortController | null = null;

  /** Состояние контекста: 'locked' — ещё не было unlock(). */
  get contextState(): AudioContextState | 'locked' {
    return this.ctx ? this.ctx.state : 'locked';
  }

  /**
   * Создать или возобновить AudioContext. Вызывать из обработчика жеста (клик, тап, клавиша).
   * В самом жесте — только то, что требует активации (контекст, узлы, resume); тяжёлая
   * подготовка микшера уходит в фоновые задачи (warmUp), чтобы первый тап не подвисал.
   */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = audioContextCtor();
      if (!Ctor || !hasUserActivation()) return;
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
      // Всё, что успели выставить до разблокировки, применяется сразу.
      const now = ctx.currentTime;
      mix.setLevels(this.settings, now);
      mix.setGate(!this.paused, now);
      ctx.addEventListener('statechange', this.onStateChange);
      this.primeOutput(ctx);
      this.warmUp(mix, ctx);
    }
    const ctx = this.ctx;
    if (ctx.state !== 'running' && ctx.state !== 'closed') {
      ctx.resume().then(this.onStateChange, this.onStateChange);
    }
    this.onStateChange();
  }

  setSettings(settings: AudioSettings): void {
    const wasEnabled = this.settings.enabled;
    this.settings = sanitize(settings, this.settings);
    const mix = this.mix;
    const ctx = this.ctx;
    if (!mix || !ctx) return;
    const now = ctx.currentTime;
    mix.setLevels(this.settings, now);
    // Щелчок самой кнопки звучал бы при старой настройке (в заглушённый микшер),
    // поэтому подтверждение включения играет здесь — когда мастер уже открывается.
    if (!wasEnabled && this.settings.enabled && ctx.state === 'running') sfxUi(mix, now + 0.06, 'toggle');
  }

  /** Музыка звучит только во время забега; вне забега beat-события игнорируются. */
  setMusicActive(active: boolean): void {
    this.musicActive = active;
    this.musicDead = false;
    this.clock.reset();
    this.dropRiser();
    const mix = this.mix;
    const ctx = this.ctx;
    if (!mix || !ctx) return;
    const now = ctx.currentTime;
    if (active) {
      mix.musicUp(now);
    } else {
      mix.musicDown(now, 0.3);
      mix.stopBus('music', now + 0.35, 0.08);
    }
  }

  /** Пауза: заглушить звучащие голоса, не теряя состояния. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    const mix = this.mix;
    const ctx = this.ctx;
    if (!mix || !ctx) return;
    const now = ctx.currentTime;
    mix.setGate(!paused, now);
    if (paused) {
      // Запланированное наперёд (офбит-хэт, хвост райзера) после паузы прозвучало бы невпопад.
      mix.stopBus('music', now, 0.15);
      mix.stopBus('sfx', now, 0.15);
      this.riser = null;
      this.clock.cancelRiser();
    }
  }

  /** Все события движка: beat → музыка, остальные → звуковые эффекты. */
  handleEvent(event: GameEvent): void {
    // Состояние музыки меняется всегда — даже пока звук не разблокирован.
    if (event.type === 'runStart') {
      this.clock.reset();
      this.musicDead = false;
      this.dropRiser();
    } else if (event.type === 'death') {
      this.musicDead = true;
      this.dropRiser();
    }
    const mix = this.mix;
    const ctx = this.ctx;
    // В «спящем» контексте время стоит: запланированное сыграло бы разом после пробуждения.
    if (!mix || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const t = now + SFX_LEAD;

    switch (event.type) {
      case 'beat':
        this.onBeat(event, mix, now);
        return;
      case 'runStart':
        mix.musicUp(now);
        if (!this.paused) sfxRunStart(mix, t);
        return;
      case 'death':
        mix.musicDown(now, DEATH_FADE);
        mix.stopBus('music', now + DEATH_FADE + 0.2, 0.1);
        if (!this.paused) sfxDeath(mix, t, panFor(event.x));
        return;
      default:
        break;
    }
    if (this.paused) return;

    switch (event.type) {
      case 'go':
        sfxGo(mix, t);
        break;
      case 'collect': {
        // Несколько сфер за кадр (магнит, цепочка) — лесенкой, а не одним щелчком.
        const at = Math.max(t, this.collectAt + COLLECT_SPACING);
        if (at - now > COLLECT_QUEUE) break;
        this.collectAt = at;
        if (event.rare) sfxCollectRare(mix, at, panFor(event.x));
        else sfxCollect(mix, at, event.chain, panFor(event.x));
        break;
      }
      case 'comboUp':
        if (this.gap('comboUp', now)) sfxComboUp(mix, Math.max(t, this.collectAt) + 0.015, event.multiplier);
        break;
      case 'comboBreak':
        // При ударе в щит главный звук — стекло; сброс комбо звучит тише и чуть позже.
        if (this.gap('comboBreak', now)) {
          const hit = event.reason === 'hit';
          sfxComboBreak(mix, hit ? t + 0.08 : t, event.lostMultiplier, hit);
        }
        break;
      case 'nearMiss':
        if (this.gap('nearMiss', now)) sfxNearMiss(mix, t, panFor(event.x));
        break;
      case 'shieldBreak':
        sfxShieldBreak(mix, t, panFor(event.x));
        mix.musicDip(now, 520, 0.28);
        mix.duckMusic(now, 0.55, 0.25, 0.5);
        break;
      case 'levelUp':
        this.onLevelUp(event.level, mix, now);
        break;
      case 'newRecord':
        sfxNewRecord(mix, t);
        mix.duckMusic(now, 0.5, 0.9, 0.6);
        break;
      case 'gameOver':
        sfxGameOver(mix, t + 0.05);
        break;
    }
  }

  /** Звуки интерфейса. */
  ui(sound: UiSound): void {
    const mix = this.mix;
    const ctx = this.ctx;
    if (!mix || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (sound === 'hover' && !this.gap('hover', now)) return;
    sfxUi(mix, now + 0.003, sound);
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
    this.mix?.dispose();
    const ctx = this.ctx;
    if (ctx) {
      ctx.removeEventListener('statechange', this.onStateChange);
      if (ctx.state !== 'closed') ctx.close().catch(() => undefined);
    }
    this.ctx = null;
    this.mix = null;
    this.music = null;
    this.riser = null;
  }

  // ── Внутреннее ──

  private onBeat(event: Extract<GameEvent, { type: 'beat' }>, mix: Mixer, now: number): void {
    if (!this.musicActive || this.musicDead || this.paused || !this.music) return;
    const t = this.clock.place(event, now);
    this.music.play(event, t, this.clock.toLevelUp(event));
    // Райзер заранее, чтобы его вершина совпала с моментом нового уровня.
    const w = this.clock.riserWindow(event, t, RISER_SECONDS);
    if (w) {
      const voice = sfxLevelRiser(mix, w.start, w.impact);
      if (voice) {
        // Прежний райзер (его уровень так и не наступил) гасится напрямую: dropRiser() сбросил бы
        // в часах отметку «райзер этого уровня уже запланирован», и на следующей же доле окна
        // райзер перезапускался бы с нижней ноты, так и не доиграв до удара.
        if (this.riser) mix.kill(this.riser.voice, now, 0.06);
        this.riser = { voice, level: w.level, impact: w.impact };
      }
    }
  }

  private onLevelUp(level: number, mix: Mixer, now: number): void {
    const r = this.riser;
    this.riser = null;
    let at = now + SFX_LEAD;
    let sweep = true;
    // Предсказанный момент удара близок к фактическому — бьём ровно в вершину райзера.
    if (r && r.level === level && r.impact > now - 0.03 && r.impact < now + 0.15) {
      at = Math.max(r.impact, at);
      sweep = false;
    } else if (r) {
      mix.kill(r.voice, now, 0.05);
    }
    sfxLevelUp(mix, at, level, sweep);
    mix.duckMusic(at, 0.6, 0.25, 0.6);
  }

  /** Оборвать райзер и разрешить часам запланировать его заново (новый забег, смерть, выход из забега). */
  private dropRiser(): void {
    const r = this.riser;
    this.riser = null;
    this.clock.cancelRiser();
    if (r && this.mix && this.ctx) this.mix.kill(r.voice, this.ctx.currentTime, 0.06);
  }

  private gap(key: Throttled, now: number): boolean {
    if (now - this.lastPlayed[key] < MIN_GAP[key]) return false;
    this.lastPlayed[key] = now;
    return true;
  }

  /**
   * Подготовить микшер (импульс реверберации, свёртки, буферы шума) по шагу за задачу в
   * свободное время главного потока — вне обработчика жеста и не одним длинным куском.
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
