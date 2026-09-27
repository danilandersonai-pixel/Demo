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
  // Мегаполис: кварталы 40×40 — дорога 8, тротуары, участок 28×28 под здание.
  // Город делится на районы: от района зависят здания, добыча и число заражённых.
  // =================================================================================
  var CELL_C = 40, GROUND = 31;

  // Сглаженный шум по клеткам квартала (0..1): соседние кварталы похожи
  function cellNoise(seed, x, z, scale, salt) {
    var fx = x / scale, fz = z / scale, x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    tx = tx * tx * (3 - 2 * tx); tz = tz * tz * (3 - 2 * tz);
    var a = hash2(x0, z0, seed + salt), b = hash2(x0 + 1, z0, seed + salt);
    var c = hash2(x0, z0 + 1, seed + salt), d = hash2(x0 + 1, z0 + 1, seed + salt);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  // Центр города — в 7–9 кварталах от точки старта; там же площадка эвакуации
  function cityCenter(seed) {
    var ang = hash2(1, 2, seed + 201) * Math.PI * 2, dist = 7 + Math.floor(hash2(3, 4, seed + 202) * 3);
    return { x: Math.round(Math.cos(ang) * dist), z: Math.round(Math.sin(ang) * dist) };
  }

  var DISTRICTS = {
    downtown: { name: 'Центр', note: 'много добычи и заражённых', danger: 1.6 },
    residential: { name: 'Спальный район', note: 'квартиры и магазины', danger: 1 },
    industrial: { name: 'Промзона', note: 'склады, стройки, громилы', danger: 1.25 },
    suburb: { name: 'Окраина', note: 'частные дома, тихо', danger: 0.5 }
  };
  function districtOf(seed, cxI, czI) {
    if (Math.abs(cxI) + Math.abs(czI) <= 1) return 'residential';      // тихое место старта
    var C = cityCenter(seed);
    var d = Math.hypot(cxI - C.x, czI - C.z) + (cellNoise(seed, cxI, czI, 3, 203) - 0.5) * 2.4;
    if (d < 3.3) return 'downtown';
    if (d > 12.5 + (cellNoise(seed, cxI, czI, 5, 204) - 0.5) * 6) return 'suburb';
    if (cellNoise(seed, cxI, czI, 4, 205) > 0.6) return 'industrial';
    return 'residential';
  }

  // Особые здания рядом со стартом есть всегда: без них не пройти сценарий
  var FORCED = [['police', 2, -1], ['hospital', -1, 2], ['market', 2, 1], ['gas', -2, -1]];
  function forcedKind(seed, cxI, czI) {
    var k = Math.floor(hash2(7, 7, seed + 211) * 4);
    for (var i = 0; i < FORCED.length; i++) {
      var fx = FORCED[i][1], fz = FORCED[i][2];
      for (var r = 0; r < k; r++) { var t = fx; fx = -fz; fz = t; }
      if (fx === cxI && fz === czI) return FORCED[i][0];
    }
    return null;
  }
  var SPECIAL_ODDS = {
    downtown: [['police', 0.05], ['hospital', 0.1], ['market', 0.14]],
    residential: [['police', 0.03], ['hospital', 0.06], ['market', 0.12], ['gas', 0.15]],
    industrial: [['gas', 0.07]],
    suburb: [['gas', 0.02], ['market', 0.035]]
  };
  var SPECIAL_NAMES = { police: 'Полицейский участок', hospital: 'Больница', market: 'Супермаркет', gas: 'Заправка', helipad: 'Площадка эвакуации' };

  var plotCache = new Map();
  function plotInfo(seed, cxI, czI) {
    var ck = seed + ':' + cxI + ',' + czI, hit = plotCache.get(ck);
    if (hit) return hit;
    if (plotCache.size > 6000) plotCache.clear();
    var dist = districtOf(seed, cxI, czI);
    var info = { cx: cxI, cz: czI, x0: cxI * CELL_C + 10, z0: czI * CELL_C + 10, size: 28, district: dist };
    var C = cityCenter(seed);
    var r = hash2(cxI, czI, seed + 71), r2 = hash2(cxI, czI, seed + 212);
    var special = cxI === C.x && czI === C.z ? 'helipad' : forcedKind(seed, cxI, czI);
    if (!special && Math.abs(cxI) + Math.abs(czI) > 1) {
      var odds = SPECIAL_ODDS[dist] || [];
      for (var i = 0; i < odds.length; i++) if (r2 < odds[i][1]) { special = odds[i][0]; break; }
    }
    info.special = special;
    var inset = 2 + Math.floor(hash2(cxI, czI, seed + 73) * 3);
    function building(style, floors) {
      info.kind = 'building'; info.style = style;
      if (style === 'helipad' || style === 'police') inset = 2;
      info.bx0 = info.x0 + inset; info.bz0 = info.z0 + inset;
      info.bx1 = info.x0 + 27 - inset; info.bz1 = info.z0 + 27 - inset;
      info.floors = floors;
      info.top = GROUND + floors * 4;
      if (info.top > H - 6) { info.floors = Math.floor((H - 6 - GROUND) / 4); info.top = GROUND + info.floors * 4; }
    }
    var f = hash2(cxI, czI, seed + 74);
    if (special === 'helipad') building('helipad', 10);
    else if (special === 'hospital') building('hospital', 4 + Math.floor(f * 2));
    else if (special === 'police') building('police', 3);
    else if (special === 'market') { info.kind = 'market'; info.bx0 = info.x0 + 1; info.bx1 = info.x0 + 26; info.bz0 = info.z0 + 2; info.bz1 = info.z0 + 25; info.top = GROUND + 6; info.floors = 1; }
    else if (special === 'gas') { info.kind = 'gas'; info.bx0 = info.x0 + 20; info.bx1 = info.x0 + 26; info.bz0 = info.z0 + 3; info.bz1 = info.z0 + 12; info.top = GROUND + 4; info.floors = 1; }
    else if (dist === 'suburb') info.kind = r < 0.1 ? 'park' : r < 0.14 ? 'ruin' : 'houses';
    else if (dist === 'industrial') {
      if (r < 0.1) info.kind = 'parking';
      else if (r < 0.18) info.kind = 'ruin';
      else if (r < 0.62) { info.kind = 'warehouse'; info.bx0 = info.x0 + 2; info.bx1 = info.x0 + 25; info.bz0 = info.z0 + 3; info.bz1 = info.z0 + 24; info.top = GROUND + 8; info.floors = 1; }
      else if (r < 0.88) { info.kind = 'construction'; info.floors = 3 + Math.floor(f * 4); info.bx0 = info.x0 + 3; info.bx1 = info.x0 + 22; info.bz0 = info.z0 + 4; info.bz1 = info.z0 + 23; info.top = GROUND + info.floors * 4; }
      else building('office', 2 + Math.floor(f * 2));
    } else if (dist === 'downtown') {
      if (r < 0.05) info.kind = 'park';
      else if (r < 0.12) info.kind = 'parking';
      else if (r < 0.22) info.kind = 'ruin';
      else if (hash2(cxI, czI, seed + 72) > 0.35) building('tower', 10 + Math.floor(f * 5));
      else building('office', 5 + Math.floor(f * 4));
    } else {
      if (r < 0.12) info.kind = 'park';
      else if (r < 0.17) info.kind = 'parking';
      else if (r < 0.22) info.kind = 'ruin';
      else {
        var t = hash2(cxI, czI, seed + 72);
        if (t > 0.8) building('tower', 8 + Math.floor(f * 4));
        else if (t > 0.5) building('office', 4 + Math.floor(f * 3));
        else building('apart', 4 + Math.floor(f * 4));
      }
    }
    // район с высотками: центр чаще разрушен
    plotCache.set(ck, info);
    return info;
  }

  // Метро: линии под дорогами кварталов с номером ≡ 2 (mod 4), станции на пересечениях линий
  var M_FLOOR = GROUND - 10;          // пол туннеля (21); внутри 22–26, зал — до 27
  function metroCell(i, l) {           // номер клетки станции для координаты внутри клетки i (l — локальная)
    if (mod(i, 4) === 2 && l <= 23) return i;             // зал до 13, дальше лестница и знак у входа
    if (mod(i + 1, 4) === 2 && l >= 34) return i + 1;
    return null;
  }
  function metroColumn(c, x, z, wx, wz, seed) {
    var cxI = Math.floor(wx / CELL_C), czI = Math.floor(wz / CELL_C), lx = mod(wx, CELL_C), lz = mod(wz, CELL_C), y;
    var sCx = metroCell(cxI, lx), sCz = metroCell(czI, lz);
    if (sCx !== null && sCz !== null) {
      var rx = wx - sCx * CELL_C, rz = wz - sCz * CELL_C;
      // лестница вниз вдоль тротуара: с поверхности до зала
      if ((rz === 8 || rz === 9) && rx >= 14 && rx <= 22) {
        var s = 22 - rx;
        put(c, x, 30 - s, z, B.CONCRETE);
        for (y = 31 - s; y <= GROUND; y++) put(c, x, y, z, 0);
        for (y = GROUND + 1; y < GROUND + 7; y++) put(c, x, y, z, 0);
        return;
      }
      if (rx === 23 && rz === 9) {                                       // знак метро у входа
        for (y = GROUND + 1; y <= GROUND + 3; y++) put(c, x, y, z, B.STREET_POLE);
        put(c, x, GROUND + 4, z, B.METRO_SIGN);
        put(c, x, GROUND + 5, z, 0); put(c, x, GROUND + 6, z, 0);
        return;
      }
      if (rx >= -6 && rx <= 13 && rz >= -6 && rz <= 13) {
        var wall = rx === -6 || rx === 13 || rz === -6 || rz === 13;
        var door = (rx === 13 && (rz === 8 || rz === 9)) || ((rx === -6 || rx === 13) && rz >= 1 && rz <= 6) || ((rz === -6 || rz === 13) && rx >= 1 && rx <= 6);
        var rail = (rx === 3 || rx === 4) ? 1 : (rz === 3 || rz === 4) ? 0 : -1;
        put(c, x, M_FLOOR, z, rail >= 0 ? B.RAIL_FLOOR : B.TILE_FLOOR, rail >= 0 ? rail : 0);
        for (y = M_FLOOR + 1; y <= M_FLOOR + 6; y++) {
          var id = 0;
          if (wall && !(door && y <= M_FLOOR + 5)) id = B.CONCRETE;
          else if ((rx === -2 || rx === 9) && (rz === -2 || rz === 9)) id = B.CONCRETE;          // колонны
          put(c, x, y, z, id);
        }
        var lamp = mod(rx, 5) === 2 && mod(rz, 5) === 2 && hash2(wx, wz, seed + 230) < 0.7;
        put(c, x, M_FLOOR + 7, z, lamp ? B.CEILING_LAMP : B.CONCRETE);
        if (rz === 11 && (rx === -3 || rx === -2 || rx === 7 || rx === 8)) put(c, x, M_FLOOR + 1, z, B.PLANKS);   // скамейки
        if (rx === -5 && rz === 12 && hash2(sCx, sCz, seed + 231) < 0.85) { put(c, x, M_FLOOR + 1, z, B.CHEST, 1); (c.loot = c.loot || []).push([wx, M_FLOOR + 1, wz, 'metro']); }
        return;
      }
    }
    // туннели
    var alongZ = mod(cxI, 4) === 2 && lx <= 7, alongX = mod(czI, 4) === 2 && lz <= 7;
    if (!alongZ && !alongX) return;
    var a = alongZ ? lx : lz, run = alongZ ? wz : wx;
    var wallT = a === 0 || a === 7;
    put(c, x, M_FLOOR, z, (a === 3 || a === 4) ? B.RAIL_FLOOR : B.CONCRETE_DARK, alongZ ? 1 : 0);
    for (y = M_FLOOR + 1; y <= M_FLOOR + 5; y++) put(c, x, y, z, wallT ? B.CONCRETE_DARK : 0);
    var tl = a === 3 && mod(run, 12) === 0 && hash2(wx, wz, seed + 232) < 0.5;
    put(c, x, M_FLOOR + 6, z, tl ? B.CEILING_LAMP : B.CONCRETE_DARK);
    // брошенный вагон на одном пути
    if ((a === 5 || a === 6) && hash2(Math.floor(run / 30), alongZ ? cxI : czI, seed + 233) < 0.3 && mod(run, 30) < 12) {
      for (y = M_FLOOR + 1; y <= M_FLOOR + 3; y++) put(c, x, y, z, y === M_FLOOR + 2 && mod(run, 3) === 1 ? B.WINDOW : B.CAR_WHITE);
    }
  }

  function city(world, c) {
    var seed = world.seed, ox = c.cx * CS, oz = c.cz * CS, x, y, z;
    function plotAt(wx, wz) { return plotInfo(seed, Math.floor(wx / CELL_C), Math.floor(wz / CELL_C)); }
    for (z = 0; z < CS; z++) for (x = 0; x < CS; x++) {
      var wx = ox + x, wz = oz + z;
      var lx = mod(wx, CELL_C), lz = mod(wz, CELL_C);
      var p = plotAt(wx, wz), dist = p.district;
      put(c, x, 0, z, B.BEDROCK);
      for (y = 1; y < GROUND - 3; y++) put(c, x, y, z, B.STONE);
      for (y = GROUND - 3; y < GROUND; y++) put(c, x, y, z, B.DIRT);
      var road = lx < 8 || lz < 8;
      var walk = !road && (lx < 10 || lx >= 38 || lz < 10 || lz >= 38);
      if (road) {
        var id = B.ASPHALT, meta = 0, marks = dist !== 'suburb';
        if (lx < 8 && lz < 8) {
          if (marks && (lz === 0 || lz === 7 || lx === 0 || lx === 7)) { id = B.ROAD_LINE; meta = 2; }
        } else if (marks && lx < 8 && (lx === 3 || lx === 4) && mod(wz, 6) < 3) { id = B.ROAD_LINE; meta = 1; }
        else if (marks && lz < 8 && (lz === 3 || lz === 4) && mod(wx, 6) < 3) { id = B.ROAD_LINE; meta = 0; }
        // трещины и воронки на брошенных дорогах; в центре их больше
        if (id === B.ASPHALT && hash2(wx, wz, seed + 75) < (dist === 'downtown' ? 0.03 : 0.012)) id = B.RUBBLE;
        put(c, x, GROUND, z, id, meta);
      } else if (walk) {
        put(c, x, GROUND, z, dist === 'suburb' ? B.GRASS : B.SIDEWALK);
        if (dist === 'suburb' && (lx === 9 || lx === 38 || lz === 9 || lz === 38)) put(c, x, GROUND, z, B.SIDEWALK);
        // фонари на углах и серединах кварталов
        var lampSpot = (lx === 9 || lx === 38) && (lz === 9 || lz === 38 || lz === 23) || (lz === 9 || lz === 38) && lx === 23;
        if (lampSpot) {
          for (y = GROUND + 1; y <= GROUND + 5; y++) put(c, x, y, z, B.STREET_POLE);
          put(c, x, GROUND + 6, z, hash2(wx, wz, seed + 76) < (dist === 'downtown' ? 0.55 : 0.35) ? B.CONCRETE_DARK : B.STREET_LAMP);
        }
      } else {
        cityPlotColumn(c, x, z, wx, wz, p, seed);
      }
      metroColumn(c, x, z, wx, wz, seed);
    }
    // машины на дорогах: слоты вдоль каждой улицы квартала
    var cells = {};
    for (z = oz - 8; z <= oz + CS + 8; z += 8) for (x = ox - 8; x <= ox + CS + 8; x += 8) cells[Math.floor(x / CELL_C) + ',' + Math.floor(z / CELL_C)] = 1;
    Object.keys(cells).forEach(function (k) {
      var pp = k.split(',').map(Number), bx = pp[0] * CELL_C, bz = pp[1] * CELL_C;
      var dens = { downtown: 0.6, residential: 0.4, industrial: 0.3, suburb: 0.2 }[districtOf(seed, pp[0], pp[1])];
      for (var s = 0; s < 6; s++) {
        var r = hash2(pp[0] * 13 + s, pp[1] * 7 - s, seed + 77);
        if (r > dens) continue;
        var alongX = s % 2 === 0, lane = hash2(pp[0], pp[1] * 3 + s, seed + 78) < 0.5 ? 1 : 5;
        var along = 10 + Math.floor(hash2(pp[0] + s, pp[1], seed + 79) * 24);
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

  function lootAt(c, wx, y, wz, table) { (c.loot = c.loot || []).push([wx, y, wz, table]); }

  function cityPlotColumn(c, x, z, wx, wz, p, seed) {
    var y, px = wx - p.x0, pz = wz - p.z0;
    switch (p.kind) {
      case 'park': parkColumn(c, x, z, wx, wz, px, pz, seed); return;
      case 'parking': put(c, x, GROUND, z, (px % 4 === 0 && pz > 3 && pz < 24) ? B.ROAD_LINE : B.ASPHALT, 1); return;
      case 'ruin':
        put(c, x, GROUND, z, B.RUBBLE);
        var edge = px === 2 || pz === 2 || px === 25 || pz === 25;
        if (edge && px >= 2 && px <= 25 && pz >= 2 && pz <= 25) {
          var hgt = Math.floor(hash2(wx >> 1, wz >> 1, seed + 82) * 7);
          for (y = 1; y <= hgt; y++) put(c, x, GROUND + y, z, hash3(wx, y, wz, seed) < 0.2 ? B.RUBBLE : B.CONCRETE);
        } else if (hash2(wx, wz, seed + 83) < 0.1) put(c, x, GROUND + 1, z, B.RUBBLE);
        return;
      case 'houses': houseColumn(c, x, z, wx, wz, px, pz, p, seed); return;
      case 'warehouse': warehouseColumn(c, x, z, wx, wz, px, pz, p, seed); return;
      case 'construction': constructionColumn(c, x, z, wx, wz, px, pz, p, seed); return;
      case 'market': marketColumn(c, x, z, wx, wz, px, pz, p, seed); return;
      case 'gas': gasColumn(c, x, z, wx, wz, px, pz, p, seed); return;
    }
    buildingColumn(c, x, z, wx, wz, p, seed);
  }

  function parkColumn(c, x, z, wx, wz, px, pz, seed) {
    var y;
    put(c, x, GROUND, z, B.GRASS);
    var d = Math.hypot(px - 13.5, pz - 13.5);
    if (d < 3) { put(c, x, GROUND, z, d < 2 ? B.WATER : B.STONE_BRICK); if (d >= 2) put(c, x, GROUND + 1, z, B.STONE_BRICK); return; }
    if (px % 9 === 4 && pz % 9 === 4) {                       // дерево
      for (y = 1; y <= 5; y++) put(c, x, GROUND + y, z, B.LOG);
      return;
    }
    for (var tx = 4; tx < 28; tx += 9) for (var tz = 4; tz < 28; tz += 9) {
      var dx = px - tx, dz = pz - tz;
      if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2 && (dx || dz)) {
        for (y = 4; y <= 6; y++) if (!(Math.abs(dx) === 2 && Math.abs(dz) === 2) && (y < 6 || Math.abs(dx) + Math.abs(dz) <= 2)) put(c, x, GROUND + y, z, B.LEAVES, 2);
        return;
      }
    }
    if (px % 7 === 1 && pz === 13 && px > 2 && px < 26) put(c, x, GROUND + 1, z, B.PLANKS);  // скамейки
    else if (hash2(wx, wz, seed + 80) < 0.08) put(c, x, GROUND + 1, z, hash2(wx, wz, seed + 81) < 0.3 ? B.POPPY : B.TALL_GRASS);
  }

  // ---- Высотки, офисы, жилые дома, больница, полиция, башня с площадкой ----------------
  function buildingColumn(c, x, z, wx, wz, p, seed) {
    var y;
    put(c, x, GROUND, z, B.SIDEWALK);
    if (wx < p.bx0 || wx > p.bx1 || wz < p.bz0 || wz > p.bz1) return;
    var st = p.style;
    var wallMat = st === 'tower' || st === 'helipad' || st === 'police' ? B.CONCRETE_DARK : st === 'office' || st === 'hospital' ? B.CONCRETE : B.BRICK;
    var onX = wx === p.bx0 || wx === p.bx1, onZ = wz === p.bz0 || wz === p.bz1;
    var corner = onX && onZ;
    var shaftX = p.bx0 + 1, shaftZ = p.bz0 + 1;
    var midX = Math.floor((p.bx0 + p.bx1) / 2), midZ = Math.floor((p.bz0 + p.bz1) / 2);
    var loot = st === 'tower' || st === 'office' || st === 'helipad' ? 'office' : st === 'hospital' ? 'hospital' : st === 'police' ? 'police' : 'city';
    // оружейная полиции: комната за решёткой в дальнем углу первого этажа
    var armory = st === 'police' && wx >= p.bx1 - 5 && wz >= p.bz1 - 5;
    var armoryWall = armory && (wx === p.bx1 - 5 || wz === p.bz1 - 5);
    for (y = GROUND; y <= p.top + 1; y++) {
      var rel = y - GROUND, floorLvl = rel % 4 === 0;
      var id = 0, meta = 0;
      if (y === p.top + 1) { if (onX || onZ) id = wallMat; }               // парапет на крыше
      else if (onX || onZ) {
        id = wallMat;
        var band = rel % 4;
        var along = onX ? wz : wx;
        if (!corner && (band === 2 || band === 3) && mod(along, 3) !== 0) id = hash3(wx, y, wz, seed + 84) < (p.district === 'downtown' ? 0.22 : 0.14) ? 0 : B.WINDOW;
        // вход с улицы (северная стена)
        if (wz === p.bz0 && !onX && rel >= 1 && rel <= 3 && Math.abs(wx - midX) <= 1) id = 0;
        // вывески
        if (st === 'hospital' && rel === 4 && wz === p.bz0 && Math.abs(wx - midX) <= 1) id = B.MED_SIGN;
        if (st === 'hospital' && y === p.top - 1 && !corner && (along === midX || along === midZ)) id = B.MED_SIGN;
        if (st === 'police' && rel === 4 && wz === p.bz0 && Math.abs(wx - midX) <= 3) id = B.POLICE_SIGN;
      } else if (floorLvl) {
        id = rel === 0 ? B.TILE_FLOOR : (y === p.top ? wallMat : B.TILE_FLOOR);
        if (wx === shaftX && wz === shaftZ) id = 0;                          // шахта с лестницей
        else if (rel > 0 && y < p.top && (wx - p.bx0) % 6 === 3 && (wz - p.bz0) % 6 === 3 && hash2(p.cx * 31 + rel, p.cz, seed + 85) < 0.35) id = B.CEILING_LAMP;
        if (st === 'helipad' && y === p.top) {
          var hx = wx - midX, hz = wz - midZ, cheb = Math.max(Math.abs(hx), Math.abs(hz));
          if (cheb === 5) id = B.HELIPAD;
          else if (cheb < 5) id = (Math.abs(hx) === 2 && Math.abs(hz) <= 2) || (hz === 0 && Math.abs(hx) <= 2) ? B.CONCRETE : B.CONCRETE_DARK;
        }
      } else if (wx === shaftX && wz === shaftZ) {
        id = B.LADDER; meta = 1;                                              // опора — стена с запада
      } else if (armoryWall && rel >= 1 && rel <= 3) {
        id = B.BARS;
      } else if (armory && rel === 1 && wz === p.bz1 - 1 && (wx === p.bx1 - 1 || wx === p.bx1 - 3)) {
        id = B.CHEST; meta = 2; lootAt(c, wx, y, wz, 'armory');
      } else if (armory && rel === 1 && wx === p.bx1 - 1 && wz === p.bz1 - 3) {
        id = B.CRATE;
      } else if (rel % 4 === 1 && !armory) {
        // мебель и добыча на этажах
        var fr = hash3(wx, y, wz, seed + 86), chestP = st === 'hospital' || st === 'police' ? 0.01 : p.district === 'downtown' ? 0.008 : 0.006;
        if (fr < chestP) { id = B.CHEST; lootAt(c, wx, y, wz, loot); }
        else if (st === 'hospital' && fr < 0.06 && (wx - p.bx0) % 3 === 1) id = B.BED;
        else if (fr < chestP + 0.016) id = B.CRATE;
        else if (fr < chestP + 0.024) id = st === 'office' || st === 'tower' || st === 'police' ? B.BOOKSHELF : B.BED;
        else if (fr < chestP + 0.03) id = B.TABLE;
      }
      if (id) put(c, x, y, z, id, meta);
    }
    // лестница продолжается сквозь крышу
    if (wx === shaftX && wz === shaftZ) put(c, x, p.top, z, B.LADDER, 1);
    // антенна на небоскрёбе
    if (st === 'tower' && wx === midX && wz === midZ) {
      for (y = p.top + 1; y <= Math.min(H - 3, p.top + 5); y++) put(c, x, y, z, B.STREET_POLE);
      put(c, x, Math.min(H - 2, p.top + 6), z, B.SPARK_BLOCK);
    }
    // площадка эвакуации: посадочные огни по углам и генератор
    if (st === 'helipad') {
      var ex = wx - midX, ez = wz - midZ;
      if (Math.abs(ex) === 5 && Math.abs(ez) === 5) put(c, x, p.top + 1, z, B.LANDING_LIGHT);
      if (ex === -7 && ez === 0) put(c, x, p.top + 1, z, B.GENERATOR, 3);
    }
  }

  // ---- Окраина: четыре частных дома с садиками на участке ----------------------------
  function houseColumn(c, x, z, wx, wz, px, pz, p, seed) {
    var y, qx = px < 14 ? 0 : 1, qz = pz < 14 ? 0 : 1, ux = px - qx * 14, uz = pz - qz * 14;
    var hs = hash2(p.cx * 2 + qx, p.cz * 2 + qz, seed + 240);
    put(c, x, GROUND, z, B.GRASS);
    var doorSide = qz === 0 ? 2 : 9;                         // дверь смотрит на ближнюю улицу
    if (ux === 6 && (qz === 0 ? uz < 2 : uz > 9)) { put(c, x, GROUND, z, B.SIDEWALK); return; }
    if (hs < 0.12) {                                         // пустой участок с кустами
      if (hash2(wx, wz, seed + 241) < 0.06) put(c, x, GROUND + 1, z, B.LEAVES, 2);
      return;
    }
    var wallMat = hs < 0.45 ? B.PLANKS : hs < 0.8 ? B.BRICK : B.CONCRETE;
    var inside = ux >= 2 && ux <= 10 && uz >= 2 && uz <= 9;
    var roofRow = function (k) { return (uz === 2 + k || uz === 9 - k) && ux >= 1 && ux <= 11; };
    // двускатная крыша
    for (var k = 0; k < 4; k++) {
      y = GROUND + 8 + k;
      if (roofRow(k)) put(c, x, y, z, hs > 0.6 ? B.CONCRETE_DARK : B.BRICK);
      else if ((ux === 2 || ux === 10) && uz > 2 + k && uz < 9 - k) put(c, x, y, z, wallMat);
    }
    if (!inside) {
      if ((ux === 13 || uz === 13 || ux === 0) && hash2(wx, wz, seed + 242) < 0.7) put(c, x, GROUND + 1, z, B.LEAVES, 2);   // живая изгородь
      else if (hash2(wx, wz, seed + 243) < 0.05) put(c, x, GROUND + 1, z, hash2(wx, wz, seed + 244) < 0.5 ? B.POPPY : B.DANDELION);
      return;
    }
    var wallX = ux === 2 || ux === 10, wallZ = uz === 2 || uz === 9;
    put(c, x, GROUND, z, B.PLANKS);
    for (y = GROUND + 1; y <= GROUND + 7; y++) {
      var rel = y - GROUND, id = 0, meta = 0;
      if (wallX || wallZ) {
        id = wallMat;
        var along = wallX ? uz : ux, band = rel % 4;
        if (!(wallX && wallZ) && (band === 2 || band === 3) && along % 3 === 1) id = hash3(wx, y, wz, seed + 245) < 0.2 ? 0 : B.GLASS;
        if (uz === doorSide && ux === 6 && (rel === 1 || rel === 2)) id = 0;
      } else if (rel === 4) id = ux === 9 && uz === 5 ? 0 : B.PLANKS;         // пол второго этажа
      else if (ux === 9 && uz === 5) { id = B.LADDER; meta = 0; }              // лестница у восточной стены
      else if (rel === 1 && ux === 3 && uz === (qz === 0 ? 8 : 3) && hs < 0.9) { id = B.CHEST; lootAt(c, wx, y, wz, 'house'); }
      else if (rel === 1 && ux === 4 && uz === (qz === 0 ? 8 : 3)) id = B.TABLE;
      else if (rel === 5 && ux === 4 && uz === 4) id = B.BED;
      if (id) put(c, x, y, z, id, meta);
    }
  }

  // ---- Промзона: склады и стройки --------------------------------------------------------
  function warehouseColumn(c, x, z, wx, wz, px, pz, p, seed) {
    var y;
    put(c, x, GROUND, z, B.CONCRETE);
    if (wx < p.bx0 || wx > p.bx1 || wz < p.bz0 || wz > p.bz1) return;
    var onX = wx === p.bx0 || wx === p.bx1, onZ = wz === p.bz0 || wz === p.bz1;
    var midX = Math.floor((p.bx0 + p.bx1) / 2);
    var ix = wx - p.bx0, iz = wz - p.bz0;
    for (y = GROUND + 1; y <= p.top; y++) {
      var rel = y - GROUND, id = 0;
      if (y === p.top) id = hash2(wx, wz, seed + 250) < 0.04 ? 0 : (ix % 6 === 3 && iz % 6 === 3 ? B.CEILING_LAMP : B.CONCRETE_DARK);
      else if (onX || onZ) {
        id = rel <= 2 ? B.CONCRETE : B.CONCRETE_DARK;
        if (rel === 6 && !(onX && onZ) && (onX ? iz : ix) % 4 === 1) id = B.WINDOW;
        if (wz === p.bz0 && Math.abs(wx - midX) <= 2 && rel <= 4) id = 0;       // ворота
      } else if (ix % 5 >= 1 && ix % 5 <= 2 && iz % 6 >= 2 && iz % 6 <= 4 && iz > 3) {
        var stack = 1 + Math.floor(hash2(wx >> 1, wz >> 1, seed + 251) * 3);
        if (rel <= stack) id = hash3(wx, y, wz, seed + 252) < 0.05 ? B.FUEL_BARREL : B.CRATE;
      } else if (rel === 1) {
        var fr = hash2(wx, wz, seed + 253);
        if (fr < 0.006) { id = B.CHEST; lootAt(c, wx, y, wz, 'industrial'); }
        else if (fr < 0.012) id = B.FUEL_BARREL;
      }
      if (id) put(c, x, y, z, id);
    }
  }

  function constructionColumn(c, x, z, wx, wz, px, pz, p, seed) {
    var y;
    put(c, x, GROUND, z, hash2(wx, wz, seed + 260) < 0.3 ? B.RUBBLE : B.DIRT);
    // башенный кран в углу участка
    var craneTop = Math.min(H - 5, p.top + 10);
    if (px === 26 && pz === 2) {
      for (y = GROUND + 1; y < craneTop; y++) put(c, x, y, z, B.GRATE);
      put(c, x, craneTop, z, B.WINDOW);
      return;
    }
    if (pz === 2 && px >= 6 && px <= 27) {
      put(c, x, craneTop + 1, z, B.GRATE);
      if (px === 27) put(c, x, craneTop, z, B.CONCRETE);
      if (px === 12) {                                         // груз на тросе
        for (y = craneTop - 8; y <= craneTop; y++) put(c, x, y, z, B.STREET_POLE);
        put(c, x, craneTop - 9, z, B.CRATE);
      }
      return;
    }
    if (wx < p.bx0 || wx > p.bx1 || wz < p.bz0 || wz > p.bz1) {
      // леса вдоль северного фасада
      if (wz === p.bz0 - 1 && wx >= p.bx0 && wx <= p.bx1) {
        for (y = GROUND + 1; y <= p.top; y++) {
          var r = (y - GROUND) % 4;
          if (r === 0) put(c, x, y, z, B.PLANKS);
          else if ((wx - p.bx0) % 4 === 0) put(c, x, y, z, B.STREET_POLE);
        }
      } else if (hash2(wx, wz, seed + 261) < 0.02) put(c, x, GROUND + 1, z, B.CRATE);
      return;
    }
    var ix = wx - p.bx0, iz = wz - p.bz0;
    var column = ix % 6 === 0 && iz % 6 === 0 || wx === p.bx1 && iz % 6 === 0 || wz === p.bz1 && ix % 6 === 0;
    var built = Math.floor(hash2(p.cx, p.cz, seed + 262) * 2);
    var ladder = ix === 1 && iz === 0;                  // лестница у угловой колонны, опора с запада
    for (y = GROUND; y <= p.top; y++) {
      var rel = y - GROUND, id = 0, lvl = rel / 4;
      if (column && rel > 0) id = B.CONCRETE;
      else if (ladder && rel > 0) id = B.LADDER;
      else if (rel % 4 === 0) {
        var topHalf = lvl >= p.floors - built && ix > 10;
        if (rel === 0) id = B.CONCRETE;
        else if (!topHalf && hash2(wx >> 1, (wz >> 1) + lvl * 31, seed + 263) > 0.2) id = B.CONCRETE;
      } else if (rel === 1) {
        var fr = hash2(wx, wz, seed + 264);
        if (fr < 0.005) { id = B.CHEST; lootAt(c, wx, y, wz, 'build'); }
        else if (fr < 0.03) id = B.CRATE;
      }
      if (id) put(c, x, y, z, id, id === B.LADDER ? 1 : 0);
    }
  }

  // ---- Супермаркет: стеклянная витрина, ряды стеллажей, кассы ------------------------
  function marketColumn(c, x, z, wx, wz, px, pz, p, seed) {
    var y;
    put(c, x, GROUND, z, B.ASPHALT);
    if (wx < p.bx0 || wx > p.bx1 || wz < p.bz0 || wz > p.bz1) {
      if (wz < p.bz0 && px % 4 === 0 && px > 2 && px < 26) put(c, x, GROUND, z, B.ROAD_LINE, 1);
      return;
    }
    put(c, x, GROUND, z, B.TILE_FLOOR);
    var onX = wx === p.bx0 || wx === p.bx1, onZ = wz === p.bz0 || wz === p.bz1;
    var midX = Math.floor((p.bx0 + p.bx1) / 2), ix = wx - p.bx0, iz = wz - p.bz0;
    for (y = GROUND + 1; y <= GROUND + 7; y++) {
      var rel = y - GROUND, id = 0, meta = 0;
      if (rel === 7) { if (onX || onZ) id = B.CONCRETE; }
      else if (rel === 6) id = ix % 6 === 3 && iz % 6 === 3 && hash2(wx, wz, seed + 270) < 0.7 ? B.CEILING_LAMP : B.CONCRETE;
      else if (onX || onZ) {
        id = B.CONCRETE;
        if (wz === p.bz0 && !onX) {
          if (rel <= 4) id = hash3(wx, y, wz, seed + 271) < 0.12 ? 0 : B.WINDOW;
          if (rel === 5) id = B.LIGHT_PANEL;
          if (Math.abs(wx - midX - 0.5) <= 2 && rel <= 3) id = 0;               // двери
        }
      } else if (iz === 4 && ix >= 3 && ix <= p.bx1 - p.bx0 - 3 && ix % 4 === 1 && rel === 1) id = B.CONCRETE;      // кассы
      else if (iz >= 7 && iz <= p.bz1 - p.bz0 - 3 && iz % 4 === 3 && ix >= 3 && ix <= p.bx1 - p.bx0 - 3 && ix % 9 !== 4 && rel <= 2) {
        id = B.SHELF;
        if (rel === 1 && (ix === 3 || ix === p.bx1 - p.bx0 - 3) && hash2(wx, wz, seed + 272) < 0.45) { id = B.CHEST; meta = ix === 3 ? 1 : 3; lootAt(c, wx, y, wz, 'market'); }
      }
      if (id) put(c, x, y, z, id, meta);
    }
  }

  // ---- Заправка: навес с колонками, магазинчик, бочки -----------------------------------
  function gasColumn(c, x, z, wx, wz, px, pz, p, seed) {
    var y;
    put(c, x, GROUND, z, (pz === 11 && px >= 3 && px <= 18) ? B.ROAD_LINE : B.ASPHALT, 0);
    var canopy = px >= 3 && px <= 18 && pz >= 5 && pz <= 16;
    if (canopy) put(c, x, GROUND + 5, z, (px % 5 === 0 && (pz === 6 || pz === 15)) ? B.LIGHT_PANEL : B.CONCRETE);
    if ((px === 4 || px === 17) && (pz === 6 || pz === 15)) { for (y = GROUND + 1; y <= GROUND + 4; y++) put(c, x, y, z, B.STREET_POLE); return; }
    if ((px === 8 || px === 13) && (pz === 8 || pz === 13)) { put(c, x, GROUND + 1, z, B.FUEL_PUMP, pz === 8 ? 2 : 0); put(c, x, GROUND, z, B.CONCRETE); return; }
    if (px === 1 && pz === 1) {                            // стела с ценами
      for (y = GROUND + 1; y <= GROUND + 4; y++) put(c, x, y, z, B.STREET_POLE);
      put(c, x, GROUND + 5, z, B.LIGHT_PANEL); put(c, x, GROUND + 6, z, B.FUEL_PUMP, 0);
      return;
    }
    if (px >= 21 && px <= 23 && pz >= 15 && pz <= 17) {    // бочки за магазином
      put(c, x, GROUND + 1, z, B.FUEL_BARREL);
      if (hash2(wx, wz, seed + 280) < 0.4) put(c, x, GROUND + 2, z, B.FUEL_BARREL);
      return;
    }
    if (wx < p.bx0 || wx > p.bx1 || wz < p.bz0 || wz > p.bz1) return;
    put(c, x, GROUND, z, B.TILE_FLOOR);
    var onX = wx === p.bx0 || wx === p.bx1, onZ = wz === p.bz0 || wz === p.bz1, iz = wz - p.bz0;
    for (y = GROUND + 1; y <= GROUND + 4; y++) {
      var rel = y - GROUND, id = 0, meta = 0;
      if (rel === 4) id = B.CONCRETE;
      else if (onX || onZ) {
        id = B.CONCRETE;
        if (wx === p.bx0 && !onZ && rel <= 2) id = (iz === 4 || iz === 5) ? 0 : B.WINDOW;
      } else if (wx === p.bx1 - 1 && rel <= 2) id = B.SHELF;
      else if (rel === 1 && wx === p.bx1 - 2 && wz === p.bz1 - 1) { id = B.CHEST; meta = 3; lootAt(c, wx, y, wz, 'gas'); }
      if (id) put(c, x, y, z, id, meta);
    }
  }

  // ---- Добыча в сундуках: [предмет, от, до, шанс] ------------------------------------------
  var LOOT = {
    city: [[I.CANNED_FOOD, 1, 3, 0.7], [I.BREAD, 1, 2, 0.4], [I.MEDKIT, 1, 1, 0.3], [I.AMMO, 4, 12, 0.35], [I.PISTOL, 1, 1, 0.08],
      [I.BAT, 1, 1, 0.15], [I.MACHETE, 1, 1, 0.07], [B.TORCH, 2, 8, 0.4], [I.APPLE, 1, 3, 0.3], [I.IRON_INGOT, 1, 3, 0.25], [I.STRING, 1, 3, 0.2],
      [I.BANDAGE, 1, 3, 0.3], [I.CITY_MAP, 1, 1, 0.05]],
    office: [[I.PAPER, 2, 8, 0.6], [I.BOOK, 1, 2, 0.3], [I.CANNED_FOOD, 1, 2, 0.5], [I.MEDKIT, 1, 2, 0.35], [I.AMMO, 6, 16, 0.4],
      [I.PISTOL, 1, 1, 0.14], [I.MACHETE, 1, 1, 0.1], [I.SPARK_DUST, 2, 6, 0.3], [I.DIAMOND, 1, 1, 0.05], [I.CITY_MAP, 1, 1, 0.1]],
    house: [[I.CANNED_FOOD, 1, 2, 0.5], [I.BREAD, 1, 3, 0.5], [I.APPLE, 1, 4, 0.5], [I.SEEDS, 2, 6, 0.3], [I.BANDAGE, 1, 2, 0.35],
      [B.TORCH, 2, 6, 0.4], [I.BAT, 1, 1, 0.12], [B.PLANKS, 4, 12, 0.3], [I.CITY_MAP, 1, 1, 0.08]],
    hospital: [[I.MEDKIT, 1, 2, 0.7], [I.BANDAGE, 2, 6, 0.8], [I.CANNED_FOOD, 1, 2, 0.3], [I.GOLDEN_APPLE, 1, 1, 0.06], [I.PAPER, 1, 4, 0.3]],
    police: [[I.AMMO, 6, 16, 0.6], [I.PISTOL, 1, 1, 0.25], [I.BODY_ARMOR, 1, 1, 0.15], [I.BANDAGE, 1, 3, 0.4], [I.CANNED_FOOD, 1, 2, 0.3],
      [I.CITY_MAP, 1, 1, 0.25], [I.RADIO, 1, 1, 0.15]],
    armory: [[I.RADIO, 1, 1, 1], [I.AMMO, 16, 32, 1], [I.PISTOL, 1, 1, 0.8], [I.BODY_ARMOR, 1, 1, 0.6], [I.MACHETE, 1, 1, 0.4], [I.MEDKIT, 1, 1, 0.5]],
    market: [[I.CANNED_FOOD, 2, 5, 0.8], [I.BREAD, 1, 4, 0.6], [I.APPLE, 2, 6, 0.5], [I.BEEF_COOKED, 1, 3, 0.3], [I.PORK_COOKED, 1, 3, 0.2],
      [B.TORCH, 4, 10, 0.3], [I.BANDAGE, 1, 3, 0.2]],
    gas: [[I.FUEL_CAN, 1, 2, 0.85], [I.CANNED_FOOD, 1, 2, 0.4], [I.BREAD, 1, 2, 0.3], [B.TORCH, 2, 6, 0.4], [I.CITY_MAP, 1, 1, 0.3]],
    industrial: [[B.PLANKS, 6, 16, 0.6], [I.IRON_INGOT, 2, 6, 0.5], [I.FUEL_CAN, 1, 1, 0.35], [I.STICK, 4, 12, 0.4], [B.BARRICADE, 2, 6, 0.45],
      [I.SPARK_DUST, 2, 8, 0.3], [B.TNT, 1, 2, 0.06]],
    build: [[B.PLANKS, 8, 20, 0.7], [B.BARRICADE, 3, 8, 0.55], [I.IRON_INGOT, 1, 4, 0.4], [330 + 4, 1, 1, 0.15], [306, 1, 1, 0.3], [B.LADDER, 4, 10, 0.4]],
    metro: [[I.CANNED_FOOD, 1, 3, 0.45], [B.TORCH, 4, 10, 0.6], [I.BANDAGE, 1, 3, 0.4], [I.AMMO, 4, 10, 0.3], [I.CITY_MAP, 1, 1, 0.25]],
    airdrop: [[I.MEDKIT, 1, 3, 0.9], [I.AMMO, 12, 24, 0.9], [I.CANNED_FOOD, 3, 6, 1], [I.BANDAGE, 2, 4, 0.6], [I.BODY_ARMOR, 1, 1, 0.25],
      [I.FUEL_CAN, 1, 1, 0.5], [I.PISTOL, 1, 1, 0.3], [B.BARRICADE, 2, 4, 0.4]],
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

  // ---- Справки о городе для игры: район, участок, ближайшие здания, эвакуация ----------------
  function cityInfo(seed, wx, wz) {
    var cxI = Math.floor(wx / CELL_C), czI = Math.floor(wz / CELL_C), lx = mod(Math.floor(wx), CELL_C), lz = mod(Math.floor(wz), CELL_C);
    var p = plotInfo(seed, cxI, czI);
    return { district: p.district, D: DISTRICTS[p.district], plot: p, inPlot: lx >= 10 && lx < 38 && lz >= 10 && lz < 38 };
  }
  // Центр участка (для стрелки навигации) — у входа, на уровне земли
  function plotEntrance(p) {
    var bx0 = p.bx0 !== undefined ? p.bx0 : p.x0, bx1 = p.bx1 !== undefined ? p.bx1 : p.x0 + 27;
    var bz0 = p.bz0 !== undefined ? p.bz0 : p.z0;
    return { x: Math.floor((bx0 + bx1) / 2) + 0.5, y: GROUND + 1, z: bz0 - 0.5 };
  }
  function findNearest(seed, wx, wz, special, R) {
    var cx0 = Math.floor(wx / CELL_C), cz0 = Math.floor(wz / CELL_C), best = null, bd = Infinity;
    for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) {
      var p = plotInfo(seed, cx0 + dx, cz0 + dz);
      if (p.special !== special) continue;
      var e = plotEntrance(p), d = Math.hypot(e.x - wx, e.z - wz);
      if (d < bd) { bd = d; best = e; best.plot = p; }
    }
    return best;
  }
  function evacPoint(seed) {
    var C = cityCenter(seed), p = plotInfo(seed, C.x, C.z);
    var midX = Math.floor((p.bx0 + p.bx1) / 2), midZ = Math.floor((p.bz0 + p.bz1) / 2);
    return { x: midX + 0.5, y: p.top + 1, z: midZ + 0.5, gen: { x: midX - 7, y: p.top + 1, z: midZ }, plot: p };
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
    cityInfo: cityInfo, plotInfo: plotInfo, districtOf: districtOf, cityCenter: cityCenter, findNearest: findNearest,
    evacPoint: evacPoint, plotEntrance: plotEntrance, DISTRICTS: DISTRICTS, SPECIAL_NAMES: SPECIAL_NAMES,
    CITY_GROUND: GROUND, CELL: CELL_C, METRO_FLOOR: M_FLOOR, STATION_Y: SY, HELL_LAVA: HELL_LAVA
  };
})(window.KC = window.KC || {});
