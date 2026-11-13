/**
 * Аранжировка: что играет в одной доле. Чистая функция от положения в треке и
 * множителя комбо — без Web Audio, поэтому проверяется автотестами.
 *
 * Слои включаются множителем комбо:
 *   x1 — бочка, бас, редкие хэты (офбит);      x2 — плотные хэты шестнадцатыми;
 *   x3 — клэп на 2-ю и 4-ю доли;                x4 — пэд-аккорд на такт;
 *   x5 — арпеджио восьмыми, x6 — шестнадцатыми, x7 — широкое, через октаву;
 *   OVERDRIVE — лид поверх всего, на октаву выше арпеджио.
 * Уровень скорости на слои не влияет, он уплотняет сам рисунок: бас переходит с
 * восьмых на шестнадцатые, у бочки появляется затакт, у хэтов — тридцать вторые.
 * В восьмом такте уровня — нарастающая дробь малого барабана, а на последней доле
 * бочка и бас замолкают: тишина перед ударом нового уровня.
 */
import { barInLevel, BARS_PER_LEVEL, BEATS_PER_BAR } from '../core/timing';
import { chordFor } from './harmony';

export type Instrument = 'kick' | 'hat' | 'openHat' | 'clap' | 'snare' | 'crash' | 'bass' | 'pad' | 'arp' | 'lead';

/**
 * Слои аранжировки. Значение — множитель, с которого слой звучит (FILL и LEAD — особые),
 * оно же метка голосов слоя в микшере.
 */
export const LAYER = {
  /** Дробь перед новым уровнем — от множителя не зависит. */
  fill: 0,
  base: 1,
  hats: 2,
  clap: 3,
  pad: 4,
  arp: 5,
  /** Только в OVERDRIVE. */
  lead: 8,
} as const;
export type Layer = (typeof LAYER)[keyof typeof LAYER];

/** Слои, которые осыпаются при срыве комбо (всё, что выше x1). */
export const COMBO_LAYERS: ReadonlySet<number> = new Set([LAYER.hats, LAYER.clap, LAYER.pad, LAYER.arp, LAYER.lead]);

export function layerOn(layer: Layer, mult: number, overdrive: boolean): boolean {
  if (layer === LAYER.fill) return true;
  if (layer === LAYER.lead) return overdrive;
  return mult >= layer;
}

export interface Note {
  inst: Instrument;
  layer: Layer;
  /** Позиция от начала доли в шестнадцатых: 0…<4 (дробная — тридцать вторые). */
  step: number;
  /** Длительность в шестнадцатых. */
  len: number;
  /** Высота (MIDI); у ударных — 0. */
  midi: number;
  /** Голоса аккорда (только pad). */
  chord: readonly number[] | null;
  /** Громкость 0..1. */
  vel: number;
}

export interface BeatInput {
  /** Такт от GO (во вступлении −1). */
  bar: number;
  /** Доля в такте 0..3. */
  beatInBar: number;
  level: number;
  /** Множитель комбо 1..8. */
  mult: number;
  overdrive: boolean;
  /** Пэд этого такта уже звучит (иначе он стартует с текущей доли — после паузы или роста комбо). */
  padSounding: boolean;
}

const STEPS_PER_BEAT = 4;

/** Плотные хэты: сильная, слабая, офбит, слабая. */
const HAT_16 = [0.38, 0.2, 0.6, 0.24] as const;
/** Арпеджио: индексы нот аккорда на такт — восьмыми, шестнадцатыми и «широкое». */
const ARP_8 = [0, 2, 1, 2, 3, 2, 1, 2] as const;
const ARP_16 = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 3, 2, 1, 2] as const;
const ARP_WIDE = [0, 2, 4, 2, 5, 4, 2, 4, 0, 2, 4, 2, 5, 4, 3, 1] as const;

/** Нота лида: позиция в такте (шестнадцатые), индекс ноты аккорда, длительность. */
type LeadNote = readonly [pos: number, index: number, len: number];
/** Двухтактовый хук лида: синкопа 3 + 3 + 2. */
const LEAD_HOOK: readonly (readonly LeadNote[])[] = [
  [
    [0, 2, 3],
    [3, 1, 3],
    [6, 2, 2],
    [8, 3, 4],
    [12, 2, 2],
    [14, 1, 2],
  ],
  [
    [0, 0, 3],
    [3, 1, 3],
    [6, 2, 2],
    [8, 1, 4],
    [12, 0, 2],
    [14, 1, 2],
  ],
];

