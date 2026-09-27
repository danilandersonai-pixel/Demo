/* Кубокрафт — синтезированные звуки (Web Audio): удары по материалам, голоса мобов,
   взрывы, щелчки механизмов. Громкость и панорама зависят от положения источника. */
(function (KC) {
  'use strict';

  var ctx = null, master = null, noise = null, enabled = true;
  var listener = { x: 0, y: 0, z: 0, yaw: 0 };

  function ensure() {
    if (!enabled) return;
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        var len = Math.floor(ctx.sampleRate * 1.2);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        var ch = noise.getChannelData(0);
        for (var i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { /* звук необязателен */ }
  }

  // Выход с громкостью и панорамой по положению источника
  function out(x, y, z, vol) {
    var g = ctx.createGain();
    var v = vol === undefined ? 1 : vol;
    var pan = 0;
    if (x !== undefined) {
      var dx = x - listener.x, dy = y - listener.y, dz = z - listener.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      v *= Math.max(0, 1 - d / 28);
      if (d > 0.5) {
        var rx = Math.cos(listener.yaw), rz = -Math.sin(listener.yaw);
        pan = Math.max(-0.8, Math.min(0.8, (dx * rx + dz * rz) / d));
      }
    }
    g.gain.value = v;
    if (ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p); p.connect(master);
    } else g.connect(master);
    return v > 0.01 ? g : null;
  }

  function env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function noiseHit(dest, t, freq, q, dur, peak, type) {
    var src = ctx.createBufferSource();
    src.buffer = noise;
    var f = ctx.createBiquadFilter();
    f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    var g = ctx.createGain();
    env(g, t, 0.006, peak, dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  function tone(dest, t, type, f0, f1, dur, peak, lp) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    env(g, t, 0.01, peak, dur);
    if (lp) {
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = lp;
      o.connect(f); f.connect(g);
    } else o.connect(g);
    g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  var MAT = {
    stone: [1700, 1.0, 0.11, 1.4], grass: [950, 0.8, 0.12, 1.3], dirt: [650, 0.9, 0.12, 1.4],
    sand: [2600, 0.6, 0.15, 1.0], wood: [520, 2.0, 0.12, 1.6], plant: [3000, 0.7, 0.08, 0.8],
    glass: [3800, 3.5, 0.16, 1.2], cloth: [800, 0.5, 0.1, 1.0], snow: [1400, 0.5, 0.14, 1.0],
    water: [420, 1.2, 0.2, 1.1], metal: [2300, 8.0, 0.24, 1.0]
  };

  function play(name, x, y, z, vol) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    try {
      var d = out(x, y, z, vol);
      if (!d) return;
      var t = ctx.currentTime, i;
      if (name.indexOf('break:') === 0 || name.indexOf('place:') === 0 || name.indexOf('dig:') === 0) {
        var kind = name.split(':'), p = MAT[kind[1]] || MAT.stone;
        var place = kind[0] === 'place', dig = kind[0] === 'dig';
        var k = dig ? 0.35 : place ? 0.7 : 1;
        noiseHit(d, t, p[0] * (0.88 + Math.random() * 0.24) * (place ? 0.8 : 1), p[1], p[2] * (dig ? 0.6 : 1), p[3] * k);
        if (!dig && (place || kind[1] === 'wood' || kind[1] === 'stone')) tone(d, t, 'triangle', place ? 180 : 130, 60, 0.1, 0.3 * k);
        if (kind[1] === 'glass' && kind[0] === 'break') for (i = 0; i < 3; i++) tone(d, t + i * 0.03, 'sine', 2400 + Math.random() * 2400, 2000, 0.12, 0.12);
        return;
      }
      // шаги: короткий глухой шорох по материалу под ногами
      if (name.indexOf('step:') === 0) {
        var sp = MAT[name.slice(5)] || MAT.stone;
        noiseHit(d, t, sp[0] * 0.7 * (0.85 + Math.random() * 0.3), sp[1] * 0.8, 0.07, sp[3] * 0.32, 'bandpass');
        return;
      }
      // мотор: «engine:частота» — чем быстрее едем, тем выше гул
      if (name.indexOf('engine:') === 0) {
        var ef = +name.slice(7) || 50;
        tone(d, t, 'sawtooth', ef, ef * 1.04, 0.32, 0.16, 420);
        tone(d, t, 'square', ef * 0.5, ef * 0.52, 0.32, 0.08, 300);
        return;
      }
      switch (name) {
        case 'say-pig': tone(d, t, 'square', 190, 140, 0.16, 0.25, 900); tone(d, t + 0.2, 'square', 170, 120, 0.14, 0.2, 900); break;
        case 'say-cow': var o = tone(d, t, 'sawtooth', 125, 92, 0.8, 0.3, 650); o.detune.setValueAtTime(0, t); o.detune.linearRampToValueAtTime(-80, t + 0.8); break;
        case 'say-sheep':
          var s = tone(d, t, 'sawtooth', 390, 330, 0.55, 0.22, 1600);
          var lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 24; lg.gain.value = 30;
          lfo.connect(lg); lg.connect(s.frequency); lfo.start(t); lfo.stop(t + 0.6);
          break;
        case 'say-chicken': for (i = 0; i < 3; i++) tone(d, t + i * 0.09, 'triangle', 950, 700, 0.06, 0.2); break;
        case 'say-upyr': tone(d, t, 'sawtooth', 92, 68, 1.0, 0.32, 380); noiseHit(d, t, 300, 0.8, 0.9, 0.3, 'lowpass'); break;
        case 'say-archer': for (i = 0; i < 5; i++) noiseHit(d, t + i * 0.05, 2600, 4, 0.03, 0.6, 'highpass'); break;
        case 'say-spider': noiseHit(d, t, 3200, 0.8, 0.45, 0.5, 'highpass'); break;
        case 'say-infected': tone(d, t, 'sawtooth', 130, 80, 0.9, 0.3, 520); noiseHit(d, t + 0.1, 450, 0.7, 0.7, 0.35, 'lowpass'); break;
        case 'say-runner': for (i = 0; i < 3; i++) tone(d, t + i * 0.13, 'sawtooth', 240, 150, 0.1, 0.25, 900); break;
        case 'say-brute': tone(d, t, 'sawtooth', 62, 44, 1.2, 0.45, 300); noiseHit(d, t, 180, 0.6, 1.1, 0.5, 'lowpass'); break;
        case 'say-imp': for (i = 0; i < 4; i++) tone(d, t + i * 0.07, 'square', 700 + i * 90, 520, 0.06, 0.16, 2200); break;
        case 'say-wisp': case 'fireball': noiseHit(d, t, 600, 0.5, 0.6, 1.0, 'lowpass'); tone(d, t, 'sine', 180, 90, 0.5, 0.25); break;
        case 'say-pegasus': var ph = tone(d, t, 'sawtooth', 520, 300, 0.7, 0.2, 1800);
          var plfo = ctx.createOscillator(), plg = ctx.createGain(); plfo.frequency.value = 14; plg.gain.value = 40;
          plfo.connect(plg); plg.connect(ph.frequency); plfo.start(t); plfo.stop(t + 0.75); break;
        case 'say-cloudling': tone(d, t, 'sine', 620, 880, 0.25, 0.18); tone(d, t + 0.18, 'sine', 880, 660, 0.25, 0.14); break;
        case 'say-drone': tone(d, t, 'sawtooth', 210, 230, 0.6, 0.1, 1200); tone(d, t + 0.2, 'square', 1400, 900, 0.08, 0.1); break;
        case 'say-robot': for (i = 0; i < 3; i++) tone(d, t + i * 0.1, 'square', 900 + Math.random() * 700, 900, 0.06, 0.12, 3000); break;
        case 'hurt-player': tone(d, t, 'square', 320, 150, 0.16, 0.3, 1400); break;
        case 'hurt-pig': case 'hurt-cow': case 'hurt-sheep': case 'hurt-chicken': case 'hurt-pegasus': case 'hurt-cloudling':
          tone(d, t, 'square', 420, 220, 0.14, 0.25, 1600); break;
        case 'hurt-upyr': case 'hurt-archer': case 'hurt-spider': case 'hurt-infected': case 'hurt-runner': case 'hurt-brute': case 'hurt-imp':
          tone(d, t, 'sawtooth', 160, 90, 0.2, 0.3, 700); break;
        case 'hurt-wisp': noiseHit(d, t, 1800, 1, 0.2, 0.8); break;
        case 'hurt-drone': case 'hurt-robot': noiseHit(d, t, 2600, 6, 0.12, 1.0); tone(d, t, 'square', 700, 300, 0.1, 0.2); break;
        case 'laser': tone(d, t, 'sawtooth', 1800, 300, 0.22, 0.25, 4000); break;
        case 'gunshot': noiseHit(d, t, 1400, 0.5, 0.25, 2.4, 'lowpass'); tone(d, t, 'square', 180, 50, 0.12, 0.6); break;
        case 'gun-empty': tone(d, t, 'square', 2400, 2000, 0.02, 0.2); break;
        case 'heal': for (i = 0; i < 3; i++) tone(d, t + i * 0.09, 'sine', 520 + i * 180, 700 + i * 180, 0.14, 0.2); break;
        case 'portal': tone(d, t, 'sine', 180, 720, 1.4, 0.35); tone(d, t, 'triangle', 240, 960, 1.4, 0.2); noiseHit(d, t, 900, 0.5, 1.2, 0.4); break;
        case 'teleport': for (i = 0; i < 6; i++) tone(d, t + i * 0.05, 'sine', 400 + i * 220, 900 + i * 220, 0.12, 0.18); break;
        case 'siege-hit': noiseHit(d, t, 380, 1.2, 0.12, 1.6, 'lowpass'); tone(d, t, 'triangle', 110, 60, 0.12, 0.4); break;
        case 'alarm': for (i = 0; i < 4; i++) tone(d, t + i * 0.25, 'square', i % 2 ? 620 : 880, i % 2 ? 620 : 880, 0.22, 0.22, 2400); break;
        case 'generator-on': tone(d, t, 'sawtooth', 40, 90, 0.8, 0.3, 500); noiseHit(d, t, 200, 0.5, 0.8, 0.6, 'lowpass'); break;
        case 'generator-off': tone(d, t, 'sawtooth', 90, 35, 0.9, 0.3, 500); break;
        case 'radio': noiseHit(d, t, 2000, 0.4, 0.5, 0.5); for (i = 0; i < 3; i++) tone(d, t + 0.5 + i * 0.12, 'square', 900, 900, 0.08, 0.12, 2500); break;
        case 'heli': for (i = 0; i < 8; i++) noiseHit(d, t + i * 0.09, 160, 0.7, 0.07, 1.4, 'lowpass'); break;
        case 'drop': noiseHit(d, t, 500, 0.6, 0.5, 1.8, 'lowpass'); tone(d, t, 'sine', 90, 40, 0.4, 0.5); break;
        case 'shotgun': noiseHit(d, t, 900, 0.5, 0.4, 3, 'lowpass'); tone(d, t, 'square', 120, 40, 0.2, 0.7); break;
        case 'rifle': noiseHit(d, t, 1800, 0.6, 0.12, 1.8, 'lowpass'); tone(d, t, 'square', 200, 70, 0.07, 0.4); break;
        case 'sniper': noiseHit(d, t, 1100, 0.4, 0.7, 3, 'lowpass'); tone(d, t, 'sawtooth', 300, 40, 0.5, 0.6); noiseHit(d, t + 0.4, 600, 0.5, 0.6, 0.4, 'lowpass'); break;
        case 'flame': noiseHit(d, t, 500, 0.4, 0.45, 1.1, 'lowpass'); break;
        case 'throw': noiseHit(d, t, 2400, 1, 0.15, 0.5); break;
        case 'chainsaw': for (i = 0; i < 6; i++) tone(d, t + i * 0.05, 'sawtooth', 180 + Math.random() * 60, 150, 0.06, 0.25, 1800); break;
        case 'horn': tone(d, t, 'square', 440, 440, 0.45, 0.35, 1400); tone(d, t, 'square', 554, 554, 0.45, 0.3, 1400); break;
        case 'crash': noiseHit(d, t, 700, 0.6, 0.5, 2.4, 'lowpass'); tone(d, t, 'square', 90, 40, 0.3, 0.5); break;
        case 'cannon': noiseHit(d, t, 300, 0.5, 1.2, 3.2, 'lowpass'); tone(d, t, 'sine', 60, 25, 1.0, 1); break;
        case 'door-car': tone(d, t, 'triangle', 200, 120, 0.12, 0.4); noiseHit(d, t, 600, 1, 0.08, 0.8); break;
        case 'victory': [523, 659, 784, 1047].forEach(function (f, k) { tone(d, t + k * 0.18, 'triangle', f, f, 0.5, 0.3); }); break;
        case 'discover': [587, 784, 1175].forEach(function (f, k) { tone(d, t + k * 0.13, 'sine', f, f, 0.45, 0.16); }); break;
        case 'eat': for (i = 0; i < 3; i++) noiseHit(d, t + i * 0.12, 900, 1.5, 0.07, 1.2); break;
        case 'burp': tone(d, t, 'sawtooth', 110, 70, 0.3, 0.3, 400); break;
        case 'pickup': tone(d, t, 'sine', 700 + Math.random() * 200, 1300, 0.08, 0.2); break;
        case 'bow': tone(d, t, 'triangle', 260, 110, 0.18, 0.35); noiseHit(d, t, 1200, 1, 0.12, 0.5); break;
        case 'arrow-hit': noiseHit(d, t, 1200, 1, 0.06, 0.9, 'lowpass'); break;
        case 'boom': noiseHit(d, t, 380, 0.7, 1.3, 2.4, 'lowpass'); tone(d, t, 'sine', 70, 32, 1.0, 0.8); break;
        case 'fuse': noiseHit(d, t, 5200, 0.6, 0.9, 0.5, 'highpass'); break;
        case 'fizz': noiseHit(d, t, 3000, 1.2, 0.5, 0.8); break;
        case 'click': tone(d, t, 'square', 1500, 1200, 0.025, 0.2); break;
        case 'door-open': tone(d, t, 'sawtooth', 220, 150, 0.25, 0.2, 700); break;
        case 'door-close': tone(d, t, 'sawtooth', 160, 110, 0.18, 0.25, 600); noiseHit(d, t + 0.15, 400, 1, 0.08, 0.8); break;
        case 'piston': noiseHit(d, t, 900, 1, 0.15, 1.0, 'lowpass'); tone(d, t, 'triangle', 90, 60, 0.12, 0.3); break;
        case 'splash': noiseHit(d, t, 700, 0.6, 0.4, 1.2, 'lowpass'); break;
        case 'tool-break': tone(d, t, 'square', 900, 300, 0.2, 0.25); noiseHit(d, t, 2400, 2, 0.15, 0.8); break;
        case 'step': noiseHit(d, t, 700, 1, 0.05, 0.25); break;
        case 'thunder': noiseHit(d, t, 110, 0.5, 3.2, 2.2, 'lowpass'); noiseHit(d, t + 0.3, 70, 0.4, 2.8, 1.6, 'lowpass'); break;
        // жизнь вокруг: птицы, сверчки, капли, далёкие звуки города, треск огня, звон Небес
        case 'bird':
          var bf = 2200 + Math.random() * 1600, bn = 2 + Math.floor(Math.random() * 4);
          for (i = 0; i < bn; i++) tone(d, t + i * 0.11, 'sine', bf * (1 + Math.random() * 0.15), bf * (0.75 + Math.random() * 0.2), 0.08, 0.1);
          break;
        case 'cricket': for (i = 0; i < 3; i++) tone(d, t + i * 0.045, 'square', 4300, 4250, 0.03, 0.035, 6000); break;
        case 'drip': tone(d, t, 'sine', 1400 + Math.random() * 500, 700, 0.12, 0.18); break;
        case 'siren-far':
          var so = tone(d, t, 'sine', 620, 620, 3.2, 0.05);
          so.frequency.setValueAtTime(620, t); so.frequency.linearRampToValueAtTime(880, t + 1.4); so.frequency.linearRampToValueAtTime(620, t + 2.9);
          break;
        case 'groan-far': tone(d, t, 'sawtooth', 110, 70, 1.4, 0.07, 380); break;
        case 'dog-far': for (i = 0; i < 2; i++) { tone(d, t + i * 0.35, 'sawtooth', 480, 260, 0.14, 0.06, 1200); noiseHit(d, t + i * 0.35, 900, 1, 0.1, 0.1); } break;
        case 'crackle': for (i = 0; i < 4; i++) noiseHit(d, t + Math.random() * 0.3, 2500 + Math.random() * 2500, 3, 0.02, 0.35, 'bandpass'); break;
        case 'chime': [880, 1108.7, 1318.5].forEach(function (f, k) { tone(d, t + k * 0.22, 'sine', f, f, 1.4, 0.07); }); break;
        case 'lava-pop': noiseHit(d, t, 240, 1.2, 0.18, 0.8, 'lowpass'); break;
        case 'land': noiseHit(d, t, 380, 0.8, 0.12, 0.6, 'lowpass'); break;
        case 'thunder-near': noiseHit(d, t, 2400, 0.4, 0.25, 2.6, 'highpass'); noiseHit(d, t + 0.05, 160, 0.5, 3.5, 3, 'lowpass'); tone(d, t, 'sine', 55, 28, 2.5, 0.9); break;
      }
    } catch (e) { /* звук необязателен */ }
  }

  // ---- Фоновые петли: ветер, дождь (снаружи и по крыше), гул Пекла, хор Небес, гудение станции ---
  var loops = {};
  function loopNoise(type, freq, q) {
    var src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    var g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(0, Math.random());
    return { src: src, f: f, g: g };
  }
  function loopTone(freqs, type, lp) {
    var g = ctx.createGain(); g.gain.value = 0;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.connect(g); g.connect(master);
    freqs.forEach(function (fr, k) {
      var o = ctx.createOscillator(); o.type = type; o.frequency.value = fr; o.detune.value = (k % 2 ? 4 : -4);
      o.connect(f); o.start();
    });
    return { f: f, g: g };
  }
  var MAKE = {
    wind: function () { return loopNoise('bandpass', 380, 0.7); },
    rain: function () { return loopNoise('highpass', 1300, 0.4); },
    roof: function () { return loopNoise('lowpass', 520, 0.6); },
    hell: function () { return loopNoise('lowpass', 95, 0.8); },
    heaven: function () { return loopTone([261.6, 329.6, 392, 523.3], 'sine', 1500); },
    hum: function () { return loopTone([55, 110, 166], 'sawtooth', 260); },
    water: function () { return loopNoise('lowpass', 300, 0.5); }
  };
  var LOOP_VOL = { wind: 0.13, rain: 0.2, roof: 0.22, hell: 0.3, heaven: 0.045, hum: 0.06, water: 0.25 };
  // s — громкости слоёв 0…1; всё плавно, за полсекунды
  function ambience(s) {
    if (!ctx || ctx.state !== 'running') return;
    try {
      var t = ctx.currentTime;
      for (var name in MAKE) {
        var v = enabled ? (s[name] || 0) * LOOP_VOL[name] : 0, L = loops[name];
        if (!L) { if (v < 0.002) continue; L = loops[name] = MAKE[name](); }
        L.g.gain.setTargetAtTime(v, t, 0.5);
      }
      if (loops.wind) loops.wind.f.frequency.setTargetAtTime(260 + Math.sin(t * 0.21) * 110 + (s.wind || 0) * 260, t, 1.2);
    } catch (e) { /* звук необязателен */ }
  }

  KC.Audio = {
    ensure: ensure,
    play: play,
    ambience: ambience,
    setListener: function (x, y, z, yaw) { listener.x = x; listener.y = y; listener.z = z; listener.yaw = yaw; },
    setEnabled: function (on) { enabled = on; if (on) ensure(); else ambience({}); }
  };
})(window.KC = window.KC || {});
