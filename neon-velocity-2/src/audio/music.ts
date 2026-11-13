/**
 * Секвенсор: раскладывает доли симуляции на инструменты.
 *
 * Доля планируется целиком — все её шестнадцатые сразу, от момента t0 в сетке.
 * Если множитель комбо вырос посреди доли, новые слои доигрывают её остаток
 * (вступают сразу, а не со следующей доли). Срыв комбо — слои «осыпаются»:
 * арпеджио и лид обрываются, пэд гаснет чуть дольше, вся музыка ныряет под фильтр.
 */
import { clamp } from '../core/math';
import { barInLevel, BARS_PER_LEVEL, BEATS_PER_BAR, TICK_DT, TICKS_PER_BEAT, TICKS_PER_STEP } from '../core/timing';
import type { SimEvent } from '../core/types';
import { addedNotes, COMBO_LAYERS, type Instrument, LAYER, type Note, planBeat, type BeatInput } from './arrangement';
import { playNote, riser, STEP_SECONDS } from './instruments';
import type { Mixer, Voice } from './mixer';

export type BeatEvent = Extract<SimEvent, { type: 'beat' }>;

/** Минимальный запас до «сейчас»: в прошлое звук не планируется. */
export const MIN_LEAD = 0.005;
/** Нота, опоздавшая не больше чем на столько, играется немедленно; иначе пропускается. */
const LATE_OK = 0.03;

/** Частота общего фильтра синтов по множителю: музыка «раскрывается» с ростом комбо. */
const TONE_HZ = [1400, 1400, 1600, 1900, 2400, 3300, 4600, 6200, 16000] as const;
/** Глубина «сайдчейна»: с пэдом качает сильнее. */
const PUMP_BASE = 0.45;
const PUMP_PAD = 0.72;
/** При срыве комбо хэты и клэп смолкают последними, через столько секунд. */
const RHYTHM_FALL = 0.1;

/** Запланированная нота — для диагностики и автотестов в браузере. */
export interface ProbeNote {
  inst: Instrument | 'riser';
  layer: number;
  /** Тик симуляции, на который поставлена нота (дробный у тридцать вторых). */
  tick: number;
  /** Момент в шкале звукового контекста. */
  time: number;
  /** Множитель комбо, под который нота запланирована. */
  mult: number;
}
export type Probe = (note: ProbeNote) => void;

interface PlannedBeat {
  input: BeatInput;
  notes: Note[];
  tick: number;
  t0: number;
}

export class Music {
  /** Получатель диагностики; null — выключена. */
  probe: Probe | null = null;

  private readonly mix: Mixer;
  /** Такт, пэд которого уже звучит. */
  private padBar: number | null = null;
  /** Такт, для которого запущен райзер, и его голос. */
  private riserBar: number | null = null;
  private riserVoice: Voice | null = null;
  /** Последняя запланированная доля — её остаток доигрывают новые слои. */
  private last: PlannedBeat | null = null;
  /** Множитель, под который настроен фильтр яркости. */
  private toneMult = 0;

  constructor(mix: Mixer) {
    this.mix = mix;
  }

  /** Новый забег: забыть всё запланированное и закрыть фильтр до x1. */
  reset(now: number): void {
    this.silence(now);
    this.applyTone(1, false, now, 0.03);
  }

  /** Музыка остановлена (пауза, гибель, выход в меню): запланированное больше не действует. */
  silence(now: number): void {
    this.padBar = null;
    this.last = null;
    this.riserBar = null;
    if (this.riserVoice) this.mix.kill(this.riserVoice, now, 0.06);
    this.riserVoice = null;
  }

  /** Сыграть долю ev, стоящую в сетке в момент t0. */
  beat(ev: BeatEvent, t0: number, now: number, mult: number, overdrive: boolean): void {
    const mix = this.mix;
    if (!mix.audible('music')) return;
    const input: BeatInput = {
      bar: ev.bar,
      beatInBar: ev.beatInBar,
      level: ev.level,
      mult,
      overdrive,
      padSounding: this.padBar === ev.bar,
    };
    const notes = planBeat(input);
    this.last = { input, notes, tick: ev.tick, t0 };
    this.applyTone(mult, overdrive, now, 0.12);
    this.schedule(notes, this.last, now, LATE_OK);

    // Райзер восьмого такта: один на такт; после паузы возобновляется с того же места.
    const beatsLeft = BEATS_PER_BAR - ev.beatInBar;
    if (ev.bar >= 0 && barInLevel(ev.bar) === BARS_PER_LEVEL - 1 && this.riserBar !== ev.bar) {
      const impact = t0 + beatsLeft * TICKS_PER_BEAT * TICK_DT;
      const start = Math.max(t0, now + MIN_LEAD);
      this.riserBar = ev.bar;
      this.riserVoice = riser(mix, start, impact, ev.beatInBar / BEATS_PER_BAR);
      if (this.riserVoice) this.probe?.({ inst: 'riser', layer: LAYER.fill, tick: ev.tick, time: start, mult });
    }
  }

