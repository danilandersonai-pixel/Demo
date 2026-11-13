/**
 * Микшер процедурного звука (Web Audio, никаких файлов).
 *
 * Граф:
 *   музыка:  drums ─────────────────────────────┐
 *            hats ─► ФВЧ ───────────────────────┤
 *            bass ─► pumpBass ──────────────────┤
 *            synth ─► pumpSynth ─► tone (ФНЧ) ──┴─► musicIn ─► sweep ─► duck ─► fade ─► vol ─┐
 *   эффекты: sfx ─► sfxIn ─► vol ───────────────────────────────────────────────────────────┴─► gate ─┐
 *   интерфейс: ui ─► vol ─────────────────────── (мимо gate: меню паузы звучит) ─────────────────────┴─► master
 *   master ─► компрессор ─► лимитер ─► мягкий ограничитель ─► выход
 *
 * pumpSynth / pumpBass — «сайдчейн» от бочки, tone — яркость синтов (растёт с
 * множителем комбо), sweep — «провал» всей музыки при срыве комбо и гибели.
 * У музыки и у эффектов свои посылы на темповое эхо (возврат — во вход шины) и на
 * общую реверберацию: свёртка одна на весь микс, а громкость шины стоит на входе
 * в неё, поэтому громкость и затухание музыки действуют на посыл, пауза — на хвост.
 *
 * Голос — все узлы одного звука. Микшер держит предел одновременных голосов
 * (вытесняет самый старый из наименее важных) и отключает узлы голоса, как
 * только отыграли все его источники, — граф не растёт.
 *
 * Конструктор создаёт только узлы шин: это дёшево, его зовут из обработчика
 * жеста. Тяжёлое — шум, импульс реверберации и его загрузка в свёртки — делает
 * warmUp() по шагу за вызов; до тех пор свёртки молчат.
 */
import { clamp } from '../core/math';
import { BPM } from '../core/timing';

/** Куда подключается голос. drums / hats / bass / synth — части музыки. */
export type Route = 'drums' | 'hats' | 'bass' | 'synth' | 'sfx' | 'ui';
export type BusId = 'music' | 'sfx' | 'ui';

/** Важность голоса: при переполнении вытесняется наименее важный и самый старый. */
export const PRIORITY = {
  tick: 0,
  hat: 1,
  music: 2,
  pad: 3,
  sfx: 4,
  accent: 5,
  critical: 6,
} as const;

const ROUTE_BUS: Record<Route, BusId> = {
  drums: 'music',
  hats: 'music',
  bass: 'music',
  synth: 'music',
  sfx: 'sfx',
  ui: 'ui',
};

/** Предел одновременно звучащих и запланированных голосов. */
export const MAX_VOICES = 64;
/** Практическая тишина для экспоненциальных огибающих (−80 дБ). */
export const SILENT = 1e-4;

/** Уровни шин до пользовательской громкости: эффекты сидят поверх музыки. */
const MUSIC_LEVEL = 0.7;
const SFX_LEVEL = 2;
const UI_LEVEL = 1.7;
/** Постоянная времени сглаживания громкостей, сек — без щелчков. */
const SMOOTH = 0.025;
/** Длина импульса реверберации и буферов шума, сек. */
const IR_SECONDS = 1.1;
const NOISE_SECONDS = 2;
/** Частота «открытого» фильтра. */
const OPEN_HZ = 18000;
/** Эхо — пунктирная восьмая темпа: повторы ложатся между шестнадцатыми. */
const ECHO_SECONDS = (60 / BPM) * 0.75;
/** Потолок выходного сигнала: выше мягкий ограничитель не пропускает ничего. */
export const OUTPUT_CEILING = 0.92;

const COMPRESSOR = { threshold: -10, ratio: 3, attack: 0.005, release: 0.2 } as const;
const LIMITER = { threshold: -3, ratio: 20, attack: 0.001, release: 0.08 } as const;

/**
 * Компрессор браузера сам добавляет «компенсацию»: усиливает сигнал на
 * (1 / gain(0 дБ))^0.6. При жёстком колене она считается точно — этот множитель
 * возвращает тихому сигналу единичное усиление, чтобы пороги значили то, что написано.
 */
function makeupCompensation(threshold: number, ratio: number): number {
  const fullRangeDb = threshold * (1 - 1 / ratio);
  return Math.pow(10, (0.6 * fullRangeDb) / 20);
}

