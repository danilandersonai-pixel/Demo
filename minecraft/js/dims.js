/* Кубокрафт — измерения: настройки (небо, гравитация, свет) и генераторы чанков
   для Пекла, Небес, Космической станции и Мегаполиса (режим зомби-апокалипсиса).
   Генерация — чистая функция координат, поэтому чанки можно создавать в любом порядке. */
(function (KC) {
  'use strict';

  var B = KC.B, I = KC.I, H = KC.H, CS = 16, LAYER = 256;
  var hash2 = KC.hash2, hash3 = KC.hash3;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mod(a, n) { return ((a % n) + n) % n; }

  // ---- Настройки измерений --------------------------------------------------------
  var DIMS = {
    over: { name: 'Обычный мир', gravity: 1 },
    hell: { name: 'Пекло', gravity: 1, fixedDay: 0.34, top: [0.2, 0.04, 0.03], hor: [0.42, 0.1, 0.04], noSun: true, noClouds: true, fogNear: 0.35, noSky: true },
    heaven: { name: 'Небеса', gravity: 0.8, fixedTime: 0.23, top: [0.36, 0.56, 0.96], hor: [0.9, 0.88, 0.97], cloudsY: 40, fogNear: 0.72 },
    space: { name: 'Космическая станция', gravity: 0.25, fixedTime: 0.2, top: [0.0, 0.0, 0.012], hor: [0.01, 0.012, 0.03], stars: 1, planet: true, noClouds: true, vacuum: true, dayLight: 0.9 }
  };

  function put(c, lx, y, lz, id, meta) {
    if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 0 || y >= H) return false;
    var k = lx + lz * CS + y * LAYER;
    c.blocks[k] = id; c.meta[k] = meta | 0;
    return true;
  }
  function getc(c, lx, y, lz) {
    if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 0 || y >= H) return -1;
    return c.blocks[lx + lz * CS + y * LAYER];
  }

  // =================================================================================
  // Пекло: пещеры из пепельного камня над лавовым морем
  // =================================================================================
  var HELL_LAVA = 24;
  function hell(world, c) {
    var n = world.noise, n2 = world.caveNoise, seed = world.seed, b = c.blocks, m = c.meta;
    var ox = c.cx * CS, oz = c.cz * CS, x, y, z;
    for (z = 0; z < CS; z++) for (x = 0; x < CS; x++) {
      var wx = ox + x, wz = oz + z;
      var magmaZone = n.n2(wx * 0.05 + 3.3, wz * 0.05 - 7.7) > 0.42;
      for (y = 0; y < H; y++) {
        var id;
        if (y === 0 || y >= H - 2 || (y === 1 && hash3(wx, y, wz, seed) < 0.5) || (y === H - 3 && hash3(wx, y, wz, seed) < 0.5)) id = B.BEDROCK;
        else {
          var d = n.n3(wx * 0.028, y * 0.05, wz * 0.028) + 0.45 * n2.n3(wx * 0.07 + 5.5, y * 0.1, wz * 0.07 - 2.5);
          d += Math.max(0, (20 - y) / 20) * 1.3 + Math.max(0, (y - 74) / 18) * 1.6 - 0.08;
          if (d > 0) {
            id = B.ASHSTONE;
            var r = hash3(wx, y, wz, seed + 31);
            if (r < 0.016) id = B.SULFUR_ORE;
            else if (r < 0.0205 && y < 50) id = B.BLOOD_ORE;
            else if (magmaZone && y < 34) id = B.MAGMA;
          } else id = y <= HELL_LAVA ? B.LAVA : 0;
        }
        b[x + z * CS + y * LAYER] = id;
      }
      // украшения: пепел и огнецветы на полу, светокорень под сводом
      for (y = HELL_LAVA + 1; y < H - 3; y++) {
        var k = x + z * CS + y * LAYER, cur = b[k];
        if (cur === B.ASHSTONE && !b[k + LAYER]) {
          var hr = hash3(wx, y, wz, seed + 41);
          if (n.n2(wx * 0.08, wz * 0.08) > 0.35) b[k] = B.ASH_BLOCK;
          else if (hr < 0.03) b[k + LAYER] = B.FIREFLOWER;
        } else if (cur === B.ASHSTONE && !b[k - LAYER] && hash3(wx, y, wz, seed + 43) < 0.05) {
          b[k - LAYER] = B.GLOWROOT;
        }
      }
    }
    void m;
  }

  // =================================================================================
  // Небеса: парящие острова над морем облаков
  // =================================================================================
  function heavenColumn(world, wx, wz, out) {
    var n = world.noise;
    var mk = n.fbm2(wx * 0.011 + 300.5, wz * 0.011 - 120.3, 3) + 0.35 * n.n2(wx * 0.04, wz * 0.04);
    out.top = -1; out.top2 = -1;
    if (mk > 0.07) {
      var h = 54 + Math.floor(n.n2(wx * 0.02 + 50.5, wz * 0.02 + 9.1) * 10 + (mk - 0.07) * 30);
      var thick = Math.floor((mk - 0.07) * 55 + 3 + n.n2(wx * 0.08, wz * 0.08) * 3);
      out.top = Math.min(84, h);
      out.bottom = out.top - Math.max(2, thick);
    }
    var m2 = n.n2(wx * 0.03 + 777.7, wz * 0.03 - 333.3);
    if (m2 > 0.52) { out.top2 = 86 + Math.floor((m2 - 0.52) * 16); out.bottom2 = out.top2 - Math.floor((m2 - 0.52) * 30) - 1; }
    out.cloud = n.n2(wx * 0.05 + 11.1, wz * 0.05 + 22.2);
    return out;
  }

  function heaven(world, c) {
    var seed = world.seed, ox = c.cx * CS, oz = c.cz * CS, G = 3, P = CS + G * 2;
    var tops = new Int16Array(P * P), col = {}, x, z, y;
    for (z = 0; z < P; z++) for (x = 0; x < P; x++) {
      heavenColumn(world, ox + x - G, oz + z - G, col);
      tops[x + z * P] = col.top;
      if (x >= G && z >= G && x < G + CS && z < G + CS) {
        var lx = x - G, lz = z - G, wx = ox + lx, wz = oz + lz;
        // море облаков
        if (col.cloud > -0.4) {
          var ct = 20 + (col.cloud > 0.2 ? 1 : 0), cb = 17 - (col.cloud > 0.4 ? 1 : 0);
          for (y = cb; y <= ct; y++) put(c, lx, y, lz, B.CLOUD);
        }
        var fill = function (top, bottom) {
          for (var yy = Math.max(1, bottom); yy <= top; yy++) {
            var id = yy === top ? B.GOLDEN_GRASS : yy >= top - 3 ? B.LIGHT_SOIL : (hash3(wx, yy, wz, seed + 51) < 0.012 ? B.SKY_CRYSTAL : B.SKYSTONE);
            put(c, lx, yy, lz, id);
          }
          if (hash2(wx, wz, seed + 53) < 0.045 && top + 1 < H) put(c, lx, top + 1, lz, hash2(wx, wz, seed + 54) < 0.4 ? B.HALO_FLOWER : B.TALL_GRASS);
        };
        if (col.top > 0) fill(col.top, col.bottom);
        if (col.top2 > 0) fill(col.top2, col.bottom2);
      }
    }
    // небесные деревья
    for (z = 1; z < P - 1; z++) for (x = 1; x < P - 1; x++) {
      var t = tops[x + z * P];
      if (t <= 0 || t > 78) continue;
      var gx = ox + x - G, gz = oz + z - G;
      if (hash2(gx, gz, seed + 57) > 0.018) continue;
      var lx2 = x - G, lz2 = z - G, th = 4 + Math.floor(hash2(gx, gz, seed + 58) * 3), crown = t + th;
      for (var dy = -2; dy <= 2; dy++) for (var dz = -3; dz <= 3; dz++) for (var dx = -3; dx <= 3; dx++) {
        var d2 = dx * dx + dz * dz + dy * dy * 1.6;
        if (d2 > 9.5 || hash3(gx + dx, crown + dy, gz + dz, seed) < 0.12) continue;
        if (getc(c, lx2 + dx, crown + dy, lz2 + dz) === 0) put(c, lx2 + dx, crown + dy, lz2 + dz, B.BLOSSOM);
      }
      for (var ty = 1; ty <= th; ty++) put(c, lx2, t + ty, lz2, B.SKY_LOG);
    }
  }

  // =================================================================================
  // Космическая станция: модули, коридоры, солнечные крылья, астероиды
  // =================================================================================
  var SY = 48;                       // уровень пола станции
  var SHELLS = [], CARVES = [], FEATURES = [], SOLAR = [];
  function shell(x0, y0, z0, x1, y1, z1, style) { SHELLS.push([x0, y0, z0, x1, y1, z1, style || 'hull']); CARVES.push([x0 + 1, y0 + 1, z0 + 1, x1 - 1, y1 - 1, z1 - 1]); }
  function corridor(x0, y0, z0, x1, y1, z1, axis) {
    SHELLS.push([x0, y0, z0, x1, y1, z1, 'corridor']);
    if (axis === 'x') CARVES.push([x0 - 1, y0 + 1, z0 + 1, x1 + 1, y1 - 1, z1 - 1]);
    else CARVES.push([x0 + 1, y0 + 1, z0 - 1, x1 - 1, y1 - 1, z1 + 1]);
  }
  function feat(x, y, z, id, meta) { FEATURES.push([x, y, z, id, meta | 0]); }

  (function buildStation() {
    // центральный узел и четыре модуля
    shell(-9, SY, -9, 9, SY + 10, 9, 'hull');
    corridor(9, SY, -3, 27, SY + 6, 3, 'x');
    corridor(-27, SY, -3, -9, SY + 6, 3, 'x');
    corridor(-3, SY, -27, 3, SY + 6, -9, 'z');
    corridor(-3, SY, 9, 3, SY + 6, 27, 'z');
    shell(27, SY, -10, 47, SY + 10, 10, 'glass');    // оранжерея (восток)
    shell(-47, SY, -10, -27, SY + 10, 10, 'hull');   // лаборатория (запад)
    shell(-10, SY, -47, 10, SY + 10, -27, 'window'); // стыковочный отсек (север)
    shell(-10, SY, 27, 10, SY + 10, 47, 'dark');     // реактор (юг)
    // узел: жилой отсек
    [[-7, -7], [-5, -7], [-3, -7]].forEach(function (p) { feat(p[0], SY + 1, p[1], B.BED, 0); });
    feat(-7, SY + 1, 6, B.CHEST, 0); feat(-6, SY + 1, 6, B.CHEST, 0);
    feat(6, SY + 1, 6, B.TABLE, 0); feat(7, SY + 1, 6, B.FURNACE, 2);
    feat(6, SY + 1, -7, B.CONSOLE, 0); feat(7, SY + 1, -7, B.CONSOLE, 0);
    // оранжерея: грядки с пшеницей и маленькие деревья
    for (var gx = 30; gx <= 44; gx++) for (var gz = -7; gz <= 7; gz++) {
      var edge = gz === -7 || gz === 7 || gx === 30 || gx === 44;
      var row = gz % 3 === 0;
      feat(gx, SY, gz, edge || row ? B.GRASS : B.FARMLAND, row || edge ? 0 : 1);
      if (!edge && !row) feat(gx, SY + 1, gz, B.WHEAT, (gx * 7 + gz * 3) & 7);
      if (row && !edge && gx % 5 === 0) feat(gx, SY + 1, gz, B.WATER, 0);
    }
    [[33, -4], [41, 4]].forEach(function (p) {
      for (var t = 1; t <= 4; t++) feat(p[0], SY + t, p[1], B.LOG, 0);
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) for (var dy = 4; dy <= 5; dy++) if (dx || dz || dy === 5) feat(p[0] + dx, SY + dy, p[1] + dz, B.LEAVES, 2);
    });
    // лаборатория
    for (var lx = -44; lx <= -30; lx += 3) { feat(lx, SY + 1, -7, B.CONSOLE, 0); feat(lx, SY + 1, 7, B.BOOKSHELF, 0); }
    feat(-37, SY + 1, 0, B.TABLE, 0); feat(-36, SY + 1, 0, B.CHEST, 1); feat(-38, SY + 1, 0, B.CHEST, 1);
    feat(-33, SY + 1, 2, B.LAMP, 1); feat(-41, SY + 1, -2, B.LAMP, 1);
    // стыковочный отсек: телепорт и «шаттл» за окном
    feat(0, SY, -37, B.TELEPORTER, 0);
    feat(-8, SY + 1, -44, B.CONSOLE, 2); feat(8, SY + 1, -44, B.CONSOLE, 2); feat(0, SY + 1, -44, B.CHEST, 0);
    for (var sz = -60; sz <= -52; sz++) for (var sx = -3; sx <= 3; sx++) for (var syy = SY + 2; syy <= SY + 6; syy++) {
      var inside = Math.abs(sx) + Math.abs(syy - (SY + 4)) <= 3 - (sz < -58 ? 1 : 0);
      if (inside) feat(sx, syy, sz, sz === -52 || Math.abs(sx) + Math.abs(syy - (SY + 4)) === 3 - (sz < -58 ? 1 : 0) ? B.HULL : B.HULL_DARK, 0);
    }
    feat(0, SY + 5, -61, B.WINDOW, 0); feat(0, SY + 4, -61, B.WINDOW, 0);
    // реактор: столб лавы за стеклом и искроблоки
    for (var ry = SY + 1; ry <= SY + 9; ry++) {
      feat(0, ry, 37, B.LAVA, 0);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { feat(d[0], ry, 37 + d[1], B.WINDOW, 0); });
    }
    [[-5, 32], [5, 32], [-5, 42], [5, 42]].forEach(function (p) { for (var yy = SY + 1; yy <= SY + 3; yy++) feat(p[0], yy, p[1], B.SPARK_BLOCK, 0); feat(p[0], SY + 4, p[1], B.LAMP, 1); });
    feat(0, SY + 1, 30, B.CONSOLE, 0); feat(-7, SY + 1, 44, B.CHEST, 0);
    // солнечные крылья над станцией
    SOLAR.push([-44, SY + 16, -6, 44, SY + 16, 6]);
    for (var ty = SY + 11; ty <= SY + 15; ty++) feat(0, ty, 0, B.HULL_DARK, 0);
  })();

  function inBox(x, y, z, bx) { return x >= bx[0] && x <= bx[3] && y >= bx[1] && y <= bx[4] && z >= bx[2] && z <= bx[5]; }

  function space(world, c) {
    var seed = world.seed, ox = c.cx * CS, oz = c.cz * CS, x, y, z, i;
    var x1 = ox + CS - 1, z1 = oz + CS - 1;
    function overlaps(bx) { return bx[3] >= ox && bx[0] <= x1 && bx[5] >= oz && bx[2] <= z1; }
    // оболочки модулей
    SHELLS.forEach(function (s) {
      if (!overlaps(s)) return;
      for (var yy = s[1]; yy <= s[4]; yy++) for (var zz = Math.max(s[2], oz); zz <= Math.min(s[5], z1); zz++) for (var xx = Math.max(s[0], ox); xx <= Math.min(s[3], x1); xx++) {
        var onX = xx === s[0] || xx === s[3], onZ = zz === s[2] || zz === s[5], id;
        if (yy === s[1]) id = s[6] === 'glass' ? B.GRASS : B.GRATE;
        else if (yy === s[4]) id = ((xx - s[0]) % 4 === 2 && (zz - s[2]) % 4 === 2) ? B.LIGHT_PANEL : (s[6] === 'dark' ? B.HULL_DARK : B.HULL);
        else if (onX || onZ) {
          var band = yy - s[1];
          var win = s[6] === 'glass' ? band >= 2 && band <= s[4] - s[1] - 2 : (s[6] === 'window' || s[6] === 'hull') && (band === 3 || band === 4) && ((xx + zz) & 3) !== 0;
          id = win ? B.WINDOW : (s[6] === 'dark' ? B.HULL_DARK : B.HULL);
          if (s[6] === 'corridor') id = band === 3 && ((xx + zz) & 3) === 1 ? B.WINDOW : B.HULL;
        } else continue;
        put(c, xx - ox, yy, zz - oz, id);
      }
    });
    CARVES.forEach(function (s) {
      if (!overlaps(s)) return;
      for (var yy = s[1]; yy <= s[4]; yy++) for (var zz = Math.max(s[2], oz); zz <= Math.min(s[5], z1); zz++) for (var xx = Math.max(s[0], ox); xx <= Math.min(s[3], x1); xx++) {
        // не вырезаем пол и потолок соседних модулей
        var inShellFloor = false;
        for (var k = 0; k < SHELLS.length; k++) { var sh = SHELLS[k]; if (inBox(xx, yy, zz, sh) && (yy === sh[1] || yy === sh[4])) { inShellFloor = true; break; } }
        if (!inShellFloor) put(c, xx - ox, yy, zz - oz, 0);
      }
    });
    SOLAR.forEach(function (s) {
      if (!overlaps(s)) return;
      for (var zz = Math.max(s[2], oz); zz <= Math.min(s[5], z1); zz++) for (var xx = Math.max(s[0], ox); xx <= Math.min(s[3], x1); xx++) {
        put(c, xx - ox, s[1], zz - oz, (xx % 8 === 0 || zz === 0) ? B.HULL_DARK : B.SOLAR);
      }
    });
    for (i = 0; i < FEATURES.length; i++) {
      var f = FEATURES[i];
      if (f[0] < ox || f[0] > x1 || f[2] < oz || f[2] > z1) continue;
      put(c, f[0] - ox, f[1], f[2] - oz, f[3], f[4]);
      if (f[3] === B.CHEST) (c.loot = c.loot || []).push([f[0], f[1], f[2], 'space']);
    }
    // астероиды: по одной глыбе на ячейку 24×24, вдали от станции
    var CELL = 24;
    for (var cz = Math.floor((oz - 8) / CELL); cz <= Math.floor((z1 + 8) / CELL); cz++) for (var cx = Math.floor((ox - 8) / CELL); cx <= Math.floor((x1 + 8) / CELL); cx++) {
      if (hash2(cx, cz, seed + 61) > 0.55) continue;
      var ax = cx * CELL + Math.floor(hash2(cx, cz, seed + 62) * CELL), az = cz * CELL + Math.floor(hash2(cx, cz, seed + 63) * CELL);
      var ay = 18 + Math.floor(hash2(cx, cz, seed + 64) * 66), rad = 2 + hash2(cx, cz, seed + 65) * 3.5;
      if (Math.abs(ax) < 62 && Math.abs(az) < 68 && ay > SY - 10 && ay < SY + 24) continue;
      for (z = Math.max(oz, Math.floor(az - rad)); z <= Math.min(z1, Math.ceil(az + rad)); z++)
        for (x = Math.max(ox, Math.floor(ax - rad)); x <= Math.min(x1, Math.ceil(ax + rad)); x++)
          for (y = Math.floor(ay - rad); y <= Math.ceil(ay + rad); y++) {
            var d = Math.sqrt((x - ax) * (x - ax) + (y - ay) * (y - ay) * 1.3 + (z - az) * (z - az));
            if (d > rad + (hash3(x, y, z, seed) - 0.5) * 1.2) continue;
            put(c, x - ox, y, z - oz, hash3(x, y, z, seed + 66) < 0.09 ? B.METEOR_ORE : B.ASTEROID);
          }
    }
  }

  // Внутри станции (под крышей модуля) — для воздуха
  function inStation(x, y, z) {
    for (var i = 0; i < CARVES.length; i++) if (inBox(Math.floor(x), Math.floor(y), Math.floor(z), CARVES[i])) return true;
    return false;
  }

  // =================================================================================
  // Мегаполис: кварталы 40×40 — дорога 8, тротуары, участок 28×28 под здание
  // =================================================================================
  var CELL_C = 40, GROUND = 31;

  function plotInfo(seed, cxI, czI) {
    var r = hash2(cxI, czI, seed + 71);
    var info = { cx: cxI, cz: czI, x0: cxI * CELL_C + 10, z0: czI * CELL_C + 10, size: 28 };
    if (r < 0.09) info.kind = 'park';
    else if (r < 0.15) info.kind = 'parking';
    else if (r < 0.22) info.kind = 'ruin';
    else {
      info.kind = 'building';
      var t = hash2(cxI, czI, seed + 72);
      var inset = 2 + Math.floor(hash2(cxI, czI, seed + 73) * 3);
      info.bx0 = info.x0 + inset; info.bz0 = info.z0 + inset;
      info.bx1 = info.x0 + 27 - inset; info.bz1 = info.z0 + 27 - inset;
      if (t > 0.62) { info.style = 'tower'; info.floors = 9 + Math.floor(hash2(cxI, czI, seed + 74) * 6); }
      else if (t > 0.3) { info.style = 'office'; info.floors = 4 + Math.floor(hash2(cxI, czI, seed + 74) * 3); }
      else { info.style = 'apart'; info.floors = 4 + Math.floor(hash2(cxI, czI, seed + 74) * 4); }
      info.top = GROUND + info.floors * 4;         // уровень крыши
      if (info.top > H - 6) { info.floors = Math.floor((H - 6 - GROUND) / 4); info.top = GROUND + info.floors * 4; }
    }
    return info;
  }

  function city(world, c) {
    var seed = world.seed, ox = c.cx * CS, oz = c.cz * CS, x, y, z;
    var plots = {};
    function plotAt(wx, wz) {
      var cxI = Math.floor(wx / CELL_C), czI = Math.floor(wz / CELL_C), k = cxI + ',' + czI;
      return plots[k] || (plots[k] = plotInfo(seed, cxI, czI));
    }
    for (z = 0; z < CS; z++) for (x = 0; x < CS; x++) {
      var wx = ox + x, wz = oz + z;
      var lx = mod(wx, CELL_C), lz = mod(wz, CELL_C);
      put(c, x, 0, z, B.BEDROCK);
      for (y = 1; y < GROUND - 3; y++) put(c, x, y, z, B.STONE);
      for (y = GROUND - 3; y < GROUND; y++) put(c, x, y, z, B.DIRT);
      var road = lx < 8 || lz < 8;
      var walk = !road && (lx < 10 || lx >= 38 || lz < 10 || lz >= 38);
      if (road) {
        var id = B.ASPHALT, meta = 0;
        if (lx < 8 && lz < 8) {
          if (lz === 0 || lz === 7 || lx === 0 || lx === 7) { id = B.ROAD_LINE; meta = 2; }
        } else if (lx < 8 && (lx === 3 || lx === 4) && mod(wz, 6) < 3) { id = B.ROAD_LINE; meta = 1; }
        else if (lz < 8 && (lz === 3 || lz === 4) && mod(wx, 6) < 3) { id = B.ROAD_LINE; meta = 0; }
        // трещины и воронки на брошенных дорогах
        if (id === B.ASPHALT && hash2(wx, wz, seed + 75) < 0.012) id = B.RUBBLE;
        put(c, x, GROUND, z, id, meta);
      } else if (walk) {
        put(c, x, GROUND, z, B.SIDEWALK);
        // фонари на углах и серединах кварталов
        var lampSpot = (lx === 9 || lx === 38) && (lz === 9 || lz === 38 || lz === 23) || (lz === 9 || lz === 38) && lx === 23;
        if (lampSpot) {
          for (y = GROUND + 1; y <= GROUND + 5; y++) put(c, x, y, z, B.STREET_POLE);
          put(c, x, GROUND + 6, z, hash2(wx, wz, seed + 76) < 0.35 ? B.CONCRETE_DARK : B.STREET_LAMP);
        }
      } else {
        cityPlotColumn(c, x, z, wx, wz, plotAt(wx, wz), seed);
      }
    }
    // машины на дорогах: слоты вдоль каждой улицы квартала
    var cells = {};
    for (z = oz - 8; z <= oz + CS + 8; z += 8) for (x = ox - 8; x <= ox + CS + 8; x += 8) cells[Math.floor(x / CELL_C) + ',' + Math.floor(z / CELL_C)] = 1;
    Object.keys(cells).forEach(function (k) {
      var p = k.split(',').map(Number), bx = p[0] * CELL_C, bz = p[1] * CELL_C;
      for (var s = 0; s < 6; s++) {
        var r = hash2(p[0] * 13 + s, p[1] * 7 - s, seed + 77);
        if (r > 0.4) continue;
        var alongX = s % 2 === 0, lane = hash2(p[0], p[1] * 3 + s, seed + 78) < 0.5 ? 1 : 5;
        var along = 10 + Math.floor(hash2(p[0] + s, p[1], seed + 79) * 24);
        var col = [B.CAR_RED, B.CAR_BLUE, B.CAR_WHITE][Math.floor(r * 7.5) % 3];
        for (var l = 0; l < 4; l++) for (var w = 0; w < 2; w++) {
          var cx2 = alongX ? bx + along + l : bx + lane + w;
          var cz2 = alongX ? bz + lane + w : bz + along + l;
          var llx = cx2 - ox, llz = cz2 - oz;
          put(c, llx, GROUND + 1, llz, (l === 0 || l === 3) && w === (alongX ? 0 : 1) ? B.TIRE : col);
          if (l === 1 || l === 2) put(c, llx, GROUND + 2, llz, B.WINDOW);
        }
      }
    });
  }

  function cityPlotColumn(c, x, z, wx, wz, p, seed) {
    var y, px = wx - p.x0, pz = wz - p.z0;
    if (p.kind === 'park') {
      put(c, x, GROUND, z, B.GRASS);
      var d = Math.hypot(px - 13.5, pz - 13.5);
      if (d < 3) { put(c, x, GROUND, z, d < 2 ? B.WATER : B.STONE_BRICK); if (d >= 2) put(c, x, GROUND + 1, z, B.STONE_BRICK); return; }
      if (px % 9 === 4 && pz % 9 === 4) {                       // дерево
        for (y = 1; y <= 5; y++) put(c, x, GROUND + y, z, B.LOG);
        return;
      }
      // крона деревьев соседних клеток
      for (var tx = 4; tx < 28; tx += 9) for (var tz = 4; tz < 28; tz += 9) {
        var dx = px - tx, dz = pz - tz;
        if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2 && (dx || dz)) {
          for (y = 4; y <= 6; y++) if (!(Math.abs(dx) === 2 && Math.abs(dz) === 2) && (y < 6 || Math.abs(dx) + Math.abs(dz) <= 2)) put(c, x, GROUND + y, z, B.LEAVES, 2);
          return;
        }
      }
      if (px % 7 === 1 && pz === 13 && px > 2 && px < 26) put(c, x, GROUND + 1, z, B.PLANKS);  // скамейки
      else if (hash2(wx, wz, seed + 80) < 0.08) put(c, x, GROUND + 1, z, hash2(wx, wz, seed + 81) < 0.3 ? B.POPPY : B.TALL_GRASS);
      return;
    }
    if (p.kind === 'parking') {
      put(c, x, GROUND, z, (px % 4 === 0 && pz > 3 && pz < 24) ? B.ROAD_LINE : B.ASPHALT, 1);
      return;
    }
    if (p.kind === 'ruin') {
      put(c, x, GROUND, z, B.RUBBLE);
      var edge = px === 2 || pz === 2 || px === 25 || pz === 25;
      if (edge && px >= 2 && px <= 25 && pz >= 2 && pz <= 25) {
        var hgt = Math.floor(hash2(wx >> 1, wz >> 1, seed + 82) * 7);
        for (y = 1; y <= hgt; y++) put(c, x, GROUND + y, z, hash3(wx, y, wz, seed) < 0.2 ? B.RUBBLE : B.CONCRETE);
      } else if (hash2(wx, wz, seed + 83) < 0.1) put(c, x, GROUND + 1, z, B.RUBBLE);
      return;
    }
    // ---- здание ----
    put(c, x, GROUND, z, B.SIDEWALK);
    if (wx < p.bx0 || wx > p.bx1 || wz < p.bz0 || wz > p.bz1) return;
    var wallMat = p.style === 'tower' ? B.CONCRETE_DARK : p.style === 'office' ? B.CONCRETE : B.BRICK;
    var onX = wx === p.bx0 || wx === p.bx1, onZ = wz === p.bz0 || wz === p.bz1;
    var corner = onX && onZ;
    var shaftX = p.bx0 + 1, shaftZ = p.bz0 + 1;
    var midX = Math.floor((p.bx0 + p.bx1) / 2);
    for (y = GROUND; y <= p.top + 1; y++) {
      var rel = y - GROUND, floorLvl = rel % 4 === 0;
      var id = 0, meta = 0;
      if (y === p.top + 1) { if (onX || onZ) id = wallMat; }               // парапет на крыше
      else if (onX || onZ) {
        id = wallMat;
        var band = rel % 4;
        var along = onX ? wz : wx;
        if (!corner && (band === 2 || band === 3) && mod(along, 3) !== 0) id = hash3(wx, y, wz, seed + 84) < 0.14 ? 0 : B.WINDOW;
        // вход с улицы (северная стена)
        if (wz === p.bz0 && !onX && rel >= 1 && rel <= 3 && Math.abs(wx - midX) <= 1) id = 0;
      } else if (floorLvl) {
        id = rel === 0 ? B.TILE_FLOOR : (y === p.top ? wallMat : B.TILE_FLOOR);
        if (wx === shaftX && wz === shaftZ) id = 0;                          // шахта с лестницей
        else if (rel > 0 && y < p.top && (wx - p.bx0) % 6 === 3 && (wz - p.bz0) % 6 === 3 && hash2(p.cx * 31 + rel, p.cz, seed + 85) < 0.35) id = B.CEILING_LAMP;
      } else if (wx === shaftX && wz === shaftZ) {
        id = B.LADDER; meta = 1;                                              // опора — стена с запада
      } else if (rel % 4 === 1) {
        // мебель и добыча на этажах
        var fr = hash3(wx, y, wz, seed + 86);
        if (fr < 0.006) { id = B.CHEST; (c.loot = c.loot || []).push([wx, y, wz, p.style === 'tower' ? 'office' : 'city']); }
        else if (fr < 0.022) id = B.CRATE;
        else if (fr < 0.03) id = p.style === 'office' || p.style === 'tower' ? B.BOOKSHELF : B.BED;
        else if (fr < 0.036) id = B.TABLE;
      }
      if (id) put(c, x, y, z, id, meta);
    }
    // лестница продолжается сквозь крышу
    if (wx === shaftX && wz === shaftZ) put(c, x, p.top, z, B.LADDER, 1);
    // антенна на небоскрёбе
    if (p.style === 'tower' && wx === midX && wz === Math.floor((p.bz0 + p.bz1) / 2)) {
      for (y = p.top + 1; y <= Math.min(H - 3, p.top + 5); y++) put(c, x, y, z, B.STREET_POLE);
      put(c, x, Math.min(H - 2, p.top + 6), z, B.SPARK_BLOCK);
    }
  }

  // ---- Добыча в сундуках ---------------------------------------------------------------
  var LOOT = {
    city: [[I.CANNED_FOOD, 1, 3, 0.7], [I.BREAD, 1, 2, 0.4], [I.MEDKIT, 1, 1, 0.3], [I.AMMO, 4, 12, 0.35], [I.PISTOL, 1, 1, 0.08],
      [I.BAT, 1, 1, 0.15], [I.MACHETE, 1, 1, 0.07], [B.TORCH, 2, 8, 0.4], [I.APPLE, 1, 3, 0.3], [I.IRON_INGOT, 1, 3, 0.25], [I.STRING, 1, 3, 0.2]],
    office: [[I.PAPER, 2, 8, 0.6], [I.BOOK, 1, 2, 0.3], [I.CANNED_FOOD, 1, 2, 0.5], [I.MEDKIT, 1, 2, 0.35], [I.AMMO, 6, 16, 0.4],
      [I.PISTOL, 1, 1, 0.14], [I.MACHETE, 1, 1, 0.1], [I.SPARK_DUST, 2, 6, 0.3], [I.DIAMOND, 1, 1, 0.05]],
    space: [[I.SPACE_RATION, 2, 5, 0.9], [I.SPACE_HELMET, 1, 1, 0.6], [I.METEOR_IRON, 1, 4, 0.5], [I.LASER_CUTTER, 1, 1, 0.2],
      [I.DIAMOND, 1, 3, 0.35], [I.SPARK_DUST, 4, 12, 0.5], [B.LIGHT_PANEL, 2, 6, 0.4], [I.MEDKIT, 1, 2, 0.4]]
  };
  function rollLoot(table, x, y, z, seed) {
    var slots = new Array(27).fill(null), list = LOOT[table] || LOOT.city, k = 0;
    list.forEach(function (e, i) {
      var r = hash3(x + i * 17, y, z, seed + 90);
      if (r > e[3]) return;
      var n = e[1] + Math.floor(hash3(x, y + i, z, seed + 91) * (e[2] - e[1] + 1));
      var pos = Math.floor(hash3(x - i, y, z + i, seed + 92) * 27);
      while (slots[pos] && k++ < 60) pos = (pos + 7) % 27;
      slots[pos] = { id: e[0], n: n, d: 0 };
    });
    return slots;
  }

  // ---- Точки прибытия --------------------------------------------------------------------
  // Ищет безопасное место около x,z (чанки уже загружены); при неудаче строит площадку
  function arrival(world, dim, x0, z0) {
    x0 = Math.floor(x0); z0 = Math.floor(z0);
    function free(x, y, z) { return !KC.SOLID[world.getBlock(x, y, z)] && !KC.SOLID[world.getBlock(x, y + 1, z)] && !KC.LIQUID[world.getBlock(x, y, z)] && !KC.LIQUID[world.getBlock(x, y + 1, z)]; }
    if (dim === 'space') return { x: 0.5, y: SY + 1, z: -35.5, yaw: Math.PI };
    var yMin = dim === 'hell' ? HELL_LAVA + 2 : dim === 'heaven' ? 24 : 2, yMax = dim === 'hell' ? 80 : H - 3;
    for (var r = 0; r <= 24; r += 2) for (var a = 0; a < (r ? 12 : 1); a++) {
      var x = x0 + Math.round(Math.cos(a / 12 * Math.PI * 2) * r), z = z0 + Math.round(Math.sin(a / 12 * Math.PI * 2) * r);
      if (!world.isLoaded(x, z)) continue;
      var ys = dim === 'heaven' ? [] : null;
      for (var y = yMax; y >= yMin; y--) {
        var below = world.getBlock(x, y - 1, z);
        if (KC.OPAQUE[below] && below !== B.MAGMA && free(x, y, z)) {
          if (dim === 'heaven' && below === B.CLOUD) { if (ys) ys.push(y); continue; }
          return { x: x + 0.5, y: y, z: z + 0.5 };
        }
      }
    }
    // площадка
    var py = dim === 'hell' ? 40 : dim === 'heaven' ? 60 : 70;
    var mat = dim === 'hell' ? B.ASH_BRICK : dim === 'heaven' ? B.CLOUD : B.COBBLE;
    for (var dx = -2; dx <= 2; dx++) for (var dz = -2; dz <= 2; dz++) {
      world.setBlock(x0 + dx, py - 1, z0 + dz, mat, 0);
      for (var dy = 0; dy <= 3; dy++) world.setBlock(x0 + dx, py + dy, z0 + dz, 0, 0);
    }
    return { x: x0 + 0.5, y: py, z: z0 + 0.5 };
  }

  // Мир для режима зомби: точка появления на перекрёстке
  function citySpawn() { return { x: 4.5, h: GROUND, z: 20.5 }; }

  KC.DIMS = DIMS;
  KC.Gen = {
    hell: hell, heaven: heaven, space: space, city: city,
    rollLoot: rollLoot, arrival: arrival, inStation: inStation, citySpawn: citySpawn,
    CITY_GROUND: GROUND, STATION_Y: SY, HELL_LAVA: HELL_LAVA
  };
})(window.KC = window.KC || {});
