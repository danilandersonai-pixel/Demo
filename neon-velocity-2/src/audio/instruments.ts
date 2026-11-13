/**
 * Инструменты синтвейв-трека: каждая функция собирает один голос через микшер.
 * null-голос (музыка не слышна, предел голосов) — это не ошибка, а тишина.
 *
 * Маршруты: ударные — мимо «сайдчейна»; хэты — через общий ФВЧ; бас и синты —
 * через свои «качающие» шины, синты ещё и через общий фильтр яркости.
 */
import { clamp } from '../core/math';
import { TICK_DT, TICKS_PER_STEP } from '../core/timing';
import { LAYER, type Note } from './arrangement';
import { envHold, envPerc, glide, type Mixer, mtof, PRIORITY, SILENT, type Voice } from './mixer';

/** Шестнадцатая, сек. */
export const STEP_SECONDS = TICKS_PER_STEP * TICK_DT;

function kick(mix: Mixer, t: number, vel: number): void {
  const v = mix.voice('drums', PRIORITY.music, t, { tag: LAYER.base });
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  // Лёгкий перегруз добавляет гармоники — бочку слышно и на маленьких динамиках.
  const shaped = mix.drive(v, amp);
  const pre = mix.gain(v, 0.62, shaped);
  const body = mix.osc(v, 'sine', 165, t, t + 0.36, pre);
  body.frequency.setValueAtTime(168, t);
  body.frequency.exponentialRampToValueAtTime(54, t + 0.07);
  body.frequency.exponentialRampToValueAtTime(41, t + 0.34);
  envPerc(amp.gain, t, 0.92 * vel, 0.0015, 0.33);
  const clickAmp = mix.gain(v, 0, v.out);
  const hp = mix.filter(v, 'highpass', 2400, 0.7, clickAmp);
  mix.noise(v, t, t + 0.03, hp);
  envPerc(clickAmp.gain, t, 0.3 * vel, 0.0008, 0.018);
}

function hat(mix: Mixer, t: number, vel: number, open: boolean, layer: number): void {
  const v = mix.voice('hats', PRIORITY.hat, t, { tag: layer });
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const decay = open ? 0.22 : 0.04;
  mix.noise(v, t, t + decay + 0.02, amp);
  envPerc(amp.gain, t, 0.6 * vel, 0.001, decay);
}

function clap(mix: Mixer, t: number, vel: number): void {
  const v = mix.voice('drums', PRIORITY.music, t, { verb: 0.3, tag: LAYER.clap });
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const bp = mix.filter(v, 'bandpass', 1400, 0.9, amp);
  mix.noise(v, t, t + 0.26, bp);
  const g = amp.gain;
  const peak = 0.8 * vel;
  // Три быстрых «хлопка» и хвост — классический клэп драм-машины.
  g.setValueAtTime(0, t);
  for (let i = 0; i < 3; i++) {
    const at = t + i * 0.0105;
    g.setValueAtTime(peak, at);
    g.exponentialRampToValueAtTime(peak * 0.2, at + 0.009);
  }
  g.setValueAtTime(peak, t + 0.032);
  g.exponentialRampToValueAtTime(SILENT, t + 0.24);
  // Тело малого барабана под хлопком.
  const bodyAmp = mix.gain(v, 0, v.out);
  const body = mix.osc(v, 'triangle', 190, t, t + 0.12, bodyAmp);
  glide(body.frequency, 205, 150, t, t + 0.08);
  envPerc(bodyAmp.gain, t, 0.32 * vel, 0.001, 0.1);
}

function snare(mix: Mixer, t: number, vel: number): void {
  const v = mix.voice('drums', PRIORITY.music, t, { verb: 0.2, tag: LAYER.fill });
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const hp = mix.filter(v, 'highpass', 1500, 0.8, amp);
  mix.noise(v, t, t + 0.12, hp);
  envPerc(amp.gain, t, 0.42 * vel, 0.001, 0.085);
  const bodyAmp = mix.gain(v, 0, v.out);
  const body = mix.osc(v, 'triangle', 210, t, t + 0.09, bodyAmp);
  glide(body.frequency, 225, 165, t, t + 0.06);
  envPerc(bodyAmp.gain, t, 0.34 * vel, 0.001, 0.07);
}