export interface VoiceOptions {
  /** Панорама −1..1. */
  pan?: number;
  /** Посыл на реверберацию 0..1. */
  verb?: number;
  /** Посыл на эхо 0..1. */
  echo?: number;
  /** Метка для выборочного глушения (слой аранжировки). */
  tag?: number;
}

export interface Voice {
  readonly bus: BusId;
  readonly priority: number;
  readonly tag: number;
  readonly start: number;
  /** Момент, к которому голос гарантированно замолкает. */
  end: number;
  /** Выход голоса: сюда подключается последняя ступень цепочки. */
  readonly out: GainNode;
  /** Панорама голоса (если задана в опциях) — для автоматизации пролёта. */
  readonly pan: StereoPannerNode | null;
  readonly nodes: AudioNode[];
  readonly sources: AudioScheduledSourceNode[];
  pending: number;
  killed: boolean;
  released: boolean;
}

export interface Levels {
  enabled: boolean;
  /** 0..1 */
  music: number;
  /** 0..1 */
  sfx: number;
}

export interface MixerStats {
  /** Живые голоса: звучащие и запланированные (на них действует предел MAX_VOICES). */
  voices: number;
  /** Заглушённые голоса, чьи узлы ещё не отключены (доигрывают затухание). */
  fading: number;
  /** Узлы всех голосов в учёте (узлы шин не считаются — их число постоянно). */
  nodes: number;
  /** Наибольшее число живых голосов за всё время. */
  peakVoices: number;
  /** Сколько голосов создано и сколько вытеснено пределом. */
  started: number;
  stolen: number;
  /** Отложенная подготовка (шум, реверберация) закончена. */
  warmed: boolean;
}

/** Посылы шины: вход в общую реверберацию (с громкостью шины) и вход эха. */
interface Sends {
  verb: GainNode;
  echo: GainNode;
}

export function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Громкость ползунка → усиление: квадратичная кривая звучит равномернее линейной. */
function sliderGain(v: number): number {
  const x = clamp(v, 0, 1);
  return x * x;
}

// ─── Огибающие ──────────────────────────────────────────────────────────────

/** Ударная огибающая: подъём до peak за attack и экспоненциальный спад к тишине за decay. Возвращает момент конца. */
export function envPerc(p: AudioParam, t: number, peak: number, attack: number, decay: number): number {
  const top = Math.max(peak, SILENT * 2);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(top, t + attack);
  p.exponentialRampToValueAtTime(SILENT, t + attack + decay);
  return t + attack + decay;
}

/**
 * Огибающая с удержанием: attack → спад к peak·sustain за decay → держать до t + hold →
 * экспоненциальное затухание за release. Возвращает момент конца.
 */
export function envHold(
  p: AudioParam,
  t: number,
  peak: number,
  attack: number,
  decay: number,
  sustain: number,
  hold: number,
  release: number,
): number {
  const top = Math.max(peak, SILENT * 2);
  const low = Math.max(top * sustain, SILENT * 2);
  const decayEnd = t + attack + decay;
  const releaseAt = Math.max(t + hold, decayEnd);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(top, t + attack);
  p.linearRampToValueAtTime(low, decayEnd);
  p.setValueAtTime(low, releaseAt);
  p.exponentialRampToValueAtTime(SILENT, releaseAt + release);
  return releaseAt + release;
}

/** Экспоненциальный glide from → to за [t0, t1]. */
export function glide(p: AudioParam, from: number, to: number, t0: number, t1: number): void {
  p.setValueAtTime(Math.max(from, 1e-3), t0);
  p.exponentialRampToValueAtTime(Math.max(to, 1e-3), Math.max(t1, t0 + 1e-3));
}

/** Плавно увести параметр к value, отменив запланированное после at. */
function steer(p: AudioParam, value: number, at: number, tau: number): void {
  p.cancelScheduledValues(at);
  p.setTargetAtTime(value, at, tau);
}

// ─── Микшер ─────────────────────────────────────────────────────────────────

export class Mixer {
  readonly ctx: BaseAudioContext;

