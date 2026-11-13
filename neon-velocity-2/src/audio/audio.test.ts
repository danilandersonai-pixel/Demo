/**
 * Чистая часть звука: сетка долей, гармония, мелодия сфер и аранжировка.
 * Web Audio здесь нет — граф и синтез проверяются в браузере.
 */
import { describe, expect, it } from 'vitest';
import { GAME } from '../core/config';
import { BARS_PER_LEVEL, BEATS_PER_BAR, TICK_DT, TICKS_PER_BEAT, TICKS_PER_LEVEL } from '../core/timing';
import { addedNotes, COMBO_LAYERS, LAYER, layerOn, planBeat, type BeatInput, type Note } from './arrangement';
import { audio } from './audio';
import { BeatGrid, LATENCY, LOCK_WINDOW, MAX_SLEW, measuredTime } from './clock';
import { chordAtTick, chordFor, ladderNote, levelRootChord, melodyNote, PROGRESSIONS, sparkleNotes } from './harmony';

const BEAT = TICKS_PER_BEAT * TICK_DT;
const PENTATONIC = new Set([9, 0, 2, 4, 7]);

/** Детерминированный шум −1..1 для дрожания измерений. */
function jitter(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function input(over: Partial<BeatInput> = {}): BeatInput {
  return { bar: 0, beatInBar: 0, level: 1, mult: 1, overdrive: false, padSounding: false, ...over };
}

function bar(over: Partial<BeatInput>): Note[][] {
  const beats: Note[][] = [];
  let padSounding = false;
  for (let b = 0; b < BEATS_PER_BAR; b++) {
    const notes = planBeat(input({ ...over, beatInBar: b, padSounding }));
    if (notes.some((n) => n.inst === 'pad')) padSounding = true;
    beats.push(notes);
  }
  return beats;
}

function insts(notes: Note[]): Set<string> {
  return new Set(notes.map((n) => n.inst));
}

describe('сетка долей', () => {
  it('measuredTime: опережение минус давность события, давность обрезается', () => {
    expect(measuredTime(10, 0)).toBeCloseTo(10 + LATENCY, 12);
    expect(measuredTime(10, 0.02)).toBeCloseTo(10 + LATENCY - 0.02, 12);
    expect(measuredTime(10, -5)).toBeCloseTo(10 + LATENCY, 12);
    expect(measuredTime(10, 99)).toBeCloseTo(10 + LATENCY - 0.25, 12);
    expect(measuredTime(10, Number.NaN)).toBeCloseTo(10 + LATENCY, 12);
  });

  it('первая доля привязывает сетку к измерению', () => {
    const grid = new BeatGrid();
    expect(grid.isLocked).toBe(false);
    expect(grid.sync(-240, 3.2)).toBe(3.2);
    expect(grid.isLocked).toBe(true);
    expect(grid.at(-240, 3.2, 0)).toBeCloseTo(3.2 + 240 * TICK_DT, 12);
  });

  it('при дрожании измерений ±8 мс соседние доли отстоят на 0.46875 с ± 0.5 мс', () => {
    const grid = new BeatGrid();
    let prev = grid.sync(0, 1);
    let worst = 0;
    for (let i = 1; i <= 2000; i++) {
      const t = grid.sync(i * TICKS_PER_BEAT, 1 + i * BEAT + jitter(i) * 0.008);
      worst = Math.max(worst, Math.abs(t - prev - BEAT));
      prev = t;
    }
    expect(worst).toBeLessThanOrEqual(MAX_SLEW + 1e-9);
    // И сетка не уплыла от истинных моментов дальше размаха дрожания.
    expect(Math.abs(prev - (1 + 2000 * BEAT))).toBeLessThan(0.008);
  });

  it('отрабатывает медленный уход часов (0.05 %) без скачков', () => {
    const grid = new BeatGrid();
    const drift = 1.0005;
    let prev = grid.sync(0, 0);
    let worst = 0;
    let lag = 0;
    for (let i = 1; i <= 1500; i++) {
      const truth = i * BEAT * drift;
      const t = grid.sync(i * TICKS_PER_BEAT, truth);
      worst = Math.max(worst, Math.abs(t - prev - BEAT));
      lag = Math.max(lag, Math.abs(t - truth));
      prev = t;
    }
    expect(worst).toBeLessThanOrEqual(MAX_SLEW + 1e-9);
    expect(lag).toBeLessThan(LOCK_WINDOW);
  });

  it('скачок дальше окна захвата — новая привязка, reset — тоже', () => {
    const grid = new BeatGrid();
    grid.sync(0, 1);
    const paused = 1 + BEAT + 5;
    expect(grid.sync(TICKS_PER_BEAT, paused)).toBe(paused);
    expect(grid.sync(2 * TICKS_PER_BEAT, paused + BEAT)).toBeCloseTo(paused + BEAT, 9);
    grid.reset();
    expect(grid.isLocked).toBe(false);
    expect(grid.sync(3 * TICKS_PER_BEAT, 100)).toBe(100);
  });

  it('at: по сетке, пока измерение с ней согласно; иначе — от измерения', () => {
    const grid = new BeatGrid();
    expect(grid.at(10, 5, 15)).toBeCloseTo(5 + 5 * TICK_DT, 12);
    grid.sync(0, 2);
    // Событие на тике 26, измерено с дрожанием 4 мс — ближайшая шестнадцатая (тик 30) берётся из сетки.
    expect(grid.at(26, 2 + 26 * TICK_DT + 0.004, 30)).toBeCloseTo(2 + 30 * TICK_DT, 12);
    // Измерение разошлось с сеткой (замедление при гибели) — сетка не используется.
    expect(grid.at(26, 9, 30)).toBeCloseTo(9 + 4 * TICK_DT, 12);
  });
});

describe('гармония', () => {
  it('каждая прогрессия — восемь аккордов, восьмой — G', () => {
    for (const p of PROGRESSIONS) {
      expect(p.length).toBe(BARS_PER_LEVEL);
      expect(p[BARS_PER_LEVEL - 1]).toBe('G');
    }
    expect(PROGRESSIONS[0]).toEqual(['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G']);
  });

  it('аккорд меняется по тактам и по уровням; вступление — первый аккорд', () => {
    expect([0, 1, 2, 3].map((b) => chordFor(1, b).name)).toEqual(['Am', 'F', 'C', 'G']);
    expect(chordFor(1, -1).name).toBe('Am');
    expect(chordFor(2, 9).name).toBe(PROGRESSIONS[1][1]);
    expect(chordFor(1 + PROGRESSIONS.length, 3).name).toBe('G');
    expect(chordAtTick(-240).name).toBe('Am');
    expect(chordAtTick(TICKS_PER_LEVEL).name).toBe(PROGRESSIONS[1][0]);
    expect(levelRootChord(3).name).toBe(PROGRESSIONS[2][0]);
  });

  it('бас в нижнем регистре, пэд и арпеджио — звуки аккорда', () => {
    for (let level = 1; level <= PROGRESSIONS.length; level++) {
      for (let b = 0; b < BARS_PER_LEVEL; b++) {
        const c = chordFor(level, b);
        expect(c.bass).toBeGreaterThanOrEqual(28);
        expect(c.bass).toBeLessThanOrEqual(40);
        const classes = new Set(c.pad.map((n) => n % 12));
        expect(classes.has(c.bass % 12)).toBe(true);
        for (const n of c.arp) expect(classes.has(n % 12)).toBe(true);
        expect([...c.arp]).toEqual([...c.arp].sort((x, y) => x - y));
      }
    }
  });
});

describe('мелодия сфер', () => {
  it('любая нота — из ля-минорной пентатоники, на любом аккорде', () => {
    for (let level = 1; level <= PROGRESSIONS.length; level++) {
      for (let b = 0; b < BARS_PER_LEVEL; b++) {
        const c = chordFor(level, b);
        for (let n = 0; n < 200; n++) {
          const midi = melodyNote(n, c);
          expect(PENTATONIC.has(midi % 12)).toBe(true);
          expect(c.avoid.includes(midi % 12)).toBe(false);
          expect(midi).toBeGreaterThanOrEqual(69);
          expect(midi).toBeLessThanOrEqual(96);
        }
      }
    }
  });

  it('опорные ноты (каждая четвёртая) — звуки аккорда', () => {
    for (const name of ['Am', 'F', 'C', 'G', 'Em', 'Dm'] as const) {
      const level = 1 + PROGRESSIONS.findIndex((p) => p.includes(name));
      const c = chordFor(level, PROGRESSIONS[level - 1].indexOf(name));
      expect(c.name).toBe(name);
      for (let n = 0; n < 128; n += 4) expect(c.tones.includes(melodyNote(n, c) % 12)).toBe(true);
    }
  });

  it('фраза детерминирована, движется плавно и не стоит на месте', () => {
    const c = chordFor(1, 0);
    const phrase = Array.from({ length: 32 }, (_, n) => melodyNote(n, c));
    expect(phrase).toEqual(Array.from({ length: 32 }, (_, n) => melodyNote(n, c)));
    expect(new Set(phrase).size).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < phrase.length; i++) expect(Math.abs(phrase[i] - phrase[i - 1])).toBeLessThanOrEqual(9);
    // Повтор фразы идёт на другой высоте.
    expect(Array.from({ length: 32 }, (_, n) => melodyNote(n + 32, c))).not.toEqual(phrase);
    expect(ladderNote(0)).toBe(69);
    expect(ladderNote(5)).toBe(81);
  });

  it('редкая сфера: пять нот вверх, от ноты мелодии по звукам аккорда', () => {
    for (let n = 0; n < 40; n++) {
      const c = chordFor(1 + (n % PROGRESSIONS.length), n % BARS_PER_LEVEL);
      const notes = sparkleNotes(n, c);
      expect(notes.length).toBe(5);
      expect(notes[0]).toBe(melodyNote(n, c));
      for (let i = 1; i < notes.length; i++) {
        expect(notes[i]).toBeGreaterThan(notes[i - 1]);
        expect(c.tones.includes(notes[i] % 12)).toBe(true);
      }
    }
  });
});