function crash(mix: Mixer, t: number, vel: number, layer: number): void {
  const v = mix.voice('drums', PRIORITY.music, t, { verb: 0.3, tag: layer });
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const hp = mix.filter(v, 'highpass', 4500, 0.5, amp);
  mix.noise(v, t, t + 1.5, hp);
  envPerc(amp.gain, t, 0.26 * vel, 0.002, 1.45);
}

function bass(mix: Mixer, t: number, dur: number, midi: number, vel: number, bright: number): void {
  const v = mix.voice('bass', PRIORITY.music, t, { tag: LAYER.base });
  if (!v) return;
  const f = mtof(midi);
  const amp = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 400, 4, amp);
  const end = t + dur + 0.07;
  mix.osc(v, 'sawtooth', f, t, end, lp);
  const squareAmp = mix.gain(v, 0.5, lp);
  mix.osc(v, 'square', f, t, end, squareAmp, -7);
  // Чистый синус под пилой — вес на низах без грязи.
  const subAmp = mix.gain(v, 0.75, amp);
  mix.osc(v, 'sine', f, t, end, subAmp);
  const peak = 420 + 1300 * bright;
  const cut = lp.frequency;
  cut.setValueAtTime(peak * 2.2, t);
  cut.exponentialRampToValueAtTime(peak, t + 0.03);
  cut.exponentialRampToValueAtTime(170, t + dur);
  envHold(amp.gain, t, 0.3 * vel, 0.004, 0.05, 0.75, dur, 0.05);
}

function pad(mix: Mixer, t: number, dur: number, notes: readonly number[]): void {
  const v = mix.voice('synth', PRIORITY.pad, t, { verb: 0.36, tag: LAYER.pad });
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 3000, 0.8, amp);
  // Генераторы живут до конца затухания огибающей — иначе короткий аккорд обрывался бы щелчком.
  const end = envHold(amp.gain, t, 0.15, 0.05, 0.25, 0.85, Math.max(dur - 0.04, 0.1), 0.42) + 0.02;
  for (const n of notes) {
    const f = mtof(n);
    // Две расстроенные пилы на голос — «широкий» аналоговый пэд.
    mix.osc(v, 'sawtooth', f, t, end, lp, -10 + Math.random() * 2);
    mix.osc(v, 'sawtooth', f, t, end, lp, 10 - Math.random() * 2);
  }
  const lowAmp = mix.gain(v, 0.8, lp);
  mix.osc(v, 'triangle', mtof(notes[0] - 12), t, end, lowAmp);
  mix.lfo(v, 0.21, 700, [lp.frequency], t, end);
}

function arp(mix: Mixer, t: number, dur: number, midi: number, vel: number, bright: number, pan: number): void {
  const v = mix.voice('synth', PRIORITY.music, t, { echo: 0.28, verb: 0.12, pan, tag: LAYER.arp });
  if (!v) return;
  const f = mtof(midi);
  const amp = mix.gain(v, 0, v.out);
  const cutoff = 1500 + 3200 * bright;
  const lp = mix.filter(v, 'lowpass', cutoff, 3, amp);
  const end = t + dur + 0.14;
  mix.osc(v, 'sawtooth', f, t, end, lp);
  const squareAmp = mix.gain(v, 0.5, lp);
  mix.osc(v, 'square', f, t, end, squareAmp, 6);
  const cut = lp.frequency;
  cut.setValueAtTime(cutoff * 2, t);
  cut.exponentialRampToValueAtTime(cutoff * 0.45, t + dur);
  envHold(amp.gain, t, 0.3 * vel, 0.003, 0.05, 0.5, dur, 0.12);
}

