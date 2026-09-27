/* Кубокрафт — главный модуль: запуск, игровой цикл (кадры + тики 20/с), управление
   (клавиатура, мышь, сенсор), камера (от первого и третьего лица), подгрузка чанков,
   небо и время суток, частицы, сохранение и меню. */
(function (KC) {
  'use strict';

  var B = KC.B, I = KC.I, BLOCKS = KC.BLOCKS, CS = KC.CS, H = KC.H, WL = KC.WL;
  var P = KC.Player, E = KC.Entities, Sim = KC.Sim, UI = KC.UI, Audio = KC.Audio;

  var SAVE_KEY = 'kubocraft.world.v3', V2_KEY = 'kubocraft.world.v2', OLD_KEY = 'kubocraft.world.v1', SET_KEY = 'kubocraft.settings.v1';
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
  // Измерения: текущее — в world, остальные лежат в dimData; lastPos — где игрок был в каждом
  var scenario = null, worldType = 'normal', dimData = {}, lastPos = {}, backDim = {}, overSpawn = null;
  var zombie = { day: 1, won: false, kills: 0 }, lastTod = 0;
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

  // Сохранение v3: у каждого измерения свои правки, блок-сущности и мобы.
  // v2 (один мир) переносится как «обычный мир», v1 — как творчество.
  function loadSave() {
    var s = storageGet(SAVE_KEY);
    if (s && typeof s.seed === 'number') return s;
    var v2 = storageGet(V2_KEY);
    if (v2 && typeof v2.seed === 'number') {
      v2.dims = { over: { edits: v2.edits, bents: v2.bents, entities: v2.entities, animalChunks: v2.animalChunks, storedMobs: v2.storedMobs } };
      v2.dim = 'over';
      return v2;
    }
    var old = storageGet(OLD_KEY);
    if (old && typeof old.seed === 'number') { old.migrated = true; old.mode = 'creative'; old.dims = { over: { edits: old.edits } }; return old; }
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

  // Хуки создаются один раз на игру и переживают смену измерений
  var hooksE = null, hooksS = null, hooksP = null;
  function buildHooks() {
    var h = hooksE = hooksCommon();
    // в машине удары и выстрелы принимает на себя корпус
    h.hurtPlayer = function (amt, cause, src, knock, fire) {
      if (P.vehicle && !P.vehicle.dead) { E.damageVehicle(P.vehicle, amt * 1.5); P.flash = 0.15; return; }
      P.hurt(amt, cause, src, knock, fire);
    };
    h.give = function (st) { return P.give(st); };
    h.heldId = function () { return P.heldId(); };
    h.explode = function (x, y, z, pw) { Sim.explode(x, y, z, pw); };
    h.pressPlate = function (x, y, z) { Sim.pressPlate(x, y, z); };
    h.primeTnt = function (x, y, z) { Sim.primeTnt(x, y, z); };
    h.hordeBoost = function () { return scenario === 'zombie' ? Math.min(6, zombie.day - 1) : 0; };
    h.killed = function (m, source) { if (source === 'player' && m.K.zombie) zombie.kills++; };
    h.worldDay = function () { return zombie.day; };
    h.vehicle = vehicleUpdate;
    h.playerVehicle = function () { return P.vehicle || null; };
    h.vehicleDestroyed = function (v) {
      if (P.vehicle !== v) return;
      exitVehicle();
      toast(v.V.name + ' взорвался!');
    };
    h.vehicleCrash = function (v, impact) {
      P.flash = Math.min(0.5, impact / 30);
      if (v.V.mass < 2 && impact > 13) P.hurt(Math.round((impact - 12) / 2), 'Авария');
    };

    hooksS = hooksCommon();
    hooksS.explosionHit = explosionHit;

    var hp = hooksP = hooksCommon();
    hp.toast = toast;
    hp.sound = function (n, x, y, z) { Audio.play(n, x === undefined ? P.e.x : x, y === undefined ? P.e.y + 1 : y, z === undefined ? P.e.z : z); };
    hp.open = openContainer;
    hp.invChanged = function () { UI.renderHud(); if (UI.screen) UI.renderContainer(); };
    hp.hudChanged = function () { UI.renderHud(); };
    hp.onDeath = onDeath;
    hp.sleep = startSleep;
    hp.pressPlate = function (x, y, z) { Sim.pressPlate(x, y, z); };
    hp.liquidTarget = function () { return raycastBlocks(eyePos(), lookDir(), P.REACH, true); };
    hp.rayHit = rayHit;
    hp.travel = travel;
    hp.teleport = teleportUse;
    hp.carHit = carHit;
    hp.talkTo = talkTo;
    hp.openMap = openMap;
    hp.useRadio = useRadio;
    hp.generatorFueled = generatorFueled;
    hp.placeVehicle = placeVehicle;
    hp.leaveVehicle = exitVehicle;
    hp.hitVehicle = function (v, dmg) { E.damageVehicle(v, dmg); };
    hp.blockBroken = function (x, y, z, id) {
      Audio.play('break:' + BLOCKS[id].mat, x + 0.5, y + 0.5, z + 0.5);
      for (var i = 0; i < 12; i++) particles('block', x + 0.5, y + 0.5, z + 0.5, id);
      if ((id === B.LOG || id === B.BIRCH_LOG) && !tips.log && mode === 'survival') { tips.log = 1; setTimeout(function () { toast('Нажмите E → «Рецепты»: из брёвен выйдут доски и верстак'); }, 1200); }
    };
  }

  // Мир измерения dim из сохранённых данных; подключает к нему сущности, симуляцию и игрока
  function makeWorld(seed, dim, data) {
    data = data || {};
    world = new KC.World(seed, data.edits || {}, dim, dim === 'over' ? worldType : 'normal');
    world.animalChunks = data.animalChunks || {};
    world.storedMobs = data.storedMobs || {};
    world.cityPop = data.cityPop || {};
    heli = null; alarms.length = 0;
    E.init(world, hooksE);
    Sim.init(world, hooksS);
    P.init(world, hooksP);
    P.setWorld(world);
    Sim.restore(data.bents);
    E.restore(data.entities);
    if (dim === 'over') overSpawn = world.findSpawn();
    spawn = overSpawn || world.findSpawn();
  }
  function snapshotWorld() {
    return { edits: world.edits, bents: Sim.serialize(), entities: E.serialize(), animalChunks: world.animalChunks, storedMobs: world.storedMobs, cityPop: world.cityPop };
  }

  function startWorld(save, opts) {
    if (world) world.chunks.forEach(function (c) { renderer.deleteMesh(c); });
    var ok = !!(save && typeof save.seed === 'number');
    hasSave = ok;
    var seed = ok ? save.seed : (opts && opts.seed) || Math.floor(Math.random() * 999999) + 1;
    mode = ok ? (save.mode || 'survival') : (opts && opts.mode) || 'survival';
    scenario = ok ? save.scenario || null : (opts && opts.scenario) || null;
    worldType = ok ? save.worldType || 'normal' : scenario === 'zombie' ? 'city' : 'normal';
    difficulty = ok && typeof save.diff === 'number' ? save.diff : (opts && typeof opts.diff === 'number' ? opts.diff : 2);
    dimData = ok && save.dims ? save.dims : {};
    lastPos = ok && save.lastPos ? save.lastPos : {};
    backDim = ok && save.backDim ? save.backDim : {};
    zombie = zombieDefaults(ok && save.zombie ? save.zombie : null);
    alarms.length = 0; alarmed = {}; heli = null; evacCache = null; lastPlace = ''; navCache = null;
    P.vehicle = null; pendingVeh = false;
    overSpawn = null;
    var dim = ok && save.dim && KC.DIMS[save.dim] ? save.dim : 'over';

    buildHooks();
    if (dim !== 'over') overSpawn = new KC.World(seed, {}, 'over', worldType).findSpawn();
    var cur = dimData[dim];
    delete dimData[dim];
    makeWorld(seed, dim, cur);
    P.reset(mode === 'creative');

    renderer.makeClouds(seed);
    timeOfDay = ok && typeof save.time === 'number' ? save.time % 1 : 0.28;
    if (!settings.cycle) timeOfDay = 0.28;
    lastTod = timeOfDay;

    var sp = ok && save.player, e = P.e;
    placed = false;
    if (sp && isFinite(sp.x)) {
      e.x = sp.x; e.y = sp.y; e.z = sp.z; e.yaw = sp.yaw || 0; e.pitch = sp.pitch || 0; e.fly = !!sp.fly && mode === 'creative';
      if (save.v >= 2) {
        P.inv = (sp.inv || []).map(unpackStack); while (P.inv.length < 36) P.inv.push(null);
        P.armor = (sp.armor || [0, 0, 0, 0]).map(unpackStack);
        P.slot = sp.slot | 0;
        P.hp = sp.hp || 20; P.food = sp.food === undefined ? 20 : sp.food; P.sat = sp.sat || 0; P.air = sp.air === undefined ? 15 : sp.air;
        P.spawnPoint = sp.spawn || null;
        pendingVeh = !!sp.veh;
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
      if (scenario === 'zombie') {
        e.yaw = Math.PI / 2;
        [[I.BAT, 1], [I.CANNED_FOOD, 3], [I.MEDKIT, 1], [B.TORCH, 6]].forEach(function (k, i) { P.inv[i] = { id: k[0], n: k[1], d: 0 }; });
      }
    }
    e.vx = e.vy = e.vz = 0;
    P.portalT = -1;
    titleCam.x = e.x; titleCam.z = e.z;
    titleCam.y = (placedSaved ? e.y : Math.max(spawn.h, WL)) + 16;
    titleCam.yaw = e.yaw + 0.6;
    particlesList.length = 0;
    target = null; targetMob = null;
    UI.forceHud();
    updateZombieHud();
    if ($('seed-label')) updateTitle();
  }
  var placedSaved = false, pendingVeh = false;

  // ---- Путешествия между мирами ----------------------------------------------------------
  // Врата типа kind ведут в своё измерение, а из него — туда, откуда пришли
  function travel(kind) {
    var to = world.dim === kind ? (backDim[kind] || 'over') : kind;
    goTo(to, kind);
  }
  function teleportUse() {
    goTo(world.dim === 'space' ? (backDim.space || 'over') : 'space', 'teleport');
  }

  function goTo(dim, via, forcePos) {
    if (!KC.DIMS[dim] || dim === world.dim) return;
    if (P.vehicle) exitVehicle();
    var e = P.e, from = world.dim, fx = e.x, fz = e.z;
    lastPos[from] = { x: e.x, y: e.y, z: e.z, yaw: e.yaw };
    if (dim !== 'over' && via !== 'fall') backDim[dim] = from;
    dimData[from] = snapshotWorld();
    world.chunks.forEach(function (c) { renderer.deleteMesh(c); });
    var data = dimData[dim];
    delete dimData[dim];
    makeWorld(world.seed, dim, data);

    var pos = forcePos || lastPos[dim], fresh = !pos;
    var gx = pos ? pos.x : dim === 'space' ? 0 : fx, gz = pos ? pos.z : dim === 'space' ? -36 : fz;
    var pcx = Math.floor(gx / CS), pcz = Math.floor(gz / CS), dx, dz;
    for (dz = -2; dz <= 2; dz++) for (dx = -2; dx <= 2; dx++) world.generate(pcx + dx, pcz + dz);
    if (fresh) {
      pos = KC.Gen.arrival(world, dim, fx, fz);
      if (via === 'hell' || via === 'heaven') buildGate(pos, via === 'hell' ? B.HELL_GATE : B.HEAVEN_GATE, dim);
    }
    for (dz = -1; dz <= 1; dz++) for (dx = -1; dx <= 1; dx++) remesh(world.getChunk(pcx + dx, pcz + dz));
    e.x = pos.x; e.y = pos.y; e.z = pos.z;
    if (pos.yaw !== undefined) e.yaw = pos.yaw;
    e.vx = e.vy = e.vz = 0; e.fallDist = 0; e.fire = 0;
    var guard = 0;
    while (guard++ < H && E.boxHits(e.x, e.y, e.z, e.w, e.h)) e.y += 1;
    P.portalT = -1;
    placed = true; placedSaved = true;
    particlesList.length = 0; target = null; targetMob = null;
    $('fade').classList.remove('is-on'); void $('fade').offsetWidth; $('fade').classList.add('is-on');
    Audio.play('teleport');
    showDimLabel();
    if (dim === 'space' && !tips.space) { tips.space = 1; setTimeout(function () { toast('За пределами станции нет воздуха: наденьте космический шлем'); }, 2600); }
    if (dim === 'hell' && !tips.hell) { tips.hell = 1; setTimeout(function () { toast('Врата рядом — через них можно вернуться'); }, 2600); }
    saveGame();
  }

  // Обратные врата рядом с точкой прибытия, на твёрдом полу
  function buildGate(pos, id, dim) {
    var x = Math.floor(pos.x) + 2, y = Math.floor(pos.y), z = Math.floor(pos.z);
    var floor = dim === 'hell' ? B.ASH_BRICK : dim === 'heaven' ? B.SKYSTONE : B.COBBLE;
    if (!KC.OPAQUE[world.getBlock(x, y - 1, z)]) world.setBlock(x, y - 1, z, floor, 0);
    world.setBlock(x, y, z, id, 1);
    world.setBlock(x, y + 1, z, id, 9);
    if (KC.SOLID[world.getBlock(x, y + 2, z)] && world.getBlock(x, y + 2, z) !== B.BEDROCK) world.setBlock(x, y + 2, z, 0, 0);
  }

  var dimLabelT = 0;
  function showDimLabel() { showLabel(KC.DIMS[world.dim].name, ''); }
  function showLabel(name, sub) {
    var el = $('dim-label');
    el.firstChild.textContent = name;
    $('dim-sub').textContent = sub || '';
    el.classList.add('is-on');
    clearTimeout(dimLabelT);
    dimLabelT = setTimeout(function () { el.classList.remove('is-on'); }, 2600);
  }

  // ---- Техника: посадка, управление, камера ------------------------------------------------
  var vehCam = 0, targetVeh = null, vehHudT = 0;
  function enterVehicle(v) {
    if (!v || v.dead || v.driver || P.vehicle || P.dead) return;
    P.vehicle = v; v.driver = true; P.e.fly = false;
    P.mining = null; P.using = null;
    seatPlayer(v);
    P.e.pitch = Math.min(P.e.pitch, -0.3);            // камера сзади смотрит чуть сверху — машину видно над панелью
    Audio.play('door-car', v.x, v.y + 1, v.z);
    if (!v.V.cabin) vehCam = 0;
    if (!tips.drive) {
      tips.drive = 1;
      message(isTouch ? 'Джойстик — газ и руль, «вверх» — тормоз, «Бить» — ' + (v.V.cannon ? 'выстрел из пушки' : 'гудок') + ', «вниз» — выйти'
        : 'W/S — газ и тормоз, A/D — руль, пробел — тормоз, ЛКМ — ' + (v.V.cannon ? 'выстрел из пушки' : 'гудок') + ', Shift — выйти, F5 — вид', 9);
    } else toast(v.V.name + (v.fuel <= 0 ? ': бак пуст' : ''));
    UI.renderHud();
  }
  function exitVehicle() {
    var v = P.vehicle;
    if (!v) return;
    var spot = E.exitSpot(v);
    P.vehicle = null; v.driver = false; v.ctl = null;
    var e = P.e;
    e.x = spot.x; e.y = spot.y; e.z = spot.z; e.vx = e.vy = e.vz = 0; e.fallDist = 0;
    Audio.play('door-car', v.x, v.y + 1, v.z);
    $('veh').hidden = true;
  }
  function refuelVehicle(v) {
    var st = P.held();
    if (!st || st.id !== I.FUEL_CAN) return false;
    if (v.fuel >= 99) { toast('Бак и так полон'); return true; }
    v.fuel = Math.min(100, v.fuel + 45);
    if (!P.creative) { st.n--; if (!st.n) P.inv[P.slot] = null; }
    Audio.play('splash', v.x, v.y + 1, v.z);
    toast(v.V.name + ': бак заправлен на ' + Math.round(v.fuel) + '%');
    UI.renderHud();
    return true;
  }
  // Место водителя: сиденье смещено вбок и вдоль корпуса, высота — уровень глаз
  function seatPlayer(v) {
    var f = E.vFwd(v.yaw), r = [-f[1], f[0]], s = v.V.seat, e = P.e;
    e.x = v.x + r[0] * s[0] - f[0] * s[2];
    e.z = v.z + r[1] * s[0] - f[1] * s[2];
    e.y = v.y + s[1] - P.EYE;
    e.vx = e.vy = e.vz = 0; e.fallDist = 0; e.onGround = true;
  }
  function driveInput(dt, inp) {
    var v = P.vehicle;
    if (!v) return;
    if (v.dead) { P.vehicle = null; $('veh').hidden = true; return; }
    v.ctl = state === 'playing' ? { throttle: clamp(inp.f, -1, 1), steer: clamp(inp.s, -1, 1), brake: inp.jump } : { throttle: 0, steer: 0, brake: true };
    // башня танка следит за взглядом
    if (v.V.cannon) {
      var dy = P.e.yaw - v.turret;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      v.turret += clamp(dy, -1.3 * dt, 1.3 * dt);
      v.gunPitch += (clamp(P.e.pitch, -0.12, 0.35) - v.gunPitch) * Math.min(1, dt * 4);
    }
    v.engineT = (v.engineT || 0) - dt;
    if (v.engineT <= 0 && v.fuel > 0) { v.engineT = 0.3; Audio.play('engine:' + Math.round((v.V.mass > 2 ? 34 : 48) + Math.abs(v.speed) * 4), v.x, v.y + 1, v.z, 0.6); }
  }
  // ЛКМ за рулём: пушка у танка, у остальных — гудок (заражённые идут на звук)
  function vehicleAction() {
    var v = P.vehicle;
    if (!v) return;
    if (v.V.cannon) {
      if (v.cannonCd > 0) return;
      if (!P.creative && !P.count(I.TANK_SHELL)) { toast('Нет танковых снарядов'); v.cannonCd = 0.6; return; }
      v.cannonCd = 2.4;
      var f = E.vFwd(v.turret), cp = Math.cos(v.gunPitch);
      E.fireCannon(v, [f[0] * cp, Math.sin(v.gunPitch), f[1] * cp]);
      if (!P.creative) P.consume(I.TANK_SHELL, 1);
      P.flash = 0.2;
      UI.renderHud();
      return;
    }
    if (v.hornCd > 0) return;
    v.hornCd = 0.7;
    Audio.play('horn', v.x, v.y + 1, v.z);
    E.noise(v.x, v.y, v.z, 32);
  }
  function placeVehicle(kind) {
    var t = target, e = P.e;
    if (!t) return false;
    var x = t.x + t.nx + 0.5, y = t.y + t.ny, z = t.z + t.nz + 0.5;
    var v = E.spawnVehicle(kind, x, y, z, e.yaw);
    if (!v) return false;
    for (var up = 0; up < 3 && E.vHits(v, v.x, v.y, v.z, v.yaw); up++) v.y += 1;
    if (E.vHits(v, v.x, v.y, v.z, v.yaw)) { v.dead = true; toast('Здесь не хватает места'); return false; }
    v.fuel = 100;
    return true;
  }
  function updateVehHud(dt) {
    var v = P.vehicle, el = $('veh');
    if (!v) { if (!el.hidden) el.hidden = true; return; }
    vehHudT -= dt;
    if (vehHudT > 0) return;
    vehHudT = 0.15;
    el.hidden = false;
    var kmh = Math.round(Math.abs(v.speed) * 3.6);
    el.children[0].textContent = v.V.name;
    el.children[1].textContent = kmh + ' км/ч' + (v.speed < -0.3 ? ' · назад' : '');
    el.children[2].firstChild.style.width = Math.round(v.fuel) + '%';
    el.children[2].classList.toggle('is-low', v.fuel < 15);
    el.children[3].firstChild.style.width = Math.max(0, Math.round(v.hp / v.V.hp * 100)) + '%';
    el.children[4].textContent = v.atPump ? 'Заправка у колонки…' : v.fuel <= 0 ? 'Бак пуст — нужна канистра' : v.V.cannon ? 'Снарядов: ' + (P.creative ? '∞' : P.count(I.TANK_SHELL)) : '';
  }

  // ---- Режим зомби-апокалипсиса ---------------------------------------------------------
  // Сценарий: найти рацию в полицейском участке → узнать, где площадка эвакуации (крыша башни
  // в центре) → заправить там генератор, чтобы горели посадочные огни → встретить вертолёт
  // на рассвете 8-го дня. Не успели — следующий прилетит через три дня.
  var HELI_FIRST = 8, HELI_AGAIN = 3, NIGHTS = HELI_FIRST - 1;
  function zombieDefaults(z) {
    z = z || {};
    z.day = z.day || 1; z.kills = z.kills || 0; z.won = !!z.won; z.rescued = z.rescued || 0;
    z.radio = !!z.radio; z.heliDay = z.heliDay || HELI_FIRST; z.heliActive = !!z.heliActive;
    z.ev = z.ev || {};
    return z;
  }
  var evacCache = null;
  function evacInfo() {
    if (!evacCache || evacCache.seed !== world.seed) { evacCache = KC.Gen.evacPoint(world.seed); evacCache.seed = world.seed; }
    return evacCache;
  }
  function cityMode() { return scenario === 'zombie' && world && world.dim === 'over' && world.type === 'city'; }

  // Длинные сообщения (рация, выжившие) висят дольше обычной подсказки
  var msgTimer = 0;
  function message(text, secs) {
    var el = $('msg');
    el.textContent = text;
    el.classList.add('is-on');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { el.classList.remove('is-on'); }, (secs || 7) * 1000);
  }

  function nightWord(n) { var m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? 'ночь' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'ночи' : 'ночей'; }
  function updateZombieHud() {
    var el = $('zday');
    if (!el) return;
    el.hidden = scenario !== 'zombie';
    $('nav').hidden = scenario !== 'zombie';
    if (scenario !== 'zombie') return;
    var z = zombie, left = z.heliDay - z.day;
    el.textContent = z.won ? 'Эвакуация состоялась · свободная игра' :
      z.heliActive ? 'День ' + z.day + ' · вертолёт над площадкой до заката!' :
      'День ' + z.day + ' · вертолёт через ' + left + ' ' + nightWord(left) + (z.radio ? '' : ' · место эвакуации неизвестно');
  }

  // Рассвет: новый день. В день прилёта вертолёт ждёт над площадкой до заката.
  function zombieDawn() {
    if (zombie.won) return;
    zombie.day++;
    if (zombie.day >= zombie.heliDay) {
      zombie.heliActive = true;
      message(zombie.radio ? 'Рассвет. Вертолёт летит к площадке эвакуации и будет ждать до заката! Поднимайтесь на крышу башни в центре'
        : 'Рассвет. Слышен гул вертолёта где-то в центре… Без рации не узнать, где он сядет: ищите её в полицейском участке', 9);
    } else toast('Рассвет. День ' + zombie.day + ': заражённых всё больше');
    updateZombieHud();
    saveGame();
  }
  function heliMissed() {
    zombie.heliActive = false;
    zombie.heliDay = zombie.day + HELI_AGAIN;
    if (heli && !heli.dead) heli.st = 'leave';
    message('Вертолёт улетел на закате. Следующий будет утром ' + zombie.heliDay + '-го дня', 8);
    updateZombieHud();
  }
  function victory() {
    zombie.won = true;
    zombie.heliActive = false;
    updateZombieHud();
    Audio.play('victory');
    state = 'won';
    releaseInput();
    $('victory-text').textContent = 'Вертолёт поднял вас с крыши на ' + zombie.day + '-й день апокалипсиса. Повержено заражённых: ' + zombie.kills +
      ', спасено выживших: ' + zombie.rescued + '.';
    showScreen('victory');
    if (locked && document.exitPointerLock) document.exitPointerLock();
    saveGame();
  }

  function radioFound() {
    zombie.radio = true;
    Audio.play('radio');
    useRadio();
    updateZombieHud();
  }
  function useRadio() {
    if (scenario !== 'zombie') { toast('В эфире тишина'); return; }
    Audio.play('radio');
    var ev = evacInfo(), gen = genRunning();
    message(zombie.won ? 'Рация: «Все эвакуированы. Конец связи»' :
      'Рация: «…эвакуация с вертолётной площадки на крыше башни в центре города. Вертолёт — на рассвете ' + zombie.heliDay +
      '-го дня. ' + (gen ? 'Посадочные огни горят — пилот увидит площадку»' : 'Заправьте генератор на крыше, иначе пилот не увидит огней»'), 10);
    void ev;
  }
  function genRunning() {
    var g = evacInfo().gen;
    if (!world.isLoaded(g.x, g.z)) return !!zombie.genFueled;
    return world.getBlock(g.x, g.y, g.z) === B.GENERATOR && (world.getMeta(g.x, g.y, g.z) & 4) !== 0;
  }
  function generatorFueled(x, y, z) {
    var g = evacInfo().gen;
    if (scenario === 'zombie' && x === g.x && y === g.y && z === g.z) {
      zombie.genFueled = true;
      message('Посадочные огни загорелись. Теперь пилот увидит площадку — встречайте вертолёт здесь', 8);
    }
  }

  // ---- Вертолёт эвакуации -------------------------------------------------------------------
  var heli = null;
  function heliUpdate() {
    if (heli && heli.dead) heli = null;
    if (!zombie.heliActive || zombie.won) return;
    var ev = evacInfo(), e = P.e;
    if (!heli && Math.hypot(e.x - ev.x, e.z - ev.z) < 140 && world.isLoaded(ev.x, ev.z)) {
      heli = E.spawnMob('heli', ev.x + 14, ev.y + 14, ev.z, { yaw: 0 });
      if (heli) { heli.st = 'circle'; heli.ang = 0; heli.rotor = 16; heli.soundT = 0; }
    }
  }
  function vehicleUpdate(m, dt) {
    var ev = evacInfo(), e = P.e, tx, ty, tz;
    m.t = (m.t || 0) + dt;
    var onPad = !P.dead && Math.hypot(e.x - ev.x, e.z - ev.z) < 6 && Math.abs(e.y - ev.y) < 2.5;
    if (m.st === 'circle') {
      m.ang += dt * 0.35;
      tx = ev.x + Math.cos(m.ang) * 14; tz = ev.z + Math.sin(m.ang) * 14; ty = ev.y + 14;
      if (onPad && genRunning()) { m.st = 'land'; message('Пилот видит огни! Вертолёт садится — ждите на площадке', 6); }
      else if (onPad && !m.warned) { m.warned = true; message('Пилот не видит площадку: заправьте генератор на крыше канистрой с топливом', 8); }
    } else if (m.st === 'land') {
      tx = ev.x; ty = ev.y + 0.05; tz = ev.z + 0.5;
      if (Math.abs(m.y - ty) < 0.2 && Math.hypot(m.x - tx, m.z - tz) < 0.5) m.st = 'wait';
    } else if (m.st === 'wait') {
      tx = m.x; ty = m.y; tz = m.z;
      if (onPad) { m.st = 'leave'; m.t = 0; victory(); }
    } else {
      tx = m.x + 40; ty = Math.min(m.y + 30, KC.H + 40); tz = m.z - 40;
      if (m.t > 25) m.dead = true;
    }
    var dx = tx - m.x, dy = ty - m.y, dz = tz - m.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var sp = m.st === 'land' ? 3.5 : 9;
    if (d > 0.01) { var st = Math.min(d, sp * dt); m.x += dx / d * st; m.y += dy / d * st; m.z += dz / d * st; }
    if (Math.abs(dx) + Math.abs(dz) > 0.3) {
      var want = Math.atan2(-dx, -dz), turn = want - m.yaw;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      m.yaw += turn * Math.min(1, dt * 2);
      m.bank = Math.max(-0.3, Math.min(0.3, -turn * 0.4));
    } else m.bank = (m.bank || 0) * 0.9;
    m.vx = m.vy = m.vz = 0;
    m.soundT -= dt;
    if (m.soundT <= 0) { m.soundT = 0.8; Audio.play('heli', m.x, m.y, m.z); }
  }

  // ---- Сигнализация машин: удар или выстрел по машине собирает заражённых -------------------
  var alarms = [], alarmed = {};
  function carHit(x, y, z) {
    if (world.type !== 'city') return;
    var k = (x >> 2) + ',' + (z >> 2);
    if (alarmed[k]) return;
    alarmed[k] = 1;
    alarms.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, t: 20, n: 0 });
    toast('Сработала сигнализация! Заражённые идут на шум');
  }
  function updateAlarms(dt) {
    for (var i = alarms.length - 1; i >= 0; i--) {
      var a = alarms[i];
      a.t -= dt; a.n -= dt;
      if (a.n <= 0) {
        a.n = 1;
        Audio.play('alarm', a.x, a.y, a.z);
        E.noise(a.x, a.y, a.z, 50);
        for (var q = 0; q < 3; q++) particles('spark', a.x, a.y + 0.6, a.z);
      }
      if (a.t <= 0) alarms.splice(i, 1);
    }
  }

  // ---- События в городе: сброс груза, выжившие на крышах, пожары ---------------------------
  function streetSpot(r0, r1) {
    var e = P.e, cell = KC.Gen.CELL;
    for (var i = 0; i < 40; i++) {
      var ang = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      var x = Math.floor(e.x + Math.cos(ang) * r), z = Math.floor(e.z + Math.sin(ang) * r);
      var lx = ((x % cell) + cell) % cell, lz = ((z % cell) + cell) % cell;
      if (!(lx >= 1 && lx <= 6) && !(lz >= 1 && lz <= 6)) continue;
      var c = world.getChunk(x >> 4, z >> 4);
      if (!c || !c.mesh) continue;
      var y = KC.Gen.CITY_GROUND + 1;
      if (world.getBlock(x, y, z) || world.getBlock(x, y + 1, z) || !KC.SOLID[world.getBlock(x, y - 1, z)]) continue;
      return { x: x, y: y, z: z };
    }
    return null;
  }
  function roofSpot(r0, r1) {
    var e = P.e, G = KC.Gen, cell = G.CELL;
    for (var i = 0; i < 30; i++) {
      var ang = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      var pl = G.plotInfo(world.seed, Math.floor((e.x + Math.cos(ang) * r) / cell), Math.floor((e.z + Math.sin(ang) * r) / cell));
      if (pl.kind !== 'building' || pl.special === 'helipad') continue;
      var x = pl.bx0 + 2 + Math.floor(Math.random() * (pl.bx1 - pl.bx0 - 3)), z = pl.bz0 + 2 + Math.floor(Math.random() * (pl.bz1 - pl.bz0 - 3));
      var c = world.getChunk(x >> 4, z >> 4);
      if (!c || !c.mesh) continue;
      var y = pl.top + 1;
      if (world.getBlock(x, y, z) || world.getBlock(x, y + 1, z) || !KC.SOLID[world.getBlock(x, y - 1, z)]) continue;
      return { x: x, y: y, z: z, plot: pl };
    }
    return null;
  }
  function airdrop() {
    var s = streetSpot(45, 85);
    if (!s) return false;
    E.spawnFalling(s.x, KC.H - 6, s.z, B.AIRDROP, 0);
    zombie.ev.drop = { x: s.x, y: s.y, z: s.z, day: zombie.day, filled: false };
    message('Над городом пролетел самолёт и сбросил груз с припасами — ищите красный дым. Туда же пойдут и заражённые', 8);
    return true;
  }
  function survivorEvent() {
    var s = roofSpot(40, 100);
    if (!s) return false;
    var m = E.spawnMob('survivor', s.x + 0.5, s.y, s.z + 0.5);
    if (!m) return false;
    zombie.ev.surv = { x: s.x + 0.5, y: s.y, z: s.z + 0.5, day: zombie.day };
    message('На крыше кто-то машет руками — выживший зовёт на помощь. Поднимитесь к нему', 7);
    return true;
  }
  function fireEvent() {
    var s = roofSpot(40, 110);
    if (!s) return false;
    var pl = s.plot, n = 0;
    for (var i = 0; i < 400 && n < 40; i++) {
      // огонь на крыше и у окон — чтобы зарево было видно с улицы
      var roof = Math.random() < 0.5, x, z;
      if (roof || Math.random() < 0.3) { x = pl.bx0 + Math.floor(Math.random() * (pl.bx1 - pl.bx0 + 1)); z = pl.bz0 + Math.floor(Math.random() * (pl.bz1 - pl.bz0 + 1)); }
      else if (Math.random() < 0.5) { x = Math.random() < 0.5 ? pl.bx0 + 1 : pl.bx1 - 1; z = pl.bz0 + 1 + Math.floor(Math.random() * (pl.bz1 - pl.bz0 - 1)); }
      else { z = Math.random() < 0.5 ? pl.bz0 + 1 : pl.bz1 - 1; x = pl.bx0 + 1 + Math.floor(Math.random() * (pl.bx1 - pl.bx0 - 1)); }
      var y = roof ? pl.top + 1 : KC.Gen.CITY_GROUND + 1 + 4 * Math.floor(Math.random() * pl.floors);
      if (world.getBlock(x, y, z) || !KC.OPAQUE[world.getBlock(x, y - 1, z)]) continue;
      world.setBlock(x, y, z, B.FIRE, 0);
      n++;
    }
    if (!n) return false;
    zombie.ev.fire = { x: (pl.bx0 + pl.bx1) / 2, y: pl.top + 2, z: (pl.bz0 + pl.bz1) / 2, day: zombie.day };
    toast('Где-то горит дом — зарево видно издалека');
    return true;
  }
  function talkTo(m) {
    if (m.kind !== 'survivor') return;
    if (m.helped) { toast('Выживший: «Удачи вам!»'); return; }
    m.helped = true;
    zombie.rescued++;
    var gifts = [[I.AMMO, 10], [I.CANNED_FOOD, 2], [I.BANDAGE, 3]];
    if (!P.count(I.CITY_MAP)) gifts.unshift([I.CITY_MAP, 1]);
    gifts.forEach(function (g) { var left = P.give({ id: g[0], n: g[1], d: 0 }); if (left) E.dropItem(P.e.x, P.e.y + 1, P.e.z, { id: g[0], n: left }); });
    message('Выживший: «Спасибо, что добрались! Возьмите карту района — там отмечены полиция, больницы и заправки. А я уйду через метро»', 9);
    zombie.ev.surv = null;
    setTimeout(function () { if (!m.dead) { m.dead = true; for (var q = 0; q < 10; q++) particles('smoke', m.x, m.y + Math.random() * 1.8, m.z); } }, 5000);
    UI.renderHud();
  }

  var evT = 0;
  function cityEvents(dt) {
    evT -= dt;
    if (evT > 0) return;
    evT = 1;
    var ev = zombie.ev, tod = timeOfDay;
    if (!ev.dropAt) ev.dropAt = 0.08 + Math.random() * 0.25;
    if (ev.dropDay !== zombie.day && tod > ev.dropAt && tod < 0.45) { if (airdrop()) { ev.dropDay = zombie.day; ev.dropAt = 0.08 + Math.random() * 0.25; } }
    if (ev.survDay !== zombie.day && tod > 0.16 && tod < 0.45) { ev.survDay = zombie.day; if (Math.random() < 0.75) survivorEvent(); }
    if (ev.fireDay !== zombie.day && zombie.day % 2 === 0 && tod > 0.5 && tod < 0.62) { if (fireEvent()) ev.fireDay = zombie.day; }
    var d = ev.drop;
    if (d) {
      if (!d.filled && world.getBlock(d.x, d.y, d.z) === B.AIRDROP) {
        var be = Sim.getBent(d.x, d.y, d.z);
        if (be) { be.slots = KC.Gen.rollLoot('airdrop', d.x, d.y + zombie.day, d.z, world.seed); d.filled = true; }
        Audio.play('drop', d.x, d.y, d.z);
        E.noise(d.x, d.y, d.z, 36);
      }
      if (d.opened || zombie.day - d.day > 1 || (d.filled && world.isLoaded(d.x, d.z) && world.getBlock(d.x, d.y, d.z) !== B.AIRDROP)) ev.drop = null;
    }
    if (ev.surv && zombie.day - ev.surv.day > 1) ev.surv = null;
    if (ev.fire && zombie.day - ev.fire.day > 0 && tod < 0.5) ev.fire = null;
  }
  // Столбы дыма над грузом и пожаром видно издалека
  var smokeT = 0;
  function smokeColumns(dt) {
    if (reduceMotion) return;
    smokeT -= dt;
    if (smokeT > 0) return;
    smokeT = 0.12;
    var ev = zombie.ev;
    if (ev.drop && ev.drop.filled) particles('smokeRed', ev.drop.x + 0.5, ev.drop.y + 1.2, ev.drop.z + 0.5);
    if (ev.fire) {
      particles('smokeDark', ev.fire.x + (Math.random() - 0.5) * 6, ev.fire.y, ev.fire.z + (Math.random() - 0.5) * 6);
      if (Math.random() < 0.6) particles('flame', ev.fire.x + (Math.random() - 0.5) * 8, ev.fire.y - 0.5, ev.fire.z + (Math.random() - 0.5) * 8);
    }
  }

  // ---- Навигация: цель сценария и события, стрелка относительно взгляда -------------------
  var navT = 0, navCache = null;
  function objective() {
    if (scenario !== 'zombie' || zombie.won || !world || world.dim !== 'over') return null;
    var e = P.e;
    if (!zombie.radio) {
      if (!navCache || Math.abs(navCache.px - e.x) + Math.abs(navCache.pz - e.z) > 24) {
        var pol = KC.Gen.findNearest(world.seed, e.x, e.z, 'police', 8);
        navCache = { px: e.x, pz: e.z, pol: pol };
      }
      return navCache.pol ? { x: navCache.pol.x, z: navCache.pol.z, label: 'Полицейский участок: рация' } : null;
    }
    var ev = evacInfo();
    return { x: ev.x, z: ev.z, label: zombie.heliActive ? 'Площадка эвакуации: вертолёт ждёт!' : genRunning() ? 'Площадка эвакуации' : 'Площадка эвакуации: генератор' };
  }
  function updateNav(dt) {
    navT -= dt;
    if (navT > 0) return;
    navT = 0.2;
    var rows = $('nav').children, e = P.e, marks = [];
    if (cityMode()) {
      if (!zombie.radio && P.count(I.RADIO) > 0) radioFound();
      var o = objective();
      if (o) marks.push(o);
      var ev = zombie.ev;
      if (ev.drop && ev.drop.filled) marks.push({ x: ev.drop.x + 0.5, z: ev.drop.z + 0.5, label: 'Груз с припасами', kind: 'drop' });
      if (ev.surv) marks.push({ x: ev.surv.x, z: ev.surv.z, label: 'Выживший на крыше', kind: 'surv' });
    }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], m = marks[i];
      r.hidden = !m;
      if (!m) continue;
      var dx = m.x - e.x, dz = m.z - e.z, dist = Math.hypot(dx, dz);
      var rel = Math.atan2(-dx, -dz) - e.yaw;
      r.children[0].style.transform = 'rotate(' + (-rel * 180 / Math.PI).toFixed(1) + 'deg)';
      r.children[1].textContent = m.label;
      r.children[2].textContent = dist < 4 ? 'здесь' : Math.round(dist) + ' м';
      r.className = 'nav-row' + (m.kind ? ' nav-row--' + m.kind : '');
    }
  }

  // ---- Названия мест: район, особое здание, метро ---------------------------------------------
  var SPECIAL_NOTES = { police: 'оружейная за решёткой на первом этаже', hospital: 'аптечки и бинты, но и пациенты', market: 'много еды и толпа внутри',
    gas: 'канистры с топливом, бочки взрываются', helipad: 'лестница на крышу — в углу здания', military: 'оружие, боеприпасы и танк' };
  var placeT = 0, lastPlace = '';
  function updatePlace(dt) {
    placeT -= dt;
    if (placeT > 0) return;
    placeT = 0.5;
    if (!world || world.type !== 'city' || world.dim !== 'over') { lastPlace = ''; return; }
    var e = P.e, G = KC.Gen, info = G.cityInfo(world.seed, e.x, e.z), pl = info.plot, name = info.D.name, sub = info.D.note;
    if (e.y < G.CITY_GROUND - 3) { name = 'Метро'; sub = 'темно; слепые слышат шаги — крадитесь'; }
    else if (info.inPlot && pl.special) {
      var bx0 = pl.bx0 !== undefined ? pl.bx0 : pl.x0, bx1 = pl.bx1 !== undefined ? pl.bx1 : pl.x0 + 27;
      var bz0 = pl.bz0 !== undefined ? pl.bz0 : pl.z0, bz1 = pl.bz1 !== undefined ? pl.bz1 : pl.z0 + 27;
      if (pl.special === 'gas' || (e.x >= bx0 - 2 && e.x <= bx1 + 2 && e.z >= bz0 - 2 && e.z <= bz1 + 2)) { name = G.SPECIAL_NAMES[pl.special]; sub = SPECIAL_NOTES[pl.special]; }
    }
    if (name !== lastPlace) { lastPlace = name; showLabel(name, sub); }
  }

  // ---- Карта района ---------------------------------------------------------------------------
  var MAP_COL = { downtown: '#4a5160', residential: '#6b5a48', industrial: '#6a6243', suburb: '#8a8a66' };
  var MAP_ICON = { police: ['П', '#3f6fd8'], hospital: ['Б', '#2fae63'], market: ['С', '#e08a2a'], gas: ['З', '#d0453a'], helipad: ['★', '#f0b545'], military: ['В', '#6b7d3a'] };
  function openMap() {
    if (state !== 'playing') return;
    if (!world || world.type !== 'city' || world.dim !== 'over') { toast('Эта карта — только для города'); return; }
    state = 'map';
    releaseInput();
    showScreen('map');
    drawMap();
    if (locked && document.exitPointerLock) document.exitPointerLock();
  }
  function closeMap() {
    if (state !== 'map') return;
    state = 'playing';
    showScreen(null);
    if (!isTouch) lockPointer();
  }
  function drawMap() {
    var cv = $('map-canvas'), g = cv.getContext('2d'), G = KC.Gen, cell = G.CELL, N = 15, S = cv.width / N;
    var e = P.e, pcx = Math.floor(e.x / cell), pcz = Math.floor(e.z / cell), ox = (pcx - 7) * cell, oz = (pcz - 7) * cell;
    var k = S / cell, i, j;
    g.fillStyle = '#23262b'; g.fillRect(0, 0, cv.width, cv.height);
    g.font = 'bold ' + Math.round(S * 0.5) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      var pl = G.plotInfo(world.seed, pcx - 7 + i, pcz - 7 + j), x0 = i * S, y0 = j * S;
      g.fillStyle = MAP_COL[pl.district]; g.fillRect(x0 + 10 * k, y0 + 10 * k, 28 * k, 28 * k);
      if (pl.bx0 !== undefined) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + (pl.bx0 - pl.x0 + 10) * k, y0 + (pl.bz0 - pl.z0 + 10) * k, (pl.bx1 - pl.bx0 + 1) * k, (pl.bz1 - pl.bz0 + 1) * k); }
      if (pl.kind === 'park') { g.fillStyle = '#3f8a3a'; g.fillRect(x0 + 12 * k, y0 + 12 * k, 24 * k, 24 * k); }
      var ic = MAP_ICON[pl.special];
      if (ic && (pl.special !== 'helipad' || zombie.radio)) {
        g.fillStyle = ic[1]; g.beginPath(); g.arc(x0 + 24 * k, y0 + 24 * k, S * 0.34, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.fillText(ic[0], x0 + 24 * k, y0 + 24.5 * k);
      }
      // линии и станции метро
      var cx = pcx - 7 + i, cz = pcz - 7 + j;
      g.fillStyle = 'rgba(206,38,44,0.55)';
      if (((cx % 4) + 4) % 4 === 2) g.fillRect(x0 + 3 * k, y0, 2 * k, S);
      if (((cz % 4) + 4) % 4 === 2) g.fillRect(x0, y0 + 3 * k, S, 2 * k);
      if (((cx % 4) + 4) % 4 === 2 && ((cz % 4) + 4) % 4 === 2) {
        g.fillStyle = '#ce262c'; g.beginPath(); g.arc(x0 + 4 * k, y0 + 4 * k, S * 0.26, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(S * 0.34) + 'px sans-serif'; g.fillText('М', x0 + 4 * k, y0 + 4.5 * k);
        g.font = 'bold ' + Math.round(S * 0.5) + 'px sans-serif';
      }
    }
    // события
    var ev = zombie.ev;
    function dot(wx, wz, col) { g.fillStyle = col; g.beginPath(); g.arc((wx - ox) * k, (wz - oz) * k, S * 0.18, 0, Math.PI * 2); g.fill(); }
    if (ev.drop && ev.drop.filled) dot(ev.drop.x, ev.drop.z, '#ff4a4a');
    if (ev.surv) dot(ev.surv.x, ev.surv.z, '#ffffff');
    // игрок
    var px = (e.x - ox) * k, pz = (e.z - oz) * k, a = -e.yaw;
    g.save(); g.translate(px, pz); g.rotate(a);
    g.fillStyle = '#f0b545'; g.strokeStyle = '#1a1a1a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -S * 0.42); g.lineTo(S * 0.28, S * 0.3); g.lineTo(-S * 0.28, S * 0.3); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  function zombieTick(dt) {
    if (!cityMode()) return;
    heliUpdate();
    cityEvents(dt);
    updateAlarms(dt);
    smokeColumns(dt);
    if (zombie.heliActive && lastTod < 0.5 && timeOfDay >= 0.5) heliMissed();
  }

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
    var vh = E.raycastVehicles(o, d, P.REACH);
    targetVeh = vh && (!target || vh.t < target.t) && (!mh || vh.t < mh.t) ? vh.v : null;
    if (targetVeh) target = null;
  }

  // Луч от глаз: первое существо или блок на дистанции maxD (для пистолета)
  // spread — разброс (радианы), pierce — сколько существ подряд пробивает пуля
  function rayHit(maxD, spread, pierce) {
    var o = eyePos(), d = lookDir();
    if (spread) {
      var a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      var up = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
      var s1 = norm3([d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]);
      var s2 = [d[1] * s1[2] - d[2] * s1[1], d[2] * s1[0] - d[0] * s1[2], d[0] * s1[1] - d[1] * s1[0]];
      d = norm3([d[0] + (s1[0] * Math.cos(a) + s2[0] * Math.sin(a)) * r, d[1] + (s1[1] * Math.cos(a) + s2[1] * Math.sin(a)) * r, d[2] + (s1[2] * Math.cos(a) + s2[2] * Math.sin(a)) * r]);
    }
    var b = raycastBlocks(o, d, maxD, false), lim = b ? b.t : maxD;
    var v = E.raycastVehicles ? E.raycastVehicles(o, d, lim) : null;
    if (v) lim = v.t;
    var mobs = [], skip = [], t = lim;
    for (var i = 0; i < (pierce || 1); i++) {
      var m = E.raycast(o[0], o[1], o[2], d, lim, skip);
      if (!m) break;
      mobs.push(m.e); skip.push(m.e);
      if (i === 0) t = m.t;
    }
    return { o: o, d: d, block: mobs.length || v ? null : b, mob: mobs[0] || null, mobs: mobs, vehicle: mobs.length ? null : v && v.v, t: mobs.length ? t : lim };
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
        var SW = KC.ATLAS_W, SH = KC.ATLAS_H;
        p.uv = [tl[0] + ou / SW, tl[1] + ov / SH, tl[0] + (ou + 3) / SW, tl[1] + (ov + 3) / SH];
        p.x += (Math.random() - 0.5) * 0.8; p.y += (Math.random() - 0.5) * 0.8; p.z += (Math.random() - 0.5) * 0.8;
        p.vx *= 1.6; p.vz *= 1.6; p.vy = 1 + Math.random() * 3; p.size = 0.05 + Math.random() * 0.05; p.grav = 18;
        break;
      case 'smoke': p.col = [0.55, 0.55, 0.55]; p.grav = -1.5; p.vy = 0.5; p.size = 0.1 + Math.random() * 0.08; p.life = 1; break;
      case 'flame': p.col = [1.4, 0.7, 0.2]; p.grav = -2; p.vx *= 0.2; p.vz *= 0.2; p.vy = 0.4; p.size = 0.06; p.life = 0.4; break;
      case 'heart': p.col = [1.3, 0.25, 0.35]; p.grav = -1; p.vx *= 0.3; p.vz *= 0.3; p.vy = 0.8; p.size = 0.1; p.life = 1; break;
      case 'crit': p.col = [1.3, 1.2, 0.6]; p.vx *= 2.5; p.vz *= 2.5; p.vy = 2 + Math.random() * 2; p.size = 0.05; p.life = 0.5; break;
      case 'splash': p.col = [0.5, 0.7, 1.2]; p.vy = 3; p.size = 0.05; break;
      case 'spark': p.col = [1.5, 1.2, 0.5]; p.vx *= 2; p.vz *= 2; p.vy = 1 + Math.random() * 2; p.size = 0.035; p.life = 0.3; break;
      case 'tracer': p.col = [1.6, 1.4, 0.8]; p.vx = p.vy = p.vz = 0; p.grav = 0; p.size = 0.025; p.life = 0.07; break;
      case 'jet':
        var jd = extra || [0, 0, -1], js = 9 + Math.random() * 3;
        p.vx = jd[0] * js + (Math.random() - 0.5) * 2; p.vy = jd[1] * js + (Math.random() - 0.5) * 2 + 0.5; p.vz = jd[2] * js + (Math.random() - 0.5) * 2;
        p.col = Math.random() < 0.5 ? [1.6, 0.8, 0.2] : [1.7, 1.2, 0.4]; p.grav = -1; p.size = 0.08 + Math.random() * 0.12; p.life = 0.45 + Math.random() * 0.25; break;
      case 'smokeRed':
        var sr = Math.random() * 0.25;
        p.col = [1.05 - sr, 0.22 + sr * 0.3, 0.2]; p.grav = -0.6; p.vx = p.vx * 0.5 + 0.35; p.vz = p.vz * 0.5 + 0.15; p.vy = 1.4 + Math.random();
        p.size = 0.22 + Math.random() * 0.3; p.life = 4 + Math.random() * 2; break;
      case 'smokeDark':
        var sd = Math.random() * 0.15;
        p.col = [0.5 + sd, 0.44 + sd, 0.4 + sd]; p.grav = -0.5; p.vx = p.vx * 0.8 + 0.4; p.vz = p.vz * 0.8 + 0.2; p.vy = 1.2 + Math.random();
        p.size = 0.5 + Math.random() * 0.6; p.life = 6; break;
      case 'portal': p.col = [1.3, 0.9, 1.5]; p.grav = -1.2; p.vx *= 0.4; p.vz *= 0.4; p.vy = 0.3; p.size = 0.05; p.life = 0.9; break;
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
    E.list.forEach(function (v) {
      if (v.dead || v.type !== 'vehicle') return;
      var dv = Math.hypot(v.x - x, v.y + 1 - y, v.z - z);
      if (dv < R + v.V.len / 3) { var im = 1 - Math.min(1, dv / (R + v.V.len / 3)); E.damageVehicle(v, (im * im + im) / 2 * 14 * power); }
    });
    E.list.concat([P.e]).forEach(function (e) {
      if (e.dead || (e.type !== 'mob' && e.type !== 'player' && e.type !== 'item')) return;
      var dx = e.x - x, dy = e.y + e.h / 2 - y, dz = e.z - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > R) return;
      var imp = 1 - d / R, dd = d || 1;
      var kn = [dx / dd * imp * 12, 3 + imp * 6, dz / dd * imp * 12];
      if (e.type === 'item') { e.vx += kn[0]; e.vy += kn[1]; e.vz += kn[2]; return; }
      var dmg = Math.floor((imp * imp + imp) / 2 * 7 * power + 1);
      if (e.type === 'player') { if (P.vehicle) return; P.hurt(dmg * [0.3, 0.6, 1, 1.3][difficulty], 'Взрыв', null, kn); }
      else E.damageMob(e, dmg, 'explosion', kn);
    });
  }

  // ---- Небо --------------------------------------------------------------------------------
  function skyState() {
    var D = KC.DIMS[world ? world.dim : 'over'] || KC.DIMS.over;
    var tod = D.fixedTime !== undefined ? D.fixedTime : timeOfDay;
    var a = tod * Math.PI * 2;
    var sun = norm3([Math.cos(a), Math.sin(a), 0.28]);
    var sunR = norm3([-sun[1], sun[0], 0]);
    var sunU = [sun[1] * sunR[2] - sun[2] * sunR[1], sun[2] * sunR[0] - sun[0] * sunR[2], sun[0] * sunR[1] - sun[1] * sunR[0]];
    var day = D.fixedDay !== undefined ? D.fixedDay : smooth(-0.16, 0.24, sun[1]);
    dayFactor = D.dayLight !== undefined ? D.dayLight : 0.26 + 0.74 * day;
    var top = D.top || mix3([0.012, 0.018, 0.05], [0.33, 0.55, 0.92], day);
    var hor = D.hor || mix3([0.035, 0.05, 0.11], [0.70, 0.82, 0.96], day);
    var dusk = D.top ? 0 : clamp(1 - Math.abs(sun[1]) * 3.4, 0, 1);
    hor = mix3(hor, [0.93, 0.56, 0.34], dusk * 0.5);
    return {
      top: top, hor: hor, sun: sun, sunR: sunR, sunU: sunU,
      glow: D.noSun ? [0, 0, 0] : [dusk * 0.55 + day * 0.12, dusk * 0.3 + day * 0.1, dusk * 0.12 + day * 0.06],
      night: D.stars !== undefined ? D.stars : D.noSun ? 0 : 1 - day, day: dayFactor, raw: day,
      sunVis: D.noSun ? 0 : 1, planet: D.planet ? 1 : 0,
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

    var simulate = placed && (state === 'playing' || state === 'container' || state === 'dead' || state === 'map');
    var e = P.e;
    if (simulate) {
      var inp = state === 'playing' && !sleeping ? input() : { f: 0, s: 0, jump: false, down: false, sprint: false };
      if (!P.dead) {
        if (P.vehicle) driveInput(dt, inp);
        else if (world.isLoaded(e.x, e.z)) P.move(dt, inp);
        P.stats(dt, difficulty);
      }
      if (state === 'playing' && !P.dead) actions(dt);
      tickAcc += dt;
      var n = 0;
      while (tickAcc >= TICK && n < 5) { Sim.tick(); tickAcc -= TICK; n++; }
      if (n === 5) tickAcc = 0;
      E.update(dt);
      if (P.vehicle && !P.vehicle.dead) seatPlayer(P.vehicle);
      zombieTick(dt);
      if (P.swing > 0) { P.swing += dt * 3.2; if (P.swing >= 1) P.swing = 0; }
    }
    if (settings.cycle && (simulate || state === 'title')) timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;
    // рассвет в городе засчитывает пережитую ночь
    if (scenario === 'zombie' && simulate && world.dim === 'over' && lastTod > 0.9 && timeOfDay < 0.1) zombieDawn();
    if (scenario === 'zombie' && simulate && world.dim === 'over' && zombie.heliActive && lastTod < 0.5 && timeOfDay >= 0.5) heliMissed();
    lastTod = timeOfDay;
    // провалился сквозь облака — падает в обычный мир, мягко планируя
    if (simulate && world.dim === 'heaven' && e.y < 2 && !P.dead) {
      goTo('over', 'fall', { x: e.x, y: H - 3, z: e.z, yaw: e.yaw });
      P.feather = 40;
      toast('Вы сорвались с небес… Небесный ветер замедляет падение');
    }
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
    var scope = P.using && P.using.kind === 'aim' ? Math.min(1, P.using.t * 3) : 0;
    if (scope) bowZoom = scope * 46;
    $('scope').style.opacity = scope > 0.6 && view === 0 ? 1 : 0;
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
    var DIM = KC.DIMS[world.dim];

    var driving = !!P.vehicle && state !== 'title';
    var thirdPerson = view !== 0 && state !== 'title' && !driving;
    var ents = E.buildRender(cam, gameTime, thirdPerson && !P.dead ? function (batch) { P.drawBody(batch, E.lightAt(e.x, e.y + 1.4, e.z)); } : null,
      driving && vehCam === 1 ? P.vehicle : null);
    var held = null;
    if (!thirdPerson && !driving && state !== 'title' && placed && !P.dead) held = P.buildHeld(gameTime, E.lightAt(e.x, e.y + 1.4, e.z));
    var hl = null;
    if (state === 'playing' && target && !targetMob) {
      var sb = target.box || [0, 0, 0, 1, 1, 1];
      hl = [target.x + sb[0], target.y + sb[1], target.z + sb[2], target.x + sb[3], target.y + sb[4], target.z + sb[5]];
    }
    renderer.render({
      cam: cam, sky: sky, brightness: settings.bright,
      fog: { color: fogColor, start: inLava ? 0 : under ? 0 : R * (DIM.fogNear || 0.55), end: inLava ? 3 : under ? 16 : R - 4 },
      clouds: DIM.noClouds ? null : { size: Math.max(R * 2, 220), y: DIM.cloudsY || 112, offset: cloudOffset, color: sky.cloud },
      chunks: list, mobs: ents.mobs, items: ents.items, particles: parts,
      crack: buildCrack(), highlight: hl, held: held, underwater: under
    });

    $('water-tint').hidden = !under;
    $('vignette').style.opacity = P.flash > 0 ? Math.min(1, P.flash * 3) : (P.hp <= 4 && !P.creative && state !== 'title' ? 0.35 + Math.sin(gameTime * 4) * 0.1 : 0);
    $('fire-tint').hidden = !(e.fire > 0 && !P.creative && state !== 'title');
    $('portal-tint').style.opacity = P.portalT > 0 && state !== 'title' ? Math.min(0.85, P.portalT / 1.5) : 0;

    if (state === 'title') {
      progressT -= dt;
      if (progressT <= 0) { progressT = 0.25; updateProgress(list.progress); }
    } else {
      UI.renderHud();
      UI.tick();
      if (simulate) { updateNav(dt); updatePlace(dt); }
      updateVehHud(dt);
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
          'Время ' + clockText() + '   ' + (mode === 'creative' ? 'творчество' : 'выживание · ' + DIFF_NAMES[difficulty].toLowerCase()) + (e.fly ? '   полёт' : '') + '\n' +
          'Мир   ' + KC.DIMS[world.dim].name + (worldType === 'city' && world.dim === 'over' ? ' · мегаполис' : '') + (scenario === 'zombie' ? '   день ' + zombie.day : '');
      }
    }
    if (state === 'playing') {
      saveTimer += dt;
      if (saveTimer > 15) { saveTimer = 0; saveGame(); }
      if (mode === 'survival' && !tips.night && sky.raw < 0.3 && placed && world.dim === 'over') {
        tips.night = 1;
        toast(scenario === 'zombie' ? 'Темнеет: заражённых станет гораздо больше. Найдите укрытие' : 'Смеркается: ночью бродят упыри. Сделайте факелы и укрытие');
      }
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
    // за рулём: камера сзади машины (вращается мышью) или из кабины
    var v = P.vehicle;
    if (v && !v.dead) {
      if (vehCam === 1 && v.V.cabin) return cam;
      var piv = [v.x, v.y + v.V.h + 0.9, v.z], dir = lookDir(), bk = [-dir[0], -dir[1] + 0.25, -dir[2]];
      var bl = Math.hypot(bk[0], bk[1], bk[2]); bk = [bk[0] / bl, bk[1] / bl, bk[2] / bl];
      var bh = raycastBlocks(piv, bk, v.V.cam, false), bd = bh ? Math.max(0.5, bh.t - 0.4) : v.V.cam;
      return { x: piv[0] + bk[0] * bd, y: piv[1] + bk[1] * bd, z: piv[2] + bk[2] * bd, yaw: e.yaw, pitch: e.pitch };
    }
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
    if (P.vehicle) {
      if (mouse.lPress || (mouse.l && P.vehicle.V.cannon)) vehicleAction();
      if (mouse.rPress && isTouch) exitVehicle();
      mouse.lPress = false; mouse.rPress = false;
      return;
    }
    if (targetVeh && mouse.rPress) {
      if (!refuelVehicle(targetVeh)) enterVehicle(targetVeh);
      mouse.rPress = false; mouse.r = false;
      return;
    }
    if (targetMob && breaking) {
      P.mining = null;
      if (mouse.lPress || attackT <= 0) { P.attack(targetMob); attackT = 0.45; }
    } else {
      P.mine(dt, target, breaking);
    }
    P.fresh = mouse.rPress;
    if (using) {
      if (mouse.rPress) { P.use(target, targetMob, true); useT = 0.3; P.swing = P.swing || 0.01; }
      else if (!P.using && useT <= 0) { P.use(target, targetMob, true); useT = 0.22; }
      else P.use(target, targetMob, false);
    }
    P.updateUse(dt, using);
    P.fresh = false;
    mouse.lPress = false; mouse.rPress = false;
  }

  // ---- Сохранение ------------------------------------------------------------------------
  function saveGame() {
    if (!world || !placed) return true;
    var e = P.e;
    var dims = {};
    for (var k in dimData) dims[k] = dimData[k];
    dims[world.dim] = snapshotWorld();
    var ok = storageSet(SAVE_KEY, {
      v: 3, seed: world.seed, mode: mode, diff: difficulty, time: timeOfDay, tips: tips,
      scenario: scenario, worldType: worldType, dim: world.dim, dims: dims, lastPos: lastPos, backDim: backDim, zombie: zombie,
      player: { x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, fly: e.fly, hp: P.hp, food: P.food, sat: P.sat, air: P.air, veh: P.vehicle ? 1 : 0,
        inv: P.inv.map(packStack), armor: P.armor.map(packStack), slot: P.slot, spawn: P.spawnPoint }
    });
    if (ok) {
      hasSave = true;
      try { window.localStorage.removeItem(OLD_KEY); window.localStorage.removeItem(V2_KEY); } catch (err) { /* ничего */ }
    }
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
    $('victory').hidden = name !== 'victory';
    $('citymap').hidden = name !== 'map';
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
    // после загрузки — снова за руль той же машины
    if (pendingVeh) {
      pendingVeh = false;
      var best = null, bd = 4;
      E.list.forEach(function (v) { if (v.type === 'vehicle' && !v.dead) { var d = Math.hypot(v.x - P.e.x, v.z - P.e.z); if (d < bd) { bd = d; best = v; } } });
      if (best) enterVehicle(best);
    }
    state = P.dead ? 'dead' : 'playing';
    saveTimer = 0;
    showScreen(P.dead ? 'death' : null);
    UI.forceHud();
    if (!isTouch && state === 'playing') lockPointer();
    if (scenario === 'zombie' && !tips.start) {
      tips.start = 1;
      message('Цель — эвакуация. Сначала найдите рацию в полицейском участке: стрелка вверху покажет дорогу. Припасы — в сундуках домов и магазинов', 9);
    }
    else if (mode === 'survival' && !tips.start) { tips.start = 1; toast('Удерживайте ЛКМ на дереве, чтобы добыть брёвна'); }
    if (world.dim !== 'over') showDimLabel();
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
    var drop = zombie.ev && zombie.ev.drop;
    if (bent && drop && bent.x === drop.x && bent.y === drop.y && bent.z === drop.z) drop.opened = true;
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
  // Возрождение всегда в обычном мире: у кровати или на точке появления
  function backToOverworld() {
    if (world.dim === 'over') return;
    var from = world.dim;
    goTo('over', 'respawn', { x: spawn.x, y: spawn.h + 1, z: spawn.z });
    delete lastPos[from];
    $('fade').classList.remove('is-on');
  }
  function doRespawn() {
    backToOverworld();
    var bed = P.respawn(spawn);
    if (!bed) { placedSaved = false; placePlayer(); }
    state = 'playing';
    showScreen(null);
    UI.forceHud();
    if (!isTouch) lockPointer();
    saveGame();
  }
  function startSleep() {
    if (scenario === 'zombie') { toast('Точка возрождения установлена. Но уснуть не выйдет: город кишит заражёнными'); return; }
    sleeping = 2.2;
    $('sleep').classList.add('is-on');
    toast('Вы засыпаете… Точка возрождения установлена');
  }

  function newWorld(opts) {
    try { [SAVE_KEY, V2_KEY, OLD_KEY].forEach(function (k) { window.localStorage.removeItem(k); }); } catch (e) { /* ничего */ }
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
    var what = scenario === 'zombie' ? 'Зомби-апокалипсис, ' + (zombie.won ? 'эвакуация состоялась' : 'день ' + zombie.day) :
      mode === 'creative' ? 'Творчество' : 'Выживание, ' + DIFF_NAMES[difficulty].toLowerCase();
    $('seed-label').textContent = 'Сид мира: ' + world.seed + ' · ' + what + (world.dim !== 'over' ? ' · ' + KC.DIMS[world.dim].name : '');
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
    document.querySelectorAll('[name="nw-mode"]').forEach(function (r) {
      r.addEventListener('change', function () { $('nw-note').hidden = document.querySelector('[name="nw-mode"]:checked').value !== 'zombie'; });
    });
    $('nw-create').addEventListener('click', function () {
      var m = document.querySelector('[name="nw-mode"]:checked').value;
      var seedTxt = $('nw-seed').value.trim(), seed = 0;
      if (seedTxt) { seed = parseInt(seedTxt, 10); if (!isFinite(seed) || String(seed) !== seedTxt) seed = Math.abs(hashStr(seedTxt)) % 999999 + 1; }
      var zm = m === 'zombie';
      newWorld({ mode: zm ? 'survival' : m, scenario: zm ? 'zombie' : null, diff: Math.max(zm ? 1 : 0, +$('nw-diff').value), seed: seed || 0 });
      $('newworld').hidden = true;
      updateTitle();
      play();
    });
    $('btn-resume').addEventListener('click', resume);
    $('btn-title').addEventListener('click', toTitle);
    $('btn-respawn').addEventListener('click', doRespawn);
    $('btn-death-title').addEventListener('click', function () { backToOverworld(); P.respawn(spawn); placedSaved = false; placed = false; toTitle(); });
    $('btn-map-close').addEventListener('click', closeMap);
    $('btn-victory-go').addEventListener('click', function () { state = 'playing'; showScreen(null); UI.forceHud(); if (!isTouch) lockPointer(); });
    $('btn-victory-title').addEventListener('click', function () { state = 'playing'; toTitle(); });

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
    if (P.using && P.using.kind === 'aim' && P.using.t > 0.3) k *= 0.35;     // в прицеле мышь медленнее
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
      if (state === 'map') { if (code === 'Escape' || code === 'KeyM' || code === 'KeyE') { e.preventDefault(); closeMap(); } return; }
      if (state !== 'playing') return;
      if (/^Digit[1-9]$/.test(code)) { selectSlot(+code.charAt(5) - 1); return; }
      if (code === 'Space' || code.indexOf('Arrow') === 0 || code === 'F3' || code === 'F5') e.preventDefault();
      if (e.repeat) { keys[code] = true; return; }
      var now = performance.now();
      switch (code) {
        case 'KeyE': e.preventDefault(); openContainer('inventory'); return;
        case 'KeyM': if (P.count(I.CITY_MAP) || P.creative) openMap(); else toast('Карты района нет: её можно найти в сундуках или получить от выживших'); return;
        case 'KeyF': if (mode === 'creative') setFly(!P.e.fly); return;
        case 'KeyQ': dropHeld(e.shiftKey); return;
        case 'F5':
          if (P.vehicle) { vehCam = P.vehicle.V.cabin ? 1 - vehCam : 0; return; }
          view = (view + 1) % 3; return;
        case 'ShiftLeft': case 'ShiftRight': if (P.vehicle) { exitVehicle(); return; } break;
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
    holdBtn('t-down', function () { if (P.vehicle) { exitVehicle(); return; } touchDown = true; }, function () { touchDown = false; });
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
    get zombie() { return zombie; }, get scenario() { return scenario; }, goTo: goTo, travel: travel, zombieDawn: zombieDawn,
    evac: function () { return evacInfo(); }, enterVehicle: enterVehicle, exitVehicle: exitVehicle, get vehicle() { return P.vehicle; }, refuel: refuelVehicle, openMap: openMap, carHit: carHit, events: { airdrop: airdrop, survivor: survivorEvent, fire: fireEvent }, get heli() { return heli; },
    P: P, play: play, pause: pause, setTime: function (t) { timeOfDay = t; lastTod = t; }, save: saveGame,
    open: openContainer, close: closeContainer, setMode: function (m) { mode = m; P.setCreative(m === 'creative'); }
  };

  var hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') { try { hot.snapshot(function () { saveGame(); return {}; }); } catch (e) { /* необязательно */ } }
  if (hot && typeof hot.ready === 'function') hot.ready(function () { boot(); });
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.KC = window.KC || {});
