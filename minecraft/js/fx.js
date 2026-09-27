/* Кубокрафт — эффекты: частицы (дым, пламя, искры, пыль, брызги, гильзы, обломки блоков),
   жизнь вокруг игрока (листопад, светлячки, пепел Пекла, искры Небес, пылинки станции,
   огоньки факелов и костров) и погода обычного мира: дождь, снег, гроза с молниями.
   Мягкие частицы рисуются своим атласом с плавной прозрачностью; огонь, искры и вспышки —
   аддитивно, они светятся и дают свечение в постобработке. Обломки блоков — кусочки атласа блоков. */
(function (KC) {
  'use strict';

  var B = KC.B, BLOCKS = KC.BLOCKS;
  var world = null, hooks = {}, scale = 1, reduce = false;

  // ---- Атлас частиц: 8×8 клеток по 32 пикселя ------------------------------------------------
  var SP = {
    puff: 0, smoke1: 1, smoke2: 2, spark: 3, flame0: 4, flame1: 5, flame2: 6, flame3: 7,
    ember: 8, rain: 9, snow: 10, bubble: 11, leaf: 12, leaf2: 13, glint: 14, ring: 15,
    flash: 16, casing: 17, drop: 18, dust: 19, glow: 20, ash: 21, heart: 22, bolt: 23, splash: 24
  };
  var CELL = 32, NCELL = 8;

  function makeTexture() {
    var N = CELL * NCELL, cv = document.createElement('canvas');
    cv.width = cv.height = N;
    var g = cv.getContext && cv.getContext('2d');
    if (!g) return cv;
    var rnd = KC.mulberry32(99);
    function at(i) { return [(i % NCELL) * CELL, Math.floor(i / NCELL) * CELL]; }
    function radial(i, stops, cx, cy, r) {
      var o = at(i), x = o[0] + (cx === undefined ? 16 : cx), y = o[1] + (cy === undefined ? 16 : cy);
      var gr = g.createRadialGradient(x, y, 0, x, y, r || 15);
      stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); });
      g.fillStyle = gr;
      g.fillRect(o[0], o[1], CELL, CELL);
    }
    function blob(i, n, col, rmin, rmax) {
      var o = at(i);
      for (var k = 0; k < n; k++) {
        var a = rnd() * 6.283, d = rnd() * 7, r = rmin + rnd() * (rmax - rmin);
        var x = o[0] + 16 + Math.cos(a) * d, y = o[1] + 16 + Math.sin(a) * d;
        var gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
      }
    }
    g.save();
    // клетки не должны протекать друг в друга
    function clip(i) { var o = at(i); g.save(); g.beginPath(); g.rect(o[0] + 1, o[1] + 1, CELL - 2, CELL - 2); g.clip(); }
    clip(SP.puff); radial(SP.puff, [[0, 'rgba(255,255,255,0.95)'], [0.55, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]); g.restore();
    clip(SP.smoke1); blob(SP.smoke1, 7, 'rgba(255,255,255,0.5)', 5, 10); g.restore();
    clip(SP.smoke2); blob(SP.smoke2, 9, 'rgba(255,255,255,0.42)', 4, 9); g.restore();
    clip(SP.dust); blob(SP.dust, 12, 'rgba(255,255,255,0.4)', 3, 8); g.restore();
    // искра: вытянутая яркая черта
    clip(SP.spark);
    (function () {
      var o = at(SP.spark), gr = g.createLinearGradient(o[0], 0, o[0] + CELL, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(o[0], o[1] + 13, CELL, 6);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(o[0] + 6, o[1] + 15, 20, 2);
    })();
    g.restore();
    // языки пламени: четыре кадра капли, белое ядро → жёлтый → оранжевый край
    for (var f = 0; f < 4; f++) {
      var fi = SP.flame0 + f, fo = at(fi);
      clip(fi);
      for (var layer = 0; layer < 3; layer++) {
        var col = layer === 0 ? 'rgba(255,90,20,0.75)' : layer === 1 ? 'rgba(255,170,40,0.9)' : 'rgba(255,245,200,1)';
        var w = [11, 8, 4.5][layer], h = [26, 20, 12][layer], sway = Math.sin(f * 1.7 + layer) * 2.2;
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(fo[0] + 16 + sway * 1.4, fo[1] + 30 - h - 2);
        g.quadraticCurveTo(fo[0] + 16 + w + sway, fo[1] + 30 - h * 0.35, fo[0] + 16, fo[1] + 30);
        g.quadraticCurveTo(fo[0] + 16 - w + sway, fo[1] + 30 - h * 0.35, fo[0] + 16 + sway * 1.4, fo[1] + 30 - h - 2);
        g.fill();
      }
      g.restore();
    }
    clip(SP.ember); radial(SP.ember, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']], 16, 16, 10); g.restore();
    clip(SP.glow); radial(SP.glow, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]); g.restore();
    // капля дождя: тонкая черта вдоль u (как искра — частицы тянутся вдоль скорости)
    clip(SP.rain);
    (function () {
      var o = at(SP.rain), gr = g.createLinearGradient(o[0], 0, o[0] + CELL, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0.15)');
      g.fillStyle = gr; g.fillRect(o[0], o[1] + 14, CELL, 4);
    })();
    g.restore();
    clip(SP.snow); radial(SP.snow, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']], 16, 16, 7); g.restore();
    // пузырь: кольцо с бликом
    clip(SP.bubble);
    (function () {
      var o = at(SP.bubble);
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(o[0] + 16, o[1] + 16, 10, 0, 6.283); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(o[0] + 10, o[1] + 10, 4, 4);
    })();
    g.restore();
    // листья: зелёный и осенний
    [[SP.leaf, '#4f8a2e', '#6fae3c'], [SP.leaf2, '#b8661e', '#dd9a36']].forEach(function (L) {
      clip(L[0]);
      var o = at(L[0]);
      g.fillStyle = L[1];
      g.beginPath(); g.ellipse(o[0] + 16, o[1] + 16, 11, 6, 0.6, 0, 6.283); g.fill();
      g.fillStyle = L[2];
      g.beginPath(); g.ellipse(o[0] + 15, o[1] + 15, 7, 3.5, 0.6, 0, 6.283); g.fill();
      g.strokeStyle = 'rgba(40,60,20,0.8)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(o[0] + 7, o[1] + 22); g.lineTo(o[0] + 25, o[1] + 10); g.stroke();
      g.restore();
    });
    // блик-звёздочка
    clip(SP.glint);
    (function () {
      var o = at(SP.glint), cx = o[0] + 16, cy = o[1] + 16;
      radial(SP.glint, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']], 16, 16, 9);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath(); g.moveTo(cx, cy - 15); g.lineTo(cx + 2, cy); g.lineTo(cx, cy + 15); g.lineTo(cx - 2, cy); g.fill();
      g.beginPath(); g.moveTo(cx - 15, cy); g.lineTo(cx, cy - 2); g.lineTo(cx + 15, cy); g.lineTo(cx, cy + 2); g.fill();
    })();
    g.restore();
    // ударная волна: мягкое кольцо
    clip(SP.ring); radial(SP.ring, [[0, 'rgba(255,255,255,0)'], [0.62, 'rgba(255,255,255,0)'], [0.82, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]); g.restore();
    // вспышка выстрела: лучистая звезда
    clip(SP.flash);
    (function () {
      var o = at(SP.flash), cx = o[0] + 16, cy = o[1] + 16;
      g.fillStyle = 'rgba(255,220,140,0.9)';
      for (var k = 0; k < 7; k++) {
        var a = k / 7 * 6.283 + 0.2, r1 = k % 2 ? 9 : 15;
        g.beginPath(); g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a - 0.22) * 4, cy + Math.sin(a - 0.22) * 4);
        g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.lineTo(cx + Math.cos(a + 0.22) * 4, cy + Math.sin(a + 0.22) * 4);
        g.fill();
      }
      radial(SP.flash, [[0, 'rgba(255,255,240,1)'], [0.3, 'rgba(255,230,160,0.6)'], [1, 'rgba(255,200,120,0)']], 16, 16, 12);
    })();
    g.restore();
    // гильза: латунный цилиндр с бликом
    clip(SP.casing);
    (function () {
      var o = at(SP.casing);
      g.fillStyle = '#9c7422'; g.fillRect(o[0] + 11, o[1] + 6, 10, 20);
      g.fillStyle = '#d9b050'; g.fillRect(o[0] + 13, o[1] + 6, 3, 20);
      g.fillStyle = '#6e5118'; g.fillRect(o[0] + 11, o[1] + 23, 10, 3);
    })();
    g.restore();
    // капля воды
    clip(SP.drop); radial(SP.drop, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']], 16, 18, 8); g.restore();
    // хлопья пепла
    clip(SP.ash);
    (function () {
      var o = at(SP.ash);
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath(); g.moveTo(o[0] + 9, o[1] + 12); g.lineTo(o[0] + 22, o[1] + 9); g.lineTo(o[0] + 25, o[1] + 19); g.lineTo(o[0] + 13, o[1] + 24); g.fill();
    })();
    g.restore();
    // сердечко
    clip(SP.heart);
    (function () {
      var o = at(SP.heart), rows = ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'];
      g.fillStyle = '#e8384c';
      rows.forEach(function (r, y) { for (var x = 0; x < r.length; x++) if (r[x] === 'X') g.fillRect(o[0] + 3 + x * 3, o[1] + 4 + y * 3, 3, 3); });
    })();
    g.restore();
    // молния: светящаяся вертикальная полоса
    clip(SP.bolt);
    (function () {
      var o = at(SP.bolt), gr = g.createLinearGradient(o[0], 0, o[0] + CELL, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.35, 'rgba(200,210,255,0.5)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)');
      gr.addColorStop(0.65, 'rgba(200,210,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(o[0], o[1], CELL, CELL);
    })();
    g.restore();
    // всплеск дождя: корона из капель
    clip(SP.splash);
    (function () {
      var o = at(SP.splash);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (var k = 0; k < 7; k++) { var a = Math.PI + k / 6 * Math.PI; g.beginPath(); g.arc(o[0] + 16 + Math.cos(a) * 10, o[1] + 24 + Math.sin(a) * 12, 2.2, 0, 6.283); g.fill(); }
      g.fillRect(o[0] + 6, o[1] + 24, 20, 3);
    })();
    g.restore();
    g.restore();
    return cv;
  }

  function spUV(i) {
    var e = 0.6 / (CELL * NCELL), x = (i % NCELL) / NCELL, y = Math.floor(i / NCELL) / NCELL, s = 1 / NCELL;
    return [x + e, y + e, x + s - e, y + s - e];
  }
  var UV = [];
  for (var ui = 0; ui < NCELL * NCELL; ui++) UV.push(spUV(ui));

  // ---- Частицы ---------------------------------------------------------------------------------
  var soft = [], solid = [], pool = [];
  var MAX_SOFT = 2600, MAX_SOLID = 500;
  function newP() {
    var p = pool.pop() || {};
    p.x = p.y = p.z = 0; p.vx = p.vy = p.vz = 0; p.age = 0; p.life = 1;
    p.s0 = 0.1; p.s1 = 0.1; p.rot = 0; p.rs = 0; p.sp = 0; p.fr = 1; p.fps = 0;
    p.r = 1; p.g = 1; p.b = 1; p.a = 1; p.r1 = -1; p.g1 = 0; p.b1 = 0;
    p.grav = 0; p.drag = 0; p.add = false; p.lit = true; p.str = 0; p.bounce = -1; p.fin = 0.08; p.fout = 0.35;
    p.floor = -1e9; p.kind = ''; p.L = null; p.wob = 0; p.ph = Math.random() * 6.283; p.uv = null; p.amb = false; p.dd = 0;
    return p;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function jitter(p, s) { p.vx += (Math.random() - 0.5) * s; p.vy += (Math.random() - 0.5) * s; p.vz += (Math.random() - 0.5) * s; }
  function lightFor(x, y, z) { return hooks.lightAt ? hooks.lightAt(x, y, z) : [1, 1, 1]; }
  function pushSoft(p) {
    if (soft.length >= MAX_SOFT * scale) { pool.push(p); return null; }
    if (p.lit && !p.L) p.L = lightFor(p.x, p.y, p.z);
    soft.push(p);
    return p;
  }

  var DUST_COL = { dirt: [0.52, 0.42, 0.32], grass: [0.5, 0.44, 0.33], sand: [0.84, 0.77, 0.58], stone: [0.58, 0.58, 0.6],
    snow: [0.95, 0.97, 1.0], wood: [0.6, 0.5, 0.36], metal: [0.5, 0.52, 0.56], cloth: [0.8, 0.8, 0.8], plant: [0.4, 0.5, 0.3], glass: [0.8, 0.85, 0.9] };
  function dustColor(id) { var b = id && BLOCKS[id]; return (b && DUST_COL[b.mat]) || [0.6, 0.57, 0.53]; }

  function emit(kind, x, y, z, extra) {
    if (reduce && kind !== 'explosion' && kind !== 'block' && kind !== 'heart') return;
    var p, i, n;
    switch (kind) {
      case 'block': return emitBlock(x, y, z, extra);
      case 'smoke':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = Math.random() < 0.5 ? SP.smoke1 : SP.smoke2;
        p.vx = rnd(-0.3, 0.3); p.vy = rnd(0.4, 0.9); p.vz = rnd(-0.3, 0.3); p.grav = -0.5; p.drag = 0.8;
        p.life = rnd(1.6, 2.8); p.s0 = rnd(0.14, 0.22); p.s1 = rnd(0.5, 0.8); p.r = p.g = p.b = rnd(0.45, 0.6); p.a = 0.55;
        p.rot = rnd(0, 6.28); p.rs = rnd(-0.6, 0.6); p.fout = 0.6;
        return pushSoft(p);
      case 'smokeDark': case 'smokeRed':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = Math.random() < 0.5 ? SP.smoke1 : SP.smoke2;
        p.vx = rnd(-0.4, 0.4) + 0.4; p.vy = rnd(1.2, 2.0); p.vz = rnd(-0.4, 0.4) + 0.2; p.grav = -0.35; p.drag = 0.35;
        p.life = rnd(5, 7); p.s0 = rnd(0.5, 0.8); p.s1 = rnd(2.2, 3.2); p.rot = rnd(0, 6.28); p.rs = rnd(-0.3, 0.3); p.fout = 0.5;
        if (kind === 'smokeRed') { var sr = Math.random() * 0.2; p.r = 1.0 - sr; p.g = 0.2 + sr * 0.3; p.b = 0.18; p.a = 0.75; }
        else { var sd = Math.random() * 0.12; p.r = 0.3 + sd; p.g = 0.28 + sd; p.b = 0.27 + sd; p.a = 0.6; }
        return pushSoft(p);
      case 'flame':
        p = newP(); p.x = x + rnd(-0.05, 0.05); p.y = y; p.z = z + rnd(-0.05, 0.05); p.sp = SP.flame0; p.fr = 4; p.fps = rnd(10, 16);
        p.vx = rnd(-0.1, 0.1); p.vy = rnd(0.3, 0.6); p.vz = rnd(-0.1, 0.1); p.grav = -0.6;
        p.life = rnd(0.35, 0.6); p.s0 = rnd(0.1, 0.14); p.s1 = 0.04; p.add = true; p.lit = false; p.r = 1.5; p.g = 1.2; p.b = 1.0; p.fin = 0.05; p.fout = 0.2;
        return pushSoft(p);
      case 'fire':
        // языки огня горящего блока: крупнее и выше
        p = newP(); p.x = x + rnd(-0.35, 0.35); p.y = y + rnd(0, 0.3); p.z = z + rnd(-0.35, 0.35); p.sp = SP.flame0; p.fr = 4; p.fps = rnd(8, 14);
        p.vx = rnd(-0.2, 0.2); p.vy = rnd(0.8, 1.4); p.vz = rnd(-0.2, 0.2); p.grav = -0.4;
        p.life = rnd(0.5, 0.9); p.s0 = rnd(0.3, 0.45); p.s1 = 0.08; p.add = true; p.lit = false; p.r = 1.6; p.g = 1.15; p.b = 0.9; p.fin = 0.08; p.fout = 0.3;
        return pushSoft(p);
      case 'ember':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.ember;
        p.vx = rnd(-0.6, 0.6); p.vy = rnd(0.8, 2.2); p.vz = rnd(-0.6, 0.6); p.grav = -0.2; p.drag = 0.4; p.wob = 1.2;
        p.life = rnd(1.2, 2.6); p.s0 = rnd(0.035, 0.06); p.s1 = 0.02; p.add = true; p.lit = false; p.r = 2.0; p.g = 0.9; p.b = 0.3; p.fout = 0.8;
        return pushSoft(p);
      case 'spark':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.spark;
        p.vx = rnd(-3, 3); p.vy = rnd(1, 4); p.vz = rnd(-3, 3); p.grav = 12; p.bounce = 0.35; p.str = 0.035;
        p.life = rnd(0.25, 0.55); p.s0 = 0.05; p.s1 = 0.03; p.add = true; p.lit = false; p.r = 2.2; p.g = 1.7; p.b = 0.8; p.fin = 0.01; p.fout = 0.2;
        return pushSoft(p);
      case 'tracer':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.ember;
        p.life = 0.07; p.s0 = 0.05; p.s1 = 0.03; p.add = true; p.lit = false; p.r = 2.2; p.g = 1.9; p.b = 1.2; p.fin = 0.001; p.fout = 0.06;
        return pushSoft(p);
      case 'crit': case 'hit':
        // попадание по существу: тёмные брызги и облачко
        for (i = 0; i < 2; i++) {
          p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.drop;
          p.vx = rnd(-2, 2); p.vy = rnd(0.5, 3); p.vz = rnd(-2, 2); p.grav = 14; p.bounce = 0;
          p.life = rnd(0.4, 0.7); p.s0 = rnd(0.05, 0.08); p.s1 = 0.04; p.r = 0.45; p.g = 0.06; p.b = 0.05; p.a = 0.9;
          pushSoft(p);
        }
        return null;
      case 'splash':
        p = newP(); p.x = x + rnd(-0.3, 0.3); p.y = y; p.z = z + rnd(-0.3, 0.3); p.sp = SP.drop;
        p.vx = rnd(-1.2, 1.2); p.vy = rnd(2, 4.5); p.vz = rnd(-1.2, 1.2); p.grav = 14;
        p.life = rnd(0.5, 0.8); p.s0 = rnd(0.05, 0.09); p.s1 = 0.04; p.r = 0.75; p.g = 0.85; p.b = 1.0; p.a = 0.8;
        return pushSoft(p);
      case 'bubble':
        p = newP(); p.x = x + rnd(-0.2, 0.2); p.y = y; p.z = z + rnd(-0.2, 0.2); p.sp = SP.bubble;
        p.vy = rnd(0.8, 1.6); p.grav = -0.8; p.drag = 1.5; p.wob = 0.6;
        p.life = rnd(1, 1.8); p.s0 = rnd(0.04, 0.08); p.s1 = p.s0 * 1.3; p.r = 0.85; p.g = 0.95; p.b = 1.0; p.a = 0.8;
        return pushSoft(p);
      case 'heart':
        p = newP(); p.x = x + rnd(-0.3, 0.3); p.y = y; p.z = z + rnd(-0.3, 0.3); p.sp = SP.heart;
        p.vy = 0.8; p.grav = -0.3; p.life = 1.2; p.s0 = 0.14; p.s1 = 0.16; p.lit = false; p.r = 1.1; p.g = 1.0; p.b = 1.0;
        return pushSoft(p);
      case 'portal':
        p = newP(); p.x = x + rnd(-0.5, 0.5); p.y = y + rnd(-0.5, 0.5); p.z = z + rnd(-0.5, 0.5); p.sp = SP.glint;
        p.vx = (x - p.x) * 1.2; p.vy = rnd(0.2, 0.7); p.vz = (z - p.z) * 1.2;
        p.life = rnd(0.7, 1.2); p.s0 = rnd(0.05, 0.09); p.s1 = 0.01; p.add = true; p.lit = false; p.r = 1.3; p.g = 0.75; p.b = 1.6;
        if (extra === 'heaven') { p.r = 1.6; p.g = 1.4; p.b = 0.8; }
        return pushSoft(p);
      case 'jet':
        var jd = extra || [0, 0, -1], js = 9 + Math.random() * 3;
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.flame0; p.fr = 4; p.fps = 14;
        p.vx = jd[0] * js + rnd(-1, 1); p.vy = jd[1] * js + rnd(-1, 1) + 0.5; p.vz = jd[2] * js + rnd(-1, 1);
        p.grav = -1; p.drag = 1.2; p.life = rnd(0.4, 0.65); p.s0 = rnd(0.12, 0.2); p.s1 = rnd(0.5, 0.8);
        p.add = true; p.lit = false; p.r = 1.7; p.g = 1.1; p.b = 0.6; p.r1 = 0.9; p.g1 = 0.3; p.b1 = 0.1; p.rot = rnd(0, 6.28); p.rs = rnd(-3, 3);
        pushSoft(p);
        if (Math.random() < 0.25) {
          var q = newP(); q.x = x + jd[0] * 3; q.y = y + jd[1] * 3 + 0.3; q.z = z + jd[2] * 3; q.sp = SP.smoke1;
          q.vx = jd[0] * 2; q.vy = 1.2; q.vz = jd[2] * 2; q.grav = -0.6; q.drag = 0.6; q.life = rnd(1, 1.6);
          q.s0 = 0.3; q.s1 = 1.2; q.r = q.g = q.b = 0.3; q.a = 0.45; q.rot = rnd(0, 6.28); q.rs = 0.5;
          pushSoft(q);
        }
        return p;
      case 'dust':
        // пыль из-под ног и колёс, цвет — по материалу блока
        var dc = dustColor(extra);
        p = newP(); p.x = x + rnd(-0.2, 0.2); p.y = y + 0.05; p.z = z + rnd(-0.2, 0.2); p.sp = SP.dust;
        p.vx = rnd(-0.6, 0.6); p.vy = rnd(0.2, 0.6); p.vz = rnd(-0.6, 0.6); p.grav = 0.3; p.drag = 2.2;
        p.life = rnd(0.6, 1.0); p.s0 = rnd(0.12, 0.2); p.s1 = rnd(0.35, 0.55); p.r = dc[0]; p.g = dc[1]; p.b = dc[2]; p.a = 0.45;
        p.rot = rnd(0, 6.28); p.rs = rnd(-1, 1);
        return pushSoft(p);
      case 'exhaust':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.smoke1;
        var ev = extra || [0, 0, 0];
        p.vx = ev[0] + rnd(-0.2, 0.2); p.vy = rnd(0.3, 0.6); p.vz = ev[2] + rnd(-0.2, 0.2); p.grav = -0.3; p.drag = 1.2;
        p.life = rnd(0.9, 1.4); p.s0 = 0.1; p.s1 = rnd(0.45, 0.7); p.r = p.g = p.b = rnd(0.35, 0.5); p.a = 0.35;
        p.rot = rnd(0, 6.28); p.rs = rnd(-1, 1);
        return pushSoft(p);
      case 'casing':
        var cd = extra || [1, 0, 0];
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.casing;
        p.vx = cd[0] * rnd(1.8, 2.6); p.vy = rnd(2, 3.2); p.vz = cd[2] * rnd(1.8, 2.6); p.grav = 16; p.bounce = 0.3;
        p.life = rnd(2, 3); p.s0 = 0.045; p.s1 = 0.045; p.rot = rnd(0, 6.28); p.rs = rnd(8, 14) * (Math.random() < 0.5 ? -1 : 1);
        p.fout = 0.5;
        return pushSoft(p);
      case 'muzzle':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.flash; p.life = 0.08; p.s0 = extra || 0.5; p.s1 = (extra || 0.5) * 1.2;
        p.add = true; p.lit = false; p.r = 2.2; p.g = 1.8; p.b = 1.2; p.rot = rnd(0, 6.28); p.fin = 0.001; p.fout = 0.07;
        return pushSoft(p);
      case 'poof':
        // существо исчезает облачком
        n = 6;
        for (i = 0; i < n; i++) {
          p = newP(); p.x = x + rnd(-0.35, 0.35); p.y = y + rnd(0, 1.2); p.z = z + rnd(-0.35, 0.35); p.sp = SP.smoke1;
          p.vx = rnd(-0.6, 0.6); p.vy = rnd(0.3, 0.9); p.vz = rnd(-0.6, 0.6); p.drag = 1.8; p.grav = -0.3;
          p.life = rnd(0.7, 1.2); p.s0 = 0.2; p.s1 = rnd(0.55, 0.8); p.r = p.g = p.b = rnd(0.75, 0.9); p.a = 0.6; p.rot = rnd(0, 6.28); p.rs = 1;
          pushSoft(p);
        }
        return null;
      case 'explosion': return emitExplosion(x, y, z, extra || 3);
      case 'leaf':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = extra === 'autumn' ? SP.leaf2 : SP.leaf;
        p.vy = -0.4; p.grav = 0.6; p.drag = 2.4; p.wob = 1.4; p.life = rnd(4, 6.5); p.s0 = p.s1 = rnd(0.08, 0.11);
        p.rot = rnd(0, 6.28); p.rs = rnd(-2, 2); p.bounce = 0; p.fout = 1.2;
        return pushSoft(p);
      case 'firefly':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.glow; p.kind = 'firefly';
        p.vx = rnd(-0.4, 0.4); p.vy = rnd(-0.1, 0.2); p.vz = rnd(-0.4, 0.4); p.drag = 0.2;
        p.life = rnd(5, 9); p.s0 = p.s1 = rnd(0.06, 0.09); p.add = true; p.lit = false; p.r = 1.3; p.g = 1.6; p.b = 0.45; p.fin = 1; p.fout = 1.5;
        return pushSoft(p);
      case 'ash':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.ash;
        p.vx = rnd(-0.3, 0.3) + (extra ? extra[0] : 0); p.vy = rnd(-0.5, -0.2); p.vz = rnd(-0.3, 0.3) + (extra ? extra[1] : 0);
        p.wob = 0.6; p.drag = 0.3; p.life = rnd(6, 10); p.s0 = p.s1 = rnd(0.035, 0.06); p.rot = rnd(0, 6.28); p.rs = rnd(-2, 2);
        p.r = p.g = p.b = rnd(0.45, 0.65); p.a = 0.8; p.fin = 1; p.fout = 1.5;
        return pushSoft(p);
      case 'glint':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.glint; p.kind = 'glint';
        p.vx = rnd(-0.15, 0.15); p.vy = rnd(0.05, 0.3); p.vz = rnd(-0.15, 0.15);
        p.life = rnd(1.5, 3); p.s0 = p.s1 = rnd(0.06, 0.11); p.add = true; p.lit = false; p.rs = rnd(-1, 1);
        var gc = extra || [1.6, 1.45, 0.9]; p.r = gc[0]; p.g = gc[1]; p.b = gc[2]; p.fin = 0.5; p.fout = 0.8;
        return pushSoft(p);
      case 'mote':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.glow;
        p.vx = rnd(-0.08, 0.08); p.vy = rnd(-0.05, 0.05); p.vz = rnd(-0.08, 0.08); p.wob = 0.15;
        p.life = rnd(4, 8); p.s0 = p.s1 = rnd(0.015, 0.03); p.r = p.g = p.b = 1.3; p.a = 0.6; p.fin = 1; p.fout = 1.5;
        return pushSoft(p);
      case 'beam':
        // луч маяка: свечение, которое игра каждый кадр переносит вдоль луча; extra = [размер, яркость]
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.glow; p.life = 0.3; p.kind = 'beam';
        p.s0 = p.s1 = extra[0]; p.add = true; p.lit = false; p.r = 1.3 * extra[1]; p.g = 1.2 * extra[1]; p.b = 0.9 * extra[1]; p.fin = 0.01; p.fout = 0.15;
        return pushSoft(p);
      case 'shockwave':
        p = newP(); p.x = x; p.y = y; p.z = z; p.sp = SP.ring; p.life = 0.45; p.s0 = 0.5; p.s1 = extra || 7;
        p.add = true; p.lit = false; p.r = 1.3; p.g = 1.1; p.b = 0.8; p.fin = 0.01; p.fout = 0.35;
        return pushSoft(p);
    }
    return null;
  }

  // Обломки блока — кусочки его текстуры из атласа блоков, прыгают по земле
  function emitBlock(x, y, z, id) {
    var b = BLOCKS[id];
    if (!b || !b.tiles) return null;
    if (solid.length >= MAX_SOLID * scale) solid.shift();
    var tl = KC.tileUV(b.tiles.side), ou = Math.floor(Math.random() * 13), ov = Math.floor(Math.random() * 13);
    var SW = KC.ATLAS_W, SH = KC.ATLAS_H;
    var p = newP();
    p.uv = [tl[0] + ou / SW, tl[1] + ov / SH, tl[0] + (ou + 3) / SW, tl[1] + (ov + 3) / SH];
    p.x = x + rnd(-0.4, 0.4); p.y = y + rnd(-0.4, 0.4); p.z = z + rnd(-0.4, 0.4);
    p.vx = rnd(-1.6, 1.6); p.vy = rnd(1, 4); p.vz = rnd(-1.6, 1.6); p.grav = 18; p.bounce = 0.25;
    p.life = rnd(0.7, 1.4); p.s0 = p.s1 = rnd(0.05, 0.1);
    p.L = lightFor(x, y, z);
    solid.push(p);
    return p;
  }

  function emitExplosion(x, y, z, power) {
    var k = Math.min(2, power / 3), i, p;
    emit('shockwave', x, y + 0.3, z, 5 + power * 1.5);
    for (i = 0; i < Math.round(12 * k); i++) {
      p = newP(); p.x = x + rnd(-1, 1) * k; p.y = y + rnd(-0.5, 1) * k; p.z = z + rnd(-1, 1) * k; p.sp = SP.flame0 + Math.floor(Math.random() * 4);
      p.vx = rnd(-2.5, 2.5) * k; p.vy = rnd(0.5, 3) * k; p.vz = rnd(-2.5, 2.5) * k; p.drag = 3; p.grav = -1;
      p.life = rnd(0.45, 0.85); p.s0 = rnd(0.5, 0.9) * k; p.s1 = rnd(1.6, 2.6) * k; p.add = true; p.lit = false;
      p.r = 2.2; p.g = 1.4; p.b = 0.6; p.r1 = 0.6; p.g1 = 0.2; p.b1 = 0.05; p.rot = rnd(0, 6.28); p.rs = rnd(-2, 2); p.fin = 0.02; p.fout = 0.35;
      pushSoft(p);
    }
    for (i = 0; i < Math.round(16 * k); i++) {
      p = newP(); p.x = x + rnd(-1.5, 1.5) * k; p.y = y + rnd(0, 1.5) * k; p.z = z + rnd(-1.5, 1.5) * k; p.sp = Math.random() < 0.5 ? SP.smoke1 : SP.smoke2;
      p.vx = rnd(-1.5, 1.5); p.vy = rnd(1, 3); p.vz = rnd(-1.5, 1.5); p.drag = 1.2; p.grav = -0.4;
      p.life = rnd(2.5, 4.5); p.s0 = rnd(0.8, 1.2) * k; p.s1 = rnd(2.5, 3.8) * k; p.r = p.g = p.b = rnd(0.16, 0.28); p.a = 0.75;
      p.rot = rnd(0, 6.28); p.rs = rnd(-0.5, 0.5); p.fin = 0.15; p.fout = 1.5;
      pushSoft(p);
    }
    for (i = 0; i < Math.round(26 * k); i++) {
      p = emit('spark', x, y + 0.3, z);
      if (p) { p.vx *= 2.2 * k; p.vy *= 1.6 * k; p.vz *= 2.2 * k; p.life *= 1.8; }
    }
    for (i = 0; i < Math.round(10 * k); i++) emit('ember', x + rnd(-1, 1), y + rnd(0, 1), z + rnd(-1, 1));
    if (hooks.shake) hooks.shake(power, x, y, z);
    return null;
  }

  // ---- Погода ---------------------------------------------------------------------------------
  var W = { kind: 'clear', t: 240 + Math.random() * 300, k: 0, snow: 0, flash: 0, nextBolt: 8, bolts: [], thunder: [], wind: 1, on: false };
  function setWeather(kind, secs) {
    W.kind = kind;
    W.t = secs || (kind === 'clear' ? 400 : kind === 'rain' ? 180 : 120);
  }
  function weatherTick(dt, c) {
    W.on = !!c.weatherOn;
    if (W.on) {
      W.t -= dt;
      if (W.t <= 0) {
        var r = Math.random();
        if (W.kind === 'clear') W.kind = r < 0.62 ? 'rain' : r < 0.88 ? 'storm' : 'clear';
        else W.kind = r < 0.2 ? (W.kind === 'rain' ? 'storm' : 'rain') : 'clear';
        W.t = W.kind === 'clear' ? 300 + Math.random() * 420 : W.kind === 'rain' ? 120 + Math.random() * 180 : 70 + Math.random() * 110;
      }
    }
    var target = !W.on || W.kind === 'clear' ? 0 : W.kind === 'rain' ? 0.75 : 1;
    W.k += (target - W.k) * Math.min(1, dt * (W.on ? 0.07 : 1));
    if (W.k < 0.001) W.k = 0;
    W.snow += ((c.snowy ? 1 : 0) - W.snow) * Math.min(1, dt * 0.4);
    W.wind = 1 + W.k * 1.4;
    W.flash = Math.max(0, W.flash - dt * 2.5);
    // молнии и гром
    // вспышки молний не показываем тем, кто просил поменьше движения на экране
    if (W.on && W.kind === 'storm' && W.k > 0.65 && !c.reduce) {
      W.nextBolt -= dt;
      if (W.nextBolt <= 0) { W.nextBolt = 5 + Math.random() * 14; strike(c); }
    }
    for (var i = W.bolts.length - 1; i >= 0; i--) { W.bolts[i].t -= dt; if (W.bolts[i].t <= 0) W.bolts.splice(i, 1); }
    for (i = W.thunder.length - 1; i >= 0; i--) {
      var th = W.thunder[i];
      th.t -= dt;
      if (th.t <= 0) { if (hooks.sound) hooks.sound(th.d < 60 ? 'thunder-near' : 'thunder'); W.thunder.splice(i, 1); }
    }
  }
  // Удар молнии: ломаная от облаков к земле с отростками, вспышка неба и отложенный гром
  function strike(c) {
    var a = Math.random() * 6.283, d = 30 + Math.random() * 110;
    var x = c.cam.x + Math.cos(a) * d, z = c.cam.z + Math.sin(a) * d;
    var ground = hooks.groundAt ? hooks.groundAt(x, z) : 40, top = 118;
    if (!(ground > 0 && ground < top - 10)) ground = 40;
    var segs = [], px = x, py = top, pz = z;
    while (py > ground) {
      var ny = Math.max(ground, py - rnd(3, 7)), nx = px + rnd(-2.2, 2.2), nz = pz + rnd(-2.2, 2.2);
      segs.push([px, py, pz, nx, ny, nz, 0.45]);
      if (Math.random() < 0.18 && py - ground > 15) {
        var bx = nx, by = ny, bz = nz, ba = Math.random() * 6.283;
        for (var k = 0; k < 3; k++) {
          var ex = bx + Math.cos(ba) * rnd(2, 4), ey = by - rnd(2, 5), ez = bz + Math.sin(ba) * rnd(2, 4);
          segs.push([bx, by, bz, ex, ey, ez, 0.22]);
          bx = ex; by = ey; bz = ez;
        }
      }
      px = nx; py = ny; pz = nz;
    }
    W.bolts.push({ segs: segs, t: 0.32, x: x, y: ground + 4, z: z });
    W.flash = 1;
    W.thunder.push({ t: 0.25 + d / 90, d: d, dx: Math.cos(a) * d, dz: Math.sin(a) * d });
  }

  // Капли дождя и снежинки живут в цилиндре вокруг камеры и гаснут на крышах и земле
  function weatherParticles(dt, c) {
    if (!W.k || c.under) return;
    var rainN = Math.floor(1100 * scale * W.k * (1 - W.snow)), snowN = Math.floor(700 * scale * W.k * W.snow);
    var nRain = 0, nSnow = 0;
    for (var i = 0; i < soft.length; i++) { if (soft[i].kind === 'rain') nRain++; else if (soft[i].kind === 'snow') nSnow++; }
    var wx = 1.6 * W.wind, wz = 0.7 * W.wind, cam = c.cam;
    var spawn = Math.min(160, rainN - nRain), p, r, a, gy;
    for (i = 0; i < spawn; i++) {
      r = Math.pow(Math.random(), 0.7) * 22; a = Math.random() * 6.283;
      p = newP(); p.kind = 'rain'; p.x = cam.x + Math.cos(a) * r; p.z = cam.z + Math.sin(a) * r; p.y = cam.y + rnd(4, 18);
      gy = hooks.groundAt ? hooks.groundAt(p.x, p.z) : 0;
      if (!(gy > -100)) gy = cam.y - 30;
      if (gy > p.y) { pool.push(p); continue; }
      p.floor = gy; p.sp = SP.rain; p.vx = wx; p.vy = -rnd(15, 19); p.vz = wz; p.str = 0.055; p.life = 3;
      p.s0 = p.s1 = 0.026; p.lit = false; p.a = 0.55; p.fin = 0.05; p.fout = 0.01;
      var lc = c.rainCol; p.r = lc[0]; p.g = lc[1]; p.b = lc[2];
      soft.push(p);
    }
    spawn = Math.min(60, snowN - nSnow);
    for (i = 0; i < spawn; i++) {
      r = Math.pow(Math.random(), 0.7) * 20; a = Math.random() * 6.283;
      p = newP(); p.kind = 'snow'; p.x = cam.x + Math.cos(a) * r; p.z = cam.z + Math.sin(a) * r; p.y = cam.y + rnd(2, 14);
      gy = hooks.groundAt ? hooks.groundAt(p.x, p.z) : 0;
      if (!(gy > -100)) gy = cam.y - 30;
      if (gy > p.y) { pool.push(p); continue; }
      p.floor = gy; p.sp = SP.snow; p.vx = wx * 0.4; p.vy = -rnd(1.6, 2.6); p.vz = wz * 0.4; p.wob = 0.8; p.life = 12;
      p.s0 = p.s1 = rnd(0.035, 0.06); p.lit = false; p.a = 0.9; p.fin = 0.3; p.fout = 0.2;
      var sc = c.snowCol; p.r = sc[0]; p.g = sc[1]; p.b = sc[2];
      soft.push(p);
    }
  }

  // ---- Жизнь вокруг игрока -------------------------------------------------------------------
  var ambT = 0;
  function ambient(dt, c) {
    ambT -= dt;
    if (ambT > 0 || !world) return;
    ambT = 0.1;
    var cam = c.player, i, x, y, z, id;
    // огоньки факелов, языки огня, угли лавы, отсветы порталов — по списку светильников ближних чанков
    var cx0 = Math.floor(cam.x) >> 4, cz0 = Math.floor(cam.z) >> 4;
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      var ch = world.getChunk(cx0 + dx, cz0 + dz);
      if (!ch || !ch.emitters) continue;
      var list = ch.emitterIndices(), bx = (cx0 + dx) * 16, bz = (cz0 + dz) * 16, n = list.length, step = n > 400 ? Math.ceil(n / 400) : 1;
      for (i = Math.floor(Math.random() * step); i < n; i += step) {
        var idx = list[i];
        x = bx + (idx & 15); z = bz + ((idx >> 4) & 15); y = idx >> 8;
        var ddx = x - cam.x, ddy = y - cam.y, ddz = z - cam.z;
        if (ddx * ddx + ddy * ddy + ddz * ddz > 18 * 18) continue;
        id = ch.blocks[idx];
        var r = Math.random() * step;
        if (id === B.TORCH) {
          var m = ch.meta[idx] & 7, tx = x + 0.5, tz = z + 0.5, ty = y + 0.72;
          if (m !== 3 && m !== 2 && KC.DIRS[m]) { tx += KC.DIRS[m][0] * 0.32; tz += KC.DIRS[m][2] * 0.32; ty += 0.22; }
          if (r < 0.55) emit('flame', tx, ty, tz);
          if (r < 0.08) emit('smoke', tx, ty + 0.15, tz);
        } else if (id === B.FIRE) {
          if (r < 0.9) emit('fire', x + 0.5, y + 0.05, z + 0.5);
          if (r < 0.04 && hooks.sound) hooks.sound('crackle', x + 0.5, y + 0.5, z + 0.5);
          if (r < 0.35) emit('smoke', x + 0.5 + rnd(-0.3, 0.3), y + 0.9, z + 0.5 + rnd(-0.3, 0.3));
          if (r < 0.12) emit('ember', x + 0.5, y + 0.6, z + 0.5);
        } else if (id === B.LAVA) {
          if (r < 0.012 && !world.getBlock(x, y + 1, z)) { emit('ember', x + Math.random(), y + 1, z + Math.random()); if (Math.random() < 0.4) emit('smoke', x + 0.5, y + 1.1, z + 0.5); }
        } else if (id === B.EMBERS) {
          if (r < 0.1 && !world.getBlock(x, y + 1, z)) emit('smoke', x + Math.random(), y + 1.05, z + Math.random());
          if (r < 0.03) emit('ember', x + Math.random(), y + 1, z + Math.random());
        } else if (id === B.FIREFLOWER) {
          if (r < 0.06) emit('ember', x + 0.5, y + 0.6, z + 0.5);
        } else if (id === B.HELL_GATE || id === B.HEAVEN_GATE) {
          if (r < 0.35) emit('portal', x + 0.5, y + 0.5, z + 0.5, id === B.HEAVEN_GATE ? 'heaven' : null);
        } else if (id === B.SKY_CRYSTAL || id === B.HALO_FLOWER) {
          if (r < 0.08) emit('glint', x + Math.random(), y + Math.random() + 0.3, z + Math.random());
        } else if (id === B.GLOWROOT) {
          if (r < 0.04) emit('glint', x + Math.random(), y + Math.random(), z + Math.random(), [0.6, 1.2, 1.5]);
        } else if (id === B.FURNACE && (ch.meta[idx] & 4)) {
          if (r < 0.12) emit('smoke', x + 0.5, y + 1.05, z + 0.5);
        } else if (id === B.GENERATOR && (ch.meta[idx] & 4)) {
          if (r < 0.25) emit('exhaust', x + 0.5, y + 1.05, z + 0.5, [0, 0, 0]);
        }
      }
    }
    // случайные точки вокруг: листопад, светлячки, брызги дождя на воде
    var night = c.night, dim = c.dim;
    for (i = 0; i < 26; i++) {
      x = Math.floor(cam.x + rnd(-14, 14)); y = Math.floor(cam.y + rnd(-6, 10)); z = Math.floor(cam.z + rnd(-14, 14));
      id = world.getBlock(x, y, z);
      if (!id) continue;
      var bd = BLOCKS[id];
      if (bd.leaves && Math.random() < 0.035 * (1 + W.k * 2) && !world.getBlock(x, y - 1, z)) {
        emit('leaf', x + Math.random(), y - 0.05, z + Math.random(), id === B.BLOSSOM ? 'autumn' : (c.autumn && Math.random() < 0.5 ? 'autumn' : null));
      } else if (night > 0.6 && dim === 'over' && !c.city && !W.k && (id === B.TALL_GRASS || id === B.POPPY || id === B.DANDELION || id === B.CORNFLOWER) && Math.random() < 0.06) {
        var nf = 0;
        for (var q = 0; q < soft.length; q++) if (soft[q].kind === 'firefly') nf++;
        if (nf < 18 * scale) emit('firefly', x + 0.5, y + rnd(0.5, 1.8), z + 0.5);
      } else if (id === B.WATER && W.k > 0.2 && W.snow < 0.5 && !world.getBlock(x, y + 1, z) && hooks.skyOpen && hooks.skyOpen(x, y + 1, z)) {
        var sp = emit('splash', x + Math.random(), y + 0.9, z + Math.random());
        if (sp) { sp.vy *= 0.45; sp.vx *= 0.4; sp.vz *= 0.4; sp.life *= 0.6; }
      }
    }
    // настроение миров: пепел Пекла и города, искры Небес, пылинки станции
    var target = 0, kind = null;
    if (dim === 'hell') { kind = 'ash'; target = 90; }
    else if (dim === 'heaven') { kind = 'glint'; target = 45; }
    else if (dim === 'space' && c.indoors) { kind = 'mote'; target = 40; }
    else if (dim === 'over' && c.city) { kind = 'ash'; target = 30; }
    if (kind) {
      var have = 0;
      for (i = 0; i < soft.length; i++) if (soft[i].amb) have++;
      target = Math.floor(target * scale);
      for (i = 0; i < Math.min(8, target - have); i++) {
        var p = emit(kind, cam.x + rnd(-16, 16), cam.y + rnd(-3, 12), cam.z + rnd(-16, 16), kind === 'ash' && dim === 'over' ? [0.3, 0.15] : null);
        if (p) {
          p.amb = true;
          if (kind === 'ash' && dim === 'hell' && Math.random() < 0.35) { p.sp = SP.ember; p.add = true; p.lit = false; p.r = 1.8; p.g = 0.7; p.b = 0.25; p.vy = rnd(0.2, 0.6); }
        }
      }
    }
  }

  // ---- Обновление и сборка вершин ----------------------------------------------------------------
  var softData = new Float32Array(0), solidData = new Float32Array(0);
  var tmpA = [], tmpB = [];
  function update(dt, c) {
    scale = c.scale === undefined ? 1 : c.scale;
    reduce = !!c.reduce;
    weatherTick(dt, c);
    if (!reduce) { weatherParticles(dt, c); ambient(dt, c); }
    var i, p, groundY;
    for (i = soft.length - 1; i >= 0; i--) {
      p = soft[i];
      p.age += dt;
      if (p.age >= p.life) { kill(soft, i); continue; }
      p.vy -= p.grav * dt;
      if (p.drag) { var dk = Math.max(0, 1 - p.drag * dt); p.vx *= dk; p.vy *= dk; p.vz *= dk; }
      var wob = p.wob ? Math.sin(p.age * 2.3 + p.ph) * p.wob : 0;
      if (p.kind === 'firefly' && Math.random() < dt * 0.8) { p.vx = rnd(-0.5, 0.5); p.vy = rnd(-0.2, 0.25); p.vz = rnd(-0.5, 0.5); }
      p.x += (p.vx + wob) * dt; p.y += p.vy * dt; p.z += (p.vz + (p.wob ? Math.cos(p.age * 1.9 + p.ph) * p.wob * 0.7 : 0)) * dt;
      p.rot += p.rs * dt;
      if (p.floor > -1e8) {
        if (p.y <= p.floor) {
          if (p.kind === 'rain' && Math.random() < 0.3 * scale) {
            var d2 = (p.x - c.cam.x) * (p.x - c.cam.x) + (p.z - c.cam.z) * (p.z - c.cam.z);
            if (d2 < 14 * 14) {
              var s = newP(); s.kind = 'rsplash'; s.x = p.x; s.y = p.floor + 0.08; s.z = p.z; s.sp = SP.splash; s.life = 0.22;
              s.s0 = 0.06; s.s1 = 0.16; s.lit = false; s.r = p.r; s.g = p.g; s.b = p.b; s.a = 0.55; s.fin = 0.01; s.fout = 0.15;
              soft.push(s);
            }
          }
          kill(soft, i); continue;
        }
      } else if (p.bounce >= 0 && world) {
        var bid = world.getBlock(p.x, p.y, p.z);
        if (bid && KC.SOLID[bid]) {
          groundY = Math.floor(p.y) + 1.001;
          if (p.vy < 0 && p.y - p.vy * dt >= groundY - 0.05) {
            p.y = groundY;
            if (p.bounce > 0 && Math.abs(p.vy) > 1.5) { p.vy = -p.vy * p.bounce; p.vx *= 0.55; p.vz *= 0.55; p.rs *= 0.5; }
            else { p.vy = 0; p.vx = 0; p.vz = 0; p.rs = 0; p.grav = 0; p.drag = 0; p.wob = 0; }
          } else { p.vx *= -0.3; p.vz *= -0.3; }
        }
      }
    }
    for (i = solid.length - 1; i >= 0; i--) {
      p = solid[i];
      p.age += dt;
      if (p.age >= p.life) { kill(solid, i); continue; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (world && KC.SOLID[world.getBlock(p.x, p.y, p.z)]) {
        p.y = Math.floor(p.y) + 1.001;
        if (Math.abs(p.vy) > 2) { p.vy = -p.vy * p.bounce; p.vx *= 0.5; p.vz *= 0.5; } else { p.vy = 0; p.vx *= 0.6; p.vz *= 0.6; }
      }
    }
    return { soft: buildSoft(c), solid: buildSolid(c) };
  }
  function kill(arr, i) {
    var p = arr[i], last = arr.pop();
    if (i < arr.length) arr[i] = last;
    if (pool.length < 4000) pool.push(p);
  }

  function buildSolid(c) {
    var n = solid.length;
    if (!n) return null;
    if (solidData.length < n * 32) solidData = new Float32Array(n * 64);
    var r = c.right, u = c.up, d = solidData, o = 0;
    for (var i = 0; i < n; i++) {
      var p = solid[i], s = p.s0, L = p.L || [1, 1, 1], uv = p.uv;
      var rx = r[0] * s, ry = r[1] * s, rz = r[2] * s, ux = u[0] * s, uy = u[1] * s, uz = u[2] * s;
      var cs = [[-1, -1, uv[0], uv[3]], [1, -1, uv[2], uv[3]], [1, 1, uv[2], uv[1]], [-1, 1, uv[0], uv[1]]];
      for (var k = 0; k < 4; k++) {
        var a = cs[k][0], b = cs[k][1];
        d[o++] = p.x + rx * a + ux * b; d[o++] = p.y + ry * a + uy * b; d[o++] = p.z + rz * a + uz * b;
        d[o++] = cs[k][2]; d[o++] = cs[k][3]; d[o++] = L[0]; d[o++] = L[1]; d[o++] = L[2];
      }
    }
    return { data: d.subarray(0, o), quads: n };
  }

  function buildSoft(c) {
    var cam = c.cam, fw = c.fwd, i, p;
    tmpA.length = 0; tmpB.length = 0;
    for (i = 0; i < soft.length; i++) {
      p = soft[i];
      if (p.add) tmpB.push(p);
      else { var dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z; p.dd = dx * dx + dy * dy + dz * dz; tmpA.push(p); }
    }
    tmpA.sort(function (a, b) { return b.dd - a.dd; });
    var bolts = W.bolts, nb = 0;
    for (i = 0; i < bolts.length; i++) nb += bolts[i].segs.length;
    var total = tmpA.length + tmpB.length + nb;
    if (!total) return null;
    if (softData.length < total * 36) softData = new Float32Array(total * 72);
    var d = softData, o = 0, amb = c.ambient;
    function quad(p, list) {
      var t = p.age / p.life, s = p.s0 + (p.s1 - p.s0) * t;
      var fade = Math.min(1, p.age / p.fin) * Math.min(1, (p.life - p.age) / p.fout);
      if (p.kind === 'firefly') fade *= 0.35 + 0.65 * Math.max(0, Math.sin(p.age * 3.1 + p.ph));
      if (p.kind === 'glint') fade *= 0.5 + 0.5 * Math.sin(p.age * 6 + p.ph);
      var cr = p.r, cg = p.g, cb = p.b;
      if (p.r1 >= 0) { cr += (p.r1 - cr) * t; cg += (p.g1 - cg) * t; cb += (p.b1 - cb) * t; }
      if (p.lit) { var L = p.L || amb; cr *= L[0]; cg *= L[1]; cb *= L[2]; }
      var a = p.a * fade;
      if (p.add) { cr *= a; cg *= a; cb *= a; a = 1; }
      var sp = p.sp + (p.fr > 1 ? Math.floor(p.age * p.fps) % p.fr : 0), uv = UV[sp];
      var ax, ay, az, bx, by, bz;
      if (p.str) {
        // вытягиваем вдоль скорости (искры, дождь)
        var vx = p.vx, vy = p.vy, vz = p.vz, vd = vx * fw[0] + vy * fw[1] + vz * fw[2];
        var px = vx - fw[0] * vd, py = vy - fw[1] * vd, pz = vz - fw[2] * vd, pl = Math.sqrt(px * px + py * py + pz * pz) || 1;
        var len = s + Math.sqrt(vx * vx + vy * vy + vz * vz) * p.str;
        ax = px / pl * len; ay = py / pl * len; az = pz / pl * len;
        // поперёк: векторное произведение направления и взгляда
        var wx = py * fw[2] - pz * fw[1], wy = pz * fw[0] - px * fw[2], wz = px * fw[1] - py * fw[0], wl = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1;
        bx = wx / wl * s; by = wy / wl * s; bz = wz / wl * s;
        // текстура вытянута по u — поворачиваем: вдоль скорости идёт ось u
        push4(p.x, p.y, p.z, bx, by, bz, ax, ay, az, uv, cr, cg, cb, a, true);
        return;
      }
      var r = c.right, u = c.up, cs = Math.cos(p.rot) * s, sn = Math.sin(p.rot) * s;
      ax = r[0] * cs + u[0] * sn; ay = r[1] * cs + u[1] * sn; az = r[2] * cs + u[2] * sn;
      bx = -r[0] * sn + u[0] * cs; by = -r[1] * sn + u[1] * cs; bz = -r[2] * sn + u[2] * cs;
      push4(p.x, p.y, p.z, ax, ay, az, bx, by, bz, uv, cr, cg, cb, a, false);
    }
    function push4(x, y, z, ax, ay, az, bx, by, bz, uv, cr, cg, cb, a, swap) {
      var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (var k = 0; k < 4; k++) {
        var ca = corners[k][0], cb2 = corners[k][1];
        d[o++] = x + ax * ca + bx * cb2; d[o++] = y + ay * ca + by * cb2; d[o++] = z + az * ca + bz * cb2;
        if (swap) { d[o++] = cb2 < 0 ? uv[0] : uv[2]; d[o++] = ca < 0 ? uv[3] : uv[1]; }
        else { d[o++] = ca < 0 ? uv[0] : uv[2]; d[o++] = cb2 < 0 ? uv[3] : uv[1]; }
        d[o++] = cr; d[o++] = cg; d[o++] = cb; d[o++] = a;
      }
    }
    for (i = 0; i < tmpA.length; i++) quad(tmpA[i]);
    var addStart = tmpA.length;
    for (i = 0; i < tmpB.length; i++) quad(tmpB[i]);
    // молнии: светящиеся полосы, мерцают
    for (i = 0; i < bolts.length; i++) {
      var bl = bolts[i], vis = bl.t > 0.22 || (bl.t > 0.08 && bl.t < 0.15) ? 1 : 0.35;
      for (var k = 0; k < bl.segs.length; k++) {
        var sg = bl.segs[k], mx = (sg[0] + sg[3]) / 2, my = (sg[1] + sg[4]) / 2, mz = (sg[2] + sg[5]) / 2;
        var hx = (sg[3] - sg[0]) / 2, hy = (sg[4] - sg[1]) / 2, hz = (sg[5] - sg[2]) / 2;
        var tx = mx - cam.x, ty = my - cam.y, tz = mz - cam.z;
        var qx = hy * tz - hz * ty, qy = hz * tx - hx * tz, qz = hx * ty - hy * tx, ql = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1, wdt = sg[6] * 1.6;
        push4(mx, my, mz, qx / ql * wdt, qy / ql * wdt, qz / ql * wdt, hx, hy, hz, UV[SP.bolt], 2.4 * vis, 2.5 * vis, 3.0 * vis, 1, false);
      }
    }
    return { data: d.subarray(0, o), quads: o / 36, addStart: addStart };
  }

  // Молния освещает всё вокруг
  function lights() {
    var out = [];
    for (var i = 0; i < W.bolts.length; i++) {
      var b = W.bolts[i];
      out.push({ x: b.x, y: b.y + 20, z: b.z, r: 90, col: [1.6, 1.7, 2.2], pri: 4 });
    }
    return out;
  }

  function setWorld(w, h) { world = w; hooks = h || hooks; soft.length = 0; solid.length = 0; W.bolts.length = 0; }
  function clear() { soft.length = 0; solid.length = 0; }

  KC.FX = {
    makeTexture: makeTexture, emit: emit, update: update, setWorld: setWorld, clear: clear, lights: lights,
    weather: W, setWeather: setWeather, strike: function (c) { strike(c); }, get count() { return soft.length + solid.length; }
  };
})(window.KC = window.KC || {});
