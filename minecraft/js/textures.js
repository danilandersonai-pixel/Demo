/* Кубокрафт — процедурные текстуры: атлас блоков и предметов 256×256 (плитки 16×16),
   трещины добычи, иконки HUD. Всё рисуется кодом, картинок нет.
   Порядок объявления плиток задаёт их индексы в KC.TILE. */
(function (KC) {
  'use strict';

  var TILE = {}, PAINTERS = [];
  var ATLAS = 256, ATLAS_H = 512, TS = 16;   // 16 колонок × 32 ряда плиток

  function tile(name, fn) { TILE[name] = PAINTERS.length; PAINTERS.push(fn); }

  // ---- Инструменты рисования (привязаны к текущей плитке) ----------------------
  var d, cur, rnd;
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  function px(x, y, c, a) {
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    var tx = (cur % 16) * TS + x, ty = Math.floor(cur / 16) * TS + y;
    var i = (ty * ATLAS + tx) * 4;
    d[i] = clamp255(c[0]); d[i + 1] = clamp255(c[1]); d[i + 2] = clamp255(c[2]);
    d[i + 3] = a === undefined ? 255 : a;
  }
  function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function jit(c, s) { return mul(c, 1 + (rnd() - 0.5) * s); }
  function fill(base, s) { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(base, s)); }
  function clear() { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, [0, 0, 0], 0); }
  function pick(l) { return l[Math.floor(rnd() * l.length)]; }
  function rect(x0, y0, x1, y1, c, s) {
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) px(x, y, s ? jit(c, s) : c);
  }
  // Спрайт из строк: '.' — прозрачно, остальные символы — цвета палитры
  function sprite(rows, pal, noise) {
    clear();
    for (var y = 0; y < rows.length; y++) {
      var r = rows[y];
      for (var x = 0; x < r.length; x++) {
        var ch = r.charAt(x);
        if (ch === '.' || ch === ' ' || !pal[ch]) continue;
        px(x, y, noise ? jit(pal[ch], noise) : pal[ch]);
      }
    }
  }

  // ---- Общие мотивы -------------------------------------------------------------
  function dirt() {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd();
      px(x, y, r < 0.1 ? [98, 68, 46] : r < 0.17 ? [160, 122, 88] : jit([134, 96, 66], 0.2));
    }
  }
  function stone() {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit([124, 124, 126], 0.16));
    for (var s = 0; s < 6; s++) {
      var sx = Math.floor(rnd() * 16), sy = Math.floor(rnd() * 16), len = 2 + Math.floor(rnd() * 3);
      for (var k = 0; k < len; k++) px(sx + k, sy, [98, 98, 100]);
    }
  }
  function ore(c1, c2) {
    stone();
    for (var k = 0; k < 4; k++) {
      var cx = 2 + rnd() * 12, cy = 2 + rnd() * 12;
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        var dd = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (dd < 2.2 && rnd() < 0.85) px(x, y, rnd() < 0.35 ? c2 : c1);
      }
    }
  }
  function planks(base) {
    base = base || [170, 134, 84];
    for (var y = 0; y < 16; y++) {
      var board = Math.floor(y / 4), rowK = 0.92 + rnd() * 0.14, seam = (board * 7 + 3) % 16;
      for (var x = 0; x < 16; x++) {
        var pc = (y % 4 === 3 || x === seam) ? mul(base, 0.66) : mul(base, rowK * (x % 5 === 0 ? 0.95 : 1));
        px(x, y, jit(pc, 0.06));
      }
    }
  }
  function cobble() {
    var pts = [], i, x, y;
    for (i = 0; i < 9; i++) pts.push([rnd() * 16, rnd() * 16, 0.75 + rnd() * 0.45]);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var best = 1e9, second = 1e9, bi = 0;
      for (i = 0; i < pts.length; i++) {
        for (var ox = -16; ox <= 16; ox += 16) for (var oy = -16; oy <= 16; oy += 16) {
          var dx = x + 0.5 - pts[i][0] - ox, dy = y + 0.5 - pts[i][1] - oy, dd = dx * dx + dy * dy;
          if (dd < best) { second = best; best = dd; bi = i; } else if (dd < second) second = dd;
        }
      }
      var edge = Math.sqrt(second) - Math.sqrt(best);
      px(x, y, edge < 1.1 ? jit([72, 72, 74], 0.15) : jit(mul([128, 128, 130], pts[bi][2]), 0.12));
    }
  }
  function rings(light, dark, bark) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var dd = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      px(x, y, jit(dd >= 7 ? bark : (Math.floor(dd) % 2 === 0 ? light : dark), 0.08));
    }
  }
  function bevel(base, hi, lo) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var c = (x === 0 || y === 0) ? hi : (x === 15 || y === 15) ? lo : base;
      px(x, y, jit(c, 0.06));
    }
  }
  function wool(c) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(mul(c, (x + y) % 3 === 0 ? 0.93 : 1), 0.08));
  }
  function flower(petal, petalDark, center) {
    clear();
    for (var y = 8; y < 16; y++) px(7, y, [60, 120, 40]);
    px(6, 12, [74, 140, 50]); px(5, 11, [74, 140, 50]); px(8, 13, [74, 140, 50]); px(9, 12, [74, 140, 50]);
    for (var yy = 3; yy <= 7; yy++) for (var x = 5; x <= 9; x++) {
      var dd = Math.abs(x - 7) + Math.abs(yy - 5);
      if (dd <= 3) px(x, yy, dd === 0 ? center : (dd === 3 ? petalDark : petal));
    }
  }
  function grassEdge(topColor, deep) {
    dirt();
    for (var x = 0; x < 16; x++) {
      var depth = 3 + (rnd() < 0.5 ? 1 : 0) + (rnd() < 0.2 ? 1 : 0);
      for (var y = 0; y < depth; y++) px(x, y, jit(y === depth - 1 && deep ? deep : topColor, 0.15));
    }
  }

  // =================================================================================
  // Блоки (порядок старых плиток сохранён)
  // =================================================================================
  tile('grassTop', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd();
      px(x, y, r < 0.12 ? [126, 190, 74] : r < 0.24 ? [72, 128, 42] : jit([98, 160, 56], 0.22));
    }
  });
  tile('grassSide', function () { grassEdge([96, 156, 54], [78, 136, 44]); });
  tile('dirt', dirt);
  tile('stone', stone);
  tile('cobble', cobble);
  tile('sand', function () { fill([219, 205, 150], 0.1); });
  tile('logSide', function () {
    var colK = [];
    for (var x = 0; x < 16; x++) colK.push(0.82 + rnd() * 0.3);
    for (var y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var dark = (x % 4 === 1 && rnd() < 0.8) ? 0.72 : 1;
      px(x, y, jit(mul([106, 80, 48], colK[x] * dark), 0.1));
    }
  });
  tile('logTop', function () { rings([178, 144, 92], [150, 118, 72], [106, 80, 48]); });
  tile('leaves', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      if (rnd() < 0.16) { px(x, y, [0, 0, 0], 0); continue; }
      var lr = rnd();
      px(x, y, lr < 0.15 ? [86, 150, 58] : lr < 0.3 ? [40, 92, 30] : jit([58, 122, 42], 0.25));
    }
  });
  tile('planks', function () { planks(); });
  tile('glass', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      if (x === 0 || y === 0 || x === 15 || y === 15) px(x, y, jit([196, 228, 238], 0.05));
      else px(x, y, [0, 0, 0], 0);
    }
    [[3, 5], [4, 4], [5, 3], [3, 6], [10, 12], [11, 11], [12, 10]].forEach(function (p) { px(p[0], p[1], [232, 246, 250]); });
  });
  tile('water', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit([48, 100, 196], 0.12));
    for (var i = 0; i < 8; i++) {
      var wx = Math.floor(rnd() * 13), wy = Math.floor(rnd() * 16);
      for (var k = 0; k < 3; k++) px(wx + k, wy, [84, 142, 222]);
    }
  });
  tile('bedrock', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, pick([[40, 40, 42], [84, 84, 86], [60, 60, 62], [118, 118, 120], [30, 30, 32]]));
  });
  tile('brick', function () {
    for (var y = 0; y < 16; y++) {
      var row = Math.floor(y / 4);
      for (var x = 0; x < 16; x++) {
        var mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
        px(x, y, mortar ? jit([190, 184, 172], 0.05) : jit([150, 68, 52], 0.14));
      }
    }
  });
  tile('snow', function () { fill([236, 243, 248], 0.07); });
  tile('snowSide', function () { grassEdge([236, 243, 248]); });
  tile('gravel', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      px(x, y, jit(pick([[132, 126, 122], [104, 100, 98], [152, 146, 140], [118, 106, 98], [90, 86, 86]]), 0.08));
    }
  });
  tile('coalOre', function () { ore([34, 34, 36], [62, 62, 64]); });
  tile('ironOre', function () { ore([216, 174, 146], [184, 140, 112]); });
  tile('cactusSide', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var line = x === 0 || x === 15 || x === 4 || x === 11;
      px(x, y, jit(line ? [44, 104, 42] : [72, 142, 60], 0.12));
    }
    for (var i = 0; i < 8; i++) px(1 + Math.floor(rnd() * 14), Math.floor(rnd() * 16), [222, 230, 196]);
  });
  tile('cactusTop', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var cd = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      px(x, y, jit(cd > 6.5 ? [44, 104, 42] : cd < 2 ? [120, 176, 90] : [84, 152, 66], 0.1));
    }
  });
  tile('sandstoneSide', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var sc = y < 3 ? [230, 216, 168] : y === 3 ? [190, 172, 120] : y > 11 ? (rnd() < 0.2 ? [196, 178, 128] : [214, 198, 148]) : [218, 202, 152];
      px(x, y, jit(sc, 0.06));
    }
  });
  tile('sandstoneTop', function () { fill([222, 208, 158], 0.07); });
  tile('tallGrass', function () {
    clear();
    for (var i = 0; i < 9; i++) {
      var gx = 1 + Math.floor(rnd() * 14), gh = 5 + Math.floor(rnd() * 9), lean = rnd() < 0.5 ? -1 : 1;
      for (var y = 0; y < gh; y++) px(gx + (y > gh * 0.6 ? lean : 0), 15 - y, jit(y > gh - 3 ? [112, 176, 70] : [72, 132, 44], 0.15));
    }
  });
  tile('poppy', function () { flower([208, 44, 40], [150, 26, 24], [48, 20, 18]); });
  tile('dandelion', function () { flower([246, 212, 44], [214, 170, 24], [255, 240, 120]); });
  tile('stoneBrick', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var sr = y < 8 ? 0 : 1;
      var m = y === 7 || y === 15 || (sr === 0 ? x === 15 : x === 7);
      var hi = !m && (y === 0 || y === 8 || (sr === 0 ? x === 0 : x === 8));
      px(x, y, m ? jit([84, 84, 86], 0.06) : hi ? jit([146, 146, 148], 0.05) : jit([120, 120, 122], 0.1));
    }
  });
  tile('bookshelf', function () {
    var cols = [[150, 40, 40], [44, 72, 142], [52, 112, 62], [172, 140, 52], [112, 60, 122], [92, 62, 40], [180, 170, 150]];
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var shelf = y <= 1 || y >= 14 || y === 7 || y === 8;
      px(x, y, shelf ? jit([168, 132, 82], 0.06) : [52, 38, 26]);
    }
    [[2, 6], [9, 13]].forEach(function (r) {
      var x = 1;
      while (x < 15) {
        var w = rnd() < 0.3 ? 2 : 1, col = pick(cols), top = r[0] + (rnd() < 0.35 ? 1 : 0);
        for (var b = 0; b < w && x < 15; b++, x++) for (var yy = top; yy <= r[1]; yy++) px(x, yy, jit(col, 0.1));
        x += rnd() < 0.2 ? 1 : 0;
      }
    });
  });
  tile('woolWhite', function () { wool([234, 234, 230]); });
  tile('woolRed', function () { wool([176, 44, 40]); });
  tile('woolBlue', function () { wool([52, 72, 160]); });
  tile('woolYellow', function () { wool([238, 196, 44]); });
  tile('woolGreen', function () { wool([86, 138, 40]); });
  tile('birchSide', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit([218, 216, 206], 0.06));
    for (var i = 0; i < 7; i++) {
      var bx = Math.floor(rnd() * 14), by = Math.floor(rnd() * 16), bl = 2 + Math.floor(rnd() * 3);
      for (var k = 0; k < bl; k++) px(bx + k, by, [46, 44, 40]);
    }
  });
  tile('birchTop', function () { rings([206, 186, 136], [186, 164, 116], [218, 216, 206]); });
  tile('obsidian', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd();
      px(x, y, r < 0.08 ? [70, 46, 104] : r < 0.2 ? [36, 26, 56] : jit([20, 16, 30], 0.3));
    }
  });
  tile('goldBlock', function () {
    bevel([246, 206, 62], [255, 242, 150], [196, 146, 30]);
    for (var i = 0; i < 5; i++) px(2 + Math.floor(rnd() * 12), 2 + Math.floor(rnd() * 12), [255, 250, 200]);
  });

  // ---- Новые блоки ---------------------------------------------------------------
  tile('lava', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd();
      px(x, y, r < 0.12 ? [255, 214, 90] : r < 0.3 ? [196, 60, 16] : jit([236, 112, 30], 0.14));
    }
    for (var i = 0; i < 5; i++) {
      var lx = Math.floor(rnd() * 13), ly = Math.floor(rnd() * 16);
      for (var k = 0; k < 3; k++) px(lx + k, ly, [255, 236, 140]);
    }
  });
  tile('goldOre', function () { ore([246, 214, 70], [214, 168, 36]); });
  tile('diamondOre', function () { ore([100, 226, 226], [52, 176, 190]); });
  tile('sparkOre', function () { ore([214, 36, 30], [150, 20, 16]); });
  tile('clay', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(rnd() < 0.1 ? [140, 148, 166] : [160, 166, 182], 0.06));
  });
  tile('sugarCane', function () {
    clear();
    [3, 8, 12].forEach(function (sx, n) {
      for (var y = 0; y < 16; y++) {
        var joint = (y + n * 3) % 6 === 0;
        px(sx, y, joint ? [126, 170, 80] : jit([150, 200, 100], 0.08));
        px(sx + 1, y, joint ? [96, 140, 60] : jit([118, 170, 76], 0.08));
      }
      px(sx - 1, 3 + n * 3, [110, 170, 70]); px(sx + 2, 6 + n * 2, [110, 170, 70]);
    });
  });
  tile('cornflower', function () { flower([70, 110, 230], [40, 70, 180], [220, 220, 255]); });
  tile('tableTop', function () {
    planks([176, 136, 84]);
    for (var i = 0; i < 16; i++) { px(i, 0, [96, 68, 40]); px(i, 15, [96, 68, 40]); px(0, i, [96, 68, 40]); px(15, i, [96, 68, 40]); }
    for (i = 3; i <= 12; i++) { px(i, 5, [120, 88, 52]); px(i, 10, [120, 88, 52]); px(5, i, [120, 88, 52]); px(10, i, [120, 88, 52]); }
  });
  tile('tableSide', function () {
    planks([162, 124, 76]);
    rect(0, 0, 15, 2, [120, 88, 52], 0.06);
    // пила и молоток на стене верстака
    rect(3, 5, 9, 6, [180, 184, 190]); for (var x = 3; x <= 9; x += 2) px(x, 7, [150, 154, 160]);
    rect(10, 5, 12, 6, [90, 60, 36]);
    rect(4, 10, 5, 14, [110, 76, 44]); rect(2, 9, 7, 10, [120, 124, 130]);
  });
  tile('tableFront', function () {
    planks([162, 124, 76]);
    rect(0, 0, 15, 2, [120, 88, 52], 0.06);
    rect(3, 5, 12, 13, [96, 70, 42]);
    rect(4, 6, 11, 12, [130, 96, 58], 0.08);
    rect(10, 4, 11, 5, [180, 184, 190]);
  });
  function furnaceStone() {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var edge = x === 0 || y === 0 || x === 15 || y === 15;
      px(x, y, jit(edge ? [96, 96, 98] : [132, 132, 134], 0.1));
    }
  }
  tile('furnaceSide', function () { furnaceStone(); rect(1, 13, 14, 13, [106, 106, 108]); });
  tile('furnaceTop', function () { furnaceStone(); });
  tile('furnaceFront', function () {
    furnaceStone();
    rect(3, 3, 12, 5, [92, 92, 94]);
    rect(4, 8, 11, 13, [30, 28, 28]);
    rect(4, 7, 11, 7, [80, 80, 82]);
  });
  tile('furnaceLit', function () {
    furnaceStone();
    rect(3, 3, 12, 5, [92, 92, 94]);
    rect(4, 8, 11, 13, [60, 30, 18]);
    for (var y = 9; y <= 13; y++) for (var x = 4; x <= 11; x++) {
      if (rnd() < 0.6 + (y - 9) * 0.1) px(x, y, pick([[255, 180, 60], [255, 120, 30], [250, 220, 110]]));
    }
    rect(4, 7, 11, 7, [80, 80, 82]);
  });
  function chestWood(frontLatch, top) {
    planks([158, 110, 56]);
    for (var i = 0; i < 16; i++) { px(i, 0, [70, 46, 22]); px(i, 15, [70, 46, 22]); px(0, i, [70, 46, 22]); px(15, i, [70, 46, 22]); }
    if (!top) rect(1, 5, 14, 5, [70, 46, 22]);
    if (frontLatch) { rect(7, 4, 8, 7, [200, 200, 206]); px(7, 7, [120, 120, 126]); px(8, 7, [120, 120, 126]); }
  }
  tile('chestTop', function () { chestWood(false, true); });
  tile('chestSide', function () { chestWood(false, false); });
  tile('chestFront', function () { chestWood(true, false); });
  tile('torch', function () {
    clear();
    for (var y = 6; y < 16; y++) { px(7, y, jit([128, 92, 52], 0.1)); px(8, y, jit([100, 70, 40], 0.1)); }
    px(7, 5, [255, 214, 90]); px(8, 5, [255, 190, 60]);
    px(7, 4, [255, 246, 190]); px(8, 4, [255, 220, 110]);
    px(7, 6, [240, 140, 40]); px(8, 6, [220, 110, 30]);
  });
  function farmland(wet) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var furrow = x % 4 === 0;
      var base = wet ? [88, 60, 38] : [128, 92, 60];
      px(x, y, jit(furrow ? mul(base, 0.72) : base, 0.14));
    }
  }
  tile('farmland', function () { farmland(false); });
  tile('farmlandWet', function () { farmland(true); });
  function wheat(stage) {
    clear();
    var h = [4, 7, 10, 13, 14][stage];
    var stem = stage >= 4 ? [196, 168, 70] : mix([70, 150, 40], [150, 160, 50], stage / 3);
    [1, 4, 7, 10, 13].forEach(function (x, n) {
      var hh = h - (n % 2);
      for (var y = 0; y < hh; y++) px(x + (y > hh - 3 && n % 2 ? 1 : 0), 15 - y, jit(stem, 0.12));
      if (stage >= 3) {
        var ear = stage >= 4 ? [226, 190, 80] : [150, 170, 60];
        for (var e = 0; e < 3; e++) { px(x - 1, 16 - hh + e, jit(ear, 0.1)); px(x + 1, 16 - hh + e + 1, jit(ear, 0.1)); }
      }
    });
  }
  tile('wheat0', function () { wheat(0); });
  tile('wheat1', function () { wheat(1); });
  tile('wheat2', function () { wheat(2); });
  tile('wheat3', function () { wheat(3); });
  tile('wheat4', function () { wheat(4); });
  function sapling(leafC, barkC) {
    clear();
    for (var y = 9; y < 16; y++) px(7, y, jit(barkC, 0.1));
    for (var yy = 2; yy <= 10; yy++) for (var x = 3; x <= 12; x++) {
      var dx = x - 7.5, dy = yy - 6;
      if (dx * dx / 20 + dy * dy / 12 < 1 && rnd() < 0.8) px(x, yy, jit(leafC, 0.25));
    }
  }
  tile('saplingOak', function () { sapling([58, 122, 42], [106, 80, 48]); });
  tile('saplingBirch', function () { sapling([96, 150, 64], [218, 216, 206]); });
  tile('ladder', function () {
    clear();
    for (var y = 0; y < 16; y++) { px(2, y, jit([126, 94, 56], 0.1)); px(3, y, jit([104, 76, 44], 0.1)); px(12, y, jit([126, 94, 56], 0.1)); px(13, y, jit([104, 76, 44], 0.1)); }
    [1, 5, 9, 13].forEach(function (y) { for (var x = 2; x <= 13; x++) { px(x, y, jit([150, 114, 70], 0.1)); px(x, y + 1, jit([112, 84, 50], 0.1)); } });
  });
  function doorHalf(top) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var frame = x <= 1 || x >= 14 || (top ? y <= 1 : y >= 14) || (!top && y === 0) || (top && y === 15);
      px(x, y, jit(frame ? [120, 86, 50] : [156, 116, 70], 0.08));
    }
    if (top) {
      rect(3, 3, 7, 12, [70, 50, 30]); rect(8, 3, 12, 12, [70, 50, 30]);
      rect(4, 4, 6, 11, [150, 190, 210]); rect(9, 4, 11, 11, [150, 190, 210]);
      px(4, 4, [210, 230, 240]); px(9, 4, [210, 230, 240]);
    } else {
      rect(3, 2, 12, 12, [132, 96, 58], 0.06);
      rect(4, 3, 11, 11, [156, 116, 70], 0.06);
      rect(12, 1, 13, 2, [60, 60, 64]);
    }
  }
  tile('doorTop', function () { doorHalf(true); });
  tile('doorBottom', function () { doorHalf(false); });
  tile('bedTop', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      if (y < 5) px(x, y, jit(x === 0 || x === 15 ? [200, 200, 196] : [238, 238, 232], 0.04));
      else px(x, y, jit(y === 5 ? [140, 30, 30] : [182, 44, 44], 0.08));
    }
    for (x = 2; x <= 13; x++) px(x, 9, [206, 70, 62]);
  });
  tile('bedSide', function () {
    clear();
    for (var y = 7; y < 16; y++) for (var x = 0; x < 16; x++) {
      if (y <= 11) px(x, y, jit(y === 7 ? [206, 70, 62] : [172, 40, 40], 0.08));
      else if (x <= 1 || x >= 14) px(x, y, jit([120, 86, 50], 0.08));
      else if (y === 12) px(x, y, jit([140, 104, 62], 0.08));
    }
  });
  tile('ironBlock', function () { bevel([214, 214, 218], [244, 244, 248], [160, 160, 166]); rect(3, 3, 12, 12, [204, 204, 208], 0.04); });
  tile('diamondBlock', function () { bevel([110, 224, 220], [190, 250, 246], [52, 160, 170]); for (var i = 0; i < 6; i++) px(2 + Math.floor(rnd() * 12), 2 + Math.floor(rnd() * 12), [230, 255, 255]); });
  tile('tntSide', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var band = y >= 5 && y <= 10;
      px(x, y, jit(band ? [232, 226, 214] : (x % 4 === 3 ? [150, 36, 30] : [196, 52, 40]), 0.06));
    }
    // знак опасности: чёрные ромбы на ленте
    [3, 8, 13].forEach(function (cx) { px(cx, 7, [30, 26, 24]); px(cx - 1, 8, [30, 26, 24]); px(cx, 8, [30, 26, 24]); px(cx + 1, 8, [30, 26, 24]); px(cx, 9, [30, 26, 24]); });
  });
  tile('tntTop', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit((x + y) % 5 === 0 ? [160, 40, 32] : [196, 52, 40], 0.06));
    rect(6, 6, 9, 9, [70, 60, 50]); px(7, 7, [30, 26, 24]); px(8, 8, [30, 26, 24]);
  });
  tile('tntBottom', function () { fill([170, 44, 34], 0.1); });
  function dust(c1, c2) {
    clear();
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var onLine = (Math.abs(x - 7.5) < 1.6 || Math.abs(y - 7.5) < 1.6) && rnd() < 0.8;
      var center = Math.abs(x - 7.5) + Math.abs(y - 7.5) < 3.6;
      if (onLine || center) px(x, y, rnd() < 0.3 ? c2 : c1);
    }
  }
  tile('wireOff', function () { dust([112, 16, 12], [80, 8, 6]); });
  tile('wireOn', function () { dust([250, 50, 36], [255, 120, 90]); });
  function sparkTorch(on) {
    clear();
    for (var y = 6; y < 16; y++) { px(7, y, jit([128, 92, 52], 0.1)); px(8, y, jit([100, 70, 40], 0.1)); }
    var c1 = on ? [255, 70, 50] : [110, 24, 18], c2 = on ? [255, 180, 150] : [80, 16, 12];
    px(7, 5, c1); px(8, 5, c1); px(7, 4, c2); px(8, 4, c1); px(7, 6, c1); px(8, 6, c1);
    if (on) { px(6, 5, [200, 40, 30]); px(9, 5, [200, 40, 30]); }
  }
  tile('sparkTorchOn', function () { sparkTorch(true); });
  tile('sparkTorchOff', function () { sparkTorch(false); });
  function lamp(on) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var frame = x === 0 || y === 0 || x === 15 || y === 15 || x === 7 || y === 7;
      var c = frame ? (on ? [150, 96, 40] : [80, 56, 36]) : (on ? mix([255, 220, 120], [255, 250, 210], rnd()) : jit([110, 72, 44], 0.2));
      px(x, y, c);
    }
  }
  tile('lampOff', function () { lamp(false); });
  tile('lampOn', function () { lamp(true); });
  tile('sparkBlock', function () {
    bevel([196, 30, 24], [240, 90, 70], [130, 16, 12]);
    for (var i = 0; i < 10; i++) px(2 + Math.floor(rnd() * 12), 2 + Math.floor(rnd() * 12), [255, 140, 110]);
  });
  tile('pistonSide', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      if (y < 4) px(x, y, jit(y === 3 ? [110, 80, 46] : [166, 128, 78], 0.06));
      else px(x, y, jit(x === 0 || x === 15 || y === 15 ? [86, 86, 88] : [122, 122, 124], 0.12));
    }
    rect(6, 4, 9, 10, [170, 170, 176]);
  });
  tile('pistonFace', function () {
    planks([166, 128, 78]);
    rect(5, 5, 10, 10, [180, 180, 186]); rect(6, 6, 9, 9, [140, 140, 146]);
  });
  tile('pistonBack', function () { furnaceStone(); rect(5, 5, 10, 10, [96, 96, 98]); });
  tile('pistonInner', function () { furnaceStone(); rect(4, 4, 11, 11, [60, 58, 56]); rect(6, 6, 9, 9, [170, 170, 176]); });
  function pumpkinBase() {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var ridge = x % 4 === 0;
      px(x, y, jit(ridge ? [196, 106, 20] : [226, 132, 30], 0.08));
    }
  }
  tile('pumpkinSide', pumpkinBase);
  tile('pumpkinTop', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var dd = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      px(x, y, jit(Math.floor(dd) % 3 === 0 ? [200, 110, 22] : [228, 134, 32], 0.08));
    }
    rect(7, 6, 8, 9, [100, 120, 40]);
  });
  // Своё лицо тыквы: круглые глаза и волнистая улыбка
  function pumpkinFace(glow) {
    pumpkinBase();
    var hole = glow ? [255, 214, 90] : [60, 34, 10];
    [[4, 5], [11, 5]].forEach(function (e) {
      for (var y = -1; y <= 1; y++) for (var x = -1; x <= 1; x++) if (Math.abs(x) + Math.abs(y) < 2) px(e[0] + x, e[1] + y, hole);
    });
    for (var x2 = 3; x2 <= 12; x2++) px(x2, 10 + (x2 % 3 === 0 ? 1 : 0), hole);
    for (x2 = 4; x2 <= 11; x2++) px(x2, 11, hole);
  }
  tile('pumpkinFace', function () { pumpkinFace(false); });
  tile('jackFace', function () { pumpkinFace(true); });
  tile('primedTnt', function () { fill([250, 250, 250], 0.02); });

  // Трещины добычи: 10 стадий, каждая дорисовывает трещины предыдущей
  var crackPaths = null;
  function crack(stage) {
    clear();
    if (!crackPaths) {
      var r = KC.mulberry32(4242);
      crackPaths = [];
      for (var p = 0; p < 10; p++) {
        var x = 7 + Math.floor(r() * 3) - 1, y = 7 + Math.floor(r() * 3) - 1, pts = [];
        var dx = r() < 0.5 ? -1 : 1, dy = r() < 0.5 ? -1 : 1;
        for (var s = 0; s < 9; s++) {
          pts.push([x, y]);
          if (r() < 0.5) x += dx; else y += dy;
          if (r() < 0.2) dx = -dx;
        }
        crackPaths.push(pts);
      }
    }
    for (var i = 0; i <= stage; i++) crackPaths[i].forEach(function (pt) { px(pt[0], pt[1], [20, 18, 16], 210); });
  }
  for (var cs = 0; cs < 10; cs++) (function (s) { tile('crack' + s, function () { crack(s); }); })(cs);

  // =================================================================================
  // Предметы (спрайты)
  // =================================================================================
  var MATS = {
    wood: { a: [96, 68, 38], b: [176, 136, 84], c: [132, 98, 58] },
    stone: { a: [70, 70, 72], b: [150, 150, 152], c: [112, 112, 114] },
    iron: { a: [110, 110, 116], b: [236, 236, 240], c: [186, 186, 192] },
    gold: { a: [160, 110, 20], b: [255, 236, 110], c: [236, 190, 50] },
    diamond: { a: [30, 120, 130], b: [150, 250, 244], c: [80, 210, 210] },
    leather: { a: [90, 50, 26], b: [178, 112, 64], c: [140, 84, 44] }
  };
  var STICK = { s: [150, 110, 62], t: [98, 70, 38] };
  function pal(m, extra) {
    var p = { a: m.a, b: m.b, c: m.c, s: STICK.s, t: STICK.t };
    for (var k in extra) p[k] = extra[k];
    return p;
  }

  var TOOL_ROWS = {
    pickaxe: [
      '................', '....aaaaaa......', '...abbbbbba.....', '....aaaabbba....', '.........abba...',
      '........ts.aba..', '.......ts...aba.', '......ts.....ab.', '.....ts......ab.', '....ts.......aa.',
      '...ts...........', '..ts............', '.ts.............', 'ts..............'],
    axe: [
      '................', '.......aaa......', '......abbba.....', '.....abbbbba....', '.....abbbbbba...',
      '......abbbbtsa..', '.......aabts.a..', '.........ts.....', '........ts......', '.......ts.......',
      '......ts........', '.....ts.........', '....ts..........', '...ts...........', '..ts............'],
    shovel: [
      '................', '...........aa...', '..........abba..', '.........abbbba.', '.........abbbba.',
      '..........abba..', '.........ts.a...', '........ts......', '.......ts.......', '......ts........',
      '.....ts.........', '....ts..........', '...ts...........', '..ts............', '.ts.............'],
    sword: [
      '................', '.............aa.', '............abb.', '...........abba.', '..........abba..',
      '.........abba...', '........abba....', '.......abba.....', '..aa..abba......', '...aaabba.......',
      '....aba.........', '....taa.........', '...ts..a........', '..ts............', '.ts.............'],
    hoe: [
      '................', '.......aaaa.....', '......abbbba....', '.......aaabts...', '..........ts....',
      '.........ts.....', '........ts......', '.......ts.......', '......ts........', '.....ts.........',
      '....ts..........', '...ts...........', '..ts............', '.ts.............']
  };
  var ARMOR_ROWS = {
    helmet: ['................', '................', '................', '....aaaaaaaa....', '...abbbbbbbba...',
      '...abccccccba...', '...ab......ba...', '...ab......ba...', '...aa......aa...'],
    chest: ['................', '................', '..aaa......aaa..', '.abba......abba.', '.abbbaaaaaabbba.',
      '.abbbbbbbbbbbba.', '..aabbbbbbbbaa..', '....abbbbbba....', '....abbbbbba....', '....abbccbba....',
      '....abbbbbba....', '....abbbbbba....', '....aaaaaaaa....'],
    legs: ['................', '................', '...aaaaaaaaaa...', '...abbbbbbbba...', '...abbbccbbba...',
      '...abbbaabbba...', '...abba..abba...', '...abba..abba...', '...abba..abba...', '...abba..abba...',
      '...abba..abba...', '...aaaa..aaaa...'],
    boots: ['................', '................', '................', '................', '................',
      '................', '................', '....aaa...aaa...', '....aba...aba...', '....aba...aba...',
      '..aabba.aabba...', '.abbbba.abbbba..', '.aaaaaa.aaaaaa..']
  };
  ['wood', 'stone', 'iron', 'gold', 'diamond'].forEach(function (m) {
    ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'].forEach(function (k) {
      tile(m + '_' + k, function () { sprite(TOOL_ROWS[k], pal(MATS[m])); });
    });
  });
  ['leather', 'iron', 'gold', 'diamond'].forEach(function (m) {
    ['helmet', 'chest', 'legs', 'boots'].forEach(function (k) {
      tile(m + '_' + k, function () { sprite(ARMOR_ROWS[k], pal(MATS[m])); });
    });
  });

  tile('stick', function () {
    sprite(['................', '................', '................', '...........ts...', '..........ts....', '.........ts.....',
      '........ts......', '.......ts.......', '......ts........', '.....ts.........', '....ts..........', '...ts...........'], STICK);
  });
  var LUMP = ['................', '................', '................', '................', '......aaaa......', '....aabbbaa.....',
    '...abbcbbbba....', '...abbbbbcba....', '..abcbbbbbbba...', '..abbbbcbbbba...', '...abbbbbbba....', '....aabbbaa.....', '......aaa.......'];
  tile('coal', function () { sprite(LUMP, { a: [16, 16, 18], b: [44, 44, 48], c: [90, 90, 96] }); });
  tile('charcoal', function () { sprite(LUMP, { a: [30, 22, 16], b: [60, 46, 34], c: [104, 84, 64] }); });
  var INGOT = ['................', '................', '................', '................', '................', '................',
    '.....aaaaaaaaa..', '....accccccccba.', '...accccccccbba.', '..abbbbbbbbbba..', '.abbbbbbbbbba...', '.aaaaaaaaaaaa...'];
  tile('ironIngot', function () { sprite(INGOT, { a: [110, 110, 116], b: [196, 196, 202], c: [240, 240, 244] }); });
  tile('goldIngot', function () { sprite(INGOT, { a: [160, 110, 20], b: [236, 190, 50], c: [255, 240, 140] }); });
  tile('brickItem', function () { sprite(INGOT, { a: [96, 40, 28], b: [160, 70, 50], c: [196, 100, 76] }); });
  tile('diamond', function () {
    sprite(['................', '................', '................', '.....aaaaaa.....', '....acccccca....', '...acbcccbcca...',
      '..acbbbcccbbca..', '..abbbbbbbbbba..', '...abbbbbbbba...', '....abbbbbba....', '.....abbbba.....', '......abba......', '.......aa.......'],
    { a: [30, 120, 130], b: [80, 210, 210], c: [200, 255, 250] });
  });
  var DUST = ['................', '................', '................', '................', '................', '................',
    '................', '................', '......a.........', '....a.bb.a......', '...abbcbba.a....', '..abbcbbbcba....', '.abbbbcbbbbba...', '..aaaaaaaaaa....'];
  tile('sparkDust', function () { sprite(DUST, { a: [120, 12, 8], b: [214, 36, 26], c: [255, 120, 90] }); });
  tile('gunpowder', function () { sprite(DUST, { a: [50, 50, 52], b: [96, 96, 100], c: [150, 150, 156] }); });
  tile('flint', function () {
    sprite(['................', '................', '................', '.......aa.......', '......abba......', '.....abcbba.....', '....abbbcbba....',
      '....abcbbbba....', '...abbbbcbbba...', '...abcbbbbbba...', '....abbbbcba....', '.....aabbaa.....', '.......aa.......'],
    { a: [20, 20, 22], b: [60, 60, 66], c: [120, 120, 130] });
  });
  tile('clayBall', function () {
    sprite(['................', '................', '................', '................', '................', '......aaaa......', '.....abccba.....',
      '....abccbbba....', '....abcbbbba....', '....abbbbbba....', '.....abbbba.....', '......aaaa......'],
    { a: [110, 116, 132], b: [160, 166, 182], c: [200, 206, 220] });
  });
  tile('string', function () {
    sprite(['................', '................', '.............a..', '............a...', '...........a....', '..........a.....',
      '.........a......', '....aa..a.......', '...a..aa........', '...a..a.........', '....aa..........', '...a............', '..a.............', '.a..............'],
    { a: [236, 236, 236] });
  });
  tile('feather', function () {
    sprite(['................', '...........aa...', '..........abba..', '.........abbba..', '........abbbba..', '.......abbbba...',
      '......abbbca....', '.....abbbca.....', '....abbbca......', '...abbbca.......', '...abbca........', '..abca..........', '..ac............', '.c..............'],
    { a: [190, 190, 196], b: [248, 248, 250], c: [140, 140, 146] });
  });
  tile('leather', function () {
    sprite(['................', '................', '................', '...aa......aa...', '...abaaaaaaba...', '....abbbbbba....',
      '...abbcbbbbba...', '...abbbbbcbba...', '...abbbbbbbba...', '...abcbbbbbba...', '....abbbbbba....', '...abaaaaaaba...', '...aa......aa...'],
    { a: [90, 50, 26], b: [168, 102, 56], c: [196, 130, 80] });
  });
  tile('bone', function () {
    sprite(['................', '................', '............aa..', '...........abba.', '...........abba.', '..........ab.a..',
      '.........ab.....', '........ab......', '.......ab.......', '......ab........', '.....ab.........', '..a.ab..........', '.abba...........', '.abba...........', '..aa............'],
    { a: [190, 184, 166], b: [244, 240, 226] });
  });
  tile('paper', function () {
    sprite(['................', '................', '...aaaaaaaaa....', '...abbbbbbba....', '...abccccbba....', '...abbbbbbba....',
      '...abcccccba....', '...abbbbbbba....', '...abccccbba....', '...abbbbbbba....', '...abcccccba....', '...abbbbbbba....', '...aaaaaaaaa....'],
    { a: [190, 186, 170], b: [246, 244, 234], c: [200, 196, 184] });
  });
  tile('book', function () {
    sprite(['................', '................', '...aaaaaaaaaa...', '..abbbbbbbbbca..', '..abbbbbbbbbca..', '..abbddddbbbca..',
      '..abbbbbbbbbca..', '..abbbbbbbbbca..', '..abbbbbbbbbca..', '..abbbbbbbbbca..', '..abbbbbbbbbca..', '..aaaaaaaaaaca..', '...cccccccccc...'],
    { a: [80, 36, 24], b: [132, 60, 40], c: [236, 232, 216], d: [226, 190, 80] });
  });
  tile('seeds', function () {
    sprite(['................', '................', '................', '................', '................', '................',
      '......ab........', '..ab......ab....', '..........b.....', '.....ab.........', '.ab.......ab....', '........ab......', '...ab...........'],
    { a: [120, 150, 60], b: [80, 110, 40] });
  });
  tile('wheatItem', function () {
    sprite(['................', '......a..a......', '.....aba.aba....', '.....aba.aba....', '......ab.ab.....', '...a...cc...a...',
      '..aba..cc..aba..', '..aba..cc..aba..', '...ab.cc.cba....', '.....ccccc......', '......ccc.......', '.....cc.cc......', '....cc...cc.....', '...cc.....cc....'],
    { a: [226, 190, 80], b: [190, 150, 50], c: [170, 150, 60] });
  });
  tile('bread', function () {
    sprite(['................', '................', '................', '................', '................', '................',
      '.....aaaaaa.....', '...aabcbcbbaa...', '..abbcbbcbbcba..', '.abbbbbbbbbbbba.', '.abbbbbbbbbbbba.', '..aaaaaaaaaaaa..'],
    { a: [120, 70, 26], b: [196, 136, 60], c: [236, 200, 120] });
  });
  var APPLE = ['................', '................', '........s.......', '.......s.gg.....', '....aaaasg......', '...abbbbbba.....',
    '..abcbbbbbba....', '..abcbbbbbba....', '..abbbbbbbba....', '..abbbbbbbba....', '...abbbbbba.....', '....aa..aa......'];
  tile('apple', function () { sprite(APPLE, { a: [130, 20, 20], b: [210, 40, 36], c: [255, 150, 140], s: [96, 64, 30], g: [70, 150, 50] }); });
  tile('goldenApple', function () { sprite(APPLE, { a: [170, 120, 20], b: [250, 206, 60], c: [255, 250, 190], s: [96, 64, 30], g: [70, 150, 50] }); });
  var CHOP = ['................', '................', '................', '................', '.....aaaaa......', '...aabbbbbaa....',
    '..abbcbbbbbba...', '..abbbbbbbbbba..', '..abbbbbbbbbba..', '...abbbbbbbbdd..', '....aabbbbdddd..', '......aaaa.dd...'];
  var STEAK = ['................', '................', '................', '................', '....aaaaaaa.....', '...abbbbbbba....',
    '..abbcbbbbbba...', '..abbbbdbbbba...', '..abbbddbbbba...', '..abbbbbbbba....', '...aabbbbba.....', '.....aaaaa......'];
  var MUTTON = ['................', '................', '................', '..........dd....', '.........dd.....', '....aaaaad......',
    '...abbbbba......', '..abcbbbbba.....', '..abbbbbbba.....', '..abbbbbbba.....', '...abbbbba......', '....aaaaa.......'];
  var LEG = ['................', '................', '................', '.....aaaa.......', '...aabbbbaa.....', '..abbcbbbbba....',
    '..abbbbbbbba....', '..abbbbbbbba....', '...abbbbbba.....', '....aabbaa......', '......add.......', '.......dd.......', '......d..d......'];
  var RAW = { a: [150, 50, 50], b: [226, 120, 120], c: [250, 170, 170], d: [244, 236, 224] };
  var COOKED = { a: [80, 40, 20], b: [150, 86, 44], c: [200, 132, 80], d: [236, 220, 190] };
  tile('porkRaw', function () { sprite(CHOP, RAW); });
  tile('porkCooked', function () { sprite(CHOP, COOKED); });
  tile('beefRaw', function () { sprite(STEAK, { a: [120, 26, 26], b: [196, 50, 44], c: [236, 110, 100], d: [240, 220, 210] }); });
  tile('beefCooked', function () { sprite(STEAK, { a: [60, 30, 16], b: [120, 66, 34], c: [170, 110, 64], d: [200, 170, 130] }); });
  tile('muttonRaw', function () { sprite(MUTTON, { a: [140, 40, 40], b: [210, 84, 80], c: [244, 150, 146], d: [244, 236, 224] }); });
  tile('muttonCooked', function () { sprite(MUTTON, COOKED); });
  tile('chickenRaw', function () { sprite(LEG, { a: [190, 140, 120], b: [244, 200, 180], c: [255, 230, 214], d: [244, 236, 224] }); });
  tile('chickenCooked', function () { sprite(LEG, { a: [110, 60, 20], b: [196, 130, 60], c: [236, 186, 110], d: [236, 220, 190] }); });
  tile('rottenFlesh', function () { sprite(STEAK, { a: [70, 60, 30], b: [120, 110, 60], c: [150, 150, 80], d: [100, 70, 60] }, 0.2); });
  tile('spiderEye', function () {
    sprite(['................', '................', '................', '................', '................', '......aaaa......', '....aabbbbaa....',
      '...abbcbbbbba...', '...abbbddbbba...', '...abbbddbbba...', '...abbbbbbbba...', '....aabbbbaa....', '......aaaa......'],
    { a: [100, 20, 30], b: [180, 40, 60], c: [240, 120, 140], d: [30, 10, 14] });
  });
  var BUCKET = ['................', '................', '................', '...aaaaaaaaaa...', '..a..........a..', '..abbbbbbbbbba..',
    '..abccccccccba..', '...abbbbbbbba...', '...abbbbbbbba...', '...abbbbbbbba...', '....abbbbbba....', '....aaaaaaaa....'];
  tile('bucket', function () { sprite(BUCKET, { a: [90, 90, 96], b: [196, 196, 202], c: [60, 60, 64] }); });
  tile('waterBucket', function () { sprite(BUCKET, { a: [90, 90, 96], b: [196, 196, 202], c: [60, 110, 220] }); });
  tile('lavaBucket', function () { sprite(BUCKET, { a: [90, 90, 96], b: [196, 196, 202], c: [240, 120, 30] }); });
  tile('bow', function () {
    sprite(['................', '.......aas......', '.....aab.s......', '....abb..s......', '....ab...s......', '...ab....s......',
      '...ab....s......', '...ab....s......', '...ab....s......', '...ab....s......', '...ab....s......', '....ab...s......', '....abb..s......', '.....aab.s......', '.......aas......'],
    { a: [96, 64, 30], b: [150, 106, 56], s: [230, 230, 230] });
  });
  tile('arrow', function () {
    sprite(['................', '............ccc.', '.............cc.', '...........s.c..', '..........s.....', '.........s......',
      '........s.......', '.......s........', '......s.........', '.....s..........', '..ff.s..........', '..fffs..........', '...fff..........', '..f..f..........'],
    { c: [200, 200, 206], s: [150, 110, 62], f: [240, 240, 244] });
  });
  tile('shears', function () {
    sprite(['................', '................', '..aa........aa..', '..aba......aba..', '...aba....aba...', '....aba..aba....',
      '.....abaaba.....', '......abba......', '......abba......', '.....rr..rr.....', '....r..rr..r....', '....r..rr..r....', '.....rr..rr.....'],
    { a: [110, 110, 116], b: [230, 230, 236], r: [180, 40, 36] });
  });
  tile('flintSteel', function () {
    sprite(['................', '................', '................', '...aaaa.........', '..abbbba........', '..ab..ba........',
      '..ab............', '..ab..ba........', '..abbbba........', '...aaaa..ff.....', '.........fcff...', '........fccff...', '........ffff....'],
    { a: [90, 90, 96], b: [200, 200, 206], f: [30, 30, 34], c: [90, 90, 100] });
  });
  var POUCH = ['................', '................', '................', '................', '......aaaa......', '.......aa.......',
    '.....abbbba.....', '....abcbbbba....', '...abbbbbbbba...', '...abbbbbbbba...', '...abbbbbbbba...', '....abbbbbba....', '.....aaaaaa.....'];
  function pouch(c) { sprite(POUCH, { a: mul(c, 0.55), b: c, c: mix(c, [255, 255, 255], 0.5) }); }
  tile('dyeRed', function () { pouch([200, 40, 36]); });
  tile('dyeYellow', function () { pouch([240, 200, 40]); });
  tile('dyeBlue', function () { pouch([50, 76, 190]); });
  tile('dyeGreen', function () { pouch([80, 136, 40]); });
  tile('doorItem', function () {
    sprite(['................', '....aaaaaaaa....', '....abbbbbba....', '....abccccba....', '....abcbbcba....', '....abccccba....',
      '....abbbbbba....', '....abbbbbba....', '....abbbbdba....', '....abbbbbba....', '....abccccba....', '....abcbbcba....', '....abccccba....', '....abbbbbba....', '....aaaaaaaa....'],
    { a: [96, 68, 40], b: [156, 116, 70], c: [120, 86, 50], d: [60, 60, 64] });
  });
  tile('bedItem', function () {
    sprite(['................', '................', '................', '................', '................', '................',
      '.pp.............', '.pprrrrrrrrrrrr.', '.ppprrrrrrrrrrr.', '.wwwwwwwwwwwwww.', '.aaaaaaaaaaaaaa.', '.a............a.'],
    { p: [240, 240, 236], r: [182, 44, 44], w: [226, 226, 220], a: [120, 86, 50] });
  });
  tile('leverItem', function () {
    sprite(['................', '................', '...........bb...', '...........bb...', '..........s.....', '.........s......',
      '........s.......', '.......s........', '......s.........', '....aaaaaaa.....', '...abbbbbbba....', '...abbbbbbba....', '...aaaaaaaaa....'],
    { a: [70, 70, 72], b: [140, 140, 142], s: [150, 110, 62] });
  });
  tile('buttonItem', function () {
    sprite(['................', '................', '................', '................', '................', '................',
      '.....aaaaaa.....', '....abbbbbba....', '....abbbbbba....', '....acccccca....', '.....aaaaaa.....'],
    { a: [70, 70, 72], b: [150, 150, 152], c: [110, 110, 112] });
  });
  tile('plateItem', function () {
    sprite(['................', '................', '................', '................', '................', '................',
      '................', '................', '................', '..aaaaaaaaaaaa..', '.abbbbbbbbbbbba.', '.acccccccccccca.', '..aaaaaaaaaaaa..'],
    { a: [70, 70, 72], b: [150, 150, 152], c: [110, 110, 112] });
  });


  // =================================================================================
  // Пекло
  // =================================================================================
  function ash(base, dark) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd();
      px(x, y, r < 0.12 ? dark : r < 0.2 ? mul(base, 1.18) : jit(base, 0.16));
    }
  }
  tile('ashstone', function () {
    ash([92, 58, 54], [60, 34, 32]);
    for (var i = 0; i < 5; i++) { var sx = Math.floor(rnd() * 14), sy = Math.floor(rnd() * 16); px(sx, sy, [128, 72, 60]); px(sx + 1, sy, [118, 66, 56]); }
  });
  tile('ashBrick', function () {
    for (var y = 0; y < 16; y++) {
      var row = Math.floor(y / 4);
      for (var x = 0; x < 16; x++) {
        var mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
        px(x, y, mortar ? jit([40, 22, 22], 0.1) : jit([108, 52, 46], 0.14));
      }
    }
  });
  tile('magma', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var crack = (Math.abs(Math.sin(x * 1.3 + y * 0.7)) < 0.18) || (Math.abs(Math.sin(x * 0.4 - y * 1.1)) < 0.12);
      px(x, y, crack ? pick([[255, 170, 50], [240, 110, 30]]) : jit([70, 26, 18], 0.25));
    }
  });
  tile('sulfurOre', function () {
    ash([92, 58, 54], [60, 34, 32]);
    for (var k = 0; k < 5; k++) {
      var cx = 2 + rnd() * 12, cy = 2 + rnd() * 12;
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < 2 && rnd() < 0.8) px(x, y, rnd() < 0.4 ? [255, 236, 90] : [214, 190, 40]);
    }
  });
  tile('bloodOre', function () {
    ash([92, 58, 54], [60, 34, 32]);
    for (var k = 0; k < 3; k++) {
      var cx = 3 + rnd() * 10, cy = 3 + rnd() * 10;
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        var d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d < 2.5) px(x, y, d < 1 ? [255, 120, 140] : [190, 20, 50]);
      }
    }
  });
  tile('glowroot', function () {
    clear();
    [3, 7, 11].forEach(function (sx, n) {
      var len = 9 + n * 2;
      for (var y = 0; y < len; y++) px(sx + (y % 5 === 4 ? 1 : 0), y, jit([150, 70, 40], 0.1));
      px(sx, len, [255, 210, 110]); px(sx + 1, len, [255, 180, 80]); px(sx, len + 1, [255, 236, 170]);
    });
  });
  tile('fireflower', function () { flower([255, 110, 30], [220, 50, 20], [255, 230, 120]); for (var y = 8; y < 16; y++) px(7, y, [90, 40, 30]); });
  tile('ashBlock', function () { ash([120, 112, 110], [86, 80, 80]); });
  function gate(c1, c2, c3) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var dx = x - 7.5, dy = y - 7.5, a = Math.atan2(dy, dx), r = Math.sqrt(dx * dx + dy * dy);
      var swirl = Math.sin(a * 3 + r * 0.9);
      px(x, y, swirl > 0.4 ? c1 : swirl > -0.3 ? c2 : c3, 235);
    }
  }
  tile('hellGate', function () { gate([255, 200, 90], [230, 80, 30], [130, 20, 20]); });

  // =================================================================================
  // Небеса
  // =================================================================================
  tile('cloud', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = Math.sin(x * 0.9) * Math.cos(y * 0.8);
      px(x, y, jit(r > 0.3 ? [255, 255, 255] : [236, 240, 250], 0.03));
    }
  });
  tile('skystone', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit([236, 232, 222], 0.05));
    var vx = 2 + rnd() * 4;
    for (y = 0; y < 16; y++) { vx += (rnd() - 0.5) * 1.6; px(Math.floor(vx), y, [200, 186, 150]); px(Math.floor(vx) + 1, y, [220, 206, 170]); }
  });
  tile('goldenGrassTop', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd();
      px(x, y, r < 0.12 ? [250, 236, 140] : r < 0.24 ? [170, 170, 70] : jit([214, 206, 100], 0.15));
    }
  });
  function lightSoil() { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(rnd() < 0.12 ? [200, 180, 150] : [226, 208, 176], 0.08)); }
  tile('goldenGrassSide', function () {
    lightSoil();
    for (var x = 0; x < 16; x++) { var d = 3 + (rnd() < 0.5 ? 1 : 0); for (var y = 0; y < d; y++) px(x, y, jit([214, 206, 100], 0.12)); }
  });
  tile('lightSoil', lightSoil);
  tile('skyLogSide', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(x % 5 === 2 ? [226, 196, 120] : [246, 238, 222], 0.06));
  });
  tile('skyLogTop', function () { rings([250, 236, 200], [232, 212, 170], [246, 238, 222]); });
  tile('blossom', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      if (rnd() < 0.14) { px(x, y, [0, 0, 0], 0); continue; }
      var r = rnd();
      px(x, y, r < 0.2 ? [255, 250, 252] : r < 0.45 ? [250, 190, 214] : jit([242, 160, 196], 0.12));
    }
  });
  tile('skyCrystal', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit([236, 232, 222], 0.05));
    [[4, 12, 5], [9, 13, 7], [12, 11, 4]].forEach(function (c) {
      for (var h = 0; h < c[2]; h++) { px(c[0], c[1] - h, [160, 230, 255]); px(c[0] + 1, c[1] - h, h === c[2] - 1 ? [255, 255, 255] : [110, 200, 250]); }
    });
  });
  tile('haloFlower', function () { flower([255, 250, 200], [240, 210, 110], [255, 255, 255]); });
  tile('heavenGate', function () { gate([255, 255, 255], [250, 226, 140], [150, 200, 255]); });

  // =================================================================================
  // Космическая станция
  // =================================================================================
  function plates(base, line) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var seam = x === 0 || y === 0 || x === 8 || y === 8;
      px(x, y, jit(seam ? line : base, 0.04));
    }
    [[2, 2], [13, 2], [2, 13], [13, 13], [10, 5], [5, 10]].forEach(function (p) { px(p[0], p[1], mul(base, 0.75)); });
  }
  tile('hull', function () { plates([196, 200, 206], [150, 154, 160]); });
  tile('hullDark', function () { plates([90, 96, 106], [60, 64, 72]); });
  tile('grate', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, (x % 4 === 0 || y % 4 === 0) ? jit([150, 156, 164], 0.05) : [40, 44, 50]);
  });
  tile('lightPanel', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var edge = x <= 1 || y <= 1 || x >= 14 || y >= 14;
      px(x, y, edge ? [170, 176, 184] : jit([236, 250, 255], 0.02));
    }
  });
  tile('solar', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var line = x % 4 === 0 || y % 8 === 0;
      px(x, y, line ? [180, 186, 196] : jit((x + y) % 7 === 0 ? [60, 90, 170] : [30, 50, 120], 0.08));
    }
  });
  tile('consoleSide', function () { plates([120, 126, 136], [90, 96, 104]); });
  tile('consoleFront', function () {
    plates([120, 126, 136], [90, 96, 104]);
    rect(2, 2, 13, 8, [14, 24, 30]);
    for (var i = 0; i < 6; i++) rect(3, 3 + i, 3 + Math.floor(rnd() * 9), 3 + i, [60, 220, 160]);
    [[3, 11, [230, 60, 50]], [6, 11, [240, 200, 40]], [9, 11, [60, 200, 90]], [12, 11, [60, 140, 240]]].forEach(function (b) { rect(b[0], b[1], b[0] + 1, b[1] + 1, b[2]); });
  });
  tile('teleporterTop', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      px(x, y, d > 6.5 ? [150, 156, 164] : Math.floor(d) % 2 ? [80, 230, 255] : [30, 90, 140]);
    }
  });
  tile('teleporterSide', function () { plates([150, 156, 164], [110, 116, 124]); rect(0, 4, 15, 5, [80, 230, 255]); });
  tile('asteroid', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(pick([[92, 86, 84], [70, 66, 66], [110, 102, 96]]), 0.1));
    for (var i = 0; i < 3; i++) { var cx = 2 + Math.floor(rnd() * 12), cy = 2 + Math.floor(rnd() * 12); px(cx, cy, [50, 46, 46]); px(cx + 1, cy, [130, 124, 118]); }
  });
  tile('meteorOre', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(pick([[92, 86, 84], [70, 66, 66], [110, 102, 96]]), 0.1));
    for (var k = 0; k < 4; k++) {
      var cx = 2 + rnd() * 12, cy = 2 + rnd() * 12;
      for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < 2.2) px(x, y, rnd() < 0.5 ? [120, 200, 220] : [180, 230, 240]);
    }
  });
  tile('tintedGlass', function () {
    // тонировка «сеточкой»: сквозь окно видно, а издали оно голубоватое
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var edge = x === 0 || y === 0 || x === 15 || y === 15;
      if (edge) px(x, y, [120, 140, 160]);
      else if ((x + y) % 2 === 0 && (x % 4 < 2)) px(x, y, [70, 120, 160]);
      else px(x, y, [0, 0, 0], 0);
    }
    [[3, 6], [4, 5], [5, 4]].forEach(function (p) { px(p[0], p[1], [190, 225, 245], 220); });
  });

  // =================================================================================
  // Город
  // =================================================================================
  function asphalt() { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(rnd() < 0.15 ? [70, 70, 74] : [48, 48, 52], 0.1)); }
  tile('asphalt', asphalt);
  tile('roadLineX', function () { asphalt(); for (var x = 2; x < 12; x++) { px(x, 7, [236, 206, 60]); px(x, 8, [236, 206, 60]); } });
  tile('roadLineZ', function () { asphalt(); for (var y = 2; y < 12; y++) { px(7, y, [236, 206, 60]); px(8, y, [236, 206, 60]); } });
  tile('crosswalk', function () { asphalt(); for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) if (x % 6 < 3) px(x, y, jit([226, 226, 222], 0.04)); });
  tile('sidewalk', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, (x % 8 === 7 || y % 8 === 7) ? jit([120, 120, 118], 0.05) : jit([168, 166, 160], 0.06));
  });
  tile('concrete', function () { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(rnd() < 0.06 ? [130, 130, 128] : [164, 162, 158], 0.05)); });
  tile('concreteDark', function () { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(rnd() < 0.06 ? [66, 70, 76] : [88, 92, 98], 0.05)); });
  tile('tileFloor', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, (x % 8 === 0 || y % 8 === 0) ? [150, 150, 146] : ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? jit([220, 218, 210], 0.03) : jit([200, 198, 190], 0.03)));
  });
  tile('ceilingLamp', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var tube = (y >= 3 && y <= 5) || (y >= 10 && y <= 12);
      px(x, y, tube && x > 1 && x < 14 ? [255, 252, 236] : jit([190, 190, 186], 0.04));
    }
  });
  tile('pole', function () { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(x % 4 === 1 ? [90, 96, 100] : [60, 66, 70], 0.06)); });
  tile('streetLamp', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var edge = x <= 1 || x >= 14 || y <= 1 || y >= 14;
      px(x, y, edge ? [60, 66, 70] : jit([255, 236, 170], 0.04));
    }
  });
  function carBody(c) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var line = y === 5 || y === 12;
      px(x, y, line ? mul(c, 0.6) : jit(mul(c, y < 5 ? 1.12 : 1), 0.05));
    }
    rect(12, 7, 14, 8, [230, 230, 230]);
  }
  tile('carRed', function () { carBody([190, 36, 34]); });
  tile('carBlue', function () { carBody([40, 80, 170]); });
  tile('carWhite', function () { carBody([226, 228, 230]); });
  tile('tire', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      px(x, y, d < 3 ? [150, 150, 156] : d < 6.5 ? jit([28, 28, 30], 0.2) : [44, 44, 46]);
    }
  });
  tile('rubble', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(pick([[140, 138, 132], [110, 108, 104], [164, 162, 158], [96, 70, 50]]), 0.1));
  });
  tile('crate', function () {
    planks([164, 120, 68]);
    for (var i = 0; i < 16; i++) { px(i, 0, [96, 66, 36]); px(i, 15, [96, 66, 36]); px(0, i, [96, 66, 36]); px(15, i, [96, 66, 36]); px(i, i, [120, 84, 46]); }
  });

  // ---- Особые здания мегаполиса ------------------------------------------------------
  // крест здесь зелёный: красный крест на белом — охраняемая эмблема, её не используем
  tile('medSign', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var edge = x === 0 || y === 0 || x === 15 || y === 15;
      var cross = (x >= 6 && x <= 9 && y >= 2 && y <= 13) || (y >= 6 && y <= 9 && x >= 2 && x <= 13);
      px(x, y, edge ? [170, 176, 172] : cross ? [40, 176, 90] : jit([244, 246, 242], 0.02));
    }
  });
  tile('policeSign', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var c = jit([32, 54, 118], 0.05);
      if (y === 12 || y === 13) c = [236, 238, 240];
      var sh = Math.abs(x - 7.5) <= 4 - Math.max(0, y - 6) * 0.8 && y >= 2 && y <= 9;
      if (sh) c = (x + y) % 5 === 0 ? [255, 236, 140] : [226, 184, 56];
      px(x, y, c);
    }
  });
  tile('metroSign', function () {
    var M = { '6,5': 1, '6,6': 1, '7,6': 1, '7,7': 1, '8,6': 1, '8,7': 1, '9,5': 1, '9,6': 1 };
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var d = Math.hypot(x - 7.5, y - 7.5), c = [46, 50, 58];
      if (d < 7) c = [206, 38, 44];
      if (((x === 4 || x === 5 || x === 10 || x === 11) && y >= 4 && y <= 11) || M[x + ',' + y]) c = [250, 250, 250];
      px(x, y, c);
    }
  });
  tile('bars', function () {
    clear();
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var v = x % 5 === 1 || x % 5 === 2, h = y === 1 || y === 14;
      if (v || h) px(x, y, v && x % 5 === 1 ? [150, 154, 160] : [96, 100, 106]);
    }
  });
  tile('shelfTop', function () { fill([120, 126, 132], 0.06); });
  tile('shelfSide', function () {
    var goods = [[200, 50, 40], [240, 200, 60], [60, 130, 200], [80, 170, 90], [236, 236, 230], [170, 90, 40]];
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var frame = x === 0 || x === 15 || y % 5 === 0;
      px(x, y, frame ? [120, 126, 132] : [40, 42, 46]);
    }
    for (var row = 0; row < 3; row++) for (var gx = 1; gx < 15; gx += 3) {
      if (rnd() < 0.2) continue;
      var c = pick(goods), hgt = 2 + Math.floor(rnd() * 2);
      rect(gx, row * 5 + 5 - hgt, gx + 1, row * 5 + 4, c, 0.1);
    }
  });
  tile('fuelPumpSide', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, y < 3 ? [236, 236, 232] : jit([196, 40, 38], 0.05));
    rect(2, 5, 13, 5, [140, 24, 24]);
  });
  tile('fuelPumpFront', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, y < 3 ? [236, 236, 232] : jit([196, 40, 38], 0.05));
    rect(3, 4, 12, 8, [20, 24, 20]);
    rect(4, 5, 7, 5, [120, 255, 120]); rect(9, 5, 11, 5, [120, 255, 120]); rect(4, 7, 10, 7, [80, 200, 90]);
    rect(6, 10, 9, 13, [40, 40, 44]);
  });
  tile('barrelSide', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var rib = y === 2 || y === 13;
      px(x, y, rib ? [120, 26, 22] : jit(mul([200, 44, 36], 0.85 + 0.25 * Math.sin(x / 15 * Math.PI)), 0.04));
    }
    for (var ty = 5; ty <= 10; ty++) for (var tx = 7 - (ty - 5); tx <= 8 + (ty - 5); tx++) px(tx, ty, ty === 10 || tx === 7 - (ty - 5) || tx === 8 + (ty - 5) ? [30, 30, 30] : [250, 210, 40]);
  });
  tile('barrelTop', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var d = Math.hypot(x - 7.5, y - 7.5);
      px(x, y, d > 7 ? [120, 26, 22] : d < 1.8 && x > 8 ? [60, 60, 64] : jit([190, 42, 34], 0.05));
    }
  });
  function rails(alongX) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var a = alongX ? x : y, b = alongX ? y : x;
      var c = jit(pick([[92, 88, 84], [110, 106, 100], [74, 72, 70]]), 0.08);
      if (a % 5 === 1 || a % 5 === 2) c = jit([96, 66, 40], 0.08);
      if (b === 3 || b === 12) c = [176, 180, 186];
      if (b === 4 || b === 11) c = [110, 114, 120];
      px(x, y, c);
    }
  }
  tile('railX', function () { rails(true); });
  tile('railZ', function () { rails(false); });
  tile('barricade', function () {
    clear();
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var board = y % 5 !== 4;
      var diag = Math.abs(x - y) <= 1;
      if (board || diag) px(x, y, diag ? jit([130, 96, 56], 0.06) : jit([170, 130, 78], 0.08));
    }
    [[2, 1], [13, 1], [2, 6], [13, 6], [2, 11], [13, 11]].forEach(function (n) { px(n[0], n[1], [60, 60, 64]); });
  });
  tile('generatorSide', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var frame = x === 0 || x === 15 || y === 0 || y === 15;
      px(x, y, frame ? [50, 52, 56] : (y % 3 === 1 && x > 2 && x < 13) ? [70, 60, 30] : jit([222, 170, 44], 0.05));
    }
  });
  tile('generatorFront', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, x === 0 || x === 15 || y === 0 || y === 15 ? [50, 52, 56] : jit([222, 170, 44], 0.05));
    rect(3, 3, 12, 8, [36, 38, 42]);
    for (var a = 0; a < 5; a++) px(5 + a, 7 - Math.round(Math.sin(a / 4 * Math.PI) * 3), [230, 230, 220]);
    rect(4, 11, 6, 12, [150, 30, 30]); rect(9, 11, 11, 12, [40, 40, 44]);
  });
  tile('generatorOn', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, x === 0 || x === 15 || y === 0 || y === 15 ? [50, 52, 56] : jit([232, 180, 50], 0.05));
    rect(3, 3, 12, 8, [36, 38, 42]);
    for (var a = 0; a < 5; a++) px(5 + a, 7 - Math.round(Math.sin(a / 4 * Math.PI) * 3), [120, 255, 140]);
    rect(4, 11, 6, 12, [60, 60, 60]); rect(9, 11, 11, 12, [90, 255, 110]);
  });
  tile('generatorTop', function () {
    fill([70, 72, 76], 0.06);
    for (var y = 4; y < 12; y++) for (var x = 4; x < 12; x++) px(x, y, Math.hypot(x - 7.5, y - 7.5) < 2.5 ? [24, 24, 26] : [100, 104, 110]);
  });
  tile('helipad', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, ((x + y) >> 2) % 2 ? jit([236, 196, 40], 0.04) : jit([34, 34, 38], 0.05));
  });
  tile('landingOff', function () {
    fill([56, 58, 62], 0.05);
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) if (Math.hypot(x - 7.5, y - 7.5) < 4.5) px(x, y, [40, 70, 44]);
  });
  tile('landingOn', function () {
    fill([56, 58, 62], 0.05);
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) { var d = Math.hypot(x - 7.5, y - 7.5); if (d < 4.5) px(x, y, d < 2 ? [240, 255, 240] : [130, 255, 140]); }
  });
  tile('airdropSide', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var frame = x <= 1 || x >= 14 || y <= 1 || y >= 14;
      px(x, y, frame ? [70, 80, 44] : jit([108, 122, 66], 0.06));
    }
    rect(6, 4, 9, 11, [236, 236, 230]); rect(4, 6, 11, 9, [236, 236, 230]);
  });
  tile('airdropTop', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, x === 7 || x === 8 || y === 7 || y === 8 ? [200, 190, 150] : jit([108, 122, 66], 0.06));
  });
  tile('fire', function () {
    clear();
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var hgt = 9 + 6 * Math.abs(Math.sin(x * 1.3)) - (x === 0 || x === 15 ? 5 : 0);
      var t = (15 - y) / hgt;
      if (t > 1) continue;
      px(x, y, t < 0.35 ? [255, 244, 170] : t < 0.7 ? [255, 170, 40] : [220, 70, 20]);
    }
  });

  // ---- Новые предметы ----------------------------------------------------------------
  tile('sulfur', function () { sprite(DUST, { a: [150, 120, 20], b: [230, 200, 40], c: [255, 240, 120] }); });
  tile('bloodCrystal', function () {
    sprite(['................', '................', '................', '.....aaaaaa.....', '....acccccca....', '...acbcccbcca...',
      '..acbbbcccbbca..', '..abbbbbbbbbba..', '...abbbbbbbba...', '....abbbbbba....', '.....abbbba.....', '......abba......', '.......aa.......'],
    { a: [100, 10, 30], b: [200, 30, 60], c: [255, 150, 170] });
  });
  tile('skyShard', function () {
    sprite(['................', '.......a........', '......aba.......', '......aba.......', '.....abcba......', '.....abcba......', '....abccba......',
      '....abccbba.....', '...abcccbba.....', '....abccba......', '.....abba.......', '......aa........'],
    { a: [90, 170, 220], b: [170, 230, 255], c: [255, 255, 255] });
  });
  tile('meteorIron', function () { sprite(INGOT, { a: [60, 110, 130], b: [120, 200, 220], c: [200, 245, 255] }); });
  tile('spaceRation', function () {
    sprite(['................', '................', '................', '....aaaaaaaa....', '...abbbbbbbba...', '...abccccccba...', '...abcddddcba...',
      '...abccccccba...', '...abcddddcba...', '...abccccccba...', '...abbbbbbbba...', '....aaaaaaaa....'],
    { a: [120, 126, 136], b: [210, 214, 220], c: [240, 240, 244], d: [60, 140, 200] });
  });
  tile('cannedFood', function () {
    sprite(['................', '................', '.....aaaaaa.....', '....abbbbbba....', '....acccccca....', '....adddddda....', '....adeeeeda....',
      '....adeeeeda....', '....adddddda....', '....acccccca....', '....abbbbbba....', '.....aaaaaa.....'],
    { a: [80, 84, 90], b: [200, 204, 210], c: [150, 154, 160], d: [190, 40, 40], e: [240, 220, 150] });
  });
  tile('medkit', function () {
    sprite(['................', '................', '......aaaa......', '......a..a......', '..aaaaaaaaaaaa..', '..abbbbbbbbbba..', '..abbbbccbbbba..',
      '..abbbccccbba...', '..abbbbccbbbba..', '..abbbbbbbbbba..', '..aaaaaaaaaaaa..'],
    { a: [120, 120, 124], b: [240, 240, 236], c: [40, 176, 90] });
  });
  tile('pistol', function () {
    sprite(['................', '................', '................', '................', '..aaaaaaaaaaa...', '..abbbbbbbbba...', '..aaaaaaaaaaa...',
      '.......acca.....', '.......acca.....', '......acca......', '......acca......', '.....aaaa.......'],
    { a: [30, 30, 34], b: [80, 84, 90], c: [100, 70, 44] });
  });
  tile('ammo', function () {
    sprite(['................', '................', '................', '...a...a...a....', '..aba.aba.aba...', '..aba.aba.aba...', '..cdc.cdc.cdc...',
      '..cdc.cdc.cdc...', '..cdc.cdc.cdc...', '..ccc.ccc.ccc...'],
    { a: [150, 100, 40], b: [210, 150, 70], c: [180, 140, 40], d: [230, 200, 90] });
  });
  var DIAG = ['................', '............aa..', '...........abba.', '..........abba..', '.........abba...', '........abba....', '.......abba.....',
    '......abba......', '.....abba.......', '....cab.........', '...ccc..........', '..cc............', '.cc.............'];
  tile('bat', function () { sprite(['................', '.............aa.', '............abba', '...........abbba', '..........abbba.', '.........abbba..', '........abbba...',
    '.......abbba....', '......abba......', '.....aba........', '....aba.........', '...ccc..........', '..cc............', '.cc.............'],
  { a: [110, 76, 40], b: [176, 130, 76], c: [50, 50, 60] }); });
  tile('machete', function () { sprite(DIAG, { a: [120, 124, 130], b: [220, 224, 230], c: [40, 40, 44] }); });
  tile('hellBlade', function () { sprite(DIAG, { a: [120, 10, 30], b: [230, 60, 70], c: [60, 30, 30] }); });
  tile('spaceHelmet', function () {
    sprite(['................', '................', '....aaaaaaaa....', '...abbbbbbbba...', '..abbccccccbba..', '..abccddddccba..', '..abcddddddcba..',
      '..abcddddddcba..', '..abccddddccba..', '..abbccccccbba..', '...abbbbbbbba...', '...aaaaaaaaaa...'],
    { a: [120, 126, 136], b: [236, 238, 242], c: [180, 186, 196], d: [60, 120, 180] });
  });
  tile('laserCutter', function () {
    sprite(['................', '................', '..........dd....', '.........dcd....', '........acca....', '.......abbba....', '......abbba.....',
      '.....abbba......', '....abbba.......', '...eaaba........', '..eee...........', '.ee.............'],
    { a: [90, 96, 106], b: [180, 186, 196], c: [120, 220, 255], d: [255, 60, 60], e: [50, 50, 56] });
  });
  tile('bandage', function () {
    sprite(['................', '................', '................', '......aaaa......', '....aabbbbaa....', '...abbbbbbbba...', '...abbccccbba...',
      '...abbc..cbba...', '...abbccccbba...', '...abbbbbbbba...', '....aabbbbaa.dd.', '......aaaa.dd...', '..........dd....'],
    { a: [200, 196, 186], b: [246, 244, 238], c: [220, 216, 206], d: [236, 234, 226] });
  });
  tile('fuelCan', function () {
    sprite(['................', '........aa......', '..aaaaaaab......', '..abbbbbbba.....', '..abccccbbba....', '..abcbbcbbbba...', '..abcbbcbbbba...',
      '..abccccbbbba...', '..abbbbbbbbba...', '..abbbbbbbbba...', '..abbbbbbbbba...', '..aaaaaaaaaaa...'],
    { a: [110, 20, 18], b: [200, 40, 34], c: [240, 200, 60] });
  });
  tile('flashlight', function () {
    sprite(['................', '................', '................', '................', '...........cc...', '..aaaaaaaabcdc..', '..abbbbbbbbcdd..',
      '..abbbeebbbcdd..', '..aaaaaaaabcdc..', '...........cc...'],
    { a: [34, 34, 38], b: [72, 76, 84], c: [130, 134, 142], d: [255, 240, 170], e: [200, 60, 50] });
  });
  tile('radio', function () {
    sprite(['........a.......', '........a.......', '........a.......', '.....aaaaaa.....', '.....abbbba.....', '.....acccca.....', '.....acdcca.....',
      '.....abbbba.....', '.....abebba.....', '.....abbeba.....', '.....abebba.....', '.....abbbba.....', '.....aaaaaa.....'],
    { a: [30, 30, 34], b: [66, 70, 76], c: [60, 110, 70], d: [160, 255, 170], e: [110, 116, 124] });
  });
  tile('bodyArmor', function () {
    sprite(['................', '................', '...aa......aa...', '..abba....abba..', '..abbbaaaabbba..', '..abbbbbbbbbba..', '..abccbbbbccba..',
      '..abccbbbbccba..', '..abbbbbbbbbba..', '..adddddddddda..', '..abbbbbbbbbba..', '..abccbbbbccba..', '..aaaaaaaaaaaa..'],
    { a: [24, 26, 30], b: [58, 62, 70], c: [90, 96, 104], d: [200, 200, 200] });
  });
  tile('cityMap', function () {
    sprite(['................', '................', '..aaaaaaaaaaaa..', '..abbcbbbbcbba..', '..abbcbbbbcbba..', '..acccccccccca..', '..abbcbdbbcbba..',
      '..abbcbbbbcbba..', '..abbcbbbbcbba..', '..acccccccccca..', '..abbcbbbbcbba..', '..abbcbbbbcbea..', '..aaaaaaaaaaaa..'],
    { a: [150, 120, 70], b: [236, 224, 190], c: [190, 176, 140], d: [200, 40, 40], e: [60, 150, 70] });
  });
  // ---- Оружие и боеприпасы ------------------------------------------------------------
  var GUNM = [38, 40, 46], GUNL = [74, 78, 86], WOOD1 = [150, 100, 56], WOOD2 = [118, 78, 42];
  tile('shotgun', function () {
    sprite(['................', '................', '................', '................', '................', 'aaaaaaaaaaab....',
      'accccaaaaaabddd.', '.cccc.....abdddd', '...........bdddd', '.............ddd'],
    { a: GUNM, b: GUNL, c: WOOD2, d: WOOD1 });
  });
  tile('rifle', function () {
    sprite(['................', '................', '................', '....b.......b...', 'aaaaaaaaaaaaa...', '.aaaaaaaaaaaaddd',
      '.....ee.aa..dddd', '.....ee..a...ddd', '......ee........', '......ee........'],
    { a: [36, 38, 42], b: GUNL, d: [62, 66, 56], e: [52, 54, 58] });
  });
  tile('sniper', function () {
    sprite(['................', '................', '....ffffff......', '....fggggf......', '.....h..h.......', 'aaaaaaaaaaaaa...',
      '......aaaaaaddd.', '........e.adddd.', '...........dddd.', '............ddd.'],
    { a: [40, 44, 40], d: [96, 104, 70], e: GUNL, f: [26, 26, 30], g: [80, 140, 190], h: GUNL });
  });
  tile('flamethrower', function () {
    sprite(['................', '.........rr.....', '........rrrr....', 'aaaaaaaaarrrr...', 'abbbbbbbarssr...', 'aaaaaaaaarrrr...',
      '.......c.rrrr...', '.......c.rrrr...', '.........rr.....'],
    { a: GUNM, b: [255, 150, 40], c: WOOD2, r: [190, 40, 34], s: [240, 210, 70] });
  });
  tile('grenade', function () {
    clear();
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var d = Math.hypot(x - 7.5, (y - 9) * 1.1);
      if (d < 5) px(x, y, (x + y) % 3 === 0 ? [70, 84, 44] : d < 2.5 ? [120, 140, 76] : [92, 108, 56]);
    }
    rect(6, 2, 9, 4, [140, 144, 150]); px(10, 2, [200, 200, 206]); px(11, 3, [200, 200, 206]); px(11, 4, [200, 200, 206]);
  });
  tile('molotov', function () {
    sprite(['......r.........', '.....ryr........', '......rr........', '......ww........', '......gg........', '......gg........',
      '.....gggg.......', '....gbbbbg......', '....gbbbbg......', '....gbbbbg......', '....gbbbbg......', '....gbbbbg......', '.....gggg.......'],
    { r: [255, 110, 30], y: [255, 230, 120], w: [236, 232, 220], g: [120, 170, 150], b: [200, 140, 50] });
  });
  tile('fireAxe', function () {
    sprite(['..........aaa...', '.........aaaaa..', '........aaaab...', '.........aab....', '........rrb.....', '.......rr.......',
      '......rr........', '.....rr.........', '....rr..........', '...rr...........', '..kk............', '.kk.............'],
    { a: [200, 30, 30], b: [180, 186, 196], r: [200, 40, 34], k: [30, 30, 30] });
  });
  tile('crowbar', function () {
    sprite(['...........aa...', '............a...', '...........aa...', '..........aa....', '.........aa.....', '........aa......',
      '.......aa.......', '......aa........', '.....aa.........', '....aa..........', '...aa...........', '..aaa...........', '..a.............'],
    { a: [196, 44, 40] });
  });
  tile('chainsaw', function () {
    sprite(['................', '................', '................', '................', '.....ooooo......', '....ooooooaaaaaaa',
      '....oooooobbbbbbb', '....ooooooaaaaaaa', '.....kk.kk......', '......kkk.......'],
    { o: [236, 120, 30], a: [160, 164, 170], b: [60, 60, 64], k: [30, 30, 34] });
  });
  tile('shells', function () {
    sprite(['................', '................', '................', '..rr..rr..rr....', '..rr..rr..rr....', '..rr..rr..rr....',
      '..rr..rr..rr....', '..yy..yy..yy....', '..yy..yy..yy....'],
    { r: [200, 40, 36], y: [214, 170, 60] });
  });
  tile('rifleAmmo', function () {
    sprite(['................', '...a...a...a....', '..aba.aba.aba...', '..aba.aba.aba...', '..cdc.cdc.cdc...', '..cdc.cdc.cdc...',
      '..cdc.cdc.cdc...', '..cdc.cdc.cdc...', '..cdc.cdc.cdc...', '..ccc.ccc.ccc...'],
    { a: [140, 90, 40], b: [190, 130, 60], c: [180, 150, 50], d: [236, 206, 100] });
  });
  tile('tankShell', function () {
    sprite(['.......a........', '......aba.......', '.....abbba......', '.....abbba......', '.....cdddc......', '.....cdddc......',
      '.....cdddc......', '.....cdddc......', '.....cdddc......', '.....cdddc......', '.....eeeee......'],
    { a: [80, 90, 60], b: [110, 124, 80], c: [170, 140, 50], d: [226, 196, 90], e: [140, 110, 40] });
  });
  // значки техники (вид сбоку)
  function vehIcon(rows, body) { sprite(rows, { b: body, w: [120, 180, 220], k: [26, 26, 30], g: [150, 150, 156], s: [220, 60, 60], u: [60, 90, 220], t: [60, 60, 50] }); }
  tile('vehSedan', function () { vehIcon(['................', '................', '................', '................', '.....bbbbb......', '....bwwbwwb.....',
    '..bbbbbbbbbbbb..', '..bbbbbbbbbbbb..', '...kk.....kk....', '...kk.....kk....'], [200, 50, 44]); });
  tile('vehPickup', function () { vehIcon(['................', '................', '................', '................', '......bbbb......', '.....bwwwb......',
    '.bbbbbbbbbbbbb..', '.bbbbbbbbbbbbb..', '..kk......kk....', '..kk......kk....'], [70, 110, 150]); });
  tile('vehPolice', function () { vehIcon(['................', '................', '................', '.......su.......', '.....bbbbb......', '....bwwbwwb.....',
    '..bbuuuuuuuubb..', '..bbbbbbbbbbbb..', '...kk.....kk....', '...kk.....kk....'], [236, 236, 236]); });
  tile('vehBus', function () { vehIcon(['................', '................', '................', '.bbbbbbbbbbbbbb.', '.bwwbwwbwwbwwbb.', '.bwwbwwbwwbwwbb.',
    '.bbbbbbbbbbbbbb.', '.bbbbbbbbbbbbbb.', '..kk.......kk...', '..kk.......kk...'], [230, 176, 40]); });
  tile('vehTruck', function () { vehIcon(['................', '................', '................', '.gggggggg.......', '.ggggggggbbb....', '.ggggggggbwwb...',
    '.ggggggggbbbbb..', '.bbbbbbbbbbbbb..', '..kk.kk....kk...', '..kk.kk....kk...'], [230, 170, 40]); });
  tile('vehDozer', function () { vehIcon(['................', '................', '................', '.......bbbb.....', '.......bwwb.....', '..g..bbbbbbbb...',
    '.gg.bbbbbbbbb...', '.gg.bbbbbbbbb...', '.g..tttttttttt..', '....tttttttttt..'], [236, 186, 30]); });
  tile('vehTank', function () { vehIcon(['................', '................', '................', '................', '......bbbb......', 'gggggbbbbbb.....',
    '...bbbbbbbbbbb..', '..bbbbbbbbbbbbb.', '..ttttttttttttt.', '...ttttttttttt..'], [96, 110, 60]); });
  tile('sandbag', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var row = Math.floor(y / 4), off = row % 2 ? 4 : 0, bx = (x + off) % 8, by = y % 4;
      var seam = bx === 0 || by === 3, round = (bx === 1 || bx === 7) && (by === 0 || by === 2);
      px(x, y, seam ? [120, 104, 70] : round ? [168, 150, 104] : jit([196, 178, 128], 0.06));
    }
  });
  tile('sandbagTop', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, (x % 8 === 0 || y % 8 === 0) ? [120, 104, 70] : jit([190, 172, 124], 0.06));
  });
  tile('fireball', function () {
    clear();
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 7) px(x, y, d < 3 ? [255, 250, 200] : d < 5 ? [255, 190, 60] : [230, 80, 20]);
    }
  });
  tile('laserBolt', function () {
    clear();
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var d = Math.abs(x + y - 15);   // по диагонали, как у стрелы: от хвоста к острию
      if (d <= 1) px(x, y, d === 0 ? [255, 255, 255] : [255, 70, 80]);
    }
  });

  // =================================================================================
  // Детализация мира: ель, новые растения, городские объекты и «наклейки» на стены и пол
  // =================================================================================
  tile('spruceSide', function () {
    var colK = [];
    for (var x = 0; x < 16; x++) colK.push(0.8 + rnd() * 0.3);
    for (var y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var groove = (x % 3 === 0 && rnd() < 0.85) ? 0.68 : 1;
      px(x, y, jit(mul([74, 54, 36], colK[x] * groove), 0.1));
    }
  });
  tile('spruceTop', function () { rings([150, 118, 78], [118, 90, 58], [66, 48, 32]); });
  tile('spruceLeaves', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      if (rnd() < 0.2) { px(x, y, [0, 0, 0], 0); continue; }
      var lr = rnd();
      px(x, y, lr < 0.14 ? [62, 104, 70] : lr < 0.34 ? [22, 52, 34] : jit([36, 78, 50], 0.22));
    }
  });
  tile('mossyCobble', function () {
    cobble();
    for (var k = 0; k < 5; k++) {
      var cx = rnd() * 16, cy = rnd() * 16, r = 1.5 + rnd() * 2.5;
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) if (Math.hypot(x - cx, y - cy) < r && rnd() < 0.8) px(x, y, jit([74, 118, 52], 0.25));
    }
  });
  tile('fern', function () {
    clear();
    for (var f = 0; f < 5; f++) {
      var bx = 3 + f * 2.5, lean = (f - 2) * 0.35, h = 9 + Math.floor(rnd() * 5);
      for (var y = 0; y < h; y++) {
        var x = Math.round(bx + lean * y * 0.6), yy = 15 - y;
        px(x, yy, jit([54, 110, 44], 0.12));
        if (y > 2 && y % 2 === 0) { px(x - 1, yy, jit([78, 142, 58], 0.12)); px(x + 1, yy, jit([78, 142, 58], 0.12)); }
      }
    }
  });
  tile('mushroomRed', function () {
    sprite(['................', '................', '................', '................', '................', '.....aaaaaa.....', '....abaaaaba....',
      '...aaaaabaaaa...', '...aabaaaaaba...', '...cccccccccc...', '.......dd.......', '.......dd.......', '.......dd.......', '......dddd......', '......dddd......'],
    { a: [208, 40, 36], b: [246, 240, 230], c: [150, 30, 28], d: [232, 226, 210] });
  });
  tile('mushroomBrown', function () {
    sprite(['................', '................', '................', '................', '................', '................', '......aaaa......',
      '....aaaaaaaa....', '...abaaaaaaba...', '...cccccccccc...', '.......dd.......', '.......dd.......', '.......dd.......', '......dddd......', '......dddd......'],
    { a: [150, 110, 76], b: [180, 142, 104], c: [110, 80, 54], d: [226, 214, 190] });
  });
  tile('daisy', function () { flower([246, 246, 240], [210, 210, 204], [246, 200, 40]); });
  tile('bellflower', function () {
    clear();
    for (var y = 5; y < 16; y++) px(7, y, [60, 118, 44]);
    px(8, 12, [74, 140, 50]); px(6, 10, [74, 140, 50]);
    [[4, 4], [9, 6], [5, 9]].forEach(function (b) {
      for (var yy = 0; yy < 3; yy++) for (var xx = -1; xx <= 1; xx++) if (!(yy === 0 && xx !== 0)) px(b[0] + xx + 1, b[1] + yy, yy === 2 ? [70, 60, 170] : [110, 96, 214]);
      px(b[0] + 1, b[1] - 1, [60, 118, 44]);
    });
  });
  tile('deadBush', function () {
    clear();
    var br = function (x, y, dx, n) { for (var i = 0; i < n; i++) { px(Math.round(x), y, jit([120, 86, 52], 0.15)); x += dx; y--; } };
    br(7.5, 15, 0, 6); br(7.5, 11, -0.6, 5); br(7.5, 12, 0.7, 5); br(5, 8, -0.4, 3); br(10, 9, 0.5, 3); br(7.5, 9, 0.1, 4);
  });
  tile('lilyPad', function () {
    clear();
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var d = Math.hypot(x - 7.5, y - 7.5), ang = Math.atan2(y - 7.5, x - 7.5);
      if (d < 7 && !(ang > -0.25 && ang < 0.3 && d > 1)) px(x, y, d < 6 && (x + y) % 5 === 0 ? [70, 130, 50] : jit([52, 110, 40], 0.15));
    }
    px(7, 7, [240, 230, 236]); px(8, 7, [236, 190, 210]); px(7, 8, [236, 190, 210]);
  });
  tile('pebbles', function () {
    clear();
    for (var k = 0; k < 7; k++) {
      var cx = 1 + rnd() * 13, cy = 1 + rnd() * 13, r = 0.8 + rnd() * 1.2, g = 100 + rnd() * 60;
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) if (Math.hypot(x - cx, y - cy) < r) px(x, y, jit([g, g, g + 4], 0.12));
    }
  });
  tile('fallenLeaves', function () {
    clear();
    for (var k = 0; k < 16; k++) {
      var cx = rnd() * 15, cy = rnd() * 15, col = pick([[170, 96, 30], [196, 140, 40], [140, 64, 28], [120, 130, 44]]);
      px(Math.floor(cx), Math.floor(cy), col); px(Math.floor(cx) + 1, Math.floor(cy), mul(col, 0.85)); px(Math.floor(cx), Math.floor(cy) + 1, mul(col, 0.9));
    }
  });
  // --- городские объекты ---
  tile('benchWood', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, y % 4 === 3 ? [70, 48, 30] : jit([150, 104, 60], 0.08));
  });
  tile('metalDark', function () { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit([44, 48, 52], 0.08)); });
  tile('binGreen', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, x % 3 === 0 ? [30, 64, 42] : jit([44, 92, 58], 0.07));
  });
  tile('hydrantRed', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, x === 7 || x === 8 ? [236, 90, 80] : jit([190, 36, 32], 0.07));
  });
  tile('trafficBox', function () { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit([34, 34, 30], 0.07)); });
  tile('lampAmber', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) { var d = Math.hypot(x - 7.5, y - 7.5); px(x, y, d < 3 ? [255, 236, 150] : [240, 170, 30]); }
  });
  tile('lampOffRed', function () { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit([90, 22, 20], 0.1)); });
  tile('lampOffGreen', function () { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit([22, 70, 40], 0.1)); });
  tile('acSide', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, y % 3 === 0 ? [150, 152, 150] : jit([196, 198, 194], 0.04));
  });
  tile('acFront', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var d = Math.hypot(x - 10, y - 8);
      var c = [200, 202, 198];
      if (d < 4.6) c = (Math.floor(d * 2) % 2 === 0) ? [70, 72, 74] : [120, 122, 124];
      else if (x < 5 && y % 2 === 0) c = [140, 142, 140];
      px(x, y, jit(c, 0.04));
    }
  });
  tile('tankWood', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var band = y === 3 || y === 12;
      px(x, y, band ? [60, 60, 64] : x % 4 === 0 ? [96, 66, 40] : jit([136, 96, 58], 0.08));
    }
  });
  tile('tankTop', function () { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, Math.hypot(x - 7.5, y - 7.5) < 2 ? [70, 72, 76] : jit([112, 116, 120], 0.06)); });
  tile('ventMetal', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, y % 3 === 1 ? [80, 84, 88] : jit([150, 156, 160], 0.05));
  });
  tile('bagBlack', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, rnd() < 0.08 ? [70, 72, 78] : jit([22, 22, 26], 0.2));
  });
  tile('dumpsterGreen', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var rib = x % 5 === 0, rust = rnd() < 0.05;
      px(x, y, rust ? [110, 70, 40] : rib ? [30, 70, 44] : jit([48, 104, 66], 0.07));
    }
  });
  tile('dumpsterLid', function () { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, y % 8 === 0 ? [20, 22, 22] : jit([36, 40, 38], 0.07)); });
  tile('barrierStripe', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, Math.floor((x + y) / 4) % 2 === 0 ? [220, 40, 34] : [240, 240, 236]);
  });
  tile('cardboard', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, x === 7 || x === 8 ? [196, 170, 110] : jit([160, 120, 70], 0.08));
  });
  // --- наклейки: афиши, граффити, плющ, трещины, пятна, мусор ---
  tile('poster1', function () {
    clear();
    for (var y = 1; y < 15; y++) for (var x = 3; x < 13; x++) {
      var c = [236, 226, 200];
      if (y < 5) c = [40, 60, 140];
      if (y >= 6 && y <= 10 && Math.hypot(x - 8, y - 8) < 2.6) c = [230, 150, 40];
      if (y === 12 || y === 13) c = x % 2 ? [40, 40, 44] : [236, 226, 200];
      px(x, y, jit(c, 0.06));
    }
  });
  tile('poster2', function () {
    clear();
    for (var y = 2; y < 14; y++) for (var x = 2; x < 14; x++) {
      var c = [242, 238, 226];
      if ((y === 4 || y === 7 || y === 9 || y === 11) && x > 3 && x < 12) c = [30, 30, 34];
      if (y >= 3 && y <= 5 && x >= 10 && x <= 12) c = [40, 150, 80];
      px(x, y, jit(c, 0.05));
    }
    px(2, 2, [0, 0, 0], 0); px(13, 13, [0, 0, 0], 0);
  });
  tile('poster3', function () {
    clear();
    for (var y = 0; y < 16; y++) for (var x = 1; x < 15; x++) {
      var c = y < 8 ? [200, 40, 60] : [30, 30, 40];
      if (y >= 9 && y <= 10) c = [250, 220, 60];
      if (y === 12 && x % 3 !== 0) c = [240, 240, 240];
      if (rnd() < 0.06) continue;
      px(x, y, jit(c, 0.06));
    }
  });
  function tag(col, col2, seedK) {
    clear();
    var x = 1.5, y = 9;
    for (var k = 0; k < 44; k++) {
      var a = Math.sin(k * 0.55 + seedK) * 1.4 + Math.cos(k * 0.21 + seedK * 2) * 1.2;
      x += 0.32; y += a * 0.55;
      if (y < 2) y = 2; if (y > 13) y = 13;
      px(Math.round(x), Math.round(y), col); px(Math.round(x), Math.round(y) + 1, col2);
    }
  }
  tile('graffiti1', function () { tag([60, 200, 90], [20, 90, 40], 0.3); });
  tile('graffiti2', function () { tag([240, 90, 170], [120, 30, 80], 2.1); });
  tile('graffiti3', function () {
    clear();
    for (var y = 3; y < 13; y++) for (var x = 2; x < 14; x++) {
      var edge = y === 3 || y === 12 || x === 2 || x === 13;
      if ((x + y) % 7 === 0 || edge) px(x, y, edge ? [30, 30, 30] : [60, 140, 230]);
      else if (rnd() < 0.55) px(x, y, [250, 200, 40]);
    }
  });
  tile('ivy', function () {
    clear();
    for (var v = 0; v < 4; v++) {
      var x = 2 + v * 4 + Math.floor(rnd() * 2);
      for (var y = 0; y < 16; y++) {
        x += rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0;
        x = Math.max(0, Math.min(15, x));
        px(x, y, [58, 84, 40]);
        if (rnd() < 0.55) { var lx = x + (rnd() < 0.5 ? -1 : 1); px(lx, y, jit([62, 124, 48], 0.2)); if (rnd() < 0.5) px(lx, y + 1 > 15 ? y : y + 1, jit([84, 150, 60], 0.2)); }
      }
    }
  });
  tile('crackDecal', function () {
    clear();
    var draw = function (x, y, dx, dy, n) {
      for (var i = 0; i < n; i++) {
        px(Math.round(x), Math.round(y), [20, 20, 22]);
        x += dx + (rnd() - 0.5) * 0.8; y += dy + (rnd() - 0.5) * 0.8;
        if (x < 0 || y < 0 || x > 15 || y > 15) return;
      }
    };
    draw(2, 3, 0.8, 0.6, 16); draw(8, 7, -0.4, 0.9, 9); draw(9, 7, 0.9, -0.3, 7); draw(5, 12, 0.9, 0.2, 9);
  });
  tile('oilStain', function () {
    clear();
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var d = Math.hypot((x - 7.5) * 1.1, y - 7.5) + (rnd() - 0.5) * 1.6;
      if (d < 6) px(x, y, d < 3 ? [16, 16, 20] : [30, 30, 34]);
    }
  });
  tile('litter', function () {
    clear();
    for (var k = 0; k < 4; k++) {
      var cx = 1 + Math.floor(rnd() * 11), cy = 1 + Math.floor(rnd() * 11), w = 2 + Math.floor(rnd() * 3), h = 2 + Math.floor(rnd() * 2);
      var col = pick([[236, 232, 220], [210, 200, 180], [200, 60, 50], [70, 110, 190]]);
      for (var y = cy; y < cy + h; y++) for (var x = cx; x < cx + w; x++) px(x, y, jit(col, 0.06));
    }
    px(12, 12, [150, 150, 156]); px(13, 12, [190, 190, 196]); px(12, 13, [120, 120, 126]);
  });

  // ---- Зарастание города: мох, сорняки, замшелая плитка -------------------------------
  function mossSpots(n, rmin, rmax) {
    clear();
    for (var k = 0; k < n; k++) {
      var cx = rnd() * 16, cy = rnd() * 16, r = rmin + rnd() * (rmax - rmin);
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        var d = Math.hypot(x - cx, y - cy) + (rnd() - 0.5) * 1.2;
        if (d < r) px(x, y, rnd() < 0.18 ? [110, 150, 60] : rnd() < 0.3 ? [46, 86, 34] : jit([70, 116, 44], 0.2));
      }
    }
  }
  tile('moss1', function () { mossSpots(4, 2, 4.5); });
  tile('moss2', function () { mossSpots(7, 1, 3); });
  tile('weeds', function () {
    clear();
    for (var i = 0; i < 8; i++) {
      var gx = 2 + Math.floor(rnd() * 12), gh = 3 + Math.floor(rnd() * 7), lean = rnd() < 0.5 ? -1 : 1, dry = rnd() < 0.35;
      for (var y = 0; y < gh; y++) px(gx + (y > gh * 0.6 ? lean : 0), 15 - y, jit(dry ? [150, 150, 80] : y > gh - 3 ? [118, 170, 70] : [80, 126, 48], 0.15));
    }
    for (var f = 0; f < 3; f++) { var fx = 2 + Math.floor(rnd() * 12), fy = 6 + Math.floor(rnd() * 5); px(fx, fy, [236, 214, 70]); px(fx + 1, fy, [220, 196, 60]); }
  });
  tile('mossySidewalk', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var joint = x % 8 === 7 || y % 8 === 7, moss = joint ? rnd() < 0.75 : rnd() < 0.12;
      px(x, y, moss ? jit([74, 112, 46], 0.2) : joint ? jit([112, 114, 108], 0.05) : jit([160, 160, 152], 0.07));
    }
  });

  // ---- Интерьеры: полы, обои, мебель ----------------------------------------------------------
  tile('parquet', function () {                 // паркет «плетёнкой»: квадраты 8×8, в соседних доски поперёк
    var cols = [[172, 122, 72], [156, 106, 60], [186, 136, 84], [164, 114, 66]];
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var sq = ((x >> 3) + (y >> 3)) & 1, across = sq ? y : x;
      var c = cols[((across >> 2) + (x >> 3) * 2 + (y >> 3)) & 3];
      if ((across & 3) === 3) c = mul(c, 0.72);
      else if (rnd() < 0.12) c = mul(c, 0.9);
      px(x, y, jit(c, 0.05));
    }
  });
  tile('plaster', function () {
    fill([222, 218, 208], 0.04);
    for (var k = 0; k < 2; k++) { var sx = Math.floor(rnd() * 14), sy = Math.floor(rnd() * 14); px(sx, sy, [196, 190, 176]); px(sx + 1, sy, [204, 198, 186]); }
  });
  tile('officeCarpet', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd();
      px(x, y, r < 0.15 ? [86, 96, 112] : r < 0.25 ? [122, 132, 148] : jit([104, 114, 130], 0.08));
    }
  });
  tile('kitchenTile', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var grout = x % 8 === 7 || y % 8 === 7, dark = ((x >> 3) + (y >> 3)) & 1;
      px(x, y, grout ? [150, 150, 146] : jit(dark ? [70, 74, 82] : [228, 226, 218], 0.04));
    }
  });
  // обои четырёх расцветок: полоска, мелкий цветочек, ромбы, крашеная стена; с пятнами сырости
  function wallpaper(base, accent, kind) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var c = base;
      if (kind === 0 && x % 4 === 0) c = accent;
      if (kind === 1 && (x % 4 === 1 && y % 4 === 1 || x % 4 === 3 && y % 4 === 3)) c = accent;
      if (kind === 2 && ((x + y) % 8 === 0 || (x - y + 16) % 8 === 0)) c = accent;
      px(x, y, jit(c, kind === 3 ? 0.05 : 0.03));
    }
    for (var k = 0; k < 2; k++) {
      var sx = Math.floor(rnd() * 16), sy = Math.floor(rnd() * 12), len = 2 + Math.floor(rnd() * 4);
      for (var j = 0; j < len; j++) px(sx, sy + j, mul(base, 0.84));
    }
  }
  tile('wallpaper0', function () { wallpaper([206, 190, 158], [180, 160, 126], 0); });
  tile('wallpaper1', function () { wallpaper([172, 190, 154], [132, 154, 118], 1); });
  tile('wallpaper2', function () { wallpaper([156, 174, 198], [120, 140, 172], 2); });
  tile('wallpaper3', function () { wallpaper([214, 214, 206], [200, 200, 194], 3); });
  function fabric(base) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit((x + y) % 2 ? base : mul(base, 0.92), 0.06));
  }
  tile('sofaFabric', function () { fabric([122, 58, 50]); });
  tile('sofaCushion', function () {
    fabric([146, 72, 62]);
    for (var i = 0; i < 16; i++) { px(7, i, [104, 48, 42]); px(8, i, [104, 48, 42]); px(i, 0, [110, 52, 46]); }
  });
  tile('woodDark', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(y % 5 === 0 ? [80, 54, 34] : [100, 70, 44], 0.07));
  });
  tile('tvBody', function () { fill([38, 38, 42], 0.05); });
  tile('tvScreen', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var frame = x === 0 || x === 15 || y === 0 || y === 15;
      var glare = !frame && (x + y === 9 || x + y === 10) && x < 8;
      px(x, y, frame ? [30, 30, 34] : glare ? [78, 86, 98] : jit([22, 26, 32], 0.1));
    }
  });
  tile('fridgeSide', function () { fill([222, 224, 226], 0.03); });
  tile('fridgeFront', function () {
    fill([230, 232, 234], 0.03);
    for (var x = 0; x < 16; x++) px(x, 5, [176, 178, 182]);
    for (var y = 1; y < 5; y++) px(12, y, [150, 152, 158]);
    for (var y2 = 7; y2 < 14; y2++) px(12, y2, [150, 152, 158]);
    px(3, 2, [120, 180, 90]); px(4, 2, [220, 80, 60]);                 // магнитики
  });
  tile('stoveTop', function () {
    fill([70, 70, 74], 0.05);
    [[4, 4], [11, 4], [4, 11], [11, 11]].forEach(function (b) {
      for (var y = -3; y <= 3; y++) for (var x = -3; x <= 3; x++) {
        var r = Math.hypot(x, y);
        if (r > 1.6 && r < 3.2) px(b[0] + x, b[1] + y, [34, 34, 36]);
      }
    });
  });
  tile('stoveFront', function () {
    fill([214, 214, 216], 0.03);
    for (var x = 2; x < 14; x += 3) px(x, 1, [40, 40, 44]);            // ручки
    for (var y = 4; y < 14; y++) for (var x2 = 2; x2 < 14; x2++) px(x2, y, y === 4 || y === 13 || x2 === 2 || x2 === 13 ? [60, 60, 64] : jit([28, 26, 26], 0.1));
    for (var x3 = 4; x3 < 12; x3++) px(x3, 3, [150, 150, 156]);
  });
  tile('cabinetSide', function () { fill([198, 186, 164], 0.04); });
  tile('cabinetFront', function () {
    fill([204, 192, 170], 0.04);
    for (var y = 0; y < 16; y++) { px(7, y, [150, 138, 116]); px(8, y, [150, 138, 116]); }
    for (var x = 0; x < 16; x++) px(x, 0, [150, 138, 116]);
    px(5, 3, [90, 90, 96]); px(5, 4, [90, 90, 96]); px(10, 3, [90, 90, 96]); px(10, 4, [90, 90, 96]);
  });
  tile('counterTop', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) { var r = rnd(); px(x, y, r < 0.1 ? [96, 96, 94] : r < 0.2 ? [160, 160, 156] : jit([130, 130, 126], 0.05)); }
  });
  tile('sinkTop', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var inB = x >= 3 && x <= 12 && y >= 4 && y <= 13, rim = inB && (x === 3 || x === 12 || y === 4 || y === 13);
      px(x, y, rim ? [170, 174, 178] : inB ? jit([126, 130, 134], 0.08) : jit([130, 130, 126], 0.05));
    }
    px(7, 8, [60, 60, 64]); px(8, 8, [60, 60, 64]);
  });
  tile('wardrobeFront', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(x === 7 || x === 8 ? [70, 46, 28] : [112, 78, 50], 0.06));
    for (var y2 = 6; y2 < 10; y2++) { px(6, y2, [200, 180, 120]); px(9, y2, [200, 180, 120]); }
  });
  tile('deskWood', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(y % 4 === 0 ? [150, 108, 66] : [168, 124, 78], 0.05));
  });
  tile('deskDrawer', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(y % 5 === 0 ? [118, 84, 50] : [164, 120, 76], 0.05));
    [2, 7, 12].forEach(function (y) { for (var x = 6; x < 10; x++) px(x, y, [70, 70, 76]); });
  });
  tile('monitorScreen', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var frame = x < 1 || x > 14 || y < 1 || y > 14;
      px(x, y, frame ? [34, 34, 38] : (x + y === 12 || x + y === 13) && x < 9 ? [72, 88, 110] : jit([18, 24, 36], 0.12));
    }
  });
  tile('chairFabric', function () { fabric([54, 60, 76]); });
  tile('fileSide', function () { fill([142, 148, 152], 0.04); });
  tile('fileFront', function () {
    fill([150, 156, 160], 0.03);
    for (var d = 0; d < 4; d++) {
      var y0 = d * 4;
      for (var x = 0; x < 16; x++) px(x, y0, [104, 110, 116]);
      for (var x2 = 6; x2 < 10; x2++) px(x2, y0 + 2, [80, 84, 90]);
      px(7, y0 + 1, [236, 236, 228]); px(8, y0 + 1, [236, 236, 228]);
    }
  });
  tile('porcelain', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(mix([240, 242, 244], [214, 218, 222], y / 15), 0.02));
  });
  tile('medFront', function () {                 // аптечка: белая дверца с зелёным крестом
    fill([236, 238, 240], 0.02);
    for (var y = 4; y < 12; y++) for (var x = 6; x < 10; x++) { px(x, y, [40, 160, 80]); px(y, x, [40, 160, 80]); }
    for (var x2 = 0; x2 < 16; x2++) { px(x2, 0, [190, 192, 196]); px(x2, 15, [190, 192, 196]); }
  });
  tile('potClay', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(y < 2 ? [150, 80, 50] : [176, 98, 62], 0.06));
  });
  function carpet(base, orn, border) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var e = x === 0 || y === 0 || x === 15 || y === 15, e2 = x === 1 || y === 1 || x === 14 || y === 14;
      var dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5), dm = Math.abs(dx - dy) < 0.6 && dx + dy < 7;
      px(x, y, jit(e ? border : e2 ? orn : dm || (dx < 1 && dy < 1) ? orn : base, 0.05));
    }
  }
  tile('carpetRed', function () { carpet([150, 36, 40], [214, 170, 90], [70, 26, 30]); });
  tile('carpetBlue', function () { carpet([44, 70, 130], [200, 196, 176], [26, 36, 70]); });
  tile('carpetGreen', function () { carpet([58, 104, 64], [210, 190, 120], [30, 56, 36]); });
  tile('coolerWhite', function () { fill([226, 228, 230], 0.03); for (var x = 5; x < 11; x++) px(x, 6, [60, 120, 200]); });
  tile('coolerBlue', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(x < 3 ? [150, 200, 240] : [100, 160, 220], 0.05));
  });
  tile('tableWood', function () { planks([164, 120, 76]); });
  tile('metalLight', function () { fill([184, 188, 194], 0.05); });

  // ---- Следы войны: гарь, копоть, сгоревшие машины, ежи, колючка, мрамор ратуши, часы ------------
  tile('scorched', function () {                 // выжженная земля и асфальт: чёрное с пеплом
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd();
      px(x, y, r < 0.12 ? [92, 88, 84] : r < 0.2 ? [58, 50, 44] : jit([34, 31, 29], 0.25));
    }
  });
  tile('embers', function () {                    // тлеющие угли: пепел с красными искрами
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd();
      px(x, y, r < 0.1 ? [255, 120, 40] : r < 0.16 ? [200, 60, 20] : r < 0.3 ? [90, 84, 78] : jit([40, 34, 30], 0.25));
    }
  });
  function soot(k) {                              // копоть гуще к верху плитки и потёками вниз
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var i = ((Math.floor(cur / 16) * TS + y) * ATLAS + (cur % 16) * TS + x) * 4;
      var dark = k * (0.55 + 0.45 * (1 - y / 15)) * (0.75 + rnd() * 0.5);
      if ((x * 7 + 3) % 5 === 0) dark *= 1.25;
      var m = Math.max(0.12, 1 - dark);
      d[i] = clamp255(d[i] * m); d[i + 1] = clamp255(d[i + 1] * m); d[i + 2] = clamp255(d[i + 2] * m * 0.96);
    }
  }
  tile('sootedBrick', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var row = Math.floor(y / 4), off = row % 2 ? 4 : 0, mortar = y % 4 === 3 || (x + off) % 8 === 7;
      px(x, y, mortar ? [120, 112, 104] : jit([150, 70, 56], 0.12));
    }
    soot(0.7);
  });
  tile('sootedConcrete', function () { fill([150, 150, 146], 0.1); soot(0.62); });
  tile('carBurnt', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd();
      px(x, y, r < 0.25 ? jit([122, 62, 30], 0.2) : r < 0.35 ? [150, 84, 44] : jit([46, 40, 38], 0.3));
    }
  });
  tile('barbedWire', function () {
    clear();
    for (var x = 0; x < 16; x++) {
      var y1 = 4 + Math.round(Math.sin(x * 0.8) * 2), y2 = 10 + Math.round(Math.cos(x * 0.7) * 2);
      px(x, y1, [150, 150, 154]); px(x, y2, [130, 130, 134]);
      if (x % 4 === 1) { px(x, y1 - 1, [110, 110, 116]); px(x, y1 + 1, [110, 110, 116]); px(x, y2 - 1, [100, 100, 106]); }
    }
    for (var y = 3; y < 16; y++) { px(3, y, [90, 70, 50]); px(12, y, [90, 70, 50]); }
  });
  tile('marble', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit([226, 222, 212], 0.03));
    for (var k = 0; k < 3; k++) {
      var vx = rnd() * 16, vy = 0, dx = (rnd() - 0.5) * 1.4;
      for (var s = 0; s < 20; s++) { px(Math.floor(vx), Math.floor(vy), [176, 172, 166]); vx += dx + (rnd() - 0.5) * 0.8; vy += 0.8; }
    }
  });
  tile('clockFace', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var dd = Math.hypot(x - 7.5, y - 7.5);
      px(x, y, dd > 7.2 ? [140, 120, 70] : dd > 6.4 ? [190, 160, 80] : jit([236, 230, 212], 0.03));
    }
    for (var h = 0; h < 12; h++) { var a = h / 12 * Math.PI * 2; px(Math.round(7.5 + Math.cos(a) * 5.4), Math.round(7.5 + Math.sin(a) * 5.4), [40, 36, 30]); }
    for (var t = 0; t < 4; t++) px(7 + (t < 2 ? 0 : 1), 7 - t, [30, 26, 22]);      // стрелки застыли без десяти двенадцать
    for (var t2 = 0; t2 < 3; t2++) px(7 - t2, 7 - t2, [30, 26, 22]);
    for (var cr = 0; cr < 5; cr++) px(9 + cr, 9 + (cr >> 1), [90, 86, 80]);        // трещина по стеклу
  });

  // ---- Порт, старый город, правительственный квартал, электростанция ---------------------------
  function corrugated(base) {                     // гофрированный металл контейнера: рёбра, рамы, ржавчина
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var rib = x % 4 < 2 ? 1 : 0.8, frame = y === 0 || y === 15 || x === 0 || x === 15;
      var c = frame ? mul(base, 0.62) : mul(base, rib);
      if (!frame && rnd() < 0.05) c = [120, 70, 40];
      px(x, y, jit(c, 0.05));
    }
  }
  tile('container0', function () { corrugated([176, 58, 44]); });
  tile('container1', function () { corrugated([46, 92, 150]); });
  tile('container2', function () { corrugated([60, 128, 76]); });
  tile('container3', function () { corrugated([214, 132, 40]); });
  tile('craneLattice', function () {              // решётчатая ферма крана: жёлтые пояса и раскосы
    clear();
    for (var i = 0; i < 16; i++) {
      px(i, 0, [226, 180, 40]); px(i, 15, [226, 180, 40]); px(0, i, [226, 180, 40]); px(15, i, [226, 180, 40]);
      px(i, i, [210, 166, 36]); px(15 - i, i, [210, 166, 36]);
      px(i, 1, [180, 140, 30]); px(1, i, [180, 140, 30]);
    }
  });
  tile('shipHull', function () {                  // надводный борт: тёмно-синяя сталь, заклёпки, потёки ржавчины
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var c = [38, 44, 58];
      if ((x % 8 === 3) && (y === 3 || y === 11)) c = [120, 124, 132];
      if (y === 7 || y === 15) c = [30, 34, 46];                                // швы листов
      if ((x * 7 + 5) % 13 === 0 && y > 4 && rnd() < 0.7) c = [104, 62, 40];      // потёки
      px(x, y, jit(c, 0.07));
    }
  });
  tile('shipHullRed', function () {               // подводная часть: красная краска с налётом
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd(), c = r < 0.06 ? [70, 92, 60] : r < 0.1 ? [96, 50, 36] : [138, 40, 34];
      if (y === 7 || y === 15) c = [110, 32, 28];
      px(x, y, jit(c, 0.07));
    }
  });
  tile('shipCabin', function () {
    fill([226, 226, 222], 0.03);
    [[4, 6], [11, 6]].forEach(function (p2) {
      for (var y = -2; y <= 2; y++) for (var x = -2; x <= 2; x++) if (x * x + y * y <= 5) px(p2[0] + x, p2[1] + y, x * x + y * y > 3 ? [120, 124, 130] : [60, 84, 110]);
    });
  });
  tile('roofTile', function () {                  // черепица: ряды полукруглых плиток
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var row = Math.floor(y / 4), off = row % 2 ? 2 : 0, u = (x + off) % 4, v = y % 4;
      var edge = v === 3 || u === 0;
      px(x, y, jit(edge ? [132, 58, 38] : v === 0 ? [206, 108, 72] : [182, 86, 54], 0.06));
    }
  });
  function plaster(base) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(y === 0 ? mul(base, 0.86) : base, 0.04));
    for (var k = 0; k < 3; k++) { var sx = Math.floor(rnd() * 15), sy = Math.floor(rnd() * 15); px(sx, sy, mul(base, 0.8)); px(sx + 1, sy, mul(base, 0.86)); }
  }
  tile('plaster0', function () { plaster([226, 196, 120]); });
  tile('plaster1', function () { plaster([222, 162, 150]); });
  tile('plaster2', function () { plaster([160, 190, 214]); });
  tile('plaster3', function () { plaster([170, 206, 176]); });
  tile('paving', function () {                    // брусчатка: прямоугольные камни вразбежку
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var row = Math.floor(y / 4), off = row % 2 ? 3 : 0, gap = y % 4 === 3 || (x + off) % 6 === 5;
      px(x, y, gap ? [70, 68, 64] : jit([128, 124, 118], 0.12));
    }
  });
  function chimney(base, mortar) {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var row = Math.floor(y / 4), off = row % 2 ? 4 : 0, m = y % 4 === 3 || (x + off) % 8 === 7;
      px(x, y, m ? mortar : jit(base, 0.08));
    }
  }
  tile('chimneyRed', function () { chimney([178, 52, 44], [120, 110, 104]); });
  tile('chimneyWhite', function () { chimney([222, 220, 214], [150, 146, 140]); });
  tile('coolingConcrete', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(x % 5 === 2 && rnd() < 0.6 ? [150, 150, 146] : [186, 186, 180], 0.05));
  });
  tile('transformerSide', function () {
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(x, y, jit(x % 3 === 0 ? [92, 104, 96] : [118, 132, 122], 0.05));
    for (var x2 = 5; x2 < 11; x2++) { px(x2, 4, [236, 196, 40]); px(x2, 5, [236, 196, 40]); }     // жёлтая табличка
    px(7, 4, [30, 30, 30]); px(8, 5, [30, 30, 30]);
  });
  tile('quayEdge', function () {                  // край причала: бетон с жёлто-чёрной полосой
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var stripe = y >= 12 ? (((x + y) >> 2) % 2 ? [230, 190, 40] : [40, 40, 40]) : jit([158, 158, 154], 0.06);
      px(x, y, stripe);
    }
  });
  tile('flagCity', function () {                  // флаг города: белое и зелёное полотнище со складками
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var fold = 0.88 + 0.12 * Math.sin(x * 0.9), c = y < 8 ? [236, 236, 230] : [58, 150, 76];
      px(x, y, jit(mul(c, fold), 0.03));
    }
  });
  tile('beaconLamp', function () {                // линза маяка: кольца Френеля вокруг яркой лампы
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var dd = Math.hypot(x - 7.5, y - 7.5), ring = Math.floor(dd * 1.3) % 2;
      px(x, y, dd < 2.2 ? [255, 250, 226] : ring ? [255, 226, 150] : [236, 196, 110]);
    }
  });
  tile('stainedGlass', function () {             // витраж: ромбы цветного стекла в свинцовом переплёте
    var pal = [[182, 44, 52], [48, 76, 168], [222, 176, 56], [56, 138, 84], [126, 64, 156]];
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var a = x + y, b = x - y + 18, lead = x === 0 || y === 0 || x === 15 || y === 15 || a % 6 === 0 || b % 6 === 0;
      var col = pal[(Math.floor(a / 6) * 3 + Math.floor(b / 6) * 2) % pal.length];
      px(x, y, lead ? [46, 44, 48] : jit(mix(col, [255, 250, 230], (a % 6 === 1 || b % 6 === 1) ? 0.3 : 0), 0.1));
    }
  });
  tile('copperRoof', function () {               // медная кровля с патиной: фальцевые швы, потёки
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd(), seam = x % 4 === 0;
      var c = seam ? [58, 116, 96] : r < 0.05 ? [150, 104, 64] : r < 0.2 ? [104, 176, 148] : [84, 156, 128];
      px(x, y, jit(c, 0.08));
    }
  });

  // ---- Сборка атласа ---------------------------------------------------------------
  function makeAtlas() {
    var cv = document.createElement('canvas');
    cv.width = ATLAS; cv.height = ATLAS_H;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(ATLAS, ATLAS_H);
    d = img.data;
    for (var i = 0; i < PAINTERS.length; i++) {
      cur = i;
      rnd = KC.mulberry32(9127 + i * 7919);
      PAINTERS[i]();
    }
    ctx.putImageData(img, 0, 0);
    // прозрачность пикселей — для объёмных (выдавленных) предметов
    var alpha = new Uint8Array(ATLAS * ATLAS_H);
    for (i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
    KC.atlasAlpha = alpha;
    d = null;
    return cv;
  }

  function tileUV(t) {
    var tx = t % 16, ty = Math.floor(t / 16), e = 0.02 / ATLAS, eh = 0.02 / ATLAS_H;
    return [tx * TS / ATLAS + e, ty * TS / ATLAS_H + eh, (tx + 1) * TS / ATLAS - e, (ty + 1) * TS / ATLAS_H - eh];
  }

  // ---- Иконки HUD (9×9) ---------------------------------------------------------
  function miniIcon(rows, palette, size) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 9;
    var ctx = cv.getContext('2d'), im = ctx.createImageData(9, 9);
    for (var y = 0; y < rows.length; y++) for (var x = 0; x < rows[y].length; x++) {
      var c = palette[rows[y].charAt(x)];
      if (!c) continue;
      var i = (y * 9 + x) * 4;
      im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = c.length > 3 ? c[3] : 255;
    }
    ctx.putImageData(im, 0, 0);
    var out = document.createElement('canvas');
    out.width = out.height = size || 27;
    var o = out.getContext('2d');
    o.imageSmoothingEnabled = false;
    o.drawImage(cv, 0, 0, out.width, out.height);
    return out.toDataURL();
  }
  function halfRows(rows, a, b) {
    // левая половина — символы a, правая — b
    return rows.map(function (r) { return r.split('').map(function (ch, x) { return x > 4 && ch === a ? b : ch; }).join(''); });
  }

  function makeHudIcons() {
    var heart = ['.aaa.aaa.', 'abbcabbba', 'abcbbbbba', 'abbbbbbba', '.abbbbba.', '..abbba..', '...aba...', '....a....'];
    var heartEmpty = heart.map(function (r) { return r.replace(/[bc]/g, 'e'); });
    var food = ['.....aa..', '....abba.', '...abbba.', '..abbbba.', '.abbbba..', '.abbba...', '..aaa....', '.dd......', 'd.d......'];
    var foodEmpty = food.map(function (r) { return r.replace(/b/g, 'e'); });
    var bubble = ['..aaaa...', '.a....a..', 'a..b...a.', 'a.b....a.', 'a......a.', 'a......a.', '.a....a..', '..aaaa...'];
    var armor = ['aa.....aa', 'abaaaaaba', 'abbbbbbba', '.abbbbba.', '.abbbbba.', '.abbbbba.', '.abbbbba.', '.aaaaaaa.'];
    var armorEmpty = armor.map(function (r) { return r.replace(/b/g, 'e'); });
    var hp = { a: [30, 8, 8], b: [214, 36, 36], c: [255, 170, 170], e: [60, 30, 30] };
    var fp = { a: [60, 30, 10], b: [196, 120, 50], d: [236, 226, 206], e: [60, 40, 30] };
    var bp = { a: [220, 236, 255], b: [255, 255, 255] };
    var ap = { a: [40, 40, 44], b: [206, 206, 214], e: [60, 60, 66] };
    return {
      heart: miniIcon(heart, hp), heartHalf: miniIcon(halfRows(heart.map(function (r) { return r.replace(/c/g, 'b'); }), 'b', 'e'), hp),
      heartEmpty: miniIcon(heartEmpty, hp),
      food: miniIcon(food, fp), foodHalf: miniIcon(halfRows(food, 'b', 'e').map(function (r) { return r; }), fp), foodEmpty: miniIcon(foodEmpty, fp),
      bubble: miniIcon(bubble, bp),
      armor: miniIcon(armor, ap), armorHalf: miniIcon(halfRows(armor, 'b', 'e'), ap), armorEmpty: miniIcon(armorEmpty, ap)
    };
  }

  // ---- Иконка предмета или блока --------------------------------------------------
  function makeIcon(atlas, id, size) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    var it = KC.ITEMS[id];
    function src(t) { return [(t % 16) * TS, Math.floor(t / 16) * TS]; }
    if (!it) return cv;
    if (it.sprite !== undefined) {
      var s0 = src(it.sprite);
      ctx.drawImage(atlas, s0[0], s0[1], 16, 16, 0, 0, size, size);
      return cv;
    }
    var b = KC.BLOCKS[id];
    var s = size * 0.94, off = (size - s) / 2;
    var top = b.tiles.top, side = b.tiles.front !== undefined ? b.tiles.front : b.tiles.side;
    var faces = [
      { t: top, m: [(s / 2) / 16, -(s / 4) / 16, (s / 2) / 16, (s / 4) / 16, off, off + s / 4], shade: 0 },
      { t: side, m: [(s / 2) / 16, (s / 4) / 16, 0, (s / 2) / 16, off, off + s / 4], shade: 0.22 },
      { t: b.tiles.side, m: [(s / 2) / 16, -(s / 4) / 16, 0, (s / 2) / 16, off + s / 2, off + s / 2], shade: 0.4 }
    ];
    faces.forEach(function (f) {
      var p = src(f.t);
      ctx.setTransform(f.m[0], f.m[1], f.m[2], f.m[3], f.m[4], f.m[5]);
      ctx.drawImage(atlas, p[0], p[1], 16, 16, 0, 0, 16, 16);
      if (f.shade) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = 'rgba(0,0,0,' + f.shade + ')';
        ctx.fillRect(0, 0, 16, 16);
        ctx.globalCompositeOperation = 'source-over';
      }
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return cv;
  }

  KC.TILE = TILE;
  KC.ATLAS_SIZE = ATLAS;
  KC.ATLAS_W = ATLAS;
  KC.ATLAS_H = ATLAS_H;
  KC.makeAtlas = makeAtlas;
  KC.tileUV = tileUV;
  KC.makeIcon = makeIcon;
  KC.makeHudIcons = makeHudIcons;
})(window.KC = window.KC || {});