  private readonly master: GainNode;
  private readonly gate: GainNode;
  private readonly musicIn: GainNode;
  private readonly musicSweep: BiquadFilterNode;
  private readonly musicDuck: GainNode;
  private readonly musicFade: GainNode;
  private readonly musicVol: GainNode;
  private readonly hatsIn: BiquadFilterNode;
  private readonly pumpBass: GainNode;
  private readonly pumpSynth: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly sfxIn: GainNode;
  private readonly sfxVol: GainNode;
  private readonly uiVol: GainNode;
  private readonly musicSends: Sends;
  private readonly sfxSends: Sends;
  /** Свёртка реверберации; импульс загружается в warmUp(), до этого она молчит. */
  private readonly reverb: ConvolverNode;
  /** Все узлы шин — чтобы dispose() отключил граф целиком. */
  private readonly busNodes: AudioNode[] = [];

  private readonly voices: Voice[] = [];
  private levels: Levels = { enabled: true, music: 0.7, sfx: 0.8 };
  private gateOpen = true;
  /** Музыка приглушена «до нуля» (гибель, выход в меню) — новые голоса музыки не нужны. */
  private musicSilenced = false;
  /** Последний момент автоматизации «сайдчейна»: события должны идти по возрастанию времени. */
  private lastPumpAt = -1;
  /** Живых голосов после последнего reserve(). */
  private liveVoices = 0;
  private peakVoices = 0;
  private started = 0;
  private stolen = 0;

  private whiteBuf: AudioBuffer | null = null;
  private brownBuf: AudioBuffer | null = null;
  private irBuf: AudioBuffer | null = null;
  /** Сколько каналов irBuf уже синтезировано: импульс готов, когда заполнены все. */
  private irChannels = 0;
  private driveCurveData: Float32Array<ArrayBuffer> | null = null;

  /**
   * Шаги warmUp() по порядку нужности: белый шум звучит с первой доли (хэты), реверберация —
   * хвосты, «коричневый» шум и перегруз — только на взрыве и ударе уровня. Каждый шаг — единицы
   * миллисекунд; загрузка импульса в свёртку — отдельный шаг, потому что браузер готовит ядро
   * свёртки синхронно при присваивании buffer.
   */
  private readonly warmSteps: readonly (() => void)[] = [
    () => this.white(),
    () => this.synthImpulseChannel(),
    () => this.synthImpulseChannel(),
    () => this.loadReverb(),
    () => this.brown(),
    () => this.driveCurve(),
  ];
  private warmed = 0;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;

    // Выходная ступень: компрессор склеивает микс, лимитер держит пики, а кривая
    // ограничителя — жёсткая гарантия: выше OUTPUT_CEILING сигнал не поднимется никогда.
    const comp = this.node(ctx.createDynamicsCompressor());
    comp.threshold.value = COMPRESSOR.threshold;
    comp.knee.value = 0;
    comp.ratio.value = COMPRESSOR.ratio;
    comp.attack.value = COMPRESSOR.attack;
    comp.release.value = COMPRESSOR.release;
    const compTrim = this.node(ctx.createGain());
    compTrim.gain.value = makeupCompensation(COMPRESSOR.threshold, COMPRESSOR.ratio);
    const limiter = this.node(ctx.createDynamicsCompressor());
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = 0;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    const limiterTrim = this.node(ctx.createGain());
    limiterTrim.gain.value = makeupCompensation(LIMITER.threshold, LIMITER.ratio);
    const clip = this.node(ctx.createWaveShaper());
    clip.curve = softClipCurve();
    this.master = this.node(ctx.createGain());
    this.master.connect(comp).connect(compTrim).connect(limiter).connect(limiterTrim).connect(clip).connect(ctx.destination);

    this.gate = this.node(ctx.createGain());
    this.gate.connect(this.master);

    // Музыка.
    this.musicIn = this.node(ctx.createGain());
    this.musicSweep = this.node(ctx.createBiquadFilter());
    this.musicSweep.type = 'lowpass';
    this.musicSweep.frequency.value = OPEN_HZ;
    this.musicSweep.Q.value = 0.6;
    this.musicDuck = this.node(ctx.createGain());
    this.musicFade = this.node(ctx.createGain());
    this.musicVol = this.node(ctx.createGain());
    this.musicIn.connect(this.musicSweep).connect(this.musicDuck).connect(this.musicFade).connect(this.musicVol).connect(this.gate);

    // Все хэты идут через один общий ФВЧ — голосу хэта не нужен свой фильтр.
    this.hatsIn = this.node(ctx.createBiquadFilter());
    this.hatsIn.type = 'highpass';
    this.hatsIn.frequency.value = 7200;
    this.hatsIn.Q.value = 0.7;
    this.hatsIn.connect(this.musicIn);

