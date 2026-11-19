/* Кубокрафт — агрегаты буровой: насосы, очистка раствора, приготовление, компрессоры, энергетика,
   противовыбросовое оборудование, вагон-городок. Статичная часть и (где есть) подвижная — отдельными
   функциями: «…Dyn» рисуются каждый кадр. Начало координат агрегата — центр основания. */
(function () {
  'use strict';
  var KC = window.KC, T = KC.TILE, MAT = KC.MAT, K = KC.RigKit.prototype;

  // ---- Буровой насос УНБ-600 (двухпоршневой, двустороннего действия) ------------------------
  // ось насоса — вдоль Z: гидравлическая часть к −Z, привод (двигатель, клиноремённая передача) к +Z
  K.mudPump = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      var G = T.rgGreen, D = T.rgDark, i;
      g.box(-1.15, 0, -2.5, -0.85, 0.25, 4.5, T.rgBlue); g.box(0.85, 0, -2.5, 1.15, 0.25, 4.5, T.rgBlue);
      for (i = -2.3; i < 4.4; i += 1.3) g.box(-0.85, 0.03, i, 0.85, 0.22, i + 0.18, T.rgBlue);
      // приводная часть: картер с крышкой кривошипа
      g.box(-1.05, 0.25, 0.2, 1.05, 1.45, 2.3, G);
      g.cyl('x', -1.05, 1.45, 1.25, 2.1, 0.86, G, { n: 12 });
      g.box(-0.5, 2.2, 0.85, 0.5, 2.36, 1.65, D);
      g.box(-1.09, 0.6, 0.7, -1.05, 1.3, 1.8, D); g.box(-0.3, 0.5, 2.3, 0.3, 1.0, 2.36, T.rgSign, { fit: true });
      // станина ползунов и сальники штоков
      g.box(-0.9, 0.25, -0.75, 0.9, 1.5, 0.2, G);
      g.box(-0.7, 1.5, -0.6, 0.7, 1.56, 0.05, D);
      [-0.42, 0.42].forEach(function (sx) { g.cyl('z', sx, 0.95, -1.12, 0.37, 0.16, D, { n: 8 }); });
      // гидравлическая коробка: клапанные крышки, крышки цилиндров
      g.box(-1.0, 0.3, -2.3, 1.0, 1.55, -1.12, T.rgBlue);
      [[-0.55, -1.95], [0.55, -1.95], [-0.55, -1.45], [0.55, -1.45]].forEach(function (p) {
        g.cyl('y', p[0], 1.55, p[1], 0.26, 0.2, D, { n: 8 });
        g.cyl('y', p[0], 1.81, p[1], 0.1, 0.07, T.rgSteel, { n: 6 });
      });
      [-0.42, 0.42].forEach(function (sx) { g.cyl('z', sx, 0.95, -2.5, 0.2, 0.3, D, { n: 10 }); g.cyl('z', sx, 0.95, -2.56, 0.06, 0.12, T.rgSteel, { n: 6 }); });
      // пневмокомпенсатор и нагнетательный отвод с предохранительным клапаном
      g.cyl('y', 0, 1.55, -1.7, 0.35, 0.16, D, { n: 8 });
      g.tube([0, 1.9, -1.7], [0, 2.2, -1.7], 0.28, T.rgOrange, { r1: 0.52, n: 12, caps: 1 });
      g.cyl('y', 0, 2.2, -1.7, 0.45, 0.52, T.rgOrange, { n: 12, caps: 0 });
      g.tube([0, 2.65, -1.7], [0, 2.95, -1.7], 0.52, T.rgOrange, { r1: 0.2, n: 12, caps: 2 });
      this.gauge(0, 3.12, -1.7, 'z', 0.12);
      this.pipe([[0, 1.75, -1.7], [-1.35, 1.75, -1.7]], 0.11, T.rgOrange, true);
      g.cyl('y', -0.75, 1.86, -1.7, 0.45, 0.07, T.rgRed, { n: 6 });
      // приёмный коллектор
      this.pipe([[-1.3, 0.5, -2.5], [1.3, 0.5, -2.5]], 0.17, T.rgGreen, true);
      // шкив насоса, двигатель и кожух клиноремённой передачи
      g.cyl('x', 1.05, 1.25, 1.55, 0.2, 0.12, T.rgSteel, { n: 6 });
      this.motor(1.2, 0.95, 3.45, '-x', 1.9, 0.52);
      g.box(-0.95, 0.25, 2.75, 1.05, 0.4, 4.15, D);
      g.box(1.22, 0.3, 0.6, 1.62, 2.15, 4.15, [T.rgYellow, T.rgYellow, T.rgYellow, T.rgYellow, T.rgYellow, T.rgYellow]);
      g.box(1.63, 0.5, 0.8, 1.64, 1.95, 3.95, T.rgBelt, { skip: 'wtbsn' });
      this.solid(-1.1, 0, -2.5, 1.1, 2, 2.3);
      this.solid(-1, 0, 2.6, 1.6, 1.6, 4.3);
    });
  };
  // подвижное: штоки поршней ходят со сдвигом фаз на четверть оборота; шкив — под кожухом
  K.mudPumpDyn = function (x, y, z, ph) {
    return this.at(x, y, z, function (g) {
      [-0.42, 0.42].forEach(function (sx, i) {
        var s = Math.sin(ph + i * Math.PI / 2) * 0.17;
        g.tube([sx, 0.95, -1.12 + s - 0.25], [sx, 0.95, -0.72 + s], 0.07, T.rgSteel, { n: 6 });
        g.box(sx - 0.18, 0.8, -0.72 + s, sx + 0.18, 1.1, -0.42 + s, T.rgDark);
      });
    });
  };

  // ---- Вибросито (линейное): приёмник со стороны −Z, сброс шлама к +Z -------------------------
  K.shaker = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      var i;
      g.box(-0.95, 0, -1.6, 0.95, 0.45, 1.6, T.rgBlue);
      g.box(-0.8, 0.45, -1.6, 0.8, 1.55, -0.95, T.rgBlue);
      g.box(-0.6, 1.55, -1.45, 0.6, 1.6, -1.1, T.rgGrate, { skip: 'ewsn' });
      [[-0.88, -0.75], [0.88, -0.75], [-0.88, 1.35], [0.88, 1.35]].forEach(function (p) { g.cyl('y', p[0], 0.45, p[1], 0.3, 0.09, T.rgBlack, { n: 6 }); });
      for (i = -0.7; i < 1.5; i += 0.7) g.box(-0.95, 0.1, i, -0.9, 0.4, i + 0.1, T.rgDark);
      g.box(-0.7, 0.2, 1.6, 0.7, 0.3, 2.2, T.rgDark);                       // лоток сброса шлама
      this.solid(-0.9, 0, -1.6, 0.9, 1.5, 1.6);
    });
  };
  K.shakerDyn = function (x, y, z, t, on, mud) {
    return this.at(x, y, z, function (g) {
      var v = on ? Math.sin(t * 61) * 0.012 : 0, w = on ? Math.cos(t * 61) * 0.01 : 0;
      g.push().move(0, 0.78 + v, w);
      g.rot('x', 0.06);
      g.box(-0.84, 0, -0.9, -0.76, 0.55, 1.6, T.rgOrange); g.box(0.76, 0, -0.9, 0.84, 0.55, 1.6, T.rgOrange);
      g.box(-0.76, 0, -0.9, 0.76, 0.5, -0.84, T.rgOrange);
      g.quad2([-0.76, 0.16, -0.84], [0.76, 0.16, -0.84], [0.76, 0.16, 1.6], [-0.76, 0.16, 1.6], mud ? T.rgScreen : T.rgGrate, [0, 0, 1, 0, 1, 1, 0, 1]);
      g.box(-0.9, 0.55, 0.1, 0.9, 0.7, 0.5, T.rgOrange);
      g.cyl('x', -0.75, 0.9, 0.3, 0.65, 0.17, T.rgBlueLt, { n: 8 }); g.cyl('x', 0.1, 0.9, 0.3, 0.65, 0.17, T.rgBlueLt, { n: 8 });
      g.pop();
    });
  };

  // ---- Гидроциклоны: пескоотделитель (2 больших конуса) и илоотделитель (батарея малых) ----------
  K.desander = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      var self = this;
      [[-0.6, 0], [0.6, 0]].forEach(function (p) {
        g.beam([p[0] - 0.45, 0, p[1] - 0.4], [p[0] - 0.45, 1.9, p[1] - 0.4], 0.1, 0.1, T.rgBlue);
        g.beam([p[0] + 0.45, 0, p[1] + 0.4], [p[0] + 0.45, 1.9, p[1] + 0.4], 0.1, 0.1, T.rgBlue);
        g.tube([p[0], 0.45, p[1]], [p[0], 1.75, p[1]], 0.07, T.rgOrange, { r1: 0.3, n: 10, caps: 1 });
        g.cyl('y', p[0], 1.75, p[1], 0.5, 0.3, T.rgOrange, { n: 10 });
        g.cyl('y', p[0], 2.25, p[1], 0.3, 0.1, T.rgGreen, { n: 6 });
      });
      self.pipe([[-1.1, 2.0, -0.42], [1.1, 2.0, -0.42]], 0.12, T.rgGreen, true);
      self.pipe([[-1.1, 2.55, 0], [1.1, 2.55, 0]], 0.12, T.rgGreen, true);
      g.box(-1.0, 0.25, -0.3, 1.0, 0.4, 0.3, T.rgDark);
      g.box(-1.05, 1.85, -0.5, 1.05, 1.95, 0.5, T.rgBlue, { skip: 'tb' });
      this.gauge(1.1, 2.3, -0.42, 'x');
      this.solid(-1, 0, -0.5, 1, 2, 0.5);
    });
  };
  K.desilter = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      for (var i = 0; i < 4; i++) [-0.28, 0.28].forEach(function (oz) {
        var cx = -0.75 + i * 0.5;
        g.tube([cx, 0.75, oz * 1.5], [cx, 1.5, oz], 0.035, T.rgYellow, { r1: 0.13, n: 8, caps: 1 });
        g.cyl('y', cx, 1.5, oz, 0.22, 0.13, T.rgYellow, { n: 8 });
      });
      this.pipe([[-1.1, 1.62, 0], [1.1, 1.62, 0]], 0.11, T.rgGreen, true);
      this.pipe([[-1.1, 1.95, 0], [1.1, 1.95, 0]], 0.09, T.rgGreen, true);
      [-0.95, 0.95].forEach(function (sx) { g.beam([sx, 0, -0.45], [sx, 1.6, 0], 0.08, 0.08, T.rgBlue); g.beam([sx, 0, 0.45], [sx, 1.6, 0], 0.08, 0.08, T.rgBlue); });
      g.box(-1.0, 0.4, -0.5, 1.0, 0.55, 0.5, T.rgDark);
      this.solid(-1, 0, -0.5, 1, 2, 0.5);
    });
  };
  // Вакуумный дегазатор: камера на раме, вакуум-насос, трубопроводы
  K.degasser = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]].forEach(function (p) { g.beam([p[0], 0, p[1]], [p[0], 0.9, p[1]], 0.1, 0.1, T.rgBlue); });
      g.cyl('y', 0, 0.7, 0, 1.7, 0.62, T.rgGrey, { n: 12, caps: 0 });
      g.tube([0, 2.4, 0], [0, 2.65, 0], 0.62, T.rgGrey, { r1: 0.25, n: 12, caps: 2 });
      g.tube([0, 0.4, 0], [0, 0.7, 0], 0.2, T.rgGrey, { r1: 0.62, n: 12, caps: 1 });
      g.cyl('y', 0, 1.3, 0, 0.12, 0.65, T.rgBlue, { n: 12 });
      this.pipe([[0, 2.65, 0], [0, 2.9, 0], [0.95, 2.9, 0], [0.95, 0.5, 0]], 0.07, T.rgBlueLt);
      this.motor(0.75, 0.3, 0.75, 'x', 0.55, 0.18);
      this.gauge(0.64, 1.9, 0, 'x');
      this.solid(-0.6, 0, -0.6, 0.6, 2.5, 0.6);
    });
  };
  // Центрифуга: горизонтальный ротор под кожухом на раме, привод ремнём
  K.centrifuge = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      [[-1.1, -0.4], [1.1, -0.4], [-1.1, 0.4], [1.1, 0.4]].forEach(function (p) { g.beam([p[0], 0, p[1]], [p[0], 0.9, p[1]], 0.1, 0.1, T.rgBlue); });
      g.box(-1.3, 0.85, -0.5, 1.3, 1.0, 0.5, T.rgBlue);
      g.cyl('x', -1.1, 1.45, 0, 1.9, 0.45, T.rgGrey, { n: 12 });
      g.tube([0.8, 1.45, 0], [1.15, 1.45, 0], 0.45, T.rgGrey, { r1: 0.2, n: 12 });
      g.box(-1.5, 1.0, -0.3, -1.1, 1.9, 0.3, T.rgYellow);
      this.motor(-0.2, 1.3, 0.85, '-x', 0.8, 0.22);
      g.box(-0.4, 0.3, -0.25, 0.1, 0.9, 0.25, T.rgDark, { skip: 't' });
      this.solid(-1.3, 0, -0.5, 1.3, 1.9, 0.5);
    });
  };
  // Перемешиватель на балке над ёмкостью: мотор-редуктор (вал с лопастями — подвижный)
  K.agitator = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      g.box(-0.35, 0, -0.35, 0.35, 0.4, 0.35, T.rgGreen);
      g.cyl('y', 0, 0.4, 0, 0.55, 0.2, T.rgBlueLt, { n: 10, capTile: T.rgFan });
      g.box(-0.9, -0.12, -0.12, 0.9, 0, 0.12, T.rgBlue);
    });
  };
  K.agitatorDyn = function (x, y, z, depth, ang) {
    return this.at(x, y, z, function (g) {
      g.cyl('y', 0, -depth, 0, depth, 0.05, T.rgSteel, { n: 4, caps: 0 });
      g.push().move(0, -depth + 0.1, 0).rot('y', ang);
      g.box(-0.55, -0.05, -0.08, 0.55, 0.05, 0.08, T.rgDark); g.box(-0.08, -0.05, -0.55, 0.08, 0.05, 0.55, T.rgDark);
      g.pop();
    });
  };
  // Гидроворонка для затворения реагентов и стол для мешков
  K.hopper = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].forEach(function (p) { g.beam([p[0], 0, p[1]], [p[0], 1.0, p[1]], 0.08, 0.08, T.rgBlue); });
      g.tube([0, 0.45, 0], [0, 1.25, 0], 0.12, T.rgGrey, { r1: 0.65, n: 10, caps: 0 });
      g.cyl('y', 0, 1.25, 0, 0.12, 0.65, T.rgGrey, { n: 10, caps: 0 });
      this.pipe([[-1.4, 0.4, 0], [1.4, 0.4, 0]], 0.1, T.rgGreen, true);
      this.valve(-0.9, 0.4, 0, 'x', 0.1);
      g.box(0.75, 0.9, -0.6, 1.7, 1.0, 0.6, T.rgPlate); g.box(0.8, 0, -0.5, 0.9, 0.9, -0.4, T.rgBlue); g.box(1.55, 0, 0.4, 1.65, 0.9, 0.5, T.rgBlue);
      this.solid(-0.6, 0, -0.6, 1.7, 1, 0.6);
    });
  };
  // Штабель мешков на поддоне
  K.sacks = function (x, y, z, n) {
    return this.at(x, y, z, function (g) {
      var sv = g.mat; g.mat = MAT.SOLID;
      g.box(-0.6, 0, -0.5, 0.6, 0.12, 0.5, T.rgTimber);
      g.box(-0.55, 0.12, -0.45, 0.55, 0.12 + 0.25 * (n || 4), 0.45, T.rgSack);
      g.mat = sv;
      this.solid(-0.5, 0, -0.5, 0.5, 0.12 + 0.25 * (n || 4), 0.5, (n || 4) > 2 ? 'full' : 'slabB');
    });
  };

  // ---- Компрессор 4ВУ1-5/9 и воздухосборник ---------------------------------------------------
  K.compressor = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      g.box(-1.3, 0, -0.6, 1.3, 0.2, 0.6, T.rgBlue);
      g.box(-0.2, 0.2, -0.45, 0.7, 1.0, 0.45, T.rgBlueLt);
      [-1, 1].forEach(function (s) {
        g.tube([0.25, 0.9, s * 0.2], [0.25, 1.55, s * 0.72], 0.2, T.rgBlueLt, { n: 8 });
        for (var k = 0.25; k < 0.95; k += 0.2) g.tube([0.25, 0.9 + 0.65 * k, s * (0.2 + 0.52 * k)], [0.25, 0.9 + 0.65 * (k + 0.06), s * (0.2 + 0.52 * (k + 0.06))], 0.25, T.rgDark, { n: 8 });
      });
      this.pipe([[0.25, 1.6, -0.75], [0.25, 1.9, -0.75], [0.25, 1.9, 0.75], [0.25, 1.6, 0.75]], 0.05, T.rgSteel);
      this.motor(-0.35, 0.6, 0, '-x', 0.8, 0.3);
      g.cyl('y', 0.95, 1.0, 0, 0.3, 0.16, T.rgDark, { n: 8 });
      this.solid(-1.2, 0, -0.6, 1.2, 1.6, 0.6);
    });
  };
  K.compressorDyn = function (x, y, z, ang) {
    return this.at(x, y, z, function (g) { g.disc('x', 0.74, 0.6, 0, 0.42, T.rgSheave, ang); g.disc('x', 0.78, 0.6, 0, 0.42, T.rgSheave, ang); });
  };
  K.receiver = function (x, y, z) {
    this.tankV(x, y, z, 2.1, 0.5, T.rgBlueLt, { legs: 0.35 });
    return this.at(x, y, z, function (g) { this.gauge(0.52, 1.8, 0, 'x'); g.cyl('y', 0, 2.62, 0, 0.25, 0.05, T.rgRed, { n: 6 }); });
  };

  // ---- Энергоблок ------------------------------------------------------------------------------
  // Ряд ячеек КРУ / шкафов управления: n штук вдоль X, лицом к −Z
  K.cabinets = function (x, y, z, n, face, h) {
    return this.at(x, y, z, function (g) {
      h = h || 2.2;
      for (var i = 0; i < n; i++) {
        var f = face === 'panel' && i % 2 === 0 ? T.rgPanel : T.rgCabinet;
        g.box(i * 0.8, 0, 0, i * 0.8 + 0.8, h, 0.9, [T.rgGrey, T.rgGrey, T.rgGrey, T.rgGrey, T.rgLouver, null], { skip: 'b' });
        g.box(i * 0.8 + 0.02, 0.05, -0.01, i * 0.8 + 0.78, h - 0.05, 0, f, { fit: true, skip: 'ewtbs' });
        g.box(i * 0.8, 0, 0, i * 0.8 + 0.8, h, 0.001, T.rgGrey, { skip: 'ewtbs' });
      }
      this.solid(0, 0, 0, n * 0.8, h, 0.9);
    });
  };
  // Силовой трансформатор: бак, радиаторы, расширитель, вводы
  K.transformer = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      g.box(-0.8, 0.15, -0.5, 0.8, 1.35, 0.5, T.rgGrey);
      g.box(-0.9, 0, -0.55, -0.7, 0.15, 0.55, T.rgDark); g.box(0.7, 0, -0.55, 0.9, 0.15, 0.55, T.rgDark);
      [-1, 1].forEach(function (s) {
        var z0 = s > 0 ? 0.5 : -0.78;
        g.box(-0.7, 0.3, z0, 0.7, 1.25, z0 + 0.28, [T.rgRadiator, T.rgRadiator, T.rgGrey, T.rgGrey, T.rgRadiator, T.rgRadiator]);
      });
      g.cyl('x', -0.6, 1.72, 0.2, 1.2, 0.18, T.rgGrey, { n: 8 });
      g.beam([-0.4, 1.35, 0.2], [-0.4, 1.56, 0.2], 0.06, 0.06, T.rgGrey); g.beam([0.4, 1.35, 0.2], [0.4, 1.56, 0.2], 0.06, 0.06, T.rgGrey);
      [-0.45, 0, 0.45].forEach(function (sx) { g.cyl('y', sx, 1.35, -0.25, 0.5, 0.07, T.rgInsul, { n: 6 }); g.cyl('y', sx, 1.85, -0.25, 0.1, 0.03, T.rgSteel, { n: 4 }); });
      this.solid(-0.8, 0, -0.75, 0.8, 1.6, 0.75);
    });
  };
  // Аварийная дизельная электростанция в блок-контейнере
  K.des = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      g.box(-3, 0, -1.25, 3, 0.2, 1.25, T.rgBlue);
      g.box(-3, 0.2, -1.25, 3, 2.7, 1.25, [T.rgRadiator, T.rgSideBlue, T.rgSideGrey, null, T.rgSideBlue, T.rgSideBlue]);
      g.box(-1.2, 0.5, -1.27, -0.2, 1.7, -1.25, T.rgLouver, { skip: 'ewtbs' }); g.box(0.4, 0.5, -1.27, 1.4, 1.7, -1.25, T.rgLouver, { skip: 'ewtbs' });
      g.box(-2.6, 0.25, -1.27, -1.7, 2.2, -1.25, T.rgDoor, { fit: true, skip: 'ewtbs' });
      g.box(1.9, 1.6, -1.27, 2.7, 2.4, -1.25, T.rgCabinet, { fit: true, skip: 'ewtbs' });
      g.cyl('y', 1.5, 2.7, 0.5, 0.5, 0.11, T.rgDark, { n: 8 });
      g.cyl('x', 1.0, 3.25, 0.5, 1.0, 0.22, T.rgDark, { n: 8 });
      g.cyl('y', 1.9, 3.25, 0.5, 0.9, 0.09, T.rgFlameStack, { n: 6 });
      this.solid(-3, 0, -1.25, 3, 2.7, 1.25);
    });
  };

  // ---- Вагон-дом на санях ------------------------------------------------------------------------
  K.wagon = function (x, y, z, len, kind) {
    return this.at(x, y, z, function (g) {
      len = len || 8;
      var sv = g.mat, w = 1.45;
      g.cyl('x', -0.3, 0.14, -1.0, len + 0.6, 0.14, T.rgDark, { n: 6 }); g.cyl('x', -0.3, 0.14, 1.0, len + 0.6, 0.14, T.rgDark, { n: 6 });
      for (var i = 0.6; i < len; i += 2.2) g.box(i, 0.2, -1.1, i + 0.15, 0.55, 1.1, T.rgDark);
      g.mat = MAT.SOLID;
      g.box(0, 0.55, -w, len, 3.0, w, [T.rgWagon, T.rgWagon, T.rgSideGrey, T.rgDark, T.rgWagon, T.rgWagon]);
      g.box(-0.1, 3.0, -w - 0.1, len + 0.1, 3.1, w + 0.1, T.rgSideGrey);
      g.mat = sv;
      for (var k = 1.2; k < len - 1.5; k += 2.4) {
        if (Math.abs(k - 3.6) < 0.2) continue;
        g.box(k, 1.6, -w - 0.02, k + 0.9, 2.45, -w, T.rgWindow, { fit: true, skip: 'ewtbs' });
        g.box(k, 1.6, w, k + 0.9, 2.45, w + 0.02, T.rgWindow, { fit: true, skip: 'ewtbn' });
      }
      g.box(3.45, 0.6, -w - 0.03, 4.35, 2.55, -w, T.rgDoor, { fit: true, skip: 'ewtbs' });
      g.box(3.3, 0.3, -w - 0.9, 4.5, 0.55, -w, T.rgGrate, { skip: 'ewsn' });
      g.box(3.3, 0, -w - 1.3, 4.5, 0.28, -w - 0.9, T.rgGrate, { skip: 'ewsn' });
      g.cyl('y', len - 1, 3.1, 0.6, 0.7, 0.08, T.rgDark, { n: 6 });
      if (kind === 'sign') g.box(1.0, 2.5, -w - 0.03, 2.0, 2.9, -w, T.rgSign, { fit: true, skip: 'ewtbs' });
      this.solid(0, 0, -w, len, 3, w);
      this.solid(3.3, 0, -w - 1, 4.5, 0.5, -w, 'slabB');
    });
  };

  // ---- Противовыбросовое оборудование -------------------------------------------------------------
  // Сборка на устье: колонная головка, крестовина с отводами, два плашечных превентора, универсальный,
  // разъёмный жёлоб. level: 0 — только направление, 1 — колонная головка, 2 — ПВО собрано
  K.bop = function (x, y, z, level, top) {
    return this.at(x, y, z, function (g) {
      var R = T.rgRed, D = T.rgDark;
      g.cyl('y', 0, -1.2, 0, 1.45, 0.3, T.rgRust, { n: 10 });                 // направление в шахте
      if (level >= 1) {
        g.cyl('y', 0, 0.25, 0, 0.5, 0.36, D, { n: 10 });
        g.cyl('y', 0, 0.2, 0, 0.08, 0.5, D, { n: 10 }); g.cyl('y', 0, 0.75, 0, 0.08, 0.5, D, { n: 10 });
        this.valve(0, 0.5, 0.62, 'z', 0.09);
      }
      if (level >= 2) {
        g.cyl('y', 0, 0.83, 0, 0.6, 0.34, R, { n: 10 });                      // крестовина
        g.cyl('y', 0, 1.43, 0, 0.08, 0.52, D, { n: 10 });
        this.pipe([[-1.6, 1.13, 0], [1.6, 1.13, 0]], 0.1, R, true);
        this.valve(-0.75, 1.13, 0, 'x', 0.1); this.valve(-1.2, 1.13, 0, 'x', 0.1); this.valve(0.75, 1.13, 0, 'x', 0.1); this.valve(1.2, 1.13, 0, 'x', 0.1);
        [1.51, 2.31].forEach(function (by) {                                   // плашечные превенторы
          g.box(-0.55, by, -0.42, 0.55, by + 0.7, 0.42, R);
          g.cyl('x', -1.25, by + 0.35, 0, 0.7, 0.24, R, { n: 8 }); g.cyl('x', 0.55, by + 0.35, 0, 0.7, 0.24, R, { n: 8 });
          g.cyl('x', -1.35, by + 0.35, 0, 0.1, 0.3, D, { n: 8 }); g.cyl('x', 1.25, by + 0.35, 0, 0.1, 0.3, D, { n: 8 });
          g.cyl('y', 0, by + 0.7, 0, 0.1, 0.52, D, { n: 10 });
        });
        g.cyl('y', 0, 3.11, 0, 0.25, 0.5, R, { n: 12 });                      // универсальный превентор
        g.cyl('y', 0, 3.36, 0, 0.6, 0.62, R, { n: 12 });
        g.tube([0, 3.96, 0], [0, 4.2, 0], 0.62, R, { r1: 0.4, n: 12 });
        g.cyl('y', 0, 4.2, 0, 0.08, 0.52, D, { n: 10 });
        g.cyl('y', 0, 4.28, 0, Math.max(0.2, (top || 6) - 4.28), 0.3, T.rgGrey, { n: 10, caps: 0 });    // надпревенторная катушка и жёлоб
        this.solid(-0.6, 0, -0.6, 0.6, 4.2, 0.6);
      } else if (level >= 1) this.solid(-0.5, 0, -0.5, 0.5, 0.8, 0.5);
    });
  };
  // Фонтанная арматура законченной скважины
  K.xmasTree = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      var G = T.rgGreen, D = T.rgDark;
      g.cyl('y', 0, -0.3, 0, 0.8, 0.34, D, { n: 10 });
      g.cyl('y', 0, 0.5, 0, 0.5, 0.3, G, { n: 10 });
      this.valve(0, 1.2, 0, 'y', 0.13); this.valve(0, 1.75, 0, 'y', 0.13);
      g.cyl('y', 0, 1.0, 0, 1.6, 0.12, G, { n: 8 });
      this.pipe([[-0.9, 2.25, 0], [0.9, 2.25, 0]], 0.1, G, true);
      this.valve(-0.5, 2.25, 0, 'x', 0.1); this.valve(0.5, 2.25, 0, 'x', 0.1);
      this.valve(0, 2.75, 0, 'y', 0.1);
      this.gauge(0, 3.1, 0, 'z', 0.13);
      g.box(-0.45, 0, -0.45, 0.45, 0.06, 0.45, T.rgSlab);
      this.solid(-0.4, 0, -0.4, 0.4, 2.9, 0.4);
    });
  };
  // Станция гидроуправления ПВО: баллоны-аккумуляторы, бак, пульт с рукоятками
  K.accumulator = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      g.box(-1.4, 0, -0.7, 1.4, 0.18, 0.7, T.rgBlue);
      for (var i = 0; i < 6; i++) {
        var bx = -1.15 + i * 0.3;
        g.cyl('y', bx, 0.18, 0.35, 1.3, 0.13, i % 2 ? T.rgBlack : T.rgBlueLt, { n: 8 });
        g.cyl('y', bx, 1.48, 0.35, 0.1, 0.05, T.rgSteel, { n: 4 });
      }
      g.box(-1.3, 0.18, -0.6, 0.2, 0.9, 0.0, T.rgRed);
      g.box(0.5, 0.18, -0.6, 1.3, 1.5, 0.5, T.rgGrey);
      g.box(0.55, 0.8, -0.62, 1.25, 1.45, -0.6, T.rgPanel, { fit: true, skip: 'ewtbs' });
      this.pipe([[-1.15, 1.6, 0.35], [0.4, 1.6, 0.35]], 0.04, T.rgSteel);
      this.solid(-1.4, 0, -0.7, 1.4, 1.5, 0.7);
    });
  };
  // Блок дросселирования / глушения: гребёнка задвижек на раме
  K.manifold = function (x, y, z) {
    return this.at(x, y, z, function (g) {
      g.box(-1.5, 0, -0.6, 1.5, 0.15, 0.6, T.rgBlue);
      [-1.2, 1.2].forEach(function (sx) { g.beam([sx, 0.15, 0], [sx, 0.75, 0], 0.1, 0.1, T.rgBlue); });
      this.pipe([[-1.5, 0.85, 0], [1.5, 0.85, 0]], 0.09, T.rgRed, true);
      this.pipe([[-0.6, 0.85, 0], [-0.6, 0.85, -0.6]], 0.08, T.rgRed, true);
      this.pipe([[0.6, 0.85, 0], [0.6, 0.85, 0.6]], 0.08, T.rgRed, true);
      this.pipe([[0, 0.85, 0], [0, 1.5, 0]], 0.06, T.rgRed);
      this.valve(-1.0, 0.85, 0, 'x', 0.09); this.valve(-0.2, 0.85, 0, 'x', 0.09); this.valve(1.0, 0.85, 0, 'x', 0.09);
      this.gauge(0, 1.62, 0, 'z', 0.13);
      this.solid(-1.5, 0, -0.5, 1.5, 1.2, 0.5);
    });
  };
  // Факельный стояк с растяжками (пламя — подвижное)
  K.flare = function (x, y, z, h) {
    return this.at(x, y, z, function (g) {
      h = h || 9;
      g.box(-0.5, 0, -0.5, 0.5, 0.2, 0.5, T.rgSlab);
      g.cyl('y', 0, 0.2, 0, h, 0.11, T.rgFlameStack, { n: 6 });
      g.cyl('y', 0, h + 0.2, 0, 0.5, 0.2, T.rgFlameStack, { n: 8, caps: 0 });
      [[4, 4], [-4, 4], [0, -5]].forEach(function (p) { g.beam([0, h * 0.8, 0], [p[0], 0, p[1]], 0.03, 0.03, T.rgRope); });
      this.solid(-0.3, 0, -0.3, 0.3, 2, 0.3, 'post');
    });
  };
  // Пожарный щит
  K.fireBoard = function (x, y, z, axis) {
    return this.at(x, y, z, function (g) {
      var sv = g.mat; g.mat = MAT.SOLID;
      if (axis === 'x') { g.box(-0.05, 0, -0.9, 0.05, 2.0, -0.8, T.rgRed); g.box(-0.05, 0, 0.8, 0.05, 2.0, 0.9, T.rgRed); g.box(-0.04, 0.7, -0.8, 0.04, 1.9, 0.8, [T.rgFireBoard, T.rgFireBoard, T.rgRed, T.rgRed, T.rgRed, T.rgRed], { fit: true }); }
      else { g.box(-0.9, 0, -0.05, -0.8, 2.0, 0.05, T.rgRed); g.box(0.8, 0, -0.05, 0.9, 2.0, 0.05, T.rgRed); g.box(-0.8, 0.7, -0.04, 0.8, 1.9, 0.04, [T.rgRed, T.rgRed, T.rgRed, T.rgRed, T.rgFireBoard, T.rgFireBoard], { fit: true }); }
      g.box(-0.35, 0, 0.2, 0.35, 0.6, 0.7, T.rgRed);
      g.mat = sv;
    });
  };
  // Опора ЛЭП с траверсой и изоляторами
  K.powerPole = function (x, y, z, h, axis) {
    return this.at(x, y, z, function (g) {
      h = h || 9;
      var sv = g.mat; g.mat = MAT.SOLID;
      g.cyl('y', 0, 0, 0, h, 0.14, T.rgTimber, { n: 6 });
      g.mat = sv;
      if (axis === 'x') g.box(-1.0, h - 0.7, -0.06, 1.0, h - 0.58, 0.06, T.rgDark); else g.box(-0.06, h - 0.7, -1.0, 0.06, h - 0.58, 1.0, T.rgDark);
      [-0.85, 0, 0.85].forEach(function (o) { if (axis === 'x') g.cyl('y', o, h - 0.58, 0, 0.25, 0.05, T.rgInsul, { n: 6 }); else g.cyl('y', 0, h - 0.58, o, 0.25, 0.05, T.rgInsul, { n: 6 }); });
      this.solid(-0.2, 0, -0.2, 0.2, 3, 0.2, 'post');
    });
  };
})();
