/**
 * Звуковые эффекты игры и интерфейса — всё синтезируется на лету.
 * Тональные эффекты живут в ля-минорной пентатонике, поэтому ложатся на любой
 * аккорд трека без фальши. Каждая функция собирает один голос через микшер;
 * null-голос (звук выключен, предел голосов) — это не ошибка, а тишина.
 */
import { clamp } from '../core/math';
import { ladderNote } from './harmony';
import { STEP_SECONDS } from './instruments';
import { envHold, envPerc, glide, type Mixer, mtof, PRIORITY, SILENT, type Voice } from './mixer';
import type { UiSound } from './uiSound';

/** Серия коротких затухающих вспышек громкости со случайным шагом — треск, осколки, обломки. */
function bursts(p: AudioParam, t: number, count: number, span: number, peak: number, len: number): void {
  const slot = span / count;
  p.setValueAtTime(0, t);
  for (let i = 0; i < count; i++) {
    const at = t + slot * i + Math.random() * slot * 0.5;
    // Вспышка гаснет до начала следующего слота — события автоматизации идут строго по порядку.
    const end = at + Math.min(len, slot * 0.5);
    p.setValueAtTime(peak * (1 - i / (count + 1)), at);
    p.exponentialRampToValueAtTime(SILENT, end);
  }
}

// ─── Сферы и комбо ──────────────────────────────────────────────────────────

/**
 * Нота мелодии от собранной сферы: звонкий щипок с «стеклянным» обертоном.
 * energy 0..1 — множитель комбо: чем выше, тем ярче; в OVERDRIVE добавляется искра октавой выше.
 */
export function sfxCollect(mix: Mixer, t: number, midi: number, pan: number, energy: number, overdrive: boolean): void {
  const v = mix.voice('sfx', PRIORITY.sfx, t, { pan, echo: 0.22, verb: 0.14 });
  if (!v) return;
  const f = mtof(midi);
  const amp = mix.gain(v, 0, v.out);
  const body = mix.osc(v, 'triangle', f, t, t + 0.34, amp);
  glide(body.frequency, f * 0.97, f, t, t + 0.016);
  const hiAmp = mix.gain(v, 0.28 + 0.22 * energy, amp);
  mix.osc(v, 'sine', f * 2, t, t + 0.34, hiAmp);
  const bellAmp = mix.gain(v, 0.1 + 0.06 * energy, amp);
  mix.osc(v, 'sine', f * 3.01, t, t + 0.18, bellAmp);
  if (overdrive) {
    const sparkAmp = mix.gain(v, 0.14, amp);
    mix.osc(v, 'sine', f * 4, t, t + 0.14, sparkAmp);
  }
  envPerc(amp.gain, t, 0.42, 0.002, 0.3);
  const tickAmp = mix.gain(v, 0, v.out);
  const hp = mix.filter(v, 'highpass', 6000, 0.7, tickAmp);
  mix.noise(v, t, t + 0.03, hp);
  envPerc(tickAmp.gain, t, 0.08, 0.001, 0.02);
}

/** Редкая сфера: искрящееся арпеджио вверх по notes со «стеклянным» обертоном и мерцанием. */
export function sfxCollectRare(mix: Mixer, t: number, notes: readonly number[], pan: number): void {
  const v = mix.voice('sfx', PRIORITY.accent, t, { pan, verb: 0.34, echo: 0.24 });
  if (!v) return;
  for (let i = 0; i < notes.length; i++) {
    // Тридцать вторые: арпеджио взлетает внутри одной восьмой.
    const at = t + (i * STEP_SECONDS) / 2;
    const f = mtof(notes[i]);
    const g = mix.gain(v, 0, v.out);
    mix.osc(v, 'triangle', f, at, at + 0.42, g);
    const bell = mix.gain(v, 0.16, g);
    mix.osc(v, 'sine', f * 2.76, at, at + 0.42, bell);
    envPerc(g.gain, at, 0.17, 0.002, 0.38);
  }
  const shimmer = mix.gain(v, 0, v.out);
  const bp = mix.filter(v, 'bandpass', 9000, 1.4, shimmer);
  mix.noise(v, t, t + 0.75, bp);
  envHold(shimmer.gain, t, 0.1, 0.04, 0.12, 0.5, 0.3, 0.35);
}

