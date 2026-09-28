/**
 * Синтвейв-музыка, которая собирается из beat-событий движка.
 *
 * BeatClock переводит долю движка во время звукового контекста:
 * ctx.currentTime + LATENCY − lateBy, а затем «захватывает фазу» — если удар
 * близок к ожидаемому по темпу, он ставится ровно в сетку с мягкой подстройкой,
 * поэтому дрожание кадров не слышно. Он же считает время забега по долям и
 * заранее знает, когда будет следующий уровень (для райзера и сбивки).
 *
 * Music раскладывает долю на инструменты: бочка на каждую долю, клэп на 2 и 4,
 * хэты восьмыми (с 5-го уровня — шестнадцатыми), бас-арпеджио восьмыми по
 * Am–F–C–G (аккорд на такт из 4 долей), пэд с «сайдчейном», лид с 3-го уровня.
 */
import { GAME } from './config';
import { clamp } from './math';
import type { GameEvent } from './types';
import { envHold, envPerc, glide, type Mixer, mtof, PRIORITY, SILENT } from './audio-core';

export type BeatEvent = Extract<GameEvent, { type: 'beat' }>;

/** Опережение планирования ударов, сек: запас на дрожание кадров. */
export const LATENCY = 0.05;
/** Окно захвата фазы: удар дальше этого от ожидаемого — новая привязка (после паузы, лага). */
const LOCK_WINDOW = 0.035;
/** Доля ошибки, которую подстройка отрабатывает за одну долю. */
const LOCK_GAIN = 0.12;
/** Минимальный запас до «сейчас» — в прошлое звук не планируется. */
const MIN_LEAD = 0.004;

export interface RiserWindow {
  start: number;
  impact: number;
  level: number;
}

export class BeatClock {
  private lastIndex = -1;
  private lastTime = 0;
  private lastBpm: number = GAME.rhythm.bpmBase;
  /** Время забега на текущей доле: сумма длительностей прошедших долей. */
  private runClock = 0;
  /** Уровень, для которого райзер уже запланирован. */
  private riserLevel = 0;

  /** Новый забег: счёт долей и привязка с нуля. */
  reset(): void {
    this.lastIndex = -1;
    this.lastTime = 0;
    this.runClock = 0;
    this.riserLevel = 0;
  }

  /** Запланированный райзер отменён (пауза, смерть) — его можно запланировать снова. */
  cancelRiser(): void {
    this.riserLevel = 0;
  }

  /** Время удара доли в шкале звукового контекста. */
  place(ev: BeatEvent, now: number): number {
    const bpm = ev.bpm > 0 ? ev.bpm : this.lastBpm;
    let t = now + LATENCY - clamp(ev.lateBy, 0, 0.1);
    const continuous = this.lastIndex >= 0 && ev.index > this.lastIndex;
    if (continuous) {
      this.runClock += (ev.index - this.lastIndex) * (60 / this.lastBpm);
      if (ev.index === this.lastIndex + 1) {
        const expected = this.lastTime + 60 / this.lastBpm;
        const err = t - expected;
        if (Math.abs(err) < LOCK_WINDOW) t = expected + err * LOCK_GAIN;
      }
    } else {
      this.runClock = ev.index * (60 / bpm);
    }
    t = Math.max(t, now + MIN_LEAD);
    if (continuous) t = Math.max(t, this.lastTime + 0.05);
    this.lastIndex = ev.index;
    this.lastTime = t;
    this.lastBpm = bpm;
    return t;
  }

  /** Сколько секунд от этой доли до следующего повышения уровня. */
  toLevelUp(ev: BeatEvent): number {
    return ev.level * GAME.levelDuration - this.runClock;
  }

  /**
   * Окно райзера, если повышение уровня наступит раньше, чем через length + одна доля.
   * Выдаётся один раз на уровень; t — время текущей доли.
   */
  riserWindow(ev: BeatEvent, t: number, length: number): RiserWindow | null {
    const next = ev.level + 1;
    if (this.riserLevel === next) return null;
    const toUp = this.toLevelUp(ev);
    const period = 60 / (ev.bpm > 0 ? ev.bpm : this.lastBpm);
    if (!(toUp > 0.08) || toUp > length + period) return null;
    this.riserLevel = next;
    return { start: t + Math.max(0, toUp - length), impact: t + toUp, level: next };
  }
}

// ─── Гармония ───────────────────────────────────────────────────────────────

interface Chord {
  /** Корень баса (MIDI). */
  bass: number;
  /** Голоса пэда. */
  pad: readonly number[];
  /** Ноты лид-арпеджио снизу вверх. */
  lead: readonly number[];
}

