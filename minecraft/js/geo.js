/* Кубокрафт — геометрия крупных объектов (буровая и её агрегаты).
   Строит детали из примитивов в метрах: коробки, цилиндры, балки между точками, фермы, диски.
   Один и тот же код рисует и в статичный меш (вшивается в меши чанков — свет, тени, туман как
   у блоков), и в динамический батч (подвижные части каждый кадр). */
(function () {
  'use strict';
  var KC = window.KC, MAT = KC.MAT;

  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function mul3(a, b) {
    var o = [];
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    return o;
  }
  // Ближайшая из шести осевых нормалей (порядок граней мешера: +X −X +Y −Y +Z −Z)
  function nIdx(n) {
    var ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    if (ay >= ax && ay >= az) return n[1] > 0 ? 2 : 3;
    if (ax >= az) return n[0] > 0 ? 0 : 1;
    return n[2] > 0 ? 4 : 5;
  }

  // ---- Приёмник: статичный меш, разложенный по чанкам ------------------------------
  // вершина: x y z u v свет(материал·2048 + нормаль·256 + яркость·200)
  function StaticSink() { this.buckets = new Map(); this.quads = 0; }
  StaticSink.prototype.quad = function (a, b, c, d, uv, tile, n, mat, shade) {
    var cx = Math.floor((a[0] + b[0] + c[0] + d[0]) * 0.25) >> 4, cz = Math.floor((a[2] + b[2] + c[2] + d[2]) * 0.25) >> 4;
    var key = cx + ',' + cz, bk = this.buckets.get(key);
    if (!bk) { bk = { data: new Float32Array(24 * 256), n: 0, top: 0 }; this.buckets.set(key, bk); }
    if (bk.n + 24 > bk.data.length) { var nd = new Float32Array(bk.data.length * 2); nd.set(bk.data); bk.data = nd; }
    var t = KC.tileUV(tile), du = t[2] - t[0], dv = t[3] - t[1];
    var l = mat * 2048 + nIdx(n) * 256 + Math.min(255, Math.round(shade * (0.8 + 0.2 * Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2]))) * 200));
    var D = bk.data, o = bk.n, P = [a, b, c, d];
    for (var k = 0; k < 4; k++) {
      var p = P[k];
      D[o] = p[0]; D[o + 1] = p[1]; D[o + 2] = p[2];
      D[o + 3] = t[0] + du * uv[k * 2]; D[o + 4] = t[3] - dv * uv[k * 2 + 1]; D[o + 5] = l;
      if (p[1] > bk.top) bk.top = p[1];
      o += 6;
    }
    bk.n = o; this.quads++;
  };

  // ---- Приёмник: динамический батч (атлас блоков, свет считается здесь) -------------
  function DynSink(batch) { this.batch = batch; this.light = [1, 1, 1]; this.sunK = 1; this.tint = null; }
  DynSink.prototype.quad = function (a, b, c, d, uv, tile, n, mat, shade) {
    var B = this.batch, t = KC.tileUV(tile), du = t[2] - t[0], dv = t[3] - t[1], col;
    if (mat === MAT.GLOW || mat === MAT.BLINK) col = [1.5 * shade, 1.45 * shade, 1.3 * shade];
    else {
      var fl = KC.Models.faceLight(n, this.light, this.sunK, this.tint);
      col = [fl[0] * shade, fl[1] * shade, fl[2] * shade];
    }
    B.reserve(1);
    B.v(a[0], a[1], a[2], t[0] + du * uv[0], t[3] - dv * uv[1], col[0], col[1], col[2]);
    B.v(b[0], b[1], b[2], t[0] + du * uv[2], t[3] - dv * uv[3], col[0], col[1], col[2]);
    B.v(c[0], c[1], c[2], t[0] + du * uv[4], t[3] - dv * uv[5], col[0], col[1], col[2]);
    B.v(d[0], d[1], d[2], t[0] + du * uv[6], t[3] - dv * uv[7], col[0], col[1], col[2]);
    B.quads++;
  };

  // ---- Построитель -----------------------------------------------------------------
  function Geo(sink) {
    this.sink = sink;
    this.M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    this.O = [0, 0, 0];
    this.stack = [];
    this.mat = MAT.METAL;
    this.shade = 1;
    this.dyn = sink instanceof DynSink;      // в динамике грани не дробим: текстура тянется
  }
  Geo.prototype.reset = function () { this.M = [1, 0, 0, 0, 1, 0, 0, 0, 1]; this.O = [0, 0, 0]; this.stack.length = 0; this.mat = MAT.METAL; this.shade = 1; return this; };
  Geo.prototype.push = function () { this.stack.push(this.M, this.O, this.mat, this.shade); return this; };
  Geo.prototype.pop = function () { this.shade = this.stack.pop(); this.mat = this.stack.pop(); this.O = this.stack.pop(); this.M = this.stack.pop(); return this; };
  Geo.prototype.dir = function (v) {
    var m = this.M;
    return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  };
  Geo.prototype.pt = function (v) { var d = this.dir(v), o = this.O; return [o[0] + d[0], o[1] + d[1], o[2] + d[2]]; };
  Geo.prototype.move = function (x, y, z) { this.O = this.pt([x, y, z]); return this; };
  // поворот вокруг оси 'x' | 'y' | 'z' на угол в радианах
  Geo.prototype.rot = function (axis, a) {
    var c = Math.cos(a), s = Math.sin(a), R;
    if (axis === 'y') R = [c, 0, s, 0, 1, 0, -s, 0, c];
    else if (axis === 'x') R = [1, 0, 0, 0, c, -s, 0, s, c];
    else R = [c, -s, 0, s, c, 0, 0, 0, 1];
    this.M = mul3(this.M, R);
    return this;
  };

  // Четырёхугольник по локальным точкам (против часовой стрелки, если смотреть снаружи).
  // want — желаемое направление нормали (локальное): при несовпадении порядок переворачивается.
  Geo.prototype.quad = function (a, b, c, d, tile, uv, want) {
    var A = this.pt(a), Bq = this.pt(b), C = this.pt(c), D = this.pt(d);
    var n = norm(cross([Bq[0] - A[0], Bq[1] - A[1], Bq[2] - A[2]], [D[0] - A[0], D[1] - A[1], D[2] - A[2]]));
    uv = uv || [0, 0, 1, 0, 1, 1, 0, 1];
    if (want) {
      var w = this.dir(want);
      if (n[0] * w[0] + n[1] * w[1] + n[2] * w[2] < 0) {
        this.sink.quad(A, D, C, Bq, [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]], tile, [-n[0], -n[1], -n[2]], this.mat, this.shade);
        return this;
      }
    }
    this.sink.quad(A, Bq, C, D, uv, tile, n, this.mat, this.shade);
    return this;
  };
  // Двусторонний лист (диск-вырезка, решётка, знак)
  Geo.prototype.quad2 = function (a, b, c, d, tile, uv) {
    this.quad(a, b, c, d, tile, uv);
    uv = uv || [0, 0, 1, 0, 1, 1, 0, 1];
    return this.quad(a, d, c, b, tile, [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]]);
  };

  // Грань-прямоугольник: o — угол, U и V — единичные направления, ul и vl — размеры в метрах.
  // Текстура идёт «по положению» (1 плитка = 1 м), грань дробится по целым метрам; fit — плитка на всю грань.
  Geo.prototype.face = function (o, U, V, ul, vl, tile, uo, vo, fit) {
    if (tile === null || tile === undefined || ul <= 0 || vl <= 0) return this;
    var self = this;
    function at(s, t) { return [o[0] + U[0] * s + V[0] * t, o[1] + U[1] * s + V[1] * t, o[2] + U[2] * s + V[2] * t]; }
    if (fit) return this.quad(at(0, 0), at(ul, 0), at(ul, vl), at(0, vl), tile);
    if (this.dyn) {
      var mu = Math.min(1, ul), mv = Math.min(1, vl);
      return this.quad(at(0, 0), at(ul, 0), at(ul, vl), at(0, vl), tile, [0, 0, mu, 0, mu, mv, 0, mv]);
    }
    uo = uo || 0; vo = vo || 0;
    var s0 = 0, guard = 0;
    while (s0 < ul - 1e-6 && guard++ < 400) {
      var fu = uo + s0, bu = Math.floor(fu + 1e-6), s1 = Math.min(ul, bu + 1 - uo), u0 = fu - bu, u1 = u0 + (s1 - s0);
      var t0 = 0;
      while (t0 < vl - 1e-6 && guard++ < 4000) {
        var fv = vo + t0, bv = Math.floor(fv + 1e-6), t1 = Math.min(vl, bv + 1 - vo), v0 = fv - bv, v1 = v0 + (t1 - t0);
        self.quad(at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1), tile, [u0, v0, u1, v0, u1, v1, u0, v1]);
        t0 = t1;
      }
      s0 = s1;
    }
    return this;
  };

  // Коробка по осям. tile — номер плитки или массив [+X, −X, +Y, −Y, +Z, −Z] (null — грань не рисуется).
  // opts: { skip: 'tb…' (t верх, b низ, e +X, w −X, s +Z, n −Z), fit: true }
  Geo.prototype.box = function (x0, y0, z0, x1, y1, z1, tile, opts) {
    var t = typeof tile === 'number' ? [tile, tile, tile, tile, tile, tile] : tile.slice();
    var fit = opts && opts.fit, sk = opts && opts.skip;
    if (sk) { var ord = 'ewtbsn'; for (var i = 0; i < 6; i++) if (sk.indexOf(ord.charAt(i)) >= 0) t[i] = null; }
    var dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    this.face([x1, y0, z1], [0, 0, -1], [0, 1, 0], dz, dy, t[0], -z1, y0, fit);
    this.face([x0, y0, z0], [0, 0, 1], [0, 1, 0], dz, dy, t[1], z0, y0, fit);
    this.face([x0, y1, z0], [0, 0, 1], [1, 0, 0], dz, dx, t[2], z0, x0, fit);
    this.face([x0, y0, z0], [1, 0, 0], [0, 0, 1], dx, dz, t[3], x0, z0, fit);
    this.face([x0, y0, z1], [1, 0, 0], [0, 1, 0], dx, dy, t[4], x0, y0, fit);
    this.face([x1, y0, z0], [-1, 0, 0], [0, 1, 0], dx, dy, t[5], -x1, y0, fit);
    return this;
  };

  // Локальный базис вдоль отрезка p→q: A — ось, E1 и E2 — поперечные (E2 = E1 × A)
  function frame(p, q, up) {
    var A = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], L = Math.hypot(A[0], A[1], A[2]) || 1e-6;
    A = [A[0] / L, A[1] / L, A[2] / L];
    var ref = up || (Math.abs(A[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
    var E1 = norm(cross(ref, A)), E2 = cross(E1, A);
    return { A: A, L: L, E1: E1, E2: E2 };
  }
  function add(p, a, s, b, t, c, u) {
    return [p[0] + a[0] * s + (b ? b[0] * t : 0) + (c ? c[0] * u : 0), p[1] + a[1] * s + (b ? b[1] * t : 0) + (c ? c[1] * u : 0), p[2] + a[2] * s + (b ? b[2] * t : 0) + (c ? c[2] * u : 0)];
  }

  // Балка прямоугольного сечения w×h между двумя точками. opts: { caps: true, up: [..] }
  Geo.prototype.beam = function (p, q, w, h, tile, opts) {
    h = h || w;
    var f = frame(p, q, opts && opts.up), A = f.A, E1 = f.E1, E2 = f.E2, L = f.L, hw = w / 2, hh = h / 2;
    var neg1 = [-E1[0], -E1[1], -E1[2]], neg2 = [-E2[0], -E2[1], -E2[2]];
    // тонкие элементы (перила, раскосы, канаты) не дробим — краска тянется вдоль
    var saveDyn = this.dyn;
    if (Math.max(w, h) <= 0.13) this.dyn = true;
    this.face(add(p, E1, hw, E2, -hh), A, E2, L, h, tile);
    this.face(add(p, E1, -hw, E2, hh), A, neg2, L, h, tile);
    this.face(add(p, E2, hh, E1, hw), A, neg1, L, w, tile);
    this.face(add(p, E2, -hh, E1, -hw), A, E1, L, w, tile);
    this.dyn = saveDyn;
    if (opts && opts.caps) {
      this.quad(add(p, E1, -hw, E2, -hh), add(p, E1, hw, E2, -hh), add(p, E1, hw, E2, hh), add(p, E1, -hw, E2, hh), tile, [0, 0, w, 0, w, h, 0, h], [-A[0], -A[1], -A[2]]);
      this.quad(add(q, E1, -hw, E2, -hh), add(q, E1, hw, E2, -hh), add(q, E1, hw, E2, hh), add(q, E1, -hw, E2, hh), tile, [0, 0, w, 0, w, h, 0, h], A);
    }
    return this;
  };

  // Труба (многогранный цилиндр) между двумя точками. r1 — радиус у второго конца (конус),
  // opts: { n: число граней, caps: 0 нет | 1 начало | 2 конец | 3 оба, capTile, a0: сдвиг угла }
  Geo.prototype.tube = function (p, q, r, tile, opts) {
    opts = opts || {};
    var n = opts.n || (r < 0.08 ? 4 : r < 0.3 ? 6 : r < 0.8 ? 8 : 12);
    var r1 = opts.r1 === undefined ? r : opts.r1, caps = opts.caps === undefined ? 3 : opts.caps, a0 = opts.a0 || 0;
    var f = frame(p, q, opts.up), A = f.A, E1 = f.E1, E2 = f.E2, L = f.L, i;
    var ring0 = [], ring1 = [], cs = [];
    for (i = 0; i <= n; i++) {
      var a = a0 + i / n * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      cs.push([c, s]);
      ring0.push(add(p, E1, c * r, E2, s * r));
      ring1.push(add(q, E1, c * r1, E2, s * r1));
    }
    var w = Math.min(1, 2 * Math.max(r, r1) * Math.sin(Math.PI / n));
    var segs = this.dyn || r < 0.08 ? 1 : Math.max(1, Math.ceil(L - 1e-6));
    for (i = 0; i < n; i++) {
      for (var sg = 0; sg < segs; sg++) {
        var k0 = sg / segs, k1 = (sg + 1) / segs, ul = Math.min(1, L / segs);
        var pa = lerp(ring0[i], ring1[i], k0), pb = lerp(ring0[i], ring1[i], k1), pc = lerp(ring0[i + 1], ring1[i + 1], k1), pd = lerp(ring0[i + 1], ring1[i + 1], k0);
        this.quad(pa, pb, pc, pd, tile, [0, 0, ul, 0, ul, w, 0, w]);
      }
    }
    var ct = opts.capTile === undefined ? tile : opts.capTile;
    if (caps & 1) this._cap(ring0, cs, n, ct, [-A[0], -A[1], -A[2]], Math.min(0.5, r));
    if (caps & 2) this._cap(ring1, cs, n, ct, A, Math.min(0.5, r1));
    return this;
  };
  function lerp(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
  Geo.prototype._cap = function (ring, cs, n, tile, want, ur) {
    for (var i = 0; i < n / 2 - 1; i++) {
      var i0 = i, i1 = i + 1, i2 = n - 2 - i, i3 = n - 1 - i;
      if (i1 > i2) break;
      this.quad(ring[i0], ring[i1], ring[i2], ring[i3], tile, [
        0.5 + cs[i0][0] * ur, 0.5 + cs[i0][1] * ur, 0.5 + cs[i1][0] * ur, 0.5 + cs[i1][1] * ur,
        0.5 + cs[i2][0] * ur, 0.5 + cs[i2][1] * ur, 0.5 + cs[i3][0] * ur, 0.5 + cs[i3][1] * ur], want);
    }
  };
  // Цилиндр вдоль оси: (x, y, z) — центр начального торца, len — длина
  Geo.prototype.cyl = function (axis, x, y, z, len, r, tile, opts) {
    var q = axis === 'x' ? [x + len, y, z] : axis === 'y' ? [x, y + len, z] : [x, y, z + len];
    return this.tube([x, y, z], q, r, tile, opts);
  };
  // Плоский диск с плиткой-вырезкой (шкив, штурвал, вентилятор): двусторонний
  Geo.prototype.disc = function (axis, x, y, z, r, tile, ang) {
    var c = Math.cos(ang || 0) * r, s = Math.sin(ang || 0) * r, a, b;
    if (axis === 'x') { a = [0, c, s]; b = [0, -s, c]; }
    else if (axis === 'y') { a = [c, 0, s]; b = [-s, 0, c]; }
    else { a = [c, s, 0]; b = [-s, c, 0]; }
    var o = [x, y, z];
    return this.quad2(add(o, a, -1, b, -1), add(o, a, 1, b, -1), add(o, a, 1, b, 1), add(o, a, -1, b, 1), tile);
  };
  // Вертикальный двусторонний лист между точками (сетка, щит, знак): fit — плитка целиком
  Geo.prototype.sheet = function (p, q, h, tile, fit) {
    var L = Math.hypot(q[0] - p[0], q[2] - p[2]), U = [(q[0] - p[0]) / L, 0, (q[2] - p[2]) / L];
    this.face(p, U, [0, 1, 0], L, h, tile, 0, p[1], fit);
    this.face(q, [-U[0], 0, -U[2]], [0, 1, 0], L, h, tile, 0, p[1], fit);
    return this;
  };

  // Решётчатая колонна (ферма квадратного сечения) между точками: 4 пояса, распорки и раскосы.
  // w0, w1 — ширина у концов, chord и brace — толщина поясов и решётки, panel — шаг панелей
  Geo.prototype.truss = function (p, q, w0, w1, chord, brace, tile, opts) {
    opts = opts || {};
    var f = frame(p, q, opts.up), E1 = f.E1, E2 = f.E2, L = f.L;
    var panels = Math.max(1, Math.round(L / (opts.panel || Math.max(w0, w1) * 1.1)));
    var bt = opts.braceTile === undefined ? tile : opts.braceTile;
    var sgn = [[1, 1], [-1, 1], [-1, -1], [1, -1]], i, k;
    function corner(t, c) {
      var w = (w0 + (w1 - w0) * t) / 2, o = lerp(p, q, t);
      return add(o, E1, sgn[c][0] * w, E2, sgn[c][1] * w);
    }
    for (k = 0; k < 4; k++) this.beam(corner(0, k), corner(1, k), chord, chord, tile, { up: E1 });
    for (i = 0; i <= panels; i++) {
      var t0 = i / panels, t1 = (i + 1) / panels;
      for (k = 0; k < 4; k++) {
        var k2 = (k + 1) & 3;
        this.beam(corner(t0, k), corner(t0, k2), brace, brace, bt);
        if (i < panels) {
          if ((i + k) & 1) this.beam(corner(t0, k), corner(t1, k2), brace, brace, bt);
          else this.beam(corner(t0, k2), corner(t1, k), brace, brace, bt);
        }
      }
    }
    return this;
  };

  // Провисающий канат или рукав: цепочка труб по параболе между точками (sag — провис в метрах)
  Geo.prototype.rope = function (p, q, r, tile, sag, segs) {
    segs = segs || 8;
    var prev = p;
    for (var i = 1; i <= segs; i++) {
      var t = i / segs, pt = lerp(p, q, t);
      pt[1] -= (sag || 0) * 4 * t * (1 - t);
      this.tube(prev, pt, r, tile, { caps: 0, n: r < 0.05 ? 3 : 6 });
      prev = pt;
    }
    return this;
  };

  KC.Geo = { Geo: Geo, StaticSink: StaticSink, DynSink: DynSink, frame: frame, lerp: lerp };
})();