function lead(mix: Mixer, t: number, dur: number, midi: number, vel: number): void {
  const v = mix.voice('synth', PRIORITY.music, t, { echo: 0.32, verb: 0.2, tag: LAYER.lead });
  if (!v) return;
  const f = mtof(midi);
  const amp = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 5600, 1.4, amp);
  const end = t + dur + 0.22;
  const a = mix.osc(v, 'sawtooth', f, t, end, lp, -8);
  const b = mix.osc(v, 'sawtooth', f, t, end, lp, 8);
  const lowAmp = mix.gain(v, 0.35, lp);
  mix.osc(v, 'square', f / 2, t, end, lowAmp);
  // Вибрато вступает не сразу — как у живого исполнителя.
  mix.lfo(v, 5.6, 11, [a.detune, b.detune], t + Math.min(0.09, dur * 0.5), end);
  envHold(amp.gain, t, 0.18 * vel, 0.012, 0.08, 0.8, dur * 0.9, 0.18);
}

/** Сыграть ноту аранжировки в момент t. bright — яркость 0..1 от множителя комбо. */
export function playNote(mix: Mixer, note: Note, t: number, bright: number): void {
  const dur = note.len * STEP_SECONDS;
  switch (note.inst) {
    case 'kick':
      kick(mix, t, note.vel);
      break;
    case 'hat':
      hat(mix, t, note.vel, false, note.layer);
      break;
    case 'openHat':
      hat(mix, t, note.vel, true, note.layer);
      break;
    case 'clap':
      clap(mix, t, note.vel);
      break;
    case 'snare':
      snare(mix, t, note.vel);
      break;
    case 'crash':
      crash(mix, t, note.vel, note.layer);
      break;
    case 'bass':
      bass(mix, t, dur, note.midi, note.vel, bright);
      break;
    case 'pad':
      pad(mix, t, dur, note.chord ?? [note.midi]);
      break;
    case 'arp':
      // Арпеджио «перекидывается» между каналами по шестнадцатым.
      arp(mix, t, dur, note.midi, note.vel, bright, Math.floor(note.step) % 2 === 0 ? -0.3 : 0.3);
      break;
    case 'lead':
      lead(mix, t, dur, note.midi, note.vel);
      break;
  }
}

/**
 * Райзер перед новым уровнем: шум и пила ползут вверх ровно к моменту удара impact.
 * from — какая доля подъёма уже пройдена к start (райзер, возобновлённый после паузы,
 * продолжает с того же места, а не с нижней ноты). Возвращает голос, чтобы его можно было оборвать.
 */
export function riser(mix: Mixer, start: number, impact: number, from: number): Voice | null {
  const v = mix.voice('drums', PRIORITY.accent, start, { verb: 0.3, tag: LAYER.fill });
  if (!v) return null;
  const p = clamp(from, 0, 0.95);
  const end = impact + 0.05;
  const top = Math.max(impact - 0.015, start + 0.01);
  const noiseAmp = mix.gain(v, 0, v.out);
  const bp = mix.filter(v, 'bandpass', 350, 2.2, noiseAmp);
  mix.noise(v, start, end, bp);
  glide(bp.frequency, 350 * Math.pow(8000 / 350, p), 8000, start, impact);
  noiseAmp.gain.setValueAtTime(Math.max(SILENT, 0.3 * p * p), start);
  noiseAmp.gain.exponentialRampToValueAtTime(0.3, top);
  noiseAmp.gain.linearRampToValueAtTime(0, impact + 0.04);

  const sawAmp = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 500, 5, sawAmp);
  const saw = mix.osc(v, 'sawtooth', 110, start, end, lp);
  glide(saw.frequency, 110 * Math.pow(8, p), 880, start, impact);
  glide(lp.frequency, 500 * Math.pow(12, p), 6000, start, impact);
  sawAmp.gain.setValueAtTime(Math.max(SILENT, 0.08 * p * p), start);
  sawAmp.gain.exponentialRampToValueAtTime(0.08, top);
  sawAmp.gain.linearRampToValueAtTime(0, impact + 0.04);
  return v;
}