describe('аранжировка', () => {
  it('слои включаются множителем: x1 … OVERDRIVE', () => {
    const at = (mult: number) => insts(bar({ mult, overdrive: mult >= GAME.combo.maxMultiplier }).flat());
    expect([...at(1)].sort()).toEqual(['bass', 'hat', 'kick']);
    expect(at(2).has('clap')).toBe(false);
    expect(at(3).has('clap')).toBe(true);
    expect(at(3).has('pad')).toBe(false);
    expect(at(4).has('pad')).toBe(true);
    expect(at(4).has('arp')).toBe(false);
    for (const m of [5, 6, 7]) {
      expect(at(m).has('arp')).toBe(true);
      expect(at(m).has('lead')).toBe(false);
    }
    expect(at(8).has('lead')).toBe(true);
    expect(at(8).has('arp')).toBe(true);
  });

  it('x1 — редкие хэты на офбит, x2 — шестнадцатые', () => {
    const hats = (mult: number) => bar({ mult }).map((beat) => beat.filter((n) => n.inst === 'hat' || n.inst === 'openHat').map((n) => n.step));
    expect(hats(1)).toEqual([[2], [2], [2], [2]]);
    expect(hats(2)).toEqual([[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]]);
  });

  it('бочка на каждую долю, клэп на 2-ю и 4-ю, пэд — один аккорд на такт', () => {
    const beats = bar({ mult: 4, bar: 2 });
    for (const beat of beats) expect(beat.filter((n) => n.inst === 'kick' && n.step === 0).length).toBe(1);
    expect(beats.map((beat) => beat.some((n) => n.inst === 'clap'))).toEqual([false, true, false, true]);
    const pads = beats.flat().filter((n) => n.inst === 'pad');
    expect(pads.length).toBe(1);
    expect(pads[0].len).toBe(16);
    expect(pads[0].chord).toEqual(chordFor(1, 2).pad);
  });

  it('пэд вступает с середины такта, если ещё не звучит (рост комбо, пауза)', () => {
    const late = planBeat(input({ mult: 4, beatInBar: 2, padSounding: false })).filter((n) => n.inst === 'pad');
    expect(late.length).toBe(1);
    expect(late[0].len).toBe(8);
    expect(planBeat(input({ mult: 4, beatInBar: 2, padSounding: true })).some((n) => n.inst === 'pad')).toBe(false);
  });

  it('арпеджио: x5 — восьмые, x6 и x7 — шестнадцатые; лид на октаву выше арпеджио', () => {
    const count = (mult: number) => bar({ mult }).flat().filter((n) => n.inst === 'arp').length;
    expect(count(5)).toBe(8);
    expect(count(6)).toBe(16);
    expect(count(7)).toBe(16);
    const top = bar({ mult: 8, overdrive: true }).flat();
    const chord = chordFor(1, 0);
    for (const n of top.filter((x) => x.inst === 'arp')) expect(chord.arp.includes(n.midi - 12)).toBe(true);
    const lead = top.filter((x) => x.inst === 'lead');
    expect(lead.length).toBeGreaterThanOrEqual(4);
    for (const n of lead) expect(chord.arp.includes(n.midi - 24)).toBe(true);
  });

  it('бас играет корень аккорда такта и уплотняется с уровнем', () => {
    for (const [level, perBar] of [[1, 8], [3, 16], [7, 16]] as const) {
      const b = (level - 1) * BARS_PER_LEVEL + 1;
      const notes = bar({ level, bar: b }).flat().filter((n) => n.inst === 'bass');
      expect(notes.length).toBe(perBar);
      const root = chordFor(level, b).bass;
      for (const n of notes) expect([0, 7, 12]).toContain(n.midi - root);
      expect(notes[0].midi).toBe(root);
    }
  });

  it('восьмой такт уровня: нарастающая дробь, на последней доле бочка и бас молчат', () => {
    const beats = bar({ bar: BARS_PER_LEVEL - 1, mult: 3 });
    const fills = beats.map((beat) => beat.filter((n) => n.inst === 'snare'));
    expect(fills.map((f) => f.length)).toEqual([2, 3, 4, 8]);
    const vels = fills.flat().map((n) => n.vel);
    for (let i = 1; i < vels.length; i++) expect(vels[i]).toBeGreaterThan(vels[i - 1]);
    expect(vels[vels.length - 1]).toBeLessThanOrEqual(1);
    const last = insts(beats[3]);
    expect(last.has('kick')).toBe(false);
    expect(last.has('bass')).toBe(false);
    expect(last.has('clap')).toBe(false);
    expect(insts(beats[2]).has('kick')).toBe(true);
    // В остальных тактах дроби нет.
    expect(bar({ bar: 3, mult: 3 }).flat().some((n) => n.inst === 'snare')).toBe(false);
  });

  it('вступление: только тиканье хэтов', () => {
    for (let b = 0; b < BEATS_PER_BAR; b++) {
      const notes = planBeat(input({ bar: -1, beatInBar: b, mult: 8, overdrive: true }));
      expect([...insts(notes)]).toEqual(['hat']);
    }
  });

  it('ноты лежат внутри доли, громкость в 0..1, слой соответствует множителю', () => {
    for (let level = 1; level <= 12; level++) {
      for (let b = 0; b < BARS_PER_LEVEL; b++) {
        for (let mult = 1; mult <= GAME.combo.maxMultiplier; mult++) {
          const overdrive = mult === GAME.combo.maxMultiplier;
          for (const n of bar({ level, bar: (level - 1) * BARS_PER_LEVEL + b, mult, overdrive }).flat()) {
            expect(n.step).toBeGreaterThanOrEqual(0);
            expect(n.step).toBeLessThan(4);
            expect(n.len).toBeGreaterThan(0);
            expect(n.vel).toBeGreaterThan(0);
            expect(n.vel).toBeLessThanOrEqual(1);
            expect(layerOn(n.layer, mult, overdrive)).toBe(true);
            if (n.inst !== 'pad') expect(n.chord).toBeNull();
          }
        }
      }
    }
  });

  it('planBeat — чистая функция', () => {
    const a = planBeat(input({ bar: 13, beatInBar: 3, level: 2, mult: 6 }));
    expect(planBeat(input({ bar: 13, beatInBar: 3, level: 2, mult: 6 }))).toEqual(a);
  });

  it('addedNotes: рост множителя добавляет только новые слои, без дублей', () => {
    const before = planBeat(input({ mult: 1, beatInBar: 1 }));
    const after = planBeat(input({ mult: 5, beatInBar: 1 }));
    const added = addedNotes(before, after);
    expect(added.length).toBeGreaterThan(0);
    for (const n of added) expect(COMBO_LAYERS.has(n.layer)).toBe(true);
    // Офбит-хэт x1 уже звучит — плотные хэты добавляют только три недостающие шестнадцатые.
    expect(added.filter((n) => n.inst === 'hat').map((n) => n.step)).toEqual([0, 1, 3]);
    expect(addedNotes(after, after)).toEqual([]);
    expect(COMBO_LAYERS.has(LAYER.base)).toBe(false);
    expect(COMBO_LAYERS.has(LAYER.fill)).toBe(false);
  });
});