/** Сфера пролетела мимо: короткий глухой «провал». */
export function sfxMiss(mix: Mixer, t: number, pan: number): void {
  const v = mix.voice('sfx', PRIORITY.sfx, t, { pan });
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 1400, 0.7, amp);
  const o = mix.osc(v, 'triangle', 330, t, t + 0.16, lp);
  glide(o.frequency, 330, 185, t, t + 0.12);
  envPerc(amp.gain, t, 0.2, 0.003, 0.14);
  const puffAmp = mix.gain(v, 0, v.out);
  const bp = mix.filter(v, 'bandpass', 700, 1, puffAmp);
  mix.noise(v, t, t + 0.08, bp);
  envPerc(puffAmp.gain, t, 0.1, 0.002, 0.06);
}

/** Рост множителя: восходящий аккорд-«страм» и звонкая нота сверху; чем выше множитель, тем выше аккорд. */
export function sfxComboUp(mix: Mixer, t: number, multiplier: number): void {
  const v = mix.voice('sfx', PRIORITY.accent, t, { verb: 0.24, echo: 0.2 });
  if (!v) return;
  const root = ladderNote(clamp(multiplier - 2, 0, 9)) - 12;
  const amp = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 800, 4, amp);
  glide(lp.frequency, 700, 5200, t, t + 0.16);
  lp.frequency.exponentialRampToValueAtTime(1500, t + 0.45);
  const intervals = [0, 7, 12, 19];
  for (let i = 0; i < intervals.length; i++) {
    mix.osc(v, 'sawtooth', mtof(root + intervals[i]), t + i * 0.028, t + 0.56, lp, i % 2 === 0 ? -6 : 6);
  }
  envHold(amp.gain, t, 0.12, 0.01, 0.12, 0.55, 0.2, 0.3);
  const ding = mix.gain(v, 0, v.out);
  mix.osc(v, 'sine', mtof(root + 24), t + 0.09, t + 0.62, ding);
  envPerc(ding.gain, t + 0.09, 0.09, 0.002, 0.48);
}

/**
 * Срыв комбо: нисходящий диссонирующий свип и «осыпающиеся» ноты — по одной на
 * каждую потерянную ступень множителя. soft — тише (главный звук — удар в щит).
 */
export function sfxComboBreak(mix: Mixer, t: number, lost: number, soft: boolean): void {
  const v = mix.voice('sfx', PRIORITY.sfx, t, { verb: 0.16 });
  if (!v) return;
  const intensity = clamp(0.75 + 0.05 * lost, 0.75, 1.15) * (soft ? 0.55 : 1);
  const amp = mix.gain(v, 0, v.out);
  const trem = mix.gain(v, 0.7, amp);
  const lp = mix.filter(v, 'lowpass', 2400, 5, trem);
  glide(lp.frequency, 2600, 240, t, t + 0.42);
  const a = mix.osc(v, 'sawtooth', 520, t, t + 0.46, lp);
  glide(a.frequency, 520, 70, t, t + 0.42);
  // Полутон выше — тревожное биение.
  const b = mix.osc(v, 'square', 551, t, t + 0.46, lp);
  glide(b.frequency, 551, 74, t, t + 0.42);
  mix.lfo(v, 21, 0.3, [trem.gain], t, t + 0.46);
  envPerc(amp.gain, t, 0.3 * intensity, 0.004, 0.42);

  const falls = clamp(Math.floor(lost), 2, 7);
  for (let i = 0; i < falls; i++) {
    const at = t + 0.03 + i * 0.05;
    const f = mtof(ladderNote(8 - i));
    const g = mix.gain(v, 0, v.out);
    const o = mix.osc(v, 'triangle', f, at, at + 0.16, g);
    glide(o.frequency, f, f * 0.94, at, at + 0.14);
    envPerc(g.gain, at, 0.11 * intensity * (1 - i / (falls + 3)), 0.002, 0.13);
  }
}

