/* Кубокрафт — модели персонажей из коробок и их процедурные «шкурки».
   Все персонажи — собственные: Странник (игрок), свинья, бурёнка, овца, курица,
   упырь, костяной лучник и лесной паук. Модель смотрит в −Z, единица — пиксель (1/16 блока). */
(function (KC) {
  'use strict';

  var ATLAS = 1024;
  var cv, ctx, img, data;
  var shelfX = 0, shelfY = 0, shelfH = 0;
  var rnd = KC.mulberry32(777);

  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function jit(c, s) { return mul(c, 1 + (rnd() - 0.5) * s); }

  function alloc(w, h) {
    if (shelfX + w > ATLAS) { shelfX = 0; shelfY += shelfH; shelfH = 0; }
    var r = { x: shelfX, y: shelfY, w: w, h: h };
    shelfX += w; if (h > shelfH) shelfH = h;
    return r;
  }
  function put(r, x, y, c) {
    if (x < 0 || y < 0 || x >= r.w || y >= r.h) return;
    var i = ((r.y + y) * ATLAS + r.x + x) * 4;
    data[i] = clamp255(c[0]); data[i + 1] = clamp255(c[1]); data[i + 2] = clamp255(c[2]); data[i + 3] = c[3] === 0 ? 0 : 255;
  }

  // Грань коробки: w×h пикселей; paint(face, x, y, w, h) → цвет или null (базовый)
  var FACE_NAMES = ['right', 'left', 'top', 'bottom', 'back', 'front'];
  function paintBox(size, base, noise, painter) {
    var faces = [];
    var dims = [[size[2], size[1]], [size[2], size[1]], [size[0], size[2]], [size[0], size[2]], [size[0], size[1]], [size[0], size[1]]];
    for (var f = 0; f < 6; f++) {
      var r = alloc(dims[f][0], dims[f][1]);
      for (var y = 0; y < r.h; y++) for (var x = 0; x < r.w; x++) {
        var c = painter ? painter(FACE_NAMES[f], x, y, r.w, r.h) : null;
        if (c && c[3] === 0) { put(r, x, y, c); continue; }
        put(r, x, y, c ? jit(c, noise * 0.5) : jit(base, noise));
      }
      faces.push(r);
    }
    return faces;
  }

  // part: size [w,h,d], pivot [x,y,z] от ног сущности, from — угол коробки от pivot
  function part(name, size, pivot, from, base, noise, painter) {
    return { name: name, size: size, pivot: pivot, from: from, faces: paintBox(size, base, noise, painter) };
  }

  // ---- Палитры ------------------------------------------------------------------
  var SKIN = [214, 170, 132], HAIR = [70, 44, 28], HAT = [58, 104, 130], SCARF = [196, 92, 42];
  var JACKET = [98, 112, 62], PANTS = [62, 62, 70], BOOTS = [90, 60, 36];

  var MODELS = {};

  function humanoid(opts) {
    var p = [];
    p.push(part('head', [8, 8, 8], [0, 24, 0], [-4, 0, -4], opts.head, opts.headNoise || 0.08, opts.headPaint));
    p.push(part('body', [8, 12, 4], [0, 12, 0], [-4, 0, -2], opts.body, 0.1, opts.bodyPaint));
    var aw = opts.armW || 4;
    p.push(part('armR', [aw, 12, aw], [-4 - aw / 2, 22, 0], [-aw / 2, -10, -aw / 2], opts.arm, 0.1, opts.armPaint));
    p.push(part('armL', [aw, 12, aw], [4 + aw / 2, 22, 0], [-aw / 2, -10, -aw / 2], opts.arm, 0.1, opts.armPaint));
    var lw = opts.legW || 4;
    p.push(part('legR', [lw, 12, lw], [-2, 12, 0], [-lw / 2, -12, -lw / 2], opts.leg, 0.1, opts.legPaint));
    p.push(part('legL', [lw, 12, lw], [2, 12, 0], [-lw / 2, -12, -lw / 2], opts.leg, 0.1, opts.legPaint));
    return p;
  }

  function build() {
    // ---- Странник (игрок) ---------------------------------------------------------
    MODELS.player = { parts: humanoid({
      head: SKIN,
      headPaint: function (f, x, y) {
        if (y <= 2) return y === 2 ? [230, 230, 222] : HAT;                         // вязаная шапка с отворотом
        if (f === 'top') return (x + y) % 3 === 0 ? [80, 130, 160] : HAT;
        if (f === 'front') {
          if (y === 3) return HAIR;
          if (y === 4 && (x === 1 || x === 2 || x === 5 || x === 6)) return [60, 40, 26];     // брови
          if (y === 5 && (x === 2 || x === 5)) return [40, 60, 90];                         // глаза
          if (y === 5 && (x === 1 || x === 6)) return [240, 240, 236];
          if (y === 7 && x >= 3 && x <= 4) return [170, 110, 90];
          return null;
        }
        if (f === 'back' || f === 'left' || f === 'right') return y <= 5 ? HAIR : null;
        return null;
      },
      body: JACKET,
      bodyPaint: function (f, x, y) {
        if (y <= 2 && f !== 'bottom') return SCARF;
        if (f === 'front' && y === 3 && x >= 5 && x <= 6) return SCARF;                   // конец шарфа
        if (f === 'front' && y === 4 && x === 6) return SCARF;
        if (f === 'front' && x === 3 && (y === 5 || y === 8)) return [200, 180, 120];     // пуговицы
        if (y === 10) return [70, 50, 32];                                                  // ремень
        return null;
      },
      arm: JACKET,
      armPaint: function (f, x, y, w, h) { return y >= h - 3 ? SKIN : null; },
      leg: PANTS,
      legPaint: function (f, x, y, w, h) { return y >= h - 3 ? BOOTS : null; }
    }) };

    // ---- Упырь ---------------------------------------------------------------------
    var ASH = [150, 138, 160], CLOAK = [52, 46, 56];
    MODELS.upyr = { parts: humanoid({
      head: ASH, headNoise: 0.12,
      headPaint: function (f, x, y, w) {
        if (f === 'top' || f === 'back') return CLOAK;                                    // капюшон
        if (f === 'left' || f === 'right') return y <= 6 || x >= 3 ? CLOAK : null;
        if (f === 'front') {
          if (y <= 1 || x === 0 || x === w - 1) return CLOAK;
          if (y === 3 && (x === 2 || x === 5)) return [255, 60, 40];                       // горящие глаза
          if (y === 3 && (x === 1 || x === 6)) return [110, 90, 120];
          if (y === 6 && x >= 2 && x <= 5) return [40, 26, 34];                             // рот
          return null;
        }
        return null;
      },
      body: CLOAK,
      bodyPaint: function (f, x, y, w, h) {
        if (y === 7) return [124, 98, 60];                                                  // верёвочный пояс
        if (y >= h - 2 && (x % 3 === 0)) return [34, 30, 38];                               // рваный край
        return null;
      },
      arm: ASH, armW: 3,
      armPaint: function (f, x, y, w, h) { if (y <= 4) return CLOAK; if (y >= h - 1) return [120, 108, 130]; return null; },
      leg: [70, 60, 58],
      legPaint: function (f, x, y, w, h) { return y >= h - 2 ? ASH : null; }
    }) };

    // ---- Костяной лучник --------------------------------------------------------
    var BONE = [222, 214, 196], RUST = [132, 76, 42];
    var archer = humanoid({
      head: BONE,
      headPaint: function (f, x, y) {
        if (y <= 1 || f === 'top') return (x + y) % 2 ? RUST : [150, 90, 50];            // ржавый шлем
        if (f === 'front') {
          if ((y === 3 || y === 4) && (x === 1 || x === 2 || x === 5 || x === 6)) return [30, 26, 24];   // глазницы
          if (y === 5 && (x === 3 || x === 4)) return [60, 54, 50];                         // нос
          if (y === 6 && x >= 1 && x <= 6) return x % 2 ? [40, 36, 32] : BONE;             // зубы
        }
        return null;
      },
      body: [40, 36, 34],
      bodyPaint: function (f, x, y) {
        if ((f === 'front' || f === 'back') && x === Math.floor(y * 0.6) + 1) return [176, 40, 36];   // кушак
        if ((f === 'front' || f === 'back') && y % 3 === 1 && x > 0 && x < 7) return BONE;  // рёбра
        if (x === 3 || x === 4) return BONE;                                                // позвоночник
        return null;
      },
      arm: BONE, armW: 2, leg: BONE, legW: 2
    });
    archer.push(part('bow', [1, 14, 2], [5, 18, -3], [0, -7, -1], [110, 76, 40], 0.1));
    MODELS.archer = { parts: archer };

    // ---- Свинья ---------------------------------------------------------------------
    var PINK = [234, 168, 160];
    MODELS.pig = { parts: [
      part('body', [10, 8, 14], [0, 10, 0], [-5, -4, -7], PINK, 0.08, function (f, x, y) {
        if ((f === 'left' || f === 'right' || f === 'top') && ((x * 7 + y * 3) % 11 === 0)) return [196, 122, 116];   // пятна
        return null;
      }),
      part('head', [8, 7, 6], [0, 11, -7], [-4, -4, -6], PINK, 0.06, function (f, x, y) {
        if (f === 'front' && y === 2 && (x === 1 || x === 6)) return [30, 22, 22];
        if (f === 'front' && y === 2 && (x === 2 || x === 5)) return [250, 250, 246];
        return null;
      }),
      part('snout', [4, 3, 1], [0, 9, -13], [-2, -2, -1], [222, 130, 126], 0.04, function (f, x, y) {
        return f === 'front' && y === 1 && (x === 0 || x === 3) ? [120, 60, 60] : null;
      }),
      part('earR', [2, 2, 1], [-3, 14, -9], [-1, 0, 0], [206, 132, 126], 0.05),
      part('earL', [2, 2, 1], [3, 14, -9], [-1, 0, 0], [206, 132, 126], 0.05),
      part('legFR', [3, 6, 3], [-3, 6, -4], [-1.5, -6, -1.5], PINK, 0.08, hoof),
      part('legFL', [3, 6, 3], [3, 6, -4], [-1.5, -6, -1.5], PINK, 0.08, hoof),
      part('legBR', [3, 6, 3], [-3, 6, 5], [-1.5, -6, -1.5], PINK, 0.08, hoof),
      part('legBL', [3, 6, 3], [3, 6, 5], [-1.5, -6, -1.5], PINK, 0.08, hoof)
    ] };
    function hoof(f, x, y, w, h) { return y >= h - 1 ? [120, 80, 70] : null; }

    // ---- Бурёнка ----------------------------------------------------------------
    var BROWN = [150, 84, 48], CREAM = [234, 220, 192];
    MODELS.cow = { parts: [
      part('body', [12, 10, 16], [0, 17, 0], [-6, -5, -8], BROWN, 0.1, function (f, x, y) {
        if ((f === 'left' || f === 'right') && Math.abs(x - 8) + Math.abs(y - 5) < 4) return CREAM;   // светлое пятно
        if (f === 'top' && Math.abs(x - 6) + Math.abs(y - 10) < 3) return CREAM;
        return null;
      }),
      part('udder', [4, 2, 5], [0, 12, 3], [-2, -2, -2.5], [236, 166, 160], 0.05),
      part('head', [8, 8, 6], [0, 20, -8], [-4, -4, -6], CREAM, 0.06, function (f, x, y) {
        if (f === 'top' || f === 'back' || y <= 1) return BROWN;
        if ((f === 'left' || f === 'right') && y <= 4) return BROWN;
        if (f === 'front' && y === 3 && (x === 1 || x === 6)) return [30, 20, 16];
        return null;
      }),
      part('muzzle', [6, 3, 1], [0, 17, -14], [-3, -2, -1], [220, 150, 140], 0.04, function (f, x, y) {
        return f === 'front' && y === 1 && (x === 1 || x === 4) ? [110, 60, 56] : null;
      }),
      part('hornR', [1, 3, 1], [-4, 24, -11], [-1, 0, 0], [236, 230, 210], 0.03),
      part('hornL', [1, 3, 1], [4, 24, -11], [0, 0, 0], [236, 230, 210], 0.03),
      part('legFR', [4, 12, 4], [-4, 12, -5], [-2, -12, -2], BROWN, 0.1, legCream),
      part('legFL', [4, 12, 4], [4, 12, -5], [-2, -12, -2], BROWN, 0.1, legCream),
      part('legBR', [4, 12, 4], [-4, 12, 6], [-2, -12, -2], BROWN, 0.1, legCream),
      part('legBL', [4, 12, 4], [4, 12, 6], [-2, -12, -2], BROWN, 0.1, legCream)
    ] };
    function legCream(f, x, y, w, h) { return y >= h - 2 ? [70, 50, 36] : (y >= h - 5 ? CREAM : null); }

    // ---- Овца ----------------------------------------------------------------------
    var WOOL = [236, 230, 214], FACE = [70, 62, 58];
    var woolPaint = function () { var r = rnd(); return r < 0.2 ? [214, 208, 190] : r < 0.3 ? [248, 246, 236] : null; };
    MODELS.sheep = { parts: [
      part('wool', [12, 10, 16], [0, 15, 0], [-6, -5, -8], WOOL, 0.04, woolPaint),
      part('skin', [9, 7, 13], [0, 15, 0], [-4.5, -3.5, -6.5], [206, 176, 164], 0.06),
      part('head', [6, 6, 7], [0, 18, -8], [-3, -3, -7], FACE, 0.06, function (f, x, y) {
        if (f === 'top' || (f !== 'front' && y <= 1)) return WOOL;
        if (f === 'front' && y === 2 && (x === 1 || x === 4)) return [240, 240, 234];
        if (f === 'front' && y === 2 && (x === 2 || x === 3)) return null;
        return null;
      }),
      part('earR', [3, 1, 2], [-3, 19, -9], [-3, 0, -1], FACE, 0.05),
      part('earL', [3, 1, 2], [3, 19, -9], [0, 0, -1], FACE, 0.05),
      part('legFR', [3, 10, 3], [-3, 10, -5], [-1.5, -10, -1.5], FACE, 0.08, woolLeg),
      part('legFL', [3, 10, 3], [3, 10, -5], [-1.5, -10, -1.5], FACE, 0.08, woolLeg),
      part('legBR', [3, 10, 3], [-3, 10, 6], [-1.5, -10, -1.5], FACE, 0.08, woolLeg),
      part('legBL', [3, 10, 3], [3, 10, 6], [-1.5, -10, -1.5], FACE, 0.08, woolLeg)
    ] };
    function woolLeg(f, x, y) { return y <= 3 ? WOOL : null; }

    // ---- Курица ------------------------------------------------------------------
    var WHITE = [242, 240, 234], ORANGE = [236, 158, 40];
    MODELS.chicken = { parts: [
      part('body', [6, 6, 8], [0, 7, 0], [-3, -3, -4], WHITE, 0.06),
      part('tail', [4, 4, 2], [0, 9, 4], [-2, -1, 0], [226, 224, 216], 0.06),
      part('head', [4, 5, 3], [0, 10, -3], [-2, 0, -3], WHITE, 0.05, function (f, x, y) {
        return f === 'front' && y === 1 && (x === 0 || x === 3) ? [20, 20, 20] : null;
      }),
      part('comb', [2, 2, 2], [0, 15, -4], [-1, 0, -1], [210, 36, 36], 0.05),
      part('beak', [2, 2, 2], [0, 12, -6], [-1, -1, -2], ORANGE, 0.05),
      part('wattle', [2, 2, 1], [0, 11, -6], [-1, -2, -1], [196, 30, 30], 0.05),
      part('wingR', [1, 4, 6], [-3, 9, 0], [-1, -4, -3], [230, 228, 220], 0.06),
      part('wingL', [1, 4, 6], [3, 9, 0], [0, -4, -3], [230, 228, 220], 0.06),
      part('legR', [1, 4, 1], [-1.5, 4, 1], [-0.5, -4, -0.5], ORANGE, 0.05),
      part('legL', [1, 4, 1], [1.5, 4, 1], [-0.5, -4, -0.5], ORANGE, 0.05)
    ] };

    // ---- Лесной паук -------------------------------------------------------------
    var MOSS = [66, 74, 44], STRIPE = [206, 172, 52];
    var spider = [
      part('abdomen', [10, 8, 12], [0, 9, 6], [-5, -4, 0], MOSS, 0.12, function (f, x, y) {
        if (f === 'top' && (y % 4 === 1)) return STRIPE;
        if ((f === 'left' || f === 'right') && y === 2) return STRIPE;
        return null;
      }),
      part('thorax', [6, 6, 6], [0, 9, 0], [-3, -3, -3], [48, 52, 34], 0.1),
      part('head', [8, 6, 6], [0, 9, -3], [-4, -3, -6], [44, 48, 30], 0.1, function (f, x, y) {
        if (f === 'front' && y === 1 && (x === 1 || x === 3 || x === 4 || x === 6)) return [255, 184, 40];   // 4 янтарных глаза
        if (f === 'front' && y === 5 && (x === 2 || x === 5)) return [220, 210, 180];                         // хелицеры
        return null;
      })
    ];
    for (var li = 0; li < 4; li++) {
      var lz = -2 + li * 1.6;
      spider.push(part('legR' + li, [14, 2, 2], [-3, 9, lz], [-14, -1, -1], [40, 42, 28], 0.1));
      spider.push(part('legL' + li, [14, 2, 2], [3, 9, lz], [0, -1, -1], [40, 42, 28], 0.1));
    }
    MODELS.spider = { parts: spider };

    // ---- Заражённые (режим зомби-апокалипсиса) ----------------------------------
    var SICK = [186, 176, 138], SHIRT = [228, 224, 212], STAIN = [118, 40, 30];
    function sickFace(f, x, y) {
      if (f === 'top' || ((f === 'back' || f === 'left' || f === 'right') && y <= 2)) return (x * 3 + y) % 4 === 0 ? [40, 32, 26] : [60, 48, 36];
      if (f === 'front') {
        if (y <= 1) return [60, 48, 36];
        if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return x === 2 || x === 5 ? [160, 20, 20] : [90, 70, 60];
        if (y === 4 && (x === 1 || x === 6)) return [120, 96, 80];
        if (y === 6 && x >= 2 && x <= 5) return x % 2 ? [40, 20, 20] : [200, 190, 160];
      }
      return null;
    }
    MODELS.infected = { parts: humanoid({
      head: SICK, headNoise: 0.12, headPaint: sickFace,
      body: SHIRT,
      bodyPaint: function (f, x, y) {
        if (f === 'front' && (x === 3 || x === 4) && y >= 1 && y <= 7) return [70, 34, 80];            // галстук
        if ((x * 5 + y * 3) % 13 === 0 || (f === 'front' && y > 8 && x < 3)) return STAIN;
        if (y >= 11 && x % 3 === 0) return [0, 0, 0, 0];                                             // рваный низ
        return null;
      },
      arm: SICK, armPaint: function (f, x, y) { return y <= 3 ? SHIRT : (y === 4 && x % 2 ? STAIN : null); },
      leg: [54, 54, 60], legPaint: function (f, x, y, w, h) { return y >= h - 2 ? (x % 2 ? [40, 34, 30] : SICK) : null; }
    }) };
    var HOOD = [214, 110, 40];
    MODELS.runner = { parts: humanoid({
      head: [176, 168, 136], headNoise: 0.12,
      headPaint: function (f, x, y, w) {
        if (f === 'top' || f === 'back') return HOOD;
        if ((f === 'left' || f === 'right') && (y <= 5 || x >= 4)) return HOOD;
        if (f === 'front' && (y === 0 || x === 0 || x === w - 1)) return HOOD;
        return sickFace(f, x, y);
      },
      body: HOOD, bodyPaint: function (f, x, y) { if (f === 'front' && y >= 6 && y <= 8 && x >= 2 && x <= 5) return [180, 90, 30]; if ((x + y * 7) % 11 === 0) return STAIN; return null; },
      arm: HOOD, armW: 3, armPaint: function (f, x, y, w, h) { return y >= h - 2 ? [176, 168, 136] : null; },
      leg: [110, 110, 118], legW: 3, legPaint: function (f, x, y, w, h) { return y >= h - 2 ? [230, 230, 230] : null; }
    }) };
    var VEST = [242, 120, 30];
    MODELS.brute = { parts: humanoid({
      head: [170, 160, 126], headNoise: 0.1,
      headPaint: function (f, x, y) {
        if (f === 'top' || y <= 1) return [238, 190, 40];                                          // каска
        if (f === 'front' && y === 2) return [210, 160, 30];
        if (f === 'front' && y === 5 && x >= 1 && x <= 3) return x % 2 ? [60, 30, 30] : [200, 170, 150];   // шов
        return sickFace(f, x, y);
      },
      body: VEST, bodyPaint: function (f, x, y) { if (y === 5 || y === 9) return [226, 226, 214]; if (f === 'front' && (x === 3 || x === 4)) return [60, 60, 70]; return null; },
      arm: [170, 160, 126], armW: 5, armPaint: function (f, x, y) { return y <= 2 ? [60, 60, 70] : null; },
      leg: [84, 72, 56], legW: 4, legPaint: function (f, x, y, w, h) { return y >= h - 3 ? [50, 40, 30] : null; }
    }) };

    // ---- Особые места города: пациент, полицейский, слепой, выживший ----------------
    var PALE = [196, 190, 160], GOWN = [228, 232, 230];
    MODELS.patient = { parts: humanoid({
      head: PALE, headNoise: 0.12,
      headPaint: function (f, x, y) {
        if (y === 2 || y === 3) return (x + y) % 4 === 0 ? [210, 206, 196] : [244, 244, 240];     // бинт на голове
        return sickFace(f, x, y);
      },
      body: GOWN, bodyPaint: function (f, x, y) {
        if ((x + y * 2) % 5 === 0) return [150, 176, 190];                                         // горошек на халате
        if ((x * 7 + y) % 17 === 0) return STAIN;
        return null;
      },
      arm: PALE, armPaint: function (f, x, y) { return y <= 4 ? GOWN : (f === 'front' && y === 6 ? [200, 60, 60] : null); },
      leg: PALE, legPaint: function (f, x, y) { return y <= 2 ? GOWN : null; }
    }) };
    var NAVY = [34, 44, 74];
    MODELS.cop = { parts: humanoid({
      head: [30, 32, 38], headNoise: 0.06,
      headPaint: function (f, x, y) {
        if (f === 'front' && y >= 2 && y <= 4 && x >= 1 && x <= 6) return y === 2 ? [90, 120, 150] : [40, 60, 90];   // забрало
        if (f === 'front' && y >= 5) return y === 6 && x >= 2 && x <= 5 ? [40, 20, 20] : SICK;
        return null;
      },
      body: NAVY, bodyPaint: function (f, x, y) {
        if (y === 4 || y === 5) return [220, 210, 70];                                             // светоотражающая полоса
        if (y === 10) return [20, 20, 22];                                                         // ремень
        if (f === 'front' && x === 5 && y === 2) return [200, 170, 60];                             // жетон
        return null;
      },
      arm: NAVY, armPaint: function (f, x, y, w, h) { return y >= h - 2 ? SICK : null; },
      leg: NAVY, legPaint: function (f, x, y, w, h) { return y >= h - 3 ? [22, 22, 24] : null; }
    }) };
    var GHOST = [214, 210, 200];
    MODELS.blind = { parts: humanoid({
      head: GHOST, headNoise: 0.1,
      headPaint: function (f, x, y) {
        if (f === 'top' || y <= 1) return (x * 3 + y) % 5 === 0 ? [150, 146, 140] : null;
        if (f === 'front' && y === 3 && x >= 1 && x <= 6) return [34, 28, 26];                       // пустые глазницы
        if (f === 'front' && y === 6 && x >= 1 && x <= 6) return x % 2 ? [30, 20, 20] : [230, 226, 210];
        if ((x + y) % 6 === 0) return [170, 176, 190];                                             // прожилки
        return null;
      },
      body: [64, 66, 72], bodyPaint: function (f, x, y) { if (y >= 10 && x % 2) return [0, 0, 0, 0]; if ((x * 3 + y) % 9 === 0) return [44, 46, 50]; return null; },
      arm: GHOST, armW: 3, armPaint: function (f, x, y) { return y <= 2 ? [64, 66, 72] : null; },
      leg: [64, 66, 72], legW: 3, legPaint: function (f, x, y, w, h) { return y >= h - 2 ? GHOST : null; }
    }) };
    var PLAID = function (f, x, y) { return (x % 4 < 2) !== (y % 4 < 2) ? [150, 34, 30] : [36, 30, 30]; };
    MODELS.survivor = { parts: humanoid({
      head: SKIN,
      headPaint: function (f, x, y) {
        if (y <= 1 || f === 'top') return [70, 90, 60];                                           // кепка
        if (f === 'front' && y === 2) return [60, 80, 52];
        if (f === 'front' && y === 4 && (x === 2 || x === 5)) return [40, 60, 80];
        if (f === 'front' && y === 6 && x >= 3 && x <= 4) return [150, 90, 80];
        if (f !== 'front' && y <= 4) return HAIR;
        return null;
      },
      body: [150, 34, 30], bodyPaint: PLAID,
      arm: [150, 34, 30], armPaint: function (f, x, y, w, h) { return y >= h - 3 ? SKIN : PLAID(f, x, y); },
      leg: [150, 136, 96], legPaint: function (f, x, y, w, h) { return y >= h - 2 ? [70, 50, 34] : null; }
    }) };

    // ---- Вертолёт эвакуации ----------------------------------------------------------
    var HULLC = [56, 70, 86], STRIPE = [236, 196, 40];
    MODELS.helicopter = { parts: [
      part('body', [28, 22, 44], [0, 8, 0], [-14, 0, -24], HULLC, 0.05, function (f, x, y, w, h) {
        if ((f === 'left' || f === 'right') && y >= 4 && y <= 10 && x >= 4 && x <= 20) return [60, 110, 150];            // окна
        if ((f === 'left' || f === 'right') && y === 14) return STRIPE;
        if (f === 'front' && y >= 3 && y <= 12 && x >= 3 && x <= w - 4) return [70, 130, 170];                        // лобовое стекло
        return null;
      }),
      part('boom', [6, 6, 44], [0, 20, 20], [-3, 0, 0], HULLC, 0.05, function (f, x, y) { return y === 3 ? STRIPE : null; }),
      part('fin', [2, 14, 8], [0, 22, 58], [-1, 0, 0], HULLC, 0.05),
      part('mast', [4, 4, 4], [0, 30, 0], [-2, 0, -2], [40, 40, 44], 0.05),
      part('rotorA', [140, 1, 5], [0, 34, 0], [-70, 0, -2.5], [30, 30, 34], 0.05),
      part('rotorB', [5, 1, 140], [0, 34, 0], [-2.5, 0, -70], [30, 30, 34], 0.05),
      part('tailRotor', [1, 16, 3], [2, 30, 62], [0, -8, -1.5], [30, 30, 34], 0.05),
      part('skidR', [2, 2, 48], [-11, 0, 0], [-1, 0, -24], [40, 40, 44], 0.05),
      part('skidL', [2, 2, 48], [11, 0, 0], [-1, 0, -24], [40, 40, 44], 0.05),
      part('strutR', [2, 8, 2], [-11, 2, -10], [-1, 0, -1], [40, 40, 44], 0.05),
      part('strutL', [2, 8, 2], [11, 2, -10], [-1, 0, -1], [40, 40, 44], 0.05),
      part('strutR2', [2, 8, 2], [-11, 2, 12], [-1, 0, -1], [40, 40, 44], 0.05),
      part('strutL2', [2, 8, 2], [11, 2, 12], [-1, 0, -1], [40, 40, 44], 0.05)
    ] };

    // ---- Заражённый военный ---------------------------------------------------------
    var CAMO = function (f, x, y) { var h = (x * 7 + y * 13 + (f.length * 3)) % 9; return h < 3 ? [70, 86, 50] : h < 5 ? [104, 92, 60] : h < 6 ? [44, 50, 34] : null; };
    MODELS.soldier = { parts: humanoid({
      head: SICK, headNoise: 0.1,
      headPaint: function (f, x, y) {
        if (y <= 2 || f === 'top') return (x + y) % 4 === 0 ? [60, 74, 44] : [80, 96, 58];          // каска
        if (f === 'front' && y === 3) return [60, 74, 44];
        return sickFace(f, x, y);
      },
      body: [82, 96, 58], bodyPaint: function (f, x, y) {
        if (y >= 2 && y <= 8 && x >= 1 && x <= 6) return (x + y) % 5 === 0 ? [40, 44, 36] : [54, 60, 46];    // разгрузка
        if ((x * 5 + y * 3) % 17 === 0) return STAIN;
        return CAMO(f, x, y);
      },
      arm: [82, 96, 58], armPaint: function (f, x, y, w, h) { return y >= h - 2 ? SICK : CAMO(f, x, y); },
      leg: [82, 96, 58], legPaint: function (f, x, y, w, h) { return y >= h - 3 ? [36, 32, 28] : CAMO(f, x, y); }
    }) };

    // ---- Техника: единица модели — 1/8 блока (рисуется с масштабом 2) ----------------------
    // Детали «paint…» перекрашиваются в цвет машины, остальные — как есть
    var TIRE = [28, 28, 30], RIM = [150, 152, 158], GLASSC = [70, 110, 140], CHROME = [176, 180, 188];
    function wheel(name, x, y, z, w, d) {
      return part(name, [w, d, d], [x, y, z], [-w / 2, -d / 2, -d / 2], TIRE, 0.1, function (f, px, py, fw, fh) {
        if ((f === 'right' || f === 'left') && Math.abs(px - fw / 2 + 0.5) < fw / 4 && Math.abs(py - fh / 2 + 0.5) < fh / 4) return RIM;
        return (px + py) % 3 === 0 ? [44, 44, 46] : null;
      });
    }
    function glassPaint(f, x, y, w, h) { return (x === 0 || x === w - 1) && (f === 'left' || f === 'right' || f === 'front' || f === 'back') ? [30, 30, 34] : (x + y) % 7 === 0 ? [140, 190, 220] : null; }
    function lampsFront(z, y, half) {
      return [part('lampL', [3, 2, 1], [-half + 2, y, z], [-1.5, 0, -0.5], [255, 244, 190], 0.02), part('lampR', [3, 2, 1], [half - 2, y, z], [-1.5, 0, -0.5], [255, 244, 190], 0.02)];
    }
    function lampsBack(z, y, half) {
      return [part('tailL', [3, 2, 1], [-half + 2, y, z], [-1.5, 0, -0.5], [210, 30, 30], 0.02), part('tailR', [3, 2, 1], [half - 2, y, z], [-1.5, 0, -0.5], [210, 30, 30], 0.02)];
    }
    function sedanParts(bodyColor, bodyPaint) {
      return [
        part('paintBody', [16, 5, 34], [0, 2, 0], [-8, 0, -17], bodyColor, 0.03, bodyPaint),
        part('paintRoof', [14, 1, 14], [0, 11, 1], [-7, 0, -7], bodyColor, 0.03),
        part('glass', [14, 4, 16], [0, 7, 1], [-7, 0, -8], GLASSC, 0.05, glassPaint),
        part('bumperF', [16, 2, 1], [0, 2, -17], [-8, 0, -1], CHROME, 0.04),
        part('bumperB', [16, 2, 1], [0, 2, 17], [-8, 0, 0], CHROME, 0.04),
        wheel('wheelFL', -7.5, 2.5, -10, 3, 5), wheel('wheelFR', 7.5, 2.5, -10, 3, 5),
        wheel('wheelBL', -7.5, 2.5, 11, 3, 5), wheel('wheelBR', 7.5, 2.5, 11, 3, 5)
      ].concat(lampsFront(-17.1, 5, 8), lampsBack(17.1, 5, 8));
    }
    MODELS.sedan = { parts: sedanParts([236, 236, 236]) };
    MODELS.police = { parts: sedanParts([240, 242, 246], function (f, x, y) {
      if ((f === 'left' || f === 'right') && y >= 1 && y <= 2) return [30, 60, 160];                  // синяя полоса
      if (f === 'top' && x >= 3 && x <= 12 && y > 2 && y < 12) return [30, 30, 36];                  // тёмный капот
      return null;
    }).concat([
      part('barR', [5, 1, 2], [-3, 12, 1], [-2.5, 0, -1], [230, 30, 30], 0.02),
      part('barB', [5, 1, 2], [3, 12, 1], [-2.5, 0, -1], [40, 80, 240], 0.02)
    ]) };
    MODELS.pickup = { parts: [
      part('paintBody', [17, 6, 38], [0, 3, 0], [-8.5, 0, -19], [236, 236, 236], 0.03),
      part('paintRoof', [15, 1, 13], [0, 13, -5], [-7.5, 0, -6.5], [236, 236, 236], 0.03),
      part('glass', [15, 4, 14], [0, 9, -5], [-7.5, 0, -7], GLASSC, 0.05, glassPaint),
      part('paintBedL', [1, 3, 17], [-8, 9, 10.5], [0, 0, -8.5], [236, 236, 236], 0.03),
      part('paintBedR', [1, 3, 17], [7, 9, 10.5], [0, 0, -8.5], [236, 236, 236], 0.03),
      part('paintGate', [17, 3, 1], [0, 9, 18.5], [-8.5, 0, 0], [236, 236, 236], 0.03),
      part('bed', [15, 1, 16], [0, 9, 10.5], [-7.5, 0, -8], [60, 56, 50], 0.1),
      part('bumperF', [17, 2, 1], [0, 3, -19], [-8.5, 0, -1], CHROME, 0.04),
      wheel('wheelFL', -8, 3, -11, 3, 6), wheel('wheelFR', 8, 3, -11, 3, 6),
      wheel('wheelBL', -8, 3, 12, 3, 6), wheel('wheelBR', 8, 3, 12, 3, 6)
    ].concat(lampsFront(-19.1, 7, 8.5), lampsBack(19.1, 7, 8.5)) };
    MODELS.bus = { parts: [
      part('body', [22, 22, 80], [0, 3, 0], [-11, 0, -40], [236, 236, 230], 0.03, function (f, x, y, w, h) {
        var side = f === 'left' || f === 'right';
        if (side && y >= 3 && y <= 10 && x % 10 !== 0 && !(f === 'left' && x > 64 && x < 70)) return [44, 64, 84];      // окна
        if (side && (y === 13 || y === 14)) return [40, 90, 190];                                                     // полоса
        if (f === 'front' && y >= 3 && y <= 11 && x > 1 && x < w - 2) return [60, 100, 130];                          // лобовое
        if (f === 'front' && y === 17 && (x < 5 || x > w - 6)) return [255, 244, 190];                                 // фары
        if (f === 'back' && y === 17 && (x < 4 || x > w - 5)) return [210, 30, 30];
        if (f === 'front' && y >= 1 && y <= 2 && x > 5 && x < w - 6) return [255, 170, 40];                            // табло
        return null;
      }),
      part('roof', [20, 2, 76], [0, 25, 0], [-10, 0, -38], [180, 182, 186], 0.05),
      wheel('wheelFL', -10.5, 3.5, -27, 3, 7), wheel('wheelFR', 10.5, 3.5, -27, 3, 7),
      wheel('wheelBL', -10.5, 3.5, 25, 3, 7), wheel('wheelBR', 10.5, 3.5, 25, 3, 7)
    ] };
    MODELS.truck = { parts: [
      part('frame', [18, 3, 56], [0, 4, 0], [-9, 0, -28], [40, 40, 44], 0.1),
      part('paintCab', [22, 14, 14], [0, 6, -21], [-11, 0, -7], [236, 236, 236], 0.03, function (f, x, y, w, h) {
        if (f === 'front' && y >= 1 && y <= 5 && x > 1 && x < w - 2) return [70, 110, 140];
        if ((f === 'left' || f === 'right') && y >= 1 && y <= 5 && x > 2 && x < 10) return [70, 110, 140];
        if (f === 'front' && y === 10 && (x < 4 || x > w - 5)) return [255, 244, 190];
        return null;
      }),
      part('paintBed', [22, 10, 38], [0, 8, 7], [-11, 0, -19], [236, 236, 236], 0.05, function (f, x, y) { return (f === 'left' || f === 'right') && x % 6 === 0 ? [150, 150, 150] : null; }),
      part('load', [20, 1, 36], [0, 18, 7], [-10, 0, -18], [120, 96, 70], 0.2),
      part('grille', [18, 5, 1], [0, 6, -28], [-9, 0, -1], [60, 60, 64], 0.1),
      wheel('wheelFL', -10.5, 4, -21, 4, 8), wheel('wheelFR', 10.5, 4, -21, 4, 8),
      wheel('wheelML', -10.5, 4, 10, 4, 8), wheel('wheelMR', 10.5, 4, 10, 4, 8),
      wheel('wheelBL', -10.5, 4, 20, 4, 8), wheel('wheelBR', 10.5, 4, 20, 4, 8)
    ] };
    function track(name, x, len, hgt) {
      return part(name, [6, hgt, len], [x, 0, 0], [-3, 0, -len / 2], [34, 34, 36], 0.1, function (f, px, py, w, h) {
        if ((f === 'left' || f === 'right') && py > 1 && py < h - 2 && px % 6 >= 2 && px % 6 <= 4) return [70, 70, 74];     // катки
        if (f === 'top' && py % 3 === 0) return [54, 54, 56];                                                             // траки
        return null;
      });
    }
    var DOZER = [236, 186, 30];
    MODELS.dozer = { parts: [
      track('trackL', -9, 34, 7), track('trackR', 9, 34, 7),
      part('body', [16, 8, 26], [0, 7, 3], [-8, 0, -13], DOZER, 0.05, function (f, x, y) { return f === 'front' && y >= 2 && y <= 5 && x % 2 ? [60, 60, 60] : null; }),
      part('cab', [14, 9, 12], [0, 15, 8], [-7, 0, -6], GLASSC, 0.05, glassPaint),
      part('roof', [16, 1, 14], [0, 24, 8], [-8, 0, -7], DOZER, 0.05),
      part('blade', [26, 9, 2], [0, 1, -20], [-13, 0, -1], [120, 124, 130], 0.08, function (f, x, y) { return f === 'front' && y === 0 ? [180, 184, 190] : null; }),
      part('armL', [2, 2, 12], [-7, 5, -13], [-1, 0, -6], [80, 80, 84], 0.05),
      part('armR', [2, 2, 12], [7, 5, -13], [-1, 0, -6], [80, 80, 84], 0.05),
      part('pipe', [2, 6, 2], [5, 15, -6], [-1, 0, -1], [40, 40, 42], 0.05)
    ] };
    var OLIVE = [96, 110, 60];
    MODELS.tank = { parts: [
      track('trackL', -10, 52, 8), track('trackR', 10, 52, 8),
      part('hull', [18, 6, 46], [0, 3, 0], [-9, 0, -23], OLIVE, 0.06),
      part('hullTop', [26, 3, 42], [0, 8, 1], [-13, 0, -21], OLIVE, 0.06, function (f, x, y) { return f === 'top' && (x === 1 || x === 24) ? [70, 80, 44] : null; }),
      part('turret', [16, 7, 18], [0, 11, 2], [-8, 0, -9], OLIVE, 0.06, function (f, x, y) { return f === 'top' && x > 9 && x < 14 && y > 10 && y < 15 ? [70, 80, 44] : null; }),
      part('barrel', [2, 2, 24], [0, 14.5, 2], [-1, -1, -33], [70, 80, 44], 0.06),
      part('hatch', [6, 1, 6], [0, 18, 2], [1, 0, 1], [70, 80, 44], 0.06)
    ] };
    for (var vk in { sedan: 1, pickup: 1, truck: 1 }) {
      var paint = {}, other = {};
      MODELS[vk].parts.forEach(function (p) { if (p.name.indexOf('paint') === 0) paint[p.name] = true; else other[p.name] = true; });
      MODELS[vk].paintSet = paint; MODELS[vk].otherSet = other;
    }

    // ---- Пекло: бес и огненный дух ---------------------------------------------------
    var IMP = [152, 52, 36];
    MODELS.imp = { parts: [
      part('head', [7, 7, 7], [0, 16, 0], [-3.5, 0, -3.5], IMP, 0.1, function (f, x, y) {
        if (f === 'front' && y === 3 && (x === 1 || x === 5)) return [255, 220, 60];
        if (f === 'front' && y === 5 && x >= 2 && x <= 4) return x === 3 ? [255, 240, 220] : [40, 10, 10];
        return null;
      }),
      part('hornR', [1, 3, 1], [-3, 23, -1], [-0.5, 0, -0.5], [230, 220, 190], 0.05),
      part('hornL', [1, 3, 1], [3, 23, -1], [-0.5, 0, -0.5], [230, 220, 190], 0.05),
      part('body', [6, 8, 4], [0, 8, 0], [-3, 0, -2], [130, 40, 30], 0.1),
      part('armR', [2, 8, 2], [-4, 15, 0], [-1, -7, -1], IMP, 0.1),
      part('armL', [2, 8, 2], [4, 15, 0], [-1, -7, -1], IMP, 0.1),
      part('legR', [3, 8, 3], [-1.5, 8, 0], [-1.5, -8, -1.5], [70, 30, 24], 0.1),
      part('legL', [3, 8, 3], [1.5, 8, 0], [-1.5, -8, -1.5], [70, 30, 24], 0.1),
      part('tail', [1, 1, 8], [0, 9, 2], [-0.5, -0.5, 0], [110, 30, 24], 0.1, function (f, x, y, w, h) { return x >= w - 2 || y >= h - 2 ? [60, 10, 10] : null; })
    ] };
    MODELS.wisp = { parts: [
      part('core', [6, 6, 6], [0, 6, 0], [-3, -3, -3], [255, 214, 90], 0.1, function (f, x, y) { return (x + y) % 3 === 0 ? [255, 250, 200] : null; }),
      part('shell', [10, 10, 10], [0, 6, 0], [-5, -5, -5], [240, 110, 30], 0.2, function (f, x, y) {
        var r = rnd();
        return r < 0.55 ? [0, 0, 0, 0] : r < 0.75 ? [255, 170, 50] : [90, 60, 50];
      }),
      part('ember0', [2, 2, 2], [0, 6, 0], [6, -1, -1], [255, 200, 70], 0.1),
      part('ember1', [2, 2, 2], [0, 6, 0], [-8, -1, -1], [255, 150, 40], 0.1),
      part('ember2', [2, 2, 2], [0, 6, 0], [-1, 3, 6], [255, 230, 120], 0.1)
    ] };

    // ---- Небеса: пегас и облачник -------------------------------------------------
    var WHITE_H = [242, 240, 234], MANE = [232, 196, 110];
    MODELS.pegasus = { parts: [
      part('body', [10, 10, 20], [0, 17, 0], [-5, -5, -10], WHITE_H, 0.05),
      part('neck', [4, 10, 5], [0, 20, -9], [-2, 0, -4], WHITE_H, 0.05, function (f, x, y) { return f === 'back' || f === 'top' ? MANE : null; }),
      part('head', [5, 5, 10], [0, 29, -11], [-2.5, -2, -9], WHITE_H, 0.05, function (f, x, y) {
        if ((f === 'left' || f === 'right') && y === 1 && x === 4) return [40, 50, 90];
        if (f === 'front' && y === 3) return [200, 190, 190];
        return null;
      }),
      part('mane', [1, 6, 7], [0, 30, -9], [-0.5, -3, 0], MANE, 0.1),
      part('tail', [2, 12, 2], [0, 19, 10], [-1, -12, -1], MANE, 0.1),
      part('wingR', [16, 1, 10], [-5, 20, -2], [-16, 0, -5], [250, 250, 246], 0.04, function (f, x, y) { return f === 'top' && x % 4 === 0 ? [214, 214, 222] : null; }),
      part('wingL', [16, 1, 10], [5, 20, -2], [0, 0, -5], [250, 250, 246], 0.04, function (f, x, y) { return f === 'top' && x % 4 === 3 ? [214, 214, 222] : null; }),
      part('legFR', [3, 12, 3], [-3, 12, -7], [-1.5, -12, -1.5], WHITE_H, 0.05, goldHoof),
      part('legFL', [3, 12, 3], [3, 12, -7], [-1.5, -12, -1.5], WHITE_H, 0.05, goldHoof),
      part('legBR', [3, 12, 3], [-3, 12, 7], [-1.5, -12, -1.5], WHITE_H, 0.05, goldHoof),
      part('legBL', [3, 12, 3], [3, 12, 7], [-1.5, -12, -1.5], WHITE_H, 0.05, goldHoof)
    ] };
    function goldHoof(f, x, y, w, h) { return y >= h - 2 ? [236, 190, 60] : null; }
    MODELS.pegasus.byNameParents = { mane: 'head' };
    MODELS.cloudling = { parts: [
      part('body', [8, 6, 8], [0, 6, 0], [-4, -3, -4], [248, 250, 255], 0.03, function (f, x, y) {
        if (f === 'front' && y === 2 && (x === 2 || x === 5)) return [40, 50, 80];
        if (f === 'front' && y === 3 && (x === 1 || x === 6)) return [250, 180, 200];
        if (f === 'front' && y === 4 && (x === 3 || x === 4)) return [60, 70, 100];
        return null;
      }),
      part('puffA', [5, 4, 5], [0, 6, 0], [-7, -1, -2], [236, 240, 250], 0.03),
      part('puffB', [5, 4, 5], [0, 6, 0], [2, -1, -2], [236, 240, 250], 0.03),
      part('puffC', [6, 3, 6], [0, 6, 0], [-3, 3, -3], [240, 244, 252], 0.03)
    ] };

    // ---- Станция: сбойный дрон и робот-уборщик ----------------------------------------
    var METAL = [72, 78, 88];
    MODELS.drone = { parts: [
      part('body', [8, 6, 8], [0, 6, 0], [-4, -3, -4], METAL, 0.06, function (f, x, y) {
        if (f === 'front' && y >= 2 && y <= 3 && x >= 3 && x <= 4) return [255, 40, 40];
        if (f === 'front' && y === 1) return [40, 44, 50];
        if (f === 'top' && (x === 0 || x === 7 || y === 0 || y === 7)) return [230, 180, 40];
        return null;
      }),
      part('rotor0', [5, 1, 5], [6, 9, 6], [-2.5, 0, -2.5], [200, 206, 214], 0.05),
      part('rotor1', [5, 1, 5], [-6, 9, 6], [-2.5, 0, -2.5], [200, 206, 214], 0.05),
      part('rotor2', [5, 1, 5], [6, 9, -6], [-2.5, 0, -2.5], [200, 206, 214], 0.05),
      part('rotor3', [5, 1, 5], [-6, 9, -6], [-2.5, 0, -2.5], [200, 206, 214], 0.05),
      part('armA', [14, 1, 1], [0, 8, 0], [-7, 0, -0.5], [50, 54, 60], 0.05),
      part('armB', [1, 1, 14], [0, 8, 0], [-0.5, 0, -7], [50, 54, 60], 0.05)
    ] };
    MODELS.robot = { parts: [
      part('body', [8, 6, 10], [0, 3, 0], [-4, 0, -5], [230, 236, 238], 0.05, function (f, x, y) {
        if (f === 'front' && y >= 1 && y <= 2 && x >= 1 && x <= 6) return [40, 190, 190];
        if (y === 5) return [60, 170, 170];
        return null;
      }),
      part('antenna', [1, 4, 1], [0, 9, 3], [-0.5, 0, -0.5], [120, 126, 136], 0.05),
      part('light', [2, 1, 2], [0, 13, 3], [-1, 0, -1], [255, 200, 40], 0.05),
      part('wheelR', [1, 3, 3], [-4.5, 1.5, -3], [-0.5, -1.5, -1.5], [40, 40, 44], 0.1),
      part('wheelL', [1, 3, 3], [4.5, 1.5, -3], [-0.5, -1.5, -1.5], [40, 40, 44], 0.1),
      part('wheelR2', [1, 3, 3], [-4.5, 1.5, 3], [-0.5, -1.5, -1.5], [40, 40, 44], 0.1),
      part('wheelL2', [1, 3, 3], [4.5, 1.5, 3], [-0.5, -1.5, -1.5], [40, 40, 44], 0.1)
    ] };
  }

  function init() {
    cv = document.createElement('canvas');
    cv.width = cv.height = ATLAS;
    ctx = cv.getContext('2d');
    img = ctx.createImageData(ATLAS, ATLAS);
    data = img.data;
    build();
    ctx.putImageData(img, 0, 0);
    data = null;
    for (var name in MODELS) {
      var byName = {};
      MODELS[name].parts.forEach(function (p) { byName[p.name] = p; });
      MODELS[name].byName = byName;
    }
    return cv;
  }

  // ---- Отрисовка ------------------------------------------------------------------
  // Грани коробки: 0 +X, 1 −X, 2 +Y, 3 −Y, 4 +Z, 5 −Z (как в мешере)
  var BOXF = [
    { na: 0, ns: 1, ua: 2, us: -1, va: 1, vs: 1, shade: 0.72 },
    { na: 0, ns: -1, ua: 2, us: 1, va: 1, vs: 1, shade: 0.72 },
    { na: 1, ns: 1, ua: 2, us: 1, va: 0, vs: 1, shade: 1.0 },
    { na: 1, ns: -1, ua: 0, us: 1, va: 2, vs: 1, shade: 0.5 },
    { na: 2, ns: 1, ua: 0, us: 1, va: 1, vs: 1, shade: 0.86 },
    { na: 2, ns: -1, ua: 0, us: -1, va: 1, vs: 1, shade: 0.86 }
  ];
  var CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

  // Матрица 3×3 (строки) из углов поворота: Ry(yaw)·Rx(pitch)·Rz(roll)
  function rot(yaw, pitch, roll) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    // Rx·Rz
    var a = [cr, -sr, 0, cp * sr, cp * cr, -sp, sp * sr, sp * cr, cp];
    // Ry·(Rx·Rz)
    return [
      cy * a[0] + sy * a[6], cy * a[1] + sy * a[7], cy * a[2] + sy * a[8],
      a[3], a[4], a[5],
      -sy * a[0] + cy * a[6], -sy * a[1] + cy * a[7], -sy * a[2] + cy * a[8]
    ];
  }
  function apply(m, v) {
    return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  }
  function mulm(a, b) {
    var o = [];
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    return o;
  }

  function Batch(q) { this.data = new Float32Array(q * 32); this.n = 0; this.quads = 0; }
  Batch.prototype.reset = function () { this.n = 0; this.quads = 0; };
  Batch.prototype.reserve = function (q) {
    var need = this.n + q * 32;
    if (need <= this.data.length) return;
    var nd = new Float32Array(Math.max(need, this.data.length * 2));
    nd.set(this.data.subarray(0, this.n));
    this.data = nd;
  };
  Batch.prototype.v = function (x, y, z, u, v, r, g, b) {
    var d = this.data, n = this.n;
    d[n] = x; d[n + 1] = y; d[n + 2] = z; d[n + 3] = u; d[n + 4] = v; d[n + 5] = r; d[n + 6] = g; d[n + 7] = b;
    this.n = n + 8;
  };
  Batch.prototype.view = function () { return { data: this.data.subarray(0, this.n), quads: this.quads }; };

  // Свет грани модели: рассеянный (сверху ярче, снизу темнее) + прямое солнце по нормали.
  // light — [r,g,b] небо и факелы в точке, sunK — доля солнца (0 в тени), tint — оттенок (ранение, краска)
  var shadeOut = [0, 0, 0];
  function faceLight(wn, light, sunK, tint) {
    var Lg = KC.Light, amb = 0.75 + 0.25 * wn[1] - 0.05 * Math.abs(wn[0]);
    var ndl = 0;
    if (sunK > 0) { var sd = Lg.sunDir; ndl = Math.max(0, wn[0] * sd[0] + wn[1] * sd[1] + wn[2] * sd[2]) * sunK; }
    var sc = Lg.sunCol, br = Lg.bright || 0;
    for (var i = 0; i < 3; i++) {
      var v = light[i] * amb + sc[i] * ndl;
      if (br && v < 1) v += (Math.sqrt(v) - v) * br;
      shadeOut[i] = tint ? v * tint[i] : v;
    }
    return shadeOut;
  }

  // Рисует модель в батч. pose: { part: [yaw, pitch, roll] }, hidden: { part: true }
  // origin — мировая позиция ног, yaw — поворот тела, scale — размер (1 взрослый), color — [r,g,b] свет в точке
  function drawModel(batch, name, origin, yaw, scale, pose, hidden, color, bodyRoll, sunK, tint, glow) {
    var model = MODELS[name];
    if (!model) return;
    var s = scale / 16;
    var body = rot(yaw, 0, bodyRoll || 0);
    batch.reserve(model.parts.length * 6);
    for (var i = 0; i < model.parts.length; i++) {
      var p = model.parts[i];
      if (hidden && hidden[p.name]) continue;
      var pr = pose && pose[p.name];
      var m = pr ? mulm(body, rot(pr[0], pr[1], pr[2] || 0)) : body;
      var piv = apply(body, p.pivot);
      var x0 = p.from[0], y0 = p.from[1], z0 = p.from[2];
      var box = [x0, y0, z0, x0 + p.size[0], y0 + p.size[1], z0 + p.size[2]];
      for (var f = 0; f < 6; f++) {
        var F = BOXF[f], rect = p.faces[f];
        var nrm = [0, 0, 0]; nrm[F.na] = F.ns;
        var wn = apply(m, nrm);
        var fc = faceLight(wn, color, sunK || 0, tint), cr = fc[0], cg = fc[1], cb = fc[2];
        // светящиеся детали (фары, мигалка) не зависят от освещения
        if (glow && glow[p.name]) { cr = cg = cb = glow[p.name]; }
        for (var k = 0; k < 4; k++) {
          var ci = CORNERS[k][0], cj = CORNERS[k][1];
          var pt = [0, 0, 0];
          pt[F.na] = F.ns > 0 ? box[F.na + 3] : box[F.na];
          pt[F.ua] = ((F.us > 0) === (ci === 1)) ? box[F.ua + 3] : box[F.ua];
          pt[F.va] = ((F.vs > 0) === (cj === 1)) ? box[F.va + 3] : box[F.va];
          var w = apply(m, pt);
          var u = (rect.x + (ci ? rect.w : 0)) / ATLAS, v = (rect.y + (cj ? 0 : rect.h)) / ATLAS;
          // сдвигаем UV на волосок внутрь, чтобы не цеплять соседнюю грань
          u += ci ? -0.0005 : 0.0005; v += cj ? 0.0005 : -0.0005;
          batch.v(origin[0] + (piv[0] + w[0]) * s, origin[1] + (piv[1] + w[1]) * s, origin[2] + (piv[2] + w[2]) * s,
            u, v, cr, cg, cb);
        }
        batch.quads++;
      }
    }
  }

  // Коробка «как блок» с текстурами атласа блоков (для предметов на земле, падающего песка, динамита)
  function drawBlockCube(batch, id, meta, cx, cy, cz, size, yaw, color, sunK) {
    var b = KC.BLOCKS[id];
    var tl = b.tiles, tiles = [tl.side, tl.side, tl.top, tl.bottom, tl.side, tl.front !== undefined ? tl.front : tl.side];
    var m = rot(yaw, 0, 0), h = size / 2;
    batch.reserve(6);
    for (var f = 0; f < 6; f++) {
      var F = BOXF[f], uv = KC.tileUV(tiles[f]);
      var nrm = [0, 0, 0]; nrm[F.na] = F.ns;
      var fc = faceLight(apply(m, nrm), color, sunK || 0, null), cr = fc[0], cg = fc[1], cb = fc[2];
      for (var k = 0; k < 4; k++) {
        var ci = CORNERS[k][0], cj = CORNERS[k][1];
        var pt = [0, 0, 0];
        pt[F.na] = F.ns * h;
        pt[F.ua] = ((F.us > 0) === (ci === 1)) ? h : -h;
        pt[F.va] = ((F.vs > 0) === (cj === 1)) ? h : -h;
        var w = apply(m, pt);
        batch.v(cx + w[0], cy + w[1], cz + w[2], ci ? uv[2] : uv[0], cj ? uv[1] : uv[3], cr, cg, cb);
      }
      batch.quads++;
    }
  }

  // ---- Объёмные предметы: спрайт «выдавлен» на толщину пикселя ----------------------------------
  // Лицо и изнанка — вся плитка с вырезанием по прозрачности, по краям непрозрачных пикселей — бортики.
  // Грани: 0 лицо (+z), 1 изнанка (−z), 2 +x, 3 −x, 4 +y, 5 −y. Кэш на плитку.
  var extrudeCache = {};
  function extrude(tile) {
    var m = extrudeCache[tile];
    if (m) return m;
    var A = KC.atlasAlpha, W = KC.ATLAS_W, Hh = KC.ATLAS_H, tx = (tile % 16) * 16, ty = Math.floor(tile / 16) * 16;
    function solid(x, y) { return !!A && x >= 0 && y >= 0 && x < 16 && y < 16 && A[(ty + y) * W + tx + x] > 127; }
    var pos = [], uv = [], face = [], t = 0.5 / 16, uvT = KC.tileUV(tile);
    function q(pts, uvs, f) { for (var k = 0; k < 4; k++) { pos.push(pts[k][0], pts[k][1], pts[k][2]); uv.push(uvs[k][0], uvs[k][1]); } face.push(f); }
    var full = [[uvT[0], uvT[3]], [uvT[2], uvT[3]], [uvT[2], uvT[1]], [uvT[0], uvT[1]]];
    q([[-0.5, -0.5, t], [0.5, -0.5, t], [0.5, 0.5, t], [-0.5, 0.5, t]], full, 0);
    q([[0.5, -0.5, -t], [-0.5, -0.5, -t], [-0.5, 0.5, -t], [0.5, 0.5, -t]], [full[1], full[0], full[3], full[2]], 1);
    for (var py = 0; py < 16; py++) for (var px = 0; px < 16; px++) {
      if (!solid(px, py)) continue;
      var x0 = -0.5 + px / 16, x1 = x0 + 1 / 16, y1 = 0.5 - py / 16, y0 = y1 - 1 / 16;
      var cu = (tx + px + 0.5) / W, cv = (ty + py + 0.5) / Hh, c4 = [[cu, cv], [cu, cv], [cu, cv], [cu, cv]];
      if (!solid(px + 1, py)) q([[x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t]], c4, 2);
      if (!solid(px - 1, py)) q([[x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t]], c4, 3);
      if (!solid(px, py - 1)) q([[x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t]], c4, 4);
      if (!solid(px, py + 1)) q([[x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t]], c4, 5);
    }
    m = { pos: new Float32Array(pos), uv: new Float32Array(uv), face: new Uint8Array(face), n: face.length };
    extrudeCache[tile] = m;
    return m;
  }
  var EXT_N = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  // R — матрица поворота 3×3, c — центр, size — размер плитки, mirror — зеркально по x,
  // cols — шесть цветов граней (или функция грань → цвет)
  function drawExtruded(batch, tile, R, c, size, mirror, cols) {
    var m = extrude(tile), n = m.n, P = m.pos, U = m.uv, sx = mirror ? -size : size;
    batch.reserve(n);
    for (var i = 0; i < n; i++) {
      var col = cols[m.face[i]];
      for (var k = 0; k < 4; k++) {
        var o = (i * 4 + k) * 3, lx = P[o] * sx, ly = P[o + 1] * size, lz = P[o + 2] * size;
        batch.v(c[0] + R[0] * lx + R[1] * ly + R[2] * lz, c[1] + R[3] * lx + R[4] * ly + R[5] * lz, c[2] + R[6] * lx + R[7] * ly + R[8] * lz,
          U[(i * 4 + k) * 2], U[(i * 4 + k) * 2 + 1], col[0], col[1], col[2]);
      }
      batch.quads++;
    }
  }
  // Предмет на земле или в полёте: свет граней по солнцу, как у моделей
  function drawItem3D(batch, tile, cx, cy, cz, size, yaw, light, sunK, pitch) {
    var R = rot(yaw, pitch || 0, 0), cols = [];
    for (var f = 0; f < 6; f++) { var fc = faceLight(apply(R, EXT_N[f]), light, sunK || 0, null); cols.push([fc[0], fc[1], fc[2]]); }
    drawExtruded(batch, tile, R, [cx, cy, cz], size, false, cols);
  }

  // Плоский двусторонний спрайт из атласа, повёрнутый вокруг вертикали
  function drawSprite(batch, tile, cx, cy, cz, size, yaw, color) {
    var uv = KC.tileUV(tile), h = size / 2;
    var rx = Math.cos(yaw) * h, rz = -Math.sin(yaw) * h;
    batch.reserve(2);
    var c = color;
    batch.v(cx - rx, cy - h, cz - rz, uv[0], uv[3], c[0], c[1], c[2]);
    batch.v(cx + rx, cy - h, cz + rz, uv[2], uv[3], c[0], c[1], c[2]);
    batch.v(cx + rx, cy + h, cz + rz, uv[2], uv[1], c[0], c[1], c[2]);
    batch.v(cx - rx, cy + h, cz - rz, uv[0], uv[1], c[0], c[1], c[2]);
    batch.v(cx + rx, cy - h, cz + rz, uv[2], uv[3], c[0], c[1], c[2]);
    batch.v(cx - rx, cy - h, cz - rz, uv[0], uv[3], c[0], c[1], c[2]);
    batch.v(cx - rx, cy + h, cz - rz, uv[0], uv[1], c[0], c[1], c[2]);
    batch.v(cx + rx, cy + h, cz + rz, uv[2], uv[1], c[0], c[1], c[2]);
    batch.quads += 2;
  }

  KC.Models = {
    ATLAS: ATLAS, init: init, MODELS: MODELS, drawModel: drawModel, drawBlockCube: drawBlockCube, drawSprite: drawSprite,
    Batch: Batch, rot: rot, apply: apply, faceLight: faceLight, drawExtruded: drawExtruded, drawItem3D: drawItem3D, extrude: extrude
  };
})(window.KC = window.KC || {});
