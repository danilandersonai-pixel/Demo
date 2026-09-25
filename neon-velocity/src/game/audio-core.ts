/**
 * Ядро процедурного звука (Web Audio, никаких файлов).
 *
 * Граф микшера:
 *   музыка: голоса ─► pumpPad / pumpBass / musicIn ─► фильтр ─► duck ─► fade ─► vol ─┐
 *   эффекты: голоса ─► sfxIn ─► vol ─────────────────────────────────────────────────┴─► gate ─┐
 *   интерфейс: голоса ─► uiVol ─────────────────── (мимо gate — меню паузы звучит) ───────────┴─► master ─► компрессор ─► лимитер ─► выход
 * У музыки и у эффектов свои посылы на реверберацию и темповое эхо (возврат — во вход шины),
 * поэтому громкость, пауза и «затухание при смерти» действуют и на хвосты.
 *
 * Голос — все узлы одного звука. Mixer держит лимит одновременных голосов
 * (вытесняет самый старый из наименее важных) и отключает узлы, как только все
 * источники голоса отыграли, — граф не разрастается.
 */
import { clamp } from './math';

/** Куда подключается голос. drums / bass / pad — части музыки (у bass и pad свой «сайдчейн»). */
export type Route = 'drums' | 'bass' | 'pad' | 'sfx' | 'ui';
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

const ROUTE_BUS: Record<Route, BusId> = { drums: 'music', bass: 'music', pad: 'music', sfx: 'sfx', ui: 'ui' };

/** Предел одновременно звучащих (и запланированных) голосов. */
export const MAX_VOICES = 64;
/** Практическая тишина для экспоненциальных огибающих (−80 дБ). */
export const SILENT = 1e-4;

/** Базовые уровни шин до пользовательской громкости. */
const MUSIC_LEVEL = 0.5;
const SFX_LEVEL = 1.4;
const UI_LEVEL = 1.2;
/** Постоянная времени сглаживания громкостей, сек — без щелчков. */
const SMOOTH = 0.025;
/** Длина импульса реверберации, сек. */
const IR_SECONDS = 1.9;
const NOISE_SECONDS = 2;
/** Частота «открытого» музыкального фильтра. */
const OPEN_HZ = 18000;

export interface VoiceOptions {
  /** Панорама −1..1. */
  pan?: number;
  /** Посыл на реверберацию 0..1. */
  verb?: number;
  /** Посыл на эхо 0..1. */
  echo?: number;
}

export interface Voice {
  readonly bus: BusId;
  readonly priority: number;
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

interface Sends {
  verb: GainNode;
  echo: GainNode;
  delay: DelayNode;
}

export function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Громкость ползунка → усиление: квадратичная кривая звучит равномернее линейной. */
function sliderGain(v: number): number {
  const x = clamp(v, 0, 1);
  return x * x;
}

/** Детерминированный ГПСЧ — одинаковый импульс реверберации при каждом запуске. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

/** Экспоненциальный glide частоты from → to за [t0, t1]. */
export function glide(p: AudioParam, from: number, to: number, t0: number, t1: number): void {
  p.setValueAtTime(Math.max(from, 1e-3), t0);
  p.exponentialRampToValueAtTime(Math.max(to, 1e-3), Math.max(t1, t0 + 1e-3));
}

// ─── Микшер ─────────────────────────────────────────────────────────────────

export class Mixer {
  readonly ctx: BaseAudioContext;

  private readonly master: GainNode;
  private readonly gate: GainNode;
  private readonly musicIn: GainNode;
  private readonly musicFilter: BiquadFilterNode;
  private readonly musicDuck: GainNode;
  private readonly musicFade: GainNode;
  private readonly musicVol: GainNode;
  private readonly pumpPad: GainNode;
  private readonly pumpBass: GainNode;
  private readonly sfxIn: GainNode;
  private readonly sfxVol: GainNode;
  private readonly uiVol: GainNode;
  private readonly musicSends: Sends;
  private readonly sfxSends: Sends;
  /** Все узлы шин — чтобы dispose() отключил граф целиком. */
  private readonly busNodes: AudioNode[] = [];

