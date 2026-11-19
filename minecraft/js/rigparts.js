/* Кубокрафт — детали буровой установки: общие узлы (настилы, перила, лестницы, трубы, ёмкости,
   электродвигатели) и агрегаты циркуляционной системы, насосного, компрессорного и энергоблоков.
   Каждая функция рисует геометрию (g — KC.Geo) и расставляет габариты коллизий (S — штамп объекта).
   Размеры — в метрах: 1 блок = 1 м. */
(function () {
  'use strict';
  var KC = window.KC, T = KC.TILE, MAT = KC.MAT, B = KC.B;
  var NULL_SINK = { quad: function () {} };
  var NULL_STAMP = { set: function () {}, hull: function () {}, fill: function () {}, block: function () {}, pad: function () {} };

  // Набор инструментов: рисует и ставит габариты в одной системе координат
  function Kit(g, S) {
    this.g = g || new KC.Geo.Geo(NULL_SINK);
    this.S = S || NULL_STAMP;
    this.o = [0, 0, 0];
    this.st = [];
  }
  var K = Kit.prototype;
  K.at = function (x, y, z, fn) {
    this.g.push().move(x, y, z);
    this.st.push(this.o);
    this.o = [this.o[0] + x, this.o[1] + y, this.o[2] + z];
    fn.call(this, this.g);
    this.o = this.st.pop();
    this.g.pop();
    return this;
  };
  K.hull = function (x, y, z, kind, side) { this.S.hull(Math.floor(this.o[0] + x), Math.floor(this.o[1] + y), Math.floor(this.o[2] + z), kind, side); };
  // сплошной габарит: все клетки, которые задевает коробка
  K.solid = function (x0, y0, z0, x1, y1, z1, kind, side) {
    var o = this.o, e = 0.001;
    this.S.fill(Math.floor(o[0] + x0 + e), Math.floor(o[1] + y0 + e), Math.floor(o[2] + z0 + e),
      Math.ceil(o[0] + x1 - e) - 1, Math.ceil(o[1] + y1 - e) - 1, Math.ceil(o[2] + z1 - e) - 1, kind || 'full', side);
  };
  K.blockAt = function (x, y, z, id, meta) { this.S.set(Math.floor(this.o[0] + x), Math.floor(this.o[1] + y), Math.floor(this.o[2] + z), id, meta); };
  K.lamp = function (x, y, z) { this.blockAt(x, y, z, B.RIG_LIGHT, 0); };

  // ---- Настилы, перила, лестницы ---------------------------------------------------------
  // Настил: верх на отметке y; opts.grate — решётка, opts.tile, opts.noHull, opts.frame — окантовка швеллером
  K.deck = function (x0, z0, x1, z1, y, opts) {
    opts = opts || {};
    var g = this.g, tile = opts.tile || (opts.grate ? T.rgGrate : T.rgPlate);
    if (opts.grate) { g.box(x0, y - 0.05, z0, x1, y, z1, tile, { skip: 'ewsn' }); }
    else g.box(x0, y - 0.1, z0, x1, y, z1, tile);
    if (opts.frame !== false) {
      var ft = opts.frame || T.rgBlue;
      g.box(x0, y - 0.22, z0, x1, y - 0.02, z0 + 0.1, ft); g.box(x0, y - 0.22, z1 - 0.1, x1, y - 0.02, z1, ft);
      g.box(x0, y - 0.22, z0 + 0.1, x0 + 0.1, y - 0.02, z1 - 0.1, ft); g.box(x1 - 0.1, y - 0.22, z0 + 0.1, x1, y - 0.02, z1 - 0.1, ft);
    }
    if (!opts.noHull) this.solid(x0, y - 1, z0, x1, y, z1, 'floorT');
    return this;
  };
  // Перила вдоль отрезка (по оси X или Z) на отметке настила y. side — с какой стороны клетки настила
  // стоит ограждение: 'pz' | 'nz' для отрезка вдоль X, 'px' | 'nx' — вдоль Z.
  K.rail = function (x0, z0, x1, z1, y, side, opts) {
    var g = this.g, alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), L = alongX ? x1 - x0 : z1 - z0, t = T.rgYellow;
    var n = Math.max(1, Math.round(Math.abs(L) / 1.6)), i;
    var inX = side === 'px' ? -0.05 : side === 'nx' ? 0.05 : 0, inZ = side === 'pz' ? -0.05 : side === 'nz' ? 0.05 : 0;
    function pt(k, h) { return alongX ? [x0 + L * k + inX, y + h, z0 + inZ] : [x0 + inX, y + h, z0 + L * k + inZ]; }
    for (i = 0; i <= n; i++) g.beam(pt(i / n, 0), pt(i / n, 1.1), 0.06, 0.06, t);
    g.beam(pt(0, 1.1), pt(1, 1.1), 0.07, 0.07, t);
    g.beam(pt(0, 0.58), pt(1, 0.58), 0.05, 0.05, t);
    g.beam(pt(0, 0.08), pt(1, 0.08), 0.03, 0.15, t);
    if (!(opts && opts.noHull)) {
      var a = Math.min(alongX ? x0 : z0, alongX ? x1 : z1), b = Math.max(alongX ? x0 : z0, alongX ? x1 : z1);
      for (var c = Math.floor(a + 0.01); c < Math.ceil(b - 0.01); c++) {
        if (alongX) this.hull(c + 0.5, y + 0.5, side === 'pz' ? z0 - 0.5 : z0 + 0.5, 'wall', side);
        else this.hull(side === 'px' ? x0 - 0.5 : x0 + 0.5, y + 0.5, c + 0.5, 'wall', side);
      }
    }
    return this;
  };
  // Перила по периметру прямоугольного настила; gaps — пропуски [{ side, a, b }]
  K.rails = function (x0, z0, x1, z1, y, sides, gaps) {
    var self = this;
    function run(side, a, b) {
      var cuts = (gaps || []).filter(function (q) { return q.side === side; }).sort(function (p, q) { return p.a - q.a; }), s = a;
      cuts.forEach(function (q) { if (q.a > s) seg(side, s, q.a); s = Math.max(s, q.b); });
      if (b > s) seg(side, s, b);
    }
    function seg(side, a, b) {
      if (side === 'nz') self.rail(a, z0, b, z0, y, 'nz');
      else if (side === 'pz') self.rail(a, z1, b, z1, y, 'pz');
      else if (side === 'nx') self.rail(x0, a, x0, b, y, 'nx');
      else self.rail(x1, a, x1, b, y, 'px');
    }
    (sides || 'nz pz nx px').split(' ').forEach(function (sd) { if (sd === 'nz' || sd === 'pz') run(sd, x0, x1); else run(sd, z0, z1); });
    return this;
  };
  // Маршевая лестница: (x, y, z) — угол нижней клетки, dir — куда поднимается, rise — высота, w — ширина
  var STAIR_IDX = { nz: 0, px: 1, pz: 2, nx: 3 }, DIRV = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] };
  K.stairs = function (x, y, z, dir, rise, w, opts) {
    var g = this.g, d = DIRV[dir], i;
    w = w || 1;
    // точка: s — вдоль подъёма, t — поперёк (0…w), h — высота
    var ox = d[0] ? (d[0] > 0 ? x : x + 1) : x, oz = d[1] ? (d[1] > 0 ? z : z + 1) : z;
    function pt(s, t, h) { return [ox + d[0] * s + (d[0] ? 0 : t), y + h, oz + d[1] * s + (d[1] ? 0 : t)]; }
    g.beam(pt(0, 0.04, 0), pt(rise, 0.04, rise), 0.08, 0.24, T.rgBlue);
    g.beam(pt(0, w - 0.04, 0), pt(rise, w - 0.04, rise), 0.08, 0.24, T.rgBlue);
    for (i = 0; i < rise * 2; i++) {
      var s = (i + 1) * 0.5, a = pt(s - 0.3, 0.08, s), b = pt(s, w - 0.08, s);
      g.box(Math.min(a[0], b[0]), a[1] - 0.04, Math.min(a[2], b[2]), Math.max(a[0], b[0]), a[1], Math.max(a[2], b[2]), T.rgGrate, { skip: 'ewsn' });
    }
    [0.04, w - 0.04].forEach(function (t) {
      if (opts && opts.noRail) return;
      g.beam(pt(0, t, 1.1), pt(rise, t, rise + 1.1), 0.07, 0.07, T.rgYellow);
      g.beam(pt(0, t, 0.6), pt(rise, t, rise + 0.6), 0.05, 0.05, T.rgYellow);
      for (var k = 0; k <= rise; k += 1) g.beam(pt(k, t, k), pt(k, t, k + 1.1), 0.06, 0.06, T.rgYellow);
    });
    for (i = 0; i < rise; i++) for (var j = 0; j < w; j++) {
      this.hull(x + d[0] * i + (d[0] ? 0 : j) + 0.5, y + i + 0.5, z + d[1] * i + (d[1] ? 0 : j) + 0.5, 'stair', STAIR_IDX[dir]);
    }
    return this;
  };
  // Вертикальная лестница-стремянка с ограждением-«корзиной». side — у какой грани клетки стоит
  K.ladder = function (x, y, z, h, side, cage) {
    var g = this.g, c = side === 'px' ? [0.92, 0.5] : side === 'nx' ? [0.08, 0.5] : side === 'pz' ? [0.5, 0.92] : [0.5, 0.08];
    var ax = side === 'px' || side === 'nx' ? [0, 0.24] : [0.24, 0], i;
    var p0 = [x + c[0] - ax[0], y, z + c[1] - ax[1]], p1 = [x + c[0] + ax[0], y, z + c[1] + ax[1]];
    g.beam(p0, [p0[0], y + h + 1.1, p0[2]], 0.05, 0.05, T.rgYellow);
    g.beam(p1, [p1[0], y + h + 1.1, p1[2]], 0.05, 0.05, T.rgYellow);
    for (i = 0; i < h * 3; i++) { var hy = y + 0.2 + i / 3; g.beam([p0[0], hy, p0[2]], [p1[0], hy, p1[2]], 0.035, 0.035, T.rgSteel); }
    if (cage !== false && h > 3) {
      var inx = side === 'px' ? -1 : side === 'nx' ? 1 : 0, inz = side === 'pz' ? -1 : side === 'nz' ? 1 : 0;
      for (var hh = 2.2; hh < h + 1; hh += 1.2) {
        var q0 = [p0[0], y + hh, p0[2]], q1 = [p1[0], y + hh, p1[2]];
        var r0 = [p0[0] + inx * 0.62 - ax[0] * 0.3, y + hh, p0[2] + inz * 0.62 - ax[1] * 0.3], r1 = [p1[0] + inx * 0.62 + ax[0] * 0.3, y + hh, p1[2] + inz * 0.62 + ax[1] * 0.3];
        g.beam(q0, r0, 0.03, 0.05, T.rgYellow); g.beam(r0, r1, 0.03, 0.05, T.rgYellow); g.beam(r1, q1, 0.03, 0.05, T.rgYellow);
      }
      [[inx * 0.62 - ax[0] * 1.3, inz * 0.62 - ax[1] * 1.3], [inx * 0.62 + ax[0] * 1.3, inz * 0.62 + ax[1] * 1.3], [inx * 0.66, inz * 0.66]].forEach(function (o) {
        g.beam([x + c[0] + o[0], y + 2.2, z + c[1] + o[1]], [x + c[0] + o[0], y + h + 0.6, z + c[1] + o[1]], 0.03, 0.03, T.rgYellow);
      });
    }
    for (i = 0; i < h; i++) this.blockAt(x + 0.5, y + i + 0.5, z + 0.5, B.RIG_CLIMB, 0);
    return this;
  };

  // ---- Трубы, арматура, приводы ----------------------------------------------------------
  // Трубопровод по точкам; fl — фланцы на концах
  K.pipe = function (pts, r, tile, fl) {
    var g = this.g;
    for (var i = 0; i < pts.length - 1; i++) {
      g.tube(pts[i], pts[i + 1], r, tile, { caps: 3 });
      if (i > 0) g.tube([pts[i][0], pts[i][1] - r, pts[i][2]], [pts[i][0], pts[i][1] + r, pts[i][2]], r, tile, { caps: 3 });
    }
    if (fl) { this.flange(pts[0], pts[1], r); this.flange(pts[pts.length - 1], pts[pts.length - 2], r); }
    return this;
  };
  K.flange = function (p, toward, r) {
    var d = [toward[0] - p[0], toward[1] - p[1], toward[2] - p[2]], l = Math.hypot(d[0], d[1], d[2]) || 1, k = Math.min(0.08, l * 0.5) / l;
    this.g.tube(p, [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k], r * 1.55, T.rgDark, { caps: 3 });
  };
  // Задвижка на трубе: корпус, шпиндель и штурвал вверх
  K.valve = function (x, y, z, axis, r) {
    var g = this.g, a = axis === 'x' ? [1, 0, 0] : axis === 'z' ? [0, 0, 1] : [0, 1, 0], l = r * 1.6;
    g.tube([x - a[0] * l, y - a[1] * l, z - a[2] * l], [x + a[0] * l, y + a[1] * l, z + a[2] * l], r * 1.5, T.rgDark, { caps: 3 });
    if (axis === 'y') { g.tube([x, y, z], [x + r * 3.4, y, z], r * 0.4, T.rgSteel); g.disc('x', x + r * 3.4, y, z, r * 1.9, T.rgHandwheel); }
    else { g.tube([x, y, z], [x, y + r * 3.6, z], r * 0.4, T.rgSteel); g.disc('y', x, y + r * 3.6, z, r * 1.9, T.rgHandwheel); }
    return this;
  };
  // Электродвигатель: (x, y, z) — центр торца со стороны вала, axis ±'x' | ±'z', len, r
  K.motor = function (x, y, z, axis, len, r, tile) {
    var g = this.g, sg = axis.charAt(0) === '-' ? -1 : 1, ax = axis.charAt(axis.length - 1), d = ax === 'x' ? [sg, 0, 0] : [0, 0, sg];
    var e = [x + d[0] * len, y, z + d[2] * len];
    tile = tile || T.rgBlueLt;
    g.tube([x, y, z], e, r, tile, { n: 12, capTile: T.rgDark });
    for (var k = 0.18; k < 0.86; k += 0.11) g.tube([x + d[0] * len * k, y, z + d[2] * len * k], [x + d[0] * (len * k + 0.04), y, z + d[2] * (len * k + 0.04)], r * 1.07, T.rgDark, { n: 12, caps: 3 });
    g.tube(e, [e[0] + d[0] * r * 0.5, y, e[2] + d[2] * r * 0.5], r * 0.96, T.rgDark, { n: 12, capTile: T.rgFan });
    g.tube([x - d[0] * r * 0.7, y, z - d[2] * r * 0.7], [x, y, z], r * 0.22, T.rgSteel);
    var mx = x + d[0] * len * 0.5, mz = z + d[2] * len * 0.5;
    g.box(mx - r * 0.5, y + r * 0.85, mz - r * 0.5, mx + r * 0.5, y + r * 1.35, mz + r * 0.5, T.rgDark);
    if (ax === 'x') { g.box(Math.min(x, e[0]) + len * 0.12, y - r * 1.25, z - r * 0.95, Math.max(x, e[0]) - len * 0.12, y - r * 0.8, z + r * 0.95, T.rgDark); }
    else g.box(x - r * 0.95, y - r * 1.25, Math.min(z, e[2]) + len * 0.12, x + r * 0.95, y - r * 0.8, Math.max(z, e[2]) - len * 0.12, T.rgDark);
    return this;
  };
  // Манометр на отводе
  K.gauge = function (x, y, z, axis, r) {
    var g = this.g;
    r = r || 0.14;
    if (axis === 'x') g.box(x - 0.03, y - r, z - r, x + 0.03, y + r, z + r, [T.rgGauge, T.rgGauge, T.rgDark, T.rgDark, T.rgDark, T.rgDark], { fit: true });
    else g.box(x - r, y - r, z - 0.03, x + r, y + r, z + 0.03, [T.rgDark, T.rgDark, T.rgDark, T.rgDark, T.rgGauge, T.rgGauge], { fit: true });
    return this;
  };
  // Прожектор на кронштейне: светит блок-свет, сам корпус — в меше
  K.flood = function (x, y, z, dir) {
    var g = this.g, d = DIRV[dir] || [0, 1], sv = g.mat;
    g.box(x - 0.2 - Math.abs(d[1]) * 0.1, y - 0.2, z - 0.2 - Math.abs(d[0]) * 0.1, x + 0.2 + Math.abs(d[1]) * 0.1, y + 0.2, z + 0.2 + Math.abs(d[0]) * 0.1, T.rgDark);
    g.mat = MAT.GLOW;
    if (d[0]) g.box(x + d[0] * 0.21 - 0.01, y - 0.16, z - 0.26, x + d[0] * 0.21 + 0.01, y + 0.16, z + 0.26, T.rgLens, { fit: true });
    else g.box(x - 0.26, y - 0.16, z + d[1] * 0.21 - 0.01, x + 0.26, y + 0.16, z + d[1] * 0.21 + 0.01, T.rgLens, { fit: true });
    g.mat = sv;
    this.lamp(x + d[0] * 0.8, y - 0.4, z + d[1] * 0.8);
    return this;
  };

  // ---- Ёмкости -----------------------------------------------------------------------------
  // Прямоугольная ёмкость бурового раствора: открытый верх под решёткой, рёбра жёсткости, люки
  K.mudTank = function (x0, z0, x1, z1, y0, y1, opts) {
    var g = this.g, t = (opts && opts.tile) || T.rgGrey, i, w = 0.08;
    g.box(x0, y0, z0, x1, y1, z0 + w, t); g.box(x0, y0, z1 - w, x1, y1, z1, t);
    g.box(x0, y0, z0 + w, x0 + w, y1, z1 - w, t); g.box(x1 - w, y0, z0 + w, x1, y1, z1 - w, t);
    g.box(x0 + w, y0, z0 + w, x1 - w, y0 + 0.08, z1 - w, T.rgDark, { skip: 'ewsn' });
    for (i = Math.ceil(x0) ; i < x1; i += 1.5) { g.box(i, y0, z0 - 0.07, i + 0.1, y1, z0, T.rgBlue); g.box(i, y0, z1, i + 0.1, y1, z1 + 0.07, T.rgBlue); }
    for (i = Math.ceil(z0) + 0.5; i < z1; i += 1.5) { g.box(x0 - 0.07, y0, i, x0, y1, i + 0.1, T.rgBlue); g.box(x1, y0, i, x1 + 0.07, y1, i + 0.1, T.rgBlue); }
    g.box(x0 - 0.1, y1 - 0.14, z0 - 0.1, x1 + 0.1, y1, z0 + 0.06, T.rgBlue); g.box(x0 - 0.1, y1 - 0.14, z1 - 0.06, x1 + 0.1, y1, z1 + 0.1, T.rgBlue);
    g.box(x0 - 0.1, y1 - 0.14, z0 + 0.06, x0 + 0.06, y1, z1 - 0.06, T.rgBlue); g.box(x1 - 0.06, y1 - 0.14, z0 + 0.06, x1 + 0.1, y1, z1 - 0.06, T.rgBlue);
    this.solid(x0, y0, z0, x1, y1 - 1, z1);
    return this;
  };
  // Горизонтальная цистерна на ложементах (ГСМ, вода)
  K.tankH = function (x, y, z, len, r, tile, axis) {
    var g = this.g, ax = axis || 'x', i;
    g.cyl(ax, x, y + r + 0.35, z, len, r, tile, { n: 12 });
    for (i = 0.18; i < 1; i += 0.64) {
      var s = len * i;
      if (ax === 'x') g.box(x + s - 0.15, y, z - r * 0.8, x + s + 0.15, y + r * 0.75 + 0.35, z + r * 0.8, T.rgBlue);
      else g.box(x - r * 0.8, y, z + s - 0.15, x + r * 0.8, y + r * 0.75 + 0.35, z + s + 0.15, T.rgBlue);
    }
    var mx = ax === 'x' ? x + len * 0.5 : x, mz = ax === 'x' ? z : z + len * 0.5;
    g.cyl('y', mx, y + r * 2 + 0.3, mz, 0.3, 0.3, T.rgDark, { n: 8 });
    if (ax === 'x') this.solid(x, y, z - r, x + len, y + r * 2 + 0.35, z + r); else this.solid(x - r, y, z, x + r, y + r * 2 + 0.35, z + len);
    return this;
  };
  // Вертикальная ёмкость (ресивер, силос): ноги, конусное дно по желанию
  K.tankV = function (x, y, z, h, r, tile, opts) {
    var g = this.g, legs = opts && opts.legs ? opts.legs : 0, cone = opts && opts.cone ? opts.cone : 0, i;
    if (legs) for (i = 0; i < 4; i++) {
      var a = i * Math.PI / 2 + Math.PI / 4, lx = x + Math.cos(a) * r * 0.86, lz = z + Math.sin(a) * r * 0.86;
      g.beam([lx, y, lz], [lx, y + legs + cone + 0.4, lz], 0.14, 0.14, T.rgBlue);
      g.beam([lx, y + 0.3, lz], [x + Math.cos(a + Math.PI / 2) * r * 0.86, y + legs * 0.8, z + Math.sin(a + Math.PI / 2) * r * 0.86], 0.07, 0.07, T.rgBlue);
    }
    if (cone) g.tube([x, y + legs, z], [x, y + legs + cone, z], 0.2, tile, { r1: r, n: 12, caps: 1 });
    g.cyl('y', x, y + legs + cone, z, h, r, tile, { n: 12, caps: 0 });
    g.tube([x, y + legs + cone + h, z], [x, y + legs + cone + h + r * 0.35, z], r, tile, { r1: r * 0.35, n: 12, caps: 2 });
    this.solid(x - r * 0.75, y, z - r * 0.75, x + r * 0.75, y + legs + cone + h, z + r * 0.75);
    return this;
  };

  // ---- Укрытия блоков ----------------------------------------------------------------------
  // Каркас укрытия с кровлей; walls — какие стороны зашиты ('pz nx …'), wallTile, y0 — пол, y1 — кровля
  K.shelter = function (x0, z0, x1, z1, y0, y1, walls, opts) {
    var g = this.g, self = this, wt = (opts && opts.wall) || T.rgSideBlue, rt = (opts && opts.roof) || T.rgSideGrey, i;
    var xs = [], n = Math.max(1, Math.round((x1 - x0) / 4));
    for (i = 0; i <= n; i++) xs.push(x0 + (x1 - x0) * i / n);
    xs.forEach(function (xx) {
      var cx = Math.min(x1 - 0.14, Math.max(x0, xx - 0.07));
      g.box(cx, y0, z0, cx + 0.14, y1, z0 + 0.14, T.rgBlue); g.box(cx, y0, z1 - 0.14, cx + 0.14, y1, z1, T.rgBlue);
      g.beam([cx + 0.07, y1 - 0.1, z0], [cx + 0.07, y1 + 0.25, (z0 + z1) / 2], 0.1, 0.16, T.rgBlue);
      g.beam([cx + 0.07, y1 + 0.25, (z0 + z1) / 2], [cx + 0.07, y1 - 0.1, z1], 0.1, 0.16, T.rgBlue);
    });
    // двускатная кровля из профлиста
    var mz = (z0 + z1) / 2, e = 0.25;
    roofSlope(g, x0 - e, x1 + e, z0 - e, mz, y1, y1 + 0.45, rt);
    roofSlope(g, x0 - e, x1 + e, z1 + e, mz, y1, y1 + 0.45, rt);
    (walls || '').split(' ').forEach(function (sd) {
      if (!sd) return;
      var wy0 = y0 + ((opts && opts.sill) || 0);
      if (sd === 'pz') { g.box(x0, wy0, z1 - 0.06, x1, y1, z1, wt); self.solid(x0, wy0, z1 - 0.5, x1, y1, z1, 'wall', 'pz'); }
      if (sd === 'nz') { g.box(x0, wy0, z0, x1, y1, z0 + 0.06, wt); self.solid(x0, wy0, z0, x1, y1, z0 + 0.5, 'wall', 'nz'); }
      if (sd === 'px') { g.box(x1 - 0.06, wy0, z0, x1, y1, z1, wt); self.solid(x1 - 0.5, wy0, z0, x1, y1, z1, 'wall', 'px'); }
      if (sd === 'nx') { g.box(x0, wy0, z0, x0 + 0.06, y1, z1, wt); self.solid(x0, wy0, z0, x0 + 0.5, y1, z1, 'wall', 'nx'); }
    });
    return this;
  };
  function roofSlope(g, x0, x1, ze, zm, ye, ym, tile) {
    // скат дробим по метру вдоль X, чтобы профиль листа не растягивался
    var L = Math.hypot(zm - ze, ym - ye), n = Math.ceil(L);
    for (var x = x0; x < x1 - 1e-6; x += 1) {
      var xe = Math.min(x1, x + 1);
      for (var k = 0; k < n; k++) {
        var a = k / n, b = (k + 1) / n, za = ze + (zm - ze) * a, zb = ze + (zm - ze) * b, ya = ye + (ym - ye) * a, yb = ye + (ym - ye) * b;
        var uv = [0, 0, xe - x, 0, xe - x, 1, 0, 1];
        g.quad2([x, ya, za], [xe, ya, za], [xe, yb, zb], [x, yb, zb], tile, uv);
      }
    }
  }
  // Рама блока на рельсовых тележках: лонжероны, поперечины, колёсные пары; пол на отметке y
  K.sled = function (x0, z0, x1, z1, y, railZ) {
    var g = this.g, i;
    [z0, z1 - 0.3].forEach(function (zz) { g.box(x0, y - 0.5, zz, x1, y - 0.12, zz + 0.3, T.rgBlue); });
    for (i = x0; i <= x1 - 0.2 + 1e-6; i += Math.max(2, (x1 - x0 - 0.2) / Math.round((x1 - x0) / 3))) g.box(i, y - 0.42, z0 + 0.3, i + 0.2, y - 0.14, z1 - 0.3, T.rgBlue);
    (railZ || [z0 + 0.25, z1 - 0.25]).forEach(function (rz) {
      [x0 + 1.2, x1 - 1.2].forEach(function (bx) {
        g.box(bx - 0.9, y - 0.75, rz - 0.2, bx + 0.9, y - 0.5, rz + 0.2, T.rgDark);
        [-0.55, 0.55].forEach(function (o) { g.cyl('z', bx + o, y - 0.57, rz - 0.09, 0.18, 0.28, T.rgSteel, { n: 10 }); });
      });
    });
    return this;
  };

  KC.RigKit = Kit;
  KC.RigT = T;
})();