describe('движок без звукового контекста', () => {
  it('до unlock() все методы — безопасные пустышки, состояние забега запоминается', () => {
    audio.unlock();
    audio.setSettings({ enabled: true, music: 0.5, sfx: Number.NaN });
    audio.armToggleConfirm();
    audio.setMusicActive(true);
    audio.setPaused(true);
    audio.setPaused(false);
    audio.ui('click');
    audio.onEvent({ type: 'ready', tick: -240 }, 0);
    audio.onEvent({ type: 'beat', tick: -240, beat: -4, bar: -1, beatInBar: 0, level: 1 }, 0);
    audio.onEvent({ type: 'comboUp', tick: 30, multiplier: 8 }, 0);
    audio.onEvent({ type: 'overdrive', tick: 30, on: true }, 0);
    let s = audio.stats();
    expect(s.state).toBe('locked');
    expect(s.voices).toBe(0);
    expect(s.multiplier).toBe(8);
    expect(s.overdrive).toBe(true);
    expect(s.dead).toBe(false);
    audio.onEvent({ type: 'comboBreak', tick: 60, reason: 'miss', lost: 8 }, 0);
    audio.onEvent({ type: 'death', tick: 90, x: 50, kind: 'cube' }, 0);
    s = audio.stats();
    expect(s.multiplier).toBe(1);
    expect(s.overdrive).toBe(false);
    expect(s.dead).toBe(true);
    audio.onEvent({ type: 'ready', tick: -240 }, 0);
    expect(audio.stats().dead).toBe(false);
    audio.setMusicActive(false);
  });
});