/** Am – F – C – G: по аккорду на такт. */
const PROGRESSION: readonly Chord[] = [
  { bass: 33, pad: [57, 60, 64], lead: [69, 72, 76, 81] },
  { bass: 29, pad: [57, 60, 65], lead: [65, 69, 72, 77] },
  { bass: 36, pad: [55, 60, 64], lead: [67, 72, 76, 79] },
  { bass: 31, pad: [55, 59, 62], lead: [67, 71, 74, 79] },
];

/** Бас восьмыми (интервалы от корня): «октавная качка», с 4-го уровня — с квинтой в конце такта. */
const BASS_PUMP = [0, 12, 0, 12, 0, 12, 0, 12] as const;
const BASS_DRIVE = [0, 12, 0, 12, 0, 12, 7, 12] as const;
/** Лид-арпеджио: индексы нот аккорда — восьмыми и шестнадцатыми. */
const LEAD_8 = [0, 2, 1, 2, 3, 2, 1, 2] as const;
const LEAD_16 = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 3, 2, 1, 2] as const;
/** Громкость хэтов в доле из шестнадцатых: сильная, слабая, офбит, слабая. */
const HAT_16 = [0.2, 0.11, 0.34, 0.13] as const;

// ─── Секвенсор ──────────────────────────────────────────────────────────────

export class Music {
  private readonly mix: Mixer;

  constructor(mix: Mixer) {
    this.mix = mix;
  }

  /** Сыграть долю ev в момент t. toLevelUp — сколько секунд до нового уровня (для сбивки). */
  play(ev: BeatEvent, t: number, toLevelUp: number): void {
    const mix = this.mix;
    if (!mix.audible('music')) return;
    const B = 60 / ev.bpm;
    const level = Math.max(1, ev.level);
    const beat = ev.index % 4;
    const bar = Math.floor(ev.index / 4);
    const chord = PROGRESSION[bar % PROGRESSION.length];
    const buildUp = toLevelUp > 0.05 && toLevelUp <= B;

    mix.pump(t, B);
    mix.setEchoTempo(ev.bpm, t);

    // Ударные.
    kick(mix, t);
    if (beat === 1 || beat === 3) clap(mix, t, 0.85);
    if (ev.index % 32 === 0) crash(mix, t, ev.index === 0 ? 0.55 : 0.4);
    if (buildUp) {
      // Сбивка перед новым уровнем: шестнадцатые клэпы с нарастанием до самого удара.
      for (let k = 1; k < 4; k++) {
        const at = t + (B * k) / 4;
        if (at < t + toLevelUp - 0.02) clap(mix, at, 0.35 + 0.18 * k);
      }
    } else if (level >= 2 && bar % 4 === 3 && beat === 3) {
      clap(mix, t + (B * 3) / 4, 0.35);
      clap(mix, t + (B * 7) / 8, 0.45);
    }

    if (level >= 5) {
      for (let k = 0; k < 4; k++) {
        const open = k === 2 && beat === 3;
        hat(mix, t + (B * k) / 4, HAT_16[k], open);
      }
    } else {
      hat(mix, t, 0.18, false);
      hat(mix, t + B / 2, 0.34, level >= 2 && beat === 3);
    }

    // Бас: две восьмые на долю.
    const pattern = level >= 4 ? BASS_DRIVE : BASS_PUMP;
    for (let k = 0; k < 2; k++) {
      bass(mix, t + (B * k) / 2, B * 0.42, chord.bass + pattern[beat * 2 + k], level);
    }

    // Пэд — аккорд на весь такт.
    if (beat === 0) pad(mix, t, B * 4, chord.pad, level);

    // Лид с 3-го уровня; с 6-го — шестнадцатыми.
    if (level >= 3) {
      if (level >= 6) {
        for (let k = 0; k < 4; k++) lead(mix, t + (B * k) / 4, B * 0.2, chord.lead[LEAD_16[beat * 4 + k]], level);
      } else {
        for (let k = 0; k < 2; k++) lead(mix, t + (B * k) / 2, B * 0.34, chord.lead[LEAD_8[beat * 2 + k]], level);
      }
    }
  }
}

// ─── Инструменты ────────────────────────────────────────────────────────────

function kick(mix: Mixer, t: number): void {
  const v = mix.voice('drums', PRIORITY.music, t);
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const body = mix.osc(v, 'sine', 160, t, t + 0.42, amp);
  body.frequency.setValueAtTime(170, t);
  body.frequency.exponentialRampToValueAtTime(54, t + 0.075);
  body.frequency.exponentialRampToValueAtTime(40, t + 0.4);
  envPerc(amp.gain, t, 0.95, 0.002, 0.4);
  // Щелчок атаки — чтобы бочка читалась и на маленьких динамиках.
  const clickAmp = mix.gain(v, 0, v.out);
  const hp = mix.filter(v, 'highpass', 2200, 0.7, clickAmp);
  mix.noise(v, t, t + 0.03, hp);
  envPerc(clickAmp.gain, t, 0.32, 0.0008, 0.02);
}