  private readonly voices: Voice[] = [];
  private levels: Levels = { enabled: true, music: 0.7, sfx: 0.8 };
  private gateOpen = true;
  /** Музыка приглушена «до нуля» (смерть, выход в меню) — новые голоса музыки не нужны. */
  private musicSilenced = false;
  /** Последний момент автоматизации «сайдчейна» — события должны идти по возрастанию времени. */
  private lastPumpAt = -1;

  private whiteBuf: AudioBuffer | null = null;
  private brownBuf: AudioBuffer | null = null;
  private irBuf: AudioBuffer | null = null;
  private curve: Float32Array<ArrayBuffer> | null = null;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;

    // Выходная ступень: мягкий компрессор склеивает микс, лимитер не даёт клиповать.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 14;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.09;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    this.master = this.node(ctx.createGain());
    this.master.connect(comp).connect(limiter).connect(out).connect(ctx.destination);
    this.busNodes.push(comp, limiter, out);

    this.gate = this.node(ctx.createGain());
    this.gate.connect(this.master);

    // Музыка.
    this.musicIn = this.node(ctx.createGain());
    this.musicFilter = this.node(ctx.createBiquadFilter());
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = OPEN_HZ;
    this.musicFilter.Q.value = 0.5;
    this.musicDuck = this.node(ctx.createGain());
    this.musicFade = this.node(ctx.createGain());
    this.musicVol = this.node(ctx.createGain());
    this.musicIn.connect(this.musicFilter).connect(this.musicDuck).connect(this.musicFade).connect(this.musicVol);
    this.musicVol.connect(this.gate);
    this.pumpPad = this.node(ctx.createGain());
    this.pumpPad.connect(this.musicIn);
    this.pumpBass = this.node(ctx.createGain());
    this.pumpBass.connect(this.musicIn);
    this.musicSends = this.createSends(this.musicIn, 0.36, 0.34, 0.8);

    // Эффекты.
    this.sfxIn = this.node(ctx.createGain());
    this.sfxVol = this.node(ctx.createGain());
    this.sfxIn.connect(this.sfxVol).connect(this.gate);
    this.sfxSends = this.createSends(this.sfxIn, 0.13, 0.3, 0.7);

    // Интерфейс — мимо gate: кнопки меню паузы должны звучать.
    this.uiVol = this.node(ctx.createGain());
    this.uiVol.connect(this.master);

    this.applyLevels(ctx.currentTime, true);
  }

  // ── Состояние шин ──

  /** Громкости и общий выключатель (плавно). */
  setLevels(levels: Levels, at: number): void {
    this.levels = { enabled: levels.enabled, music: clamp(levels.music, 0, 1), sfx: clamp(levels.sfx, 0, 1) };
    this.applyLevels(at, false);
  }

  /** Пауза: закрыть/открыть музыку и игровые эффекты (интерфейс не трогается). */
  setGate(open: boolean, at: number): void {
    this.gateOpen = open;
    const g = this.gate.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(open ? 1 : 0, at, open ? 0.02 : 0.035);
  }

  /** Слышна ли шина — если нет, голоса не создаются вовсе (экономия потока). */
  audible(bus: BusId): boolean {
    const l = this.levels;
    if (!l.enabled) return false;
    if (bus === 'ui') return l.sfx > 0.001;
    if (!this.gateOpen) return false;
    if (bus === 'music') return l.music > 0.001 && !this.musicSilenced;
    return l.sfx > 0.001;
  }

  /** «Сайдчейн» от бочки: пэд и лид проседают глубоко, бас — слегка, и плавно возвращаются к концу доли. */
  pump(t: number, beat: number): void {
    const at = Math.max(t, this.lastPumpAt + 0.001);
    this.lastPumpAt = at + 0.03;
    const pad = this.pumpPad.gain;
    pad.setTargetAtTime(0.3, at, 0.006);
    pad.setTargetAtTime(1, at + 0.03, beat * 0.2);
    const bass = this.pumpBass.gain;
    bass.setTargetAtTime(0.55, at, 0.004);
    bass.setTargetAtTime(1, at + 0.03, beat * 0.12);
  }

