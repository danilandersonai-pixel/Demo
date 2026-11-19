/* Кубокрафт — крупные объекты мира («агрегаты»): буровая установка и её оборудование.
   Объект — запись { id, k, x, y, z, r, st } в world.props. У вида объекта (KINDS[k]) есть:
     stamp(S, p)        — блоки мира: невидимые «габариты» для коллизий, площадка, свет;
     build(g, p)        — статичная геометрия (вшивается в меши чанков);
     dynamic(g, p, env) — подвижные части, каждый кадр;
     update(p, dt), use(p, pos, ctx), lights(p, out), bounds(p).
   Блоки объекта накладываются при генерации чанка (до правок игрока), поэтому в сохранение
   попадает только сама запись и её состояние. */
(function () {
  'use strict';
  var KC = window.KC, B = KC.B, CS = 16, LAYER = 256, H = KC.H;
  var G = KC.Geo;
  var world = null, hooks = {}, KINDS = {}, meshCache = null, nextId = 1;
  var dynSink = new G.DynSink(null), dynGeo = new G.Geo(dynSink);

  var HULL = { full: 0, floorT: 1, floorB: 2, slabB: 3, slabT: 4, wall: 5, stair: 9, post: 13, half: 14, corner: 18, low: 22, mid: 23 };
  var SIDE = { pz: 0, nx: 1, nz: 2, px: 3 };

  // ---- Поворот: локальные координаты объекта → мир (r — четверти оборота) --------------
  function rotPt(x, z, r) {
    switch (r & 3) { case 1: return [z, -x]; case 2: return [-x, -z]; case 3: return [-z, x]; default: return [x, z]; }
  }
  function rotCell(x, z, r) {
    switch (r & 3) { case 1: return [z, -x - 1]; case 2: return [-x - 1, -z - 1]; case 3: return [-z - 1, x]; default: return [x, z]; }
  }
  function toLocal(p, wx, wz) {
    var dx = wx - p.x, dz = wz - p.z;
    switch (p.r & 3) { case 1: return [-dz, dx]; case 2: return [-dx, -dz]; case 3: return [dz, -dx]; default: return [dx, dz]; }
  }

  // ---- Штамп: блоки объекта по чанкам ------------------------------------------------
  function Stamp(p) { this.p = p; this.cells = new Map(); this.cols = []; }
  Stamp.prototype.set = function (x, y, z, id, meta) {
    var p = this.p, c = rotCell(x, z, p.r), wx = p.x + c[0], wy = p.y + y, wz = p.z + c[1];
    if (wy < 1 || wy >= H) return;
    var key = (wx >> 4) + ',' + (wz >> 4), m = this.cells.get(key);
    if (!m) { m = new Map(); this.cells.set(key, m); }
    m.set((wx & 15) + (wz & 15) * CS + wy * LAYER, id | ((meta | 0) << 8));
  };
  // габарит: kind — имя из HULL, side — 'pz' | 'nx' | 'nz' | 'px' для стенок, ступеней и углов
  Stamp.prototype.hull = function (x, y, z, kind, side) {
    var m = HULL[kind] || 0;
    if (side !== undefined) m += ((typeof side === 'number' ? side : SIDE[side]) - this.p.r) & 3;
    this.set(x, y, z, B.RIG_HULL, m);
  };
  Stamp.prototype.fill = function (x0, y0, z0, x1, y1, z1, kind, side) {
    for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) this.hull(x, y, z, kind, side);
  };
  Stamp.prototype.block = function (x0, y0, z0, x1, y1, z1, id, meta) {
    for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) this.set(x, y, z, id, meta);
  };
  // площадка: столбцы выравниваются под отметку top (локальная), выше — воздух, вокруг — откос
  Stamp.prototype.pad = function (x0, z0, x1, z1, top, id, skirt) {
    var p = this.p, a = rotCell(x0, z0, p.r), b = rotCell(x1, z1, p.r);
    this.cols.push({ x0: p.x + Math.min(a[0], b[0]), z0: p.z + Math.min(a[1], b[1]), x1: p.x + Math.max(a[0], b[0]), z1: p.z + Math.max(a[1], b[1]),
      top: p.y + top, id: id, skirt: skirt || 0 });
  };

  function applyCols(c, cols) {
    var b = c.blocks, m = c.meta, ox = c.cx * CS, oz = c.cz * CS;
    for (var i = 0; i < cols.length; i++) {
      var q = cols[i], sk = q.skirt;
      if (ox + 15 < q.x0 - sk || ox > q.x1 + sk || oz + 15 < q.z0 - sk || oz > q.z1 + sk) continue;
      for (var lz = 0; lz < CS; lz++) for (var lx = 0; lx < CS; lx++) {
        var wx = ox + lx, wz = oz + lz;
        var dx = wx < q.x0 ? q.x0 - wx : wx > q.x1 ? wx - q.x1 : 0, dz = wz < q.z0 ? q.z0 - wz : wz > q.z1 ? wz - q.z1 : 0;
        var d = Math.max(dx, dz);
        if (d > sk) continue;
        var top = q.top - d, col = lx + lz * CS, y;
        if (top < 1) continue;
        for (y = top + 1; y < H; y++) { var idx = col + y * LAYER; if (b[idx]) { b[idx] = 0; m[idx] = 0; } }
        b[col + top * LAYER] = d ? B.SAND : q.id; m[col + top * LAYER] = 0;
        for (y = top - 1; y > 0 && y > top - 14; y--) {
          var id = b[col + y * LAYER];
          if (y < top - 2 && KC.OPAQUE[id]) break;
          b[col + y * LAYER] = B.SAND; m[col + y * LAYER] = 0;
        }
      }
    }
  }

  function prep(p) { p._k = KINDS[p.k] || null; p._stamp = null; p._wb = null; p._lc = {}; if (p.id >= nextId) nextId = p.id + 1; }
  function stampOf(p) {
    if (!p._stamp) { var S = new Stamp(p); p._k.stamp(S, p); p._stamp = S; }
    return p._stamp;
  }
  // мировой габарит объекта [x0, y0, z0, x1, y1, z1]
  function wbounds(p) {
    if (p._wb) return p._wb;
    var lb = p._k.bounds(p), a = rotPt(lb[0], lb[2], p.r), b = rotPt(lb[3], lb[5], p.r);
    p._wb = [p.x + Math.min(a[0], b[0]), p.y + lb[1], p.z + Math.min(a[1], b[1]), p.x + Math.max(a[0], b[0]), p.y + lb[4], p.z + Math.max(a[1], b[1])];
    return p._wb;
  }
  function overlapsChunk(p, cx, cz, pad) {
    var w = wbounds(p), ox = cx * CS, oz = cz * CS;
    return !(ox + 16 < w[0] - pad || ox > w[3] + pad || oz + 16 < w[2] - pad || oz > w[5] + pad);
  }

  var Props = { KINDS: KINDS, HULL: HULL };

  Props.init = function (w, h) {
    world = w; hooks = h || {};
    if (!world.props) world.props = [];
    world.props = world.props.filter(function (p) { return !!KINDS[p.k]; });
    world.props.forEach(prep);
    meshCache = null;
  };
  Props.serialize = function () {
    return world.props.map(function (p) { return { id: p.id, k: p.k, x: p.x, y: p.y, z: p.z, r: p.r, st: p._k.save ? p._k.save(p) : p.st }; });
  };

  // вызывается из World._finish: блоки объектов ложатся до правок игрока
  Props.stampChunk = function (w, c) {
    var list = w.props;
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p._k || !overlapsChunk(p, c.cx, c.cz, 8)) continue;
      var S = stampOf(p);
      if (S.cols.length) applyCols(c, S.cols);
      var cells = S.cells.get(c.cx + ',' + c.cz);
      if (cells) cells.forEach(function (v, idx) { c.blocks[idx] = v & 255; c.meta[idx] = v >> 8; });
    }
  };

  // статичный меш объектов для чанка (вызывает World.buildMesh)
  Props.meshFor = function (w, key) {
    if (w !== world || !world.props.length) return null;
    if (!meshCache) bake();
    return meshCache.get(key) || null;
  };
  function place(g, p) { g.reset(); g.move(p.x, p.y, p.z); if (p.r) g.rot('y', p.r * Math.PI / 2); }
  function bake() {
    var sink = new G.StaticSink(), g = new G.Geo(sink);
    world.props.forEach(function (p) { if (!p._k || !p._k.build) return; place(g, p); p._k.build(g, p); });
    meshCache = sink.buckets;
    Props.stats = { quads: sink.quads, chunks: sink.buckets.size };
  }
  function chunkKeys(w, pad, set) {
    for (var cz = (Math.floor(w[2]) - pad) >> 4; cz <= (Math.ceil(w[5]) + pad) >> 4; cz++) {
      for (var cx = (Math.floor(w[0]) - pad) >> 4; cx <= (Math.ceil(w[3]) + pad) >> 4; cx++) set[cx + ',' + cz] = [cx, cz];
    }
  }
  function refresh(set, regen) {
    var k, c;
    for (k in set) {
      c = world.getChunk(set[k][0], set[k][1]);
      if (!c) continue;
      if (regen) { var nc = world.generate(set[k][0], set[k][1]); nc.mesh = c.mesh; nc.dirty = true; }
      else c.dirty = true;
    }
  }
  // геометрия или блоки объекта изменились: regen — перегенерировать чанки под ним (и под прежним местом)
  Props.changed = function (p, regen) {
    var set = {}, near = {};
    if (regen) {
      if (p._wb) { chunkKeys(p._wb, 8, set); chunkKeys(p._wb, 24, near); }
      p._stamp = null; p._wb = null;
    }
    var w = wbounds(p);
    meshCache = null;
    chunkKeys(w, regen ? 8 : 1, set);
    refresh(set, regen);
    if (regen) { chunkKeys(w, 24, near); refresh(near, false); }
  };

  Props.add = function (k, x, y, z, r, st) {
    var K = KINDS[k];
    if (!K || !world) return null;
    var p = { id: nextId++, k: k, x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), r: (r | 0) & 3, st: st || (K.init ? K.init() : {}) };
    prep(p);
    world.props.push(p);
    Props.changed(p, true);
    return p;
  };
  Props.remove = function (p) {
    var i = world.props.indexOf(p);
    if (i < 0) return;
    world.props.splice(i, 1);
    meshCache = null;
    var set = {}, near = {}, w = wbounds(p);
    chunkKeys(w, 8, set); chunkKeys(w, 24, near);
    refresh(set, true); refresh(near, false);
  };
  Props.at = function (x, y, z) {
    var list = world ? world.props : [];
    for (var i = 0; i < list.length; i++) {
      var w = wbounds(list[i]);
      if (x >= w[0] - 1 && x <= w[3] + 1 && z >= w[2] - 1 && z <= w[5] + 1 && y >= w[1] - 4 && y <= w[4] + 1) return list[i];
    }
    return null;
  };
  Props.find = function (k) {
    var list = world ? world.props : [];
    for (var i = 0; i < list.length; i++) if (list[i].k === k) return list[i];
    return null;
  };
  // мировая точка → локальные координаты объекта
  Props.local = function (p, x, y, z) { var l = toLocal(p, x, z); return [l[0], y - p.y, l[1]]; };
  Props.world = function (p, lx, ly, lz) { var a = rotPt(lx, lz, p.r); return [p.x + a[0], p.y + ly, p.z + a[1]]; };

  // ПКМ по габариту объекта
  Props.useAt = function (x, y, z, ctx) {
    var p = Props.at(x + 0.5, y + 0.5, z + 0.5);
    if (!p || !p._k.use) return false;
    return p._k.use(p, Props.local(p, x + 0.5, y + 0.5, z + 0.5), ctx || {}) !== false;
  };
  Props.hintAt = function (x, y, z) {
    var p = Props.at(x + 0.5, y + 0.5, z + 0.5);
    if (!p || !p._k.hint) return null;
    return p._k.hint(p, Props.local(p, x + 0.5, y + 0.5, z + 0.5));
  };

  Props.update = function (dt) {
    var list = world ? world.props : [];
    for (var i = 0; i < list.length; i++) if (list[i]._k && list[i]._k.update) list[i]._k.update(list[i], dt, hooks);
  };

  // Свет для подвижной детали: точка в локальных координатах, обновляется пару раз в секунду
  function lit(p, name, lx, ly, lz, t) {
    var c = p._lc[name];
    if (!c || t - c.t > 0.4 + (c.j || 0)) {
      var w = Props.world(p, lx, ly, lz), E = KC.Entities;
      c = { t: t, j: Math.random() * 0.3, light: E.lightAt(w[0], w[1], w[2]), sunK: E.sunVis(w[0], w[1], w[2]) };
      p._lc[name] = c;
    }
    dynSink.light = c.light; dynSink.sunK = c.sunK;
  }
  // подвижные части — в батч предметов (атлас блоков)
  Props.draw = function (batch, cam, t) {
    var list = world ? world.props : [];
    if (!list.length) return;
    dynSink.batch = batch;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p._k || !p._k.dynamic) continue;
      var w = wbounds(p), dx = Math.max(w[0] - cam.x, 0, cam.x - w[3]), dz = Math.max(w[2] - cam.z, 0, cam.z - w[5]);
      if (dx * dx + dz * dz > 230 * 230) continue;
      place(dynGeo, p);
      dynSink.tint = null;
      p._k.dynamic(dynGeo, p, { t: t, cam: cam, sink: dynSink, lit: function (name, lx, ly, lz) { lit(p, name, lx, ly, lz, t); } });
    }
  };
  Props.lights = function (out, cam, night) {
    var list = world ? world.props : [];
    for (var i = 0; i < list.length; i++) if (list[i]._k && list[i]._k.lights) list[i]._k.lights(list[i], out, cam, night);
  };
  Props.rotPt = rotPt;

  KC.Props = Props;
})();
