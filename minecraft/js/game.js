/* Кубокрафт — игровая логика: игрок и физика, управление, подгрузка чанков,
   смена дня и ночи, частицы, звук, сохранение и меню. */
(function (KC) {
  'use strict';

  var B = KC.B, BLOCKS = KC.BLOCKS, SOLID = KC.SOLID, CROSS = KC.CROSS;
  var CS = KC.CS, H = KC.H, WL = KC.WL;

  var SAVE_KEY = 'kubocraft.world.v1';
  var SET_KEY = 'kubocraft.settings.v1';
  var DAY_LENGTH = 1200;          // секунд на полные сутки
  var HW = 0.3, PH = 1.8, EYE = 1.62, REACH = 5.5;
  var GRAVITY = 28, JUMP_V = 8.6;

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function norm3(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  var mq = window.matchMedia ? function (q) { return window.matchMedia(q).matches; } : function () { return false; };
  // Сенсорное управление — только если основной указатель палец (ноутбук с тачскрином остаётся на мыши)
  var isTouch = mq('(pointer: coarse)') || (navigator.maxTouchPoints > 0 && !mq('(pointer: fine)'));
  var reduceMotion = mq('(prefers-reduced-motion: reduce)');

  function storageGet(key) {
    try { var v = window.localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function storageSet(key, val) {
    try { window.localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  // ---- Состояние ------------------------------------------------------------
  var settings = { dist: isTouch ? 4 : 6, sens: 1, cycle: true, sound: true, autojump: isTouch, debug: false };
  var state = 'title';            // title | playing | paused | inventory
  var world, renderer, atlas, icons = {};
  var spawn, placed = false, savedPlayer = false, hasSave = false;
  var player = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false, fly: false, inWater: false, headInWater: false };
  var titleCam = { x: 0, y: 0, z: 0, yaw: 0.6, pitch: -0.3 };
  var hotbar = KC.DEFAULT_HOTBAR.slice(), slot = 0;
  var timeOfDay = 0.3, cloudOffset = 0;
  var keys = {}, hold = { brk: false, plc: false, tBrk: 0, tPlc: 0 };
  var joy = { id: null, cx: 0, cy: 0, x: 0, y: 0 }, lookTouch = { id: null, x: 0, y: 0 };
  var touchJump = false, touchDown = false;
  var target = null, particles = [];
  var fov = 72, aspect = 1;
  var lastSpace = 0, lastUnload = 0;
  var locked = false, dragMode = false, everLocked = false, drag = null;
  var saveTimer = 0;

  // Смещения чанков вокруг центра, отсортированные по расстоянию
  var OFFSETS = [];
  (function () {
    var R = 14;
    for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) {
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d <= R) OFFSETS.push({ dx: dx, dz: dz, d: d });
    }
    OFFSETS.sort(function (a, b) { return a.d - b.d; });
  })();

  // ---- Запуск ------------------------------------------------------------------
  function boot() {
    document.body.classList.toggle('is-touch', isTouch);
    var canvas = $('gl');
    try {
      renderer = new KC.Renderer(canvas);
    } catch (e) {
      fatal('Браузер не дал доступ к WebGL. Включите аппаратное ускорение или откройте игру в другом браузере.');
      return;
    }
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      saveGame();
      fatal('Видеокарта сбросила графический контекст. Обновите страницу: мир сохранён.');
    });

    atlas = KC.makeAtlas();
    renderer.setAtlas(atlas);
    KC.INVENTORY.forEach(function (id) { icons[id] = KC.makeIcon(atlas, id, 64).toDataURL(); });

    var s = storageGet(SET_KEY);
    if (s) for (var k in settings) if (typeof s[k] === typeof settings[k]) settings[k] = s[k];
    settings.dist = clamp(settings.dist | 0, 2, 10);

    startWorld(storageGet(SAVE_KEY));
    buildUI();
    bindInput();
    resize();
    window.addEventListener('resize', resize);
    showScreen('title');
    requestAnimationFrame(frame);
  }

  function fatal(text) {
    $('fatal-text').textContent = text;
    ['title', 'pause', 'inventory', 'hud', 'touch'].forEach(function (id) { $(id).hidden = true; });
    $('fatal').hidden = false;
    state = 'dead';
  }

  function startWorld(save) {
    if (world) world.chunks.forEach(function (c) { renderer.deleteMesh(c); });
    var ok = save && typeof save.seed === 'number';
    hasSave = !!ok;
    var seed = ok ? save.seed : Math.floor(Math.random() * 999999) + 1;
    world = new KC.World(seed, ok && save.edits ? save.edits : {});
    spawn = world.findSpawn();
    renderer.makeClouds(seed);

    hotbar = KC.DEFAULT_HOTBAR.slice();
    if (ok && Array.isArray(save.hotbar) && save.hotbar.length === 9) {
      hotbar = save.hotbar.map(function (id, i) { return KC.INVENTORY.indexOf(id) >= 0 ? id : KC.DEFAULT_HOTBAR[i]; });
    }
    slot = ok && save.slot >= 0 && save.slot < 9 ? save.slot | 0 : 0;
    timeOfDay = ok && typeof save.time === 'number' ? save.time % 1 : 0.3;
    if (!settings.cycle) timeOfDay = 0.28;

    var sp = ok && save.player;
    savedPlayer = !!(sp && isFinite(sp.x) && isFinite(sp.y) && isFinite(sp.z));
    if (savedPlayer) {
      player.x = sp.x; player.y = sp.y; player.z = sp.z;
      player.yaw = sp.yaw || 0; player.pitch = sp.pitch || 0; player.fly = !!sp.fly;
    } else {
      player.x = spawn.x; player.y = spawn.h + 1; player.z = spawn.z;
      player.yaw = 0.8; player.pitch = -0.1; player.fly = false;
    }
    player.vx = player.vy = player.vz = 0;
    placed = false;
    titleCam.x = player.x; titleCam.z = player.z;
    titleCam.y = (savedPlayer ? player.y : Math.max(spawn.h, WL)) + 16;
    titleCam.yaw = player.yaw + 0.6;
    particles.length = 0;
    target = null;
    if ($('seed-label')) updateTitle();
  }

  // Ставит игрока в мир: догружает чанки вокруг и ищет свободное место
  function placePlayer() {
    var pcx = Math.floor(player.x / CS), pcz = Math.floor(player.z / CS), dx, dz, c;
    for (dz = -2; dz <= 2; dz++) for (dx = -2; dx <= 2; dx++) {
      if (!world.getChunk(pcx + dx, pcz + dz)) world.generate(pcx + dx, pcz + dz);
    }
    for (dz = -1; dz <= 1; dz++) for (dx = -1; dx <= 1; dx++) {
      c = world.getChunk(pcx + dx, pcz + dz);
      if (!c.mesh || c.dirty) remesh(c);
    }
    if (!savedPlayer) {
      var spot = openSpot(Math.floor(player.x), Math.floor(player.z));
      player.x = spot.x + 0.5; player.z = spot.z + 0.5; player.y = spot.y;
      while (player.y < H - 2 && boxHits(player.x, player.y, player.z)) player.y += 1;
    } else {
      var guard = 0;
      while (guard++ < H && boxHits(player.x, player.y, player.z)) player.y += 1;
    }
    placed = true;
  }

  // Вокруг головы нет листвы и стволов
  function clearAround(x, y, z) {
    for (var dy = 0; dy <= 3; dy++) for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      var id = world.getBlock(x + dx, y + dy, z + dz);
      if (id === B.LEAVES || id === B.LOG || id === B.BIRCH_LOG) return false;
    }
    return true;
  }

  // Ближайшая колонна, где сверху земля, а не крона, ствол, кактус или вода
  function openSpot(x0, z0) {
    var bad = [B.LEAVES, B.LOG, B.BIRCH_LOG, B.CACTUS, B.WATER];
    for (var r = 0; r <= 10; r++) {
      for (var dz = -r; dz <= r; dz++) for (var dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        var x = x0 + dx, z = z0 + dz;
        if (!world.isLoaded(x, z)) continue;
        for (var y = H - 1; y > 0; y--) {
          var id = world.getBlock(x, y, z);
          if (!id || CROSS[id]) continue;
          if (bad.indexOf(id) < 0 && clearAround(x, y + 1, z)) return { x: x, y: y + 1, z: z };
          break;
        }
      }
    }
    return { x: x0, y: spawn.h + 1, z: z0 };
  }

  function respawn() {
    player.x = spawn.x; player.z = spawn.z; player.vx = player.vy = player.vz = 0;
    savedPlayer = false;
    placePlayer();
    toast('Вы вернулись на точку появления');
  }

  // ---- Подгрузка чанков ------------------------------------------------------
  function remesh(c) {
    renderer.uploadMesh(c, world.buildMesh(c));
    c.dirty = false;
  }

  function stream(cx0, cz0, budget) {
    var t0 = performance.now(), R = settings.dist;
    var genR = R + 1.5, keepMeshR = R + 1.5, keepR = R + 3.5;

    // Правки игрока перестраиваем сразу, без бюджета
    world.chunks.forEach(function (c) { if (c.dirty && c.mesh) remesh(c); });

    for (var i = 0; i < OFFSETS.length; i++) {
      var o = OFFSETS[i];
      if (o.d > genR) break;
      if (performance.now() - t0 > budget) break;
      var cx = cx0 + o.dx, cz = cz0 + o.dz;
      var c = world.getChunk(cx, cz);
      if (!c) { world.generate(cx, cz); continue; }
      if (o.d <= R && (!c.mesh || c.dirty) && world.hasNeighbors(cx, cz)) remesh(c);
    }

    var now = performance.now();
    if (now - lastUnload > 1000) {
      lastUnload = now;
      world.chunks.forEach(function (c, key) {
        var ddx = c.cx - cx0, ddz = c.cz - cz0, d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (d > keepR) { renderer.deleteMesh(c); world.chunks.delete(key); }
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

  // ---- Физика игрока ---------------------------------------------------------
  function boxHits(px, py, pz) {
    var x0 = Math.floor(px - HW), x1 = Math.floor(px + HW);
    var y0 = Math.floor(py), y1 = Math.floor(py + PH);
    var z0 = Math.floor(pz - HW), z1 = Math.floor(pz + HW);
    for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) {
      if (!world.isLoaded(x, z)) return true;   // за край загруженного мира не пускаем
      for (var y = y0; y <= y1; y++) if (SOLID[world.getBlock(x, y, z)]) return true;
    }
    return false;
  }

  function sweep(axis, d) {
    if (!d) return false;
    var old = player[axis];
    player[axis] += d;
    if (!boxHits(player.x, player.y, player.z)) return false;
    var E = 0.001, v = player[axis];
    if (axis === 'y') player.y = d < 0 ? Math.floor(v) + 1 : Math.floor(v + PH) - PH - E;
    else player[axis] = d > 0 ? Math.floor(v + HW) - HW - E : Math.floor(v - HW) + 1 + HW + E;
    if (boxHits(player.x, player.y, player.z)) player[axis] = old;
    return true;
  }

  function updatePlayer(dt) {
    if (!world.isLoaded(player.x, player.z)) return;

    var f = 0, s = 0;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) s += 1;
    if (keys.KeyA || keys.ArrowLeft) s -= 1;
    f += joy.y; s += joy.x;
    var sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    var wx = -sy * f + cy * s, wz = -cy * f - sy * s;
    var len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; len = 1; }

    var shift = keys.ShiftLeft || keys.ShiftRight;
    var jump = keys.Space || touchJump;
    var down = shift || touchDown;
    var sprint = !player.fly && (shift || (joy.y > 0.85 && Math.hypot(joy.x, joy.y) > 0.95));
    player.sprinting = sprint && len > 0.1 && !player.inWater;

    var speed = player.fly ? 12 : player.inWater ? 2.6 : (sprint ? 6.2 : 4.3);
    var tx = wx * speed, tz = wz * speed, k;

    if (player.fly) {
      k = Math.min(1, dt * 10);
      player.vx += (tx - player.vx) * k;
      player.vz += (tz - player.vz) * k;
      player.vy += (((jump ? 1 : 0) - (down ? 1 : 0)) * 9 - player.vy) * k;
    } else if (player.inWater) {
      k = Math.min(1, dt * 5);
      player.vx += (tx - player.vx) * k;
      player.vz += (tz - player.vz) * k;
      player.vy -= 9 * dt;
      player.vy *= Math.max(0, 1 - dt * 2.2);
      if (jump) player.vy = Math.min(player.vy + 26 * dt, 3.6);
    } else {
      k = Math.min(1, dt * (player.onGround ? 14 : 3.2));
      player.vx += (tx - player.vx) * k;
      player.vz += (tz - player.vz) * k;
      player.vy = Math.max(player.vy - GRAVITY * dt, -55);
      if (jump && player.onGround) { player.vy = JUMP_V; player.onGround = false; }
    }

    var maxV = Math.max(Math.abs(player.vx), Math.abs(player.vy), Math.abs(player.vz));
    var steps = Math.max(1, Math.ceil(maxV * dt / 0.4)), sdt = dt / steps;
    var hitH = false, landed = false;
    for (var i = 0; i < steps; i++) {
      if (sweep('x', player.vx * sdt)) { player.vx = 0; hitH = true; }
      if (sweep('z', player.vz * sdt)) { player.vz = 0; hitH = true; }
      var dy = player.vy * sdt;
      if (sweep('y', dy)) { if (dy < 0) landed = true; player.vy = 0; }
    }
    player.onGround = landed;
    if (player.fly && landed) setFly(false);

    // Автопрыжок и выход из воды на берег
    if (hitH && len > 0.1 && !player.fly) {
      var free = !boxHits(player.x + wx * 0.45, player.y + 1.05, player.z + wz * 0.45);
      if (free && player.onGround && settings.autojump) player.vy = JUMP_V;
      if (free && player.inWater && jump) player.vy = 6.2;
    }

    var feet = world.getBlock(player.x, player.y + 0.4, player.z);
    player.inWater = feet === B.WATER;
    var ey = player.y + EYE, eyeId = world.getBlock(player.x, ey, player.z);
    player.headInWater = eyeId === B.WATER && (ey - Math.floor(ey) < 0.86 || world.getBlock(player.x, ey + 1, player.z) === B.WATER);

    if (player.y < -30) respawn();
  }

  function setFly(on) {
    if (player.fly === on) return;
    player.fly = on;
    player.vy = 0;
    $('t-down').hidden = !on;
    $('t-fly').classList.toggle('is-on', on);
    toast(on ? 'Полёт: Пробел — вверх, Shift — вниз' : 'Полёт выключен');
  }

  // ---- Луч, ломание и постройка ---------------------------------------------
  function lookDir() {
    var cp = Math.cos(player.pitch);
    return [-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp];
  }

  function raycast(ox, oy, oz, d, maxD) {
    var x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    var sx = d[0] > 0 ? 1 : -1, sy = d[1] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
    var ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
    var tx = ax > 1e-9 ? (sx > 0 ? x + 1 - ox : ox - x) / ax : Infinity;
    var ty = ay > 1e-9 ? (sy > 0 ? y + 1 - oy : oy - y) / ay : Infinity;
    var tz = az > 1e-9 ? (sz > 0 ? z + 1 - oz : oz - z) / az : Infinity;
    var dx = ax > 1e-9 ? 1 / ax : Infinity, dy = ay > 1e-9 ? 1 / ay : Infinity, dz = az > 1e-9 ? 1 / az : Infinity;
    var nx = 0, ny = 0, nz = 0, t = 0;
    while (t <= maxD) {
      var id = world.getBlock(x, y, z);
      if (id && id !== B.WATER) return { x: x, y: y, z: z, nx: nx, ny: ny, nz: nz, id: id };
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += dx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { y += sy; t = ty; ty += dy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tz; tz += dz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  function updateTarget() {
    target = raycast(player.x, player.y + EYE, player.z, lookDir(), REACH);
  }

  function touchesWater(x, y, z) {
    return world.getBlock(x + 1, y, z) === B.WATER || world.getBlock(x - 1, y, z) === B.WATER ||
      world.getBlock(x, y, z + 1) === B.WATER || world.getBlock(x, y, z - 1) === B.WATER ||
      world.getBlock(x, y + 1, z) === B.WATER;
  }

  function breakBlock() {
    if (!target) return;
    var t = target, id = world.getBlock(t.x, t.y, t.z);
    if (!id || id === B.WATER) return;
    if (BLOCKS[id].breakable === false) { toast('Коренную породу не сломать'); return; }
    world.setBlock(t.x, t.y, t.z, 0);
    var above = world.getBlock(t.x, t.y + 1, t.z);
    if (CROSS[above]) world.setBlock(t.x, t.y + 1, t.z, 0);
    if (touchesWater(t.x, t.y, t.z)) world.setBlock(t.x, t.y, t.z, B.WATER);
    spawnParticles(t.x, t.y, t.z, id);
    playSound(BLOCKS[id].mat, false);
    updateTarget();
  }

  function placeBlock() {
    if (!target) return;
    var id = hotbar[slot];
    if (!id) return;
    var t = target, px = t.x, py = t.y, pz = t.z;
    if (!CROSS[t.id]) { px += t.nx; py += t.ny; pz += t.nz; }
    if (py < 1 || py >= H) { if (py >= H) toast('Выше строить нельзя'); return; }
    if (!world.isLoaded(px, pz)) return;
    var cur = world.getBlock(px, py, pz);
    if (cur && cur !== B.WATER && !CROSS[cur]) return;
    if (SOLID[id] && px + 1 > player.x - HW && px < player.x + HW && py + 1 > player.y && py < player.y + PH &&
        pz + 1 > player.z - HW && pz < player.z + HW) return;
    if (CROSS[id]) {
      var below = world.getBlock(px, py - 1, pz);
      if (below !== B.GRASS && below !== B.DIRT && below !== B.SNOW_GRASS) { toast('Растения сажают на траву или землю'); return; }
    }
    world.setBlock(px, py, pz, id);
    playSound(BLOCKS[id].mat, true);
    updateTarget();
  }

  function pickBlock() {
    if (!target || KC.INVENTORY.indexOf(target.id) < 0) return;
    var at = hotbar.indexOf(target.id);
    if (at >= 0) selectSlot(at);
    else { hotbar[slot] = target.id; renderHotbar(); toast(BLOCKS[target.id].name); }
  }

  function updateActions(dt) {
    if (hold.brk) { hold.tBrk -= dt; if (hold.tBrk <= 0) { breakBlock(); hold.tBrk = 0.26; } }
    if (hold.plc) { hold.tPlc -= dt; if (hold.tPlc <= 0) { placeBlock(); hold.tPlc = 0.24; } }
  }

  // ---- Частицы ------------------------------------------------------------------
  function skyAt(x, y, z) {
    var c = world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
    if (!c) return 1;
    var hm = c.hmap[(Math.floor(x) & 15) + (Math.floor(z) & 15) * CS];
    return y >= hm ? 1 : Math.max(0, 1 - (hm - y) * 0.13);
  }

  function spawnParticles(x, y, z, id) {
    if (reduceMotion) return;
    var uv = KC.tileUV(BLOCKS[id].tiles[2]), sky = skyAt(x, y + 1, z);
    for (var i = 0; i < 16; i++) {
      var ou = Math.floor(Math.random() * 13), ov = Math.floor(Math.random() * 13);
      particles.push({
        x: x + 0.15 + Math.random() * 0.7, y: y + 0.15 + Math.random() * 0.7, z: z + 0.15 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * 3.2, vy: 1 + Math.random() * 3, vz: (Math.random() - 0.5) * 3.2,
        life: 0.45 + Math.random() * 0.55, s: 0.05 + Math.random() * 0.05, sky: sky,
        u0: uv[0] + ou / KC.ATLAS_W, v0: uv[1] + ov / KC.ATLAS_H,
        u1: uv[0] + (ou + 3) / KC.ATLAS_W, v1: uv[1] + (ov + 3) / KC.ATLAS_H
      });
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  }

  var partData = new Float32Array(0);
  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy -= 18 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (SOLID[world.getBlock(p.x, p.y, p.z)]) {
        p.y = Math.floor(p.y) + 1.001; p.vy = 0; p.vx *= 0.5; p.vz *= 0.5;
      }
    }
    var n = particles.length;
    if (!n) return null;
    var need = n * 4 * KC.FLOATS;
    if (partData.length < need) partData = new Float32Array(need * 2);
    var r = renderer.right, u = renderer.up, d = partData, o = 0;
    for (i = 0; i < n; i++) {
      p = particles[i];
      var s = p.s, rx = r[0] * s, ry = r[1] * s, rz = r[2] * s, ux = u[0] * s, uy = u[1] * s, uz = u[2] * s;
      var cs = [[-1, -1, p.u0, p.v1], [1, -1, p.u1, p.v1], [1, 1, p.u1, p.v0], [-1, 1, p.u0, p.v0]];
      for (var k = 0; k < 4; k++) {
        var a = cs[k][0], b = cs[k][1];
        d[o++] = p.x + rx * a + ux * b; d[o++] = p.y + ry * a + uy * b; d[o++] = p.z + rz * a + uz * b;
        d[o++] = cs[k][2]; d[o++] = cs[k][3]; d[o++] = 0.95; d[o++] = p.sky;
      }
    }
    return { data: d.subarray(0, o), quads: n };
  }

  // ---- Звук (синтез, без файлов) ------------------------------------------------
  var audio = { ctx: null, noise: null, master: null };
  var MAT_SOUND = {
    stone: [1700, 1.0, 0.11, 1.4], grass: [950, 0.8, 0.12, 1.3], dirt: [650, 0.9, 0.12, 1.4],
    sand: [2600, 0.6, 0.15, 1.0], wood: [520, 2.0, 0.12, 1.6], plant: [3000, 0.7, 0.08, 0.8],
    glass: [3800, 3.5, 0.16, 1.2], cloth: [800, 0.5, 0.1, 1.0], snow: [1400, 0.5, 0.14, 1.0],
    water: [420, 1.2, 0.2, 1.1], metal: [2300, 8.0, 0.24, 1.0]
  };

  function ensureAudio() {
    if (!settings.sound) return;
    try {
      if (!audio.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        var ctx = new AC(), len = Math.floor(ctx.sampleRate * 0.6);
        var buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
        for (var i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        audio.ctx = ctx; audio.noise = buf;
        audio.master = ctx.createGain();
        audio.master.gain.value = 0.55;
        audio.master.connect(ctx.destination);
      }
      if (audio.ctx.state === 'suspended') audio.ctx.resume();
    } catch (e) { /* звук необязателен */ }
  }

  function playSound(mat, place) {
    var ctx = audio.ctx;
    if (!settings.sound || !ctx || ctx.state !== 'running') return;
    try {
      var p = MAT_SOUND[mat] || MAT_SOUND.stone, t = ctx.currentTime;
      var dur = p[2] * (place ? 0.75 : 1), vol = p[3] * (place ? 0.7 : 1);
      var src = ctx.createBufferSource();
      src.buffer = audio.noise;
      var flt = ctx.createBiquadFilter();
      flt.type = 'bandpass';
      flt.frequency.value = p[0] * (0.88 + Math.random() * 0.24) * (place ? 0.8 : 1);
      flt.Q.value = p[1];
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(flt); flt.connect(g); g.connect(audio.master);
      src.start(t, Math.random() * 0.4);
      src.stop(t + dur + 0.03);
      if (place || mat === 'wood' || mat === 'stone') {
        var osc = ctx.createOscillator(), og = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(place ? 180 : 130, t);
        osc.frequency.exponentialRampToValueAtTime(60, t + 0.09);
        og.gain.setValueAtTime(0.35, t);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        osc.connect(og); og.connect(audio.master);
        osc.start(t); osc.stop(t + 0.12);
      }
      if (mat === 'glass' && !place) {
        for (var i = 0; i < 3; i++) {
          var so = ctx.createOscillator(), sg = ctx.createGain(), st = t + i * 0.03;
          so.type = 'sine';
          so.frequency.value = 2400 + Math.random() * 2400;
          sg.gain.setValueAtTime(0.12, st);
          sg.gain.exponentialRampToValueAtTime(0.0001, st + 0.12);
          so.connect(sg); sg.connect(audio.master);
          so.start(st); so.stop(st + 0.14);
        }
      }
    } catch (e) { /* звук необязателен */ }
  }

  // ---- Небо и время суток ----------------------------------------------------
  function skyState() {
    var a = timeOfDay * Math.PI * 2;
    var sun = norm3([Math.cos(a), Math.sin(a), 0.28]);
    var sunR = norm3([-sun[1], sun[0], 0]);
    var sunU = [sun[1] * sunR[2] - sun[2] * sunR[1], sun[2] * sunR[0] - sun[0] * sunR[2], sun[0] * sunR[1] - sun[1] * sunR[0]];
    var day = smooth(-0.16, 0.24, sun[1]);
    var top = mix3([0.012, 0.018, 0.05], [0.33, 0.55, 0.92], day);
    var hor = mix3([0.035, 0.05, 0.11], [0.70, 0.82, 0.96], day);
    var dusk = clamp(1 - Math.abs(sun[1]) * 3.4, 0, 1);
    hor = mix3(hor, [0.93, 0.56, 0.34], dusk * 0.5);
    return {
      top: top, hor: hor, sun: sun, sunR: sunR, sunU: sunU,
      glow: [dusk * 0.55 + day * 0.12, dusk * 0.3 + day * 0.1, dusk * 0.12 + day * 0.06],
      night: 1 - day,
      day: 0.26 + 0.74 * day,
      cloud: mix3([0.16, 0.18, 0.25], [1, 1, 1], Math.max(day, dusk * 0.6))
    };
  }

  function clockText() {
    var h = (timeOfDay * 24 + 6) % 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  // ---- Главный цикл ------------------------------------------------------------
  var last = performance.now(), fpsT = 0, fpsN = 0, fps = 0, debugT = 0, progressT = 0;

  function frame(now) {
    if (state === 'dead') return;
    requestAnimationFrame(frame);
    var dt = Math.min(0.08, Math.max(0, (now - last) / 1000));
    last = now;
    fpsT += dt; fpsN++;
    if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0; }

    var playing = state === 'playing';
    if (playing && placed) { updatePlayer(dt); updateActions(dt); }
    if (settings.cycle && (playing || state === 'title')) timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;
    cloudOffset += dt * 1.1;

    var cam;
    if (state === 'title') {
      if (!reduceMotion) titleCam.yaw += dt * 0.045;
      cam = titleCam;
    } else {
      cam = { x: player.x, y: player.y + EYE, z: player.z, yaw: player.yaw, pitch: player.pitch };
    }

    var ccx = Math.floor(cam.x / CS), ccz = Math.floor(cam.z / CS);
    stream(ccx, ccz, state === 'title' ? 12 : (isTouch ? 4 : 6));
    var list = visibleChunks(ccx, ccz);

    var targetFov = 72 + (!reduceMotion && playing && (player.sprinting || (player.fly && Math.hypot(player.vx, player.vz) > 8)) ? 8 : 0);
    fov += (targetFov - fov) * Math.min(1, dt * 8);
    var R = settings.dist * CS;
    renderer.setCamera(cam, fov * Math.PI / 180, aspect, Math.max(R * 1.25, 330));

    if (playing && placed) updateTarget();
    var parts = updateParticles(dt);

    var sky = skyState(), under = state !== 'title' && player.headInWater;
    var fogColor = under ? [0.06 * sky.day + 0.02, 0.2 * sky.day + 0.03, 0.42 * sky.day + 0.05] : sky.hor;
    renderer.render({
      cam: cam,
      sky: sky,
      fog: { color: fogColor, start: under ? 0 : R * 0.55, end: under ? 16 : R - 4 },
      clouds: { size: Math.max(R * 2, 220), y: 112, offset: cloudOffset, color: sky.cloud },
      chunks: list,
      particles: parts,
      highlight: playing ? target : null,
      underwater: under
    });

    $('water-tint').hidden = !under;

    if (state === 'title') {
      progressT -= dt;
      if (progressT <= 0) { progressT = 0.25; updateProgress(list.progress); }
    }
    if (settings.debug && state !== 'title') {
      debugT -= dt;
      if (debugT <= 0) {
        debugT = 0.25;
        $('debug').textContent =
          'XYZ   ' + player.x.toFixed(1) + '  ' + player.y.toFixed(1) + '  ' + player.z.toFixed(1) + '\n' +
          'Чанк  ' + Math.floor(player.x / CS) + '  ' + Math.floor(player.z / CS) + '\n' +
          'FPS   ' + fps + '   чанков в кадре ' + renderer.stats.chunks + '\n' +
          'Время ' + clockText() + (player.fly ? '   полёт' : '');
      }
    }

    if (playing) {
      saveTimer += dt;
      if (saveTimer > 10) { saveTimer = 0; saveGame(); }
    }
  }

  // ---- Сохранение -------------------------------------------------------------
  function saveGame() {
    if (!world || !placed) return true;
    var ok = storageSet(SAVE_KEY, {
      v: 1, seed: world.seed, edits: world.edits, time: timeOfDay, hotbar: hotbar, slot: slot,
      player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, fly: player.fly }
    });
    if (ok) hasSave = true;
    var note = $('save-note');
    note.textContent = ok ? 'Мир сохранён в этом браузере.' : 'Сохранить не удалось: хранилище браузера недоступно или переполнено.';
    note.classList.toggle('is-error', !ok);
    return ok;
  }

  function saveSettings() { storageSet(SET_KEY, settings); }

  // ---- Экраны ----------------------------------------------------------------
  function showScreen(name) {
    $('title').hidden = name !== 'title';
    $('pause').hidden = name !== 'pause';
    $('inventory').hidden = name !== 'inventory';
    $('hud').hidden = name === 'title';
    $('touch').hidden = !(isTouch && state === 'playing');
    $('debug').hidden = !settings.debug || name === 'title';
    updateHint();
  }

  function play() {
    ensureAudio();
    if (!placed) placePlayer();
    state = 'playing';
    saveTimer = 0;
    $('t-down').hidden = !player.fly;
    $('t-fly').classList.toggle('is-on', player.fly);
    showScreen(null);
    if (!isTouch) lockPointer();
    toast(BLOCKS[hotbar[slot]].name);
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    releaseInput();
    saveGame();
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
    state = 'title';
    releaseInput();
    titleCam.x = player.x; titleCam.z = player.z; titleCam.y = player.y + 14; titleCam.yaw = player.yaw + 0.6;
    updateTitle();
    showScreen('title');
  }

  function openInventory() {
    if (state !== 'playing') return;
    state = 'inventory';
    releaseInput();
    renderInventory();
    showScreen('inventory');
    if (locked && document.exitPointerLock) document.exitPointerLock();
  }

  function closeInventory() {
    if (state !== 'inventory') return;
    resume();
  }

  function newWorld() {
    try { window.localStorage.removeItem(SAVE_KEY); } catch (e) { /* ничего */ }
    startWorld(null);
    renderHotbar();
  }

  function releaseInput() {
    keys = {};
    hold.brk = hold.plc = false;
    touchJump = touchDown = false;
    joy.id = null; joy.x = joy.y = 0;
    lookTouch.id = null;
    $('joy').hidden = true;
    document.querySelectorAll('.t-btn.is-down').forEach(function (b) { b.classList.remove('is-down'); });
  }

  // ---- Интерфейс --------------------------------------------------------------
  var toastTimer = 0;
  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 1600);
  }

  function selectSlot(i) {
    slot = ((i % 9) + 9) % 9;
    renderHotbar();
    toast(BLOCKS[hotbar[slot]].name);
  }

  function renderHotbar() {
    var bar = $('hotbar');
    if (!bar.children.length) {
      for (var i = 0; i < 9; i++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'slot';
        b.innerHTML = '<img alt=""><span>' + (i + 1) + '</span>';
        (function (n) {
          b.addEventListener('click', function (e) { e.stopPropagation(); selectSlot(n); if (state === 'inventory') renderInventory(); });
        })(i);
        bar.appendChild(b);
      }
    }
    for (var j = 0; j < 9; j++) {
      var el = bar.children[j], id = hotbar[j];
      el.classList.toggle('is-active', j === slot);
      el.querySelector('img').src = icons[id] || '';
      el.setAttribute('aria-label', (j + 1) + ': ' + BLOCKS[id].name);
      el.setAttribute('aria-pressed', j === slot ? 'true' : 'false');
    }
  }

  function renderInventory() {
    var grid = $('inv-grid');
    if (!grid.children.length) {
      KC.INVENTORY.forEach(function (id) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'inv-item';
        b.dataset.id = id;
        b.innerHTML = '<img alt="" src="' + icons[id] + '"><span></span>';
        b.querySelector('span').textContent = BLOCKS[id].name;
        b.addEventListener('click', function () {
          hotbar[slot] = id;
          renderHotbar();
          renderInventory();
          toast(BLOCKS[id].name + ' — в ячейке ' + (slot + 1));
        });
        grid.appendChild(b);
      });
    }
    Array.prototype.forEach.call(grid.children, function (b) {
      b.classList.toggle('is-current', +b.dataset.id === hotbar[slot]);
    });
  }

  function chunkWord(n) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'чанк';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'чанка';
    return 'чанков';
  }

  function updateTitle() {
    $('seed-label').textContent = 'Сид мира: ' + world.seed;
    $('btn-play').textContent = hasSave || placed ? 'Продолжить' : 'Играть';
    newTitleBtn.reset();
  }

  function updateProgress(p) {
    var el = $('load-label');
    if (p >= 1) { el.textContent = 'Мир готов'; el.classList.add('is-ready'); }
    else { el.textContent = 'Мир строится: ' + Math.round(p * 100) + '%'; el.classList.remove('is-ready'); }
  }

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
    } else if (!dragMode || state !== 'playing') {
      el.hidden = true;
    }
  }
  var dragHintShown = false;

  // Кнопка с подтверждением: первое нажатие спрашивает, второе выполняет
  function confirmButton(el, label, ask, action) {
    var armed = false, timer = 0;
    function reset() { armed = false; el.textContent = label; el.classList.remove('is-confirm'); clearTimeout(timer); }
    el.addEventListener('click', function () {
      if (!armed && (hasSave || placed)) {
        armed = true;
        el.textContent = ask;
        el.classList.add('is-confirm');
        timer = setTimeout(reset, 4000);
        return;
      }
      reset();
      action();
    });
    return { reset: reset };
  }
  var newTitleBtn = { reset: function () {} };

  function buildUI() {
    renderHotbar();

    $('btn-play').addEventListener('click', play);
    newTitleBtn = confirmButton($('btn-new-title'), 'Новый мир', 'Удалить текущий мир?', function () {
      newWorld();
      updateTitle();
    });
    $('btn-resume').addEventListener('click', resume);
    confirmButton($('btn-new'), 'Новый мир', 'Нажмите ещё раз: текущий мир удалится', function () {
      newWorld();
      placePlayer();
      saveGame();
      resume();
      toast('Новый мир, сид ' + world.seed);
    });
    $('btn-title').addEventListener('click', toTitle);
    $('btn-inv-close').addEventListener('click', closeInventory);

    var dist = $('set-dist'), sens = $('set-sens');
    function distLabel() { $('out-dist').textContent = settings.dist + ' ' + chunkWord(settings.dist); }
    function sensLabel() { $('out-sens').textContent = settings.sens.toFixed(1).replace('.', ',') + '×'; }
    dist.value = settings.dist; distLabel();
    sens.value = settings.sens; sensLabel();
    dist.addEventListener('input', function () { settings.dist = +dist.value; distLabel(); saveSettings(); });
    sens.addEventListener('input', function () { settings.sens = +sens.value; sensLabel(); saveSettings(); });

    [['set-cycle', 'cycle'], ['set-sound', 'sound'], ['set-autojump', 'autojump'], ['set-debug', 'debug']].forEach(function (pair) {
      var box = $(pair[0]);
      box.checked = settings[pair[1]];
      box.addEventListener('change', function () {
        settings[pair[1]] = box.checked;
        if (pair[1] === 'cycle' && !box.checked) timeOfDay = 0.28;
        if (pair[1] === 'sound' && box.checked) ensureAudio();
        saveSettings();
      });
    });

    updateTitle();
    updateProgress(0);
  }

  // ---- Управление ------------------------------------------------------------
  function look(dx, dy, k) {
    player.yaw -= dx * k * settings.sens;
    player.pitch = clamp(player.pitch - dy * k * settings.sens, -1.55, 1.55);
  }

  function lockPointer() {
    if (dragMode) { updateHint(); return; }
    var c = $('gl');
    if (!c.requestPointerLock) { dragMode = true; updateHint(); return; }
    try {
      var p = c.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(onLockError);
    } catch (e) { onLockError(); }
  }

  function onLockError() {
    // Если захват ни разу не удался — браузер или рамка его не дают: переходим на перетаскивание
    if (!everLocked) dragMode = true;
    updateHint();
  }

  // Первое действие — сразу по нажатию (короткий щелчок не теряется даже при низком FPS),
  // дальше при удержании оно повторяется по таймеру в updateActions
  function buttonDown(btn) {
    if (btn === 1) { pickBlock(); return; }
    updateTarget();
    if (btn === 0) { breakBlock(); hold.brk = true; hold.tBrk = 0.3; }
    else if (btn === 2) { placeBlock(); hold.plc = true; hold.tPlc = 0.3; }
  }
  function buttonUp(btn) {
    if (btn === 0) hold.brk = false;
    else if (btn === 2) hold.plc = false;
  }

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
      ensureAudio();
      if (!locked && !dragMode) { lockPointer(); return; }
      if (dragMode) { drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, button: e.button, moved: false }; return; }
      buttonDown(e.button);
      e.preventDefault();
    });
    window.addEventListener('mouseup', function (e) {
      if (drag) {
        if (!drag.moved && state === 'playing') {
          if (drag.button === 0) breakBlock(); else if (drag.button === 2) placeBlock(); else if (drag.button === 1) pickBlock();
        }
        drag = null;
        return;
      }
      buttonUp(e.button);
    });
    document.addEventListener('mousemove', function (e) {
      if (state !== 'playing') return;
      if (locked) {
        look(clamp(e.movementX || 0, -200, 200), clamp(e.movementY || 0, -200, 200), 0.0022);
      } else if (drag) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 5) drag.moved = true;
        if (drag.moved) look(e.clientX - drag.lx, e.clientY - drag.ly, 0.004);
        drag.lx = e.clientX; drag.ly = e.clientY;
      }
    });
    document.addEventListener('contextmenu', function (e) { if (state === 'playing' || e.target === canvas) e.preventDefault(); });
    window.addEventListener('wheel', function (e) {
      if (state !== 'playing' || !e.deltaY) return;
      selectSlot(slot + (e.deltaY > 0 ? 1 : -1));
    }, { passive: true });

    window.addEventListener('keydown', function (e) {
      var code = e.code;
      if (state === 'title') {
        if (code === 'Enter' && document.activeElement === document.body) play();
        return;
      }
      if (state === 'inventory') {
        if (code === 'KeyE' || code === 'Escape') { e.preventDefault(); closeInventory(); }
        return;
      }
      if (state === 'paused') {
        if (code === 'Escape') { e.preventDefault(); resume(); }
        return;
      }
      if (state !== 'playing') return;

      if (/^Digit[1-9]$/.test(code)) { selectSlot(+code.charAt(5) - 1); return; }
      if (code === 'Space' || code.indexOf('Arrow') === 0) e.preventDefault();
      if (e.repeat) { keys[code] = true; return; }
      switch (code) {
        case 'KeyE': e.preventDefault(); openInventory(); return;
        case 'KeyF': setFly(!player.fly); return;
        case 'F3':
          e.preventDefault();
          settings.debug = !settings.debug;
          $('set-debug').checked = settings.debug;
          $('debug').hidden = !settings.debug;
          saveSettings();
          return;
        case 'Escape': pause(); return;
        case 'Space':
          var now = performance.now();
          if (now - lastSpace < 280) { setFly(!player.fly); lastSpace = 0; } else lastSpace = now;
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

  function bindTouch() {
    var layer = $('touch'), joyEl = $('joy'), knob = $('joy-knob'), JR = 52;

    layer.addEventListener('pointerdown', function (e) {
      if (e.target !== layer || state !== 'playing') return;
      e.preventDefault();
      ensureAudio();
      if (e.clientX < window.innerWidth * 0.42 && joy.id === null) {
        joy.id = e.pointerId; joy.cx = e.clientX; joy.cy = e.clientY; joy.x = joy.y = 0;
        joyEl.style.left = e.clientX + 'px';
        joyEl.style.top = e.clientY + 'px';
        knob.style.transform = '';
        joyEl.hidden = false;
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
        ensureAudio();
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
    holdBtn('t-break', function () { buttonDown(0); }, function () { buttonUp(0); });
    holdBtn('t-place', function () { buttonDown(2); }, function () { buttonUp(2); });
    holdBtn('t-fly', function () { setFly(!player.fly); });
    holdBtn('t-inv', function () { openInventory(); });
    holdBtn('t-pause', function () { pause(); });
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 1.75);
    var w = Math.max(1, Math.floor(window.innerWidth * dpr)), h = Math.max(1, Math.floor(window.innerHeight * dpr));
    renderer.resize(w, h);
    aspect = w / h;
  }

  // Отладочный доступ из консоли
  KC.debug = {
    get world() { return world; }, get player() { return player; }, get state() { return state; },
    play: play, pause: pause, setTime: function (t) { timeOfDay = t; }
  };

  // Запуск; если страница открыта как артефакт с горячей перезагрузкой — через её хук
  var hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') {
    try { hot.snapshot(function () { saveGame(); return {}; }); } catch (e) { /* необязательно */ }
  }
  if (hot && typeof hot.ready === 'function') hot.ready(function () { boot(); });
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.KC = window.KC || {});