/** Начало OVERDRIVE: взлёт шума, раскрывающийся пауэр-аккорд и звон сверху. */
export function sfxOverdrive(mix: Mixer, t: number): void {
  const v = mix.voice('sfx', PRIORITY.critical, t, { verb: 0.32, echo: 0.2 });
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 600, 3, amp);
  glide(lp.frequency, 600, 7500, t, t + 0.26);
  lp.frequency.exponentialRampToValueAtTime(2200, t + 0.8);
  for (const n of [57, 64, 69, 76]) {
    mix.osc(v, 'sawtooth', mtof(n), t, t + 0.95, lp, -7);
    mix.osc(v, 'sawtooth', mtof(n), t, t + 0.95, lp, 7);
  }
  envHold(amp.gain, t, 0.085, 0.02, 0.2, 0.6, 0.45, 0.45);
  const upAmp = mix.gain(v, 0, v.out);
  const bp = mix.filter(v, 'bandpass', 800, 2, upAmp);
  mix.noise(v, t, t + 0.36, bp);
  glide(bp.frequency, 800, 9000, t, t + 0.3);
  envPerc(upAmp.gain, t, 0.16, 0.05, 0.3);
  const bells = [93, 96, 100];
  for (let i = 0; i < bells.length; i++) {
    const at = t + 0.12 + i * 0.07;
    const g = mix.gain(v, 0, v.out);
    mix.osc(v, 'sine', mtof(bells[i]), at, at + 0.6, g);
    envPerc(g.gain, at, 0.06, 0.002, 0.5);
  }
}

// ─── Опасность ──────────────────────────────────────────────────────────────

/** «Почти задел»: свист шума с пролётом по панораме и короткий «вжик». */
export function sfxNearMiss(mix: Mixer, t: number, pan: number): void {
  const v = mix.voice('sfx', PRIORITY.sfx, t, { pan: pan === 0 ? 0.001 : pan, echo: 0.1 });
  if (!v) return;
  const amp = mix.gain(v, 0, v.out);
  const bp = mix.filter(v, 'bandpass', 600, 1.4, amp);
  mix.noise(v, t, t + 0.36, bp);
  bp.frequency.setValueAtTime(600, t);
  bp.frequency.exponentialRampToValueAtTime(5200, t + 0.11);
  bp.frequency.exponentialRampToValueAtTime(1300, t + 0.33);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.62, t + 0.07);
  amp.gain.exponentialRampToValueAtTime(SILENT, t + 0.34);
  if (v.pan) {
    v.pan.pan.setValueAtTime(clamp(pan, -1, 1), t);
    v.pan.pan.linearRampToValueAtTime(clamp(-pan * 0.6, -1, 1), t + 0.3);
  }
  const zipAmp = mix.gain(v, 0, v.out);
  const zip = mix.osc(v, 'sine', 2100, t + 0.04, t + 0.17, zipAmp);
  glide(zip.frequency, 2100, 900, t + 0.04, t + 0.15);
  envPerc(zipAmp.gain, t + 0.04, 0.05, 0.002, 0.1);
}

/** Щит принял удар: звон стекла (негармонические парциалы), треск осколков и глухой удар. */
export function sfxShieldBreak(mix: Mixer, t: number, pan: number): void {
  const v = mix.voice('sfx', PRIORITY.critical, t, { pan: pan * 0.5, verb: 0.38 });
  if (!v) return;
  const ratios = [1, 2.32, 3.87, 5.43, 7.11, 9.02];
  for (let i = 0; i < ratios.length; i++) {
    const at = t + i * 0.004;
    const g = mix.gain(v, 0, v.out);
    mix.osc(v, 'sine', 1180 * ratios[i] * (1 + (Math.random() - 0.5) * 0.012), at, at + 1.05, g);
    envPerc(g.gain, at, 0.085 / (1 + i * 0.35), 0.001, 0.95 / (1 + i * 0.45));
  }
  const crackle = mix.gain(v, 0, v.out);
  const hp = mix.filter(v, 'highpass', 4500, 0.7, crackle);
  mix.noise(v, t, t + 0.34, hp);
  bursts(crackle.gain, t, 6, 0.24, 0.26, 0.03);
  const thumpAmp = mix.gain(v, 0, v.out);
  const thump = mix.osc(v, 'sine', 150, t, t + 0.36, thumpAmp);
  glide(thump.frequency, 150, 42, t, t + 0.26);
  envPerc(thumpAmp.gain, t, 0.62, 0.002, 0.32);
  const thudAmp = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 900, 0.8, thudAmp);
  mix.noise(v, t, t + 0.14, lp);
  envPerc(thudAmp.gain, t, 0.3, 0.001, 0.11);
}

