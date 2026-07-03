/* ===================================================================
 * КЛОДИК И ВАЙБ-КОДИНГ — пиксельная мини-игра
 * Чистый JS, без зависимостей. Логическое разрешение 240×160,
 * канвас растягивается CSS'ом с image-rendering: pixelated.
 * =================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = 240, H = 160;
  var FLOOR = H - 18;

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  /* ===== 1. Пиксель-арт: спрайты из текстовых карт ===== */

  function makeSprite(rows, palette) {
    var h = rows.length, w = rows[0].length;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var col = palette[rows[y][x]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  // Клодик: коралловый блоб в наушниках (глаза рисуются отдельно — они живые)
  var claudeBody = makeSprite([
    '...HHHHHHHHHH...',
    '..HH.OOOOOO.HH..',
    '..H.OBBBBBBO.H..',
    '.HHOBBBBBBBBOHH.',
    '.GGOBBBBBBBBOGG.',
    '.GGOBBBBBBBBOGG.',
    '.GGOBBBBBBBBOGG.',
    '.HHOBCBBBBCBOHH.',
    '...OBBBMMBBBO...',
    '...OBBBBBBBBO...',
    '....OOOOOOOO....',
    '...OO......OO...'
  ], {
    O: '#8c4a32', B: '#e78a68', C: '#f0a98e', M: '#6d3322',
    H: '#3e3a5c', G: '#f2c14e'
  });

  // Улыбка пошире — для режима «ПОТОК»
  var claudeBodyFlow = makeSprite([
    '...HHHHHHHHHH...',
    '..HH.OOOOOO.HH..',
    '..H.OBBBBBBO.H..',
    '.HHOBBBBBBBBOHH.',
    '.GGOBBBBBBBBOGG.',
    '.GGOBBBBBBBBOGG.',
    '.GGOBBBBBBBBOGG.',
    '.HHOBCBMMBCBOHH.',
    '...OBBMBBMBBO...',
    '...OBBBBBBBBO...',
    '....OOOOOOOO....',
    '...OO......OO...'
  ], {
    O: '#8c4a32', B: '#e78a68', C: '#f0a98e', M: '#6d3322',
    H: '#3e3a5c', G: '#f2c14e'
  });

  var sprCoffee = makeSprite([
    '..S...S...',
    '...S...S..',
    '..S...S...',
    '.OOOOOOO..',
    '.OWMMMWO..',
    '.OWMMMWOO.',
    '.OWMMMWO.O',
    '.OWMMMWOO.',
    '..OOOOO...',
    '..OOOOO...'
  ], { O: '#8c4a32', W: '#f3e9dc', M: '#6d4326', S: '#c9bfe0' });

  var sprBulb = makeSprite([
    '...OOOO...',
    '..OYYYYO..',
    '.OYWYYYYO.',
    '.OYYYYYYO.',
    '.OYWYYYYO.',
    '..OYYYYO..',
    '...OYYO...',
    '...GGGG...',
    '...GGGG...',
    '....GG....'
  ], { O: '#8f6a1e', Y: '#f2c14e', W: '#fff6dd', G: '#9d8fbf' });

  var sprNote = makeSprite([
    '....OOOO..',
    '....O..O..',
    '....O..O..',
    '....O..O..',
    '....O..O..',
    '.OO.O.OO.O',
    'OOOOO.OOOO',
    'OOOOO.OOOO',
    '.OOO...OOO',
    '..........'
  ], { O: '#7ed491' });

  var sprHeart = makeSprite([
    '..........',
    '.OO...OO..',
    'OPPO.OPPO.',
    'OPWPOPPPPO',
    'OPPPPPPPPO',
    '.OPPPPPPO.',
    '..OPPPPO..',
    '...OPPO...',
    '....OO....',
    '..........'
  ], { O: '#8f2f47', P: '#e0607a', W: '#ffd7de' });

  var sprBug = makeSprite([
    '.A......A.',
    '..A....A..',
    '..OOOOOO..',
    '.OPPOOPPO.',
    'OPPPPPPPPO',
    'OPOPPPPOPO',
    'OPPPPPPPPO',
    '.OPPOOPPO.',
    '..OOOOOO..',
    '.L..LL..L.'
  ], { O: '#4d2866', P: '#b96be0', A: '#d9a0f2', L: '#d9a0f2' });

  /* ===== 2. Типы падающих предметов ===== */

  var TYPES = {
    coffee: { spr: sprCoffee, good: true,  vibe: 12, pts: 10, w: 10, h: 10 },
    note:   { spr: sprNote,   good: true,  vibe: 9,  pts: 15, w: 10, h: 10 },
    bulb:   { spr: sprBulb,   good: true,  vibe: 16, pts: 25, w: 10, h: 10 },
    heart:  { spr: sprHeart,  good: true,  vibe: 0,  pts: 30, w: 10, h: 10 },
    bug:    { spr: sprBug,    good: false, vibe: -25, pts: 0, w: 10, h: 10 }
  };

  function pickType(elapsed) {
    // Шансы: баги набирают вес со временем, сердечко — редкий гость
    var bugW = Math.min(0.22 + elapsed / 90, 0.4);
    var heartW = (state.lives < 3) ? 0.045 : 0.008;
    var r = Math.random();
    if (r < bugW) return 'bug';
    r = (r - bugW) / (1 - bugW);
    if (r < heartW) return 'heart';
    if (r < heartW + 0.14) return 'bulb';
    if (r < heartW + 0.5) return 'coffee';
    return 'note';
  }

  /* ===== 3. Состояние ===== */

  var state = {};
  var hiscore = 0;
  try { hiscore = parseInt(localStorage.getItem('clodik-hiscore'), 10) || 0; } catch (e) {}

  function resetState() {
    state = {
      mode: 'menu',            // menu | play | over
      px: W / 2,               // центр Клодика по X
      pv: 0,                   // скорость игрока
      look: 0,                 // куда смотрят глаза (-1..1)
      items: [],
      parts: [],               // частицы
      pops: [],                // всплывающие надписи
      score: 0,
      combo: 0,
      bestCombo: 0,
      lives: 3,
      vibe: 30,
      flow: 0,                 // сек. до конца режима «ПОТОК»
      caught: 0,
      elapsed: 0,
      spawnT: 0.8,
      shake: 0,
      blinkT: 2 + Math.random() * 3,
      blink: 0,
      targetX: null
    };
  }
  resetState();

  /* ===== 4. Звук: крошечный WebAudio-синт (лоу-фай блипы) ===== */

  var audio = { ctx: null, muted: false };
  var PENTA = [523.25, 587.33, 659.25, 783.99, 880.0]; // C-мажорная пентатоника

  function beep(freq, dur, type, vol) {
    if (audio.muted) return;
    try {
      if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
      var t = audio.ctx.currentTime;
      var o = audio.ctx.createOscillator();
      var g = audio.ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol || 0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.ctx.destination);
      o.start(t);
      o.stop(t + dur);
    } catch (e) { /* без звука — тоже вайб */ }
  }

  function sfxCatch() { beep(PENTA[(Math.random() * PENTA.length) | 0], 0.14, 'square', 0.05); }
  function sfxBulb()  { beep(1046.5, 0.2, 'triangle', 0.07); beep(1318.5, 0.28, 'triangle', 0.05); }
  function sfxBug()   { beep(110, 0.3, 'sawtooth', 0.08); }
  function sfxFlow()  { PENTA.forEach(function (f, i) { setTimeout(function () { beep(f * 2, 0.18, 'triangle', 0.06); }, i * 70); }); }
  function sfxOver()  { beep(220, 0.4, 'sawtooth', 0.06); setTimeout(function () { beep(146.8, 0.6, 'sawtooth', 0.06); }, 220); }

  /* ===== 5. DOM: HUD и оверлеи ===== */

  var $ = function (id) { return document.getElementById(id); };
  var elScore = $('score'), elCombo = $('combo'), elLives = $('lives'),
      elVibe = $('vibefill'), elMenu = $('menu'), elOver = $('gameover'),
      elOverTitle = $('overTitle'), elOverStats = $('overStats'),
      elOverQuote = $('overQuote'), elHi = $('hiscore'), elMute = $('muteBtn');

  var QUOTES = [
    '«работает — не трогай»',
    '«это не баг, это фича»',
    '«задеплоим в пятницу, что может пойти не так»',
    '«ещё один рефактор и спать»',
    '«код ревью прошёл сам собой»',
    '«у меня локально работало!»'
  ];

  function updateHud() {
    elScore.textContent = state.score;
    elCombo.textContent = state.combo >= 3 ? 'x' + state.combo : '';
    elLives.textContent = new Array(state.lives + 1).join('♥') || '—';
    elVibe.style.width = Math.round(state.vibe) + '%';
    elVibe.classList.toggle('is-flow', state.flow > 0);
  }

  function showHiscore() {
    elHi.textContent = hiscore > 0 ? 'РЕКОРД: ' + hiscore : '';
  }
  showHiscore();

  /* ===== 6. Игровые события ===== */

  function popText(x, y, text, color) {
    state.pops.push({ x: x, y: y, text: text, color: color, life: 0.9 });
  }

  function burst(x, y, color, n) {
    if (reduceMotion) return;
    for (var i = 0; i < n; i++) {
      state.parts.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 60,
        vy: -Math.random() * 50 - 10,
        life: 0.5 + Math.random() * 0.4,
        color: color
      });
    }
  }

  function startGame() {
    resetState();
    state.mode = 'play';
    elMenu.classList.add('overlay--hidden');
    elOver.classList.add('overlay--hidden');
    updateHud();
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
    beep(659.25, 0.12, 'square', 0.05);
  }

  function gameOver() {
    state.mode = 'over';
    sfxOver();
    var isRecord = state.score > hiscore;
    if (isRecord) {
      hiscore = state.score;
      try { localStorage.setItem('clodik-hiscore', String(hiscore)); } catch (e) {}
    }
    elOverTitle.innerHTML = isRecord ? 'НОВЫЙ<br>РЕКОРД!' : 'БАГИ<br>ПОБЕДИЛИ…';
    elOverStats.innerHTML =
      'СЧЁТ: <b>' + state.score + '</b> · РЕКОРД: <b>' + hiscore + '</b><br>' +
      'поймано: ' + state.caught + ' · макс. комбо: x' + state.bestCombo;
    elOverQuote.textContent = QUOTES[(Math.random() * QUOTES.length) | 0];
    elOver.classList.remove('overlay--hidden');
    showHiscore();
  }

  function catchItem(it) {
    var T = TYPES[it.type];
    var mult = state.flow > 0 ? 2 : 1;

    if (T.good) {
      state.combo++;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      var pts = (T.pts + Math.min(state.combo, 10)) * mult;
      state.score += pts;
      state.vibe = Math.min(100, state.vibe + T.vibe);
      state.caught++;

      if (it.type === 'heart' && state.lives < 3) {
        state.lives++;
        popText(it.x, it.y, '+♥', '#e0607a');
      } else {
        popText(it.x, it.y, '+' + pts, it.type === 'bulb' ? '#f2c14e' : '#7ed491');
      }
      burst(it.x, it.y, it.type === 'bulb' ? '#f2c14e' : '#7ed491', 6);
      if (it.type === 'bulb') sfxBulb(); else sfxCatch();

      if (state.vibe >= 100 && state.flow <= 0) {
        state.flow = 8;
        popText(state.px, FLOOR - 30, 'ПОТОК! x2', '#f2c14e');
        sfxFlow();
      }
    } else {
      state.lives--;
      state.combo = 0;
      state.vibe = Math.max(0, state.vibe + T.vibe);
      state.flow = 0;
      state.shake = reduceMotion ? 0 : 0.35;
      popText(it.x, it.y, 'ОЙ, БАГ!', '#e0607a');
      burst(it.x, it.y, '#b96be0', 8);
      sfxBug();
      if (state.lives <= 0) gameOver();
    }
    updateHud();
  }

  /* ===== 7. Обновление мира ===== */

  function update(dt) {
    state.elapsed += dt;

    // Мигание глаз
    state.blinkT -= dt;
    if (state.blinkT <= 0) { state.blink = 0.12; state.blinkT = 2 + Math.random() * 3.5; }
    if (state.blink > 0) state.blink -= dt;

    if (state.mode !== 'play') return;

    // Движение игрока: клавиши либо палец
    var accel = 640, maxV = 130;
    var dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (state.targetX !== null) {
      var d = state.targetX - state.px;
      dir = Math.abs(d) < 3 ? 0 : (d > 0 ? 1 : -1);
    }
    if (dir !== 0) {
      state.pv += dir * accel * dt;
      state.look += (dir - state.look) * Math.min(1, dt * 10);
    } else {
      state.pv *= Math.pow(0.0001, dt); // плавное торможение
      state.look += (0 - state.look) * Math.min(1, dt * 4);
    }
    state.pv = Math.max(-maxV, Math.min(maxV, state.pv));
    state.px += state.pv * dt;
    state.px = Math.max(10, Math.min(W - 10, state.px));

    // Режим «ПОТОК»: вайб плавно стекает до 30
    if (state.flow > 0) {
      state.flow -= dt;
      state.vibe = 30 + 70 * Math.max(0, state.flow / 8);
      if (state.flow <= 0) { state.vibe = 30; updateHud(); }
    } else {
      state.vibe = Math.max(0, state.vibe - dt * 1.6); // вайб тихо тает
    }

    // Спавн предметов, сложность растёт
    state.spawnT -= dt;
    if (state.spawnT <= 0) {
      var interval = Math.max(0.42, 1.05 - state.elapsed / 70);
      state.spawnT = interval * (0.7 + Math.random() * 0.6);
      var type = pickType(state.elapsed);
      state.items.push({
        type: type,
        x: 12 + Math.random() * (W - 24),
        y: -10,
        vy: (34 + state.elapsed * 0.7 + Math.random() * 18) * (type === 'bulb' ? 1.25 : 1),
        wob: Math.random() * Math.PI * 2
      });
    }

    // Падение и ловля
    var half = 10; // половина ширины зоны ловли Клодика
    for (var i = state.items.length - 1; i >= 0; i--) {
      var it = state.items[i];
      it.y += it.vy * dt;
      if (it.type === 'note') it.x += Math.sin(state.elapsed * 4 + it.wob) * 14 * dt;

      var caughtNow = it.y > FLOOR - 14 && it.y < FLOOR + 2 &&
                      Math.abs(it.x - state.px) < half + 5;
      if (caughtNow) {
        catchItem(it);
        state.items.splice(i, 1);
        if (state.mode !== 'play') return;
      } else if (it.y > H + 8) {
        if (TYPES[it.type].good && it.type !== 'heart') {
          state.combo = 0;
          state.vibe = Math.max(0, state.vibe - 4);
          updateHud();
        }
        state.items.splice(i, 1);
      }
    }

    // Частицы и попапы
    for (i = state.parts.length - 1; i >= 0; i--) {
      var p = state.parts[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 140 * dt;
      if (p.life <= 0) state.parts.splice(i, 1);
    }
    for (i = state.pops.length - 1; i >= 0; i--) {
      var q = state.pops[i];
      q.life -= dt; q.y -= 18 * dt;
      if (q.life <= 0) state.pops.splice(i, 1);
    }

    if (state.shake > 0) state.shake -= dt;
  }

  /* ===== 8. Отрисовка ===== */

  var stars = [];
  for (var s = 0; s < 26; s++) {
    stars.push({ x: Math.random() * W, y: Math.random() * (H - 50), tw: Math.random() * Math.PI * 2 });
  }
  // «Строки кода» на фоновом мониторе
  var codeLines = [];
  for (var l = 0; l < 7; l++) {
    codeLines.push({ w: 18 + Math.random() * 30, indent: (Math.random() * 3 | 0) * 6 });
  }

  function draw(t) {
    ctx.save();
    if (state.shake > 0 && !reduceMotion) {
      ctx.translate((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
    }

    // Небо
    var flowGlow = state.flow > 0 ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
    ctx.fillStyle = state.flow > 0 ? '#241a3f' : '#14101f';
    ctx.fillRect(-4, -4, W + 8, H + 8);

    // Звёзды
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var a = 0.35 + 0.35 * Math.sin(t * 1.6 + st.tw);
      ctx.fillStyle = 'rgba(243,233,220,' + (reduceMotion ? 0.4 : a.toFixed(2)) + ')';
      ctx.fillRect(st.x | 0, st.y | 0, 1, 1);
    }

    // Луна-курсор (мигающий каретка-месяц)
    ctx.fillStyle = '#f2c14e';
    if (reduceMotion || Math.sin(t * 2.2) > -0.4) ctx.fillRect(W - 34, 16, 3, 9);

    // Фоновый монитор с кодом
    ctx.fillStyle = '#1c1530';
    ctx.fillRect(22, 58, 74, 48);
    ctx.fillStyle = '#2a2142';
    ctx.fillRect(22, 58, 74, 7);
    ctx.fillStyle = '#e0607a'; ctx.fillRect(26, 60, 3, 3);
    ctx.fillStyle = '#f2c14e'; ctx.fillRect(31, 60, 3, 3);
    ctx.fillStyle = '#7ed491'; ctx.fillRect(36, 60, 3, 3);
    for (i = 0; i < codeLines.length; i++) {
      var cl = codeLines[i];
      ctx.fillStyle = i % 3 === 0 ? '#5b4b8a' : '#3d3260';
      ctx.fillRect(27 + cl.indent, 70 + i * 5, cl.w, 2);
    }
    // Мигающий курсор в «коде»
    if (reduceMotion || Math.sin(t * 4) > 0) {
      ctx.fillStyle = '#e78a68';
      ctx.fillRect(27 + codeLines[6].indent + codeLines[6].w + 2, 99, 3, 3);
    }

    // Пол — рабочий стол
    ctx.fillStyle = '#241b38';
    ctx.fillRect(-4, FLOOR + 6, W + 8, H - FLOOR);
    ctx.fillStyle = '#332752';
    ctx.fillRect(-4, FLOOR + 6, W + 8, 2);

    // Предметы
    for (i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      var T = TYPES[it.type];
      ctx.drawImage(T.spr, (it.x - T.w / 2) | 0, (it.y - T.h / 2) | 0);
    }

    // Частицы
    for (i = 0; i < state.parts.length; i++) {
      var p = state.parts[i];
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x | 0, p.y | 0, 2, 2);
    }

    // Клодик
    var bob = reduceMotion ? 0 : Math.sin(t * 5) * 1.2;
    var cx = (state.px - 8) | 0;
    var cy = (FLOOR - 10 + bob) | 0;
    var body = state.flow > 0 ? claudeBodyFlow : claudeBody;

    if (state.flow > 0 && !reduceMotion) {
      // Ореол потока
      ctx.fillStyle = 'rgba(242,193,78,' + (0.12 + flowGlow * 0.1).toFixed(2) + ')';
      ctx.fillRect(cx - 3, cy - 3, 22, 20);
    }
    ctx.drawImage(body, cx, cy);

    // Глаза: следят за движением, моргают
    var ex = Math.max(-1, Math.min(1, Math.round(state.look * 1.5)));
    ctx.fillStyle = '#fff6ee';
    if (state.blink > 0) {
      ctx.fillStyle = '#8c4a32';
      ctx.fillRect(cx + 4, cy + 5, 3, 1);
      ctx.fillRect(cx + 9, cy + 5, 3, 1);
    } else {
      ctx.fillRect(cx + 4, cy + 4, 3, 3);
      ctx.fillRect(cx + 9, cy + 4, 3, 3);
      ctx.fillStyle = '#241e35';
      ctx.fillRect(cx + 5 + ex, cy + 5, 1, 2);
      ctx.fillRect(cx + 10 + ex, cy + 5, 1, 2);
    }

    // Нотки над наушниками в потоке
    if (state.flow > 0) {
      ctx.fillStyle = '#7ed491';
      var ny = cy - 6 + (reduceMotion ? 0 : Math.sin(t * 7) * 2);
      ctx.fillRect(cx - 4, ny | 0, 2, 2);
      ctx.fillRect(cx + 19, (ny + 3) | 0, 2, 2);
    }

    // Всплывающие надписи
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.textAlign = 'center';
    for (i = 0; i < state.pops.length; i++) {
      var q = state.pops[i];
      ctx.globalAlpha = Math.min(1, q.life * 2);
      ctx.fillStyle = q.color;
      ctx.fillText(q.text, q.x | 0, q.y | 0);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  /* ===== 9. Управление ===== */

  var keys = { left: false, right: false };

  document.addEventListener('keydown', function (e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keys.left = true; state.targetX = null; }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { keys.right = true; state.targetX = null; }
    if ((e.code === 'Space' || e.code === 'Enter') && state.mode !== 'play') {
      e.preventDefault();
      startGame();
    }
  });
  document.addEventListener('keyup', function (e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  });

  function pointerX(e) {
    var r = canvas.getBoundingClientRect();
    return (e.clientX - r.left) / r.width * W;
  }
  canvas.addEventListener('pointerdown', function (e) {
    if (state.mode !== 'play') return;
    state.targetX = pointerX(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (state.mode === 'play' && state.targetX !== null) state.targetX = pointerX(e);
  });
  canvas.addEventListener('pointerup', function () { state.targetX = null; });
  canvas.addEventListener('pointercancel', function () { state.targetX = null; });

  $('startBtn').addEventListener('click', startGame);
  $('restartBtn').addEventListener('click', startGame);

  elMute.addEventListener('click', function () {
    audio.muted = !audio.muted;
    elMute.textContent = audio.muted ? '🔇' : '🔊';
    elMute.setAttribute('aria-pressed', String(audio.muted));
  });

  /* ===== 10. Главный цикл ===== */

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw(now / 1000);
    requestAnimationFrame(frame);
  }
  updateHud();
  requestAnimationFrame(frame);
})();
