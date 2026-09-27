/* Кубокрафт — главный модуль: запуск, игровой цикл (кадры + тики 20/с), управление
   (клавиатура, мышь, сенсор), камера (от первого и третьего лица), подгрузка чанков,
   небо и время суток, частицы, сохранение и меню. */
(function (KC) {
  'use strict';

  var B = KC.B, I = KC.I, BLOCKS = KC.BLOCKS, CS = KC.CS, H = KC.H, WL = KC.WL;
  var P = KC.Player, E = KC.Entities, Sim = KC.Sim, UI = KC.UI, Audio = KC.Audio;

  var SAVE_KEY = 'kubocraft.world.v2', OLD_KEY = 'kubocraft.world.v1', SET_KEY = 'kubocraft.settings.v1';
  var DAY_LENGTH = 1200, TICK = 1 / 20;
  var DIFF_NAMES = ['Мирная', 'Лёгкая', 'Обычная', 'Сложная'];

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function norm3(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  var mq = window.matchMedia ? function (q) { return window.matchMedia(q).matches; } : function () { return false; };
  var isTouch = mq('(pointer: coarse)') || (navigator.maxTouchPoints > 0 && !mq('(pointer: fine)'));
  var reduceMotion = mq('(prefers-reduced-motion: reduce)');

  function storageGet(key) { try { var v = window.localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function storageSet(key, val) { try { window.localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; } }

  // ---- Состояние ---------------------------------------------------------------------
  var settings = { dist: isTouch ? 4 : 6, sens: 1, cycle: true, sound: true, autojump: isTouch, debug: false, bright: 0.25 };
  var state = 'title';            // title | playing | paused | container | dead
  var world, renderer, atlas, spawn, placed = false, hasSave = false;
  var mode = 'survival', difficulty = 2;
  var titleCam = { x: 0, y: 0, z: 0, yaw: 0.6, pitch: -0.3 };
  var timeOfDay = 0.3, cloudOffset = 0, view = 0;
  var keys = {}, mouse = { l: false, r: false, lPress: false, rPress: false };
  var joy = { id: null, cx: 0, cy: 0, x: 0, y: 0 }, lookTouch = { id: null, x: 0, y: 0 };
  var touchJump = false, touchDown = false, touchSprint = false;
  var target = null, targetMob = null;
  var fov = 72, aspect = 1, tickAcc = 0, attackT = 0, useT = 0;
  var lastSpace = 0, lastW = 0, sprintLatch = false, lastUnload = 0;
  var locked = false, dragMode = false, everLocked = false, drag = null;
  var saveTimer = 0, sleeping = 0, tips = {};
  var dayFactor = 1;

  var OFFSETS = [];
  (function () {
    var R = 14;
    for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) {
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d <= R) OFFSETS.push({ dx: dx, dz: dz, d: d });
    }
    OFFSETS.sort(function (a, b) { return a.d - b.d; });
  })();

  // ---- Запуск ---------------------------------------------------------------------------
  function boot() {
    document.body.classList.toggle('is-touch', isTouch);
    var canvas = $('gl');
    try { renderer = new KC.Renderer(canvas); }
    catch (e) { fatal('Браузер не дал доступ к WebGL. Включите аппаратное ускорение или откройте игру в другом браузере.'); return; }
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault(); saveGame();
      fatal('Видеокарта сбросила графический контекст. Обновите страницу: мир сохранён.');
    });
    atlas = KC.makeAtlas();
    renderer.setAtlas(atlas);
    renderer.setMobAtlas(KC.Models.init());

    var s = storageGet(SET_KEY);
    if (s) for (var k in settings) if (typeof s[k] === typeof settings[k]) settings[k] = s[k];
    settings.dist = clamp(settings.dist | 0, 2, 10);
    Audio.setEnabled(settings.sound);

    UI.init({
      atlas: atlas, toast: toast,
      select: function (n) { selectSlot(n); },
      drop: function (st) { dropStack(st); },
      close: function () { closeContainer(); },
      sound: function (n) { Audio.play(n); },
      invChanged: function () {}
    });

    startWorld(loadSave());
    buildUI();
    bindInput();
    resize();
    window.addEventListener('resize', resize);
    showScreen('title');
    requestAnimationFrame(frame);
  }

  function fatal(text) {
    $('fatal-text').textContent = text;
    ['title', 'pause', 'container', 'hud', 'touch', 'death'].forEach(function (id) { var el = $(id); if (el) el.hidden = true; });
    $('fatal').hidden = false;
    state = 'fatal';
  }

  function loadSave() {
    var s = storageGet(SAVE_KEY);
    if (s && typeof s.seed === 'number') return s;
    var old = storageGet(OLD_KEY);
    if (old && typeof old.seed === 'number') { old.migrated = true; old.mode = 'creative'; return old; }
    return null;
  }

  function hooksCommon() {
    return {
      player: function () { return P.e; },
      sound: function (n, x, y, z) { Audio.play(n, x, y, z); },
      particles: particles,
      day: function () { return dayFactor; },
      difficulty: function () { return difficulty; }
    };
  }

  function startWorld(save, opts) {
    if (world) world.chunks.forEach(function (c) { renderer.deleteMesh(c); });
    var ok = !!(save && typeof save.seed === 'number');
    hasSave = ok;
    var seed = ok ? save.seed : (opts && opts.seed) || Math.floor(Math.random() * 999999) + 1;
    mode = ok ? (save.mode || 'survival') : (opts && opts.mode) || 'survival';
    difficulty = ok && typeof save.diff === 'number' ? save.diff : (opts && typeof opts.diff === 'number' ? opts.diff : 2);
    world = new KC.World(seed, ok && save.edits ? save.edits : {});
    world.animalChunks = ok && save.animalChunks ? save.animalChunks : {};
    world.storedMobs = ok && save.storedMobs ? save.storedMobs : {};

    var h = hooksCommon();
    h.hurtPlayer = function (amt, cause, src, knock) { P.hurt(amt, cause, src, knock); };
    h.give = function (st) { return P.give(st); };
    h.heldId = function () { return P.heldId(); };
    h.explode = function (x, y, z, pw) { Sim.explode(x, y, z, pw); };
    h.pressPlate = function (x, y, z) { Sim.pressPlate(x, y, z); };
    h.primeTnt = function (x, y, z) { Sim.primeTnt(x, y, z); };
    E.init(world, h);

    var hs = hooksCommon();
    hs.explosionHit = explosionHit;
    Sim.init(world, hs);

    var hp = hooksCommon();
    hp.toast = toast;
    hp.sound = function (n, x, y, z) { Audio.play(n, x === undefined ? P.e.x : x, y === undefined ? P.e.y + 1 : y, z === undefined ? P.e.z : z); };
    hp.open = openContainer;
    hp.invChanged = function () { UI.renderHud(); if (UI.screen) UI.renderContainer(); };
    hp.hudChanged = function () { UI.renderHud(); };
    hp.onDeath = onDeath;
    hp.sleep = startSleep;
    hp.pressPlate = function (x, y, z) { Sim.pressPlate(x, y, z); };
    hp.liquidTarget = function () { return raycastBlocks(eyePos(), lookDir(), P.REACH, true); };
    hp.blockBroken = function (x, y, z, id) {
      Audio.play('break:' + BLOCKS[id].mat, x + 0.5, y + 0.5, z + 0.5);
      for (var i = 0; i < 12; i++) particles('block', x + 0.5, y + 0.5, z + 0.5, id);
      if ((id === B.LOG || id === B.BIRCH_LOG) && !tips.log && mode === 'survival') { tips.log = 1; setTimeout(function () { toast('Нажмите E → «Рецепты»: из брёвен выйдут доски и верстак'); }, 1200); }
    };
    P.init(world, hp);
    P.reset(mode === 'creative');

    if (ok) {
      Sim.restore(save.bents);
      E.restore(save.entities);
    }
    spawn = world.findSpawn();
    renderer.makeClouds(seed);
    timeOfDay = ok && typeof save.time === 'number' ? save.time % 1 : 0.28;
    if (!settings.cycle) timeOfDay = 0.28;

    var sp = ok && save.player, e = P.e;
    placed = false;
    if (sp && isFinite(sp.x)) {
      e.x = sp.x; e.y = sp.y; e.z = sp.z; e.yaw = sp.yaw || 0; e.pitch = sp.pitch || 0; e.fly = !!sp.fly && mode === 'creative';
      if (save.v === 2) {
        P.inv = (sp.inv || []).map(unpackStack); while (P.inv.length < 36) P.inv.push(null);
        P.armor = (sp.armor || [0, 0, 0, 0]).map(unpackStack);
        P.slot = sp.slot | 0;
        P.hp = sp.hp || 20; P.food = sp.food === undefined ? 20 : sp.food; P.sat = sp.sat || 0; P.air = 15;
        P.spawnPoint = sp.spawn || null;
        tips = save.tips || {};
      } else if (Array.isArray(save.hotbar)) {
        save.hotbar.forEach(function (id, i) { if (KC.ITEMS[id]) P.inv[i] = { id: id, n: 64, d: 0 }; });
        P.slot = save.slot | 0;
      }
      placedSaved = true;
    } else {
      e.x = spawn.x; e.y = spawn.h + 1; e.z = spawn.z; e.yaw = 0.8; e.pitch = -0.1; e.fly = false;
      placedSaved = false;
      tips = {};
    }
    e.vx = e.vy = e.vz = 0;
    titleCam.x = e.x; titleCam.z = e.z;
    titleCam.y = (placedSaved ? e.y : Math.max(spawn.h, WL)) + 16;
    titleCam.yaw = e.yaw + 0.6;
    particlesList.length = 0;
    target = null; targetMob = null;
    UI.forceHud();
    if ($('seed-label')) updateTitle();
  }
  var placedSaved = false;

  function packStack(s) { return s ? [s.id, s.n, s.d || 0] : 0; }
  function unpackStack(a) { return a && KC.ITEMS[a[0]] ? { id: a[0], n: a[1], d: a[2] || 0 } : null; }

  // Ставит игрока в мир: догружает чанки вокруг и ищет свободное место
  function placePlayer() {
    var e = P.e, pcx = Math.floor(e.x / CS), pcz = Math.floor(e.z / CS), dx, dz, c;
    for (dz = -2; dz <= 2; dz++) for (dx = -2; dx <= 2; dx++) if (!world.getChunk(pcx + dx, pcz + dz)) world.generate(pcx + dx, pcz + dz);
    for (dz = -1; dz <= 1; dz++) for (dx = -1; dx <= 1; dx++) { c = world.getChunk(pcx + dx, pcz + dz); if (!c.mesh || c.dirty) remesh(c); }
    if (!placedSaved) {
      var spot = openSpot(Math.floor(e.x), Math.floor(e.z));
      e.x = spot.x + 0.5; e.z = spot.z + 0.5; e.y = spot.y;
    }
    var guard = 0;
    while (guard++ < H && E.boxHits(e.x, e.y, e.z, e.w, e.h)) e.y += 1;
    placed = true;
    placedSaved = true;
  }

  function openSpot(x0, z0) {
    var bad = [B.LEAVES, B.LOG, B.BIRCH_LOG, B.CACTUS, B.WATER, B.LAVA];
    function clearAround(x, y, z) {
      for (var dy = 0; dy <= 3; dy++) for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
        var id = world.getBlock(x + dx, y + dy, z + dz);
        if (id === B.LEAVES || id === B.LOG || id === B.BIRCH_LOG) return false;
      }
      return true;
    }
    for (var r = 0; r <= 10; r++) {
      for (var dz = -r; dz <= r; dz++) for (var dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        var x = x0 + dx, z = z0 + dz;
        if (!world.isLoaded(x, z)) continue;
        for (var y = H - 1; y > 0; y--) {
          var id = world.getBlock(x, y, z);
          if (!id || KC.REPLACEABLE[id] && !KC.LIQUID[id] || BLOCKS[id].shape === 'cross') continue;
          if (bad.indexOf(id) < 0 && clearAround(x, y + 1, z)) return { x: x, y: y + 1, z: z };
          break;
        }
      }
    }
    return { x: x0, y: spawn.h + 1, z: z0 };
  }

  // ---- Подгрузка чанков ----------------------------------------------------------------
  function remesh(c) { renderer.uploadMesh(c, world.buildMesh(c)); c.dirty = false; }

  function stream(cx0, cz0, budget) {
    var t0 = performance.now(), R = settings.dist;
    var genR = R + 1.5, keepMeshR = R + 1.5, keepR = R + 3.5, urgent = 0;
    world.chunks.forEach(function (c) { if (c.dirty && c.mesh && urgent < 12) { remesh(c); urgent++; } });
    for (var i = 0; i < OFFSETS.length; i++) {
      var o = OFFSETS[i];
      if (o.d > genR) break;
      if (performance.now() - t0 > budget) break;
      var cx = cx0 + o.dx, cz = cz0 + o.dz, c = world.getChunk(cx, cz);
      if (!c) { world.generate(cx, cz); continue; }
      if (o.d <= R && (!c.mesh || c.dirty) && world.hasNeighbors(cx, cz)) remesh(c);
    }
    var now = performance.now();
    if (now - lastUnload > 1000) {
      lastUnload = now;
      world.chunks.forEach(function (c, key) {
        var ddx = c.cx - cx0, ddz = c.cz - cz0, d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (d > keepR) { E.onChunkUnload(c); renderer.deleteMesh(c); world.chunks.delete(key); }
        else if (d > keepMeshR && c.mesh) renderer.deleteMesh(c);
      });
    }
  }

  function visibleChunks(cx0, cz0) {
    var list = [], R = settings.dist, ready = 0, total = 0;
    for (var i = 0; i < OFFSETS.length; i++) {
      var o = OFFSETS[i];
      if (o.d > R) break;
      total++;
      var c = world.getChunk(cx0 + o.dx, cz0 + o.dz);
      if (c && c.mesh) { list.push(c); ready++; }
    }
    list.progress = total ? ready / total : 1;
    return list;
  }

  // ---- Луч и цель ------------------------------------------------------------------------
  function eyePos() { return [P.e.x, P.e.y + P.EYE - (P.sneak ? 0.15 : 0), P.e.z]; }
  function lookDir() {
    var e = P.e, cp = Math.cos(e.pitch);
    return [-Math.sin(e.yaw) * cp, Math.sin(e.pitch), -Math.cos(e.yaw) * cp];
  }

  function rayBox(o, d, b) {
    var tmin = 0, tmax = 1e9;
    for (var a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < b[a] || o[a] > b[a + 3]) return -1; continue; }
      var t1 = (b[a] - o[a]) / d[a], t2 = (b[a + 3] - o[a]) / d[a];
      if (t1 > t2) { var t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    return tmin;
  }

  function raycastBlocks(o, d, maxD, liquids) {
    var x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
    var sx = d[0] > 0 ? 1 : -1, sy = d[1] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
    var ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
    var tx = ax > 1e-9 ? (sx > 0 ? x + 1 - o[0] : o[0] - x) / ax : Infinity;
    var ty = ay > 1e-9 ? (sy > 0 ? y + 1 - o[1] : o[1] - y) / ay : Infinity;
    var tz = az > 1e-9 ? (sz > 0 ? z + 1 - o[2] : o[2] - z) / az : Infinity;
    var dx = ax > 1e-9 ? 1 / ax : Infinity, dy = ay > 1e-9 ? 1 / ay : Infinity, dz = az > 1e-9 ? 1 / az : Infinity;
    var nx = 0, ny = 0, nz = 0, t = 0;
    while (t <= maxD) {
      var id = world.getBlock(x, y, z);
      if (id) {
        var m = world.getMeta(x, y, z);
        if (KC.LIQUID[id]) {
          if (liquids && (m & 7) === 0 && !(m & 8)) return { x: x, y: y, z: z, nx: nx, ny: ny, nz: nz, id: id, t: t };
        } else {
          var sb = KC.selectionBox(id, m);
          if (sb) {
            var full = sb[0] === 0 && sb[1] === 0 && sb[2] === 0 && sb[3] === 1 && sb[4] === 1 && sb[5] === 1;
            if (full) return { x: x, y: y, z: z, nx: nx, ny: ny, nz: nz, id: id, t: t, box: sb };
            var hit = rayBox(o, d, [x + sb[0], y + sb[1], z + sb[2], x + sb[3], y + sb[4], z + sb[5]]);
            if (hit >= 0 && hit <= maxD) return { x: x, y: y, z: z, nx: nx, ny: ny, nz: nz, id: id, t: hit, box: sb };
          }
        }
      }
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += dx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { y += sy; t = ty; ty += dy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tz; tz += dz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  function updateTarget() {
    var o = eyePos(), d = lookDir();
    target = raycastBlocks(o, d, P.REACH, false);
    var mh = E.raycast(o[0], o[1], o[2], d, P.ATTACK_REACH);
    targetMob = mh && (!target || mh.t < target.t) ? mh.e : null;
  }

  // ---- Частицы -----------------------------------------------------------------------
  var particlesList = [];
  var WHITE_UV = null;
  function particles(kind, x, y, z, extra) {
    if (reduceMotion && kind !== 'explosion') return;
    if (!WHITE_UV) WHITE_UV = KC.tileUV(KC.TILE.primedTnt);
    var p = { x: x, y: y, z: z, vx: (Math.random() - 0.5) * 2, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 2,
      life: 0.6 + Math.random() * 0.5, size: 0.08, grav: 12, col: [1, 1, 1], uv: WHITE_UV };
    switch (kind) {
      case 'block':
        var tl = KC.tileUV(BLOCKS[extra].tiles.side), ou = Math.floor(Math.random() * 13), ov = Math.floor(Math.random() * 13);
        var S = KC.ATLAS_SIZE;
        p.uv = [tl[0] + ou / S, tl[1] + ov / S, tl[0] + (ou + 3) / S, tl[1] + (ov + 3) / S];
        p.x += (Math.random() - 0.5) * 0.8; p.y += (Math.random() - 0.5) * 0.8; p.z += (Math.random() - 0.5) * 0.8;
        p.vx *= 1.6; p.vz *= 1.6; p.vy = 1 + Math.random() * 3; p.size = 0.05 + Math.random() * 0.05; p.grav = 18;
        break;
      case 'smoke': p.col = [0.55, 0.55, 0.55]; p.grav = -1.5; p.vy = 0.5; p.size = 0.1 + Math.random() * 0.08; p.life = 1; break;
      case 'flame': p.col = [1.4, 0.7, 0.2]; p.grav = -2; p.vx *= 0.2; p.vz *= 0.2; p.vy = 0.4; p.size = 0.06; p.life = 0.4; break;
      case 'heart': p.col = [1.3, 0.25, 0.35]; p.grav = -1; p.vx *= 0.3; p.vz *= 0.3; p.vy = 0.8; p.size = 0.1; p.life = 1; break;
      case 'crit': p.col = [1.3, 1.2, 0.6]; p.vx *= 2.5; p.vz *= 2.5; p.vy = 2 + Math.random() * 2; p.size = 0.05; p.life = 0.5; break;
      case 'splash': p.col = [0.5, 0.7, 1.2]; p.vy = 3; p.size = 0.05; break;
      case 'explosion':
        for (var i = 0; i < 40; i++) {
          particlesList.push({ x: x + (Math.random() - 0.5) * 3, y: y + (Math.random() - 0.5) * 3, z: z + (Math.random() - 0.5) * 3,
            vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3, life: 0.8 + Math.random() * 0.8,
            size: 0.25 + Math.random() * 0.35, grav: -1, col: i % 3 ? [0.6, 0.6, 0.6] : [1.3, 0.9, 0.5], uv: WHITE_UV });
        }
        return;
    }
    particlesList.push(p);
    if (particlesList.length > 600) particlesList.splice(0, particlesList.length - 600);
  }

  var partData = new Float32Array(0);
  function updateParticles(dt) {
    for (var i = particlesList.length - 1; i >= 0; i--) {
      var p = particlesList[i];
      p.life -= dt;
      if (p.life <= 0) { particlesList.splice(i, 1); continue; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.grav > 0 && KC.SOLID[world.getBlock(p.x, p.y, p.z)]) { p.y = Math.floor(p.y) + 1.001; p.vy = 0; p.vx *= 0.5; p.vz *= 0.5; }
    }
    var n = particlesList.length;
    if (!n) return null;
    var need = n * 32;
    if (partData.length < need) partData = new Float32Array(need * 2);
    var r = renderer.right, u = renderer.up, d = partData, o = 0;
    var L = E.lightAt(P.e.x, P.e.y + 1, P.e.z);
    for (i = 0; i < n; i++) {
      p = particlesList[i];
      var s = p.size, rx = r[0] * s, ry = r[1] * s, rz = r[2] * s, ux = u[0] * s, uy = u[1] * s, uz = u[2] * s;
      var cr = p.col[0] * (p.col[0] > 1 ? 1 : L[0]), cg = p.col[1] * (p.col[0] > 1 ? 1 : L[1]), cb = p.col[2] * (p.col[0] > 1 ? 1 : L[2]);
      var cs = [[-1, -1, p.uv[0], p.uv[3]], [1, -1, p.uv[2], p.uv[3]], [1, 1, p.uv[2], p.uv[1]], [-1, 1, p.uv[0], p.uv[1]]];
      for (var k = 0; k < 4; k++) {
        var a = cs[k][0], b = cs[k][1];
        d[o++] = p.x + rx * a + ux * b; d[o++] = p.y + ry * a + uy * b; d[o++] = p.z + rz * a + uz * b;
        d[o++] = cs[k][2]; d[o++] = cs[k][3]; d[o++] = cr; d[o++] = cg; d[o++] = cb;
      }
    }
    return { data: d.subarray(0, o), quads: n };
  }

  // Урон от взрыва по существам и игроку
  function explosionHit(x, y, z, power) {
    var R = power * 2;
    E.list.concat([P.e]).forEach(function (e) {
      if (e.dead || (e.type !== 'mob' && e.type !== 'player' && e.type !== 'item')) return;
      var dx = e.x - x, dy = e.y + e.h / 2 - y, dz = e.z - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > R) return;
      var imp = 1 - d / R, dd = d || 1;
      var kn = [dx / dd * imp * 12, 3 + imp * 6, dz / dd * imp * 12];
      if (e.type === 'item') { e.vx += kn[0]; e.vy += kn[1]; e.vz += kn[2]; return; }
      var dmg = Math.floor((imp * imp + imp) / 2 * 7 * power + 1);
      if (e.type === 'player') P.hurt(dmg * [0.3, 0.6, 1, 1.3][difficulty], 'Взрыв', null, kn);
      else E.damageMob(e, dmg, 'explosion', kn);
    });
  }

  // ---- Небо --------------------------------------------------------------------------------
  function skyState() {
    var a = timeOfDay * Math.PI * 2;
    var sun = norm3([Math.cos(a), Math.sin(a), 0.28]);
    var sunR = norm3([-sun[1], sun[0], 0]);
    var sunU = [sun[1] * sunR[2] - sun[2] * sunR[1], sun[2] * sunR[0] - sun[0] * sunR[2], sun[0] * sunR[1] - sun[1] * sunR[0]];
    var day = smooth(-0.16, 0.24, sun[1]);
    dayFactor = 0.26 + 0.74 * day;
    var top = mix3([0.012, 0.018, 0.05], [0.33, 0.55, 0.92], day);
    var hor = mix3([0.035, 0.05, 0.11], [0.70, 0.82, 0.96], day);
    var dusk = clamp(1 - Math.abs(sun[1]) * 3.4, 0, 1);
    hor = mix3(hor, [0.93, 0.56, 0.34], dusk * 0.5);
    return {
      top: top, hor: hor, sun: sun, sunR: sunR, sunU: sunU,
      glow: [dusk * 0.55 + day * 0.12, dusk * 0.3 + day * 0.1, dusk * 0.12 + day * 0.06],
      night: 1 - day, day: dayFactor, raw: day,
      cloud: mix3([0.16, 0.18, 0.25], [1, 1, 1], Math.max(day, dusk * 0.6))
    };
  }
  function clockText() {
    var h = (timeOfDay * 24 + 6) % 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  // ---- Трещины на блоке --------------------------------------------------------------------
  var crackBatch = new KC.Models.Batch(8);
  function buildCrack() {
    var m = P.mining;
    if (!m || m.p <= 0 || P.creative) return null;
    var stage = Math.min(9, Math.floor(m.p * 10));
    var uv = KC.tileUV(KC.TILE['crack' + stage]);
    var sb = KC.selectionBox(world.getBlock(m.x, m.y, m.z), world.getMeta(m.x, m.y, m.z)) || [0, 0, 0, 1, 1, 1];
    var e = 0.003, x0 = m.x + sb[0] - e, y0 = m.y + sb[1] - e, z0 = m.z + sb[2] - e, x1 = m.x + sb[3] + e, y1 = m.y + sb[4] + e, z1 = m.z + sb[5] + e;
    crackBatch.reset();
    var faces = [
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]
    ];
    var uvs = [[uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]], [uv[0], uv[1]]];
    crackBatch.reserve(6);
    faces.forEach(function (f) {
      for (var k = 0; k < 4; k++) crackBatch.v(f[k][0], f[k][1], f[k][2], uvs[k][0], uvs[k][1], 1, 1, 1);
      crackBatch.quads++;
    });
    return crackBatch.view();
  }

  // ---- Главный цикл --------------------------------------------------------------------
  var last = performance.now(), fpsT = 0, fpsN = 0, fps = 0, debugT = 0, progressT = 0, gameTime = 0;

  function input() {
    var f = 0, s = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) s += 1;
    if (keys.KeyA || keys.ArrowLeft) s -= 1;
    f += joy.y; s += joy.x;
    if (f <= 0.2) sprintLatch = false;
    var joySprint = joy.y > 0.85 && Math.hypot(joy.x, joy.y) > 0.95;
    return {
      f: f, s: s, jump: !!(keys.Space || touchJump), down: !!(keys.ShiftLeft || keys.ShiftRight || touchDown),
      sprint: !!(keys.KeyR || sprintLatch || joySprint || touchSprint), autojump: settings.autojump
    };
  }

  function frame(now) {
    if (state === 'fatal') return;
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    gameTime += dt;
    fpsT += dt; fpsN++;
    if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0; }

    var simulate = placed && (state === 'playing' || state === 'container' || state === 'dead');
    var e = P.e;
    if (simulate) {
      var inp = state === 'playing' && !sleeping ? input() : { f: 0, s: 0, jump: false, down: false, sprint: false };
      if (!P.dead) {
        if (world.isLoaded(e.x, e.z)) P.move(dt, inp);
        P.stats(dt, difficulty);
      }
      if (state === 'playing' && !P.dead) actions(dt);
      tickAcc += dt;
      var n = 0;
      while (tickAcc >= TICK && n < 5) { Sim.tick(); tickAcc -= TICK; n++; }
      if (n === 5) tickAcc = 0;
      E.update(dt);
      if (P.swing > 0) { P.swing += dt * 3.2; if (P.swing >= 1) P.swing = 0; }
    }
    if (settings.cycle && (simulate || state === 'title')) timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;
    if (sleeping > 0) {
      sleeping -= dt;
      if (sleeping <= 0) { timeOfDay = 0.02; $('sleep').classList.remove('is-on'); toast('Доброе утро'); saveGame(); }
    }
    cloudOffset += dt * 1.1;

    var cam = camera(dt);
    var ccx = Math.floor(cam.x / CS), ccz = Math.floor(cam.z / CS);
    stream(ccx, ccz, state === 'title' ? 12 : (isTouch ? 4 : 6));
    var list = visibleChunks(ccx, ccz);

    var sprintFov = !reduceMotion && state === 'playing' && (P.sprinting || (e.fly && Math.hypot(e.vx, e.vz) > 8));
    var bowZoom = P.using && P.using.kind === 'bow' ? Math.min(1, P.using.t) * 10 : 0;
    fov += (72 + (sprintFov ? 8 : 0) - bowZoom - fov) * Math.min(1, dt * 8);
    var R = settings.dist * CS;
    renderer.setCamera(cam, fov * Math.PI / 180, aspect, Math.max(R * 1.25, 330));
    Audio.setListener(cam.x, cam.y, cam.z, cam.yaw);

    if (placed && state === 'playing') updateTarget(); else { target = null; targetMob = null; }
    var sky = skyState();
    var parts = updateParticles(dt);
    var under = state !== 'title' && P.headInWater;
    var inLava = state !== 'title' && world.getBlock(e.x, e.y + P.EYE, e.z) === B.LAVA;
    var fogColor = inLava ? [0.9, 0.3, 0.05] : under ? [0.06 * sky.day + 0.02, 0.2 * sky.day + 0.03, 0.42 * sky.day + 0.05] : sky.hor;

    var thirdPerson = view !== 0 && state !== 'title';
    var ents = E.buildRender(cam, gameTime, thirdPerson && !P.dead ? function (batch) { P.drawBody(batch, E.lightAt(e.x, e.y + 1.4, e.z)); } : null);
    var held = null;
    if (!thirdPerson && state !== 'title' && placed && !P.dead) held = P.buildHeld(gameTime, E.lightAt(e.x, e.y + 1.4, e.z));
    var hl = null;
    if (state === 'playing' && target && !targetMob) {
      var sb = target.box || [0, 0, 0, 1, 1, 1];
      hl = [target.x + sb[0], target.y + sb[1], target.z + sb[2], target.x + sb[3], target.y + sb[4], target.z + sb[5]];
    }
    renderer.render({
      cam: cam, sky: sky, brightness: settings.bright,
      fog: { color: fogColor, start: inLava ? 0 : under ? 0 : R * 0.55, end: inLava ? 3 : under ? 16 : R - 4 },
      clouds: { size: Math.max(R * 2, 220), y: 112, offset: cloudOffset, color: sky.cloud },
      chunks: list, mobs: ents.mobs, items: ents.items, particles: parts,
      crack: buildCrack(), highlight: hl, held: held, underwater: under
    });

    $('water-tint').hidden = !under;
    $('vignette').style.opacity = P.flash > 0 ? Math.min(1, P.flash * 3) : (P.hp <= 4 && !P.creative && state !== 'title' ? 0.35 + Math.sin(gameTime * 4) * 0.1 : 0);
    $('fire-tint').hidden = !(e.fire > 0 && !P.creative && state !== 'title');

    if (state === 'title') {
      progressT -= dt;
      if (progressT <= 0) { progressT = 0.25; updateProgress(list.progress); }
    } else {
      UI.renderHud();
      UI.tick();
    }
    if (settings.debug && state !== 'title') {
      debugT -= dt;
      if (debugT <= 0) {
        debugT = 0.25;
        var mobs = E.list.filter(function (m) { return m.type === 'mob'; }).length;
        $('debug').textContent =
          'XYZ   ' + e.x.toFixed(1) + '  ' + e.y.toFixed(1) + '  ' + e.z.toFixed(1) + '\n' +
          'Чанк  ' + Math.floor(e.x / CS) + '  ' + Math.floor(e.z / CS) + '   мобов ' + mobs + '\n' +
          'FPS   ' + fps + '   чанков в кадре ' + renderer.stats.chunks + '\n' +
          'Время ' + clockText() + '   ' + (mode === 'creative' ? 'творчество' : 'выживание · ' + DIFF_NAMES[difficulty].toLowerCase()) + (e.fly ? '   полёт' : '');
      }
    }
    if (state === 'playing') {
      saveTimer += dt;
      if (saveTimer > 15) { saveTimer = 0; saveGame(); }
      if (mode === 'survival' && !tips.night && sky.raw < 0.3 && placed) { tips.night = 1; toast('Смеркается: ночью бродят упыри. Сделайте факелы и укрытие'); }
    }
  }

  // Камера: от первого лица, сзади или спереди
  function camera(dt) {
    if (state === 'title') {
      if (!reduceMotion) titleCam.yaw += dt * 0.045;
      return titleCam;
    }
    var e = P.e, eye = eyePos();
    var cam = { x: eye[0], y: eye[1], z: eye[2], yaw: e.yaw, pitch: e.pitch };
    if (P.flash > 0 && !reduceMotion) cam.pitch += Math.sin(P.flash * 40) * 0.01;
    if (view !== 0) {
      var d = lookDir(), sign = view === 1 ? -1 : 1;
      var back = [d[0] * sign, d[1] * sign, d[2] * sign];
      var hit = raycastBlocks(eye, back, 4, false);
      var dist = hit ? Math.max(0.3, hit.t - 0.3) : 4;
      cam.x += back[0] * dist; cam.y += back[1] * dist; cam.z += back[2] * dist;
      if (view === 2) { cam.yaw = e.yaw + Math.PI; cam.pitch = -e.pitch; }
    }
    return cam;
  }

  // Действия мышью/кнопками: удар, добыча, использование
  function actions(dt) {
    attackT -= dt; useT -= dt;
    var breaking = mouse.l, using = mouse.r;
    if (targetMob && breaking) {
      P.mining = null;
      if (mouse.lPress || attackT <= 0) { P.attack(targetMob); attackT = 0.45; }
    } else {
      P.mine(dt, target, breaking);
    }
    if (using) {
      if (mouse.rPress) { P.use(target, targetMob, true); useT = 0.3; P.swing = P.swing || 0.01; }
      else if (!P.using && useT <= 0) { P.use(target, targetMob, true); useT = 0.22; }
      else P.use(target, targetMob, false);
    }
    P.updateUse(dt, using);
    mouse.lPress = false; mouse.rPress = false;
  }

  // ---- Сохранение ------------------------------------------------------------------------
  function saveGame() {
    if (!world || !placed) return true;
    var e = P.e;
    var ok = storageSet(SAVE_KEY, {
      v: 2, seed: world.seed, mode: mode, diff: difficulty, edits: world.edits, time: timeOfDay, tips: tips,
      player: { x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, fly: e.fly, hp: P.hp, food: P.food, sat: P.sat,
        inv: P.inv.map(packStack), armor: P.armor.map(packStack), slot: P.slot, spawn: P.spawnPoint },
      bents: Sim.serialize(), entities: E.serialize(), animalChunks: world.animalChunks, storedMobs: world.storedMobs
    });
    if (ok) { hasSave = true; try { window.localStorage.removeItem(OLD_KEY); } catch (err) { /* ничего */ } }
    var note = $('save-note');
    note.textContent = ok ? 'Мир сохранён в этом браузере.' : 'Сохранить не удалось: хранилище браузера недоступно или переполнено.';
    note.classList.toggle('is-error', !ok);
    return ok;
  }
  function saveSettings() { storageSet(SET_KEY, settings); }

  // ---- Экраны --------------------------------------------------------------------------
  function showScreen(name) {
    document.body.setAttribute('data-state', state);
    $('title').hidden = name !== 'title';
    $('pause').hidden = name !== 'pause';
    $('death').hidden = name !== 'death';
    if (name !== 'container') $('container').hidden = true;
    $('hud').hidden = name === 'title';
    $('touch').hidden = !(isTouch && state === 'playing');
    $('debug').hidden = !settings.debug || name === 'title';
    $('t-fly').hidden = mode !== 'creative';
    updateHint();
  }

  function play() {
    Audio.ensure();
    if (!placed) placePlayer();
    state = P.dead ? 'dead' : 'playing';
    saveTimer = 0;
    showScreen(P.dead ? 'death' : null);
    UI.forceHud();
    if (!isTouch && state === 'playing') lockPointer();
    if (mode === 'survival' && !tips.start) { tips.start = 1; toast('Удерживайте ЛКМ на дереве, чтобы добыть брёвна'); }
  }
  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    releaseInput();
    saveGame();
    syncPauseControls();
    showScreen('pause');
    if (locked && document.exitPointerLock) document.exitPointerLock();
    $('btn-resume').focus({ preventScroll: true });
  }
  function resume() {
    state = 'playing';
    showScreen(null);
    if (!isTouch) lockPointer();
  }
  function toTitle() {
    saveGame();
    UI.close();
    state = 'title';
    releaseInput();
    var e = P.e;
    titleCam.x = e.x; titleCam.z = e.z; titleCam.y = e.y + 14; titleCam.yaw = e.yaw + 0.6;
    updateTitle();
    showScreen('title');
  }
  function openContainer(kind, bent) {
    if (state !== 'playing') return;
    if ((kind === 'furnace' || kind === 'chest') && !bent) return;
    state = 'container';
    releaseInput();
    showScreen('container');
    UI.open(kind, bent);
    if (locked && document.exitPointerLock) document.exitPointerLock();
  }
  function closeContainer() {
    if (state !== 'container') return;
    UI.close();
    resume();
  }
  function onDeath(text) {
    UI.close();
    state = 'dead';
    releaseInput();
    $('death-cause').textContent = text;
    showScreen('death');
    if (locked && document.exitPointerLock) document.exitPointerLock();
    saveGame();
  }
  function doRespawn() {
    var bed = P.respawn(spawn);
    if (!bed) { placedSaved = false; placePlayer(); }
    state = 'playing';
    showScreen(null);
    UI.forceHud();
    if (!isTouch) lockPointer();
    saveGame();
  }
  function startSleep() {
    sleeping = 2.2;
    $('sleep').classList.add('is-on');
    toast('Вы засыпаете… Точка возрождения установлена');
  }

  function newWorld(opts) {
    try { window.localStorage.removeItem(SAVE_KEY); window.localStorage.removeItem(OLD_KEY); } catch (e) { /* ничего */ }
    startWorld(null, opts);
  }

  function releaseInput() {
    keys = {};
    mouse.l = mouse.r = mouse.lPress = mouse.rPress = false;
    touchJump = touchDown = touchSprint = false;
    joy.id = null; joy.x = joy.y = 0;
    lookTouch.id = null;
    $('joy').hidden = true;
    P.mining = null;
    if (P.using && P.using.kind !== 'bow') P.using = null;
    document.querySelectorAll('.t-btn.is-down').forEach(function (b) { b.classList.remove('is-down'); });
  }

  var toastTimer = 0;
  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 2400);
  }

  function selectSlot(i) {
    P.slot = ((i % 9) + 9) % 9;
    P.mining = null;
    if (P.using) P.using = null;
    UI.renderHud();
    var s = P.held();
    if (s) toast(KC.itemName(s.id));
  }

  function dropStack(st) {
    if (!st || !st.n) return;
    var e = P.e, d = lookDir();
    E.dropItem(e.x + d[0] * 0.4, e.y + 1.4, e.z + d[2] * 0.4, { id: st.id, n: st.n, d: st.d || 0 }, [d[0] * 5, d[1] * 5 + 2, d[2] * 5]).pickup = 1.5;
  }
  function dropHeld(all) {
    var s = P.held();
    if (!s) return;
    var n = all ? s.n : 1;
    dropStack({ id: s.id, n: n, d: s.d });
    s.n -= n;
    if (!s.n) P.inv[P.slot] = null;
    UI.renderHud();
  }
  function pickBlock() {
    if (!target) return;
    var id = target.id;
    if (id === B.WIRE) id = I.SPARK_DUST;
    if (id === B.WHEAT) id = I.SEEDS;
    if (id === B.DOOR || !KC.ITEMS[id]) { if (!KC.ITEMS[id]) return; }
    for (var i = 0; i < 9; i++) if (P.inv[i] && P.inv[i].id === id) { selectSlot(i); return; }
    if (mode === 'creative') { P.inv[P.slot] = { id: id, n: KC.maxStack(id), d: 0 }; UI.renderHud(); toast(KC.itemName(id)); }
  }

  function chunkWord(n) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'чанк';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'чанка';
    return 'чанков';
  }
  function updateTitle() {
    $('seed-label').textContent = 'Сид мира: ' + world.seed + ' · ' + (mode === 'creative' ? 'Творчество' : 'Выживание, ' + DIFF_NAMES[difficulty].toLowerCase());
    $('btn-play').textContent = hasSave || placed ? 'Продолжить' : 'Играть';
  }
  function updateProgress(p) {
    var el = $('load-label');
    if (p >= 1) { el.textContent = 'Мир готов'; el.classList.add('is-ready'); }
    else { el.textContent = 'Мир строится: ' + Math.round(p * 100) + '%'; el.classList.remove('is-ready'); }
  }
  var dragHintShown = false;
  function updateHint() {
    var el = $('hint');
    if (state === 'playing' && !isTouch && !locked && !dragMode) {
      el.textContent = 'Щёлкните по экрану, чтобы управлять мышью';
      el.hidden = false;
    } else if (state === 'playing' && dragMode && !dragHintShown) {
      dragHintShown = true;
      el.textContent = 'Мышь не захватывается: осматривайтесь, перетаскивая её с зажатой кнопкой';
      el.hidden = false;
      setTimeout(function () { if (dragMode) el.hidden = true; }, 4000);
    } else if (!dragMode || state !== 'playing') el.hidden = true;
  }

  function syncPauseControls() {
    document.querySelectorAll('[name="set-mode"]').forEach(function (r) { r.checked = r.value === mode; });
    $('set-diff').value = String(difficulty);
  }

  function buildUI() {
    $('btn-play').addEventListener('click', play);
    $('btn-new-title').addEventListener('click', function () { $('newworld').hidden = false; $('nw-warn').hidden = !(hasSave || placed); $('nw-create').focus(); });
    $('nw-cancel').addEventListener('click', function () { $('newworld').hidden = true; });
    $('nw-create').addEventListener('click', function () {
      var m = document.querySelector('[name="nw-mode"]:checked').value;
      var seedTxt = $('nw-seed').value.trim(), seed = 0;
      if (seedTxt) { seed = parseInt(seedTxt, 10); if (!isFinite(seed) || String(seed) !== seedTxt) seed = Math.abs(hashStr(seedTxt)) % 999999 + 1; }
      newWorld({ mode: m, diff: +$('nw-diff').value, seed: seed || 0 });
      $('newworld').hidden = true;
      updateTitle();
      play();
    });
    $('btn-resume').addEventListener('click', resume);
    $('btn-title').addEventListener('click', toTitle);
    $('btn-respawn').addEventListener('click', doRespawn);
    $('btn-death-title').addEventListener('click', function () { P.respawn(spawn); placedSaved = false; placed = false; toTitle(); });

    document.querySelectorAll('[name="set-mode"]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (!r.checked) return;
        mode = r.value;
        P.setCreative(mode === 'creative');
        $('t-fly').hidden = mode !== 'creative';
        UI.forceHud();
        toast(mode === 'creative' ? 'Режим: творчество' : 'Режим: выживание');
      });
    });
    $('set-diff').addEventListener('change', function () { difficulty = +$('set-diff').value; toast('Сложность: ' + DIFF_NAMES[difficulty].toLowerCase()); });

    var dist = $('set-dist'), sens = $('set-sens'), bright = $('set-bright');
    function distLabel() { $('out-dist').textContent = settings.dist + ' ' + chunkWord(settings.dist); }
    function sensLabel() { $('out-sens').textContent = settings.sens.toFixed(1).replace('.', ',') + '×'; }
    function brightLabel() { $('out-bright').textContent = Math.round(settings.bright * 100) + '%'; }
    dist.value = settings.dist; distLabel();
    sens.value = settings.sens; sensLabel();
    bright.value = settings.bright; brightLabel();
    dist.addEventListener('input', function () { settings.dist = +dist.value; distLabel(); saveSettings(); });
    sens.addEventListener('input', function () { settings.sens = +sens.value; sensLabel(); saveSettings(); });
    bright.addEventListener('input', function () { settings.bright = +bright.value; brightLabel(); saveSettings(); });
    [['set-cycle', 'cycle'], ['set-sound', 'sound'], ['set-autojump', 'autojump'], ['set-debug', 'debug']].forEach(function (pair) {
      var box = $(pair[0]);
      box.checked = settings[pair[1]];
      box.addEventListener('change', function () {
        settings[pair[1]] = box.checked;
        if (pair[1] === 'cycle' && !box.checked) timeOfDay = 0.28;
        if (pair[1] === 'sound') Audio.setEnabled(box.checked);
        saveSettings();
      });
    });
    updateTitle();
    updateProgress(0);
  }
  function hashStr(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  // ---- Управление ------------------------------------------------------------------------
  function look(dx, dy, k) {
    var e = P.e;
    e.yaw -= dx * k * settings.sens;
    e.pitch = clamp(e.pitch - dy * k * settings.sens, -1.55, 1.55);
  }
  function lockPointer() {
    if (dragMode) { updateHint(); return; }
    var c = $('gl');
    if (!c.requestPointerLock) { dragMode = true; updateHint(); return; }
    try { var p = c.requestPointerLock(); if (p && typeof p.catch === 'function') p.catch(onLockError); }
    catch (e) { onLockError(); }
  }
  function onLockError() { if (!everLocked) dragMode = true; updateHint(); }

  function bindInput() {
    var canvas = $('gl');
    document.addEventListener('pointerlockchange', function () {
      locked = document.pointerLockElement === canvas;
      if (locked) everLocked = true;
      if (!locked && state === 'playing') pause();
      updateHint();
    });
    document.addEventListener('pointerlockerror', onLockError);

    canvas.addEventListener('mousedown', function (e) {
      if (isTouch || state !== 'playing') return;
      Audio.ensure();
      if (!locked && !dragMode) { lockPointer(); return; }
      if (dragMode) { drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, button: e.button, moved: false }; if (e.button === 0) { mouse.l = true; mouse.lPress = true; } return; }
      if (e.button === 0) { mouse.l = true; mouse.lPress = true; }
      else if (e.button === 2) { mouse.r = true; mouse.rPress = true; }
      else if (e.button === 1) pickBlock();
      e.preventDefault();
    });
    window.addEventListener('mouseup', function (e) {
      if (drag) {
        if (!drag.moved && state === 'playing') {
          if (drag.button === 2) { mouse.r = true; mouse.rPress = true; setTimeout(function () { mouse.r = false; }, 60); }
          else if (drag.button === 1) pickBlock();
        }
        drag = null; mouse.l = false;
        return;
      }
      if (e.button === 0) mouse.l = false;
      if (e.button === 2) mouse.r = false;
    });
    document.addEventListener('mousemove', function (e) {
      if (state !== 'playing') return;
      if (locked) look(clamp(e.movementX || 0, -200, 200), clamp(e.movementY || 0, -200, 200), 0.0022);
      else if (drag) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 5) { drag.moved = true; mouse.l = false; }
        if (drag.moved) look(e.clientX - drag.lx, e.clientY - drag.ly, 0.004);
        drag.lx = e.clientX; drag.ly = e.clientY;
      }
    });
    document.addEventListener('contextmenu', function (e) { if (state === 'playing' || e.target === canvas) e.preventDefault(); });
    window.addEventListener('wheel', function (e) {
      if (state !== 'playing' || !e.deltaY) return;
      selectSlot(P.slot + (e.deltaY > 0 ? 1 : -1));
    }, { passive: true });

    window.addEventListener('keydown', function (e) {
      var code = e.code;
      if (state === 'title') {
        if (code === 'Enter' && document.activeElement === document.body && $('newworld').hidden) play();
        if (code === 'Escape' && !$('newworld').hidden) $('newworld').hidden = true;
        return;
      }
      if (state === 'container') {
        if (code === 'KeyE' || code === 'Escape') { e.preventDefault(); closeContainer(); }
        return;
      }
      if (state === 'paused') { if (code === 'Escape') { e.preventDefault(); resume(); } return; }
      if (state !== 'playing') return;
      if (/^Digit[1-9]$/.test(code)) { selectSlot(+code.charAt(5) - 1); return; }
      if (code === 'Space' || code.indexOf('Arrow') === 0 || code === 'F3' || code === 'F5') e.preventDefault();
      if (e.repeat) { keys[code] = true; return; }
      var now = performance.now();
      switch (code) {
        case 'KeyE': e.preventDefault(); openContainer('inventory'); return;
        case 'KeyF': if (mode === 'creative') setFly(!P.e.fly); return;
        case 'KeyQ': dropHeld(e.shiftKey); return;
        case 'F5': view = (view + 1) % 3; return;
        case 'F3':
          settings.debug = !settings.debug; $('set-debug').checked = settings.debug; $('debug').hidden = !settings.debug; saveSettings();
          return;
        case 'Escape': pause(); return;
        case 'Space':
          if (mode === 'creative') { if (now - lastSpace < 280) { setFly(!P.e.fly); lastSpace = 0; } else lastSpace = now; }
          break;
        case 'KeyW':
          if (now - lastW < 280) sprintLatch = true;
          lastW = now;
          break;
      }
      keys[code] = true;
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('blur', function () { if (state === 'playing') releaseInput(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (state === 'playing') pause(); else saveGame(); }
    });
    window.addEventListener('pagehide', function () { saveGame(); });
    bindTouch();
  }

  function setFly(on) {
    if (P.e.fly === on) return;
    P.e.fly = on; P.e.vy = 0;
    $('t-fly').classList.toggle('is-on', on);
    toast(on ? 'Полёт: Пробел — вверх, Shift — вниз' : 'Полёт выключен');
  }

  function bindTouch() {
    var layer = $('touch'), joyEl = $('joy'), knob = $('joy-knob'), JR = 52;
    layer.addEventListener('pointerdown', function (e) {
      if (e.target !== layer || state !== 'playing') return;
      e.preventDefault();
      Audio.ensure();
      if (e.clientX < window.innerWidth * 0.42 && joy.id === null) {
        joy.id = e.pointerId; joy.cx = e.clientX; joy.cy = e.clientY; joy.x = joy.y = 0;
        joyEl.style.left = e.clientX + 'px'; joyEl.style.top = e.clientY + 'px';
        knob.style.transform = ''; joyEl.hidden = false;
      } else if (lookTouch.id === null) {
        lookTouch.id = e.pointerId; lookTouch.x = e.clientX; lookTouch.y = e.clientY;
      } else return;
      try { layer.setPointerCapture(e.pointerId); } catch (err) { /* необязательно */ }
    });
    layer.addEventListener('pointermove', function (e) {
      if (e.pointerId === joy.id) {
        var dx = e.clientX - joy.cx, dy = e.clientY - joy.cy, l = Math.hypot(dx, dy);
        if (l > JR) { dx *= JR / l; dy *= JR / l; }
        joy.x = dx / JR; joy.y = -dy / JR;
        knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      } else if (e.pointerId === lookTouch.id) {
        look(e.clientX - lookTouch.x, e.clientY - lookTouch.y, 0.0055);
        lookTouch.x = e.clientX; lookTouch.y = e.clientY;
      }
    });
    function end(e) {
      if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; joyEl.hidden = true; }
      if (e.pointerId === lookTouch.id) lookTouch.id = null;
    }
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);

    function holdBtn(id, down, up) {
      var el = $(id);
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (state !== 'playing') return;
        Audio.ensure();
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* необязательно */ }
        el.classList.add('is-down');
        down();
      });
      function release() { el.classList.remove('is-down'); if (up) up(); }
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }
    holdBtn('t-jump', function () { touchJump = true; }, function () { touchJump = false; });
    holdBtn('t-down', function () { touchDown = true; }, function () { touchDown = false; });
    holdBtn('t-break', function () { mouse.l = true; mouse.lPress = true; }, function () { mouse.l = false; });
    holdBtn('t-place', function () { mouse.r = true; mouse.rPress = true; }, function () { mouse.r = false; });
    holdBtn('t-fly', function () { if (mode === 'creative') setFly(!P.e.fly); });
    // Кнопки, открывающие экраны, срабатывают по щелчку: иначе «догоняющий» щелчок
    // после касания попадёт в кнопку только что открытого окна и сразу закроет его
    function tapBtn(id, fn) {
      var el = $(id);
      el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      el.addEventListener('click', function (e) { e.stopPropagation(); if (state === 'playing') fn(); });
    }
    tapBtn('t-inv', function () { openContainer('inventory'); });
    tapBtn('t-pause', function () { pause(); });
    holdBtn('t-view', function () { view = (view + 1) % 3; });
    holdBtn('t-drop', function () { dropHeld(false); });
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 1.75);
    var w = Math.max(1, Math.floor(window.innerWidth * dpr)), h = Math.max(1, Math.floor(window.innerHeight * dpr));
    renderer.resize(w, h);
    aspect = w / h;
  }

  // Доступ из консоли для отладки и тестов
  KC.debug = {
    get world() { return world; }, get player() { return P.e; }, get state() { return state; }, get target() { return target; },
    P: P, play: play, pause: pause, setTime: function (t) { timeOfDay = t; }, save: saveGame,
    open: openContainer, close: closeContainer, setMode: function (m) { mode = m; P.setCreative(m === 'creative'); }
  };

  var hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') { try { hot.snapshot(function () { saveGame(); return {}; }); } catch (e) { /* необязательно */ } }
  if (hot && typeof hot.ready === 'function') hot.ready(function () { boot(); });
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.KC = window.KC || {});
