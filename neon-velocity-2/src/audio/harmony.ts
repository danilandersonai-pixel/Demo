/**
 * Гармония трека и мелодия сфер — чистые функции, без Web Audio.
 *
 * Тональность — ля минор. Аккорд меняется раз в такт; уровень скорости (8 тактов)
 * проходит прогрессию из восьми аккордов: базовая Am–F–C–G и её варианты по кругу.
 * Восьмой такт у всех вариантов — G: он тянет в первый аккорд следующего уровня,
 * и удар нового уровня звучит как разрешение.
 *
 * Сферы играют мелодию: порядковый номер сферы выбирает ступень фразы в ля-минорной
 * пентатонике. Любое подмножество пентатоники звучит чисто, поэтому пропущенные
 * сферы оставляют паузы, а не фальшь. Под аккорд фраза подстраивается дважды: опорные
 * ноты (каждая четвёртая) притягиваются к звукам аккорда, а редкие «острые» ноты
 * (до на G и Em) сдвигаются на соседнюю ступень.
 */
import { barAtTick, barInLevel, levelAtTick, mod } from '../core/timing';

export type ChordName = 'Am' | 'F' | 'C' | 'G' | 'Em' | 'Dm';

export interface Chord {
  name: ChordName;
  /** Корень баса (MIDI). */
  bass: number;
  /** Голоса пэда (MIDI). */
  pad: readonly number[];
  /** Шесть нот арпеджио снизу вверх (MIDI). */
  arp: readonly number[];
  /** Классы высот аккорда, которые есть в пентатонике, — опоры мелодии. */
  tones: readonly number[];
  /** Классы высот пентатоники, которых мелодия на этом аккорде избегает. */
  avoid: readonly number[];
}

const CHORDS: Record<ChordName, Chord> = {
  Am: { name: 'Am', bass: 33, pad: [57, 60, 64], arp: [57, 60, 64, 69, 72, 76], tones: [9, 0, 4], avoid: [] },
  F: { name: 'F', bass: 29, pad: [57, 60, 65], arp: [53, 57, 60, 65, 69, 72], tones: [9, 0], avoid: [] },
  C: { name: 'C', bass: 36, pad: [55, 60, 64], arp: [55, 60, 64, 67, 72, 76], tones: [0, 4, 7], avoid: [] },
  G: { name: 'G', bass: 31, pad: [55, 59, 62], arp: [55, 59, 62, 67, 71, 74], tones: [7, 2], avoid: [0] },
  Em: { name: 'Em', bass: 28, pad: [55, 59, 64], arp: [52, 55, 59, 64, 67, 71], tones: [4, 7], avoid: [0] },
  Dm: { name: 'Dm', bass: 38, pad: [57, 62, 65], arp: [57, 62, 65, 69, 74, 77], tones: [2, 9], avoid: [] },
};

/** Прогрессии уровня: по аккорду на такт. Уровень N берёт PROGRESSIONS[(N − 1) % длина]. */
export const PROGRESSIONS: readonly (readonly ChordName[])[] = [
  ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'],
  ['Am', 'Em', 'F', 'G', 'Am', 'Em', 'F', 'G'],
  ['F', 'G', 'Am', 'Am', 'F', 'G', 'C', 'G'],
  ['Dm', 'F', 'Am', 'G', 'Dm', 'F', 'C', 'G'],
  ['Am', 'C', 'F', 'G', 'Am', 'C', 'Dm', 'G'],
];

/** Аккорд такта bar (от GO) на уровне level. Во вступлении — первый аккорд уровня. */
export function chordFor(level: number, bar: number): Chord {
  const progression = PROGRESSIONS[mod(Math.max(1, Math.floor(level)) - 1, PROGRESSIONS.length)];
  return CHORDS[progression[bar < 0 ? 0 : barInLevel(bar)]];
}

/** Аккорд, звучащий в тик tick живого забега. */
export function chordAtTick(tick: number): Chord {
  return chordFor(levelAtTick(tick), barAtTick(tick));
}

/** Первый аккорд уровня — на нём стоит удар нового уровня. */
export function levelRootChord(level: number): Chord {
  return chordFor(level, 0);
}

// ─── Мелодия сфер ───────────────────────────────────────────────────────────

/** Ля-минорная пентатоника: полутоны от ля. */
const PENTA = [0, 3, 5, 7, 10] as const;
/** Нижняя нота мелодии — ля первой октавы: мелодия сидит над пэдом и арпеджио. */
const MELODY_BASE = 69;

/**
 * Фраза: ступени пентатонической «лесенки» (0 — ля, 1 — до, 2 — ре, 3 — ми, 4 — соль, 5 — ля …).
 * Четыре мотива по восемь нот: вопрос, ответ, подъём и спуск к тонике.
 */
const PHRASE = [
  3, 4, 5, 4, 3, 1, 2, 3,
  4, 5, 6, 5, 4, 3, 1, 2,
  3, 4, 5, 6, 7, 6, 5, 4,
  5, 4, 3, 1, 2, 3, 1, 0,
] as const;
/** Повторы фразы идут на разной высоте (в ступенях), чтобы длинный забег не звучал петлёй. */
const PHRASE_LIFT = [0, 1, 0, 2] as const;
/** Опорная нота — каждая четвёртая: она притягивается к звукам аккорда. */
const ANCHOR_EVERY = 4;

/** Нота пентатонической лесенки по номеру ступени (0 — MELODY_BASE). */
export function ladderNote(step: number): number {
  const s = Math.max(0, Math.floor(step));
  return MELODY_BASE + 12 * Math.floor(s / PENTA.length) + PENTA[s % PENTA.length];
}

function pitchClass(midi: number): number {
  return mod(midi, 12);
}

/** Ближайшая к step ступень лесенки, чья нота входит в аккорд (при равенстве — верхняя). */
function nearestChordStep(step: number, chord: Chord): number {
  for (let d = 0; d <= PENTA.length; d++) {
    if (chord.tones.includes(pitchClass(ladderNote(step + d)))) return step + d;
    if (step - d >= 0 && chord.tones.includes(pitchClass(ladderNote(step - d)))) return step - d;
  }
  return step;
}

/**
 * Нота мелодии (MIDI) для сферы с порядковым номером note на аккорде chord.
 * Чистая функция: одна и та же сфера на том же аккорде всегда звучит одинаково.
 */
export function melodyNote(note: number, chord: Chord): number {
  const n = Math.max(0, Math.floor(note));
  const cycle = Math.floor(n / PHRASE.length);
  let step = PHRASE[n % PHRASE.length] + PHRASE_LIFT[cycle % PHRASE_LIFT.length];
  if (n % ANCHOR_EVERY === 0) step = nearestChordStep(step, chord);
  else if (chord.avoid.includes(pitchClass(ladderNote(step)))) step += 1;
  return ladderNote(step);
}

/** Искрящееся арпеджио редкой сферы: звуки аккорда вверх от ноты мелодии. */
export function sparkleNotes(note: number, chord: Chord): number[] {
  const base = melodyNote(note, chord);
  const out: number[] = [];
  let step = 0;
  // Найти ступень базовой ноты и подняться от неё по звукам аккорда.
  while (ladderNote(step) < base) step++;
  for (let guard = 0; out.length < 5 && guard < 24; guard++, step++) {
    const midi = ladderNote(step);
    if (out.length === 0 || chord.tones.includes(pitchClass(midi))) out.push(midi);
  }
  return out;
}