  /** Множитель вырос или начался OVERDRIVE: открыть фильтр и доиграть новыми слоями текущую долю. */
  raise(mult: number, overdrive: boolean, now: number): void {
    this.applyTone(mult, overdrive, now, overdrive ? 0.2 : 0.08);
    const last = this.last;
    if (!last || !this.mix.audible('music')) return;
    const input: BeatInput = { ...last.input, mult, overdrive, padSounding: this.padBar === last.input.bar };
    const next = planBeat(input);
    const added = addedNotes(last.notes, next);
    last.input = input;
    last.notes = next;
    this.schedule(added, last, now, 0);
  }

  /** Срыв комбо: слои выше x1 осыпаются, музыка ныряет под фильтр и возвращается уже без них. */
  collapse(now: number): void {
    const mix = this.mix;
    mix.stopTagged(ARP_LAYERS, now, 0.12);
    mix.stopTagged(PAD_LAYERS, now, 0.45);
    mix.stopTagged(RHYTHM_LAYERS, now + RHYTHM_FALL, 0.05);
    mix.musicDive(now, 420, 0.22, 0.12, 0.9);
    this.applyTone(1, false, now, 0.15);
    this.padBar = null;
    const last = this.last;
    if (!last) return;
    // Остаток доли доигрывает рисунок x1 (редкий хэт вместо плотных) — с момента, когда слои уже смолкли.
    const input: BeatInput = { ...last.input, mult: 1, overdrive: false, padSounding: false };
    const kept = last.notes.filter((n) => !COMBO_LAYERS.has(n.layer));
    const next = planBeat(input);
    last.input = input;
    last.notes = next;
    if (mix.audible('music')) this.schedule(addedNotes(kept, next), last, now + RHYTHM_FALL, 0);
  }

  private schedule(notes: readonly Note[], beat: PlannedBeat, now: number, lateOk: number): void {
    const mix = this.mix;
    const { mult, bar } = beat.input;
    const bright = clamp((mult - 1) / 7, 0, 1);
    const earliest = now + MIN_LEAD;
    for (const src of notes) {
      let note = src;
      let t = beat.t0 + note.step * STEP_SECONDS;
      if (t < earliest) {
        if (note.inst === 'pad') {
          // Аккорд вступает с ближайшей шестнадцатой и звучит до конца такта.
          const skip = Math.ceil((earliest - t) / STEP_SECONDS);
          if (note.len - skip < 1) continue;
          note = { ...note, step: note.step + skip, len: note.len - skip };
          t += skip * STEP_SECONDS;
        } else if (t >= now - lateOk) {
          t = earliest;
        } else {
          continue;
        }
      }
      if (note.inst === 'kick') mix.pump(t, mult >= LAYER.pad ? PUMP_PAD : PUMP_BASE);
      if (note.inst === 'pad') this.padBar = bar;
      playNote(mix, note, t, bright);
      this.probe?.({ inst: note.inst, layer: note.layer, tick: beat.tick + note.step * TICKS_PER_STEP, time: t, mult });
    }
  }

  private applyTone(mult: number, overdrive: boolean, now: number, tau: number): void {
    const m = overdrive ? TONE_HZ.length - 1 : clamp(Math.floor(mult), 1, TONE_HZ.length - 2);
    if (m === this.toneMult) return;
    this.toneMult = m;
    this.mix.setTone(TONE_HZ[m], overdrive ? 1.6 : 0.8, now, tau);
  }
}

const ARP_LAYERS: ReadonlySet<number> = new Set([LAYER.arp, LAYER.lead]);
const PAD_LAYERS: ReadonlySet<number> = new Set([LAYER.pad]);
const RHYTHM_LAYERS: ReadonlySet<number> = new Set([LAYER.hats, LAYER.clap]);
