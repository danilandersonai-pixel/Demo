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
  var OV = 0;                         // сила зарастания в текущей колонке (ставит city перед вызовом участка)

  // Сглаженный шум по клеткам квартала (0..1): соседние кварталы похожи
  function cellNoise(seed, x, z, scale, salt) {
    var fx = x / scale, fz = z / scale, x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    tx = tx * tx * (3 - 2 * tx); tz = tz * tz * (3 - 2 * tz);
    var a = hash2(x0, z0, seed + salt), b = hash2(x0 + 1, z0, seed + salt);
    var c = hash2(x0, z0 + 1, seed + salt), d = hash2(x0 + 1, z0 + 1, seed + salt);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  // ---- Природа захватывает город --------------------------------------------------------
  // Сила зарастания 0..1: окраины и спальные районы зеленеют сильнее центра, причём пятнами —
  // рядом с почти чистой улицей бывает квартал, где плитки уже не видно под травой
  var OVER_BASE = { downtown: 0.2, residential: 0.5, industrial: 0.34, suburb: 0.7 };
  function overAt(seed, wx, wz, dist) {
    return clamp(OVER_BASE[dist] + (cellNoise(seed, wx, wz, 26, 300) - 0.5) * 1.2 + (cellNoise(seed, wx, wz, 6, 301) - 0.5) * 0.35, 0, 1);
  }
  // Покрытие тротуара: плитка, замшелая плитка или пробившаяся трава
  function walkCover(seed, wx, wz, ov) {
    if (ov > 0.42 && cellNoise(seed, wx, wz, 4, 302) + ov * 0.75 > 1.02) return B.GRASS;
    return hash2(wx, wz, seed + 303) < ov * 0.6 ? B.MOSSY_SIDEWALK : B.SIDEWALK;
  }
  // Мелкая зелень поверх земли: на траве — трава, папоротники, цветы и кусты, на камне — сорняки и мох
  function greenery(c, x, y, z, wx, wz, ground, ov, seed, bushes) {
    if (getc(c, x, y, z) !== 0) return;
    var r = hash2(wx, wz, seed + 304);
    if (ground === B.GRASS || ground === B.DIRT) {
      if (bushes && r < ov * 0.05) {
        put(c, x, y, z, B.LEAVES, 2);
        if (r < ov * 0.015 && getc(c, x, y + 1, z) === 0) put(c, x, y + 1, z, B.LEAVES, 2);
        return;
      }
      if (r < 0.2 + ov * 0.45) {
        var f = hash2(wx, wz, seed + 305);
        put(c, x, y, z, f < 0.06 ? B.DAISY : f < 0.1 ? B.POPPY : f < 0.13 ? B.DANDELION : f < 0.15 ? B.BELLFLOWER : f < 0.26 ? B.FERN : B.TALL_GRASS);
      }
      return;
    }
    if (r < ov * 0.16) put(c, x, y, z, B.WEEDS);
    else if (r < ov * 0.3) put(c, x, y, z, B.MOSS, 3);
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
  var FORCED = [['police', 2, -1], ['hospital', -1, 2], ['market', 2, 1], ['gas', -2, -1], ['military', -3, -3]];
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
    downtown: [['police', 0.05], ['hospital', 0.1], ['market', 0.14], ['military', 0.17]],
    residential: [['police', 0.03], ['hospital', 0.06], ['market', 0.12], ['gas', 0.15]],
    industrial: [['gas', 0.07], ['military', 0.1]],
    suburb: [['gas', 0.02], ['market', 0.035]]
  };
  var SPECIAL_NAMES = { police: 'Полицейский участок', hospital: 'Больница', market: 'Супермаркет', gas: 'Заправка', helipad: 'Площадка эвакуации', military: 'Военный блокпост', cityhall: 'Ратуша' };

  var plotCache = new Map();
  function plotInfo(seed, cxI, czI) {
    var ck = seed + ':' + cxI + ',' + czI, hit = plotCache.get(ck);
    if (hit) return hit;
    if (plotCache.size > 6000) plotCache.clear();
    var dist = districtOf(seed, cxI, czI);
    var info = { cx: cxI, cz: czI, x0: cxI * CELL_C + 10, z0: czI * CELL_C + 10, size: 28, district: dist };
    var C = cityCenter(seed);
    var r = hash2(cxI, czI, seed + 71), r2 = hash2(cxI, czI, seed + 212);
    var special = cxI === C.x && czI === C.z ? 'helipad' : cxI === C.x + 1 && czI === C.z ? 'cityhall' : forcedKind(seed, cxI, czI);
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
    // одичавшие участки: чем сильнее зарастание вокруг, тем чаще на месте квартала — молодой лес
    var wildP = clamp((overAt(seed, info.x0 + 14, info.z0 + 14, dist) - 0.42) * (dist === 'downtown' ? 0.45 : 0.9), 0, 0.32);
    var wild = !special && Math.abs(cxI) + Math.abs(czI) > 1 && hash2(cxI, czI, seed + 214) < wildP;
    if (special === 'helipad') building('helipad', 10);
    else if (special === 'hospital') building('hospital', 4 + Math.floor(f * 2));
    else if (special === 'police') building('police', 3);
    else if (special === 'market') { info.kind = 'market'; info.bx0 = info.x0 + 1; info.bx1 = info.x0 + 26; info.bz0 = info.z0 + 2; info.bz1 = info.z0 + 25; info.top = GROUND + 6; info.floors = 1; }
    else if (special === 'military') { info.kind = 'military'; info.bx0 = info.x0; info.bx1 = info.x0 + 27; info.bz0 = info.z0; info.bz1 = info.z0 + 27; info.top = GROUND + 6; info.floors = 1; }
    else if (special === 'cityhall') { info.kind = 'cityhall'; info.bx0 = info.x0 + CH.fx0; info.bx1 = info.x0 + CH.fx1; info.bz0 = info.z0 + CH.fz0; info.bz1 = info.z0 + CH.fz1; info.top = GROUND + 12; info.floors = 3; }
    else if (special === 'gas') { info.kind = 'gas'; info.bx0 = info.x0 + 20; info.bx1 = info.x0 + 26; info.bz0 = info.z0 + 3; info.bz1 = info.z0 + 12; info.top = GROUND + 4; info.floors = 1; }
    else if (wild) { info.kind = 'wild'; info.ruinWalls = hash2(cxI, czI, seed + 215) < 0.6; }
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
    // пожары и обрушения: чем сильнее разрушения вокруг, тем чаще дом выгорел или рухнул
    var war = warAt(seed, info.x0 + 14, info.z0 + 14, dist);
    if (!special && (info.kind === 'building' || info.kind === 'houses' || info.kind === 'warehouse')) {
      info.burnt = hash2(cxI, czI, seed + 430) < war * 0.5;
      if (info.kind === 'building' && info.floors >= 6 && hash2(cxI, czI, seed + 431) < war * 0.6) { info.collapsed = true; info.burnt = true; }
    }
    // сад на крыше невысокого дома: трава, кусты и пара деревьев, пробившихся сквозь кровлю
    if (info.kind === 'building' && !info.burnt && info.style !== 'helipad' && info.style !== 'tower' && info.floors <= 7) {
      var rov = overAt(seed, info.x0 + 14, info.z0 + 14, dist);
      info.roofGarden = hash2(cxI, czI, seed + 216) < clamp((rov - 0.3) * 1.5, 0, 0.8);
      if (info.roofGarden) {
        info.roofTrees = [];
        var nT = 1 + Math.floor(hash2(cxI, czI, seed + 217) * 2.6);
        for (var ti = 0; ti < nT; ti++) info.roofTrees.push([
          info.bx0 + 5 + Math.floor(hash2(cxI + ti * 7, czI, seed + 218) * (info.bx1 - info.bx0 - 8)),
          info.bz0 + 5 + Math.floor(hash2(cxI, czI + ti * 7, seed + 219) * (info.bz1 - info.bz0 - 9))]);
      }
    }
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
      var ov = overAt(seed, wx, wz, dist);
      OV = ov;
      if (road) {
        var id = B.ASPHALT, meta = 0, marks = dist !== 'suburb', cross = lx < 8 && lz < 8;
        if (cross) {
          if (marks && (lz === 0 || lz === 7 || lx === 0 || lx === 7)) { id = B.ROAD_LINE; meta = 2; }
        } else if (marks && lx < 8 && (lx === 3 || lx === 4) && mod(wz, 6) < 3) { id = B.ROAD_LINE; meta = 1; }
        else if (marks && lz < 8 && (lz === 3 || lz === 4) && mod(wx, 6) < 3) { id = B.ROAD_LINE; meta = 0; }
        // трещины и воронки на брошенных дорогах; в центре их больше
        if (id === B.ASPHALT && hash2(wx, wz, seed + 75) < (dist === 'downtown' ? 0.03 : 0.012)) id = B.RUBBLE;
        // трава наползает с тротуаров на крайние полосы
        if (!cross && id === B.ASPHALT && ov > 0.35) {
          var lane = lx < 8 ? lx : lz, edgeD = Math.min(lane, 7 - lane);
          if (edgeD <= 1 && cellNoise(seed, wx, wz, 5, 306) + ov * 0.6 - edgeD * 0.3 > 1.0) id = B.GRASS;
        }
        put(c, x, GROUND, z, id, meta);
        if (id === B.ASPHALT) {
          var rr = hash2(wx, wz, seed + 90), crackP = dist === 'downtown' ? 0.06 : 0.035;
          // из трещин лезут сорняки, на старом асфальте — пятна мха
          if (rr < crackP) put(c, x, GROUND + 1, z, hash2(wx, wz, seed + 307) < ov * 0.7 ? B.WEEDS : B.CRACKS, hash2(wx, wz, seed + 307) < ov * 0.7 ? 0 : 3);
          else if (rr < crackP + ov * 0.05) put(c, x, GROUND + 1, z, rr < crackP + ov * 0.02 ? B.WEEDS : B.MOSS, rr < crackP + ov * 0.02 ? 0 : 3);
          else if (rr > 0.9975 && !cross) put(c, x, GROUND + 1, z, B.ROAD_BARRIER, lx < 8 ? 0 : 1);
        } else if (id === B.GRASS) greenery(c, x, GROUND + 1, z, wx, wz, id, ov, seed, false);
        defenseCell(c, x, z, wx, wz, lx, lz, seed);
      } else if (walk) {
        var inner = lx === 9 || lx === 38 || lz === 9 || lz === 38;
        var gnd = dist === 'suburb' && !inner ? B.GRASS : walkCover(seed, wx, wz, ov);
        put(c, x, GROUND, z, gnd);
        // фонари на углах и серединах кварталов
        var lampSpot = (lx === 9 || lx === 38) && (lz === 9 || lz === 38 || lz === 23) || (lz === 9 || lz === 38) && lx === 23;
        if (lampSpot) {
          for (y = GROUND + 1; y <= GROUND + 5; y++) put(c, x, y, z, B.STREET_POLE);
          put(c, x, GROUND + 6, z, hash2(wx, wz, seed + 76) < (dist === 'downtown' ? 0.55 : 0.35) ? B.CONCRETE_DARK : B.STREET_LAMP);
        } else {
          streetProp(c, x, z, wx, wz, lx, lz, dist, seed);
          greenery(c, x, GROUND + 1, z, wx, wz, gnd, ov, seed, true);
        }
      } else {
        cityPlotColumn(c, x, z, wx, wz, p, seed);
      }
      metroColumn(c, x, z, wx, wz, seed);
    }
    // воронки от бомб; потом деревья (в воронках не растут) и брошенные машины
    cityCraters(c, seed, ox, oz);
    // деревья: сквозь асфальт у бордюров, вдоль тротуаров, во дворах, парках, на крышах и в одичавших кварталах
    cityTrees(c, seed, ox, oz);
    // машины на дорогах: слоты вдоль каждой улицы квартала
    var cells = {};
    for (z = oz - 8; z <= oz + CS + 8; z += 8) for (x = ox - 8; x <= ox + CS + 8; x += 8) cells[Math.floor(x / CELL_C) + ',' + Math.floor(z / CELL_C)] = 1;
    Object.keys(cells).forEach(function (k) {
      var pp = k.split(',').map(Number), bx = pp[0] * CELL_C, bz = pp[1] * CELL_C, dname = districtOf(seed, pp[0], pp[1]);
      var dens = { downtown: 0.6, residential: 0.4, industrial: 0.3, suburb: 0.2 }[dname];
      for (var s = 0; s < 6; s++) {
        var r = hash2(pp[0] * 13 + s, pp[1] * 7 - s, seed + 77);
        if (r > dens) continue;
        var alongX = s % 2 === 0, lane = hash2(pp[0], pp[1] * 3 + s, seed + 78) < 0.5 ? 1 : 5;
        var along = 10 + Math.floor(hash2(pp[0] + s, pp[1], seed + 79) * 24);
        var col = [B.CAR_RED, B.CAR_BLUE, B.CAR_WHITE][Math.floor(r * 7.5) % 3];
        var ccx = alongX ? bx + along + 2 : bx + lane + 1, ccz = alongX ? bz + lane + 1 : bz + along + 2;
        if (inCrater(seed, ccx, ccz, 2)) continue;
        // сгоревшая машина: обугленный остов без стёкол; брошенная давно — обросла кустами и мхом
        var carWar = warAt(seed, ccx, ccz, dname), burntCar = hash2(pp[0] * 9 - s, pp[1] * 4 + s, seed + 445) < carWar * 1.1;
        if (burntCar) col = B.CAR_BURNT;
        var carOv = overAt(seed, alongX ? bx + along : bx + lane, alongX ? bz + lane : bz + along, dname);
        var mossy = hash2(pp[0] * 5 + s, pp[1] * 11 - s, seed + 312) < carOv * 0.8;
        for (var l = 0; l < 4; l++) for (var w = 0; w < 2; w++) {
          var cx2 = alongX ? bx + along + l : bx + lane + w;
          var cz2 = alongX ? bz + lane + w : bz + along + l;
          var llx = cx2 - ox, llz = cz2 - oz;
          put(c, llx, GROUND + 1, llz, (l === 0 || l === 3) && w === (alongX ? 0 : 1) ? (burntCar ? B.CAR_BURNT : B.TIRE) : col);
          if ((l === 1 || l === 2) && !burntCar) put(c, llx, GROUND + 2, llz, B.WINDOW);
          if (burntCar && hash3(cx2, GROUND, cz2, seed + 446) < 0.5) { var gl = getc(c, llx, GROUND, llz); if (gl === B.ASPHALT || gl === B.ROAD_LINE) put(c, llx, GROUND, llz, B.SCORCHED); }
          if (mossy) {
            var ctop = l === 1 || l === 2 ? GROUND + 3 : GROUND + 2, hr = hash3(cx2, ctop, cz2, seed + 313);
            if (hr < 0.5) put(c, llx, ctop, llz, B.LEAVES, 2);
            else if (hr < 0.75) put(c, llx, ctop, llz, B.MOSS, 3);
          }
        }
      }
    });
  }

  // ---- Деревья в городе ------------------------------------------------------------------------
  // treeSpot — чистая функция координат, поэтому крона, переползающая в соседний чанк, строится
  // по обе стороны границы одинаково. Виды: 0 — дуб, 1 — берёза, 2 — большой дуб, 3 — сухое, 4 — деревце
  var TREE = { base: 0, kind: 0, h: 0, pit: 0 };
  function treeKind(r, dist) {
    if (r < (dist === 'downtown' || dist === 'industrial' ? 0.16 : 0.05)) return 3;
    return r < 0.32 ? 1 : r < 0.45 ? 2 : 0;
  }
  function treeHeight(kind, h) {
    return kind === 2 ? 8 + Math.floor(h * 2) : kind === 3 ? 4 + Math.floor(h * 3) : kind === 4 ? 3 : kind === 1 ? 6 + Math.floor(h * 3) : 5 + Math.floor(h * 3);
  }
  // точка дерева на сетке с «дрожанием»: одна на клетку size×size внутри участка
  function jitterHit(seed, p, px, pz, size, lo, span, salt) {
    var i = Math.floor(px / size), j = Math.floor(pz / size);
    return px === i * size + lo + Math.floor(hash2(p.cx * 8 + i, p.cz * 8 + j, seed + salt) * span) &&
      pz === j * size + lo + Math.floor(hash2(p.cx * 8 + j, p.cz * 8 - i, seed + salt + 1) * span);
  }
  function plotTree(seed, p, px, pz, wx, wz, r, T) {
    var h = hash2(wz, wx, seed + 312), kind = treeKind(hash2(wx, wz, seed + 311), p.district);
    switch (p.kind) {
      case 'building':
        var rt = p.roofTrees;
        if (rt) for (var i = 0; i < rt.length; i++) if (rt[i][0] === wx && rt[i][1] === wz) {
          T.base = p.top; T.kind = h < 0.3 ? 1 : 4; T.h = T.kind === 1 ? 5 : 3; T.pit = 3;
          return true;
        }
        // двор вдоль края участка — если дом стоит не вплотную к тротуару; у входа не растёт
        if (p.bx0 - p.x0 < 3) return false;
        var ring = (px === 1 || px === 26) && pz >= 1 && pz <= 26 ? pz : (pz === 1 || pz === 26) && px >= 1 && px <= 26 ? px : -1;
        if (ring < 0 || mod(ring - 4, 6) !== 0) return false;
        if (pz === 1 && Math.abs(wx - Math.floor((p.bx0 + p.bx1) / 2)) <= 3) return false;
        if (r > overAt(seed, wx, wz, p.district) * 0.75) return false;
        if (kind === 2) kind = 0;
        break;
      case 'park':
        if (px % 9 === 4 && pz % 9 === 4) { if (px === 13 && pz === 13) return false; break; }      // аллея
        if (!jitterHit(seed, p, px, pz, 7, 1, 5, 320) || Math.hypot(px - 13.5, pz - 13.5) < 5.5) return false;
        if (Math.abs(px - (4 + 9 * Math.round((px - 4) / 9))) < 3 && Math.abs(pz - (4 + 9 * Math.round((pz - 4) / 9))) < 3) return false;
        if (r > 0.2 + overAt(seed, wx, wz, p.district) * 0.5) return false;
        kind = 4;
        break;
      case 'wild':
        if (!jitterHit(seed, p, px, pz, 7, 1, 5, 322) || r > 0.85) return false;
        if (p.ruinWalls && (px === 5 || px === 22 || pz === 5 || pz === 22)) return false;
        if (kind === 3 && h < 0.7) kind = 0;
        if (h > 0.85) kind = 4;
        break;
      case 'ruin':
        if (!jitterHit(seed, p, px, pz, 9, 3, 5, 324)) return false;
        if (r > 0.3 + overAt(seed, wx, wz, p.district) * 0.45) return false;
        break;
      case 'parking':
        if (px % 9 !== 4 || pz % 9 !== 4 || r > overAt(seed, wx, wz, p.district) * 0.55) return false;
        break;
      case 'houses':
        var qx = px < 14 ? 0 : 1, qz = pz < 14 ? 0 : 1, ux = px - qx * 14, uz = pz - qz * 14;
        var hs = hash2(p.cx * 2 + qx, p.cz * 2 + qz, seed + 240);
        if (hs < 0.12) {                                            // заросший пустой участок
          if (!((ux === 4 && uz === 5) || (ux === 9 && uz === 9) || (ux === 10 && uz === 3)) || r > 0.75) return false;
        } else if (ux !== 12 || uz !== (qz === 0 ? 11 : 2) || r > 0.35 + overAt(seed, wx, wz, p.district) * 0.5) return false;
        if (kind === 3) kind = 0;
        break;
      default: return false;
    }
    T.kind = kind; T.h = treeHeight(kind, h);
    return true;
  }
  function treeSpot(seed, wx, wz, T) {
    var lx = mod(wx, CELL_C), lz = mod(wz, CELL_C);
    if (lx < 8 && lz < 8) return false;                                   // перекрёсток
    var cxI = Math.floor(wx / CELL_C), czI = Math.floor(wz / CELL_C), r = hash2(wx, wz, seed + 310), p, along;
    T.base = GROUND; T.pit = 0;
    if (lx < 8 || lz < 8) {
      // сквозь асфальт у бордюра: полосы 0 и 7 свободны от брошенных машин, фонари далеко
      var lane = lx < 8 ? lx : lz;
      along = lx < 8 ? lz : lx;
      if ((lane !== 0 && lane !== 7) || (along !== 16 && along !== 32)) return false;
      p = plotInfo(seed, cxI, czI);
      if (r > (overAt(seed, wx, wz, p.district) - 0.25) * 0.8) return false;
      T.pit = 2;
    } else if (lx < 10 || lx >= 38 || lz < 10 || lz >= 38) {
      // вдоль тротуара у бордюра — между фонарями, скамейками и гидрантами
      var nsOuter = (lx === 8 || lx === 39) && lz >= 10 && lz < 38, ewOuter = (lz === 8 || lz === 39) && lx >= 10 && lx < 38;
      if (!nsOuter && !ewOuter) return false;
      along = nsOuter ? lz : lx;
      if (along !== 13 && along !== 28) return false;
      p = plotInfo(seed, cxI, czI);
      if (r > 0.1 + overAt(seed, wx, wz, p.district) * 0.65) return false;
      T.pit = 1;
    } else {
      p = plotInfo(seed, cxI, czI);
      return plotTree(seed, p, wx - p.x0, wz - p.z0, wx, wz, r, T);
    }
    var h = hash2(wz, wx, seed + 312);
    T.kind = treeKind(hash2(wx, wz, seed + 311), p.district);
    T.h = treeHeight(T.kind, h) + (T.kind === 3 ? 0 : 1);                 // у дорог — повыше, чтобы проезжала техника
    return true;
  }
  // листва занимает только пустоту и траву: не ломает стены, фонари и окна
  function leafAt(c, x, y, z, m) {
    var cur = getc(c, x, y, z);
    if (cur === 0 || cur === B.TALL_GRASS || cur === B.WEEDS || cur === B.FERN) put(c, x, y, z, B.LEAVES, m);
  }
  var BRANCH_D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function placeTree(c, ox, oz, wx, wz, T, seed) {
    var lx = wx - ox, lz = wz - oz, base = T.base, th = T.h, kind = T.kind, y, dx, dz, k;
    var logId = kind === 1 ? B.BIRCH_LOG : B.LOG, lm = kind === 1 ? 3 : 2;     // бит 2 — листва не осыпается
    // корни: земля под стволом; вокруг — вздыбленный асфальт, трава и сорняки
    put(c, lx, base, lz, B.DIRT);
    if (T.pit) for (k = 0; k < 4; k++) {
      var nx = lx + BRANCH_D[k][0], nz = lz + BRANCH_D[k][1], g = getc(c, nx, base, nz);
      var hr = hash2(wx * 3 + k, wz * 5 - k, seed + 314);
      if (T.pit === 2 && hr < 0.6 && g === B.ASPHALT) put(c, nx, base, nz, B.RUBBLE);
      else if (T.pit !== 2 && hr < 0.6 && (g === B.SIDEWALK || g === B.MOSSY_SIDEWALK || g === B.CONCRETE_DARK || g === B.CONCRETE)) put(c, nx, base, nz, B.GRASS);
      if (hr > 0.35 && getc(c, nx, base + 1, nz) === 0) put(c, nx, base + 1, nz, getc(c, nx, base, nz) === B.GRASS ? B.TALL_GRASS : B.WEEDS);
    }
    if (kind !== 3) {
      var crown = base + th, lo = crown - (kind === 2 ? 3 : kind === 4 ? 1 : 2);
      for (y = lo; y <= crown + 1; y++) {
        var rad = kind === 4 ? 1 : y <= crown - 1 ? (kind === 2 && y <= crown - 2 ? 3 : 2) : 1;
        for (dz = -rad; dz <= rad; dz++) for (dx = -rad; dx <= rad; dx++) {
          var corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
          if (corner && (rad === 1 ? y === crown + 1 : hash3(wx + dx, y, wz + dz, seed + 315) < 0.55)) continue;
          if (rad === 3 && Math.abs(dx) + Math.abs(dz) > 4) continue;
          leafAt(c, lx + dx, y, lz + dz, lm);
        }
      }
      // опавшие листья под кроной
      for (dz = -2; dz <= 2; dz++) for (dx = -2; dx <= 2; dx++) {
        if ((!dx && !dz) || hash3(wx + dx, base, wz + dz, seed + 316) > 0.2) continue;
        if (getc(c, lx + dx, base + 1, lz + dz) === 0 && KC.OPAQUE[getc(c, lx + dx, base, lz + dz)] === 1) put(c, lx + dx, base + 1, lz + dz, B.FALLEN_LEAVES, 3);
      }
    }
    for (y = base + 1; y <= base + th - (kind === 4 ? 1 : 0); y++) put(c, lx, y, lz, logId);
    // толстые ветви у большого дуба и голые сучья у сухого дерева
    if (kind === 2 || kind === 3) {
      var d0 = Math.floor(hash2(wx, wz, seed + 317) * 4);
      for (var bi = 0; bi < 2; bi++) {
        var bd = BRANCH_D[(d0 + bi * 2) % 4], by = base + th - 1 - bi * 2, len = kind === 3 ? 2 : 2;
        for (var s = 1; s <= len; s++) {
          var bxx = lx + bd[0] * s, bzz = lz + bd[1] * s, byy = by + (s === len ? 1 : 0), cur = getc(c, bxx, byy, bzz);
          if (cur === 0 || cur === B.LEAVES) put(c, bxx, byy, bzz, logId, s === len ? 0 : bd[0] ? 1 : 2);
        }
      }
    }
  }
  function cityTrees(c, seed, ox, oz) {
    for (var wz = oz - 3; wz < oz + CS + 3; wz++) for (var wx = ox - 3; wx < ox + CS + 3; wx++) {
      if (treeSpot(seed, wx, wz, TREE) && !inCrater(seed, wx, wz, 1)) placeTree(c, ox, oz, wx, wz, TREE, seed);
    }
  }

  function lootAt(c, wx, y, wz, table) { (c.loot = c.loot || []).push([wx, y, wz, table]); }

  // ---- Уличные мелочи: светофоры, скамейки, урны, гидранты, мусор ------------------------
  function streetProp(c, x, z, wx, wz, lx, lz, dist, seed) {
    var y = GROUND + 1;
    // светофоры на внешних углах тротуаров у перекрёстков (на окраинах их нет); все мигают жёлтым
    if ((lx === 8 || lx === 39) && (lz === 8 || lz === 39)) {
      if (dist === 'suburb') return;
      for (var yy = y; yy < y + 4; yy++) put(c, x, yy, z, B.STREET_POLE);
      put(c, x, y + 4, z, B.TRAFFIC_LIGHT, lz === 8 ? 2 : 0);
      return;
    }
    var inner = lx === 9 || lx === 38 || lz === 9 || lz === 38;
    var sideX = lx === 8 || lx === 9 || lx === 38 || lx === 39;
    var along = sideX ? lz : lx, r = hash2(wx, wz, seed + 91);
    // «лицом» к дороге
    var face = lx === 8 || lx === 9 ? 1 : lx === 38 || lx === 39 ? 3 : lz === 8 || lz === 9 ? 2 : 0;
    if (inner) {
      if ((along === 16 || along === 30) && r < 0.5) { put(c, x, y, z, B.BENCH, face); return; }
      if ((along === 17 || along === 31) && r < 0.55) { put(c, x, y, z, B.TRASH_BIN, 0); return; }
      if (r < 0.014) { put(c, x, y, z, hash2(wx, wz, seed + 92) < 0.6 ? B.TRASH_BAGS : B.BOXES, Math.floor(r * 400) & 3); return; }
    } else if (along === 20 && r < 0.4 && dist !== 'suburb') { put(c, x, y, z, B.HYDRANT, face); return; }
    if (r > 0.95) put(c, x, y, z, B.LITTER, 3);
  }

  // Клетка снаружи у стены дома: плющ по простенкам, афиши и граффити у входа, кондиционеры под окнами
  function faceAway(d) { return d === 0 ? 1 : d === 1 ? 3 : d === 4 ? 2 : 0; }
  function facadeDetail(c, x, z, wx, wz, p, seed) {
    var d = -1;
    if (wx === p.bx0 - 1 && wz > p.bz0 && wz < p.bz1) d = 0;
    else if (wx === p.bx1 + 1 && wz > p.bz0 && wz < p.bz1) d = 1;
    else if (wz === p.bz0 - 1 && wx > p.bx0 && wx < p.bx1) d = 4;
    else if (wz === p.bz1 + 1 && wx > p.bx0 && wx < p.bx1) d = 5;
    if (d < 0) return;
    var along = d === 0 || d === 1 ? wz : wx, pillar = mod(along, 3) === 0;
    var midX = Math.floor((p.bx0 + p.bx1) / 2);
    if (d === 4 && Math.abs(wx - midX) <= 2) return;                       // у входа ничего
    var r = hash2(wx * 3 + d, wz * 5 - d, seed + 93), dist = p.district, y, ov = OV;
    // плющ ползёт по простенкам снизу — чем сильнее зарастание, тем выше, вплоть до крыши
    if (pillar && r < (dist === 'residential' || dist === 'suburb' ? 0.35 : 0.12) + ov * 0.35) {
      var hIvy = 2 + Math.floor(hash2(wx, wz, seed + 94) * Math.min(14 + ov * 40, p.top - GROUND));
      for (y = GROUND + 1; y <= GROUND + hIvy && y <= p.top; y++) put(c, x, y, z, B.IVY, d);
      return;
    }
    // ...и свисает с парапета сверху
    if (pillar && r > 1 - ov * 0.4) {
      var hang = 3 + Math.floor(hash2(wz, wx, seed + 97) * (p.top - GROUND - 3) * ov);
      for (y = p.top; y > p.top - hang && y > GROUND + 1; y--) put(c, x, y, z, B.IVY, d);
    }
    if (r < 0.22) put(c, x, GROUND + 1, z, r < 0.09 ? B.POSTER : B.GRAFFITI, d);
    else if (r > 0.95) put(c, x, GROUND + 1, z, r > 0.978 ? B.DUMPSTER : B.TRASH_BAGS, faceAway(d));
    else if (hash2(wx, wz, seed + 98) < ov * 0.35) put(c, x, GROUND + 1, z, B.MOSS, d);                  // сырой мох у цоколя
    if (!pillar) for (y = GROUND + 5; y < p.top - 1; y += 4) if (hash3(wx, y, wz, seed + 95) < 0.07) put(c, x, y, z, B.AC_UNIT, faceAway(d));
  }

  function cityPlotColumn(c, x, z, wx, wz, p, seed) {
    var y, px = wx - p.x0, pz = wz - p.z0;
    switch (p.kind) {
      case 'park': parkColumn(c, x, z, wx, wz, px, pz, seed); return;
      case 'wild': wildColumn(c, x, z, wx, wz, px, pz, p, seed); return;
      case 'parking':
        // стоянка: сквозь разметку и трещины лезет трава
        var pg = OV > 0.35 && cellNoise(seed, wx, wz, 5, 325) + OV * 0.6 > 1.05 ? B.GRASS : 0;
        put(c, x, GROUND, z, pg || ((px % 4 === 0 && pz > 3 && pz < 24) ? B.ROAD_LINE : B.ASPHALT), 1);
        greenery(c, x, GROUND + 1, z, wx, wz, pg || B.ASPHALT, OV * 0.8, seed, !!pg);
        return;
      case 'ruin':
        // руины зарастают: земля с травой, мох и сорняки на обломках, плющ по уцелевшим стенам
        var rg = cellNoise(seed, wx, wz, 4, 326) + OV * 0.7 > 0.95;
        put(c, x, GROUND, z, rg ? B.GRASS : B.RUBBLE);
        var edge = px === 2 || pz === 2 || px === 25 || pz === 25;
        if (edge && px >= 2 && px <= 25 && pz >= 2 && pz <= 25) {
          var hgt = Math.floor(hash2(wx >> 1, wz >> 1, seed + 82) * 7);
          for (y = 1; y <= hgt; y++) put(c, x, GROUND + y, z, hash3(wx, y, wz, seed) < 0.2 ? B.RUBBLE : hash3(wx, y, wz, seed + 1) < OV * 0.5 ? B.MOSSY_COBBLE : B.CONCRETE);
          if (hgt && hash2(wx, wz, seed + 327) < OV * 0.6) put(c, x, GROUND + hgt + 1, z, hash2(wz, wx, seed + 327) < 0.5 ? B.MOSS : B.WEEDS, 3);
        } else if (hash2(wx, wz, seed + 83) < 0.1) put(c, x, GROUND + 1, z, B.RUBBLE);
        else greenery(c, x, GROUND + 1, z, wx, wz, rg ? B.GRASS : B.RUBBLE, Math.min(1, OV + 0.2), seed, true);
        return;
      case 'houses': houseColumn(c, x, z, wx, wz, px, pz, p, seed); return;
      case 'warehouse': warehouseColumn(c, x, z, wx, wz, px, pz, p, seed); return;
      case 'construction': constructionColumn(c, x, z, wx, wz, px, pz, p, seed); return;
      case 'market': marketColumn(c, x, z, wx, wz, px, pz, p, seed); return;
      case 'gas': gasColumn(c, x, z, wx, wz, px, pz, p, seed); return;
      case 'military': militaryColumn(c, x, z, wx, wz, px, pz, p, seed); return;
      case 'cityhall': cityhallColumn(c, x, z, wx, wz, px, pz, p, seed); return;
    }
    buildingColumn(c, x, z, wx, wz, p, seed);
  }

  function parkColumn(c, x, z, wx, wz, px, pz, seed) {
    var y;
    put(c, x, GROUND, z, B.GRASS);
    var d = Math.hypot(px - 13.5, pz - 13.5);
    if (d < 3) {
      // заброшенный фонтан: вода цветёт кувшинками, бортик зарос мхом
      put(c, x, GROUND, z, d < 2 ? B.WATER : (hash2(wx, wz, seed + 328) < OV ? B.MOSSY_COBBLE : B.STONE_BRICK));
      if (d >= 2) put(c, x, GROUND + 1, z, hash2(wz, wx, seed + 328) < OV * 0.7 ? B.MOSSY_COBBLE : B.STONE_BRICK);
      else if (hash2(wx, wz, seed + 329) < 0.2 + OV * 0.4) put(c, x, GROUND + 1, z, B.LILY_PAD, 3);
      return;
    }
    // деревья аллей ставит общий проход по деревьям города (cityTrees)
    if (px % 7 === 1 && (pz === 12 || pz === 15) && px > 2 && px < 26) put(c, x, GROUND + 1, z, B.BENCH, pz === 12 ? 2 : 0);  // скамейки у дорожки
    else if (px % 7 === 2 && pz === 12 && px > 2 && px < 26) put(c, x, GROUND + 1, z, B.TRASH_BIN, 0);
    else greenery(c, x, GROUND + 1, z, wx, wz, B.GRASS, Math.max(OV, 0.45), seed, pz < 11 || pz > 16);
  }

  // ---- Одичавший участок: дом снесли давно, место заросло молодым лесом -------------------------
  function wildColumn(c, x, z, wx, wz, px, pz, p, seed) {
    var y, soil = cellNoise(seed, wx, wz, 5, 331) > 0.74 ? B.DIRT : B.GRASS;
    put(c, x, GROUND, z, soil);
    // остатки фундамента: низкие замшелые стены с проломами
    var onF = (px === 5 || px === 22) && pz >= 5 && pz <= 22 || (pz === 5 || pz === 22) && px >= 5 && px <= 22;
    if (p.ruinWalls && onF) {
      var hgt = Math.floor(hash2(wx >> 1, wz >> 1, seed + 332) * 3.4);
      for (y = 1; y <= hgt; y++) put(c, x, GROUND + y, z, hash3(wx, y, wz, seed + 333) < 0.55 ? B.MOSSY_COBBLE : B.CONCRETE);
      if (hgt && hash2(wx, wz, seed + 334) < 0.5) put(c, x, GROUND + hgt + 1, z, B.MOSS, 3);
      return;
    }
    if (hash2(wx, wz, seed + 335) < 0.012) { put(c, x, GROUND + 1, z, hash2(wz, wx, seed + 335) < 0.5 ? B.MUSHROOM_BROWN : B.MUSHROOM_RED); return; }
    greenery(c, x, GROUND + 1, z, wx, wz, soil, Math.max(OV, 0.7), seed, true);
  }

  // =================================================================================
  // Интерьеры: лестничная клетка и поэтажные планы — квартиры, офисы, больничные палаты
  // =================================================================================
  // Лестница у северной стены: две полосы (iz = 1 и 2), марш из четырёх ступеней между площадками
  // ix = 1 и ix = 6. Марш этажа F идёт по полосе F & 1: чётные поднимаются на восток, нечётные — на запад.
  // Над тремя нижними ступенями в перекрытии следующего этажа — проём, верхняя ступень стоит в перекрытии.
  var STAIR_META = [1, 3];
  function inStairwell(ix, iz) { return ix >= 1 && ix <= 7 && iz >= 1 && iz <= 3; }
  function stairCell(ix, iz, rel, floors) {
    if (ix < 2 || ix > 5 || iz < 1 || iz > 2 || rel < 1) return -1;
    var lane = iz - 1, pos = lane === 0 ? ix - 1 : 6 - ix;          // pos 1..4 — номер ступени вдоль подъёма
    var F = (rel - pos) / 4;
    if (F === Math.floor(F) && F >= 0 && F < floors && (F & 1) === lane) return B.STAIRS;
    if (rel % 4 === 0 && pos <= 3) {                                  // над первыми тремя ступенями — голова не цепляет потолок
      var Fb = rel / 4 - 1;
      if (Fb >= 0 && Fb < floors && (Fb & 1) === lane) return 0;      // проём над маршем
    }
    return -1;
  }

  var LOOT_KEYS = ['', 'fridge', 'kitchen', 'wardrobe', 'desk', 'files', 'medicine', 'hospital', 'city', 'office', 'police'];
  var planCache = new Map();
  function floorPlan(p, L, seed) {
    var key = p.cx + ',' + p.cz + ':' + L + ':' + seed, P = planCache.get(key);
    if (P) return P;
    if (planCache.size > 600) planCache.clear();
    var W = p.bx1 - p.bx0 + 1, D = p.bz1 - p.bz0 + 1, n = W * D;
    P = { W: W, D: D, floor: new Uint8Array(n), id: new Uint8Array(n * 3), meta: new Uint8Array(n * 3), loot: new Uint8Array(n * 3) };
    var res = new Uint8Array(n);                       // занятые проходами клетки: мебель сюда не ставим
    var rs = hash2(p.cx * 131 + L * 7, p.cz * 71 - L * 3, seed + 400), rng = KC.mulberry32((rs * 4294967296) >>> 0);
    function inside(ix, iz) { return ix >= 1 && iz >= 1 && ix <= W - 2 && iz <= D - 2; }
    function setF(ix, iz, id) { if (inside(ix, iz)) P.floor[ix + iz * W] = id; }
    function set(ix, iz, r, id, meta, loot) {
      if (!inside(ix, iz)) return;
      var k = (ix + iz * W) * 3 + r - 1;
      P.id[k] = id; P.meta[k] = meta | 0; P.loot[k] = loot ? LOOT_KEYS.indexOf(loot) : 0;
    }
    function free(ix, iz) { return inside(ix, iz) && !res[ix + iz * W] && !P.id[(ix + iz * W) * 3]; }
    // мебель: ставим, если клетка свободна; контейнер получает добычу с шансом (часть уже обшарили)
    function item(ix, iz, id, meta, loot, lootP) {
      if (!free(ix, iz)) return false;
      set(ix, iz, 1, id, meta, loot && rng() < (lootP === undefined ? 0.6 : lootP) ? loot : null);
      return true;
    }
    function wall(ix, iz, id, meta) { if (inside(ix, iz)) for (var r = 1; r <= 3; r++) set(ix, iz, r, id, meta); }
    function wallX(iz, ix0, ix1, id, meta) { for (var ix = ix0; ix <= ix1; ix++) wall(ix, iz, id, meta); }
    function wallZ(ix, iz0, iz1, id, meta) { for (var iz = iz0; iz <= iz1; iz++) wall(ix, iz, id, meta); }
    function opening(ix, iz) { set(ix, iz, 1, 0, 0); set(ix, iz, 2, 0, 0); }
    // дверь: закрыта, распахнута или выбита; f — сторона створки (0 — к +Z, 2 — к −Z)
    function door(ix, iz, f) {
      var r = rng();
      if (r < 0.2) { opening(ix, iz); return; }
      var m = f | (r < 0.55 ? 4 : 0);
      set(ix, iz, 1, B.DOOR, m); set(ix, iz, 2, B.DOOR, m | 8);
    }
    function reserve(ix0, iz0, ix1, iz1) { for (var z = iz0; z <= iz1; z++) for (var x = ix0; x <= ix1; x++) if (inside(x, z)) res[x + z * W] = 1; }
    function floorRect(ix0, iz0, ix1, iz1, id) { for (var z = iz0; z <= iz1; z++) for (var x = ix0; x <= ix1; x++) setF(x, z, id); }

    var st = p.style, office = st !== 'apart' && st !== 'hospital';
    var wallMeta = st === 'hospital' ? 3 : office ? 3 : Math.floor(rng() * 3);
    var cz = Math.floor(D / 2) - 1, mx = Math.floor((p.bx0 + p.bx1) / 2) - p.bx0;
    floorRect(1, 1, W - 2, D - 2, office ? B.OFFICE_CARPET : st === 'hospital' ? B.TILE_FLOOR : B.PARQUET);
    // лестничная клетка: стена с двумя проходами (к обеим площадкам) и холл до коридора
    floorRect(1, 1, 7, cz + 1, B.TILE_FLOOR);
    wallX(3, 1, 7, B.WALLPAPER, 3); wallZ(7, 1, 2, B.WALLPAPER, 3);
    opening(1, 3); opening(6, 3);
    reserve(1, 1, 6, cz + 1);
    if (st === 'apart' || st === 'hospital') roomsPlan(); else officePlan();
    // следы бегства: мусор и коробки на полу
    for (var q = 0; q < n; q++) {
      var qx = q % W, qz = (q / W) | 0;
      if (!inside(qx, qz) || P.id[q * 3] || res[q]) continue;
      var rr = rng();
      if (rr < 0.035) set(qx, qz, 1, B.LITTER, 3);
      else if (rr < 0.043) set(qx, qz, 1, B.BOXES, Math.floor(rr * 400) & 3);
    }
    planCache.set(key, P);
    return P;

    // ---- Квартиры и палаты: коридор посередине, комнаты по обе стороны ----
    function roomsPlan() {
      var hosp = st === 'hospital';
      floorRect(1, cz, W - 2, cz + 1, B.TILE_FLOOR);
      reserve(1, cz, W - 2, cz + 1);
      wallX(cz - 1, 7, W - 2, B.WALLPAPER, wallMeta);
      wallX(cz + 2, 1, W - 2, B.WALLPAPER, wallMeta);
      var lobby = L === 0;
      // северный ряд комнат (на первом этаже вместо них — вестибюль у входа)
      if (lobby) {
        wallX(cz - 1, 7, W - 2, 0, 0);
        floorRect(8, 1, W - 2, cz - 1, B.TILE_FLOOR);
        reserve(mx - 1, 1, mx + 1, 4);
        if (hosp) for (var dx = -1; dx <= 1; dx++) item(mx + dx, 6, B.DESK, 2, 'hospital', 0.4);
        else { item(8, 1, B.POT_PLANT, 0); item(W - 2, 1, B.POT_PLANT, 0); item(W - 2, 3, B.ARMCHAIR, 1); item(W - 2, 4, B.ARMCHAIR, 1); }
      } else { wallZ(7, 4, cz - 2, B.WALLPAPER, wallMeta); splitRooms(8, 1, W - 2, cz - 2, true); }
      splitRooms(1, cz + 3, W - 2, D - 2, false);
      function splitRooms(x0, z0, x1, z1, north) {
        var a = x0;
        while (a <= x1) {
          var b = a + 5;
          if (x1 - b < 5) b = x1;                                   // узкий остаток — к последней комнате
          if (b < x1) wallZ(b + 1, z0, z1, B.WALLPAPER, wallMeta);
          var dz = north ? z1 + 1 : z0 - 1;
          door(a + 1, dz, north ? 0 : 2);
          if (hosp) ward(a, b, z0, z1, north); else apartment(a, b, z0, z1, north);
          a = b + 2;
        }
      }
    }
    // локальные координаты комнаты: u — вдоль коридора, v — от двери к окнам
    function roomFrame(a, b, z0, z1, north) {
      return {
        Wa: b - a + 1, Da: z1 - z0 + 1,
        x: function (u) { return a + u; },
        z: function (v) { return north ? z1 - v : z0 + v; },
        // куда смотрит «лицо» предмета: к окнам (+v), к двери (−v), по u
        fv: north ? 2 : 0, fd: north ? 0 : 2, fu: 3, fuN: 1
      };
    }
    function apartment(a, b, z0, z1, north) {
      var R = roomFrame(a, b, z0, z1, north), Wa = R.Wa, Da = R.Da, u, v;
      if (Wa < 4 || Da < 4) return;
      reserve(R.x(1), Math.min(R.z(0), R.z(1)), R.x(1), Math.max(R.z(0), R.z(1)));     // проход от двери
      // кухня вдоль стены у двери: холодильник, плита, мойка, шкафчики; пол — кафель
      for (u = 2; u < Wa; u++) { setF(R.x(u), R.z(0), B.KITCHEN_TILE); setF(R.x(u), R.z(1), B.KITCHEN_TILE); }
      item(R.x(Wa - 1), R.z(0), B.FRIDGE, R.fv, 'fridge', 0.65);
      item(R.x(Wa - 2), R.z(0), B.STOVE, R.fv);
      if (Wa > 4) item(R.x(Wa - 3), R.z(0), B.SINK, R.fv);
      for (u = 2; u < Wa - 3; u++) item(R.x(u), R.z(0), B.KITCHEN_CABINET, R.fv, 'kitchen', 0.55);
      item(R.x(0), R.z(0), B.WARDROBE, R.fv, 'wardrobe', 0.6);
      // обеденный стол со стульями
      if (Da > 5 && rng() < 0.85) {
        item(R.x(Wa - 2), R.z(2), B.DINING_TABLE, 0);
        item(R.x(Wa - 3), R.z(2), B.CHAIR, R.fu);
        if (rng() < 0.7) item(R.x(Wa - 1), R.z(2), B.CHAIR, R.fuN);
      }
      // у окон: телевизор, диван напротив, ковёр между ними; кровать и цветок
      var lv = Da - 1;
      if (rng() < 0.75) item(R.x(1), R.z(lv), B.TV, R.fd);
      if (Da > 4) for (u = 0; u < 3; u++) if (rng() < 0.85) item(R.x(u), R.z(lv - 2), B.SOFA, R.fv);
      if (Da > 5) for (u = 0; u < 3; u++) if (free(R.x(u), R.z(lv - 1))) set(R.x(u), R.z(lv - 1), 1, B.CARPET, 3);
      item(R.x(Wa - 1), R.z(lv), B.BED, 0);
      if (Da > 5) item(R.x(Wa - 1), R.z(lv - 1), B.BED, 0);
      if (rng() < 0.6) item(R.x(Wa - 2), R.z(lv), B.POT_PLANT, 0);
      else if (rng() < 0.5) item(R.x(Wa - 2), R.z(lv), B.BOOKSHELF, 0);
      // санузел у боковой стены: ванна, унитаз, раковина и аптечка над ней
      if (Da > 6) {
        item(R.x(0), R.z(2), B.BATHTUB, 0);
        item(R.x(0), R.z(3), B.TOILET, R.fu);
        if (item(R.x(0), R.z(4), B.SINK, R.fu) && Da > 7) set(R.x(0), R.z(4), 2, B.MED_CABINET, R.fu, rng() < 0.55 ? 'medicine' : null);
      }
    }
    function ward(a, b, z0, z1, north) {
      var R = roomFrame(a, b, z0, z1, north), Wa = R.Wa, Da = R.Da, u;
      if (Wa < 3 || Da < 3) return;
      reserve(R.x(1), Math.min(R.z(0), R.z(1)), R.x(1), Math.max(R.z(0), R.z(1)));
      for (u = 0; u < Wa; u += 2) { item(R.x(u), R.z(Da - 1), B.BED, 0); if (Da > 5 && u + 1 < Wa && rng() < 0.5) item(R.x(u + 1), R.z(Da - 1), B.CHAIR, R.fd); }
      if (Da > 4) for (u = 0; u < Wa; u += 2) item(R.x(u), R.z(Da - 3), B.BED, 0);
      if (item(R.x(Wa - 1), R.z(0), B.SINK, R.fv)) set(R.x(Wa - 1), R.z(0), 2, B.MED_CABINET, R.fv, rng() < 0.75 ? 'medicine' : null);
      if (rng() < 0.3) item(R.x(0), R.z(0), B.CHEST, 0, 'hospital', 1);
      else item(R.x(0), R.z(0), B.FILE_CABINET, R.fv, 'files', 0.4);
    }
    // ---- Офис: открытое пространство с рядами столов, переговорная за стеклом, шкафы у стен ----
    function officePlan() {
      var x, z, police0 = st === 'police' && L === 0, deskLoot = st === 'police' ? 'police' : 'desk';
      if (police0) reserve(W - 7, D - 7, W - 2, D - 2);                 // оружейная
      if (L === 0) reserve(mx - 1, 1, mx + 1, 4);                          // проход от входа
      // переговорная в юго-восточном углу
      if (!police0) {
        var mx0 = W - 9, mz0 = D - 8;
        wallZ(mx0, mz0, D - 2, B.GLASS, 0); wallX(mz0, mx0, W - 2, B.GLASS, 0);
        opening(mx0, D - 4);
        reserve(mx0 - 1, D - 5, mx0 - 1, D - 3);
        for (x = mx0 + 2; x <= W - 4; x++) {
          item(x, D - 5, B.DINING_TABLE, 0);
          item(x, D - 6, B.CHAIR, 0); item(x, D - 4, B.CHAIR, 2);
        }
        item(W - 2, D - 2, B.POT_PLANT, 0); item(W - 2, mz0 + 1, B.COOLER, 1);
      }
      // ряды столов: пары лицом друг к другу, кресла с обеих сторон
      for (z = 5; z + 3 <= D - 2; z += 6) for (x = 9; x + 2 <= W - 2; x += 4) for (var k = 0; k < 3; k++) {
        var xx = x + k;
        if (!free(xx, z) || !free(xx, z + 1) || !free(xx, z - 1) || !free(xx, z + 2)) continue;
        if (rng() < 0.9) { item(xx, z, rng() < 0.7 ? B.DESK_PC : B.DESK, 2, deskLoot, 0.5); if (rng() < 0.8) item(xx, z - 1, B.OFFICE_CHAIR, 0); }
        if (rng() < 0.9) { item(xx, z + 1, rng() < 0.7 ? B.DESK_PC : B.DESK, 0, deskLoot, 0.5); if (rng() < 0.8) item(xx, z + 2, B.OFFICE_CHAIR, 2); }
      }
      // шкафы-картотеки и книжные полки вдоль западной стены, цветы по углам, кулер у холла
      for (z = cz + 2; z <= D - 2; z++) if (rng() < 0.7) item(1, z, rng() < 0.6 ? B.FILE_CABINET : B.BOOKSHELF, 3, 'files', 0.55);
      item(8, cz + 2, B.COOLER, 3); item(W - 2, 1, B.POT_PLANT, 0); item(8, D - 2, B.POT_PLANT, 0);
      if (L === 0) for (var dx = -1; dx <= 1; dx++) item(mx + dx, 6, B.DESK, 2, 'office', 0.35);   // стойка у входа
    }
  }

  // =================================================================================
  // Следы войны: воронки, пожарища, обрушенные высотки, линии обороны, сгоревшие машины
  // =================================================================================
  // Сила разрушений 0..1: центр пострадал сильнее окраин, у места старта тихо
  var WAR_BASE = { downtown: 0.62, industrial: 0.38, residential: 0.22, suburb: 0.08 };
  function warAt(seed, wx, wz, dist) {
    var cxI = Math.floor(wx / CELL_C), czI = Math.floor(wz / CELL_C);
    if (Math.abs(cxI) + Math.abs(czI) <= 1) return 0;
    return clamp(WAR_BASE[dist] + (cellNoise(seed, wx, wz, 34, 410) - 0.5) * 0.9, 0, 1);
  }
  // Воронки: одна возможная на клетку сетки 24×24; только на дорогах, тротуарах и открытых участках.
  // Глубина не больше трёх блоков — туннели метро (потолок на высоте 27) не пробивает
  var CRATER_CELL = 24, CRATER = { x: 0, z: 0, r: 0, d: 0 }, craterCache = new Map();
  function craterIn(seed, gx, gz, out) {
    var ck = seed + ':' + gx + ',' + gz, hit = craterCache.get(ck);
    if (hit === undefined) {
      if (craterCache.size > 20000) craterCache.clear();
      hit = craterFind(seed, gx, gz, {}) ? CRATER_TMP : null;
      craterCache.set(ck, hit ? { x: hit.x, z: hit.z, r: hit.r, d: hit.d } : null);
      hit = craterCache.get(ck);
    }
    if (!hit) return false;
    out.x = hit.x; out.z = hit.z; out.r = hit.r; out.d = hit.d;
    return true;
  }
  var CRATER_TMP = { x: 0, z: 0, r: 0, d: 0 };
  function craterFind(seed, gx, gz) {
    var out = CRATER_TMP, h = hash2(gx, gz, seed + 420);
    if (h > 0.62) return false;
    var wx = gx * CRATER_CELL + 4 + Math.floor(hash2(gx, gz, seed + 421) * 16), wz = gz * CRATER_CELL + 4 + Math.floor(hash2(gz, gx, seed + 422) * 16);
    var p = plotInfo(seed, Math.floor(wx / CELL_C), Math.floor(wz / CELL_C));
    if (h > warAt(seed, wx, wz, p.district) * 0.62) return false;
    var lx = mod(wx, CELL_C), lz = mod(wz, CELL_C), open = lx < 10 || lz < 10 || lx >= 38 || lz >= 38;
    if (!open && p.kind !== 'park' && p.kind !== 'parking' && p.kind !== 'ruin' && p.kind !== 'wild') return false;
    out.x = wx + 0.5; out.z = wz + 0.5;
    out.r = 2.5 + hash2(gx * 3, gz * 5, seed + 423) * 2.6;
    out.d = Math.min(3, Math.floor(out.r * 0.65));
    return true;
  }
  var CQ = { x: 0, z: 0, r: 0, d: 0 };
  function inCrater(seed, wx, wz, margin) {
    var gx = Math.floor(wx / CRATER_CELL), gz = Math.floor(wz / CRATER_CELL);
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      if (!craterIn(seed, gx + dx, gz + dz, CQ)) continue;
      if (Math.hypot(wx + 0.5 - CQ.x, wz + 0.5 - CQ.z) < CQ.r * 1.25 + margin) return true;
    }
    return false;
  }
  function cityCraters(c, seed, ox, oz) {
    var gx0 = Math.floor((ox - 9) / CRATER_CELL), gx1 = Math.floor((ox + CS + 9) / CRATER_CELL);
    var gz0 = Math.floor((oz - 9) / CRATER_CELL), gz1 = Math.floor((oz + CS + 9) / CRATER_CELL);
    for (var gz = gz0; gz <= gz1; gz++) for (var gx = gx0; gx <= gx1; gx++) {
      if (!craterIn(seed, gx, gz, CRATER)) continue;
      var r = CRATER.r, R2 = r * 1.75;
      for (var wz = Math.floor(CRATER.z - R2); wz <= CRATER.z + R2; wz++) for (var wx = Math.floor(CRATER.x - R2); wx <= CRATER.x + R2; wx++) {
        var lx = wx - ox, lz = wz - oz;
        if (lx < 0 || lz < 0 || lx >= CS || lz >= CS) continue;
        var hh = hash2(wx, wz, seed + 424);
        var dd = Math.hypot(wx + 0.5 - CRATER.x, wz + 0.5 - CRATER.z) / r + (hh - 0.5) * 0.22, y;
        if (dd < 1) {
          // чаша: всё выше дна снесено, на дне гарь, битый асфальт и земля, кое-где тлеют угли
          var depth = Math.round(CRATER.d * (1 - dd * dd));
          for (y = GROUND - depth + 1; y <= GROUND + 7; y++) put(c, lx, y, lz, 0);
          put(c, lx, GROUND - depth, lz, hh < 0.06 ? B.EMBERS : hh < 0.5 ? B.SCORCHED : hh < 0.8 ? B.RUBBLE : B.DIRT);
        } else if (dd < 1.25) {
          // вал выброшенного грунта и обломков
          for (y = GROUND + 1; y <= GROUND + 7; y++) if (getc(c, lx, y, lz) === B.STREET_POLE || y === GROUND + 1) put(c, lx, y, lz, 0);
          put(c, lx, GROUND, lz, B.SCORCHED);
          if (hh < 0.7) put(c, lx, GROUND + 1, lz, B.RUBBLE);
        } else if (dd < 1.75 && hh < (1.75 - dd) * 1.3) {
          // гарь вокруг, трава выгорела
          var g = getc(c, lx, GROUND, lz);
          if (g === B.ASPHALT || g === B.SIDEWALK || g === B.MOSSY_SIDEWALK || g === B.GRASS || g === B.ROAD_LINE || g === B.RUBBLE) put(c, lx, GROUND, lz, B.SCORCHED);
          var ab = getc(c, lx, GROUND + 1, lz);
          if (ab > 0 && (KC.BLOCKS[ab].shape === 'cross' || KC.BLOCKS[ab].shape === 'decal')) put(c, lx, GROUND + 1, lz, hh < 0.15 ? B.PEBBLES : 0, 3);
        }
      }
    }
  }
  // Линия обороны поперёк улицы у перекрёстка: колючка, противотанковые ежи, мешки с песком
  function defenseLine(seed, cxI, czI, ns) {
    var p = plotInfo(seed, cxI, czI), w = warAt(seed, cxI * CELL_C + 4, czI * CELL_C + 38, p.district);
    return w > 0.3 && hash2(cxI * 7 + (ns ? 1 : 0), czI * 5, seed + 440) < w * 0.45;
  }
  function defenseCell(c, x, z, wx, wz, lx, lz, seed) {
    // N-S дорога: линия у южного конца (lz 37–39), E-W — у восточного (lx 37–39); на машины не наезжает
    var ns = lx < 8 && lz >= 37, ew = lz < 8 && lx >= 37;
    if (!ns && !ew) return;
    var cxI = Math.floor(wx / CELL_C), czI = Math.floor(wz / CELL_C);
    if (!defenseLine(seed, cxI, czI, ns)) return;
    var lane = ns ? lx : lz, along = ns ? lz : lx, h = hash2(wx, wz, seed + 441);
    if (along === 37 && h < 0.8) put(c, x, GROUND + 1, z, B.BARBED_WIRE);
    else if (along === 38 && lane % 2 === 1 && h < 0.9) put(c, x, GROUND + 1, z, B.HEDGEHOG, Math.floor(h * 40) & 3);
    else if (along === 39 && (lane === 0 || lane === 7)) { put(c, x, GROUND + 1, z, B.SANDBAG); if (h < 0.6) put(c, x, GROUND + 2, z, B.SANDBAG); }
  }
  // Пожарище: копоть на стенах, выбитые окна, провалившиеся перекрытия, тлеющие угли
  function burntWall(id) { return id === B.BRICK ? B.SOOTED_BRICK : id === B.CONCRETE || id === B.CONCRETE_DARK || id === B.WALLPAPER ? B.SOOTED_CONCRETE : id; }
  var BURNT_KEEP = {};
  [B.STAIRS, B.WALLPAPER, B.BATHTUB, B.TOILET, B.SINK, B.STOVE, B.FRIDGE, B.FILE_CABINET, B.MED_CABINET, B.GLASS, B.BARS].forEach(function (id) { BURNT_KEEP[id] = 1; });
  // Высотка обрушилась: верх рухнул, над каждой колонкой стоит лишь часть этажей с рваным краем
  function collapseTop(p, wx, wz, seed) {
    var W = p.bx1 - p.bx0, D = p.bz1 - p.bz0, dir = Math.floor(hash2(p.cx, p.cz, seed + 450) * 4);
    var t = dir === 0 ? (wx - p.bx0) / W : dir === 1 ? (p.bx1 - wx) / W : dir === 2 ? (wz - p.bz0) / D : (p.bz1 - wz) / D;
    var base = 4 * (2 + Math.floor(hash2(p.cx, p.cz, seed + 451) * Math.max(1, p.floors * 0.35)));
    // крутой рваный излом: к высокому краю этажи уцелели, у низкого — обломанные зубцы
    var jag = hash2(wx >> 1, wz >> 1, seed + 452), spike = hash2(wx >> 2, wz >> 2, seed + 447) < 0.2 ? 6 : 0;
    return GROUND + base + Math.floor(t * t * 22 + jag * 7 - 3 + spike * t);
  }
  // Груда обломков от упавших этажей: во дворе со стороны падения и на первом этаже
  function rubblePile(p, wx, wz, seed) {
    var dir = Math.floor(hash2(p.cx, p.cz, seed + 450) * 4);              // падали в сторону низкого края
    var dist = dir === 0 ? p.bx0 - wx : dir === 1 ? wx - p.bx1 : dir === 2 ? p.bz0 - wz : wz - p.bz1;
    if (dist < 1) return 0;
    return Math.max(0, Math.round(5.5 - dist * 1.2 + (hash2(wx, wz, seed + 453) - 0.5) * 2.5));
  }

  // ---- Ратуша: мраморный фасад с колоннадой и фронтоном, часовая башня, восточное крыло рухнуло ------
  var CH = { fx0: 2, fx1: 25, fz0: 8, fz1: 24 };
  function cityhallColumn(c, x, z, wx, wz, px, pz, p, seed) {
    var y, h = hash2(wx, wz, seed + 460), top = GROUND + 12;
    // площадь: плитка, воронка от бомбы, гарь; колоннада портика с фронтоном; флагшток с рваным флагом
    if (pz < CH.fz0) {
      var cd = Math.hypot(px - 21, pz - 2.5);
      if (cd < 3.2) {
        var dep = Math.round(2 * (1 - (cd / 3.2) * (cd / 3.2)));
        for (y = GROUND - dep + 1; y <= GROUND; y++) put(c, x, y, z, 0);
        put(c, x, GROUND - dep, z, h < 0.5 ? B.SCORCHED : B.RUBBLE);
        return;
      }
      put(c, x, GROUND, z, cd < 5.5 || h < 0.06 ? B.SCORCHED : B.STONE_BRICK);
      if (cd < 4.2 && h < 0.6) put(c, x, GROUND + 1, z, B.RUBBLE);
      if (pz >= 5 && px >= 3 && px <= 24) {
        if (pz === 6 && (px === 4 || px === 7 || px === 10 || px === 17 || px === 20 || px === 23)) for (y = GROUND + 1; y <= GROUND + 8; y++) put(c, x, y, z, B.STONE_BRICK);
        put(c, x, GROUND + 9, z, B.MARBLE);
        for (var k = 1; k <= 4; k++) if (pz >= 6 && px >= 9 + k && px <= 18 - k) put(c, x, GROUND + 9 + k, z, B.MARBLE);
      }
      if (px === 3 && pz === 4) for (y = GROUND + 1; y <= GROUND + 7; y++) put(c, x, y, z, B.STREET_POLE);
      if (pz === 4 && px >= 4 && px <= 6) for (y = GROUND + 5; y <= GROUND + 7; y++) {
        if (px === 6 && y === GROUND + 5) continue;                       // оборванный угол
        put(c, x, y, z, (y - GROUND) % 2 ? B.WOOL_GREEN : B.WOOL_WHITE);
      }
      return;
    }
    if (pz > CH.fz1 || px < CH.fx0 || px > CH.fx1) {                     // задний двор
      put(c, x, GROUND, z, h < 0.3 ? B.SCORCHED : B.STONE_BRICK);
      if (h > 0.93) put(c, x, GROUND + 1, z, B.RUBBLE);
      return;
    }
    var east = px >= 18, onX = px === CH.fx0 || px === CH.fx1, onZ = pz === CH.fz0 || pz === CH.fz1;
    var stand = east ? GROUND + 2 + Math.floor(hash2(wx >> 1, wz >> 1, seed + 461) * 6) : top + 1;
    var tower = px >= 11 && px <= 16 && pz >= CH.fz0 && pz <= 13, tWall = tower && (px === 11 || px === 16 || pz === CH.fz0 || pz === 13);
    var shaft = px === 3 && pz === CH.fz1 - 1;
    put(c, x, GROUND, z, B.MARBLE);
    for (y = GROUND + 1; y <= GROUND + 25; y++) {
      var rel = y - GROUND, r4 = rel % 4, id = 0, meta = 0, lt = null, hy = hash3(wx, y, wz, seed + 462);
      if (y <= top + 1) {
        if (y > stand) id = 0;
        else if (onX || onZ) {
          id = y === top + 1 ? B.STONE_BRICK : hy < 0.12 && px > 12 ? B.SOOTED_CONCRETE : B.MARBLE;
          var along = onX ? pz : px;
          if (y <= top && (r4 === 2 || r4 === 3) && along % 3 === 1) id = hy < 0.55 ? 0 : B.WINDOW;
          if (pz === CH.fz0 && px >= 12 && px <= 15 && rel <= 3) id = 0;                   // вход через башню
        } else if (r4 === 0) {
          id = y === top ? B.MARBLE : B.PARQUET;
          if (shaft || (east && y < top)) id = 0;
        } else if (shaft && y < top) { id = B.LADDER; meta = 1; }
        else if (east) {
          if (rel <= 1 + Math.floor(h * 3)) id = hy < 0.25 ? B.CONCRETE : B.RUBBLE;             // обломки рухнувшего крыла
        } else if (r4 === 1) {
          var fl = (rel - 1) / 4;
          if (fl === 0) {
            if ((px === 6 || px === 9) && (pz - CH.fz0) % 4 === 2) id = B.STONE_BRICK;           // колонны зала
            else if (pz === 16 && px >= 5 && px <= 9) { id = B.DESK; meta = 2; lt = px === 7 ? 'office' : null; }
            else if (px >= 13 && px <= 14 && pz > 13 && pz < CH.fz1) { id = B.CARPET; meta = 3; }                  // ковровая дорожка
            else if (h < 0.05) { id = B.LITTER; meta = 3; }
          } else if (fl === 1) {
            if (pz % 4 === 2 && px % 3 === 1 && px < 16 && pz > 14) { id = B.DESK_PC; meta = 0; lt = h < 0.4 ? 'desk' : null; }
            else if (px === CH.fx0 + 1 && pz > 14 && pz % 2 === 0) { id = B.FILE_CABINET; meta = 3; lt = h < 0.5 ? 'files' : null; }
          } else {
            // кабинет мэра: стол, книжные шкафы, сейф с документами и оружием охраны
            if (px === 6 && pz === 20) { id = B.DESK_PC; meta = 2; lt = 'desk'; }
            else if (px === 6 && pz === 19) { id = B.OFFICE_CHAIR; meta = 0; }
            else if (pz === CH.fz1 - 1 && px >= 4 && px <= 9) { id = px === 8 ? B.CHEST : B.BOOKSHELF; meta = 2; lt = px === 8 ? 'cityhall' : null; }
            else if (px === 10 && pz === 16) id = B.POT_PLANT;
            else if (h < 0.06) { id = B.LITTER; meta = 3; }
          }
        }
      } else if (tower && tWall && y <= GROUND + 24 && (px <= 13 || y <= GROUND + 21 + Math.floor(h * 2))) {
        // часовая башня: верх восточной половины снесён
        id = y === GROUND + 24 ? B.STONE_BRICK : B.MARBLE;
        var mid = (px === 13 || px === 14) && (pz === CH.fz0 || pz === 13) || (pz === 10 || pz === 11) && (px === 11 || px === 16);
        if (mid && (y === GROUND + 18 || y === GROUND + 19)) { id = B.CLOCK; meta = pz === CH.fz0 ? 2 : pz === 13 ? 0 : px === 11 ? 1 : 3; }
        if (mid && y >= GROUND + 21 && y <= GROUND + 22) id = 0;                               // звонница
      }
      if (id) { put(c, x, y, z, id, meta); if (lt) lootAt(c, wx, y, wz, lt); }
    }
  }

  // ---- Высотки, офисы, жилые дома, больница, полиция, башня с площадкой ----------------
  function buildingColumn(c, x, z, wx, wz, p, seed) {
    var y;
    if (wx < p.bx0 || wx > p.bx1 || wz < p.bz0 || wz > p.bz1) {
      if (p.burnt) {
        // двор пожарища: гарь, обломки; у рухнувшей высотки — груда упавших этажей
        var hb = hash2(wx, wz, seed + 457);
        put(c, x, GROUND, z, hb < 0.55 ? B.SCORCHED : hb < 0.8 ? B.SIDEWALK : B.RUBBLE);
        var pile = p.collapsed ? rubblePile(p, wx, wz, seed) : hb > 0.95 ? 1 : 0;
        for (y = GROUND + 1; y <= GROUND + pile; y++) { var hp = hash3(wx, y, wz, seed + 458); put(c, x, y, z, hp < 0.2 ? B.CONCRETE : hp < 0.26 ? B.BARS : B.RUBBLE); }
        return;
      }
      // двор: плитка, мох и трава; перед входом дорожка остаётся проходимой
      var yard = walkCover(seed, wx, wz, OV), mid = Math.floor((p.bx0 + p.bx1) / 2);
      put(c, x, GROUND, z, yard);
      facadeDetail(c, x, z, wx, wz, p, seed);
      greenery(c, x, GROUND + 1, z, wx, wz, yard, OV, seed, !(wz < p.bz0 && Math.abs(wx - mid) <= 2));
      return;
    }
    put(c, x, GROUND, z, B.SIDEWALK);
    var st = p.style;
    var wallMat = st === 'tower' || st === 'helipad' || st === 'police' ? B.CONCRETE_DARK : st === 'office' || st === 'hospital' ? B.CONCRETE : B.BRICK;
    var onX = wx === p.bx0 || wx === p.bx1, onZ = wz === p.bz0 || wz === p.bz1;
    var corner = onX && onZ;
    var ix = wx - p.bx0, iz = wz - p.bz0, stairs = inStairwell(ix, iz);
    var midX = Math.floor((p.bx0 + p.bx1) / 2), midZ = Math.floor((p.bz0 + p.bz1) / 2);
    // оружейная полиции: комната за решёткой в дальнем углу первого этажа
    var armory = st === 'police' && wx >= p.bx1 - 5 && wz >= p.bz1 - 5;
    var armoryWall = armory && (wx === p.bx1 - 5 || wz === p.bz1 - 5);
    var plans = [];
    function planAt(L) { return plans[L] || (plans[L] = floorPlan(p, L, seed)); }
    var cTop = p.collapsed ? collapseTop(p, wx, wz, seed) : 1e9;
    for (y = GROUND; y <= p.top + 1; y++) {
      var rel = y - GROUND, r4 = rel % 4, L = (rel - r4) / 4;
      var id = 0, meta = 0, lt = 0;
      if (y > cTop) {
        // выше рваного края ничего нет; из стен торчит арматура
        if (y === cTop + 1 && (onX || onZ) && hash3(wx, y, wz, seed + 454) < 0.35) put(c, x, y, z, B.BARS);
        continue;
      }
      if (y === p.top + 1) { if (onX || onZ) id = wallMat; }               // парапет на крыше
      else if (onX || onZ) {
        id = wallMat;
        var along = onX ? wz : wx;
        if (!corner && (r4 === 2 || r4 === 3) && mod(along, 3) !== 0) id = hash3(wx, y, wz, seed + 84) < (p.district === 'downtown' ? 0.22 : 0.14) ? 0 : B.WINDOW;
        // вход с улицы (северная стена)
        if (wz === p.bz0 && !onX && rel >= 1 && rel <= 3 && Math.abs(wx - midX) <= 1) id = 0;
        // вывески
        if (st === 'hospital' && rel === 4 && wz === p.bz0 && Math.abs(wx - midX) <= 1) id = B.MED_SIGN;
        if (st === 'hospital' && y === p.top - 1 && !corner && (along === midX || along === midZ)) id = B.MED_SIGN;
        if (st === 'police' && rel === 4 && wz === p.bz0 && Math.abs(wx - midX) <= 3) id = B.POLICE_SIGN;
      } else {
        var sc = stairs ? stairCell(ix, iz, rel, p.floors) : -1;
        if (sc >= 0) { id = sc; meta = sc ? STAIR_META[iz - 1] : 0; }        // ступени и проёмы лестничной клетки
        else if (r4 === 0) {
          if (y === p.top) {
            id = wallMat;
            if (st === 'helipad') {
              var hx = wx - midX, hz = wz - midZ, cheb = Math.max(Math.abs(hx), Math.abs(hz));
              if (cheb === 5) id = B.HELIPAD;
              else if (cheb < 5) id = (Math.abs(hx) === 2 && Math.abs(hz) <= 2) || (hz === 0 && Math.abs(hx) <= 2) ? B.CONCRETE : B.CONCRETE_DARK;
            }
          } else {
            var PL = planAt(L);
            id = PL.floor[ix + iz * PL.W] || B.TILE_FLOOR;
            if (rel > 0 && !stairs && ix % 6 === 3 && iz % 6 === 3 && hash2(p.cx * 31 + rel, p.cz, seed + 85) < 0.35) id = B.CEILING_LAMP;
            // лампы над площадками лестницы — там, куда приходит марш
            else if (rel > 0 && ((ix === 6 && iz === 2) || (ix === 1 && iz === 1)) && hash2(p.cx * 17 + rel, p.cz + ix, seed + 86) < 0.6) id = B.CEILING_LAMP;
          }
        } else if (armoryWall && rel <= 3) {
          id = B.BARS;
        } else if (armory && rel === 1 && wz === p.bz1 - 1 && (wx === p.bx1 - 1 || wx === p.bx1 - 3)) {
          id = B.CHEST; meta = 2; lootAt(c, wx, y, wz, 'armory');
        } else if (armory && rel === 1 && wx === p.bx1 - 1 && wz === p.bz1 - 3) {
          id = B.CRATE;
        } else if (!(armory && rel <= 3)) {
          // комнаты по плану этажа: стены, двери, мебель и её добыча
          var P2 = planAt(L), k = (ix + iz * P2.W) * 3 + r4 - 1;
          id = P2.id[k]; meta = P2.meta[k]; lt = P2.loot[k];
          // первый этаж рухнувшей высотки засыпан обломками
          if (p.collapsed && L === 0 && !stairs && rel <= 1 + Math.floor(hash2(wx, wz, seed + 459) * 2.5) && hash2(wz, wx, seed + 459) < 0.5) { id = B.RUBBLE; lt = 0; }
        }
      }
      // у рухнувшей высотки в стенах рваные пробоины
      if (p.collapsed && (onX || onZ) && rel > 4 && hash3(wx >> 1, y >> 1, wz >> 1, seed + 448) < 0.12) id = 0;
      if (p.burnt && id) {
        // пожарище: копоть, выбитые окна, прогоревшие полы и крыша, сгоревшая мебель и двери
        var bh = hash3(wx, y, wz, seed + 455);
        if (onX || onZ || y === p.top + 1) id = id === B.WINDOW ? (bh < 0.8 ? 0 : id) : burntWall(id);
        else if (y === p.top) id = bh < 0.15 ? 0 : burntWall(id);
        else if (r4 === 0) {
          if (id === B.CEILING_LAMP) id = B.SOOTED_CONCRETE;
          else if (id !== B.STAIRS && rel > 0 && !stairs && hash2((wx >> 1) * 3 + L, (wz >> 1) * 5, seed + 456) < 0.16) id = 0;
          else if (id !== B.STAIRS) id = bh < 0.03 ? B.EMBERS : bh < 0.75 ? B.SCORCHED : id;
        } else if (id === B.DOOR) id = 0;
        else if (id === B.WALLPAPER) id = B.SOOTED_CONCRETE;
        else if (!BURNT_KEEP[id] && id !== B.CHEST && id !== B.CRATE && id !== B.RUBBLE && bh < 0.8) { id = 0; lt = 0; }
      }
      if (id) { put(c, x, y, z, id, meta); if (lt) lootAt(c, wx, y, wz, LOOT_KEYS[lt]); }
    }
    // на крыше: вентиляция, бак с водой у жилых домов, мачты (выход с лестницы не загораживаем)
    var nearExit = ix <= 8 && iz <= 4;
    if (p.collapsed) return;
    if (st !== 'helipad' && !nearExit && wx > p.bx0 + 1 && wx < p.bx1 - 1 && wz > p.bz0 + 1 && wz < p.bz1 - 1) {
      var rr2 = hash2(wx * 7, wz * 11, seed + 96);
      if (st === 'apart' && wx === p.bx0 + 3 && wz === p.bz1 - 3) put(c, x, p.top + 1, z, B.WATER_TANK, 0);
      else if (rr2 < 0.025) put(c, x, p.top + 1, z, B.VENT, Math.floor(rr2 * 160) & 3);
      else if (rr2 > 0.993 && st !== 'tower') { put(c, x, p.top + 1, z, B.STREET_POLE); put(c, x, p.top + 2, z, B.STREET_POLE); }
    }
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
      return;
    }
    // крыша зарастает: сад вокруг деревьев, пробившихся сквозь кровлю, или просто мох и сорняки
    if (onX || onZ || nearExit || p.burnt) return;
    var nearShaft = ix <= 9 && iz <= 5;
    if (p.roofGarden) {
      var gd = 99, rt = p.roofTrees;
      for (var ti = 0; ti < rt.length; ti++) gd = Math.min(gd, Math.max(Math.abs(wx - rt[ti][0]), Math.abs(wz - rt[ti][1])));
      if (gd <= 2 || cellNoise(seed, wx, wz, 4, 336) > 0.6) {
        put(c, x, p.top, z, B.GRASS);
        greenery(c, x, p.top + 1, z, wx, wz, B.GRASS, Math.max(OV, 0.55), seed, !nearShaft);
        return;
      }
      greenery(c, x, p.top + 1, z, wx, wz, wallMat, Math.min(1, OV + 0.3), seed, false);
    } else if (OV > 0.25) greenery(c, x, p.top + 1, z, wx, wz, wallMat, OV * 0.6, seed, false);
  }

  // ---- Окраина: четыре частных дома с садиками на участке ----------------------------
  function houseColumn(c, x, z, wx, wz, px, pz, p, seed) {
    var y, qx = px < 14 ? 0 : 1, qz = pz < 14 ? 0 : 1, ux = px - qx * 14, uz = pz - qz * 14;
    var hs = hash2(p.cx * 2 + qx, p.cz * 2 + qz, seed + 240);
    put(c, x, GROUND, z, B.GRASS);
    var doorSide = qz === 0 ? 2 : 9;                         // дверь смотрит на ближнюю улицу
    if (ux === 6 && (qz === 0 ? uz < 2 : uz > 9)) { put(c, x, GROUND, z, B.SIDEWALK); return; }
    if (hs < 0.12) {                                         // пустой участок зарос кустами и бурьяном
      greenery(c, x, GROUND + 1, z, wx, wz, B.GRASS, 0.85, seed, true);
      return;
    }
    var wallMat = hs < 0.45 ? B.PLANKS : hs < 0.8 ? B.BRICK : B.CONCRETE;
    var inside = ux >= 2 && ux <= 10 && uz >= 2 && uz <= 9;
    var roofRow = function (k) { return (uz === 2 + k || uz === 9 - k) && ux >= 1 && ux <= 11; };
    // сгоревший дом: крыша прогорела и рухнула, стены в копоти, деревянные почернели и наполовину осыпались
    var burnt = p.burnt && hs < 0.75;
    if (burnt) {
      var hb = hash2(wx, wz, seed + 249);
      if (!inside) { put(c, x, GROUND, z, hb < 0.5 ? B.SCORCHED : B.GRASS); if (hb > 0.9) put(c, x, GROUND + 1, z, B.DEAD_BUSH); return; }
      var wx2 = ux === 2 || ux === 10, wz2 = uz === 2 || uz === 9;
      put(c, x, GROUND, z, hb < 0.04 ? B.EMBERS : B.SCORCHED);
      var wallTop = GROUND + 2 + Math.floor(hash2(wx >> 1, wz >> 1, seed + 250) * 6);
      for (y = GROUND + 1; y <= wallTop; y++) if (wx2 || wz2) {
        if (uz === doorSide && ux === 6 && y <= GROUND + 2) continue;
        if (wallMat === B.PLANKS && hash3(wx, y, wz, seed + 251) < 0.45) continue;
        put(c, x, y, z, wallMat === B.PLANKS ? B.SCORCHED : burntWall(wallMat));
      }
      if (!wx2 && !wz2 && hb > 0.8) put(c, x, GROUND + 1, z, B.RUBBLE);
      return;
    }
    // двускатная крыша
    for (var k = 0; k < 4; k++) {
      y = GROUND + 8 + k;
      if (roofRow(k)) put(c, x, y, z, hs > 0.6 ? B.CONCRETE_DARK : B.BRICK);
      else if ((ux === 2 || ux === 10) && uz > 2 + k && uz < 9 - k) put(c, x, y, z, wallMat);
    }
    if (!inside) {
      if ((ux === 13 || uz === 13 || ux === 0) && hash2(wx, wz, seed + 242) < 0.7) {           // живая изгородь давно не стрижена
        put(c, x, GROUND + 1, z, B.LEAVES, 2);
        if (hash2(wz, wx, seed + 246) < OV * 0.6) put(c, x, GROUND + 2, z, B.LEAVES, 2);
        return;
      }
      // плющ по стенам дома (мимо окон и двери)
      var iv = ux === 1 && uz >= 3 && uz <= 8 ? 0 : ux === 11 && uz >= 3 && uz <= 8 ? 1 : uz === 1 && ux >= 3 && ux <= 9 ? 4 : uz === 10 && ux >= 3 && ux <= 9 ? 5 : -1;
      if (iv >= 0 && (iv < 2 ? uz : ux) % 3 !== 1 && ux !== 6 && hash2(wx, wz, seed + 247) < OV * 0.5) {
        var ih = 2 + Math.floor(hash2(wz, wx, seed + 248) * 6);
        for (y = GROUND + 1; y <= GROUND + ih; y++) put(c, x, y, z, B.IVY, iv);
        return;
      }
      greenery(c, x, GROUND + 1, z, wx, wz, B.GRASS, Math.min(1, OV + 0.1), seed, ux !== 6);
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
    if (p.burnt) {
      // сгоревший склад: каркас в копоти, крыша провалилась, ящики обуглились
      put(c, x, GROUND, z, hash2(wx, wz, seed + 255) < 0.6 ? B.SCORCHED : B.CONCRETE);
      if (wx < p.bx0 || wx > p.bx1 || wz < p.bz0 || wz > p.bz1) return;
      var onXb = wx === p.bx0 || wx === p.bx1, onZb = wz === p.bz0 || wz === p.bz1, ixb = wx - p.bx0, izb = wz - p.bz0;
      var wtop = GROUND + 3 + Math.floor(hash2(wx >> 2, wz >> 2, seed + 256) * 5);
      for (y = GROUND + 1; y <= p.top; y++) {
        var hb2 = hash3(wx, y, wz, seed + 257), id2 = 0;
        if (onXb || onZb) { if (y <= wtop && !(wz === p.bz0 && Math.abs(wx - Math.floor((p.bx0 + p.bx1) / 2)) <= 2 && y <= GROUND + 4)) id2 = B.SOOTED_CONCRETE; }
        else if (y === p.top) id2 = hb2 < 0.35 && ixb % 6 === 0 ? B.SOOTED_CONCRETE : 0;
        else if (y === GROUND + 1 && hb2 < 0.05) id2 = hb2 < 0.015 ? B.EMBERS : B.RUBBLE;
        else if (y <= GROUND + 2 && ixb % 5 === 1 && izb % 6 >= 2 && izb % 6 <= 4 && hb2 < 0.3) id2 = B.SCORCHED;
        if (id2) put(c, x, y, z, id2);
      }
      return;
    }
    put(c, x, GROUND, z, B.CONCRETE);
    if (wx < p.bx0 || wx > p.bx1 || wz < p.bz0 || wz > p.bz1) { greenery(c, x, GROUND + 1, z, wx, wz, B.CONCRETE, OV, seed, false); return; }
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
      } else if (px < 23 && hash2(wx, wz, seed + 261) < 0.02) put(c, x, GROUND + 1, z, B.CRATE);   // угол справа — стоянка бульдозера
      else if (px < 23) greenery(c, x, GROUND + 1, z, wx, wz, getc(c, x, GROUND, z), OV, seed, false);
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
      greenery(c, x, GROUND + 1, z, wx, wz, B.ASPHALT, OV * 0.8, seed, false);
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
    if (wx < p.bx0 || wx > p.bx1 || wz < p.bz0 || wz > p.bz1) {
      if (!canopy) greenery(c, x, GROUND + 1, z, wx, wz, B.ASPHALT, OV * 0.8, seed, false);
      return;
    }
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

  // ---- Военный блокпост: стена из мешков, вышки, палатки, ящики, место под танк ---------------
  function militaryColumn(c, x, z, wx, wz, px, pz, p, seed) {
    var y;
    put(c, x, GROUND, z, (px + pz) % 7 === 0 ? B.CONCRETE_DARK : B.CONCRETE);
    var ring = px === 0 || px === 27 || pz === 0 || pz === 27;
    if (ring) {
      if (pz === 0 && px >= 11 && px <= 16) {                              // ворота с шлагбаумом
        if (px === 11 || px === 16) for (y = GROUND + 1; y <= GROUND + 2; y++) put(c, x, y, z, B.CONCRETE);
        return;
      }
      for (y = GROUND + 1; y <= GROUND + 2; y++) put(c, x, y, z, B.SANDBAG);
      return;
    }
    // две вышки по углам: бетонные опоры, дощатый настил, мешки по краю, лестница
    var towers = [[2, 2], [25, 25]];
    for (var t = 0; t < 2; t++) {
      var tx = px - towers[t][0], tz = pz - towers[t][1];
      if (Math.abs(tx) > 1 || Math.abs(tz) > 2) continue;
      if (Math.abs(tx) <= 1 && Math.abs(tz) <= 1) {
        var ladderSide = tx === 0 && tz === (t ? -1 : 1);                 // опора лестницы и проход на площадку
        if ((Math.abs(tx) === 1 && Math.abs(tz) === 1) || ladderSide) for (y = GROUND + 1; y <= GROUND + 5; y++) put(c, x, y, z, B.CONCRETE);
        put(c, x, GROUND + 6, z, B.PLANKS);
        if ((Math.abs(tx) === 1 || Math.abs(tz) === 1) && !ladderSide) put(c, x, GROUND + 7, z, B.SANDBAG);
        if (tx === 0 && tz === 0) { put(c, x, GROUND + 7, z, 0); put(c, x, GROUND + 8, z, B.STREET_POLE); put(c, x, GROUND + 9, z, B.LIGHT_PANEL); }
        return;
      }
      if (tx === 0 && tz === (t ? -2 : 2)) {                             // лестница к опоре вышки
        for (y = GROUND + 1; y <= GROUND + 6; y++) put(c, x, y, z, B.LADDER, t ? 4 : 5);
        return;
      }
    }
    // палатка: зелёные стены, крыша, вход с запада
    if (px >= 17 && px <= 24 && pz >= 3 && pz <= 9) {
      var edge = px === 17 || px === 24 || pz === 3 || pz === 9;
      for (y = GROUND + 1; y <= GROUND + 3; y++) {
        if (y === GROUND + 3) put(c, x, y, z, B.WOOL_GREEN);
        else if (edge && !(px === 17 && (pz === 6 || pz === 5))) put(c, x, y, z, B.WOOL_GREEN);
      }
      if (px === 23 && pz === 8) { put(c, x, GROUND + 1, z, B.CHEST, 3); lootAt(c, wx, GROUND + 1, wz, 'military'); }
      else if (px === 23 && pz === 4) { put(c, x, GROUND + 1, z, B.CHEST, 3); lootAt(c, wx, GROUND + 1, wz, 'military'); }
      else if (!edge && px === 19 && pz % 2 === 0) put(c, x, GROUND + 1, z, B.BED);
      return;
    }
    // штабель ящиков и сундук с боеприпасами
    if (px >= 3 && px <= 8 && pz >= 20 && pz <= 24) {
      var hgt = 1 + Math.floor(hash2(wx, wz, seed + 290) * 3);
      if (px === 5 && pz === 22) { put(c, x, GROUND + 1, z, B.CHEST, 0); lootAt(c, wx, GROUND + 1, wz, 'military'); return; }
      for (y = GROUND + 1; y <= GROUND + hgt; y++) put(c, x, y, z, B.CRATE);
      return;
    }
    // прожектор
    if (px === 13 && pz === 26) { for (y = GROUND + 1; y <= GROUND + 4; y++) put(c, x, y, z, B.STREET_POLE); put(c, x, GROUND + 5, z, B.LIGHT_PANEL); return; }
    // бочки с топливом у стены
    if (px >= 24 && px <= 26 && pz >= 12 && pz <= 13) put(c, x, GROUND + 1, z, B.FUEL_BARREL);
  }

  // ---- Добыча в сундуках: [предмет, от, до, шанс] ------------------------------------------
  var LOOT = {
    city: [[I.CANNED_FOOD, 1, 3, 0.7], [I.BREAD, 1, 2, 0.4], [I.MEDKIT, 1, 1, 0.3], [I.AMMO, 4, 12, 0.35], [I.PISTOL, 1, 1, 0.08],
      [I.BAT, 1, 1, 0.15], [I.MACHETE, 1, 1, 0.07], [B.TORCH, 2, 8, 0.4], [I.APPLE, 1, 3, 0.3], [I.IRON_INGOT, 1, 3, 0.25], [I.STRING, 1, 3, 0.2],
      [I.BANDAGE, 1, 3, 0.3], [I.CITY_MAP, 1, 1, 0.05], [I.FIRE_AXE, 1, 1, 0.04], [I.SHELLS, 2, 6, 0.1]],
    office: [[I.PAPER, 2, 8, 0.6], [I.BOOK, 1, 2, 0.3], [I.CANNED_FOOD, 1, 2, 0.5], [I.MEDKIT, 1, 2, 0.35], [I.AMMO, 6, 16, 0.4],
      [I.PISTOL, 1, 1, 0.14], [I.MACHETE, 1, 1, 0.1], [I.SPARK_DUST, 2, 6, 0.3], [I.DIAMOND, 1, 1, 0.05], [I.CITY_MAP, 1, 1, 0.1]],
    house: [[I.CANNED_FOOD, 1, 2, 0.5], [I.BREAD, 1, 3, 0.5], [I.APPLE, 1, 4, 0.5], [I.SEEDS, 2, 6, 0.3], [I.BANDAGE, 1, 2, 0.35],
      [B.TORCH, 2, 6, 0.4], [I.BAT, 1, 1, 0.12], [B.PLANKS, 4, 12, 0.3], [I.CITY_MAP, 1, 1, 0.08], [I.SHOTGUN, 1, 1, 0.04],
      [I.SHELLS, 2, 8, 0.12], [I.FIRE_AXE, 1, 1, 0.05]],
    hospital: [[I.MEDKIT, 1, 2, 0.7], [I.BANDAGE, 2, 6, 0.8], [I.CANNED_FOOD, 1, 2, 0.3], [I.GOLDEN_APPLE, 1, 1, 0.06], [I.PAPER, 1, 4, 0.3]],
    police: [[I.AMMO, 6, 16, 0.6], [I.PISTOL, 1, 1, 0.25], [I.FLASHLIGHT, 1, 1, 0.3], [I.BODY_ARMOR, 1, 1, 0.15], [I.BANDAGE, 1, 3, 0.4], [I.CANNED_FOOD, 1, 2, 0.3],
      [I.CITY_MAP, 1, 1, 0.25], [I.RADIO, 1, 1, 0.15], [I.SHOTGUN, 1, 1, 0.2], [I.SHELLS, 4, 12, 0.45]],
    armory: [[I.RADIO, 1, 1, 1], [I.FLASHLIGHT, 1, 1, 0.9], [I.AMMO, 16, 32, 1], [I.PISTOL, 1, 1, 0.8], [I.BODY_ARMOR, 1, 1, 0.6], [I.MACHETE, 1, 1, 0.4], [I.MEDKIT, 1, 1, 0.5],
      [I.SHOTGUN, 1, 1, 0.7], [I.SHELLS, 8, 20, 0.9], [I.RIFLE, 1, 1, 0.3], [I.RIFLE_AMMO, 20, 40, 0.4]],
    military: [[I.FLASHLIGHT, 1, 1, 0.5], [I.RIFLE, 1, 1, 0.7], [I.RIFLE_AMMO, 30, 60, 1], [I.SNIPER, 1, 1, 0.25], [I.GRENADE, 2, 5, 0.7], [I.TANK_SHELL, 4, 10, 0.8],
      [I.BODY_ARMOR, 1, 1, 0.5], [I.MEDKIT, 1, 2, 0.6], [I.SPACE_RATION, 2, 4, 0.5], [I.SHELLS, 8, 16, 0.4], [I.FLAMETHROWER, 1, 1, 0.12],
      [I.FUEL_CAN, 1, 2, 0.5], [I.CITY_MAP, 1, 1, 0.3]],
    market: [[I.FLASHLIGHT, 1, 1, 0.2], [I.CANNED_FOOD, 2, 5, 0.8], [I.BREAD, 1, 4, 0.6], [I.APPLE, 2, 6, 0.5], [I.BEEF_COOKED, 1, 3, 0.3], [I.PORK_COOKED, 1, 3, 0.2],
      [B.TORCH, 4, 10, 0.3], [I.BANDAGE, 1, 3, 0.2]],
    gas: [[I.FUEL_CAN, 1, 2, 0.85], [I.CANNED_FOOD, 1, 2, 0.4], [I.BREAD, 1, 2, 0.3], [B.TORCH, 2, 6, 0.4], [I.CITY_MAP, 1, 1, 0.3], [I.MOLOTOV, 1, 3, 0.35]],
    industrial: [[B.PLANKS, 6, 16, 0.6], [I.IRON_INGOT, 2, 6, 0.5], [I.FUEL_CAN, 1, 1, 0.35], [I.STICK, 4, 12, 0.4], [B.BARRICADE, 2, 6, 0.45],
      [I.SPARK_DUST, 2, 8, 0.3], [B.TNT, 1, 2, 0.06], [I.CROWBAR, 1, 1, 0.2], [I.FIRE_AXE, 1, 1, 0.1]],
    build: [[B.PLANKS, 8, 20, 0.7], [B.BARRICADE, 3, 8, 0.55], [I.IRON_INGOT, 1, 4, 0.4], [330 + 4, 1, 1, 0.15], [306, 1, 1, 0.3], [B.LADDER, 4, 10, 0.4],
      [I.CHAINSAW, 1, 1, 0.14], [I.CROWBAR, 1, 1, 0.3], [I.FUEL_CAN, 1, 1, 0.3]],
    metro: [[I.CANNED_FOOD, 1, 3, 0.45], [B.TORCH, 4, 10, 0.6], [I.BANDAGE, 1, 3, 0.4], [I.AMMO, 4, 10, 0.3], [I.CITY_MAP, 1, 1, 0.25]],
    cityhall: [[I.CITY_MAP, 1, 1, 0.8], [I.RADIO, 1, 1, 0.35], [I.PISTOL, 1, 1, 0.4], [I.AMMO, 8, 20, 0.7], [I.GOLD_INGOT, 2, 8, 0.6],
      [I.MEDKIT, 1, 2, 0.5], [I.FLASHLIGHT, 1, 1, 0.4], [I.BOOK, 1, 3, 0.4], [I.BODY_ARMOR, 1, 1, 0.2]],
    // мебель в квартирах и офисах
    fridge: [[I.CANNED_FOOD, 1, 2, 0.35], [I.APPLE, 1, 3, 0.4], [I.BREAD, 1, 2, 0.3], [I.BEEF_COOKED, 1, 2, 0.2], [I.CHICKEN_COOKED, 1, 2, 0.2],
      [I.PORK_COOKED, 1, 2, 0.15], [I.ROTTEN_FLESH, 1, 3, 0.35]],
    kitchen: [[I.CANNED_FOOD, 1, 3, 0.55], [I.BREAD, 1, 2, 0.25], [B.TORCH, 1, 4, 0.2], [I.BUCKET, 1, 1, 0.1], [I.SEEDS, 1, 4, 0.15],
      [I.MACHETE, 1, 1, 0.04], [I.MOLOTOV, 1, 1, 0.05], [I.FLINT_STEEL, 1, 1, 0.08], [I.PAPER, 1, 3, 0.15]],
    wardrobe: [[330, 1, 1, 0.18], [331, 1, 1, 0.14], [332, 1, 1, 0.14], [333, 1, 1, 0.18], [I.STRING, 1, 4, 0.3], [B.WOOL_WHITE, 1, 3, 0.25],
      [I.LEATHER, 1, 3, 0.2], [I.BAT, 1, 1, 0.08], [I.BODY_ARMOR, 1, 1, 0.03], [I.SHOTGUN, 1, 1, 0.02], [I.SHELLS, 2, 6, 0.06], [I.FLASHLIGHT, 1, 1, 0.06]],
    desk: [[I.PAPER, 1, 6, 0.6], [I.BOOK, 1, 1, 0.2], [I.AMMO, 2, 8, 0.12], [I.PISTOL, 1, 1, 0.04], [I.CITY_MAP, 1, 1, 0.07], [I.FLASHLIGHT, 1, 1, 0.06],
      [I.SPARK_DUST, 1, 3, 0.1], [I.BANDAGE, 1, 1, 0.1], [I.CANNED_FOOD, 1, 1, 0.12]],
    files: [[I.PAPER, 3, 12, 0.8], [I.BOOK, 1, 3, 0.35], [I.CITY_MAP, 1, 1, 0.12], [I.RADIO, 1, 1, 0.02]],
    medicine: [[I.BANDAGE, 1, 4, 0.8], [I.MEDKIT, 1, 1, 0.3], [I.GOLDEN_APPLE, 1, 1, 0.02]],
    airdrop: [[I.MEDKIT, 1, 3, 0.9], [I.AMMO, 12, 24, 0.9], [I.CANNED_FOOD, 3, 6, 1], [I.BANDAGE, 2, 4, 0.6], [I.BODY_ARMOR, 1, 1, 0.25],
      [I.FUEL_CAN, 1, 1, 0.5], [I.PISTOL, 1, 1, 0.3], [B.BARRICADE, 2, 4, 0.4], [I.RIFLE_AMMO, 15, 30, 0.4], [I.GRENADE, 1, 3, 0.35],
      [I.SHELLS, 6, 12, 0.35], [I.RIFLE, 1, 1, 0.12]],
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