/** Гибель: шум с падающим фильтром через перегруз, рокот, саб-удар, обломки и «выключение питания». */
export function sfxDeath(mix: Mixer, t: number, pan: number): void {
  const v = mix.voice('sfx', PRIORITY.critical, t, { pan: pan * 0.4, verb: 0.4 });
  if (!v) return;
  const blastAmp = mix.gain(v, 0, v.out);
  const blastDrive = mix.drive(v, blastAmp);
  const blastLp = mix.filter(v, 'lowpass', 9000, 2.5, blastDrive);
  mix.noise(v, t, t + 1.9, blastLp);
  glide(blastLp.frequency, 9000, 130, t, t + 1.45);
  envHold(blastAmp.gain, t, 0.42, 0.004, 0.25, 0.55, 0.3, 1.25);

  const rumbleAmp = mix.gain(v, 0, v.out);
  const rumbleLp = mix.filter(v, 'lowpass', 380, 0.7, rumbleAmp);
  mix.noise(v, t, t + 2.3, rumbleLp, 'brown');
  envPerc(rumbleAmp.gain, t, 0.8, 0.012, 2.1);

  const subAmp = mix.gain(v, 0, v.out);
  const subDrive = mix.drive(v, subAmp);
  const sub = mix.osc(v, 'sine', 180, t, t + 1.45, subDrive);
  glide(sub.frequency, 180, 28, t, t + 1.1);
  envPerc(subAmp.gain, t, 0.62, 0.003, 1.35);

  const debrisAmp = mix.gain(v, 0, v.out);
  const debrisBp = mix.filter(v, 'bandpass', 2600, 1.2, debrisAmp);
  mix.noise(v, t + 0.06, t + 0.95, debrisBp);
  bursts(debrisAmp.gain, t + 0.06, 7, 0.75, 0.2, 0.05);

  const downAmp = mix.gain(v, 0, v.out);
  const downLp = mix.filter(v, 'lowpass', 2400, 3, downAmp);
  const down = mix.osc(v, 'sawtooth', 720, t + 0.02, t + 1.02, downLp);
  glide(down.frequency, 720, 38, t + 0.02, t + 0.95);
  envPerc(downAmp.gain, t + 0.02, 0.1, 0.01, 0.95);
}

/** Экран Game Over: мягкое нисходящее арпеджио ля минора. */
export function sfxGameOver(mix: Mixer, t: number): void {
  const v = mix.voice('sfx', PRIORITY.accent, t, { verb: 0.45, echo: 0.22 });
  if (!v) return;
  const notes = [69, 64, 60, 57];
  for (let i = 0; i < notes.length; i++) {
    const at = t + i * 0.17;
    const last = i === notes.length - 1;
    const g = mix.gain(v, 0, v.out);
    const lp = mix.filter(v, 'lowpass', 2200, 1, g);
    const f = mtof(notes[i]);
    mix.osc(v, 'triangle', f, at, at + (last ? 1.5 : 0.62), lp);
    mix.osc(v, 'sawtooth', f, at, at + (last ? 1.5 : 0.62), lp, 5);
    envPerc(g.gain, at, last ? 0.1 : 0.075, 0.006, last ? 1.4 : 0.55);
  }
}

// ─── Уровни и рекорды ───────────────────────────────────────────────────────

/**
 * Удар нового уровня («дроп»): саб-бум, тарелка и пауэр-аккорд от корня root.
 * sweep — добавить короткий взлёт шума (если райзер не прозвучал: пауза, выключенная музыка).
 */
export function sfxLevelUp(mix: Mixer, t: number, root: number, sweep: boolean): void {
  const v = mix.voice('sfx', PRIORITY.critical, t, { verb: 0.4 });
  if (!v) return;
  const boomAmp = mix.gain(v, 0, v.out);
  const boomDrive = mix.drive(v, boomAmp);
  const boom = mix.osc(v, 'sine', 110, t, t + 0.8, boomDrive);
  glide(boom.frequency, 115, 38, t, t + 0.6);
  envPerc(boomAmp.gain, t, 0.55, 0.002, 0.72);

  const crashAmp = mix.gain(v, 0, v.out);
  const hp = mix.filter(v, 'highpass', 3500, 0.5, crashAmp);
  mix.noise(v, t, t + 1.6, hp);
  envPerc(crashAmp.gain, t, 0.2, 0.002, 1.5);

  const stabAmp = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 4200, 2, stabAmp);
  glide(lp.frequency, 4200, 900, t, t + 0.6);
  for (const iv of [0, 7, 12, 19]) {
    mix.osc(v, 'sawtooth', mtof(root + iv), t, t + 1.05, lp, -5);
    mix.osc(v, 'sawtooth', mtof(root + iv), t, t + 1.05, lp, 5);
  }
  envHold(stabAmp.gain, t, 0.075, 0.005, 0.2, 0.4, 0.25, 0.6);

  if (sweep) {
    const upAmp = mix.gain(v, 0, v.out);
    const bp = mix.filter(v, 'bandpass', 900, 2, upAmp);
    mix.noise(v, t, t + 0.3, bp);
    glide(bp.frequency, 900, 8000, t, t + 0.25);
    envPerc(upAmp.gain, t, 0.14, 0.03, 0.24);
  }
}

