/* ============================================================
   Вайб-Кодер — генеративная чиптюн-музыка на WebAudio.
   Шаговый секвенсор: бас (square) + мелодия (triangle) +
   хай-хэт (шум) + пэд (sine). Темы по локациям и боям.
   Ноты — MIDI-номера, 0 = пауза. Без внешних файлов.
   ============================================================ */
'use strict';

window.Music = (() => {
  let ac = null, master = null, noiseBuf = null;
  let cur = null, step = 0, nextT = 0, timer = null;

  const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);

  /* ---------- темы ---------- */
  const THEMES = {
    // Деревня/Поля: уютный мажор (C), неторопливо
    calm: {
      bpm: 84,
      bass: [36, 0, 43, 0, 40, 0, 43, 0, 33, 0, 40, 0, 38, 0, 43, 0],
      lead: [60, 0, 64, 67, 0, 72, 0, 67, 64, 0, 60, 0, 62, 64, 62, 0,
             57, 0, 60, 64, 0, 67, 0, 64, 72, 0, 71, 67, 64, 0, 0, 0],
      hat:  [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
      pad:  [48, 0, 0, 0, 0, 0, 0, 0, 45, 0, 0, 0, 0, 0, 0, 0],
    },
    // Лес/Пещера: тревожный минор (Am), медленно
    dark: {
      bpm: 72,
      bass: [33, 0, 0, 33, 36, 0, 0, 31, 33, 0, 0, 33, 40, 0, 38, 0],
      lead: [0, 0, 69, 0, 0, 68, 0, 0, 64, 0, 0, 0, 0, 62, 64, 0,
             0, 0, 69, 0, 0, 72, 0, 71, 0, 0, 64, 0, 0, 0, 0, 0],
      hat:  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
      pad:  [45, 0, 0, 0, 0, 0, 0, 0, 44, 0, 0, 0, 0, 0, 0, 0],
    },
    // Город Продакшен: синтвейв-пульс (Am), бодро
    neon: {
      bpm: 104,
      bass: [33, 33, 45, 33, 33, 33, 45, 36, 31, 31, 43, 31, 38, 38, 45, 38],
      lead: [69, 0, 0, 72, 0, 76, 0, 72, 69, 0, 0, 67, 0, 64, 0, 0,
             71, 0, 0, 74, 0, 77, 0, 74, 76, 0, 72, 0, 69, 0, 0, 0],
      hat:  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
      pad:  [57, 0, 0, 0, 0, 0, 0, 0, 55, 0, 0, 0, 0, 0, 0, 0],
    },
    // Башня Деплоя: нарастающее напряжение
    tower: {
      bpm: 96,
      bass: [31, 0, 31, 31, 0, 31, 34, 0, 31, 0, 31, 31, 36, 0, 35, 0],
      lead: [0, 0, 62, 0, 63, 0, 62, 0, 0, 0, 58, 0, 0, 0, 0, 0,
             0, 0, 62, 0, 65, 0, 63, 0, 62, 0, 0, 0, 0, 0, 0, 0],
      hat:  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1],
      pad:  [43, 0, 0, 0, 0, 0, 0, 0, 46, 0, 0, 0, 0, 0, 0, 0],
    },
    // Обычный бой: гоночный ритм
    battle: {
      bpm: 132,
      bass: [33, 33, 0, 33, 36, 0, 33, 0, 38, 38, 0, 38, 36, 0, 35, 0],
      lead: [69, 0, 72, 74, 0, 72, 69, 0, 74, 0, 76, 77, 0, 76, 74, 0,
             69, 0, 72, 74, 0, 77, 79, 0, 77, 76, 74, 72, 74, 0, 0, 0],
      hat:  [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1],
      pad:  null,
    },
    // Босс: хроматическая угроза
    boss: {
      bpm: 144,
      bass: [31, 31, 31, 0, 34, 34, 0, 33, 31, 31, 31, 0, 37, 0, 36, 35],
      lead: [67, 0, 66, 67, 0, 70, 0, 67, 0, 63, 0, 62, 63, 0, 0, 0,
             67, 0, 66, 67, 0, 72, 0, 70, 0, 74, 73, 0, 70, 67, 0, 0],
      hat:  [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1],
      pad:  [43, 0, 0, 0, 0, 0, 0, 0, 42, 0, 0, 0, 0, 0, 0, 0],
    },
    // Титульный экран: мечтательный арпеджиатор
    title: {
      bpm: 76,
      bass: [33, 0, 0, 0, 29, 0, 0, 0, 31, 0, 0, 0, 26, 0, 0, 0],
      lead: [57, 60, 64, 69, 64, 60, 57, 60, 53, 57, 60, 65, 60, 57, 53, 57,
             55, 59, 62, 67, 62, 59, 55, 59, 50, 53, 57, 62, 57, 53, 50, 53],
      hat:  null,
      pad:  [45, 0, 0, 0, 41, 0, 0, 0, 43, 0, 0, 0, 38, 0, 0, 0],
    },
  };

  /* ---------- движок ---------- */
  function ensure() {
    if (ac) return true;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = 1;
      master.connect(ac.destination);
      // буфер белого шума для хэтов
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.1, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { return false; }
  }

  function tone(freq, t, dur, type, vol) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function hat(t, dur) {
    const s = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter();
    s.buffer = noiseBuf;
    f.type = 'highpass'; f.frequency.value = 6000;
    g.gain.setValueAtTime(0.02, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  function scheduleStep(th, s, t, spb) {
    if (window.G && G.mute) return;
    const b = th.bass[s % th.bass.length];
    if (b) tone(NOTE(b), t, spb * 0.85, 'square', 0.022);
    const l = th.lead[s % th.lead.length];
    if (l) tone(NOTE(l), t, spb * 0.9, 'triangle', 0.032);
    if (th.hat && th.hat[s % th.hat.length]) hat(t, spb * 0.25);
    if (th.pad) {
      const p = th.pad[s % th.pad.length];
      if (p) tone(NOTE(p), t, spb * 3.6, 'sine', 0.014);
    }
  }

  function tick() {
    if (!cur || !ac) return;
    if (ac.state !== 'running') { nextT = 0; return; }
    if (!nextT) nextT = ac.currentTime + 0.06;
    const th = THEMES[cur];
    const spb = 60 / th.bpm / 4; // шестнадцатые
    while (nextT < ac.currentTime + 0.16) {
      scheduleStep(th, step, nextT, spb);
      step++;
      nextT += spb;
    }
  }

  return {
    play(name) {
      if (!THEMES[name]) name = 'calm';
      if (cur === name) return;
      if (!ensure()) return;
      cur = name; step = 0; nextT = 0;
      if (!timer) timer = setInterval(tick, 60);
    },
    stop() { cur = null; },
    resume() { if (ac && ac.state === 'suspended') ac.resume(); },
  };
})();