function clap(mix: Mixer, t: number, vel: number): void {
  const v = mix.voice('drums', PRIORITY.music, t, { verb: 0.28 });
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const bp = mix.filter(v, 'bandpass', 1350, 0.9, amp);
  mix.noise(v, t, t + 0.26, bp);
  const g = amp.gain;
  const peak = 0.85 * vel;
  // Три быстрых «хлопка» и хвост — классический клэп драм-машины.
  g.setValueAtTime(0, t);
  for (let i = 0; i < 3; i++) {
    const at = t + i * 0.0105;
    g.setValueAtTime(peak, at);
    g.exponentialRampToValueAtTime(peak * 0.2, at + 0.009);
  }
  g.setValueAtTime(peak, t + 0.032);
  g.exponentialRampToValueAtTime(SILENT, t + 0.24);
  // Тело малого барабана.
  const bodyAmp = mix.gain(v, 0, v.out);
  const body = mix.osc(v, 'triangle', 190, t, t + 0.12, bodyAmp);
  glide(body.frequency, 200, 150, t, t + 0.08);
  envPerc(bodyAmp.gain, t, 0.3 * vel, 0.001, 0.1);
}

function hat(mix: Mixer, t: number, vel: number, open: boolean): void {
  const v = mix.voice('drums', PRIORITY.hat, t);
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const hp = mix.filter(v, 'highpass', open ? 6500 : 7800, 0.8, amp);
  const decay = open ? 0.26 : 0.045;
  mix.noise(v, t, t + decay + 0.02, hp);
  envPerc(amp.gain, t, 0.55 * vel, 0.001, decay);
}

function crash(mix: Mixer, t: number, vel: number): void {
  const v = mix.voice('drums', PRIORITY.music, t, { verb: 0.3 });
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const hp = mix.filter(v, 'highpass', 4200, 0.5, amp);
  mix.noise(v, t, t + 1.7, hp);
  envPerc(amp.gain, t, 0.3 * vel, 0.002, 1.65);
}

function bass(mix: Mixer, t: number, dur: number, midi: number, level: number): void {
  const v = mix.voice('bass', PRIORITY.music, t);
  if (!v) return;
  const f = mtof(midi);
  const amp = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 400, 5, amp);
  const end = t + dur + 0.06;
  mix.osc(v, 'sawtooth', f, t, end, lp);
  mix.osc(v, 'square', f, t, end, lp, -7);
  // Чистый синус под пилой — вес на низах без грязи.
  const subAmp = mix.gain(v, 0.6, amp);
  mix.osc(v, 'sine', f, t, end, subAmp);
  const peak = 380 + 90 * Math.min(level, 10);
  const lf = lp.frequency;
  lf.setValueAtTime(peak * 2.4, t);
  lf.exponentialRampToValueAtTime(peak, t + 0.03);
  lf.exponentialRampToValueAtTime(170, t + dur);
  envHold(amp.gain, t, 0.12, 0.004, 0.06, 0.7, dur, 0.05);
}

function pad(mix: Mixer, t: number, dur: number, notes: readonly number[], level: number): void {
  const v = mix.voice('pad', PRIORITY.pad, t, { verb: 0.42 });
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const cutoff = 900 + 130 * Math.min(level, 10);
  const lp = mix.filter(v, 'lowpass', cutoff, 1.2, amp);
  const end = t + dur + 0.9;
  for (const n of notes) {
    const f = mtof(n);
    // Две расстроенные пилы на голос — «широкий» аналоговый пэд.
    mix.osc(v, 'sawtooth', f, t, end, lp, -9 + Math.random() * 2);
    mix.osc(v, 'sawtooth', f, t, end, lp, 9 - Math.random() * 2);
  }
  mix.lfo(v, 0.23, cutoff * 0.28, lp.frequency, t, end);
  envHold(amp.gain, t, 0.07, Math.min(0.35, dur * 0.3), 0.3, 0.8, dur, 0.85);
}

function lead(mix: Mixer, t: number, dur: number, midi: number, level: number): void {
  const v = mix.voice('pad', PRIORITY.music, t, { echo: 0.34, verb: 0.16 });
  if (!v) return;
  const f = mtof(midi);
  const amp = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 1800 + 220 * Math.min(level, 10), 3, amp);
  const end = t + dur + 0.2;
  mix.osc(v, 'square', f, t, end, lp);
  mix.osc(v, 'sawtooth', f, t, end, lp, 7);
  envPerc(amp.gain, t, level >= 6 ? 0.075 : 0.09, 0.003, dur + 0.16);
}