/** «NEW RECORD!»: медная фанфара та-да-да-ДАМ и колокольчики. */
export function sfxNewRecord(mix: Mixer, t: number): void {
  const v = mix.voice('sfx', PRIORITY.critical, t, { verb: 0.38, echo: 0.18 });
  if (!v) return;
  const brass = (at: number, midi: number, dur: number, peak: number) => {
    const g = mix.gain(v, 0, v.out);
    const lp = mix.filter(v, 'lowpass', 800, 2, g);
    const f = mtof(midi);
    mix.osc(v, 'sawtooth', f, at, at + dur + 0.45, lp, -6);
    mix.osc(v, 'sawtooth', f, at, at + dur + 0.45, lp, 6);
    lp.frequency.setValueAtTime(700, at);
    lp.frequency.exponentialRampToValueAtTime(3600, at + 0.06);
    lp.frequency.exponentialRampToValueAtTime(1500, at + dur);
    envHold(g.gain, at, peak, 0.012, 0.08, 0.7, dur, 0.4);
  };
  // Затакт шестнадцатыми в темпе трека — фанфара не спорит с ритмом.
  brass(t, 67, 0.08, 0.11);
  brass(t + STEP_SECONDS, 72, 0.08, 0.11);
  brass(t + STEP_SECONDS * 2, 76, 0.08, 0.11);
  for (const n of [72, 76, 79, 84]) brass(t + STEP_SECONDS * 3, n, 0.75, 0.075);
  const bells = [84, 88, 91, 96];
  for (let i = 0; i < bells.length; i++) {
    const at = t + STEP_SECONDS * 3 + 0.02 + i * 0.06;
    const g = mix.gain(v, 0, v.out);
    mix.osc(v, 'sine', mtof(bells[i]), at, at + 0.7, g);
    envPerc(g.gain, at, 0.065, 0.002, 0.6);
  }
}

// ─── Старт забега ───────────────────────────────────────────────────────────

function beep(mix: Mixer, v: Voice, at: number, midi: number, peak: number, hold: number): void {
  const g = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 3200, 1, g);
  mix.osc(v, 'square', mtof(midi), at, at + hold + 0.25, lp);
  const octave = mix.gain(v, 0.4, lp);
  mix.osc(v, 'triangle', mtof(midi + 12), at, at + hold + 0.25, octave);
  envHold(g.gain, at, peak, 0.004, 0.03, 0.8, hold, 0.18);
}

/** READY: «зарядка» — пила и шум ползут вверх весь такт вступления, к моменту GO. */
export function sfxReady(mix: Mixer, start: number, go: number): Voice | null {
  const v = mix.voice('sfx', PRIORITY.accent, start, { verb: 0.28 });
  if (!v) return null;
  const end = go + 0.05;
  const chargeAmp = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', 260, 5, chargeAmp);
  const saw = mix.osc(v, 'sawtooth', 55, start, end, lp);
  glide(saw.frequency, 55, 220, start, go);
  glide(lp.frequency, 260, 3600, start, go);
  chargeAmp.gain.setValueAtTime(SILENT, start);
  chargeAmp.gain.exponentialRampToValueAtTime(0.1, go - 0.02);
  chargeAmp.gain.linearRampToValueAtTime(0, go + 0.04);
  const airAmp = mix.gain(v, 0, v.out);
  const bp = mix.filter(v, 'bandpass', 500, 1.8, airAmp);
  mix.noise(v, start, end, bp);
  glide(bp.frequency, 500, 6500, start, go);
  airAmp.gain.setValueAtTime(SILENT, start);
  airAmp.gain.exponentialRampToValueAtTime(0.14, go - 0.02);
  airAmp.gain.linearRampToValueAtTime(0, go + 0.04);
  return v;
}