    this.pumpBass = this.node(ctx.createGain());
    this.pumpBass.connect(this.musicIn);
    this.pumpSynth = this.node(ctx.createGain());
    this.tone = this.node(ctx.createBiquadFilter());
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 2400;
    this.tone.Q.value = 0.8;
    this.pumpSynth.connect(this.tone).connect(this.musicIn);

    // Общая реверберация: хвост идёт в gate, мимо громкостей шин — они стоят на её входах.
    this.reverb = this.node(ctx.createConvolver());
    const reverbOut = this.node(ctx.createGain());
    reverbOut.gain.value = 0.75;
    this.reverb.connect(reverbOut).connect(this.gate);
    this.musicSends = this.createSends(this.musicIn, 0.32);

    // Эффекты.
    this.sfxIn = this.node(ctx.createGain());
    this.sfxVol = this.node(ctx.createGain());
    this.sfxIn.connect(this.sfxVol).connect(this.gate);
    this.sfxSends = this.createSends(this.sfxIn, 0.28);

    // Интерфейс — мимо gate: кнопки меню паузы должны звучать.
    this.uiVol = this.node(ctx.createGain());
    this.uiVol.connect(this.master);

    this.applyLevels(ctx.currentTime, true);
  }

  /**
   * Выполнить следующий шаг отложенной подготовки (см. warmSteps). Вызывающий разносит шаги
   * по отдельным задачам, чтобы ни одна не держала главный поток. true — шаги ещё остались.
   */
  warmUp(): boolean {
    const step = this.warmSteps[this.warmed];
    if (step) {
      this.warmed++;
      step();
    }
    return this.warmed < this.warmSteps.length;
  }

  stats(): MixerStats {
    let nodes = 0;
    let fading = 0;
    for (const v of this.voices) {
      nodes += v.nodes.length;
      if (v.killed) fading++;
    }
    return {
      voices: this.voices.length - fading,
      fading,
      nodes,
      peakVoices: this.peakVoices,
      started: this.started,
      stolen: this.stolen,
      warmed: this.warmed >= this.warmSteps.length,
    };
  }

  // ── Состояние шин ──

  /** Громкости и общий выключатель (плавно). */
  setLevels(levels: Levels, at: number): void {
    this.levels = { enabled: levels.enabled, music: clamp(levels.music, 0, 1), sfx: clamp(levels.sfx, 0, 1) };
    this.applyLevels(at, false);
  }

  /** Пауза: закрыть или открыть музыку и игровые эффекты (интерфейс не трогается). */
  setGate(open: boolean, at: number): void {
    this.gateOpen = open;
    steer(this.gate.gain, open ? 1 : 0, at, open ? 0.02 : 0.03);
  }

  /** Слышна ли шина — если нет, голоса не создаются вовсе. */
  audible(bus: BusId): boolean {
    const l = this.levels;
    if (!l.enabled) return false;
    if (bus === 'ui') return l.sfx > 0.001;
    if (!this.gateOpen) return false;
    if (bus === 'music') return l.music > 0.001 && !this.musicSilenced;
    return l.sfx > 0.001;
  }

  /** «Сайдчейн» от бочки: синты проседают на depth, бас — чуть слабее и возвращается быстрее. */
  pump(t: number, depth: number): void {
    const at = Math.max(t, this.lastPumpAt + 0.001);
    this.lastPumpAt = at + 0.03;
    const synth = this.pumpSynth.gain;
    synth.setTargetAtTime(1 - depth, at, 0.006);
    synth.setTargetAtTime(1, at + 0.03, 0.085);
    const bass = this.pumpBass.gain;
    bass.setTargetAtTime(1 - depth * 0.8, at, 0.004);
    bass.setTargetAtTime(1, at + 0.03, 0.045);
  }

  /** Яркость синтов: частота среза и добротность общего фильтра. */
  setTone(hz: number, q: number, at: number, tau: number): void {
    steer(this.tone.frequency, clamp(hz, 200, OPEN_HZ), at, tau);
    steer(this.tone.Q, q, at, tau);
  }

  /** Приглушить музыку под важный эффект (фанфара, удар уровня). */
  duckMusic(at: number, depth: number, hold: number, release: number): void {
    const g = this.musicDuck.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(clamp(depth, 0, 1), at, 0.02);
    g.setTargetAtTime(1, at + hold, release / 3);
  }

  /** «Провал» всей музыки: фильтр ныряет к hz за dive и возвращается за rise. */
  musicDive(at: number, hz: number, dive: number, hold: number, rise: number): void {
    const f = this.musicSweep.frequency;
    f.cancelScheduledValues(at);
    f.setTargetAtTime(hz, at, dive / 3);
    f.setTargetAtTime(OPEN_HZ, at + dive + hold, rise / 3);
    const q = this.musicSweep.Q;
    q.cancelScheduledValues(at);
    q.setTargetAtTime(4, at, 0.02);
    q.setTargetAtTime(0.6, at + dive + hold, rise / 3);
  }

  /** Музыка уходит: фильтр закрывается (как «уплывающая плёнка»), громкость гаснет за seconds. */
  musicDown(at: number, seconds: number): void {
    this.musicSilenced = true;
    steer(this.musicSweep.frequency, 180, at, seconds * 0.3);
    steer(this.musicSweep.Q, 5, at, 0.05);
    steer(this.musicFade.gain, 0, at, seconds / 4);
    steer(this.musicSends.verb.gain, 0, at, seconds / 4);
  }

  /** Вернуть шину музыки в исходное состояние (новый забег). */
  musicUp(at: number): void {
    this.musicSilenced = false;
    steer(this.musicSweep.frequency, OPEN_HZ, at, 0.02);
    steer(this.musicSweep.Q, 0.6, at, 0.02);
    for (const g of [this.musicFade.gain, this.musicDuck.gain, this.pumpSynth.gain, this.pumpBass.gain]) steer(g, 1, at, 0.015);
    steer(this.musicSends.verb.gain, MUSIC_LEVEL * sliderGain(this.levels.music), at, 0.015);
    this.lastPumpAt = at;
  }

  // ── Голоса ──

  /**
   * Начать голос с началом в момент t. null — голос не нужен: шина не слышна
   * или предел занят более важными звуками.
   */
  voice(route: Route, priority: number, t: number, opts?: VoiceOptions): Voice | null {
    const bus = ROUTE_BUS[route];
    if (!this.audible(bus) || !this.reserve(priority)) return null;
    const ctx = this.ctx;
    const out = ctx.createGain();
    let pan: StereoPannerNode | null = null;
    let tail: AudioNode = out;
    if (opts?.pan !== undefined && opts.pan !== 0) {
      pan = ctx.createStereoPanner();
      pan.pan.value = clamp(opts.pan, -1, 1);
      out.connect(pan);
      tail = pan;
    }
    const v: Voice = {
      bus,
      priority,
      tag: opts?.tag ?? 0,
      start: t,
      end: t,
      out,
      pan,
      nodes: pan ? [out, pan] : [out],
      sources: [],
      pending: 0,
      killed: false,
      released: false,
    };
    tail.connect(this.routeInput(route));
    if (bus !== 'ui') {
      const sends = bus === 'music' ? this.musicSends : this.sfxSends;
      if (opts?.verb) this.send(v, tail, sends.verb, opts.verb);
      if (opts?.echo) this.send(v, tail, sends.echo, opts.echo);
    }
    this.voices.push(v);
    this.started++;
    if (this.liveVoices > this.peakVoices) this.peakVoices = this.liveVoices;
    return v;
  }

  /** Быстро заглушить и остановить все голоса шины (пауза, смена экрана). */
  stopBus(bus: BusId, at: number, fade: number): void {
    for (const v of this.voices) if (v.bus === bus) this.kill(v, at, fade);
  }

  /** Заглушить голоса музыки с метками из набора (слои аранжировки). */
  stopTagged(tags: ReadonlySet<number>, at: number, fade: number): void {
    for (const v of this.voices) if (v.bus === 'music' && tags.has(v.tag)) this.kill(v, at, fade);
  }

  /** Заглушить голос за fade секунд начиная с at. */
  kill(v: Voice, at: number, fade: number): void {
    if (v.killed || v.released) return;
    v.killed = true;
    const span = Math.max(fade, 0.004);
    const g = v.out.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0, at, span / 4);
    const stopAt = at + span;
    for (const s of v.sources) {
      try {
        s.stop(stopAt);
      } catch {
        // Источник уже остановлен — нечего делать.
      }
    }
    v.end = Math.min(v.end, stopAt);
  }

  // ── Строительные блоки голоса ──

  osc(v: Voice, type: OscillatorType, freq: number, t0: number, t1: number, dest: AudioNode, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (detune !== 0) o.detune.value = detune;
    o.connect(dest);
    this.track(v, o, t1);
    o.start(t0);
    o.stop(Math.max(t1, t0 + 0.001));
    return o;
  }

  /** Шум (белый или «коричневый» — глухой рокот) со случайного места кэшированного буфера. */
  noise(v: Voice, t0: number, t1: number, dest: AudioNode, color: 'white' | 'brown' = 'white'): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    const buf = color === 'white' ? this.white() : this.brown();
    src.buffer = buf;
    src.loop = true;
    src.connect(dest);
    this.track(v, src, t1);
    src.start(t0, Math.random() * (buf.duration - 0.05));
    src.stop(Math.max(t1, t0 + 0.001));
    return src;
  }

  gain(v: Voice, value: number, dest: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    v.nodes.push(g);
    return g;
  }

  filter(v: Voice, type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    v.nodes.push(f);
    return f;
  }

  /** Мягкий перегруз (tanh) — плотность бочке, саб-удару и взрыву. */
  drive(v: Voice, dest: AudioNode): WaveShaperNode {
    const w = this.ctx.createWaveShaper();
    w.curve = this.driveCurve();
    w.connect(dest);
    v.nodes.push(w);
    return w;
  }

  /** Синусоидальная модуляция параметров (вибрато, «дыхание» фильтра). */
  lfo(v: Voice, rate: number, depth: number, params: readonly AudioParam[], t0: number, t1: number): void {
    const g = this.ctx.createGain();
    g.gain.value = depth;
    for (const p of params) g.connect(p);
    v.nodes.push(g);
    this.osc(v, 'sine', rate, t0, t1, g);
  }

  /** Отключить весь граф (закрытие движка). */
  dispose(): void {
    for (const v of [...this.voices]) this.release(v);
    for (const n of this.busNodes) n.disconnect();
  }

  // ── Внутреннее ──

  private node<T extends AudioNode>(n: T): T {
    this.busNodes.push(n);
    return n;
  }

  private routeInput(route: Route): AudioNode {
    switch (route) {
      case 'drums':
        return this.musicIn;
      case 'hats':
        return this.hatsIn;
      case 'bass':
        return this.pumpBass;
      case 'synth':
        return this.pumpSynth;
      case 'sfx':
        return this.sfxIn;
      case 'ui':
        return this.uiVol;
    }
  }

  private send(v: Voice, from: AudioNode, to: AudioNode, amount: number): void {
    const g = this.ctx.createGain();
    g.gain.value = clamp(amount, 0, 1);
    from.connect(g);
    g.connect(to);
    v.nodes.push(g);
  }

  private track(v: Voice, src: AudioScheduledSourceNode, t1: number): void {
    v.nodes.push(src);
    v.sources.push(src);
    v.pending++;
    v.end = Math.max(v.end, t1);
    src.onended = () => {
      v.pending--;
      if (v.pending <= 0) this.release(v);
    };
  }

  private release(v: Voice): void {
    if (v.released) return;
    v.released = true;
    v.killed = true;
    for (const s of v.sources) s.onended = null;
    for (const n of v.nodes) n.disconnect();
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /** Найти место под новый голос: при переполнении вытеснить самый старый из наименее важных. */
  private reserve(priority: number): boolean {
    const now = this.ctx.currentTime;
    let live = 0;
    let victim: Voice | null = null;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      // Страховка от утечек: если onended почему-то не пришёл, голос освобождается сам.
      if (v.end < now - 1) {
        this.release(v);
        continue;
      }
      if (v.killed || v.end < now) continue;
      live++;
      if (v.priority > priority) continue;
      if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
    }
    this.liveVoices = Math.min(live + 1, MAX_VOICES);
    if (live < MAX_VOICES) return true;
    if (!victim) return false;
    this.kill(victim, now, 0.015);
    this.stolen++;
    return true;
  }

  private applyLevels(at: number, immediate: boolean): void {
    const l = this.levels;
    const set = (p: AudioParam, value: number) => {
      if (immediate) p.value = value;
      else steer(p, value, at, SMOOTH);
    };
    set(this.master.gain, l.enabled ? 1 : 0);
    set(this.musicVol.gain, MUSIC_LEVEL * sliderGain(l.music));
    set(this.sfxVol.gain, SFX_LEVEL * sliderGain(l.sfx));
    set(this.uiVol.gain, UI_LEVEL * sliderGain(l.sfx));
    // Посылы на общую реверберацию повторяют громкость своих шин.
    set(this.musicSends.verb.gain, this.musicSilenced ? 0 : MUSIC_LEVEL * sliderGain(l.music));
    set(this.sfxSends.verb.gain, SFX_LEVEL * sliderGain(l.sfx));
  }

  /**
   * Посылы шины: вход в общую реверберацию и эхо с обратной связью через фильтры —
   * каждый повтор темнее предыдущего; возврат эха — в ret (вход шины).
   */
  private createSends(ret: AudioNode, feedback: number): Sends {
    const ctx = this.ctx;
    const verb = this.node(ctx.createGain());
    verb.connect(this.reverb);

    const echo = this.node(ctx.createGain());
    const delay = this.node(ctx.createDelay(1));
    delay.delayTime.value = ECHO_SECONDS;
    const dark = this.node(ctx.createBiquadFilter());
    dark.type = 'lowpass';
    dark.frequency.value = 3400;
    dark.Q.value = 0.2;
    const thin = this.node(ctx.createBiquadFilter());
    thin.type = 'highpass';
    thin.frequency.value = 300;
    thin.Q.value = 0.2;
    const fb = this.node(ctx.createGain());
    fb.gain.value = feedback;
    const echoOut = this.node(ctx.createGain());
    echoOut.gain.value = 0.8;
    echo.connect(delay);
    delay.connect(dark).connect(thin);
    thin.connect(fb).connect(delay);
    thin.connect(echoOut).connect(ret);
    return { verb, echo };
  }

  /** Загрузить импульс в свёртку (однократно). */
  private loadReverb(): void {
    if (!this.reverb.buffer) this.reverb.buffer = this.impulse();
  }

  private white(): AudioBuffer {
    if (this.whiteBuf) return this.whiteBuf;
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(rate * NOISE_SECONDS), rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.whiteBuf = buf;
    return buf;
  }

  private brown(): AudioBuffer {
    if (this.brownBuf) return this.brownBuf;
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(rate * NOISE_SECONDS), rate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      // Интегрированный белый шум с утечкой: энергия внизу спектра, без дрейфа постоянной составляющей.
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    this.brownBuf = buf;
    return buf;
  }

  /** Готовый стерео-импульс реверберации: недостающие каналы досинтезируются сразу. */
  private impulse(): AudioBuffer {
    let buf = this.synthImpulseChannel();
    while (this.irChannels < buf.numberOfChannels) buf = this.synthImpulseChannel();
    return buf;
  }

  /**
   * Импульс «неонового зала»: плотный шум, экспоненциальный хвост, темнеющий со временем.
   * За вызов синтезируется один ещё не готовый канал — так warmUp() делит работу пополам.
   */
  private synthImpulseChannel(): AudioBuffer {
    const rate = this.ctx.sampleRate;
    let buf = this.irBuf;
    if (!buf) {
      buf = this.ctx.createBuffer(2, Math.floor(rate * IR_SECONDS), rate);
      this.irBuf = buf;
    }
    const ch = this.irChannels;
    if (ch >= buf.numberOfChannels) return buf;
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / rate;
      const env = Math.exp((-6.9 * t) / IR_SECONDS) * (t < 0.012 ? t / 0.012 : 1);
      // Однополюсный фильтр закрывается к концу хвоста — высокие гаснут быстрее низких.
      const k = 0.85 - 0.7 * (t / IR_SECONDS);
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * env;
    }
    this.irChannels = ch + 1;
    return buf;
  }

  private driveCurve(): Float32Array<ArrayBuffer> {
    if (this.driveCurveData) return this.driveCurveData;
    const n = 1024;
    const c = new Float32Array(n);
    const k = 2.4;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    this.driveCurveData = c;
    return c;
  }
}

/**
 * Кривая выходного ограничителя: до колена сигнал проходит без изменений, выше — плавно
 * прижимается к OUTPUT_CEILING. Вход за пределами ±1 узел сам обрезает до краёв кривой,
 * поэтому выход по модулю никогда не превышает потолок.
 */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4097;
  const knee = 0.72;
  const room = OUTPUT_CEILING - knee;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    c[i] = x < 0 ? -y : y;
  }
  return c;
}