/** Дробь восьмого такта по долям: позиции ударов; громкость растёт от начала такта к концу. */
const FILL_STEPS: readonly (readonly number[])[] = [
  [0, 2],
  [0, 2, 3],
  [0, 1, 2, 3],
  [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
];

function drum(inst: Instrument, layer: Layer, step: number, vel: number): Note {
  return { inst, layer, step, len: 1, midi: 0, chord: null, vel };
}

function tone(inst: Instrument, layer: Layer, step: number, len: number, midi: number, vel: number): Note {
  return { inst, layer, step, len, midi, chord: null, vel };
}

/** Ноты одной доли, по возрастанию позиции внутри каждого инструмента. */
export function planBeat(input: BeatInput): Note[] {
  const { bar, beatInBar: b, level, mult, overdrive } = input;
  const notes: Note[] = [];

  // Вступление: только тиканье хэтов — задаёт темп под отсчёт.
  if (bar < 0) {
    notes.push(drum('hat', LAYER.base, 0, 0.3), drum('hat', LAYER.base, 2, 0.22));
    return notes;
  }

  const inLevel = barInLevel(bar);
  const buildBar = inLevel === BARS_PER_LEVEL - 1;
  const lastBeat = buildBar && b === BEATS_PER_BAR - 1;
  const chord = chordFor(level, bar);
  const dense = layerOn(LAYER.hats, mult, overdrive);

  // Бочка: «четыре в пол»; с 4-го уровня — затакт в конце чётных тактов.
  if (!lastBeat) {
    notes.push(drum('kick', LAYER.base, 0, 1));
    if (level >= 4 && b === BEATS_PER_BAR - 1 && inLevel % 2 === 1) notes.push(drum('kick', LAYER.base, 3, 0.7));
  }

  // Хэты: редкий офбит на x1, шестнадцатые с x2.
  if (dense) {
    for (let k = 0; k < STEPS_PER_BEAT; k++) {
      const open = k === 2 && b === BEATS_PER_BAR - 1 && (level >= 2 || mult >= LAYER.pad);
      notes.push(drum(open ? 'openHat' : 'hat', LAYER.hats, k, open ? 0.5 : HAT_16[k]));
    }
    if (level >= 5 && b % 2 === 1) notes.push(drum('hat', LAYER.hats, 3.5, 0.16));
    if (inLevel === BARS_PER_LEVEL / 2 && b === 0) notes.push(drum('crash', LAYER.hats, 0, 0.5));
  } else {
    notes.push(drum('hat', LAYER.base, 2, 0.5));
  }

  if (layerOn(LAYER.clap, mult, overdrive) && b % 2 === 1 && !lastBeat) notes.push(drum('clap', LAYER.clap, 0, 0.9));

  // Бас: восьмые на первых уровнях, дальше — «катящиеся» шестнадцатые через октаву.
  if (!lastBeat) {
    const r = chord.bass;
    const turn = b === BEATS_PER_BAR - 1;
    if (level <= 2) {
      notes.push(tone('bass', LAYER.base, 0, 1.7, r, 0.9), tone('bass', LAYER.base, 2, 1.7, turn ? r + 12 : r, 0.75));
    } else if (level <= 5) {
      notes.push(
        tone('bass', LAYER.base, 0, 0.85, r, 0.9),
        tone('bass', LAYER.base, 1, 0.85, r, 0.55),
        tone('bass', LAYER.base, 2, 0.85, r + 12, 0.8),
        tone('bass', LAYER.base, 3, 0.85, r, 0.55),
      );
    } else {
      notes.push(
        tone('bass', LAYER.base, 0, 0.85, r, 0.9),
        tone('bass', LAYER.base, 1, 0.85, r + 12, 0.6),
        tone('bass', LAYER.base, 2, 0.85, turn ? r + 7 : r, 0.8),
        tone('bass', LAYER.base, 3, 0.85, r + 12, 0.65),
      );
    }
  }

  // Пэд: аккорд до конца такта.
  if (layerOn(LAYER.pad, mult, overdrive) && (b === 0 || !input.padSounding)) {
    notes.push({ inst: 'pad', layer: LAYER.pad, step: 0, len: (BEATS_PER_BAR - b) * STEPS_PER_BEAT, midi: chord.pad[0], chord: chord.pad, vel: 1 });
  }

  // Арпеджио на октаву выше нот аккорда.
  if (layerOn(LAYER.arp, mult, overdrive)) {
    if (mult === LAYER.arp) {
      for (let k = 0; k < 2; k++) {
        notes.push(tone('arp', LAYER.arp, k * 2, 1.6, chord.arp[ARP_8[b * 2 + k]] + 12, k === 0 ? 1 : 0.8));
      }
    } else {
      const pattern = mult >= LAYER.arp + 2 ? ARP_WIDE : ARP_16;
      for (let k = 0; k < STEPS_PER_BEAT; k++) {
        notes.push(tone('arp', LAYER.arp, k, 0.9, chord.arp[pattern[b * STEPS_PER_BEAT + k]] + 12, k === 0 ? 1 : 0.75));
      }
    }
  }

  // Лид OVERDRIVE: ещё на октаву выше арпеджио.
  if (layerOn(LAYER.lead, mult, overdrive)) {
    for (const [pos, index, len] of LEAD_HOOK[bar % LEAD_HOOK.length]) {
      if (Math.floor(pos / STEPS_PER_BEAT) === b) {
        notes.push(tone('lead', LAYER.lead, pos - b * STEPS_PER_BEAT, len, chord.arp[index] + 24, 1));
      }
    }
  }

  // Дробь перед новым уровнем.
  if (buildBar) {
    const steps = FILL_STEPS[b];
    for (let i = 0; i < steps.length; i++) {
      const progress = (b + steps[i] / STEPS_PER_BEAT) / BEATS_PER_BAR;
      notes.push(drum('snare', LAYER.fill, steps[i], 0.28 + 0.72 * progress * progress));
    }
  }

  return notes;
}

/** Ключ ноты внутри доли: один и тот же звук в двух планах одной доли. */
function noteKey(n: Note): string {
  return `${n.inst}:${n.step}:${n.midi}`;
}

/**
 * Ноты, которые появились в доле после роста множителя: есть в плане next, но не было в prev.
 * Ими доигрывается уже запланированная доля, чтобы новый слой вступал сразу, а не со следующей.
 */
export function addedNotes(prev: readonly Note[], next: readonly Note[]): Note[] {
  const had = new Set<string>();
  for (const n of prev) had.add(noteKey(n));
  return next.filter((n) => !had.has(noteKey(n)));
}