/** Сигнал отсчёта на доле вступления: beat = −4…−1, последний — громче и длиннее. */
export function sfxCount(mix: Mixer, t: number, beat: number): void {
  const v = mix.voice('sfx', PRIORITY.accent, t, { verb: 0.2 });
  if (!v) return;
  const last = beat >= -1;
  beep(mix, v, t, 76, last ? 0.13 : 0.1, last ? 0.14 : 0.09);
}

/** GO!: высокий сигнал на тонике, звонкое арпеджио, тарелка и саб-удар. */
export function sfxGo(mix: Mixer, t: number): void {
  const v = mix.voice('sfx', PRIORITY.critical, t, { verb: 0.32, echo: 0.18 });
  if (!v) return;
  beep(mix, v, t, 81, 0.14, 0.26);
  const chimes = [81, 84, 88, 93, 100];
  for (let i = 0; i < chimes.length; i++) {
    const at = t + 0.03 + i * 0.03;
    const g = mix.gain(v, 0, v.out);
    mix.osc(v, 'triangle', mtof(chimes[i]), at, at + 0.4, g);
    envPerc(g.gain, at, 0.055, 0.002, 0.35);
  }
  const crashAmp = mix.gain(v, 0, v.out);
  const hp = mix.filter(v, 'highpass', 4000, 0.5, crashAmp);
  mix.noise(v, t, t + 1.3, hp);
  envPerc(crashAmp.gain, t, 0.18, 0.002, 1.2);
  const boomAmp = mix.gain(v, 0, v.out);
  const boom = mix.osc(v, 'sine', 120, t, t + 0.5, boomAmp);
  glide(boom.frequency, 120, 44, t, t + 0.4);
  envPerc(boomAmp.gain, t, 0.4, 0.002, 0.45);
}

// ─── Интерфейс ──────────────────────────────────────────────────────────────

/** Короткий тон с глиссандо f0 → f1 — основа звуков интерфейса. */
function blip(
  mix: Mixer,
  v: Voice,
  at: number,
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  peak: number,
  lpHz = 6000,
): void {
  const g = mix.gain(v, 0, v.out);
  const lp = mix.filter(v, 'lowpass', lpHz, 0.7, g);
  const o = mix.osc(v, type, f0, at, at + dur + 0.02, lp);
  if (f1 !== f0) glide(o.frequency, f0, f1, at, at + dur * 0.6);
  envPerc(g.gain, at, peak, 0.002, dur);
}

/** Звуки меню: тихие и короткие, чтобы не утомлять. */
export function sfxUi(mix: Mixer, t: number, sound: UiSound): void {
  const v = mix.voice('ui', sound === 'hover' ? PRIORITY.tick : PRIORITY.sfx, t);
  if (!v) return;
  switch (sound) {
    case 'hover': {
      const f = 2300 + Math.random() * 160;
      blip(mix, v, t, 'sine', f, f, 0.026, 0.035);
      break;
    }
    case 'click':
      blip(mix, v, t, 'square', 700, 1050, 0.055, 0.06, 2800);
      blip(mix, v, t, 'sine', 1400, 1400, 0.02, 0.05);
      break;
    case 'back':
      blip(mix, v, t, 'triangle', 760, 430, 0.1, 0.13, 3000);
      break;
    case 'buy':
      // Монетка: си → ми и искра сверху.
      blip(mix, v, t, 'square', mtof(83), mtof(83), 0.07, 0.055, 5000);
      blip(mix, v, t + 0.075, 'square', mtof(88), mtof(88), 0.28, 0.055, 5000);
      blip(mix, v, t + 0.14, 'triangle', mtof(95), mtof(95), 0.3, 0.05);
      break;
    case 'equip':
      blip(mix, v, t, 'sawtooth', mtof(64), mtof(64), 0.14, 0.06, 2400);
      blip(mix, v, t + 0.06, 'sawtooth', mtof(71), mtof(71), 0.22, 0.06, 3200);
      blip(mix, v, t + 0.06, 'sine', mtof(83), mtof(83), 0.25, 0.04);
      break;
    case 'error':
      for (const at of [t, t + 0.12]) {
        blip(mix, v, at, 'square', 147, 140, 0.09, 0.04, 1100);
        blip(mix, v, at, 'square', 156, 149, 0.09, 0.04, 1100);
      }
      break;
    case 'toggle':
      blip(mix, v, t, 'sine', 1000, 1000, 0.03, 0.07);
      blip(mix, v, t + 0.035, 'sine', 1500, 1500, 0.035, 0.06);
      break;
  }
}
