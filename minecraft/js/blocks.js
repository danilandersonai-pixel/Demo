/* Кубокрафт — таблица блоков, процедурный атлас текстур 16×16 и иконки для хотбара.
   Текстуры рисуются кодом при запуске: внешних картинок нет. */
(function (KC) {
  'use strict';

  // ---- Идентификаторы блоков ------------------------------------------------
  var B = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, LOG: 6, LEAVES: 7,
    PLANKS: 8, GLASS: 9, WATER: 10, BEDROCK: 11, BRICK: 12, SNOW: 13, SNOW_GRASS: 14,
    GRAVEL: 15, COAL: 16, IRON: 17, CACTUS: 18, SANDSTONE: 19, TALL_GRASS: 20,
    POPPY: 21, DANDELION: 22, STONE_BRICK: 23, BOOKSHELF: 24, WOOL_WHITE: 25,
    WOOL_RED: 26, WOOL_BLUE: 27, WOOL_YELLOW: 28, WOOL_GREEN: 29, BIRCH_LOG: 30,
    OBSIDIAN: 31, GOLD: 32
  };

  // ---- Номера плиток в атласе (16 колонок × 4 ряда по 16 px) --------------
  var T = {
    grassTop: 0, grassSide: 1, dirt: 2, stone: 3, cobble: 4, sand: 5, logSide: 6, logTop: 7,
    leaves: 8, planks: 9, glass: 10, water: 11, bedrock: 12, brick: 13, snow: 14, snowSide: 15,
    gravel: 16, coal: 17, iron: 18, cactusSide: 19, cactusTop: 20, sandstoneSide: 21,
    sandstoneTop: 22, tallGrass: 23, poppy: 24, dandelion: 25, stoneBrick: 26, bookshelf: 27,
    woolWhite: 28, woolRed: 29, woolBlue: 30, woolYellow: 31, woolGreen: 32, birchSide: 33,
    birchTop: 34, obsidian: 35, gold: 36
  };

  // kind: cube | cross (растения крестом) | liquid
  // mat: материал для звука и частиц
  function def(name, top, bottom, side, opts) {
    var d = {
      name: name, tiles: [top, bottom, side], kind: 'cube', opaque: true, solid: true,
      mat: 'stone', breakable: true
    };
    for (var k in opts) d[k] = opts[k];
    return d;
  }

  var BLOCKS = [];
  BLOCKS[B.AIR] = { name: 'Воздух', kind: 'air', opaque: false, solid: false, tiles: [0, 0, 0], mat: 'none' };
  BLOCKS[B.GRASS] = def('Трава', T.grassTop, T.dirt, T.grassSide, { mat: 'grass' });
  BLOCKS[B.DIRT] = def('Земля', T.dirt, T.dirt, T.dirt, { mat: 'dirt' });
  BLOCKS[B.STONE] = def('Камень', T.stone, T.stone, T.stone, {});
  BLOCKS[B.COBBLE] = def('Булыжник', T.cobble, T.cobble, T.cobble, {});
  BLOCKS[B.SAND] = def('Песок', T.sand, T.sand, T.sand, { mat: 'sand' });
  BLOCKS[B.LOG] = def('Дубовое бревно', T.logTop, T.logTop, T.logSide, { mat: 'wood' });
  BLOCKS[B.LEAVES] = def('Листва', T.leaves, T.leaves, T.leaves, { opaque: false, leaves: true, mat: 'plant' });
  BLOCKS[B.PLANKS] = def('Доски', T.planks, T.planks, T.planks, { mat: 'wood' });
  BLOCKS[B.GLASS] = def('Стекло', T.glass, T.glass, T.glass, { opaque: false, glass: true, mat: 'glass' });
  BLOCKS[B.WATER] = def('Вода', T.water, T.water, T.water, { kind: 'liquid', opaque: false, solid: false, mat: 'water' });
  BLOCKS[B.BEDROCK] = def('Коренная порода', T.bedrock, T.bedrock, T.bedrock, { breakable: false });
  BLOCKS[B.BRICK] = def('Кирпичи', T.brick, T.brick, T.brick, {});
  BLOCKS[B.SNOW] = def('Снег', T.snow, T.snow, T.snow, { mat: 'snow' });
  BLOCKS[B.SNOW_GRASS] = def('Заснеженная трава', T.snow, T.dirt, T.snowSide, { mat: 'snow' });
  BLOCKS[B.GRAVEL] = def('Гравий', T.gravel, T.gravel, T.gravel, { mat: 'sand' });
  BLOCKS[B.COAL] = def('Угольная руда', T.coal, T.coal, T.coal, {});
  BLOCKS[B.IRON] = def('Железная руда', T.iron, T.iron, T.iron, {});
  BLOCKS[B.CACTUS] = def('Кактус', T.cactusTop, T.cactusTop, T.cactusSide, { mat: 'cloth' });
  BLOCKS[B.SANDSTONE] = def('Песчаник', T.sandstoneTop, T.sandstoneTop, T.sandstoneSide, {});
  BLOCKS[B.TALL_GRASS] = def('Высокая трава', T.tallGrass, T.tallGrass, T.tallGrass, { kind: 'cross', opaque: false, solid: false, mat: 'plant' });
  BLOCKS[B.POPPY] = def('Мак', T.poppy, T.poppy, T.poppy, { kind: 'cross', opaque: false, solid: false, mat: 'plant' });
  BLOCKS[B.DANDELION] = def('Одуванчик', T.dandelion, T.dandelion, T.dandelion, { kind: 'cross', opaque: false, solid: false, mat: 'plant' });
  BLOCKS[B.STONE_BRICK] = def('Каменные кирпичи', T.stoneBrick, T.stoneBrick, T.stoneBrick, {});
  BLOCKS[B.BOOKSHELF] = def('Книжная полка', T.planks, T.planks, T.bookshelf, { mat: 'wood' });
  BLOCKS[B.WOOL_WHITE] = def('Белая шерсть', T.woolWhite, T.woolWhite, T.woolWhite, { mat: 'cloth' });
  BLOCKS[B.WOOL_RED] = def('Красная шерсть', T.woolRed, T.woolRed, T.woolRed, { mat: 'cloth' });
  BLOCKS[B.WOOL_BLUE] = def('Синяя шерсть', T.woolBlue, T.woolBlue, T.woolBlue, { mat: 'cloth' });
  BLOCKS[B.WOOL_YELLOW] = def('Жёлтая шерсть', T.woolYellow, T.woolYellow, T.woolYellow, { mat: 'cloth' });
  BLOCKS[B.WOOL_GREEN] = def('Зелёная шерсть', T.woolGreen, T.woolGreen, T.woolGreen, { mat: 'cloth' });
  BLOCKS[B.BIRCH_LOG] = def('Берёзовое бревно', T.birchTop, T.birchTop, T.birchSide, { mat: 'wood' });
  BLOCKS[B.OBSIDIAN] = def('Обсидиан', T.obsidian, T.obsidian, T.obsidian, {});
  BLOCKS[B.GOLD] = def('Золотой блок', T.gold, T.gold, T.gold, { mat: 'metal' });

  var COUNT = BLOCKS.length;

  // Быстрые таблицы-флаги для горячих циклов мешера и физики
  var OPAQUE = new Uint8Array(256);   // полностью закрывает соседнюю грань
  var SOLID = new Uint8Array(256);    // есть коллизия
  var OCCLUDE = new Uint8Array(256);  // даёт затенение углов (AO)
  var LIGHTBLOCK = new Uint8Array(256); // перекрывает небо для «солнечной» карты высот
  var CROSS = new Uint8Array(256);
  for (var id = 1; id < COUNT; id++) {
    var b = BLOCKS[id];
    OPAQUE[id] = b.opaque ? 1 : 0;
    SOLID[id] = b.solid ? 1 : 0;
    OCCLUDE[id] = (b.opaque || b.leaves) ? 1 : 0;
    LIGHTBLOCK[id] = (b.opaque || b.leaves) ? 1 : 0;
    CROSS[id] = b.kind === 'cross' ? 1 : 0;
  }

  // Порядок блоков в инвентаре
  var INVENTORY = [
    B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.STONE_BRICK, B.BRICK, B.SAND, B.SANDSTONE,
    B.GRAVEL, B.SNOW, B.SNOW_GRASS, B.LOG, B.BIRCH_LOG, B.PLANKS, B.BOOKSHELF, B.LEAVES,
    B.GLASS, B.WATER, B.CACTUS, B.COAL, B.IRON, B.GOLD, B.OBSIDIAN, B.WOOL_WHITE,
    B.WOOL_RED, B.WOOL_YELLOW, B.WOOL_GREEN, B.WOOL_BLUE, B.TALL_GRASS, B.POPPY, B.DANDELION
  ];

  var DEFAULT_HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.LOG, B.GLASS, B.BRICK, B.WOOL_RED];

  // ---- Процедурный атлас ----------------------------------------------------
  var ATLAS_W = 256, ATLAS_H = 64, TILE = 16;

  function makeAtlas() {
    var cv = document.createElement('canvas');
    cv.width = ATLAS_W; cv.height = ATLAS_H;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(ATLAS_W, ATLAS_H);
    var d = img.data;
    var rnd;

    function px(tile, x, y, c, a) {
      if (x < 0 || y < 0 || x > 15 || y > 15) return;
      var tx = (tile % 16) * TILE + x, ty = Math.floor(tile / 16) * TILE + y;
      var i = (ty * ATLAS_W + tx) * 4;
      d[i] = clamp255(c[0]); d[i + 1] = clamp255(c[1]); d[i + 2] = clamp255(c[2]);
      d[i + 3] = a === undefined ? 255 : a;
    }
    function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
    function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
    function jit(c, spread) { return mul(c, 1 + (rnd() - 0.5) * spread); }
    function seed(tile) { rnd = KC.mulberry32(9127 + tile * 7919); }
    function fill(tile, base, spread) {
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(tile, x, y, jit(base, spread));
    }
    function pick(list) { return list[Math.floor(rnd() * list.length)]; }

    // Трава сверху
    seed(T.grassTop);
    for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
      var r = rnd();
      px(T.grassTop, x, y, r < 0.12 ? [126, 190, 74] : r < 0.24 ? [72, 128, 42] : jit([98, 160, 56], 0.22));
    }

    // Земля
    function dirt(tile) {
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        var r = rnd();
        px(tile, x, y, r < 0.1 ? [98, 68, 46] : r < 0.17 ? [160, 122, 88] : jit([134, 96, 66], 0.2));
      }
    }
    seed(T.dirt); dirt(T.dirt);

    // Трава сбоку: земля + рваная зелёная кромка
    seed(T.grassSide); dirt(T.grassSide);
    for (x = 0; x < 16; x++) {
      var depth = 3 + (rnd() < 0.5 ? 1 : 0) + (rnd() < 0.2 ? 1 : 0);
      for (y = 0; y < depth; y++) px(T.grassSide, x, y, jit(y === depth - 1 ? [78, 136, 44] : [96, 156, 54], 0.2));
    }

    // Снег и снег сбоку
    seed(T.snow); fill(T.snow, [236, 243, 248], 0.07);
    seed(T.snowSide); dirt(T.snowSide);
    for (x = 0; x < 16; x++) {
      var sd = 3 + (rnd() < 0.5 ? 1 : 0) + (rnd() < 0.25 ? 1 : 0);
      for (y = 0; y < sd; y++) px(T.snowSide, x, y, jit([236, 243, 248], 0.06));
    }

    // Камень
    function stone(tile) {
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(tile, x, y, jit([124, 124, 126], 0.16));
      for (var s = 0; s < 6; s++) {
        var sx = Math.floor(rnd() * 16), sy = Math.floor(rnd() * 16), len = 2 + Math.floor(rnd() * 3);
        for (var k = 0; k < len; k++) px(tile, sx + k, sy, [98, 98, 100]);
      }
    }
    seed(T.stone); stone(T.stone);

    // Булыжник: ячейки Вороного с тёмным швом
    seed(T.cobble);
    var pts = [];
    for (var i = 0; i < 9; i++) pts.push([rnd() * 16, rnd() * 16, 0.75 + rnd() * 0.45]);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var best = 1e9, second = 1e9, bi = 0;
      for (i = 0; i < pts.length; i++) {
        for (var ox = -16; ox <= 16; ox += 16) for (var oy = -16; oy <= 16; oy += 16) {
          var dx = x + 0.5 - pts[i][0] - ox, dy = y + 0.5 - pts[i][1] - oy, dd = dx * dx + dy * dy;
          if (dd < best) { second = best; best = dd; bi = i; } else if (dd < second) second = dd;
        }
      }
      var edge = Math.sqrt(second) - Math.sqrt(best);
      px(T.cobble, x, y, edge < 1.1 ? jit([72, 72, 74], 0.15) : jit(mul([128, 128, 130], pts[bi][2]), 0.12));
    }

    // Песок, песчаник
    seed(T.sand); fill(T.sand, [219, 205, 150], 0.1);
    seed(T.sandstoneTop); fill(T.sandstoneTop, [222, 208, 158], 0.07);
    seed(T.sandstoneSide);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var sc = y < 3 ? [230, 216, 168] : y === 3 ? [190, 172, 120] : y > 11 ? (rnd() < 0.2 ? [196, 178, 128] : [214, 198, 148]) : [218, 202, 152];
      px(T.sandstoneSide, x, y, jit(sc, 0.06));
    }

    // Гравий
    seed(T.gravel);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      px(T.gravel, x, y, jit(pick([[132, 126, 122], [104, 100, 98], [152, 146, 140], [118, 106, 98], [90, 86, 86]]), 0.08));
    }

    // Руды
    function ore(tile, c1, c2) {
      stone(tile);
      for (var k = 0; k < 4; k++) {
        var cx = 2 + rnd() * 12, cy = 2 + rnd() * 12;
        for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
          var dd = (x - cx) * (x - cx) + (y - cy) * (y - cy);
          if (dd < 2.2 && rnd() < 0.85) px(tile, x, y, rnd() < 0.35 ? c2 : c1);
        }
      }
    }
    seed(T.coal); ore(T.coal, [34, 34, 36], [62, 62, 64]);
    seed(T.iron); ore(T.iron, [216, 174, 146], [184, 140, 112]);

    // Бревно сбоку: вертикальная кора
    seed(T.logSide);
    var colK = [];
    for (x = 0; x < 16; x++) colK.push(0.82 + rnd() * 0.3);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var dark = (x % 4 === 1 && rnd() < 0.8) ? 0.72 : 1;
      px(T.logSide, x, y, jit(mul([106, 80, 48], colK[x] * dark), 0.1));
    }
    // Спил бревна: кольца
    function rings(tile, light, darkc, bark) {
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) {
        var dd = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        var c = dd >= 7 ? bark : (Math.floor(dd) % 2 === 0 ? light : darkc);
        px(tile, x, y, jit(c, 0.08));
      }
    }
    seed(T.logTop); rings(T.logTop, [178, 144, 92], [150, 118, 72], [106, 80, 48]);

    // Берёза
    seed(T.birchSide);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) px(T.birchSide, x, y, jit([218, 216, 206], 0.06));
    for (i = 0; i < 7; i++) {
      var bx = Math.floor(rnd() * 14), by = Math.floor(rnd() * 16), bl = 2 + Math.floor(rnd() * 3);
      for (var k2 = 0; k2 < bl; k2++) px(T.birchSide, bx + k2, by, [46, 44, 40]);
    }
    seed(T.birchTop); rings(T.birchTop, [206, 186, 136], [186, 164, 116], [218, 216, 206]);

    // Листва с дырками (вырезается альфа-тестом)
    seed(T.leaves);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      if (rnd() < 0.16) { px(T.leaves, x, y, [0, 0, 0], 0); continue; }
      var lr = rnd();
      px(T.leaves, x, y, lr < 0.15 ? [86, 150, 58] : lr < 0.3 ? [40, 92, 30] : jit([58, 122, 42], 0.25));
    }

    // Доски
    seed(T.planks);
    for (y = 0; y < 16; y++) {
      var board = Math.floor(y / 4), rowK = 0.92 + rnd() * 0.14;
      var seam = (board * 7 + 3) % 16;
      for (x = 0; x < 16; x++) {
        var pc = (y % 4 === 3 || x === seam) ? [112, 84, 52] : mul([170, 134, 84], rowK * (x % 5 === 0 ? 0.95 : 1));
        px(T.planks, x, y, jit(pc, 0.06));
      }
    }

    // Стекло: рамка + блики, середина прозрачная
    seed(T.glass);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var border = x === 0 || y === 0 || x === 15 || y === 15;
      if (border) px(T.glass, x, y, jit([196, 228, 238], 0.05));
      else px(T.glass, x, y, [0, 0, 0], 0);
    }
    [[3, 5], [4, 4], [5, 3], [3, 6], [10, 12], [11, 11], [12, 10]].forEach(function (p) {
      px(T.glass, p[0], p[1], [232, 246, 250]);
    });

    // Вода
    seed(T.water);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) px(T.water, x, y, jit([48, 100, 196], 0.12));
    for (i = 0; i < 8; i++) {
      var wx = Math.floor(rnd() * 13), wy = Math.floor(rnd() * 16);
      for (var k = 0; k < 3; k++) px(T.water, wx + k, wy, [84, 142, 222]);
    }

    // Коренная порода
    seed(T.bedrock);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) px(T.bedrock, x, y, pick([[40, 40, 42], [84, 84, 86], [60, 60, 62], [118, 118, 120], [30, 30, 32]]));

    // Кирпичи
    seed(T.brick);
    for (y = 0; y < 16; y++) {
      var row = Math.floor(y / 4);
      for (x = 0; x < 16; x++) {
        var mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
        px(T.brick, x, y, mortar ? jit([190, 184, 172], 0.05) : jit([150, 68, 52], 0.14));
      }
    }

    // Каменные кирпичи
    seed(T.stoneBrick);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var sr = y < 8 ? 0 : 1;
      var m = y === 7 || y === 15 || (sr === 0 ? x === 15 : x === 7);
      var hi = !m && (y === 0 || y === 8 || (sr === 0 ? x === 0 : x === 8));
      px(T.stoneBrick, x, y, m ? jit([84, 84, 86], 0.06) : hi ? jit([146, 146, 148], 0.05) : jit([120, 120, 122], 0.1));
    }

    // Кактус
    seed(T.cactusSide);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var line = x === 0 || x === 15 || x === 4 || x === 11;
      px(T.cactusSide, x, y, jit(line ? [44, 104, 42] : [72, 142, 60], 0.12));
    }
    for (i = 0; i < 8; i++) px(T.cactusSide, 1 + Math.floor(rnd() * 14), Math.floor(rnd() * 16), [222, 230, 196]);
    seed(T.cactusTop);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var cd = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      px(T.cactusTop, x, y, jit(cd > 6.5 ? [44, 104, 42] : cd < 2 ? [120, 176, 90] : [84, 152, 66], 0.1));
    }

    // Растения (прозрачный фон)
    function clearTile(tile) { for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(tile, x, y, [0, 0, 0], 0); }
    seed(T.tallGrass); clearTile(T.tallGrass);
    for (i = 0; i < 9; i++) {
      var gx = 1 + Math.floor(rnd() * 14), gh = 5 + Math.floor(rnd() * 9), lean = rnd() < 0.5 ? -1 : 1;
      for (y = 0; y < gh; y++) {
        var xx = gx + (y > gh * 0.6 ? lean : 0);
        px(T.tallGrass, xx, 15 - y, jit(y > gh - 3 ? [112, 176, 70] : [72, 132, 44], 0.15));
      }
    }
    function flower(tile, petal, petalDark, center) {
      clearTile(tile);
      for (var y = 8; y < 16; y++) px(tile, 7, y, [60, 120, 40]);
      px(tile, 6, 12, [74, 140, 50]); px(tile, 5, 11, [74, 140, 50]);
      px(tile, 8, 13, [74, 140, 50]); px(tile, 9, 12, [74, 140, 50]);
      for (var yy = 3; yy <= 7; yy++) for (var x = 5; x <= 9; x++) {
        var dd = Math.abs(x - 7) + Math.abs(yy - 5);
        if (dd <= 3) px(tile, x, yy, dd <= 0 ? center : (dd === 3 ? petalDark : petal));
      }
    }
    seed(T.poppy); flower(T.poppy, [208, 44, 40], [150, 26, 24], [48, 20, 18]);
    seed(T.dandelion); flower(T.dandelion, [246, 212, 44], [214, 170, 24], [255, 240, 120]);

    // Книжная полка
    seed(T.bookshelf);
    var bookCols = [[150, 40, 40], [44, 72, 142], [52, 112, 62], [172, 140, 52], [112, 60, 122], [92, 62, 40], [180, 170, 150]];
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var shelf = y <= 1 || y >= 14 || y === 7 || y === 8;
      px(T.bookshelf, x, y, shelf ? jit([168, 132, 82], 0.06) : [52, 38, 26]);
    }
    [[2, 6], [9, 13]].forEach(function (range) {
      x = 1;
      while (x < 15) {
        var w = rnd() < 0.3 ? 2 : 1, col = pick(bookCols), top = range[0] + (rnd() < 0.35 ? 1 : 0);
        for (var bx2 = 0; bx2 < w && x < 15; bx2++, x++) {
          for (var yy = top; yy <= range[1]; yy++) px(T.bookshelf, x, yy, jit(col, 0.1));
        }
        x += rnd() < 0.2 ? 1 : 0;
      }
    });

    // Шерсть
    function wool(tile, c) {
      for (var y = 0; y < 16; y++) for (var x = 0; x < 16; x++) px(tile, x, y, jit(mul(c, (x + y) % 3 === 0 ? 0.93 : 1), 0.08));
    }
    seed(T.woolWhite); wool(T.woolWhite, [234, 234, 230]);
    seed(T.woolRed); wool(T.woolRed, [176, 44, 40]);
    seed(T.woolBlue); wool(T.woolBlue, [52, 72, 160]);
    seed(T.woolYellow); wool(T.woolYellow, [238, 196, 44]);
    seed(T.woolGreen); wool(T.woolGreen, [86, 138, 40]);

    // Обсидиан
    seed(T.obsidian);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var orr = rnd();
      px(T.obsidian, x, y, orr < 0.08 ? [70, 46, 104] : orr < 0.2 ? [36, 26, 56] : jit([20, 16, 30], 0.3));
    }

    // Золото
    seed(T.gold);
    for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var gb = x === 0 || y === 0 ? [255, 242, 150] : (x === 15 || y === 15 ? [196, 146, 30] : [246, 206, 62]);
      px(T.gold, x, y, jit(gb, 0.06));
    }
    for (i = 0; i < 5; i++) px(T.gold, 2 + Math.floor(rnd() * 12), 2 + Math.floor(rnd() * 12), [255, 250, 200]);

    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // Прямоугольник плитки в UV-координатах атласа (с крошечным отступом от шва)
  function tileUV(tile) {
    var tx = tile % 16, ty = Math.floor(tile / 16);
    var eu = 0.02 / ATLAS_W, ev = 0.02 / ATLAS_H;
    return [
      tx * TILE / ATLAS_W + eu, ty * TILE / ATLAS_H + ev,
      (tx + 1) * TILE / ATLAS_W - eu, (ty + 1) * TILE / ATLAS_H - ev
    ];
  }

  // Изометрическая иконка блока для хотбара и инвентаря
  function makeIcon(atlas, id, size) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    var b = BLOCKS[id];
    function tileSrc(t) { return [(t % 16) * TILE, Math.floor(t / 16) * TILE]; }

    if (b.kind === 'cross') {
      var s0 = tileSrc(b.tiles[2]);
      ctx.drawImage(atlas, s0[0], s0[1], 16, 16, size * 0.1, size * 0.1, size * 0.8, size * 0.8);
      return cv;
    }

    var s = size * 0.94, off = (size - s) / 2;
    var faces = [
      // верх: из левой точки ромба к верхней (u) и к нижней (v)
      { t: b.tiles[0], m: [(s / 2) / 16, -(s / 4) / 16, (s / 2) / 16, (s / 4) / 16, off, off + s / 4], shade: 0 },
      // левая грань
      { t: b.tiles[2], m: [(s / 2) / 16, (s / 4) / 16, 0, (s / 2) / 16, off, off + s / 4], shade: 0.22 },
      // правая грань
      { t: b.tiles[2], m: [(s / 2) / 16, -(s / 4) / 16, 0, (s / 2) / 16, off + s / 2, off + s / 2], shade: 0.4 }
    ];
    faces.forEach(function (f) {
      var src = tileSrc(f.t);
      ctx.setTransform(f.m[0], f.m[1], f.m[2], f.m[3], f.m[4], f.m[5]);
      ctx.globalAlpha = id === B.WATER ? 0.85 : 1;
      ctx.drawImage(atlas, src[0], src[1], 16, 16, 0, 0, 16, 16);
      ctx.globalAlpha = 1;
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

  KC.B = B;
  KC.T = T;
  KC.BLOCKS = BLOCKS;
  KC.BLOCK_COUNT = COUNT;
  KC.OPAQUE = OPAQUE;
  KC.SOLID = SOLID;
  KC.OCCLUDE = OCCLUDE;
  KC.LIGHTBLOCK = LIGHTBLOCK;
  KC.CROSS = CROSS;
  KC.INVENTORY = INVENTORY;
  KC.DEFAULT_HOTBAR = DEFAULT_HOTBAR;
  KC.ATLAS_W = ATLAS_W;
  KC.ATLAS_H = ATLAS_H;
  KC.makeAtlas = makeAtlas;
  KC.tileUV = tileUV;
  KC.makeIcon = makeIcon;
})(window.KC = window.KC || {});