  /** Эхо музыки — пунктирная восьмая текущего темпа. */
  setEchoTempo(bpm: number, at: number): void {
    const target = clamp((60 / bpm) * 0.75, 0.05, 1.5);
    const d = this.musicSends.delay.delayTime;
    if (Math.abs(d.value - target) < 1e-4) return;
    d.setTargetAtTime(target, at, 0.08);
  }

  /** Приглушить музыку под важный эффект (фанфара, удар уровня). */
  duckMusic(at: number, depth: number, hold: number, release: number): void {
    const g = this.musicDuck.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(clamp(depth, 0, 1), at, 0.02);
    g.setTargetAtTime(1, at + hold, release / 3);
  }

  /** Короткий «провал» фильтра музыки — удар по щиту глушит мир на мгновение. */
  musicDip(at: number, hz: number, hold: number): void {
    const f = this.musicFilter.frequency;
    f.cancelScheduledValues(at);
    f.setTargetAtTime(hz, at, 0.02);
    f.setTargetAtTime(OPEN_HZ, at + hold, 0.18);
  }

  /** Музыка уходит: фильтр закрывается (как «уплывающая плёнка»), громкость гаснет за seconds. */
  musicDown(at: number, seconds: number): void {
    this.musicSilenced = true;
    const f = this.musicFilter.frequency;
    f.cancelScheduledValues(at);
    f.setTargetAtTime(220, at, seconds * 0.3);
    const q = this.musicFilter.Q;
    q.cancelScheduledValues(at);
    q.setTargetAtTime(6, at, 0.05);
    const g = this.musicFade.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0, at, seconds / 4);
  }

  /** Вернуть музыку в исходное состояние (новый забег). */
  musicUp(at: number): void {
    this.musicSilenced = false;
    const f = this.musicFilter.frequency;
    f.cancelScheduledValues(at);
    f.setTargetAtTime(OPEN_HZ, at, 0.02);
    const q = this.musicFilter.Q;
    q.cancelScheduledValues(at);
    q.setTargetAtTime(0.5, at, 0.02);
    for (const g of [this.musicFade.gain, this.musicDuck.gain, this.pumpPad.gain, this.pumpBass.gain]) {
      g.cancelScheduledValues(at);
      g.setTargetAtTime(1, at, 0.015);
    }
    this.lastPumpAt = at;
  }

  // ── Голоса ──

  /**
   * Начать голос с началом в момент t. null — голос не нужен: шина не слышна
   * или лимит занят более важными звуками.
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
    const sends = bus === 'music' ? this.musicSends : this.sfxSends;
    if (opts?.verb) this.send(v, tail, sends.verb, opts.verb);
    if (opts?.echo) this.send(v, tail, sends.echo, opts.echo);
    this.voices.push(v);
    return v;
  }

  /** Быстро заглушить и остановить все голоса шины (пауза, смена экрана). */
  stopBus(bus: BusId, at: number, fade: number): void {
    for (const v of this.voices) if (v.bus === bus) this.kill(v, at, fade);
  }

  /** Заглушить голос за fade секунд начиная с at. */
  kill(v: Voice, at: number, fade: number): void {
    if (v.killed || v.released) return;
    v.killed = true;
    const g = v.out.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0, at, Math.max(fade, 0.004) / 4);
    const stopAt = at + Math.max(fade, 0.004);
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

  /** Шум (белый или «коричневый» — глухой рокот) с произвольного места буфера. */
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

  /** Мягкий перегруз (tanh) — плотность саб-удару и взрыву. */
  drive(v: Voice, dest: AudioNode): WaveShaperNode {
    const w = this.ctx.createWaveShaper();
    w.curve = this.driveCurve();
    w.oversample = '2x';
    w.connect(dest);
    v.nodes.push(w);
    return w;
  }

  /** Синусоидальная модуляция параметра (вибрато, «дыхание» фильтра). */
  lfo(v: Voice, rate: number, depth: number, param: AudioParam, t0: number, t1: number): void {
    const g = this.ctx.createGain();
    g.gain.value = depth;
    g.connect(param);
    v.nodes.push(g);
    this.osc(v, 'sine', rate, t0, t1, g);
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
      case 'bass':
        return this.pumpBass;
      case 'pad':
        return this.pumpPad;
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
    if (live < MAX_VOICES) return true;
    if (!victim) return false;
    this.kill(victim, now, 0.015);
    return true;
  }

  private applyLevels(at: number, immediate: boolean): void {
    const l = this.levels;
    const set = (p: AudioParam, value: number) => {
      if (immediate) {
        p.value = value;
      } else {
        p.cancelScheduledValues(at);
        p.setTargetAtTime(value, at, SMOOTH);
      }
    };
    set(this.master.gain, l.enabled ? 1 : 0);
    set(this.musicVol.gain, MUSIC_LEVEL * sliderGain(l.music));
    set(this.sfxVol.gain, SFX_LEVEL * sliderGain(l.sfx));
    set(this.uiVol.gain, UI_LEVEL * sliderGain(l.sfx));
  }

  /**
   * Посылы шины: реверберация (свёртка с синтетическим импульсом) и эхо с
   * обратной связью через фильтр — каждый повтор темнее предыдущего.
   */
  private createSends(ret: AudioNode, echoTime: number, feedback: number, verbLevel: number): Sends {
    const ctx = this.ctx;
    const verb = this.node(ctx.createGain());
    const conv = this.node(ctx.createConvolver());
    conv.buffer = this.impulse();
    const verbOut = this.node(ctx.createGain());
    verbOut.gain.value = verbLevel;
    verb.connect(conv).connect(verbOut).connect(ret);

    const echo = this.node(ctx.createGain());
    const delay = this.node(ctx.createDelay(2));
    delay.delayTime.value = echoTime;
    const tone = this.node(ctx.createBiquadFilter());
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    tone.Q.value = 0.2;
    const low = this.node(ctx.createBiquadFilter());
    low.type = 'highpass';
    low.frequency.value = 280;
    low.Q.value = 0.2;
    const fb = this.node(ctx.createGain());
    fb.gain.value = feedback;
    const echoOut = this.node(ctx.createGain());
    echoOut.gain.value = 0.8;
    echo.connect(delay);
    delay.connect(tone).connect(low);
    low.connect(fb).connect(delay);
    low.connect(echoOut).connect(ret);
    return { verb, echo, delay };
  }

  private white(): AudioBuffer {
    if (this.whiteBuf) return this.whiteBuf;
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(rate * NOISE_SECONDS), rate);
    const d = buf.getChannelData(0);
    const rnd = mulberry32(0x0b5e55ed);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
    this.whiteBuf = buf;
    return buf;
  }

  private brown(): AudioBuffer {
    if (this.brownBuf) return this.brownBuf;
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(rate * NOISE_SECONDS), rate);
    const d = buf.getChannelData(0);
    const rnd = mulberry32(0x0b20a1);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      // Интегрированный белый шум с утечкой: энергия внизу спектра, без дрейфа постоянной составляющей.
      last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    this.brownBuf = buf;
    return buf;
  }

  /** Стерео-импульс «неонового зала»: плотный шум, экспоненциальный хвост, темнеющий со временем. */
  private impulse(): AudioBuffer {
    if (this.irBuf) return this.irBuf;
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * IR_SECONDS);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const rnd = mulberry32(0x5eed + ch * 7919);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const env = Math.exp((-6.9 * t) / IR_SECONDS) * (t < 0.012 ? t / 0.012 : 1);
        // Однополюсный фильтр закрывается к концу хвоста — высокие гаснут быстрее низких.
        const k = 0.85 - 0.7 * (t / IR_SECONDS);
        lp += ((rnd() * 2 - 1) - lp) * k;
        d[i] = lp * env;
      }
    }
    this.irBuf = buf;
    return buf;
  }

  private driveCurve(): Float32Array<ArrayBuffer> {
    if (this.curve) return this.curve;
    const n = 1024;
    const c = new Float32Array(n);
    const k = 2.4;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    this.curve = c;
    return c;
  }

  /** Отключить весь граф (закрытие движка). */
  dispose(): void {
    for (const v of [...this.voices]) this.release(v);
    for (const n of this.busNodes) n.disconnect();
  }
}
