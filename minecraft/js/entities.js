/* Кубокрафт — сущности: общая физика (коробки коллизий, ступеньки, жидкости),
   выпавшие предметы, мобы и их поведение, стрелы, подожжённый динамит, падающий песок,
   появление мобов и сохранение. */
(function (KC) {
  'use strict';

  var B = KC.B, I = KC.I, M = KC.Models;
  var world = null, hooks = {};
  var list = [];
  var nextId = 1;

  // ---- Виды мобов ---------------------------------------------------------------
  function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  var KINDS = {
    pig: { name: 'Свинья', model: 'pig', hp: 10, w: 0.9, h: 0.9, eye: 0.75, speed: 1.3, panic: 2.6, food: [I.WHEAT_ITEM], passive: true,
      drops: function (e) { return [[e.fire > 0 ? I.PORK_COOKED : I.PORK_RAW, rint(1, 3)]]; } },
    cow: { name: 'Бурёнка', model: 'cow', hp: 10, w: 0.9, h: 1.4, eye: 1.25, speed: 1.1, panic: 2.3, food: [I.WHEAT_ITEM], passive: true,
      drops: function (e) { return [[e.fire > 0 ? I.BEEF_COOKED : I.BEEF_RAW, rint(1, 3)], [I.LEATHER, rint(0, 2)]]; } },
    sheep: { name: 'Овца', model: 'sheep', hp: 8, w: 0.9, h: 1.3, eye: 1.1, speed: 1.1, panic: 2.3, food: [I.WHEAT_ITEM], passive: true,
      drops: function (e) { var d = [[e.fire > 0 ? I.MUTTON_COOKED : I.MUTTON_RAW, rint(1, 2)]]; if (!e.sheared) d.push([B.WOOL_WHITE, 1]); return d; } },
    chicken: { name: 'Курица', model: 'chicken', hp: 4, w: 0.45, h: 0.7, eye: 0.6, speed: 1.0, panic: 2.2, food: [I.SEEDS], passive: true, slowFall: true,
      drops: function (e) { return [[e.fire > 0 ? I.CHICKEN_COOKED : I.CHICKEN_RAW, 1], [I.FEATHER, rint(0, 2)]]; } },
    upyr: { name: 'Упырь', model: 'upyr', hp: 20, w: 0.6, h: 1.95, eye: 1.7, speed: 2.3, dmg: 3, hostile: true, burns: true,
      drops: function () { var d = [[I.ROTTEN_FLESH, rint(0, 2)]]; if (Math.random() < 0.025) d.push([I.IRON_INGOT, 1]); return d; } },
    archer: { name: 'Костяной лучник', model: 'archer', hp: 20, w: 0.6, h: 1.95, eye: 1.7, speed: 2.1, dmg: 3, hostile: true, burns: true, ranged: true,
      drops: function () { return [[I.BONE, rint(0, 2)], [I.ARROW, rint(0, 2)]]; } },
    spider: { name: 'Лесной паук', model: 'spider', hp: 16, w: 1.3, h: 0.9, eye: 0.6, speed: 3.0, dmg: 2, hostile: true, climbs: true, neutralDay: true,
      drops: function () { var d = [[I.STRING, rint(0, 2)]]; if (Math.random() < 0.33) d.push([I.SPIDER_EYE, 1]); return d; } },
    // Мегаполис: заражённые (не горят на солнце, зовут друг друга, видят дальше)
    infected: { name: 'Заражённый', model: 'infected', hp: 20, w: 0.6, h: 1.95, eye: 1.7, speed: 2.0, dmg: 3, hostile: true, zombie: true,
      drops: function () { var d = [[I.ROTTEN_FLESH, rint(0, 2)]]; if (Math.random() < 0.12) d.push([I.CANNED_FOOD, 1]); if (Math.random() < 0.1) d.push([I.AMMO, rint(2, 5)]); return d; } },
    runner: { name: 'Бегун', model: 'runner', hp: 14, w: 0.6, h: 1.95, eye: 1.7, speed: 4.1, dmg: 2, hostile: true, zombie: true, lightShy: true,
      drops: function () { var d = [[I.ROTTEN_FLESH, rint(0, 1)]]; if (Math.random() < 0.15) d.push([I.AMMO, rint(2, 6)]); return d; } },
    brute: { name: 'Громила', model: 'brute', hp: 44, w: 0.85, h: 2.6, eye: 2.3, speed: 1.6, dmg: 7, knock: 11, scale: 1.35, hostile: true, zombie: true, breaker: 3,
      drops: function () { var d = [[I.ROTTEN_FLESH, rint(1, 3)], [I.IRON_INGOT, rint(0, 1)]]; if (Math.random() < 0.3) d.push([I.MEDKIT, 1]); return d; } },
    // особые места мегаполиса
    patient: { name: 'Пациент', model: 'patient', hp: 16, w: 0.6, h: 1.95, eye: 1.7, speed: 1.8, dmg: 3, hostile: true, zombie: true,
      drops: function () { var d = [[I.ROTTEN_FLESH, rint(0, 1)]]; if (Math.random() < 0.3) d.push([I.BANDAGE, rint(1, 2)]); if (Math.random() < 0.06) d.push([I.MEDKIT, 1]); return d; } },
    cop: { name: 'Заражённый полицейский', model: 'cop', hp: 26, w: 0.6, h: 1.95, eye: 1.7, speed: 2.1, dmg: 4, hostile: true, zombie: true, bulletproof: 0.6,
      drops: function () { var d = [[I.ROTTEN_FLESH, rint(0, 1)], [I.AMMO, rint(1, 5)]]; if (Math.random() < 0.05) d.push([I.BODY_ARMOR, 1]); return d; } },
    soldier: { name: 'Заражённый военный', model: 'soldier', hp: 30, w: 0.6, h: 1.95, eye: 1.7, speed: 2.2, dmg: 4, hostile: true, zombie: true, bulletproof: 0.4,
      drops: function () { var d = [[I.ROTTEN_FLESH, rint(0, 1)], [I.RIFLE_AMMO, rint(2, 8)]]; if (Math.random() < 0.15) d.push([I.GRENADE, 1]); if (Math.random() < 0.04) d.push([I.RIFLE, 1]); return d; } },
    blind: { name: 'Слепой', model: 'blind', hp: 22, w: 0.6, h: 1.95, eye: 1.7, speed: 3.6, dmg: 4, hostile: true, zombie: true, blind: true,
      drops: function () { var d = [[I.ROTTEN_FLESH, rint(1, 2)]]; if (Math.random() < 0.25) d.push([B.TORCH, rint(1, 3)]); return d; } },
    survivor: { name: 'Выживший', model: 'survivor', hp: 20, w: 0.6, h: 1.8, eye: 1.62, speed: 0, panic: 0, food: [], passive: true, npc: true,
      drops: function () { return []; } },
    heli: { name: 'Вертолёт', model: 'helicopter', hp: 1000, w: 3.5, h: 3.5, eye: 1, speed: 0, panic: 0, food: [], passive: true, npc: true, vehicle: true, scale: 2,
      drops: function () { return []; } },
    // Пекло
    imp: { name: 'Бес', model: 'imp', hp: 14, w: 0.5, h: 1.5, eye: 1.2, speed: 3.2, dmg: 3, hostile: true, fireImmune: true, ignite: 4,
      drops: function () { var d = [[I.SULFUR, rint(0, 2)]]; if (Math.random() < 0.2) d.push([I.BLOOD_CRYSTAL, 1]); return d; } },
    wisp: { name: 'Огненный дух', model: 'wisp', hp: 12, w: 0.7, h: 0.8, eye: 0.4, speed: 3.0, dmg: 5, hostile: true, fireImmune: true,
      flies: true, hover: [3, 8], ranged: 'fireball', keep: 8, cd: 2.4, glow: true,
      drops: function () { return [[I.SULFUR, rint(1, 2)], [I.GUNPOWDER, rint(0, 1)]]; } },
    // Небеса
    pegasus: { name: 'Пегас', model: 'pegasus', hp: 16, w: 1.2, h: 2.0, eye: 1.9, speed: 1.8, panic: 4.2, food: [I.APPLE, I.GOLDEN_APPLE], passive: true, slowFall: true,
      drops: function () { return [[I.FEATHER, rint(1, 3)], [I.LEATHER, rint(0, 1)]]; } },
    cloudling: { name: 'Облачник', model: 'cloudling', hp: 6, w: 0.8, h: 0.75, eye: 0.5, speed: 1.6, panic: 3.5, food: [I.SKY_SHARD], passive: true,
      flies: true, hover: [2, 6],
      drops: function () { return [[B.CLOUD, rint(1, 2)]]; } },
    // Космическая станция
    drone: { name: 'Сбойный дрон', model: 'drone', hp: 16, w: 0.8, h: 0.65, eye: 0.35, speed: 3.6, dmg: 4, hostile: true, fireImmune: true, machine: true,
      flies: true, hover: [2, 6], ranged: 'laser', keep: 9, cd: 1.7,
      drops: function () { var d = [[I.SPARK_DUST, rint(1, 3)]]; if (Math.random() < 0.4) d.push([I.METEOR_IRON, 1]); return d; } },
    robot: { name: 'Робот-уборщик', model: 'robot', hp: 12, w: 0.65, h: 0.85, eye: 0.7, speed: 1.0, panic: 2.2, food: [], passive: true, fireImmune: true, machine: true,
      drops: function () { return [[I.IRON_INGOT, rint(1, 2)], [I.SPARK_DUST, rint(0, 2)]]; } }
  };

  // ---- Базовая сущность --------------------------------------------------------
  function Ent(type, x, y, z, w, h) {
    this.id = nextId++;
    this.type = type;
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.w = w; this.h = h;
    this.yaw = Math.random() * Math.PI * 2;
    this.onGround = false; this.hitH = false;
    this.inWater = false; this.inLava = false; this.onLadder = false;
    this.fire = 0; this.fireT = 0;
    this.fallDist = 0;
    this.age = 0;
    this.dead = false;
    this.step = 0;
    this.lightT = 0; this.light = [1, 1, 1];
  }

  // ---- Коллизии --------------------------------------------------------------------
  var boxes = [];
  function gather(x0, y0, z0, x1, y1, z1) {
    boxes.length = 0;
    var ax = Math.floor(x0), bx = Math.floor(x1), ay = Math.floor(y0) - 1, by = Math.floor(y1), az = Math.floor(z0), bz = Math.floor(z1);
    for (var x = ax; x <= bx; x++) for (var z = az; z <= bz; z++) {
      if (!world.isLoaded(x, z)) { boxes.push([x, -64, z, x + 1, 512, z + 1]); continue; }
      for (var y = ay; y <= by; y++) world.collide(x, y, z, boxes);
    }
  }
  function clipAxis(bb, a, d) {
    var o1 = (a + 1) % 3, o2 = (a + 2) % 3, E = 1e-7;
    for (var i = 0; i < boxes.length; i++) {
      var c = boxes[i];
      if (bb[o1 + 3] <= c[o1] + E || bb[o1] >= c[o1 + 3] - E) continue;
      if (bb[o2 + 3] <= c[o2] + E || bb[o2] >= c[o2 + 3] - E) continue;
      if (d > 0 && bb[a + 3] <= c[a] + E) { if (c[a] - bb[a + 3] < d) d = c[a] - bb[a + 3]; }
      else if (d < 0 && bb[a] >= c[a + 3] - E) { if (c[a + 3] - bb[a] > d) d = c[a + 3] - bb[a]; }
    }
    return d;
  }
  function boxOf(e) { var hw = e.w / 2; return [e.x - hw, e.y, e.z - hw, e.x + hw, e.y + e.h, e.z + hw]; }

  // Двигает сущность с учётом коллизий; возвращает фактическое смещение
  function moveRaw(e, dx, dy, dz) {
    var bb = boxOf(e);
    gather(Math.min(bb[0], bb[0] + dx), Math.min(bb[1], bb[1] + dy), Math.min(bb[2], bb[2] + dz),
      Math.max(bb[3], bb[3] + dx), Math.max(bb[4], bb[4] + dy), Math.max(bb[5], bb[5] + dz));
    dy = clipAxis(bb, 1, dy); bb[1] += dy; bb[4] += dy;
    dx = clipAxis(bb, 0, dx); bb[0] += dx; bb[3] += dx;
    dz = clipAxis(bb, 2, dz); bb[2] += dz; bb[5] += dz;
    e.x = (bb[0] + bb[3]) / 2; e.y = bb[1]; e.z = (bb[2] + bb[5]) / 2;
    return [dx, dy, dz];
  }

  function move(e, dx, dy, dz) {
    var sx = e.x, sy = e.y, sz = e.z, wasGround = e.onGround;
    var r = moveRaw(e, dx, dy, dz);
    var hitX = Math.abs(r[0] - dx) > 1e-9, hitZ = Math.abs(r[2] - dz) > 1e-9, hitY = Math.abs(r[1] - dy) > 1e-9;
    // Ступенька: зашагнуть на кровать, плиту и т. п. без прыжка
    if (e.step > 0 && (hitX || hitZ) && (wasGround || (hitY && dy < 0))) {
      var ax = e.x, ay = e.y, az = e.z;
      e.x = sx; e.y = sy; e.z = sz;
      var up = moveRaw(e, 0, e.step, 0);
      var hr = moveRaw(e, dx, 0, dz);
      var down = moveRaw(e, 0, -up[1] - Math.max(0, -dy), 0);
      if (hr[0] * hr[0] + hr[2] * hr[2] > r[0] * r[0] + r[2] * r[2] + 1e-6) {
        r = [hr[0], up[1] + down[1], hr[2]];
        hitX = Math.abs(hr[0] - dx) > 1e-9; hitZ = Math.abs(hr[2] - dz) > 1e-9; hitY = true;
      } else { e.x = ax; e.y = ay; e.z = az; }
    }
    if (hitX) e.vx = 0;
    if (hitZ) e.vz = 0;
    e.hitH = hitX || hitZ;
    e.onGround = hitY && dy < 0;
    if (hitY) e.vy = 0;
    return r;
  }

  function boxHits(x, y, z, w, h) {
    var hw = w / 2;
    gather(x - hw, y, z - hw, x + hw, y + h, z + hw);
    var bb = [x - hw, y, z - hw, x + hw, y + h, z + hw];
    for (var i = 0; i < boxes.length; i++) {
      var c = boxes[i];
      if (bb[0] < c[3] && bb[3] > c[0] && bb[1] < c[4] && bb[4] > c[1] && bb[2] < c[5] && bb[5] > c[2]) return true;
    }
    return false;
  }

  function senseLiquids(e) {
    var w1 = world.getBlock(e.x, e.y + 0.2, e.z), w2 = world.getBlock(e.x, e.y + e.h * 0.6, e.z);
    e.inWater = w1 === B.WATER || w2 === B.WATER;
    e.inLava = w1 === B.LAVA || w2 === B.LAVA;
    var lb0 = KC.BLOCKS[world.getBlock(e.x, e.y, e.z)], lb1 = KC.BLOCKS[world.getBlock(e.x, e.y + 1, e.z)];
    e.onLadder = !!((lb0 && lb0.climb) || (lb1 && lb1.climb));
  }

  // Шаг физики с гравитацией; ctrl — желаемая горизонтальная скорость
  // Сила тяжести измерения; внутри станции — искусственная, как на Земле
  function gravityAt(x, y, z) {
    var D = KC.DIMS && world && KC.DIMS[world.dim];
    if (!D) return 1;
    if (D.vacuum && KC.Gen.inStation(x, y, z)) return 1;
    return D.gravity;
  }

  function physics(e, dt, opts) {
    opts = opts || {};
    senseLiquids(e);
    var g = (opts.gravity === undefined ? 28 : opts.gravity) * (opts.gravity === 0 ? 1 : gravityAt(e.x, e.y + 0.5, e.z));
    if (e.inWater || e.inLava) {
      e.vy -= g * 0.3 * dt;
      e.vy *= Math.max(0, 1 - dt * 2.5);
      e.vx *= Math.max(0, 1 - dt * 3); e.vz *= Math.max(0, 1 - dt * 3);
      if (opts.float) e.vy += 18 * dt;
    } else if (e.onLadder && opts.climb !== false) {
      e.vy = Math.max(e.vy - g * dt, -2.4);
    } else {
      e.vy = Math.max(e.vy - g * dt, opts.slowFall ? -2.5 : -55);
    }
    if (opts.friction) {
      var fr = e.onGround ? opts.friction : opts.friction * 0.15;
      var k = Math.max(0, 1 - dt * fr);
      e.vx *= k; e.vz *= k;
    }
    var maxV = Math.max(Math.abs(e.vx), Math.abs(e.vy), Math.abs(e.vz));
    var steps = Math.max(1, Math.ceil(maxV * dt / 0.45)), sdt = dt / steps, landed = false, hitH = false;
    for (var s = 0; s < steps; s++) {
      var before = e.y;
      move(e, e.vx * sdt, e.vy * sdt, e.vz * sdt);
      if (e.hitH) hitH = true;
      var dy = e.y - before;
      if (e.onGround) { landed = true; }
      else if (dy < 0) e.fallDist -= dy;
    }
    e.hitH = hitH;
    if (e.inWater || e.onLadder) e.fallDist = 0;
    if (landed) {
      if (e.fallDist > 0 && opts.onLand) opts.onLand(e.fallDist);
      e.fallDist = 0;
    }
    e.onGround = landed;
  }

  // ---- Свет в точке для раскраски сущностей ---------------------------------------
  // Рассеянный свет в точке: небесный эмбиент (по открытости неба) и факелы — как в шейдере блоков.
  // Прямое солнце добавляет модель по нормалям граней с долей sunVis.
  function lightAt(x, y, z) {
    var Lg = KC.Light, sky = world.skyAt(x, y, z), s = Lg.skyDep ? sky * sky : 1;
    var bl = Math.pow(world.blockLightAt(x, y, z) / 15, 1.45);
    var out = [0, 0, 0], lum = 0, i;
    for (i = 0; i < 3; i++) { out[i] = (Lg.ambTop[i] * 0.6 + Lg.ambBot[i] * 0.4) * s + Lg.ambCave[i]; }
    lum = out[0] * 0.3 + out[1] * 0.5 + out[2] * 0.2;
    var k = 1 - Math.min(1, lum) * 0.55;
    for (i = 0; i < 3; i++) out[i] += Lg.blockCol[i] * bl * k;
    return out;
  }
  // Видно ли светило из точки: луч по вокселям в сторону солнца (или луны); листва пропускает часть света
  function sunVis(x, y, z) {
    var Lg = KC.Light, d = Lg.shadowDir || Lg.sunDir, sc = Lg.sunCol;
    if (sc[0] + sc[1] + sc[2] < 0.01 || d[1] <= 0.02) return 0;
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    var sx = d[0] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
    var tdx = d[0] ? Math.abs(1 / d[0]) : 1e9, tdy = Math.abs(1 / d[1]), tdz = d[2] ? Math.abs(1 / d[2]) : 1e9;
    var tx = d[0] > 0 ? (ix + 1 - x) * tdx : (x - ix) * tdx;
    var ty = (iy + 1 - y) * tdy;
    var tz = d[2] > 0 ? (iz + 1 - z) * tdz : (z - iz) * tdz;
    var vis = 1, H = KC.H;
    for (var i = 0; i < 200; i++) {
      if (tx < ty && tx < tz) { ix += sx; tx += tdx; } else if (ty < tz) { iy++; ty += tdy; } else { iz += sz; tz += tdz; }
      if (iy >= H) return vis;
      var id = world.getBlock(ix, iy, iz);
      if (!id) continue;
      if (KC.OPAQUE[id]) return 0;
      if (KC.BLOCKS[id].leaves) { vis *= 0.55; if (vis < 0.15) return 0; }
    }
    return vis;
  }
  function refreshLight(e, dt) {
    e.lightT -= dt;
    if (e.lightT <= 0) {
      e.lightT = 0.4 + Math.random() * 0.2;
      e.light = lightAt(e.x, e.y + e.h * 0.7, e.z);
      e.sunK = sunVis(e.x, e.y + e.h * 0.7, e.z);
    }
    return e.light;
  }

  // ---- Предметы на земле ---------------------------------------------------------
  function dropItem(x, y, z, stack, vel) {
    if (!stack || !stack.n) return null;
    var e = new Ent('item', x, y, z, 0.25, 0.25);
    e.stack = { id: stack.id, n: stack.n, d: stack.d || 0 };
    e.pickup = 0.6;
    e.vx = vel ? vel[0] : (Math.random() - 0.5) * 2.5;
    e.vy = vel ? vel[1] : 3 + Math.random() * 1.5;
    e.vz = vel ? vel[2] : (Math.random() - 0.5) * 2.5;
    e.spin = Math.random() * 6;
    list.push(e);
    return e;
  }
  function dropDrops(x, y, z, drops) {
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      if (d[1] > 0) dropItem(x, y, z, { id: d[0], n: d[1], d: d[2] || 0 });
    }
  }

  function updateItem(e, dt) {
    e.pickup -= dt;
    physics(e, dt, { gravity: 18, friction: 6, float: true });
    if (e.inLava) { e.dead = true; if (hooks.particles) hooks.particles('smoke', e.x, e.y, e.z); return; }
    if (e.age > 300) { e.dead = true; return; }
    var p = hooks.player && hooks.player();
    if (p && !p.dead && e.pickup <= 0) {
      var dx = p.x - e.x, dy = (p.y + 0.9) - e.y, dz = p.z - e.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1.8 * 1.8) {
        var left = hooks.give(e.stack);
        if (left < e.stack.n && hooks.sound) hooks.sound('pickup', e.x, e.y, e.z);
        e.stack.n = left;
        if (!left) { e.dead = true; return; }
      } else if (d2 < 3.2 * 3.2) {
        var dd = Math.sqrt(d2);
        e.vx += dx / dd * 14 * dt; e.vy += dy / dd * 14 * dt; e.vz += dz / dd * 14 * dt;
      }
    }
    // слияние одинаковых стопок поблизости
    if ((e.age * 2 | 0) !== ((e.age - dt) * 2 | 0)) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o === e || o.dead || o.type !== 'item' || o.stack.id !== e.stack.id || o.stack.d || e.stack.d) continue;
        if (Math.abs(o.x - e.x) > 1 || Math.abs(o.y - e.y) > 0.6 || Math.abs(o.z - e.z) > 1) continue;
        var max = KC.maxStack(e.stack.id);
        if (e.stack.n + o.stack.n > max) continue;
        e.stack.n += o.stack.n; o.dead = true;
      }
    }
  }

  // ---- Мобы -----------------------------------------------------------------------
  function spawnMob(kind, x, y, z, opts) {
    var K = KINDS[kind];
    if (!K) return null;
    var e = new Ent('mob', x, y, z, K.w, K.h);
    e.kind = kind; e.K = K;
    e.hp = K.hp; e.step = 0.6;
    e.ai = { state: 'idle', timer: Math.random() * 3, tx: x, tz: z, los: false, losT: 0, shootCd: 1 + Math.random(), stuck: 0 };
    e.walk = 0; e.walkAmp = 0; e.headYaw = 0; e.headPitch = 0;
    e.hurt = 0; e.invul = 0; e.attackCd = 0; e.attackAnim = 0; e.panic = 0;
    e.love = 0; e.breedCd = 0; e.grow = 0; e.sheared = false; e.deathT = 0; e.provoked = 0;
    e.soundT = 5 + Math.random() * 10;
    e.homeY = y;
    if (opts) { if (opts.baby) e.grow = 240; if (opts.sheared) e.sheared = true; if (opts.hp) e.hp = opts.hp; if (opts.yaw !== undefined) e.yaw = opts.yaw; }
    if (e.grow > 0) { e.w = K.w * 0.55; e.h = K.h * 0.55; }
    list.push(e);
    return e;
  }

  function diffMul() { var d = hooks.difficulty ? hooks.difficulty() : 2; return [0, 0.5, 1, 1.5][d]; }

  // bullet — пули и дробь бьют без паузы неуязвимости, иначе очередь теряла бы попадания
  function damageMob(e, amount, source, knock, bullet) {
    if (e.dead || e.deathT > 0 || (e.invul > 0 && !bullet) || e.K.npc) return false;
    if (e.K.fireImmune && source === 'fire') { e.fire = 0; return false; }
    e.hp -= amount;
    e.hurt = 0.35;
    e.invul = 0.45;
    if (knock) { e.vx += knock[0]; e.vz += knock[2]; e.vy = Math.max(e.vy, knock[1]); }
    if (e.K.passive) { e.panic = 4; e.ai.state = 'panic'; e.love = 0; }
    if (source === 'player') { e.provoked = 20; if (e.K.zombie) alertHorde(e, 14); }
    if (hooks.sound) hooks.sound('hurt-' + e.kind, e.x, e.y, e.z);
    if (e.hp <= 0) {
      e.deathT = 0.8;
      if (hooks.killed) hooks.killed(e, source);
      e.vx *= 0.3; e.vz *= 0.3;
      dropDrops(e.x, e.y + 0.4, e.z, e.K.drops(e));
    }
    return true;
  }

  function faceTo(e, tx, tz, dt, rate) {
    var want = Math.atan2(-(tx - e.x), -(tz - e.z));
    var d = want - e.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    e.yaw += d * Math.min(1, dt * (rate || 6));
  }

  function steer(e, tx, tz, speed, dt) {
    var dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
    if (d < 0.2) { brake(e, dt); return d; }
    var k = Math.min(1, dt * (e.onGround ? 10 : 2));
    e.vx += (dx / d * speed - e.vx) * k;
    e.vz += (dz / d * speed - e.vz) * k;
    faceTo(e, tx, tz, dt);
    if (e.hitH) {
      if (e.K.climbs) e.vy = 3.4;
      else if (e.onGround && !boxHits(e.x + dx / d * 0.6, e.y + 1.1, e.z + dz / d * 0.6, e.w, e.h)) e.vy = 8.2;
      else if (e.inWater) e.vy = 4;
    }
    if (e.inWater) e.vy = Math.max(e.vy, 1.5);
    return d;
  }
  function brake(e, dt) { var k = Math.min(1, dt * 8); e.vx -= e.vx * k; e.vz -= e.vz * k; }

  // Есть ли опора впереди: мирные мобы не прыгают с обрывов
  function groundAhead(e, dirx, dirz) {
    var x = e.x + dirx * 0.9, z = e.z + dirz * 0.9;
    for (var dy = 0; dy <= 3; dy++) {
      var id = world.getBlock(x, e.y - 0.5 - dy, z);
      if (KC.SOLID[id]) return true;
      if (id === B.LAVA) return false;
    }
    return false;
  }

  function lineOfSight(x0, y0, z0, x1, y1, z1) {
    var dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var n = Math.ceil(d * 3);
    for (var i = 1; i < n; i++) {
      var t = i / n;
      if (KC.OPAQUE[world.getBlock(x0 + dx * t, y0 + dy * t, z0 + dz * t)]) return false;
    }
    return true;
  }

  function wander(e, dt, speed) {
    var a = e.ai;
    a.timer -= dt;
    if (a.state === 'wander') {
      var dx = a.tx - e.x, dz = a.tz - e.z, d = Math.hypot(dx, dz);
      if (d < 0.6 || a.timer <= 0 || (e.K.passive && !groundAhead(e, dx / (d || 1), dz / (d || 1)))) { a.state = 'idle'; a.timer = 2 + Math.random() * 5; }
      else steer(e, a.tx, a.tz, speed, dt);
    } else {
      brake(e, dt);
      if (a.timer <= 0) {
        var ang = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6;
        a.tx = e.x + Math.cos(ang) * r; a.tz = e.z + Math.sin(ang) * r;
        a.state = 'wander'; a.timer = 6;
        if (!world.isLoaded(a.tx, a.tz)) a.state = 'idle';
      }
    }
  }

  function updatePassive(e, dt) {
    var K = e.K, a = e.ai, p = hooks.player && hooks.player();
    var held = hooks.heldId ? hooks.heldId() : 0;
    e.breedCd -= dt;
    if (e.grow > 0) { e.grow -= dt; if (e.grow <= 0) { e.w = K.w; e.h = K.h; } }
    if (e.panic > 0) {
      e.panic -= dt;
      if (a.timer <= 0 || a.state !== 'panic') {
        var ang = Math.random() * Math.PI * 2;
        a.tx = e.x + Math.cos(ang) * 8; a.tz = e.z + Math.sin(ang) * 8; a.timer = 1.2; a.state = 'panic';
      }
      a.timer -= dt;
      steer(e, a.tx, a.tz, K.panic, dt);
      if (e.panic <= 0) a.state = 'idle';
      return;
    }
    if (e.love > 0) {
      e.love -= dt;
      if (hooks.particles && Math.random() < dt * 2) hooks.particles('heart', e.x, e.y + e.h + 0.2, e.z);
      var mate = null, best = 64;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o === e || o.type !== 'mob' || o.kind !== e.kind || o.love <= 0 || o.grow > 0 || o.deathT > 0) continue;
        var d2 = (o.x - e.x) * (o.x - e.x) + (o.z - e.z) * (o.z - e.z);
        if (d2 < best) { best = d2; mate = o; }
      }
      if (mate) {
        if (best < 1.6 * 1.6) {
          e.love = 0; mate.love = 0; e.breedCd = 60; mate.breedCd = 60;
          spawnMob(e.kind, (e.x + mate.x) / 2, e.y + 0.1, (e.z + mate.z) / 2, { baby: true });
          if (hooks.particles) for (var h = 0; h < 5; h++) hooks.particles('heart', e.x, e.y + e.h, e.z);
        } else steer(e, mate.x, mate.z, K.speed, dt);
        return;
      }
    }
    if (p && !p.dead && K.food.indexOf(held) >= 0) {
      var dp = Math.hypot(p.x - e.x, p.z - e.z);
      if (dp < 8) {
        if (dp > 2) steer(e, p.x, p.z, K.speed, dt); else { brake(e, dt); faceTo(e, p.x, p.z, dt); }
        return;
      }
    }
    // Овца щиплет траву и отращивает шерсть
    if (e.kind === 'sheep' && e.sheared && Math.random() < dt * 0.02) {
      var below = world.getBlock(e.x, e.y - 0.5, e.z);
      if (below === B.GRASS) { world.setBlock(Math.floor(e.x), Math.floor(e.y - 0.5), Math.floor(e.z), B.DIRT, 0); e.sheared = false; }
    }
    wander(e, dt, K.speed);
  }

  // Поиск цели: игрок в радиусе, в прямой видимости (память на 6 с).
  // Слепые не видят — они слышат шаги: бег слышно далеко, крадущегося почти нет.
  function acquire(e, dt) {
    var K = e.K, a = e.ai, p = hooks.player && hooks.player();
    if (!p || p.dead || p.creative || (hooks.difficulty ? hooks.difficulty() : 2) === 0) return null;
    var range = K.zombie ? 30 : 20;
    var dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > range) return null;
    if (K.neutralDay) {
      var l = e.light ? Math.max(e.light[0], e.light[1]) : 0;
      if (e.provoked <= 0 && l >= 0.45) return null;
    }
    if (K.blind) {
      var hear = [1.8, 7, 14][p.loud || 0];
      if (d < hear || e.provoked > 0) a.memory = 3;
      a.memory = (a.memory || 0) - dt;
      a.los = d < 16;
      return a.memory > 0 ? p : null;
    }
    a.losT -= dt;
    if (a.losT <= 0) {
      a.losT = 0.4;
      a.los = lineOfSight(e.x, e.y + K.eye, e.z, p.x, p.y + 1.6, p.z);
      if (a.los) { if (K.zombie && !(a.memory > 0)) alertHorde(e, 12); a.memory = K.zombie ? 10 : 6; }
    }
    // топот бегущего игрока заражённые слышат и без прямой видимости
    if (K.zombie && !(a.memory > 0) && (p.loud || 0) === 2 && d < 10) hearAt(e, p.x, p.y, p.z, 6);
    a.memory = (a.memory || 0) - dt;
    return a.memory > 0 ? p : null;
  }

  // Заражённый, заметивший игрока, зовёт соседей
  function alertHorde(e, r) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === e || o.dead || o.type !== 'mob' || !o.K.zombie) continue;
      if (Math.abs(o.x - e.x) < r && Math.abs(o.z - e.z) < r && !(o.ai.memory > 0)) o.ai.memory = 8;
    }
    if (hooks.sound && e.K.zombie) hooks.sound('say-' + e.kind, e.x, e.y, e.z);
  }

  // ---- Шум: заражённые идут на звук ---------------------------------------------------
  function hearAt(e, x, y, z, t) {
    var h = e.ai.heard;
    if (h && h.t > 0 && Math.hypot(h.x - e.x, h.z - e.z) < Math.hypot(x - e.x, z - e.z) - 4) return;
    e.ai.heard = { x: x, y: y, z: z, t: t || 14 };
  }
  // Громкий звук в точке: все заражённые в радиусе r идут проверить
  function noise(x, y, z, r) {
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.type !== 'mob' || !e.K.zombie || e.deathT > 0) continue;
      var dd = Math.hypot(e.x - x, (e.y - y) * 2, e.z - z);
      if (dd > r) continue;
      hearAt(e, x + (Math.random() - 0.5) * 3, y, z + (Math.random() - 0.5) * 3, 10 + Math.random() * 8);
      n++;
    }
    return n;
  }

  function meleeHit(e, target) {
    var K = e.K;
    e.attackCd = e.kind === 'brute' ? 1.6 : 1;
    e.attackAnim = 0.45;
    var knock = null;
    if (K.knock) {
      var dx = target.x - e.x, dz = target.z - e.z, d = Math.hypot(dx, dz) || 1;
      knock = [dx / d * K.knock, 6, dz / d * K.knock];
    }
    hooks.hurtPlayer(K.dmg * diffMul(), K.name, e, knock, K.ignite || 0);
  }

  // ---- Осада: заражённые ломают двери, окна и баррикады на пути ------------------------
  var siege = new Map();          // "x,y,z" → накопленные секунды ударов
  function siegeBlock(e, dx, dz, dt) {
    var fx = Math.floor(e.x + dx * (e.w / 2 + 0.45)), fz = Math.floor(e.z + dz * (e.w / 2 + 0.45));
    var y0 = Math.floor(e.y + 0.1);
    for (var yy = y0; yy <= y0 + 1; yy++) {
      var id = world.getBlock(fx, yy, fz), bd = KC.BLOCKS[id];
      if (!bd || !bd.siege) continue;
      var k = fx + ',' + yy + ',' + fz, cur = (siege.get(k) || 0) + dt * (e.K.breaker || 1);
      e.attackAnim = Math.max(e.attackAnim, 0.3);
      e.breakT = (e.breakT || 0) - dt;
      if (e.breakT <= 0) {
        e.breakT = 0.7;
        if (hooks.sound) hooks.sound('siege-hit', fx + 0.5, yy + 0.5, fz + 0.5);
        if (hooks.particles) for (var q = 0; q < 3; q++) hooks.particles('block', fx + 0.5, yy + 0.5, fz + 0.5, id);
        noise(fx + 0.5, yy, fz + 0.5, 12);
      }
      if (cur >= bd.siege) {
        siege.delete(k);
        KC.Sim.breakBlock(fx, yy, fz, false);
        if (hooks.sound) hooks.sound('break:' + (bd.mat || 'wood'), fx + 0.5, yy + 0.5, fz + 0.5);
        if (hooks.siegeBroke) hooks.siegeBroke(fx, yy, fz, id);
      } else siege.set(k, cur);
      return true;
    }
    return false;
  }

  // Лестница поблизости на том же уровне — чтобы добраться до игрока этажом выше
  function findLadder(e) {
    var bx = Math.floor(e.x), by = Math.floor(e.y + 0.1), bz = Math.floor(e.z), best = null, bd = 99;
    for (var dz = -8; dz <= 8; dz++) for (var dx = -8; dx <= 8; dx++) {
      if (world.getBlock(bx + dx, by, bz + dz) !== B.LADDER) continue;
      var d = Math.abs(dx) + Math.abs(dz);
      if (d < bd) { bd = d; best = { x: bx + dx + 0.5, z: bz + dz + 0.5 }; }
    }
    return best;
  }

  function updateHostile(e, dt) {
    var K = e.K, a = e.ai;
    e.attackCd -= dt;
    e.provoked -= dt;
    var target = acquire(e, dt);
    var goal = target ? { x: target.x, y: target.y, z: target.z } : a.heard && a.heard.t > 0 ? a.heard : null;
    if (a.heard) { a.heard.t -= dt; if (target || Math.hypot(a.heard.x - e.x, a.heard.z - e.z) < 1.5) a.heard = null; }
    if (goal) {
      var tdx = goal.x - e.x, tdz = goal.z - e.z, hd = Math.hypot(tdx, tdz) || 0.01;
      e.headYaw = 0;
      if (K.ranged && target) {
        if (hd < 5) steer(e, e.x - tdx, e.z - tdz, K.speed, dt);
        else if (hd > 11) steer(e, target.x, target.z, K.speed, dt);
        else { brake(e, dt); faceTo(e, target.x, target.z, dt, 8); }
        faceTo(e, target.x, target.z, dt, 8);
        a.shootCd -= dt;
        e.aiming = true;
        if (a.shootCd <= 0 && a.los && hd < 16) {
          a.shootCd = 1.6 + Math.random() * 0.9;
          shootArrow(e, target.x, target.y + 1.2, target.z, 20, e.K.dmg * diffMul(), 'mob');
          if (hooks.sound) hooks.sound('bow', e.x, e.y, e.z);
        }
      } else {
        var gx = goal.x, gz = goal.z, spd = target ? K.speed : K.speed * 0.75;
        // бегуны боятся яркого света: у генератора и ламп не суются дальше
        if (K.lightShy) {
          a.fear = (a.fear || 0) - dt;
          if (a.fear <= 0 && world.blockLightAt(e.x, e.y + 1, e.z) >= 11) a.fear = 1.4;
          if (a.fear > 0) { gx = e.x - tdx; gz = e.z - tdz; }
        }
        // игрок этажом выше: ищем лестницу и лезем
        if (K.zombie && goal.y - e.y > 2.5) {
          a.ladderT = (a.ladderT || 0) - dt;
          if (a.ladderT <= 0) { a.ladderT = 1.5; a.ladder = findLadder(e); }
          if (a.ladder && !e.onLadder) { gx = a.ladder.x; gz = a.ladder.z; }
        } else a.ladder = null;
        if (e.onLadder && goal.y > e.y - 0.4) {
          e.vy = 2.4;
          if (goal.y - e.y > 1) { gx = Math.floor(e.x) + 0.5; gz = Math.floor(e.z) + 0.5; }   // держится за лестницу
        }
        // упёрся в стену: ломает, что можно сломать, иначе обходит вдоль стены
        if (a.sideT > 0) {
          a.sideT -= dt;
          var sx = -tdz / hd * a.side, sz = tdx / hd * a.side;
          gx = e.x + sx * 3 + tdx / hd * 0.5; gz = e.z + sz * 3 + tdz / hd * 0.5;
        }
        steer(e, gx, gz, spd, dt);
        if (K.climbs && target && e.onGround && hd < 3.5 && hd > 1.5 && Math.random() < dt * 1.5) {
          e.vy = 5.5; e.vx += tdx / hd * 4; e.vz += tdz / hd * 4;
        }
        if (K.zombie && e.hitH && hd > 1.2 && !(a.sideT > 0)) {
          var mdx = gx - e.x, mdz = gz - e.z, md = Math.hypot(mdx, mdz) || 1;
          if (!siegeBlock(e, mdx / md, mdz / md, dt)) {
            a.stuckT = (a.stuckT || 0) + dt;
            if (a.stuckT > 1.2) { a.stuckT = 0; a.sideT = 1.5 + Math.random() * 1.5; a.side = Math.random() < 0.5 ? -1 : 1; }
          }
        } else a.stuckT = Math.max(0, (a.stuckT || 0) - dt);
        var reach = 0.9 + K.w / 2, pv = hooks.playerVehicle && hooks.playerVehicle();
        if (target && pv) {
          if (e.attackCd <= 0 && vehicleDist(pv, e.x, e.z) < 0.5 + K.w / 2 && e.y < pv.y + pv.V.h && e.y + e.h > pv.y) {
            e.attackCd = 1; e.attackAnim = 0.45;
            damageVehicle(pv, K.dmg * diffMul() * 1.5);
            if (hooks.sound) hooks.sound('siege-hit', e.x, e.y + 1, e.z);
          }
        } else if (target && hd < reach + 0.3 && Math.abs(target.y - e.y) < 1.8 && e.attackCd <= 0) meleeHit(e, target);
      }
    } else {
      e.aiming = false;
      wander(e, dt, K.speed * (K.zombie ? 0.3 : 0.45));
    }
    // Нечисть горит на солнце
    if (K.burns && hooks.day && hooks.day() > 0.6 && !e.inWater && world.skyAt(e.x, e.y + e.h, e.z) >= 1) {
      e.fire = Math.max(e.fire, 3);
    }
  }

  // ---- Летуны: духи, облачники, дроны ----------------------------------------------
  // Высота поверхности под точкой (null — внизу пустота, undefined — точка внутри породы)
  function floorBelow(x, y, z, max) {
    if (KC.SOLID[world.getBlock(x, y, z)]) return undefined;
    for (var d = 1; d < max; d++) if (KC.SOLID[world.getBlock(x, y - d, z)]) return Math.floor(y - d) + 1;
    return null;
  }
  function ceilingAbove(x, y, z, max) {
    for (var d = 1; d < max; d++) if (KC.SOLID[world.getBlock(x, y + d, z)]) return Math.floor(y + d);
    return null;
  }
  function flyToward(e, tx, ty, tz, speed, dt) {
    var dx = tx - e.x, dy = ty - e.y, dz = tz - e.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var k = Math.min(1, dt * 3);
    if (d < 0.3) { e.vx -= e.vx * k; e.vy -= e.vy * k; e.vz -= e.vz * k; return d; }
    e.vx += (dx / d * speed - e.vx) * k;
    e.vy += (dy / d * speed - e.vy) * k;
    e.vz += (dz / d * speed - e.vz) * k;
    if (Math.abs(dx) + Math.abs(dz) > 0.2) faceTo(e, tx, tz, dt);
    if (e.hitH) e.vy = Math.max(e.vy, 3);
    return d;
  }
  function pickFlyTarget(e, r0, r1) {
    var a = e.ai, K = e.K;
    var ang = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
    a.tx = e.x + Math.cos(ang) * r; a.tz = e.z + Math.sin(ang) * r;
    var g = floorBelow(a.tx, e.y + 0.3, a.tz, 28);
    if (g === undefined || !world.isLoaded(a.tx, a.tz)) { a.tx = e.x; a.tz = e.z; g = floorBelow(e.x, e.y + 0.3, e.z, 28); }
    var base = g === null || g === undefined ? e.homeY : g;
    a.ty = Math.min(KC.H - 3, base + K.hover[0] + Math.random() * (K.hover[1] - K.hover[0]));
    var ceil = ceilingAbove(a.tx, e.y + 0.3, a.tz, 16);
    if (ceil !== null) a.ty = Math.max(Math.min(a.ty, ceil - e.h - 0.6), Math.min(e.y, base + 0.5));
    a.state = 'fly'; a.timer = 3 + Math.random() * 4;
  }

  function updateFlyer(e, dt) {
    var K = e.K, a = e.ai, p = hooks.player && hooks.player();
    e.attackCd -= dt; e.provoked -= dt;
    a.timer -= dt;
    if (K.passive) {
      if (e.panic > 0) {
        e.panic -= dt;
        if (a.state !== 'flee' || a.timer <= 0) {
          var fx = p ? e.x - p.x : 1, fz = p ? e.z - p.z : 0, fd = Math.hypot(fx, fz) || 1;
          a.tx = e.x + fx / fd * 10; a.tz = e.z + fz / fd * 10; a.ty = e.y + 3; a.state = 'flee'; a.timer = 1.5;
        }
        flyToward(e, a.tx, a.ty, a.tz, K.panic, dt);
        if (e.panic <= 0) a.state = 'idle';
        return;
      }
    } else {
      var target = acquire(e, dt);
      if (target) {
        var tdx = target.x - e.x, tdz = target.z - e.z, hd = Math.hypot(tdx, tdz) || 0.01;
        var ty = target.y + 3 + Math.sin(e.age * 1.3 + e.id) * 1.2;
        if (hd > K.keep + 3) flyToward(e, target.x, ty, target.z, K.speed, dt);
        else if (hd < K.keep - 3) flyToward(e, e.x - tdx, ty, e.z - tdz, K.speed, dt);
        else flyToward(e, e.x + tdz / hd * 3, ty, e.z - tdx / hd * 3, K.speed * 0.6, dt);
        faceTo(e, target.x, target.z, dt, 8);
        e.headPitch = Math.atan2(target.y + 1.2 - e.y, hd);
        a.shootCd -= dt;
        if (a.shootCd <= 0 && a.los && hd < 24) {
          a.shootCd = K.cd + Math.random() * 1.2;
          shootBolt(e, target.x, target.y + 1.1, target.z, K.ranged, K.dmg * diffMul());
        }
        return;
      }
    }
    if (a.state !== 'fly' || a.timer <= 0) pickFlyTarget(e, 3, 9);
    if (flyToward(e, a.tx, a.ty, a.tz, K.speed * 0.45, dt) < 0.8) a.timer = Math.min(a.timer, 0.8);
  }

  function updateMob(e, dt) {
    var K = e.K;
    e.hurt -= dt; e.invul -= dt; e.attackAnim -= dt;
    if (e.deathT > 0) {
      e.deathT -= dt;
      physics(e, dt, { friction: 8 });
      if (e.deathT <= 0) {
        e.dead = true;
        if (hooks.particles) hooks.particles('poof', e.x, e.y, e.z);
      }
      return;
    }
    refreshLight(e, dt);
    if (K.vehicle) { if (hooks.vehicle) hooks.vehicle(e, dt); return; }
    if (K.npc) {
      // выживший машет рукой и смотрит на игрока
      var pp = hooks.player && hooks.player();
      brake(e, dt);
      if (pp && Math.hypot(pp.x - e.x, pp.z - e.z) < 24) faceTo(e, pp.x, pp.z, dt, 4);
      physics(e, dt, { climb: true });
      return;
    }
    if (K.flies) updateFlyer(e, dt);
    else if (K.passive) updatePassive(e, dt); else updateHostile(e, dt);
    if (K.fireImmune && e.inLava) e.vy = Math.max(e.vy, 2);
    var px = e.x, pz = e.z;
    if (K.flies) physics(e, dt, { gravity: 0, climb: false });
    else physics(e, dt, {
      slowFall: K.slowFall,
      climb: true,
      onLand: function (dist) { if (!K.slowFall && dist > 3.5) damageMob(e, Math.floor(dist - 3), 'fall'); }
    });
    var moved = Math.hypot(e.x - px, e.z - pz) / Math.max(dt, 1e-4);
    e.walkAmp += ((moved > 0.3 ? Math.min(1, moved / 3) : 0) - e.walkAmp) * Math.min(1, dt * 8);
    e.walk += moved * dt * 3.2;
    // огонь, лава, вода
    if (e.inLava && !K.fireImmune) { e.fire = 8; if (e.invul <= 0) damageMob(e, 4, 'fire'); }
    if (!K.fireImmune && world.getBlock(e.x, e.y + 0.2, e.z) === B.FIRE) e.fire = Math.max(e.fire, 4);
    if (e.inWater || K.fireImmune) e.fire = 0;
    if (K.glow && hooks.particles && Math.random() < dt * 5) hooks.particles('flame', e.x + (Math.random() - 0.5) * 0.5, e.y + 0.3 + Math.random() * 0.4, e.z + (Math.random() - 0.5) * 0.5);
    if (e.fire > 0) {
      e.fire -= dt; e.fireT -= dt;
      if (e.fireT <= 0) { e.fireT = 1; damageMob(e, 1, 'fire'); }
      if (hooks.particles && Math.random() < dt * 7) hooks.particles(Math.random() < 0.8 ? 'fire' : 'smoke', e.x + (Math.random() - 0.5) * e.w, e.y + Math.random() * e.h * 0.8, e.z + (Math.random() - 0.5) * e.w);
    }
    if (e.y < -30) e.dead = true;
    // голоса
    e.soundT -= dt;
    if (e.soundT <= 0) {
      e.soundT = 6 + Math.random() * 12;
      var p = hooks.player && hooks.player();
      if (p && Math.hypot(p.x - e.x, p.z - e.z) < 16 && hooks.sound) hooks.sound('say-' + e.kind, e.x, e.y, e.z);
    }
    if (hooks.pressPlate) plateCheck(e);
  }

  function plateCheck(e) {
    if (world.getBlock(e.x, e.y + 0.05, e.z) === B.PLATE) hooks.pressPlate(Math.floor(e.x), Math.floor(e.y + 0.05), Math.floor(e.z));
  }

  // ---- Стрелы ---------------------------------------------------------------------
  function shootArrow(from, tx, ty, tz, speed, dmg, owner) {
    var sx = from.x, sy = from.y + (from.K ? from.K.eye : 1.5), sz = from.z;
    var dx = tx - sx, dz = tz - sz, dh = Math.hypot(dx, dz) || 1;
    var t = dh / speed;
    var e = new Ent('arrow', sx + dx / dh * 0.6, sy, sz + dz / dh * 0.6, 0.1, 0.1);
    e.vx = dx / dh * speed + (Math.random() - 0.5) * 1.2;
    e.vz = dz / dh * speed + (Math.random() - 0.5) * 1.2;
    e.vy = (ty - sy) / t + 0.5 * 20 * t;
    e.dmg = dmg; e.owner = owner; e.shooter = from; e.stuck = false;
    list.push(e);
    return e;
  }
  // Снаряды без тяжести: огненный шар духа и лазер дрона
  var BOLTS = {
    fireball: { speed: 11, cause: 'Огненный шар', fire: 5, sound: 'fireball' },
    laser: { speed: 26, cause: 'Лазер', fire: 0, sound: 'laser' },
    shell: { speed: 55, cause: 'Снаряд', fire: 0, sound: 'cannon', blast: 3.2 }
  };
  function shellBlast(e, x, y, z) { e.dead = true; if (hooks.explode) hooks.explode(x, y, z, BOLTS.shell.blast); }
  function shootBolt(from, tx, ty, tz, kind, dmg) {
    var B0 = BOLTS[kind];
    var sx = from.x, sy = from.y + from.h * 0.5, sz = from.z;
    var dx = tx - sx, dy = ty - sy, dz = tz - sz, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var e = new Ent('arrow', sx + dx / d * 0.6, sy + dy / d * 0.6, sz + dz / d * 0.6, 0.3, 0.3);
    var sp = B0.speed, j = kind === 'laser' ? 0.4 : 1.2;
    e.vx = dx / d * sp + (Math.random() - 0.5) * j; e.vy = dy / d * sp + (Math.random() - 0.5) * j; e.vz = dz / d * sp + (Math.random() - 0.5) * j;
    e.dmg = dmg; e.owner = 'mob'; e.shooter = from; e.stuck = false; e.proj = kind;
    e.dir = [dx / d, dy / d, dz / d];
    list.push(e);
    if (hooks.sound) hooks.sound(B0.sound, sx, sy, sz);
    return e;
  }

  function launchArrow(x, y, z, vx, vy, vz, dmg, owner, shooter) {
    var e = new Ent('arrow', x, y, z, 0.1, 0.1);
    e.vx = vx; e.vy = vy; e.vz = vz; e.dmg = dmg; e.owner = owner; e.shooter = shooter; e.stuck = false;
    list.push(e);
    return e;
  }

  function segHitsBox(x0, y0, z0, x1, y1, z1, b) {
    var tmin = 0, tmax = 1, o = [x0, y0, z0], d = [x1 - x0, y1 - y0, z1 - z0];
    for (var a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < b[a] || o[a] > b[a + 3]) return false; continue; }
      var t1 = (b[a] - o[a]) / d[a], t2 = (b[a + 3] - o[a]) / d[a];
      if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
    return true;
  }

  function updateArrow(e, dt) {
    if (e.stuck) {
      if (e.age > 30) e.dead = true;
      var p = hooks.player && hooks.player();
      if (p && e.owner === 'player' && !p.creative && Math.abs(p.x - e.x) < 1.2 && Math.abs(p.z - e.z) < 1.2 && Math.abs(p.y + 0.9 - e.y) < 1.4) {
        if (!hooks.give({ id: I.ARROW, n: 1, d: 0 })) { e.dead = true; if (hooks.sound) hooks.sound('pickup', e.x, e.y, e.z); }
      }
      return;
    }
    if (e.age > (e.proj ? 6 : 60)) { if (e.proj === 'shell') shellBlast(e, e.x, e.y, e.z); else e.dead = true; return; }
    var inW = world.getBlock(e.x, e.y, e.z) === B.WATER;
    if (e.proj) {
      if (e.proj === 'shell') e.vy -= 4 * dt;
      if (inW && e.proj === 'fireball') { e.dead = true; if (hooks.sound) hooks.sound('fizz', e.x, e.y, e.z); return; }
      if (e.proj === 'fireball' && hooks.particles && Math.random() < dt * 20) hooks.particles('flame', e.x, e.y, e.z);
    } else {
      e.vy -= 20 * dt * gravityAt(e.x, e.y, e.z);
      var drag = Math.max(0, 1 - dt * (inW ? 3 : 0.1));
      e.vx *= drag; e.vy *= drag; e.vz *= drag;
    }
    var sp = Math.sqrt(e.vx * e.vx + e.vy * e.vy + e.vz * e.vz);
    var steps = Math.max(1, Math.ceil(sp * dt / 0.25)), sdt = dt / steps;
    for (var s = 0; s < steps; s++) {
      var nx = e.x + e.vx * sdt, ny = e.y + e.vy * sdt, nz = e.z + e.vz * sdt;
      // попадание в существо
      var victims = list.concat(hooks.player ? [hooks.player()] : []);
      for (var i = 0; i < victims.length; i++) {
        var v = victims[i];
        if (!v || v === e || v.dead || (v.type !== 'mob' && v.type !== 'player') || v.deathT > 0) continue;
        if (v === e.shooter && e.age < 0.4) continue;
        var hw = v.w / 2 + 0.1;
        if (!segHitsBox(e.x, e.y, e.z, nx, ny, nz, [v.x - hw, v.y, v.z - hw, v.x + hw, v.y + v.h, v.z + hw])) continue;
        if (e.proj && v === e.shooter) continue;
        if (e.proj === 'shell') { if (v.type === 'player') continue; shellBlast(e, nx, ny, nz); return; }
        var B0 = e.proj && BOLTS[e.proj];
        var dmg = B0 ? Math.max(1, Math.round(e.dmg)) : Math.max(1, Math.round(e.dmg * Math.min(1.5, sp / 20)));
        var kn = [e.vx / sp * 3, 3, e.vz / sp * 3];
        if (v.type === 'player') hooks.hurtPlayer(dmg, B0 ? B0.cause : 'Стрела', e.shooter, kn, B0 ? B0.fire : 0);
        else {
          damageMob(v, dmg, e.owner === 'player' ? 'player' : 'arrow', kn);
          if (B0 && B0.fire && !v.K.fireImmune) v.fire = Math.max(v.fire, B0.fire);
        }
        if (hooks.sound) hooks.sound(B0 ? 'fizz' : 'arrow-hit', nx, ny, nz);
        e.dead = true;
        return;
      }
      var id = world.getBlock(nx, ny, nz);
      if (KC.SOLID[id]) {
        var cb = KC.collisionBox(id, world.getMeta(nx, ny, nz));
        var fx = nx - Math.floor(nx), fy = ny - Math.floor(ny), fz = nz - Math.floor(nz);
        if (cb && fx >= cb[0] && fx <= cb[3] && fy >= cb[1] && fy <= cb[4] && fz >= cb[2] && fz <= cb[5]) {
          if (e.proj === 'shell') { shellBlast(e, e.x, e.y, e.z); return; }
          if (e.proj) {
            e.dead = true;
            if (hooks.sound) hooks.sound('fizz', nx, ny, nz);
            if (hooks.particles) for (var q = 0; q < 6; q++) hooks.particles(e.proj === 'fireball' ? 'flame' : 'spark', e.x, e.y, e.z);
            return;
          }
          e.stuck = true; e.age = 0;
          e.dir = [e.vx / sp, e.vy / sp, e.vz / sp];
          e.vx = e.vy = e.vz = 0;
          if (hooks.sound) hooks.sound('arrow-hit', nx, ny, nz);
          if (id === B.TNT && hooks.primeTnt) hooks.primeTnt(Math.floor(nx), Math.floor(ny), Math.floor(nz));
          return;
        }
      }
      e.x = nx; e.y = ny; e.z = nz;
    }
    e.dir = [e.vx / sp, e.vy / sp, e.vz / sp];
  }

  // =================================================================================
  // Техника: легковушка, пикап, полицейская, автобус, самосвал, бульдозер, танк.
  // Корпус — прямоугольник, повёрнутый на yaw; с миром он сталкивается набором квадратов
  // вдоль длины. Машина давит заражённых, тяжёлая техника сносит блоки на пути.
  // =================================================================================
  var VEHICLES = {
    sedan: { name: 'Легковушка', model: 'sedan', w: 2.0, len: 4.2, h: 1.5, speed: 19, accel: 8, brake: 18, turn: 1.9, hp: 60, armor: 0.3,
      fuelUse: 0.35, step: 0.6, crush: 1, mass: 1, seat: [-0.4, 1.2, 0.3], cam: 6.5, tint: true, cabin: true },
    pickup: { name: 'Пикап', model: 'pickup', w: 2.1, len: 4.8, h: 1.8, speed: 17, accel: 7.5, brake: 16, turn: 1.7, hp: 90, armor: 0.4,
      fuelUse: 0.4, step: 1.1, crush: 1, mass: 1.3, seat: [-0.45, 1.45, -0.5], cam: 7, tint: true, cabin: true },
    police: { name: 'Полицейская машина', model: 'police', w: 2.0, len: 4.2, h: 1.5, speed: 21, accel: 9, brake: 18, turn: 2, hp: 70, armor: 0.35,
      fuelUse: 0.35, step: 0.6, crush: 1, mass: 1, seat: [-0.4, 1.2, 0.3], cam: 6.5, siren: true, cabin: true },
    bus: { name: 'Автобус', model: 'bus', w: 2.8, len: 10, h: 3.3, speed: 12, accel: 3.5, brake: 9, turn: 0.8, hp: 220, armor: 0.5,
      fuelUse: 0.8, step: 0.6, crush: 2, mass: 3, seat: [-0.6, 2.3, -4.2], cam: 13 },
    truck: { name: 'Самосвал', model: 'truck', w: 2.8, len: 7, h: 3, speed: 13, accel: 4, brake: 9, turn: 0.9, hp: 180, armor: 0.55,
      fuelUse: 0.75, step: 1.1, crush: 2, mass: 3, seat: [-0.5, 2.5, -2.6], cam: 11, tint: true },
    dozer: { name: 'Бульдозер', model: 'dozer', w: 3.2, len: 5.2, h: 3.1, speed: 5.5, accel: 3, brake: 9, turn: 1.1, hp: 260, armor: 0.65,
      fuelUse: 0.6, step: 1.1, crush: 3, mass: 4, seat: [0, 2.4, 1], cam: 9, cabin: true },
    tank: { name: 'Танк', model: 'tank', w: 3.3, len: 6.5, h: 2.7, speed: 9, accel: 3.5, brake: 9, turn: 1, hp: 520, armor: 0.9,
      fuelUse: 0.9, step: 1.1, crush: 3, mass: 6, seat: [0, 2.5, 0.2], cam: 11, cannon: true, cabin: true }
  };
  var CAR_TINTS = [[0.9, 0.24, 0.2], [0.24, 0.4, 0.85], [0.93, 0.93, 0.93], [0.22, 0.22, 0.25], [0.9, 0.72, 0.18], [0.3, 0.56, 0.32], [0.6, 0.6, 0.64]];
  // что техника сносит на ходу: 1 — кусты и обломки, 2 — двери, окна, машины, фонари, 3 — стены (не прочнее 3)
  function crushable(id, level) {
    if (!id) return false;
    var b = KC.BLOCKS[id];
    if (!b || b.hardness < 0 || b.liquid || id === B.BEDROCK || id === B.OBSIDIAN) return false;
    if (b.leaves || id === B.RUBBLE || id === B.FIRE || b.shape === 'cross' || b.shape === 'decal') return true;
    // лёгкий уличный хлам: мешки, коробки, урны, ограждения — сносит даже легковушка
    if (id === B.TRASH_BAGS || id === B.BOXES || id === B.TRASH_BIN || id === B.ROAD_BARRIER || id === B.BENCH) return true;
    if (level < 2) return false;
    if (b.siege || id === B.CAR_RED || id === B.CAR_BLUE || id === B.CAR_WHITE || id === B.TIRE || id === B.STREET_POLE ||
        id === B.STREET_LAMP || id === B.FUEL_BARREL || id === B.CRATE || id === B.SANDBAG || b.shape === 'model') return true;
    if (level < 3) return false;
    return b.hardness <= 3 && id !== B.CHEST && id !== B.GENERATOR;
  }

  function spawnVehicle(kind, x, y, z, yaw, opts) {
    var V = VEHICLES[kind];
    if (!V) return null;
    var e = new Ent('vehicle', x, y, z, V.w, V.h);
    e.kind = kind; e.V = V; e.yaw = yaw || 0;
    e.speed = 0; e.steer = 0; e.wheel = 0; e.turret = e.yaw; e.gunPitch = 0; e.cannonCd = 0; e.hornCd = 0;
    e.hp = V.hp; e.fuel = 30 + Math.floor(Math.random() * 40); e.color = Math.floor(Math.random() * CAR_TINTS.length);
    e.engineT = 0; e.noiseT = 0; e.pumpT = 0; e.hitT = 0;
    if (opts) { if (opts.hp !== undefined) e.hp = opts.hp; if (opts.fuel !== undefined) e.fuel = opts.fuel; if (opts.color !== undefined) e.color = opts.color; }
    list.push(e);
    return e;
  }
  function vFwd(yaw) { return [-Math.sin(yaw), -Math.cos(yaw)]; }
  function vSamples(V) {
    var n = Math.max(2, Math.ceil(V.len / (V.w * 0.9)) + 1), out = [], span = V.len - V.w * 0.9;
    for (var i = 0; i < n; i++) out.push(-span / 2 + span * i / (n - 1));
    return out;
  }
  // Пересекается ли корпус в позиции x,y,z с поворотом yaw с блоками или другой техникой
  function vHits(v, x, y, z, yaw) {
    var V = v.V, f = vFwd(yaw), S = v.samples || (v.samples = vSamples(V)), bw = V.w * 0.9;
    for (var i = 0; i < S.length; i++) if (boxHits(x + f[0] * S[i], y + 0.02, z + f[1] * S[i], bw, V.h - 0.02)) return true;
    return vOverlap(v, x, y, z, yaw);
  }
  // Для расстановки при генерации: незагруженные соседние чанки считаем пустыми
  function vSpawnBlocked(v, x, y, z, yaw) {
    var V = v.V, f = vFwd(yaw), S = v.samples || (v.samples = vSamples(V)), hw = V.w * 0.45;
    for (var i = 0; i < S.length; i++) {
      var cx = x + f[0] * S[i], cz = z + f[1] * S[i];
      for (var bx = Math.floor(cx - hw); bx <= Math.floor(cx + hw); bx++) for (var bz = Math.floor(cz - hw); bz <= Math.floor(cz + hw); bz++) {
        if (!world.isLoaded(bx, bz)) continue;
        for (var by = Math.floor(y + 0.05); by < y + V.h; by++) if (KC.SOLID[world.getBlock(bx, by, bz)]) return true;
      }
    }
    return vOverlap(v, x, y, z, yaw);
  }
  function vOverlap(v, x, y, z, yaw) {
    var V = v.V, f = vFwd(yaw), S = v.samples || (v.samples = vSamples(V)), bw = V.w * 0.9;
    for (var j = 0; j < list.length; j++) {
      var o = list[j];
      if (o === v || o.dead || o.type !== 'vehicle') continue;
      if (Math.abs(o.x - x) > (V.len + o.V.len) / 2 || Math.abs(o.z - z) > (V.len + o.V.len) / 2) continue;
      if (y + V.h <= o.y || o.y + o.V.h <= y) continue;
      var of = vFwd(o.yaw), OS = o.samples || (o.samples = vSamples(o.V)), r = (bw + o.V.w * 0.9) / 2;
      for (var a = 0; a < S.length; a++) for (var b = 0; b < OS.length; b++) {
        if (Math.abs(x + f[0] * S[a] - o.x - of[0] * OS[b]) < r && Math.abs(z + f[1] * S[a] - o.z - of[1] * OS[b]) < r) return true;
      }
    }
    return false;
  }
  // Снести то, что мешает проехать (в передней части корпуса)
  function vCrush(v, x, y, z, yaw) {
    var V = v.V, f = vFwd(yaw), S = v.samples, bw = V.w * 0.9, n = 0, dir = v.speed >= 0 ? 1 : -1;
    var off = S[dir > 0 ? S.length - 1 : 0];            // передний (или задний при езде назад) квадрат корпуса
    var cx = x + f[0] * off, cz = z + f[1] * off;
    for (var yy = Math.floor(y + 0.05); yy < y + V.h; yy++) for (var bx = Math.floor(cx - bw / 2); bx <= Math.floor(cx + bw / 2); bx++) for (var bz = Math.floor(cz - bw / 2); bz <= Math.floor(cz + bw / 2); bz++) {
      var id = world.getBlock(bx, yy, bz);
      if (!id || !KC.SOLID[id] && !KC.BLOCKS[id].leaves) continue;
      if (!crushable(id, V.crush)) return -1;
      if (KC.BLOCKS[id].explosive) { KC.Sim.breakBlock(bx, yy, bz, false); if (hooks.explode) hooks.explode(bx + 0.5, yy + 0.5, bz + 0.5, KC.BLOCKS[id].explosive); }
      else KC.Sim.breakBlock(bx, yy, bz, Math.random() < 0.15);
      if (hooks.particles) for (var q = 0; q < 4; q++) hooks.particles('block', bx + 0.5, yy + 0.5, bz + 0.5, id);
      n++;
    }
    if (n && hooks.sound) hooks.sound('break:' + (V.crush >= 3 ? 'stone' : 'wood'), cx, y + 1, cz);
    return n;
  }

  function damageVehicle(v, amount) {
    if (v.dead || amount <= 0) return;
    v.hp -= amount * (1 - v.V.armor);
    v.hitT = 0.3;
    if (v.hp <= 0) {
      v.dead = true;
      if (hooks.vehicleDestroyed) hooks.vehicleDestroyed(v);
      if (hooks.explode) hooks.explode(v.x, v.y + 1, v.z, v.kind === 'tank' ? 3.5 : 2.5);
    }
  }

  // ctl: { throttle −1…1, steer −1…1, brake: bool } — от игрока, либо пусто (стоит)
  function updateVehicle(v, dt) {
    var V = v.V, ctl = v.ctl || { throttle: 0, steer: 0, brake: false };
    v.cannonCd -= dt; v.hornCd -= dt; v.hitT -= dt;
    refreshLight(v, dt);
    // стоящая без водителя машина не пересчитывает физику каждый кадр — только расталкивает прохожих
    if (!v.driver && Math.abs(v.speed) < 0.01 && v.onGround) {
      v.sleepT = (v.sleepT || 0) - dt;
      if (v.sleepT > 0) { vehiclePush(v); return; }
      v.sleepT = 1;
    }
    var th = v.fuel > 0 ? ctl.throttle : 0;
    // скорость вперёд/назад
    if (ctl.brake) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), V.brake * 1.4 * dt);
    else if (th > 0) v.speed = v.speed < 0 ? Math.min(0, v.speed + V.brake * dt) : Math.min(V.speed, v.speed + V.accel * th * dt);
    else if (th < 0) v.speed = v.speed > 0 ? Math.max(0, v.speed - V.brake * dt) : Math.max(-V.speed * 0.4, v.speed + V.accel * 0.6 * th * dt);
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), (1.5 + Math.abs(v.speed) * 0.15) * dt);
    if (th) v.fuel = Math.max(0, v.fuel - V.fuelUse * Math.abs(th) * dt);
    // поворот: колёсной технике нужен ход, гусеничная крутится на месте
    v.steer += (ctl.steer - v.steer) * Math.min(1, dt * 6);
    var tracked = v.kind === 'tank' || v.kind === 'dozer';
    var turnK = tracked ? (Math.abs(v.speed) < 0.5 && ctl.steer ? 0.8 : Math.min(1, Math.abs(v.speed) / 3)) : Math.min(1, Math.abs(v.speed) / 5);
    var dyaw = -v.steer * V.turn * turnK * dt * (v.speed < -0.1 ? -1 : 1);
    if (dyaw && !vHits(v, v.x, v.y, v.z, v.yaw + dyaw)) v.yaw += dyaw;
    // вперёд
    var f = vFwd(v.yaw), dist = v.speed * dt;
    if (Math.abs(dist) > 1e-4) {
      var steps = Math.ceil(Math.abs(dist) / 0.4), sd = dist / steps;
      for (var s = 0; s < steps; s++) {
        var nx = v.x + f[0] * sd, nz = v.z + f[1] * sd;
        if (!vHits(v, nx, v.y, nz, v.yaw)) { v.x = nx; v.z = nz; continue; }
        // ступенька
        if (V.step >= 1 && !vHits(v, nx, v.y + 1, nz, v.yaw)) { v.x = nx; v.z = nz; v.y += 1; continue; }
        if (V.step < 1 && !vHits(v, nx, v.y + V.step, nz, v.yaw)) { v.x = nx; v.z = nz; v.y += V.step; continue; }
        // снос преград
        var crushed = Math.abs(v.speed) > 1.5 ? vCrush(v, nx, v.y, nz, v.yaw) : -1;
        if (crushed > 0 && !vHits(v, nx, v.y, nz, v.yaw)) { v.x = nx; v.z = nz; v.speed *= V.crush >= 3 ? 0.7 : 0.85; continue; }
        // удар
        var impact = Math.abs(v.speed);
        if (impact > 7) {
          damageVehicle(v, (impact - 6) * 2.5 / Math.sqrt(V.mass));
          if (hooks.sound) hooks.sound('crash', v.x, v.y + 1, v.z);
          noise(v.x, v.y, v.z, 25);
          if (v.driver && hooks.vehicleCrash) hooks.vehicleCrash(v, impact);
        }
        v.speed = -v.speed * 0.2;
        break;
      }
    }
    // тяжесть
    v.vy = Math.max((v.vy || 0) - 28 * dt, -40);
    var ny = v.y + v.vy * dt;
    if (!vHits(v, v.x, ny, v.z, v.yaw)) { v.y = ny; v.onGround = false; }
    else { if (v.vy < 0) { var sy = Math.ceil(ny - 1e-6); if (!vHits(v, v.x, sy, v.z, v.yaw) && sy <= v.y + 1e-6) v.y = sy; v.onGround = true; } v.vy = 0; }
    if (v.y < -30) { v.dead = true; return; }
    v.wheel += v.speed * dt * 1.6;
    vehiclePush(v);
    vehicleFx(v, dt, th);
    // шум мотора
    if (v.driver && Math.abs(th) > 0.05) {
      v.noiseT -= dt;
      if (v.noiseT <= 0) { v.noiseT = 1; noise(v.x, v.y, v.z, 14 + Math.abs(v.speed) * 1.2); }
    }
    // заправка у колонки
    v.pumpT -= dt;
    if (v.pumpT <= 0) {
      v.pumpT = 0.5; v.atPump = false;
      if (Math.abs(v.speed) < 0.5) {
        for (var dz = -4; dz <= 4 && !v.atPump; dz++) for (var dx = -4; dx <= 4; dx++) {
          if (world.getBlock(v.x + dx, v.y + 0.5, v.z + dz) === B.FUEL_PUMP) { v.atPump = true; break; }
        }
      }
    }
    if (v.atPump && v.fuel < 100) v.fuel = Math.min(100, v.fuel + 15 * dt);
  }

  // Выхлоп, пыль из-под колёс, дым и огонь повреждённого мотора
  var DUSTY = {};
  [B.GRASS, B.DIRT, B.SAND, B.GRAVEL, B.SNOW, B.SNOW_GRASS, B.ASH_BLOCK, B.RUBBLE, B.FARMLAND, B.LIGHT_SOIL, B.GOLDEN_GRASS].forEach(function (id) { DUSTY[id] = 1; });
  function vehicleFx(v, dt, th) {
    if (!hooks.particles) return;
    var V = v.V, f = vFwd(v.yaw), rt = [-f[1], f[0]], hl = V.len / 2, hpK = v.hp / V.hp;
    if (v.driver && v.fuel > 0 && Math.random() < dt * (3 + Math.abs(th) * 9)) {
      var ex = v.x - f[0] * (hl + 0.1) + rt[0] * V.w * 0.3, ez = v.z - f[1] * (hl + 0.1) + rt[1] * V.w * 0.3;
      hooks.particles('exhaust', ex, v.y + (v.kind === 'truck' || v.kind === 'bus' ? 0.6 : 0.4), ez, [-f[0] * (0.6 + Math.abs(th)), 0, -f[1] * (0.6 + Math.abs(th))]);
    }
    if (Math.abs(v.speed) > 4.5 && v.onGround && Math.random() < dt * Math.abs(v.speed) * 0.9) {
      var gid = world.getBlock(v.x, v.y - 0.5, v.z);
      if (DUSTY[gid]) {
        var side = Math.random() < 0.5 ? 1 : -1;
        hooks.particles('dust', v.x - f[0] * hl * 0.75 + rt[0] * side * V.w * 0.45, v.y, v.z - f[1] * hl * 0.75 + rt[1] * side * V.w * 0.45, gid);
      }
    }
    if (hpK < 0.5 && Math.random() < dt * (hpK < 0.25 ? 9 : 3.5)) {
      var mx = v.x + f[0] * hl * 0.6, mz = v.z + f[1] * hl * 0.6, my = v.y + V.h * 0.85;
      hooks.particles(hpK < 0.25 ? 'smokeDark' : 'smoke', mx, my, mz);
      if (hpK < 0.25 && Math.random() < 0.6) hooks.particles('fire', mx, my - 0.2, mz);
    }
  }

  // Давим заражённых на ходу и выталкиваем всех из-под корпуса
  function vehiclePush(v) {
    var V = v.V, fr = vFwd(v.yaw), rt = [-fr[1], fr[0]];
    var p = hooks.player && hooks.player(), pool = p && !p.dead && !v.driver ? list.concat([p]) : list;
    for (var i = 0; i < pool.length; i++) {
      var m = pool[i];
      if (m.dead || (m.type !== 'mob' && m.type !== 'player') || (m.K && m.K.vehicle)) continue;
      if (m.y > v.y + V.h || m.y + m.h < v.y) continue;
      var rx = m.x - v.x, rz = m.z - v.z, lf = rx * fr[0] + rz * fr[1], lr = rx * rt[0] + rz * rt[1];
      var pf = V.len / 2 + m.w / 2 - Math.abs(lf), pr = V.w / 2 + m.w / 2 - Math.abs(lr);
      if (pf <= 0 || pr <= 0) continue;
      if (m.type === 'mob' && Math.abs(v.speed) > 3 && lf * v.speed > 0 && !m.K.npc) {
        var dmg = Math.abs(v.speed) * 1.2 * Math.min(2, V.mass);
        var kn = [fr[0] * v.speed * 0.5 + rt[0] * Math.sign(lr) * 3, 4, fr[1] * v.speed * 0.5 + rt[1] * Math.sign(lr) * 3];
        if (damageMob(m, dmg, v.driver ? 'player' : 'vehicle', kn)) {
          if (V.mass < 2) damageVehicle(v, 1.5);
          v.speed *= V.mass < 2 ? 0.9 : 0.97;
          if (hooks.sound) hooks.sound('crash', m.x, m.y + 1, m.z);
        }
      }
      // выталкиваем из-под корпуса
      if (pr < pf) { m.x += rt[0] * Math.sign(lr || 1) * pr; m.z += rt[1] * Math.sign(lr || 1) * pr; }
      else { m.x += fr[0] * Math.sign(lf || 1) * pf; m.z += fr[1] * Math.sign(lf || 1) * pf; }
    }
  }

  // Расстояние от точки до корпуса (0 — внутри)
  function vehicleDist(v, x, z) {
    var fr = vFwd(v.yaw), rx = x - v.x, rz = z - v.z;
    var lf = Math.abs(rx * fr[0] + rz * fr[1]) - v.V.len / 2, lr = Math.abs(-rx * fr[1] + rz * fr[0]) - v.V.w / 2;
    return Math.hypot(Math.max(0, lf), Math.max(0, lr));
  }
  // Луч по технике: переводим луч в систему координат корпуса
  function raycastVehicles(o, d, maxD) {
    var best = null, bestT = maxD;
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (v.dead || v.type !== 'vehicle') continue;
      var fr = vFwd(v.yaw), rt = [-fr[1], fr[0]];
      var ox = o[0] - v.x, oz = o[2] - v.z;
      var lo = [ox * rt[0] + oz * rt[1], o[1] - v.y, ox * fr[0] + oz * fr[1]];
      var ld = [d[0] * rt[0] + d[2] * rt[1], d[1], d[0] * fr[0] + d[2] * fr[1]];
      var b = [-v.V.w / 2, 0, -v.V.len / 2, v.V.w / 2, v.V.h, v.V.len / 2];
      var tmin = 0, tmax = bestT, hit = true;
      for (var a = 0; a < 3 && hit; a++) {
        if (Math.abs(ld[a]) < 1e-9) { if (lo[a] < b[a] || lo[a] > b[a + 3]) hit = false; continue; }
        var t1 = (b[a] - lo[a]) / ld[a], t2 = (b[a + 3] - lo[a]) / ld[a];
        if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) hit = false;
      }
      if (hit && tmin < bestT) { bestT = tmin; best = v; }
    }
    return best ? { v: best, t: bestT } : null;
  }
  // Свободное место рядом с машиной, чтобы вылезти
  function exitSpot(v) {
    var fr = vFwd(v.yaw), rt = [-fr[1], fr[0]], V = v.V;
    var tries = [[-(V.w / 2 + 0.7), 0], [V.w / 2 + 0.7, 0], [0, -(V.len / 2 + 0.8)], [0, V.len / 2 + 0.8]];
    for (var i = 0; i < tries.length; i++) {
      var x = v.x + rt[0] * tries[i][0] + fr[0] * tries[i][1], z = v.z + rt[1] * tries[i][0] + fr[1] * tries[i][1];
      for (var dy = 0; dy <= 2; dy++) if (!boxHits(x, v.y + dy, z, 0.6, 1.8) && boxHits(x, v.y + dy - 0.3, z, 0.5, 0.3)) return { x: x, y: v.y + dy, z: z };
    }
    return { x: v.x, y: v.y + V.h + 0.1, z: v.z };
  }
  // Пушка танка: снаряд летит почти прямо и взрывается при попадании
  function fireCannon(v, dir) {
    var fr = vFwd(v.turret), bx = v.x + fr[0] * 4.2, bz = v.z + fr[1] * 4.2, by = v.y + 1.85;
    var e = new Ent('arrow', bx, by, bz, 0.3, 0.3);
    e.vx = dir[0] * 55; e.vy = dir[1] * 55; e.vz = dir[2] * 55;
    e.dmg = 30; e.owner = 'player'; e.shooter = v; e.stuck = false; e.proj = 'shell';
    e.dir = dir;
    list.push(e);
    if (hooks.sound) hooks.sound('cannon', bx, by, bz);
    noise(bx, by, bz, 70);
    if (hooks.particles) {
      hooks.particles('muzzle', bx, by, bz, 1.6);
      hooks.particles('shockwave', bx, by, bz, 3);
      for (var q = 0; q < 10; q++) hooks.particles('smoke', bx + (Math.random() - 0.5), by + (Math.random() - 0.5), bz + (Math.random() - 0.5));
      for (q = 0; q < 6; q++) hooks.particles('dust', v.x + (Math.random() - 0.5) * 4, v.y, v.z + (Math.random() - 0.5) * 4, world.getBlock(v.x, v.y - 0.5, v.z));
    }
    if (hooks.flashAt) hooks.flashAt(bx, by, bz, 14, [2.2, 1.5, 0.8], 0.12);
    v.speed -= fr[0] * dir[0] * 1.5 + fr[1] * dir[2] * 1.5;
  }

  // ---- Брошенное: граната (отскакивает, взрывается через 2,5 с) и зажигательная бутылка ----
  function throwItem(kind, x, y, z, vx, vy, vz) {
    var e = new Ent('thrown', x, y, z, 0.25, 0.25);
    e.kind = kind; e.vx = vx; e.vy = vy; e.vz = vz; e.fuse = 2.5; e.spin = 0;
    list.push(e);
    return e;
  }
  function burst(e) {
    e.dead = true;
    if (e.kind === 'grenade') { if (hooks.explode) hooks.explode(e.x, e.y + 0.2, e.z, 3); return; }
    // зажигательная смесь: огонь по кругу и поджог всех рядом
    if (hooks.sound) hooks.sound('break:glass', e.x, e.y, e.z);
    noise(e.x, e.y, e.z, 20);
    var cx = Math.floor(e.x), cz = Math.floor(e.z), cy = Math.floor(e.y + 0.3);
    for (var dz = -2; dz <= 2; dz++) for (var dx = -2; dx <= 2; dx++) {
      if (dx * dx + dz * dz > 5 || Math.random() < 0.25) continue;
      for (var dy = 1; dy >= -3; dy--) {
        var x = cx + dx, y = cy + dy, z = cz + dz;
        if (!world.getBlock(x, y, z) && KC.OPAQUE[world.getBlock(x, y - 1, z)]) { world.setBlock(x, y, z, B.FIRE, 0); break; }
      }
    }
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type !== 'mob' || m.dead || m.K.fireImmune || m.K.npc) continue;
      if (Math.hypot(m.x - e.x, m.z - e.z) < 3 && Math.abs(m.y - e.y) < 3) { m.fire = Math.max(m.fire, 8); damageMob(m, 2, 'player'); }
    }
    var p = hooks.player && hooks.player();
    if (p && !p.creative && Math.hypot(p.x - e.x, p.z - e.z) < 2.2 && Math.abs(p.y - e.y) < 2.5) p.fire = Math.max(p.fire || 0, 4);
    if (hooks.particles) {
      for (var q = 0; q < 14; q++) hooks.particles('fire', e.x + (Math.random() - 0.5) * 3, e.y + Math.random() * 0.5, e.z + (Math.random() - 0.5) * 3);
      for (q = 0; q < 6; q++) hooks.particles('spark', e.x, e.y + 0.3, e.z);
    }
    if (hooks.flashAt) hooks.flashAt(e.x, e.y + 0.8, e.z, 10, [1.8, 0.9, 0.3], 0.5);
  }
  function updateThrown(e, dt) {
    var vx = e.vx, vz = e.vz, vy = e.vy;
    physics(e, dt, { gravity: 22 });
    e.spin += dt * 12;
    if (e.kind === 'molotov') {
      if (e.hitH || e.onGround || e.inWater) { if (e.inWater) e.dead = true; else burst(e); return; }
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'mob' && !m.dead && !m.K.npc && Math.abs(m.x - e.x) < m.w / 2 + 0.2 && Math.abs(m.z - e.z) < m.w / 2 + 0.2 && e.y > m.y && e.y < m.y + m.h) { burst(e); return; }
      }
      return;
    }
    // граната отскакивает от стен и пола
    if (e.hitH) { e.vx = -vx * 0.35; e.vz = -vz * 0.35; }
    if (e.onGround && vy < -3) { e.vy = -vy * 0.3; e.vx *= 0.6; e.vz *= 0.6; if (hooks.sound) hooks.sound('arrow-hit', e.x, e.y, e.z); }
    else if (e.onGround) { e.vx *= Math.max(0, 1 - dt * 6); e.vz *= Math.max(0, 1 - dt * 6); }
    e.fuse -= dt;
    if (hooks.particles && Math.random() < dt * 6) hooks.particles('smoke', e.x, e.y + 0.2, e.z);
    if (e.fuse <= 0) burst(e);
  }

  // ---- Динамит и падающие блоки --------------------------------------------------
  function spawnTnt(x, y, z, fuse) {
    var e = new Ent('tnt', x + 0.5, y, z + 0.5, 0.98, 0.98);
    e.fuse = fuse === undefined ? 4 : fuse;
    e.vy = 3; e.vx = (Math.random() - 0.5); e.vz = (Math.random() - 0.5);
    list.push(e);
    if (hooks.sound) hooks.sound('fuse', e.x, e.y, e.z);
    return e;
  }
  function updateTnt(e, dt) {
    physics(e, dt, { friction: 6 });
    e.fuse -= dt;
    if (hooks.particles && Math.random() < dt * 10) hooks.particles('smoke', e.x, e.y + 1.1, e.z);
    if (e.fuse <= 0) { e.dead = true; if (hooks.explode) hooks.explode(e.x, e.y + 0.5, e.z, 4); }
  }
  function spawnFalling(x, y, z, id, meta) {
    var e = new Ent('falling', x + 0.5, y, z + 0.5, 0.98, 0.98);
    e.block = id; e.meta = meta | 0;
    list.push(e);
    return e;
  }
  function updateFalling(e, dt) {
    physics(e, dt, { gravity: 28 });
    if (e.onGround || e.age > 20) {
      e.dead = true;
      var x = Math.floor(e.x), y = Math.round(e.y), z = Math.floor(e.z);
      var cur = world.getBlock(x, y, z);
      if (KC.REPLACEABLE[cur] || cur === 0) world.setBlock(x, y, z, e.block, e.meta);
      else dropItem(e.x, e.y + 0.5, e.z, { id: e.block, n: 1 });
    }
  }

  // ---- Появление мобов -------------------------------------------------------------
  function hostileCount() { var n = 0; for (var i = 0; i < list.length; i++) if (list[i].type === 'mob' && list[i].K.hostile) n++; return n; }

  // Кто и как появляется: зависит от измерения, типа мира и района
  var CITY_KINDS = {
    downtown: [['infected', 0.45], ['runner', 0.8], ['brute', 1]],
    residential: [['infected', 0.62], ['runner', 0.86], ['brute', 1]],
    industrial: [['infected', 0.5], ['runner', 0.68], ['brute', 1]],
    suburb: [['infected', 0.8], ['runner', 0.96], ['brute', 1]]
  };
  var BUILDING_KINDS = { hospital: 'patient', police: 'cop', military: 'soldier' };
  function spawnRules(p) {
    var day = hooks.day ? hooks.day() : 1;
    if (world.dim === 'hell') return { cap: 12, every: 0.7, kinds: [['imp', 0.62], ['wisp', 1]], anyLight: true, cave: true };
    if (world.dim === 'heaven') return null;
    if (world.dim === 'space') return { cap: 5, every: 2.5, kinds: [['drone', 1]], air: true };
    if (world.type === 'city') {
      var night = day < 0.45, boost = hooks.hordeBoost ? hooks.hordeBoost() : 0;
      if (p && p.y < KC.Gen.CITY_GROUND - 3) return { cap: 6, every: 1.2, kinds: [['blind', 0.7], ['infected', 1]], anyLight: true, metro: true };
      var dist = p ? KC.Gen.cityInfo(world.seed, p.x, p.z).district : 'residential';
      var k = KC.Gen.DISTRICTS[dist].danger;
      return { cap: Math.round((night ? 16 + boost * 2 : 6 + boost) * k), every: (night ? 0.35 : 1.4) / k, kinds: CITY_KINDS[dist], anyLight: true, street: true };
    }
    return { cap: 14, every: 0.5, kinds: [['upyr', 0.45], ['archer', 0.75], ['spider', 1]] };
  }
  function pickKind(kinds) {
    var r = Math.random();
    for (var i = 0; i < kinds.length; i++) if (r < kinds[i][1]) return kinds[i][0];
    return kinds[kinds.length - 1][0];
  }
  function standable(x, y, z) {
    return KC.SOLID[world.getBlock(x, y - 1, z)] && !world.getBlock(x, y, z) && !world.getBlock(x, y + 1, z);
  }

  var spawnT = 0;
  function trySpawnHostile(dt) {
    spawnT -= dt;
    if (spawnT > 0) return;
    var p = hooks.player && hooks.player();
    var R = spawnRules(p);
    spawnT = R ? R.every : 2;
    var diff = hooks.difficulty ? hooks.difficulty() : 2;
    if (!R || !diff || !p || p.dead) return;
    if (hostileCount() >= R.cap) return;
    for (var attempt = 0; attempt < 3; attempt++) {
      var ang = Math.random() * Math.PI * 2, r = (R.metro ? 14 : 24) + Math.random() * (R.metro ? 16 : 20);
      var x = Math.floor(p.x + Math.cos(ang) * r), z = Math.floor(p.z + Math.sin(ang) * r), y;
      var c = world.getChunk(x >> 4, z >> 4);
      if (!c || !c.mesh) continue;
      var kind = pickKind(R.kinds);
      if (R.air) {
        // дроны кружат в открытом космосе вокруг станции
        y = Math.floor(p.y + (Math.random() - 0.3) * 14);
        if (y < 2 || y > KC.H - 3 || world.getBlock(x, y, z) || world.getBlock(x, y + 1, z) || KC.Gen.inStation(x, y, z)) continue;
        spawnMob(kind, x + 0.5, y, z + 0.5);
        return;
      }
      if (R.metro) {
        // в туннелях и на станциях метро: туннели прямые, поэтому ищем вдоль осей
        var ax = Math.floor(Math.random() * 4), sgn = ax < 2 ? 1 : -1;
        x = Math.floor(p.x + (ax % 2 === 0 ? sgn * r : (Math.random() - 0.5) * 3));
        z = Math.floor(p.z + (ax % 2 === 1 ? sgn * r : (Math.random() - 0.5) * 3));
        y = KC.Gen.METRO_FLOOR + 1;
        if (!world.getChunk(x >> 4, z >> 4) || !standable(x, y, z)) continue;
        spawnMob(kind, x + 0.5, y, z + 0.5);
        return;
      }
      var top = c.hmap[(x & 15) + (z & 15) * 16];
      if (R.cave) y = KC.Gen.HELL_LAVA + 2 + Math.floor(Math.random() * (KC.H - 10 - KC.Gen.HELL_LAVA));
      else if (R.street && Math.random() < 0.6) y = KC.Gen.CITY_GROUND + 2;
      else y = Math.random() < 0.5 ? top : 3 + Math.floor(Math.random() * Math.max(1, top - 6));
      y = Math.min(y, KC.H - 3);
      // ищем пол: твёрдый блок снизу, два блока воздуха сверху
      var ok = false;
      for (var k = 0; k < 8 && y > 1; k++, y--) {
        if (KC.OPAQUE[world.getBlock(x, y - 1, z)] && !world.getBlock(x, y, z) && !world.getBlock(x, y + 1, z)) { ok = true; break; }
      }
      if (!ok) continue;
      if (R.street && y < KC.Gen.CITY_GROUND) continue;                  // метро заселяется отдельно
      if (!R.anyLight) {
        // днём под кронами чудовища не появляются: листва не спасает от солнца
        var sky = (openSky(x, y, z) ? 1 : world.skyAt(x, y, z)) * 15 * (hooks.day ? hooks.day() : 1);
        if (sky > 6) continue;
        if (world.blockLightAt(x, y, z) > 6) continue;
      }
      if (R.street) {
        var info = KC.Gen.cityInfo(world.seed, x, z), pl = info.plot;
        if (info.inPlot && BUILDING_KINDS[pl.special] && x >= pl.bx0 && x <= pl.bx1 && z >= pl.bz0 && z <= pl.bz1) kind = BUILDING_KINDS[pl.special];
      }
      if (kind === 'spider' && (world.getBlock(x + 1, y, z) || world.getBlock(x - 1, y, z) || world.getBlock(x, y, z + 1) || world.getBlock(x, y, z - 1))) kind = 'upyr';
      if (kind === 'brute' && (world.getBlock(x, y + 2, z) || world.getBlock(x + 1, y, z) || world.getBlock(x - 1, y, z))) kind = 'infected';
      spawnMob(kind, x + 0.5, y, z + 0.5);
      return;
    }
  }

  // Особые здания заселяются, когда игрок подходит: толпа в супермаркете, пациенты в больнице,
  // полицейские в участке. Зачищенное здание пустует до следующего дня.
  var POPULATION = {
    market: [['infected', 9], ['runner', 2]], hospital: [['patient', 7]], police: [['cop', 5]],
    gas: [['infected', 3]], helipad: [['infected', 5], ['runner', 2], ['brute', 1]], military: [['soldier', 6]]
  };
  var popT = 0;
  function populateSpecials(dt) {
    popT -= dt;
    if (popT > 0) return;
    popT = 1;
    if (world.type !== 'city' || world.dim !== 'over') return;
    var p = hooks.player && hooks.player();
    if (!p || p.dead || !(hooks.difficulty && hooks.difficulty() > 0)) return;
    var G = KC.Gen, cell = G.CELL, day = hooks.worldDay ? hooks.worldDay() : 0;
    world.cityPop = world.cityPop || {};
    var cx0 = Math.floor(p.x / cell), cz0 = Math.floor(p.z / cell);
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      var pl = G.plotInfo(world.seed, cx0 + dx, cz0 + dz), crowd = POPULATION[pl.special];
      if (!crowd) continue;
      var key = pl.cx + ',' + pl.cz;
      if (world.cityPop[key] !== undefined && day - world.cityPop[key] < 1) continue;
      var en = G.plotEntrance(pl);
      if (Math.hypot(en.x - p.x, en.z - p.z) > 42) continue;
      var bx0 = pl.bx0 !== undefined ? pl.bx0 : pl.x0, bx1 = pl.bx1 !== undefined ? pl.bx1 : pl.x0 + 27;
      var bz0 = pl.bz0 !== undefined ? pl.bz0 : pl.z0, bz1 = pl.bz1 !== undefined ? pl.bz1 : pl.z0 + 27;
      var loaded = true;
      for (var cx = bx0 >> 4; cx <= bx1 >> 4 && loaded; cx++) for (var cz = bz0 >> 4; cz <= bz1 >> 4; cz++) {
        var ch = world.getChunk(cx, cz);
        if (!ch || !ch.mesh) { loaded = false; break; }
      }
      if (!loaded) continue;
      world.cityPop[key] = day;
      var floors = pl.special === 'gas' || pl.special === 'market' || pl.special === 'military' ? 1 : pl.floors || 1;
      crowd.forEach(function (grp) {
        for (var n = 0, tries = 0; n < grp[1] && tries < 60; tries++) {
          var x = bx0 + 1 + Math.floor(Math.random() * (bx1 - bx0 - 1));
          var z = bz0 + 1 + Math.floor(Math.random() * (bz1 - bz0 - 1));
          var y = G.CITY_GROUND + 1 + 4 * Math.floor(Math.random() * floors);
          if (pl.special === 'gas') { x = pl.x0 + 3 + Math.floor(Math.random() * 16); z = pl.z0 + 5 + Math.floor(Math.random() * 12); y = G.CITY_GROUND + 1; }
          if (!standable(x, y, z)) continue;
          var m = spawnMob(grp[0], x + 0.5, y, z + 0.5);
          if (m) m.yaw = Math.random() * Math.PI * 2;
          n++;
        }
      });
    }
  }

  function openSky(x, y, z) {
    for (var yy = y; yy < KC.H; yy++) if (KC.OPAQUE[world.getBlock(x, yy, z)]) return false;
    return true;
  }

  // Животные при первом создании чанка (и восстановление сохранённых при повторной загрузке).
  // info есть только у обычного мира: карта высот с запасной зоной G.
  function onChunkGenerated(c, info) {
    var key = c.cx + ',' + c.cz;
    world.animalChunks = world.animalChunks || {};
    world.storedMobs = world.storedMobs || {};
    if (world.animalChunks[key]) {
      var stored = world.storedMobs[key];
      if (stored) { stored.forEach(restoreMob); delete world.storedMobs[key]; }
      return;
    }
    world.animalChunks[key] = 1;
    if (world.dim === 'heaven') { heavenHerd(c); return; }
    if (world.dim === 'over' && world.type === 'city') { cityVehicles(c); return; }
    if (world.dim === 'space') { stationRobots(c); return; }
    if (world.dim !== 'over' || !info) return;
    var hs = info.hs, G = info.G, P = info.P;
    var r = KC.hash2(c.cx, c.cz, world.seed + 99);
    if (r > 0.14) return;
    var kinds = ['pig', 'cow', 'sheep', 'chicken'];
    var kind = kinds[Math.floor(KC.hash2(c.cx, c.cz, world.seed + 98) * 4)];
    var n = 2 + Math.floor(KC.hash2(c.cx, c.cz, world.seed + 97) * 3);
    for (var i = 0; i < n; i++) {
      var lx = 2 + Math.floor(KC.hash2(c.cx * 7 + i, c.cz, world.seed + 90) * 12);
      var lz = 2 + Math.floor(KC.hash2(c.cx, c.cz * 7 + i, world.seed + 91) * 12);
      var h = hs[(lx + G) + (lz + G) * P];
      var top = c.blocks[lx + lz * 16 + h * 256];
      if (top !== B.GRASS && top !== B.SNOW_GRASS) continue;
      if (c.blocks[lx + lz * 16 + (h + 1) * 256] && c.blocks[lx + lz * 16 + (h + 1) * 256] !== B.TALL_GRASS) continue;
      spawnMob(kind, c.cx * 16 + lx + 0.5, h + 1, c.cz * 16 + lz + 0.5);
    }
  }

  // Город: техника на улицах (по району), бульдозер на стройке, танк и грузовик на блокпосту,
  // полицейская машина у участка. Место проверяется: техника не встаёт в стены и машины.
  var ROAD_KINDS = {
    downtown: [['sedan', 0.45], ['police', 0.55], ['bus', 0.75], ['pickup', 1]],
    residential: [['sedan', 0.55], ['pickup', 0.85], ['bus', 0.95], ['police', 1]],
    industrial: [['truck', 0.45], ['pickup', 0.8], ['sedan', 1]],
    suburb: [['pickup', 0.5], ['sedan', 1]]
  };
  function tryVehicle(kind, x, y, z, yaw) {
    if (!KC.SOLID[world.getBlock(x, y - 1, z)]) return null;
    var v = spawnVehicle(kind, x, y, z, yaw);
    if (v && vSpawnBlocked(v, x, y, z, yaw)) { v.dead = true; list.splice(list.indexOf(v), 1); return null; }
    if (v) v.onGround = true;
    return v;
  }
  function cityVehicles(c) {
    var G = KC.Gen, cell = G.CELL, seed = world.seed, gy = G.CITY_GROUND + 1;
    var ox = c.cx * 16, oz = c.cz * 16;
    // особые места: якорь участка внутри этого чанка
    for (var cz = Math.floor(oz / cell) - 1; cz <= Math.floor((oz + 15) / cell); cz++) for (var cx = Math.floor(ox / cell) - 1; cx <= Math.floor((ox + 15) / cell); cx++) {
      var pl = G.plotInfo(seed, cx, cz), spots = [];
      if (pl.kind === 'military') spots = [['tank', pl.x0 + 8.5, pl.z0 + 12, 0], ['truck', pl.x0 + 21.5, pl.z0 + 18.5, 0]];
      else if (pl.kind === 'construction') spots = [['dozer', pl.x0 + 25.5, pl.z0 + 13, Math.PI]];
      else if (pl.special === 'police') spots = [['police', pl.x0 + 5.5, cz * cell + 5.5, -Math.PI / 2]];
      spots.forEach(function (sp) {
        if (Math.floor(sp[1]) >> 4 !== c.cx || Math.floor(sp[2]) >> 4 !== c.cz) return;
        var v = tryVehicle(sp[0], sp[1], gy, sp[2], sp[3]);
        if (v && sp[0] === 'tank') v.fuel = 70;
      });
    }
    // машины на дорогах
    var dist = G.districtOf(seed, Math.floor((ox + 8) / cell), Math.floor((oz + 8) / cell));
    for (var i = 0; i < 2; i++) {
      if (KC.hash2(c.cx * 5 + i, c.cz, seed + 300) > (i ? 0.2 : 0.45)) continue;
      var lx = Math.floor(KC.hash2(c.cx, c.cz * 5 + i, seed + 301) * 16), lz = Math.floor(KC.hash2(c.cx + i, c.cz - i, seed + 302) * 16);
      var wx = ox + lx, wz = oz + lz, clx = ((wx % cell) + cell) % cell, clz = ((wz % cell) + cell) % cell;
      var r = KC.hash2(wx, wz, seed + 303), kinds = ROAD_KINDS[dist], kind = kinds[kinds.length - 1][0];
      for (var k = 0; k < kinds.length; k++) if (r < kinds[k][1]) { kind = kinds[k][0]; break; }
      var back = KC.hash2(wz, wx, seed + 304) < 0.5;
      if (clx < 8 && clz >= 10 && clz <= 36) tryVehicle(kind, Math.floor(wx / cell) * cell + (back ? 2.5 : 5.5), gy, wz + 0.5, back ? Math.PI : 0);
      else if (clz < 8 && clx >= 10 && clx <= 36) tryVehicle(kind, wx + 0.5, gy, Math.floor(wz / cell) * cell + (back ? 2.5 : 5.5), back ? -Math.PI / 2 : Math.PI / 2);
    }
  }

  // Небеса: пегасы пасутся на золотой траве, облачники парят над островами
  function heavenHerd(c) {
    var r = KC.hash2(c.cx, c.cz, world.seed + 199);
    if (r > 0.24) return;
    var kind = r < 0.11 ? 'pegasus' : 'cloudling';
    var n = (kind === 'pegasus' ? 1 : 2) + Math.floor(KC.hash2(c.cx, c.cz, world.seed + 197) * 2);
    for (var i = 0; i < n; i++) {
      var lx = 2 + Math.floor(KC.hash2(c.cx * 7 + i, c.cz, world.seed + 190) * 12);
      var lz = 2 + Math.floor(KC.hash2(c.cx, c.cz * 7 + i, world.seed + 191) * 12);
      var h = c.hmap[lx + lz * 16];
      if (!h || h >= KC.H - 8) continue;
      var col = lx + lz * 16, top = c.blocks[col + (h - 1) * 256];
      var y = kind === 'pegasus' ? h : h + 2 + Math.floor(KC.hash2(c.cx + i, c.cz - i, world.seed + 192) * 4);
      if (kind === 'pegasus' && top !== B.GOLDEN_GRASS) continue;
      if (kind === 'cloudling' && top === B.CLOUD) continue;
      if (c.blocks[col + y * 256] || c.blocks[col + (y + 1) * 256]) continue;
      spawnMob(kind, c.cx * 16 + lx + 0.5, y, c.cz * 16 + lz + 0.5);
    }
  }

  // Станция: роботы-уборщики катаются по отсекам
  function stationRobots(c) {
    var SY = KC.Gen.STATION_Y;
    for (var i = 0; i < 2; i++) {
      if (KC.hash2(c.cx * 3 + i, c.cz, world.seed + 290) > 0.3) continue;
      var lx = 1 + Math.floor(KC.hash2(c.cx, c.cz * 3 + i, world.seed + 291) * 14);
      var lz = 1 + Math.floor(KC.hash2(c.cx + i, c.cz, world.seed + 292) * 14);
      var wx = c.cx * 16 + lx, wz = c.cz * 16 + lz, col = lx + lz * 16;
      if (!KC.Gen.inStation(wx, SY + 1, wz)) continue;
      if (!KC.SOLID[c.blocks[col + SY * 256]] || c.blocks[col + (SY + 1) * 256] || c.blocks[col + (SY + 2) * 256]) continue;
      spawnMob('robot', wx + 0.5, SY + 1, wz + 0.5);
    }
  }

  function serializeMob(e) {
    return { k: e.kind, x: +e.x.toFixed(2), y: +e.y.toFixed(2), z: +e.z.toFixed(2), yaw: +e.yaw.toFixed(2), hp: e.hp, g: e.grow > 0 ? Math.round(e.grow) : 0, s: e.sheared ? 1 : 0 };
  }
  function serializeVehicle(e) {
    return { veh: 1, k: e.kind, x: +e.x.toFixed(2), y: +e.y.toFixed(2), z: +e.z.toFixed(2), yaw: +e.yaw.toFixed(3), hp: Math.round(e.hp), f: Math.round(e.fuel), c: e.color };
  }
  function restoreMob(o) {
    if (o.veh) { spawnVehicle(o.k, o.x, o.y, o.z, o.yaw, { hp: o.hp, fuel: o.f, color: o.c }); return; }
    var e = spawnMob(o.k, o.x, o.y, o.z, { yaw: o.yaw, hp: o.hp, sheared: !!o.s });
    if (e && o.g > 0) { e.grow = o.g; e.w = e.K.w * 0.55; e.h = e.K.h * 0.55; }
  }

  // Чанк выгружается: мирных животных откладываем, остальное убираем
  function onChunkUnload(c) {
    var key = c.cx + ',' + c.cz;
    world.storedMobs = world.storedMobs || {};
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || (Math.floor(e.x) >> 4) !== c.cx || (Math.floor(e.z) >> 4) !== c.cz) continue;
      if (e.type === 'mob' && e.K.passive && !e.K.vehicle) {
        (world.storedMobs[key] = world.storedMobs[key] || []).push(serializeMob(e));
      }
      if (e.type === 'vehicle') {
        if (e.driver) continue;
        (world.storedMobs[key] = world.storedMobs[key] || []).push(serializeVehicle(e));
      }
      e.dead = true;
    }
  }

  // ---- Главное обновление -------------------------------------------------------
  function update(dt) {
    var p = hooks.player && hooks.player();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead) continue;
      if (!world.isLoaded(e.x, e.z)) continue;
      e.age += dt;
      switch (e.type) {
        case 'item': updateItem(e, dt); break;
        case 'mob': updateMob(e, dt); break;
        case 'arrow': updateArrow(e, dt); break;
        case 'tnt': updateTnt(e, dt); break;
        case 'thrown': updateThrown(e, dt); break;
        case 'vehicle': updateVehicle(e, dt); break;
        case 'falling': updateFalling(e, dt); break;
      }
      // исчезновение враждебных мобов вдали
      if (e.type === 'mob' && e.K.hostile && p) {
        var d = Math.hypot(e.x - p.x, e.z - p.z);
        if (d > 72 || (d > 36 && Math.random() < dt / 30)) e.dead = true;
        if (hooks.difficulty && !hooks.difficulty()) e.dead = true;
      }
    }
    separate();
    for (i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);
    trySpawnHostile(dt);
    populateSpecials(dt);
  }

  // Мягкое расталкивание мобов между собой и с игроком
  function separate() {
    var p = hooks.player && hooks.player();
    var all = list.filter(function (e) { return e.type === 'mob' && !e.dead && e.deathT <= 0; });
    if (p && !p.dead) all.push(p);
    for (var i = 0; i < all.length; i++) for (var j = i + 1; j < all.length; j++) {
      var a = all[i], b = all[j];
      var dx = b.x - a.x, dz = b.z - a.z, min = (a.w + b.w) / 2;
      if (Math.abs(dx) >= min || Math.abs(dz) >= min) continue;
      if (a.y + a.h <= b.y || b.y + b.h <= a.y) continue;
      var d = Math.hypot(dx, dz) || 0.01, push = (min - d) * 2;
      var ux = dx / d * push, uz = dz / d * push;
      if (a.type !== 'player') { a.vx -= ux; a.vz -= uz; } else { a.vx -= ux * 0.3; a.vz -= uz * 0.3; }
      if (b.type !== 'player') { b.vx += ux; b.vz += uz; } else { b.vx += ux * 0.3; b.vz += uz * 0.3; }
    }
  }

  // ---- Луч по существам -----------------------------------------------------------
  function raycast(ox, oy, oz, d, maxD, skip) {
    var best = null, bestT = maxD;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.type !== 'mob' || e.deathT > 0) continue;
      if (skip && skip.indexOf(e) >= 0) continue;
      var hw = e.w / 2 + 0.05, b = [e.x - hw, e.y, e.z - hw, e.x + hw, e.y + e.h + 0.05, e.z + hw];
      var tmin = 0, tmax = bestT, o = [ox, oy, oz], hit = true;
      for (var a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) { if (o[a] < b[a] || o[a] > b[a + 3]) { hit = false; break; } continue; }
        var t1 = (b[a] - o[a]) / d[a], t2 = (b[a + 3] - o[a]) / d[a];
        if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { hit = false; break; }
      }
      if (hit && tmin < bestT) { bestT = tmin; best = e; }
    }
    return best ? { e: best, t: bestT } : null;
  }

  // ---- Отрисовка -------------------------------------------------------------------
  var mobBatch = new M.Batch(4096), itemBatch = new M.Batch(2048);

  function humanPose(e, pose, t) {
    var sw = Math.sin(e.walk) * 0.9 * e.walkAmp, idle = Math.sin(t * 1.6 + e.id) * 0.035 * (1 - e.walkAmp);
    pose.legR = [0, sw]; pose.legL = [0, -sw];
    pose.armR = [0, -sw * 0.8, 0.03 + idle]; pose.armL = [0, sw * 0.8, -0.03 - idle];
    pose.head = [e.headYaw || 0, e.headPitch || 0];
    // враг смотрит на игрока, если тот рядом
    var pl = hooks.player && hooks.player();
    if (pl && !pl.dead && e.K.hostile) {
      var ldx = pl.x - e.x, ldz = pl.z - e.z, ld = Math.hypot(ldx, ldz);
      if (ld < 14) {
        var rel = Math.atan2(-ldx, -ldz) - e.yaw;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        pose.head = [Math.max(-0.9, Math.min(0.9, rel)), Math.max(-0.5, Math.min(0.5, -Math.atan2(pl.y + 1.5 - e.y - e.K.eye, ld)))];
      }
    }
    if (e.kind === 'upyr') {
      var sway = Math.sin(t * 1.7 + e.id) * 0.12;
      pose.armR = [0, -sw * 0.5 + sway, 0.08]; pose.armL = [0, sw * 0.5 - sway, -0.08];
      if (e.attackAnim > 0) { var a = Math.sin(e.attackAnim / 0.45 * Math.PI) * 1.4; pose.armR[1] += a; pose.armL[1] += a; }
    }
    if (e.kind === 'archer' && e.aiming) { pose.armL = [0.2, 1.45]; pose.armR = [-0.3, 1.35]; pose.bow = [0, 0]; }
    if (e.kind === 'infected') {
      // ковыляет, склонив голову набок; одна рука тянется вперёд
      pose.head = [0.15, 0.2, 0.3];
      pose.armR = [0, 1.1 + Math.sin(t * 2.3 + e.id) * 0.15, 0.1]; pose.armL = [0, -sw * 0.4, -0.2];
      if (e.attackAnim > 0) { pose.armR[1] += Math.sin(e.attackAnim / 0.45 * Math.PI) * 0.8; pose.armL = [0, 1.2, -0.1]; }
    }
    if (e.kind === 'runner') {
      var sw2 = Math.sin(e.walk * 1.2) * 1.25 * e.walkAmp;
      pose.legR = [0, sw2]; pose.legL = [0, -sw2];
      pose.armR = [0, -sw2 * 1.1, 0.15]; pose.armL = [0, sw2 * 1.1, -0.15];
      pose.head = [0, -0.25];
      if (e.attackAnim > 0) { var ra = Math.sin(e.attackAnim / 0.45 * Math.PI) * 1.6; pose.armR[1] += ra; pose.armL[1] += ra; }
    }
    if (e.kind === 'patient' || e.kind === 'cop' || e.kind === 'soldier') {
      pose.head = [0, e.kind === 'patient' ? 0.35 : 0.1, e.kind === 'patient' ? -0.2 : 0];
      var reachA = e.kind === 'patient' ? 1.25 : 0.5;
      pose.armR = [0, reachA - sw * 0.2, 0.12]; pose.armL = [0, reachA + sw * 0.2, -0.12];
      if (e.attackAnim > 0) { var pa = Math.sin(e.attackAnim / 0.45 * Math.PI) * 1.2; pose.armR[1] += pa; pose.armL[1] += pa; }
    }
    if (e.kind === 'blind') {
      // сутулится, «слушает» воздух головой, длинные руки висят
      pose.head = [Math.sin(t * 1.3 + e.id) * 0.4, 0.45, 0];
      pose.armR = [0, -sw * 0.3 + 0.2, 0.25]; pose.armL = [0, sw * 0.3 + 0.2, -0.25];
      if (e.attackAnim > 0) { var la = Math.sin(e.attackAnim / 0.45 * Math.PI) * 1.8; pose.armR[1] += la; pose.armL[1] += la; }
    }
    if (e.kind === 'survivor') pose.armR = [0, Math.PI - 0.3, 0.3 + Math.sin(t * 6 + e.id) * 0.35];
    if (e.kind === 'brute') {
      pose.armR = [0, -sw * 0.35, 0.18]; pose.armL = [0, sw * 0.35, -0.18];
      if (e.attackAnim > 0) { var ba = Math.sin(e.attackAnim / 0.45 * Math.PI) * 2.6; pose.armR = [0, ba, 0.1]; pose.armL = [0, ba, -0.1]; }
    }
  }

  // cabinOf — машина, из кабины которой смотрит камера: у неё прячем стёкла и крышу
  var CABIN_HIDE = { glass: true, paintRoof: true, roof: true, cab: true, hatch: true };
  function buildRender(cam, t, playerView, cabinOf) {
    mobBatch.reset(); itemBatch.reset();
    var pose = {};
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead) continue;
      var dx = e.x - cam.x, dz = e.z - cam.z;
      if (dx * dx + dz * dz > 80 * 80) continue;
      var L = e.light || [1, 1, 1];
      if (e.type === 'mob') {
        for (var k in pose) delete pose[k];
        var col = L, tint = null, sunK = e.sunK || 0;
        if (e.hurt > 0 || e.deathT > 0) tint = [1.3, 0.42, 0.42];
        else if (e.fire > 0) tint = [1.35, 0.88, 0.62];
        var scale = (e.grow > 0 ? 0.55 : 1) * (e.K.scale || 1);
        var oy = 0;
        if (e.K.glow) { col = [1.25, 1.1, 0.95]; sunK = 0; }
        var roll = e.deathT > 0 ? (1 - e.deathT / 0.8) * Math.PI / 2 : 0;
        var hidden = null;
        var sw = Math.sin(e.walk) * 0.7 * e.walkAmp;
        switch (e.K.model) {
          case 'upyr': case 'archer': case 'infected': case 'runner': case 'brute':
          case 'patient': case 'cop': case 'blind': case 'survivor': case 'soldier': humanPose(e, pose, t); break;
          case 'helicopter':
            pose.rotorA = pose.rotorB = [t * (e.rotor === undefined ? 14 : e.rotor), 0, 0];
            pose.tailRotor = [0, t * 30, 0];
            roll = e.bank || 0;
            break;
          case 'imp':
            pose.legR = [0, sw * 1.2]; pose.legL = [0, -sw * 1.2];
            pose.armR = [0, -sw, 0.2]; pose.armL = [0, sw, -0.2];
            pose.tail = [Math.sin(t * 3 + e.id) * 0.5, -0.3];
            if (e.attackAnim > 0) { var ia = Math.sin(e.attackAnim / 0.45 * Math.PI) * 2; pose.armR[1] += ia; pose.armL[1] += ia; }
            break;
          case 'wisp':
            oy = Math.sin(t * 2.2 + e.id) * 0.1;
            pose.shell = [t * 1.3, 0, 0]; pose.core = [-t * 2, 0, 0];
            pose.ember0 = [t * 3.1, 0, 0]; pose.ember1 = [t * 2.6 + 2, 0, 0.3]; pose.ember2 = [-t * 3.4, 0, 0];
            break;
          case 'pegasus':
            pose.legFR = [0, sw]; pose.legBL = [0, sw]; pose.legFL = [0, -sw]; pose.legBR = [0, -sw];
            var wf = e.onGround ? -0.75 + Math.sin(t * 1.4 + e.id) * 0.08 : -0.25 + Math.sin(t * 9 + e.id) * 0.75;
            pose.wingR = [0, 0, wf]; pose.wingL = [0, 0, -wf];
            pose.tail = [Math.sin(t * 1.7 + e.id) * 0.25, -0.45 - e.walkAmp * 0.3];
            break;
          case 'cloudling':
            oy = Math.sin(t * 1.6 + e.id) * 0.12;
            pose.puffA = [0, 0, Math.sin(t * 2.1 + e.id) * 0.15]; pose.puffB = [0, 0, -Math.sin(t * 2.1 + e.id) * 0.15];
            pose.puffC = [t * 0.5, 0, 0];
            break;
          case 'drone':
            oy = Math.sin(t * 3 + e.id) * 0.06;
            for (var ri = 0; ri < 4; ri++) pose['rotor' + ri] = [t * 40 + ri, 0, 0];
            pose.body = [0, Math.max(-0.4, Math.min(0.4, -(e.headPitch || 0) * 0.5)), 0];
            break;
          case 'robot':
            pose.wheelR = pose.wheelL = pose.wheelR2 = pose.wheelL2 = [0, e.walk * 2, 0];
            pose.antenna = [0, Math.sin(t * 5 + e.id) * 0.15 * (0.3 + e.walkAmp), 0];
            break;
          case 'spider':
            for (var li = 0; li < 4; li++) {
              var ph = Math.sin(e.walk * 1.3 + li * 1.6) * 0.35 * (e.walkAmp + 0.1);
              // лапы расходятся веером и упираются в землю
              pose['legR' + li] = [ph + (li - 1.5) * 0.3, 0, 0.55];
              pose['legL' + li] = [-ph - (li - 1.5) * 0.3, 0, -0.55];
            }
            break;
          case 'chicken':
            pose.legR = [0, sw]; pose.legL = [0, -sw];
            var flap = e.onGround ? 0 : Math.sin(t * 30) * 0.8;
            pose.wingR = [0, 0, flap]; pose.wingL = [0, 0, -flap];
            pose.head = [e.headYaw || 0, 0];
            break;
          default:
            pose.legFR = [0, sw]; pose.legBL = [0, sw]; pose.legFL = [0, -sw]; pose.legBR = [0, -sw];
            pose.head = [e.headYaw || 0, e.kind === 'sheep' && e.walkAmp < 0.1 ? Math.sin(t * 0.6 + e.id) * 0.3 - 0.2 : 0];
        }
        if (e.kind === 'sheep') hidden = e.sheared ? { wool: true } : { skin: true };
        M.drawModel(mobBatch, e.K.model, [e.x, e.y + oy, e.z], e.yaw, scale, pose, hidden, col, roll, sunK, tint);
      } else if (e.type === 'item') {
        if (e.age % 1 < 0.02 || !e.light) { e.light = lightAt(e.x, e.y + 0.3, e.z); e.sunK = sunVis(e.x, e.y + 0.3, e.z); }
        var bob = Math.sin(e.age * 2.5 + e.spin) * 0.07 + 0.2;
        var it = KC.ITEMS[e.stack.id];
        var copies = e.stack.n > 16 ? 3 : e.stack.n > 1 ? 2 : 1;
        for (var c = 0; c < copies; c++) {
          var ox = c * 0.07, oy = c * 0.05;
          if (it && it.sprite === undefined && it.block !== undefined) M.drawBlockCube(itemBatch, it.block, 0, e.x + ox, e.y + bob + oy, e.z + ox, 0.26, e.age * 1.4 + e.spin, L, e.sunK);
          else if (it) M.drawItem3D(itemBatch, it.sprite, e.x + ox, e.y + bob + 0.12 + oy, e.z, 0.42, e.age * 1.4 + e.spin, L, e.sunK);
        }
      } else if (e.type === 'arrow' && e.proj === 'shell') {
        M.drawSprite(itemBatch, KC.TILE.tankShell, e.x, e.y, e.z, 0.5, Math.atan2(cam.x - e.x, cam.z - e.z), [1.2, 1.2, 1.2]);
      } else if (e.type === 'arrow' && e.proj === 'fireball') {
        var fs = 0.55 + Math.sin(e.age * 20) * 0.05;
        M.drawSprite(itemBatch, KC.TILE.fireball, e.x, e.y, e.z, fs, Math.atan2(cam.x - e.x, cam.z - e.z), [1.4, 1.25, 1.1]);
      } else if (e.type === 'arrow') {
        drawArrow(e, e.proj === 'laser' ? [1.5, 1.5, 1.5] : L);
      } else if (e.type === 'vehicle') {
        var V = e.V, vp = {}, vl = e.light || [1, 1, 1], vhit = e.hitT > 0 ? [1.3, 0.6, 0.6] : null, vsun = e.sunK || 0;
        var steerA = e.steer * 0.45;
        ['wheelFL', 'wheelFR', 'wheelML', 'wheelMR', 'wheelBL', 'wheelBR'].forEach(function (wn, wi) { vp[wn] = [wi < 2 ? steerA : 0, e.wheel, 0]; });
        if (V.cannon) { var rel = e.turret - e.yaw; vp.turret = [rel, 0, 0]; vp.hatch = [rel, 0, 0]; vp.barrel = [rel, e.gunPitch, 0]; }
        var MM = M.MODELS[V.model];
        // фары горят у машины с водителем, а ночью и в ливень — у любой исправной; стоп-сигналы — при торможении
        var vglow = null, dark = KC.Light.sunCol[0] + KC.Light.sunCol[1] < 0.35;
        if (e.hp > 0 && e.fuel > 0 && (e.driver || dark)) {
          var braking = e.driver && e.ctl && (e.ctl.brake || (e.ctl.throttle < -0.1 && e.speed > 0.5));
          vglow = { lampL: 2.3, lampR: 2.3, tailL: braking ? 3 : 1.5, tailR: braking ? 3 : 1.5 };
        }
        if (V.siren && e.driver) { var red = Math.floor(t * 4) % 2 === 0; vglow = vglow || {}; vglow.barR = red ? 3.2 : 0.45; vglow.barB = red ? 0.45 : 3.2; }
        if (V.tint && MM.paintSet) {
          var tc = CAR_TINTS[e.color % CAR_TINTS.length];
          var hidePaint = MM.otherSet;
          if (e === cabinOf) { hidePaint = {}; for (var hp2 in MM.otherSet) hidePaint[hp2] = true; hidePaint.paintRoof = true; }
          var ptint = vhit ? [tc[0] * vhit[0], tc[1] * vhit[1], tc[2] * vhit[2]] : tc;
          M.drawModel(mobBatch, V.model, [e.x, e.y, e.z], e.yaw, 2, vp, hidePaint, vl, 0, vsun, ptint);
          var hideOther = MM.paintSet;
          if (e === cabinOf) { hideOther = {}; for (var hk in MM.paintSet) hideOther[hk] = true; for (hk in CABIN_HIDE) hideOther[hk] = true; }
          M.drawModel(mobBatch, V.model, [e.x, e.y, e.z], e.yaw, 2, vp, hideOther, vl, 0, vsun, vhit, vglow);
        } else M.drawModel(mobBatch, V.model, [e.x, e.y, e.z], e.yaw, 2, vp, e === cabinOf ? CABIN_HIDE : null, vl, 0, vsun, vhit, vglow);
        if (e.kind === 'police' && e.siren && Math.floor(t * 4) % 2 === 0 && hooks.particles) { /* мигалка видна по модели */ }
      } else if (e.type === 'thrown') {
        if (!e.light || e.age % 0.5 < 0.02) e.light = lightAt(e.x, e.y, e.z);
        M.drawItem3D(itemBatch, KC.TILE[e.kind], e.x, e.y + 0.15, e.z, 0.4, Math.atan2(-e.vx, -e.vz), e.light, 1, e.spin);
      } else if (e.type === 'tnt') {
        var fl = Math.floor(e.fuse * 5) % 2 === 0 ? 1.8 : 1;
        M.drawBlockCube(itemBatch, B.TNT, 0, e.x, e.y + 0.49, e.z, 0.98 * (1 + (e.fuse < 0.4 ? (0.4 - e.fuse) * 0.3 : 0)), 0, [L[0] * fl, L[1] * fl, L[2] * fl]);
      } else if (e.type === 'falling') {
        M.drawBlockCube(itemBatch, e.block, e.meta, e.x, e.y + 0.49, e.z, 0.98, 0, L, e.sunK);
      }
    }
    if (playerView) playerView(mobBatch);
    return { mobs: mobBatch.view(), items: itemBatch.view() };
  }

  function drawArrow(e, L) {
    var d = e.dir || [1, 0, 0], uv = KC.tileUV(e.proj === 'laser' ? KC.TILE.laserBolt : KC.TILE.arrow), s = e.proj === 'laser' ? 0.5 : 0.36;
    var up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    var s1 = norm(cross(d, up)), s2 = norm(cross(d, s1));
    [s1, s2].forEach(function (sd) {
      var tail = [e.x - d[0] * s, e.y - d[1] * s, e.z - d[2] * s], head = [e.x + d[0] * s, e.y + d[1] * s, e.z + d[2] * s];
      var l = [e.x + sd[0] * s, e.y + sd[1] * s, e.z + sd[2] * s], r = [e.x - sd[0] * s, e.y - sd[1] * s, e.z - sd[2] * s];
      itemBatch.reserve(1);
      itemBatch.v(tail[0], tail[1], tail[2], uv[0], uv[3], L[0], L[1], L[2]);
      itemBatch.v(r[0], r[1], r[2], uv[2], uv[3], L[0], L[1], L[2]);
      itemBatch.v(head[0], head[1], head[2], uv[2], uv[1], L[0], L[1], L[2]);
      itemBatch.v(l[0], l[1], l[2], uv[0], uv[1], L[0], L[1], L[2]);
      itemBatch.quads++;
    });
    if (!e.proj && (e.stuck || e.age % 0.5 < 0.02)) e.light = lightAt(e.x, e.y, e.z);
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

  // ---- Сохранение -----------------------------------------------------------------
  function serialize() {
    var out = { mobs: [], items: [] };
    list.forEach(function (e) {
      if (e.dead) return;
      if (e.type === 'mob' && e.K.passive && !e.K.vehicle && e.deathT <= 0) out.mobs.push(serializeMob(e));
      if (e.type === 'vehicle') out.mobs.push(serializeVehicle(e));
      if (e.type === 'item') out.items.push({ i: e.stack.id, n: e.stack.n, d: e.stack.d, x: +e.x.toFixed(2), y: +e.y.toFixed(2), z: +e.z.toFixed(2), a: Math.round(e.age) });
    });
    return out;
  }
  function restore(data) {
    if (!data) return;
    (data.mobs || []).forEach(restoreMob);
    (data.items || []).forEach(function (o) {
      var e = dropItem(o.x, o.y, o.z, { id: o.i, n: o.n, d: o.d }, [0, 0, 0]);
      if (e) { e.age = o.a || 0; e.pickup = 0; }
    });
  }

  function init(w, h) {
    world = w; hooks = h || {};
    list.length = 0;
    siege.clear();
    world.onChunkGenerated = onChunkGenerated;
  }

  KC.Entities = {
    init: init, update: update, list: list, KINDS: KINDS,
    physics: physics, move: move, boxHits: boxHits, senseLiquids: senseLiquids, lightAt: lightAt, sunVis: sunVis,
    dropItem: dropItem, dropDrops: dropDrops, spawnMob: spawnMob, damageMob: damageMob,
    shootArrow: shootArrow, launchArrow: launchArrow, shootBolt: shootBolt, throwItem: throwItem, gravityAt: gravityAt, alertHorde: alertHorde, spawnTnt: spawnTnt, spawnFalling: spawnFalling,
    raycast: raycast, buildRender: buildRender, onChunkUnload: onChunkUnload, noise: noise,
    VEHICLES: VEHICLES, spawnVehicle: spawnVehicle, damageVehicle: damageVehicle, vehicleDist: vehicleDist, vHits: vHits,
    raycastVehicles: raycastVehicles, exitSpot: exitSpot, fireCannon: fireCannon, vFwd: vFwd,
    serialize: serialize, restore: restore, Ent: Ent, plateCheck: plateCheck
  };
})(window.KC = window.KC || {});
