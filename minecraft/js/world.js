/* Кубокрафт — мир: чанки с метаданными, генерация, правки игрока, коллизии,
   построение мешей со светом неба и светом от блоков (факелы, лава, лампы).
   Чанк — колонна 16×16×H. Индекс блока: x + z*16 + y*256. */
(function (KC) {
  'use strict';

  var B = KC.B, BLOCKS = KC.BLOCKS;
  var OPAQUE = KC.OPAQUE, OCCLUDE = KC.OCCLUDE, LIGHTBLOCK = KC.LIGHTBLOCK, EMIT = KC.EMIT, T = KC.TILE;
  var hash2 = KC.hash2, hash3 = KC.hash3;

  var CS = 16, H = 96, WL = 30, LAYER = CS * CS;

  // Блоки, которые хотя бы в каком-то состоянии светятся
  var EMITTER = new Uint8Array(256);
  for (var em = 0; em < 256; em++) if (EMIT[em]) EMITTER[em] = 1;
  [B.FURNACE, B.LAMP, B.SPARK_TORCH, B.GENERATOR, B.LANDING_LIGHT].forEach(function (id) { EMITTER[id] = 1; });

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  // Направления: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z
  var DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // Горизонтальный «взгляд» (0 юг +Z, 1 запад -X, 2 север -Z, 3 восток +X) → индекс грани
  var FACING_FACE = [4, 1, 5, 0];

  function Chunk(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = new Uint8Array(LAYER * H);
    this.meta = new Uint8Array(LAYER * H);
    this.hmap = new Uint8Array(LAYER);
    this.maxY = 0;
    this.emitters = 0;
    this.emitList = null;            // индексы светящихся блоков (собирается по запросу)
    this.mesh = null;
    this.dirty = true;
  }

  Chunk.prototype.recalcColumn = function (x, z) {
    var b = this.blocks, h = 0;
    for (var y = H - 1; y >= 0; y--) if (LIGHTBLOCK[b[x + z * CS + y * LAYER]]) { h = y + 1; break; }
    this.hmap[x + z * CS] = h;
  };

  Chunk.prototype.recalcAll = function () {
    var b = this.blocks, maxY = 0, em = 0, i;
    for (var z = 0; z < CS; z++) for (var x = 0; x < CS; x++) this.recalcColumn(x, z);
    for (i = 0; i < b.length; i++) if (b[i]) { if (EMITTER[b[i]]) em++; }
    for (var y = H - 1; y >= 0 && !maxY; y--) {
      var base = y * LAYER;
      for (i = 0; i < LAYER; i++) if (b[base + i]) { maxY = y; break; }
    }
    this.maxY = maxY;
    this.emitters = em;
    this.emitList = null;
  };

  // Светящиеся блоки чанка. У лавы берём только «поверхность» — клетки, рядом с которыми
  // есть воздух: свет изнутри лавового моря всё равно перекрыт соседней лавой.
  Chunk.prototype.emitterIndices = function () {
    if (!this.emitList) {
      var b = this.blocks, list = [];
      if (this.emitters) for (var i = 0; i < b.length; i++) {
        var id = b[i];
        if (!EMITTER[id]) continue;
        if (id === B.LAVA) {
          var x = i & 15, z = (i >> 4) & 15, y = i >> 8, open = false;
          if (y + 1 >= H || !(b[i + LAYER] === B.LAVA || OPAQUE[b[i + LAYER]])) open = true;
          else if (x === 0 || x === 15 || z === 0 || z === 15) open = true;
          else {
            var n1 = b[i + 1], n2 = b[i - 1], n3 = b[i + CS], n4 = b[i - CS];
            open = !(n1 === B.LAVA || OPAQUE[n1]) || !(n2 === B.LAVA || OPAQUE[n2]) || !(n3 === B.LAVA || OPAQUE[n3]) || !(n4 === B.LAVA || OPAQUE[n4]);
          }
          if (!open) continue;
        }
        list.push(i);
      }
      this.emitList = list;
    }
    return this.emitList;
  };

  // ---- Мир ------------------------------------------------------------------------
  // dim — измерение (over, hell, heaven, space), type — вид обычного мира (city для зомби-режима)
  function World(seed, edits, dim, type) {
    this.seed = seed | 0;
    this.dim = dim || 'over';
    this.type = type || 'normal';
    this.noise = new KC.Noise(seed);
    this.caveNoise = new KC.Noise(seed + 1013);
    this.chunks = new Map();
    this.edits = edits || {};        // "cx,cz" → { индекс: id | meta<<8 }
    this.listener = null;            // (x, y, z, oldId, newId, oldMeta, newMeta) — для симуляции
    this.onChunkGenerated = null;    // (chunk) — для спавна животных
    this._col = { h: 0, biome: 0, forest: 0 };
    // под тонкими парящими островами Небес свет заходит сбоку — небо не гаснет до нуля
    this.skyFloor = this.dim === 'heaven' ? 0.55 : 0;
  }

  var BIOME_PLAINS = 0, BIOME_DESERT = 1, BIOME_SNOW = 2;
  World.BIOME_PLAINS = BIOME_PLAINS; World.BIOME_DESERT = BIOME_DESERT; World.BIOME_SNOW = BIOME_SNOW;

  World.prototype.getChunk = function (cx, cz) { return this.chunks.get(cx + ',' + cz); };

  World.prototype.getBlock = function (x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= H) return 0;
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    var c = this.chunks.get((x >> 4) + ',' + (z >> 4));
    return c ? c.blocks[(x & 15) + (z & 15) * CS + y * LAYER] : 0;
  };

  World.prototype.getMeta = function (x, y, z) {
    if (y < 0 || y >= H) return 0;
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    var c = this.chunks.get((x >> 4) + ',' + (z >> 4));
    return c ? c.meta[(x & 15) + (z & 15) * CS + y * LAYER] : 0;
  };

  World.prototype.isLoaded = function (x, z) {
    return this.chunks.has((Math.floor(x) >> 4) + ',' + (Math.floor(z) >> 4));
  };

  World.prototype._touch = function (c, lx, lz, light) {
    var list = [c], cx = c.cx, cz = c.cz, dx, dz, n;
    if (light) {
      for (dz = -1; dz <= 1; dz++) for (dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        n = this.chunks.get((cx + dx) + ',' + (cz + dz));
        if (n) list.push(n);
      }
    } else {
      var dxs = [0], dzs = [0];
      if (lx === 0) dxs.push(-1); else if (lx === 15) dxs.push(1);
      if (lz === 0) dzs.push(-1); else if (lz === 15) dzs.push(1);
      for (var i = 0; i < dxs.length; i++) for (var j = 0; j < dzs.length; j++) {
        if (!dxs[i] && !dzs[j]) continue;
        n = this.chunks.get((cx + dxs[i]) + ',' + (cz + dzs[j]));
        if (n) list.push(n);
      }
    }
    for (var k = 0; k < list.length; k++) list[k].dirty = true;
  };

  World.prototype._lightNear = function (cx, cz) {
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      var n = this.chunks.get((cx + dx) + ',' + (cz + dz));
      if (n && n.emitters) return true;
    }
    return false;
  };

  // Меняет блок (и метаданные), запоминает правку, помечает меши на перестройку
  World.prototype.setBlock = function (x, y, z, id, meta, quiet) {
    if (y < 0 || y >= H) return false;
    meta = meta | 0;
    var cx = x >> 4, cz = z >> 4, key = cx + ',' + cz;
    var c = this.chunks.get(key);
    if (!c) return false;
    var lx = x & 15, lz = z & 15, idx = lx + lz * CS + y * LAYER;
    var old = c.blocks[idx], oldMeta = c.meta[idx];
    if (old === id && oldMeta === meta) return false;
    c.blocks[idx] = id;
    c.meta[idx] = meta;
    if (EMITTER[old]) c.emitters--;
    if (EMITTER[id]) c.emitters++;
    if (EMITTER[old] || EMITTER[id]) c.emitList = null;
    if (LIGHTBLOCK[old] !== LIGHTBLOCK[id] || old === 0 || id === 0) c.recalcColumn(lx, lz);
    if (id && y > c.maxY) c.maxY = y;
    if (!this.edits[key]) this.edits[key] = {};
    this.edits[key][idx] = id | (meta << 8);
    this._touch(c, lx, lz, EMITTER[old] || EMITTER[id] || this._lightNear(cx, cz));
    if (!quiet && this.listener) this.listener(x, y, z, old, id, oldMeta, meta);
    return true;
  };

  World.prototype.setMeta = function (x, y, z, meta, quiet) {
    var c = this.chunks.get((x >> 4) + ',' + (z >> 4));
    if (!c || y < 0 || y >= H) return false;
    var idx = (x & 15) + (z & 15) * CS + y * LAYER;
    return this.setBlock(x, y, z, c.blocks[idx], meta, quiet);
  };

  World.prototype.hasNeighbors = function (cx, cz) {
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      if (!this.chunks.has((cx + dx) + ',' + (cz + dz))) return false;
    }
    return true;
  };

  // Небесный свет в точке (0…1) по карте высот — для мобов, спавна и частиц
  World.prototype.skyAt = function (x, y, z) {
    var c = this.chunks.get((Math.floor(x) >> 4) + ',' + (Math.floor(z) >> 4));
    if (!c) return 1;
    var hm = c.hmap[(Math.floor(x) & 15) + (Math.floor(z) & 15) * CS];
    return y >= hm ? 1 : Math.max(this.skyFloor || 0, 1 - (hm - y) * 0.13);
  };

  // Приближённый свет от блоков (0…15) без учёта стен — для спавна и освещения мобов
  World.prototype.blockLightAt = function (x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    var best = 0, cx0 = x >> 4, cz0 = z >> 4;
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      var c = this.chunks.get((cx0 + dx) + ',' + (cz0 + dz));
      if (!c || !c.emitters) continue;
      var bx = (cx0 + dx) * CS, bz = (cz0 + dz) * CS, list = c.emitterIndices();
      for (var k = 0; k < list.length; k++) {
        var i = list[k], yy = i >> 8;
        if (yy < y - 14 || yy > y + 14) continue;
        var e = KC.emission(c.blocks[i], c.meta[i]);
        if (!e) continue;
        var l = e - Math.abs(bx + (i & 15) - x) - Math.abs(yy - y) - Math.abs(bz + ((i >> 4) & 15) - z);
        if (l > best) best = l;
      }
    }
    return best;
  };

  // ---- Генерация ------------------------------------------------------------------
  World.prototype.column = function (x, z, out) {
    var n = this.noise;
    var cont = n.fbm2(x * 0.0035 + 0.37, z * 0.0035 + 0.71, 4);
    var hills = n.fbm2(x * 0.013 + 71.3, z * 0.013 - 33.1, 3);
    var mMask = smooth(0.08, 0.5, n.n2(x * 0.0021 + 400.7, z * 0.0021 - 250.3));
    var ridge = 1 - Math.abs(n.n2(x * 0.009 - 91.1, z * 0.009 + 17.9));
    ridge *= ridge;
    var h = 33 + cont * 16 + hills * 4 + mMask * (5 + ridge * 36);
    out.h = clamp(Math.floor(h), 3, H - 14);
    var temp = n.n2(x * 0.0019 + 900.1, z * 0.0019 - 700.3);
    if (out.h >= 66 || temp < -0.34) out.biome = BIOME_SNOW;
    else if (temp > 0.3) out.biome = BIOME_DESERT;
    else out.biome = BIOME_PLAINS;
    out.forest = n.n2(x * 0.011 + 12.3, z * 0.011 + 45.6);
    return out;
  };

  World.prototype.biomeAt = function (x, z) { return this.column(Math.floor(x), Math.floor(z), this._col).biome; };

  World.prototype.isCave = function (x, y, z) {
    var n = this.caveNoise;
    var a = n.n3(x * 0.045, y * 0.07, z * 0.045);
    var b = n.n3(x * 0.045 + 100.5, y * 0.07 + 50.5, z * 0.045 - 70.5);
    if (a * a + b * b < 0.0042) return true;
    return y < 26 && n.n3(x * 0.02 + 33.3, y * 0.05, z * 0.02 - 11.1) > 0.52;
  };

  // Руда кучками: одна ячейка 2×2×2 решает тип, внутри блоки заполняются частично
  World.prototype.oreAt = function (x, y, z) {
    var s = this.seed;
    var cellR = hash3(x >> 1, y >> 1, z >> 1, s + 501);
    if (hash3(x, y, z, s + 77) > 0.7) return 0;
    if (cellR < 0.02 && y < 80) return B.COAL_ORE;
    if (cellR < 0.031 && y < 50) return B.IRON_ORE;
    if (cellR < 0.035 && y < 30) return B.GOLD_ORE;
    if (cellR < 0.041 && y < 18) return B.SPARK_ORE;
    if (cellR < 0.0435 && y < 14) return B.DIAMOND_ORE;
    return 0;
  };

  World.prototype.generate = function (cx, cz) {
    var gen = this.dim !== 'over' ? KC.Gen[this.dim] : (this.type === 'city' ? KC.Gen.city : null);
    if (gen) {
      var gc = new Chunk(cx, cz);
      gen(this, gc);
      return this._finish(gc, null);
    }
    var c = new Chunk(cx, cz);
    var b = c.blocks, m = c.meta, seed = this.seed, self = this;
    var ox = cx * CS, oz = cz * CS;
    var G = 3, P = CS + G * 2;
    var hs = new Int16Array(P * P), bio = new Uint8Array(P * P), forest = new Float32Array(P * P);
    var col = this._col, x, y, z, i;

    for (z = 0; z < P; z++) for (x = 0; x < P; x++) {
      this.column(ox + x - G, oz + z - G, col);
      i = x + z * P;
      hs[i] = col.h; bio[i] = col.biome; forest[i] = col.forest;
    }
    function slopeAt(px, pz) {
      if (px < 1 || pz < 1 || px > P - 2 || pz > P - 2) return 0;
      var h0 = hs[px + pz * P];
      return Math.max(Math.abs(h0 - hs[px + 1 + pz * P]), Math.abs(h0 - hs[px - 1 + pz * P]),
        Math.abs(h0 - hs[px + (pz + 1) * P]), Math.abs(h0 - hs[px + (pz - 1) * P]));
    }
    function surface(px, pz, out) {
      var i2 = px + pz * P, top = hs[i2], bm = bio[i2];
      var wx = ox + px - G, wz = oz + pz - G;
      if (top < WL) {
        var nn = self.noise.n2(wx * 0.06 + 5.5, wz * 0.06 - 3.3);
        out.top = nn > 0.28 ? B.GRAVEL : (nn < -0.34 && top >= WL - 6 ? B.CLAY : B.SAND);
        out.sub = out.top === B.CLAY ? B.CLAY : B.SAND;
      } else if (bm === BIOME_DESERT || (top <= WL + 1 && bm !== BIOME_SNOW)) {
        out.top = B.SAND; out.sub = B.SAND;
      } else if (slopeAt(px, pz) >= 4) {
        out.top = B.STONE; out.sub = B.STONE;
      } else if (bm === BIOME_SNOW) {
        out.top = top >= 72 ? B.SNOW : B.SNOW_GRASS; out.sub = B.DIRT;
      } else {
        out.top = B.GRASS; out.sub = B.DIRT;
      }
      return out;
    }
    var surf = { top: 0, sub: 0 };

    // 1. Колонны: порода, руда, слои, поверхность, вода, пещеры и подземная лава
    for (z = 0; z < CS; z++) for (x = 0; x < CS; x++) {
      var pi = (x + G) + (z + G) * P, top = hs[pi], bm = bio[pi];
      var wx = ox + x, wz = oz + z;
      surface(x + G, z + G, surf);
      var shallow = top <= WL + 2;
      for (y = 0; y <= top; y++) {
        var id;
        if (y === 0) id = B.BEDROCK;
        else if (y <= 2 && hash3(wx, y, wz, seed) < (y === 1 ? 0.6 : 0.3)) id = B.BEDROCK;
        else if (y < top - 3) {
          id = B.STONE;
          if (bm === BIOME_DESERT && y >= top - 7) id = B.SANDSTONE;
          else { var o = self.oreAt(wx, y, wz); if (o) id = o; }
        } else if (y < top) id = surf.sub;
        else id = surf.top;
        if (y > 2 && id !== B.BEDROCK) {
          var limit = shallow ? top - 6 : top;
          if (y <= limit && self.isCave(wx, y, wz)) id = y <= 10 ? B.LAVA : 0;
        }
        b[x + z * CS + y * LAYER] = id;
      }
      for (y = top + 1; y <= WL; y++) b[x + z * CS + y * LAYER] = B.WATER;
    }

    // 2. Деревья и кактусы (кроны соседних колонн тоже, чтобы не обрезались)
    function put(lx, ly, lz, id, onlyAir, meta) {
      if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || ly < 0 || ly >= H) return;
      var k = lx + lz * CS + ly * LAYER;
      if (onlyAir && b[k] !== 0) return;
      b[k] = id; m[k] = meta | 0;
    }
    for (z = 1; z < P - 1; z++) for (x = 1; x < P - 1; x++) {
      var ci = x + z * P, t = hs[ci], bi = bio[ci];
      if (t <= WL + 1) continue;
      var gx = ox + x - G, gz = oz + z - G, lx = x - G, lz = z - G;
      var roll = hash2(gx, gz, seed + 3);
      surface(x, z, surf);
      if (bi === BIOME_DESERT) {
        if (surf.top === B.SAND && roll < 0.005 && !self.isCave(gx, t, gz)) {
          var chh = 1 + Math.floor(hash2(gx, gz, seed + 5) * 3);
          for (var cy = 1; cy <= chh; cy++) put(lx, t + cy, lz, B.CACTUS, false);
        }
        continue;
      }
      if (surf.top !== B.GRASS && surf.top !== B.SNOW_GRASS) continue;
      var density = 0.003 + clamp(forest[ci], 0, 1) * 0.07;
      if (bi === BIOME_SNOW) density *= 0.7;
      if (roll >= density || self.isCave(gx, t, gz)) {
        // реже деревьев: кусты, валуны и поваленные стволы
        var r2 = hash2(gx, gz, seed + 21);
        if (self.isCave(gx, t, gz)) continue;
        if (bi !== BIOME_SNOW && r2 < 0.003 + clamp(forest[ci], 0, 1) * 0.004) {
          put(lx, t + 1, lz, B.LOG, false);
          for (var by = 1; by <= 2; by++) for (var bz = -1; bz <= 1; bz++) for (var bx2 = -1; bx2 <= 1; bx2++) {
            if (by === 2 && Math.abs(bx2) + Math.abs(bz) > 1) continue;
            if (Math.abs(bx2) === 1 && Math.abs(bz) === 1 && hash3(gx + bx2, t + by, gz + bz, seed + 22) < 0.5) continue;
            put(lx + bx2, t + by, lz + bz, B.LEAVES, true, 0);
          }
        } else if (r2 > 0.9991) {
          for (var vy = -1; vy <= 1; vy++) for (var vz = -2; vz <= 2; vz++) for (var vx = -2; vx <= 2; vx++) {
            var vd = Math.sqrt(vx * vx + vy * vy * 1.6 + vz * vz) + hash3(gx + vx, t + vy, gz + vz, seed + 24) * 0.6;
            if (vd < 1.9) put(lx + vx, t + vy, lz + vz, hash3(gx + vx, t + vy, gz + vz, seed + 25) < 0.55 ? B.MOSSY_COBBLE : B.COBBLE, false);
          }
        } else if (r2 > 0.998 && forest[ci] > 0.15) {
          // бревно вдоль X или Z, только на ровной земле
          var alongX = hash2(gx, gz, seed + 26) < 0.5, flat = true, ll = 3;
          for (var li = 1; li <= ll; li++) {
            var qx = alongX ? x + li : x, qz = alongX ? z : z + li;
            if (qx >= P || qz >= P || hs[qx + qz * P] !== t) flat = false;
          }
          if (flat) for (li = 0; li <= ll; li++) put(alongX ? lx + li : lx, t + 1, alongX ? lz : lz + li, B.LOG, true, alongX ? 1 : 2);
        }
        continue;
      }
      // ели — в снегах и на высоких холмах
      if (bi === BIOME_SNOW || (t > 56 && hash2(gx, gz, seed + 23) < 0.55)) {
        var sth = 7 + Math.floor(hash2(gx, gz, seed + 9) * 4), stop = t + sth + 1;
        for (var si = 0; si <= sth - 2; si++) {
          var sy2 = stop - si, sr = si === 0 ? 0 : si === 1 ? 1 : (si % 2 === 0 ? 1 : 2) + (si > 5 ? 1 : 0);
          for (var sdz = -sr; sdz <= sr; sdz++) for (var sdx = -sr; sdx <= sr; sdx++) {
            if (Math.abs(sdx) + Math.abs(sdz) > sr + (sr > 1 ? 1 : 0)) continue;
            put(lx + sdx, sy2, lz + sdz, B.SPRUCE_LEAVES, true);
          }
        }
        for (var sty = 1; sty <= sth; sty++) put(lx, t + sty, lz, B.SPRUCE_LOG, false);
        continue;
      }
      var birch = hash2(gx, gz, seed + 7) < 0.28;
      var big = !birch && hash2(gx, gz, seed + 27) < 0.12;
      var th = (big ? 7 : 5) + Math.floor(hash2(gx, gz, seed + 9) * 3);
      var crown = t + th;
      for (var ly = crown - (big ? 3 : 2); ly <= crown + 1; ly++) {
        var rad = ly <= crown - 1 ? (big && ly <= crown - 2 ? 3 : 2) : 1;
        for (var dz = -rad; dz <= rad; dz++) for (var dx = -rad; dx <= rad; dx++) {
          var corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
          if (corner && (rad === 1 ? ly === crown + 1 : hash3(gx + dx, ly, gz + dz, seed) < 0.55)) continue;
          if (rad === 3 && Math.abs(dx) + Math.abs(dz) > 4) continue;
          put(lx + dx, ly, lz + dz, B.LEAVES, true, birch ? 1 : 0);
        }
      }
      for (var ty = 1; ty <= th; ty++) put(lx, t + ty, lz, birch ? B.BIRCH_LOG : B.LOG, false);
    }

    // 3. Трава, цветы, грибы, тыквы, тростник и кувшинки у воды, галька и листья на земле
    for (z = 0; z < CS; z++) for (x = 0; x < CS; x++) {
      var tI = (x + G) + (z + G) * P, tt = hs[tI];
      var pr = hash2(ox + x, oz + z, seed + 11);
      // кувшинки на мелкой воде
      if (tt < WL && tt >= WL - 3 && bio[tI] !== BIOME_SNOW && pr < 0.035 && b[x + z * CS + WL * LAYER] === B.WATER && b[x + z * CS + (WL + 1) * LAYER] === 0) {
        b[x + z * CS + (WL + 1) * LAYER] = B.LILY_PAD; m[x + z * CS + (WL + 1) * LAYER] = 3;
        continue;
      }
      if (tt < WL || tt + 3 >= H) continue;
      var topIdx = x + z * CS + tt * LAYER, above = topIdx + LAYER;
      var topId = b[topIdx];
      if (b[above] !== 0) continue;
      var pr2 = hash2(ox + x, oz + z, seed + 31);
      if (topId === B.SAND && bio[tI] === BIOME_DESERT && pr2 < 0.006) { b[above] = B.DEAD_BUSH; continue; }
      if ((topId === B.GRASS || topId === B.SAND || topId === B.GRAVEL || topId === B.STONE) && pr2 > 0.995) { b[above] = B.PEBBLES; m[above] = 3; continue; }
      // тростник: песок или трава на уровне моря рядом с водой
      if ((topId === B.SAND || topId === B.GRASS) && tt === WL) {
        var nearWater = hs[tI + 1] < WL || hs[tI - 1] < WL || hs[tI + P] < WL || hs[tI - P] < WL;
        if (nearWater && pr < 0.12) {
          var cane = 1 + Math.floor(hash2(ox + x, oz + z, seed + 13) * 3);
          for (var k2 = 1; k2 <= cane; k2++) b[topIdx + k2 * LAYER] = B.SUGAR_CANE;
          continue;
        }
      }
      if (topId === B.SNOW_GRASS && pr < 0.03) { b[above] = B.FERN; continue; }
      if (topId !== B.GRASS) continue;
      var fo = forest[tI], grassy = 0.06 + clamp(fo + 0.3, 0, 1) * 0.1;
      // в лесу под деревьями — папоротники, грибы и опавшие листья
      if (fo > 0.25 && pr2 < 0.04 + fo * 0.05) { b[above] = B.FALLEN_LEAVES; m[above] = 3; continue; }
      if (pr < grassy) b[above] = fo > 0.2 && hash2(ox + x, oz + z, seed + 33) < 0.45 ? B.FERN : B.TALL_GRASS;
      else if (pr < grassy + 0.007) b[above] = B.POPPY;
      else if (pr < grassy + 0.014) b[above] = B.DANDELION;
      else if (pr < grassy + 0.019) b[above] = B.CORNFLOWER;
      else if (pr < grassy + 0.0215) { b[above] = B.PUMPKIN; m[above] = Math.floor(hash2(ox + x, oz + z, seed + 17) * 4); }
      else if (pr < grassy + 0.028) b[above] = B.DAISY;
      else if (pr < grassy + 0.032) b[above] = B.BELLFLOWER;
      else if (fo > 0.2 && pr < grassy + 0.036) b[above] = hash2(ox + x, oz + z, seed + 35) < 0.4 ? B.MUSHROOM_RED : B.MUSHROOM_BROWN;
    }

    return this._finish(c, { hs: hs, bio: bio, G: G, P: P });
  };

  // Правки игрока поверх генерации, пересчёт карт и регистрация чанка
  World.prototype._finish = function (c, info) {
    var b = c.blocks, m = c.meta;
    var ed = this.edits[c.cx + ',' + c.cz];
    if (ed) for (var key in ed) { var v = ed[key]; b[+key] = v & 255; m[+key] = v >> 8; }
    c.recalcAll();
    this.chunks.set(c.cx + ',' + c.cz, c);
    if (this.onChunkGenerated) this.onChunkGenerated(c, info);
    return c;
  };

  World.prototype.findSpawn = function () {
    if (this.type === 'city' && this.dim === 'over') return KC.Gen.citySpawn();
    var col = { h: 0, biome: 0, forest: 0 };
    for (var r = 0; r < 400; r += 4) {
      for (var a = 0; a < 16; a++) {
        var ang = a / 16 * Math.PI * 2;
        var x = Math.round(Math.cos(ang) * r) + 8, z = Math.round(Math.sin(ang) * r) + 8;
        this.column(x, z, col);
        if (col.h > WL + 2 && col.h < 60 && col.biome === BIOME_PLAINS) return { x: x + 0.5, z: z + 0.5, h: col.h };
        if (r === 0) break;
      }
    }
    return { x: 8.5, z: 8.5, h: WL + 1 };
  };

  // ---- Формы: коллизии и рамки выделения (в долях блока) ---------------------------
  var FULL = [0, 0, 0, 1, 1, 1];
  function doorBox(meta) {
    var f = meta & 3;
    if (meta & 4) f = (f + 1) & 3;          // открытая дверь повёрнута
    var t = 3 / 16;
    switch (f) {
      case 0: return [0, 0, 1 - t, 1, 1, 1];
      case 1: return [0, 0, 0, t, 1, 1];
      case 2: return [0, 0, 0, 1, 1, t];
      default: return [1 - t, 0, 0, 1, 1, 1];
    }
  }
  // Коробка «прилеплённого» к опоре предмета: dir — направление на опору
  function attachedBox(dir, w, h, depth, y0) {
    var a = (8 - w / 2) / 16, bb = (8 + w / 2) / 16, d = depth / 16;
    var lo = y0 === undefined ? (8 - h / 2) / 16 : y0 / 16, hi = lo + h / 16;
    switch (dir) {
      case 0: return [1 - d, lo, a, 1, hi, bb];
      case 1: return [0, lo, a, d, hi, bb];
      case 4: return [a, lo, 1 - d, bb, hi, 1];
      case 5: return [a, lo, 0, bb, hi, d];
      case 2: return [a, 1 - d, a, bb, 1, bb];
      default: return [(8 - w / 2) / 16, 0, (8 - h / 2) / 16, (8 + w / 2) / 16, d, (8 + h / 2) / 16];
    }
  }

  // Поворот коробки модели (в 1/16, «лицом» к +Z) по meta 0–3 → доли блока
  function rotBox(bx, m) {
    var x0 = bx[0], z0 = bx[2], x1 = bx[3], z1 = bx[5], a, b, c, d;
    switch (m & 3) {
      case 1: a = 16 - z1; b = x0; c = 16 - z0; d = x1; break;
      case 2: a = 16 - x1; b = 16 - z1; c = 16 - x0; d = 16 - z0; break;
      case 3: a = z0; b = 16 - x1; c = z1; d = 16 - x0; break;
      default: a = x0; b = z0; c = x1; d = z1;
    }
    return [a / 16, bx[1] / 16, b / 16, c / 16, bx[4] / 16, d / 16];
  }
  var FRONT_BY_META = [4, 1, 5, 0];

  var POLE = [6 / 16, 0, 6 / 16, 10 / 16, 1, 10 / 16];
  function portalBox(meta) { return (meta & 1) ? [6 / 16, 0, 0, 10 / 16, 1, 1] : [0, 0, 6 / 16, 1, 1, 10 / 16]; }
  function collisionBox(id, meta) {
    var b = BLOCKS[id];
    if (!b || !KC.SOLID[id]) return null;
    switch (b.shape) {
      case 'pole': return POLE;
      case 'bed': return [0, 0, 0, 1, 9 / 16, 1];
      case 'chest': return [1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16];
      case 'cactus': return [1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16];
      case 'door': return doorBox(meta);
      case 'model': return rotBox(b.model.coll, meta);
      default: return FULL;
    }
  }

  function selectionBox(id, meta) {
    var b = BLOCKS[id];
    if (!b) return null;
    switch (b.shape) {
      case 'none': case 'liquid': return null;
      case 'cross': return id === B.SUGAR_CANE ? [2 / 16, 0, 2 / 16, 14 / 16, 1, 14 / 16] : [2 / 16, 0, 2 / 16, 14 / 16, 13 / 16, 14 / 16];
      case 'crop': return [0, 0, 0, 1, 0.25 + (meta & 7) / 10, 1];
      case 'torch':
        if ((meta & 7) === 3 || (meta & 7) === 2) return [6 / 16, 0, 6 / 16, 10 / 16, 10 / 16, 10 / 16];
        return attachedBox(meta & 7, 5, 11, 5, 3);
      case 'ladder': return attachedBox(meta & 7, 16, 16, 2);
      case 'wire': return [0, 0, 0, 1, 1 / 16, 1];
      case 'plate': return [1 / 16, 0, 1 / 16, 15 / 16, 1 / 16, 15 / 16];
      case 'lever': return attachedBox(meta & 7, 8, 8, 8);
      case 'button': return attachedBox(meta & 7, 6, 4, 2);
      case 'portal': return portalBox(meta);
      case 'pole': return POLE;
      case 'model': return rotBox(b.model.coll, meta);
      case 'decal': return attachedBox((meta & 7) > 5 ? 3 : meta & 7, 16, 16, 1);
      default: return collisionBox(id, meta) || FULL;
    }
  }

  // Прямоугольники коллизии в клетке (мировые координаты), добавляются в out
  World.prototype.collide = function (x, y, z, out) {
    var id = this.getBlock(x, y, z);
    if (!KC.SOLID[id]) return;
    var bx = collisionBox(id, this.getMeta(x, y, z));
    if (bx) out.push([x + bx[0], y + bx[1], z + bx[2], x + bx[3], y + bx[4], z + bx[5]]);
  };

  // ---- Мешер ----------------------------------------------------------------------
  var PW = CS + 2, PA = PW * PW, PH = H + 2;
  var pad = new Uint8Array(PA * PH), pmeta = new Uint8Array(PA * PH);
  var psky = new Float32Array(PA * PH), pblk = new Float32Array(PA * PH);
  var srcChunk = new Array(PA), srcCol = new Int32Array(PA);
  var FLOATS = 8; // x y z  u v  тень  небо  свет-блоков

  // Регион 3×3 чанка для заливки светом от блоков
  var RW = CS * 3, RA = RW * RW;
  var rlight = new Uint8Array(RA * H), queue = new Int32Array(RA * H);
  var LIGHT_CURVE = new Float32Array(16);
  for (var li = 0; li < 16; li++) LIGHT_CURVE[li] = Math.pow(li / 15, 1.45);

  // Материал вершины: от него в шейдере зависят анимация (ветер, волны, течение) и свечение
  var MAT = { SOLID: 0, PLANT: 1, LEAVES: 2, WATER: 3, LAVA: 4, GLOW: 5, PORTAL: 6, FIRE: 7, GLASS: 8, GRASS: 9, PLANT_GLOW: 10, METAL: 11, BLINK: 12 };
  var curMat = 0;
  // Первая «светотень» вершины упакована: материал × 2048 + нормаль × 256 + AO × 200
  // (нормаль 0…5 — грань в порядке FACES, 6 — плоские растения, освещённые со всех сторон)
  function pk(ao, n) { return curMat * 2048 + n * 256 + Math.min(255, Math.round(ao * 200)); }
  function matOf(id, bd, meta) {
    if (id === B.WATER) return MAT.WATER;
    if (id === B.LAVA) return MAT.LAVA;
    if (id === B.FIRE) return MAT.FIRE;
    if (bd.shape === 'portal') return MAT.PORTAL;
    if (bd.shape === 'cross' || bd.shape === 'crop') return bd.light ? MAT.PLANT_GLOW : MAT.PLANT;
    if (bd.leaves) return MAT.LEAVES;
    if (bd.shape === 'torch' || bd.glow || id === B.JACK || ((id === B.LAMP || id === B.LANDING_LIGHT) && (meta & 1)) ||
      (id === B.FURNACE && (meta & 4))) return MAT.GLOW;
    if (id === B.GRASS || id === B.GOLDEN_GRASS) return MAT.GRASS;
    if (bd.glass) return MAT.GLASS;
    if (bd.mat === 'metal') return MAT.METAL;
    return MAT.SOLID;
  }

  function Buf(q) { this.data = new Float32Array(q * 4 * FLOATS); this.n = 0; }
  Buf.prototype.reserve = function (q) {
    var need = this.n + q * 4 * FLOATS;
    if (need <= this.data.length) return;
    var nd = new Float32Array(Math.max(need, this.data.length * 2));
    nd.set(this.data.subarray(0, this.n));
    this.data = nd;
  };
  Buf.prototype.v = function (x, y, z, u, v, l, s, bl) {
    var d = this.data, n = this.n;
    d[n] = x; d[n + 1] = y; d[n + 2] = z; d[n + 3] = u; d[n + 4] = v; d[n + 5] = l; d[n + 6] = s; d[n + 7] = bl;
    this.n = n + 8;
  };
  var opaqueBuf = new Buf(40000), waterBuf = new Buf(8000);

  var FACES = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], o: [1, 0, 1], shade: 0.74, tile: 'side', na: 0, ns: 1, ua: 2, us: -1, va: 1, vs: 1 },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], o: [0, 0, 0], shade: 0.74, tile: 'side', na: 0, ns: -1, ua: 2, us: 1, va: 1, vs: 1 },
    { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], o: [0, 1, 0], shade: 1.0, tile: 'top', na: 1, ns: 1, ua: 2, us: 1, va: 0, vs: 1 },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], o: [0, 0, 0], shade: 0.52, tile: 'bottom', na: 1, ns: -1, ua: 0, us: 1, va: 2, vs: 1 },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], o: [0, 0, 1], shade: 0.86, tile: 'side', na: 2, ns: 1, ua: 0, us: 1, va: 1, vs: 1 },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], o: [1, 0, 0], shade: 0.86, tile: 'side', na: 2, ns: -1, ua: 0, us: -1, va: 1, vs: 1 }
  ];
  function off(v) { return v[0] + v[2] * PW + v[1] * PA; }
  FACES.forEach(function (f, i) { f.no = off(f.n); f.uo = off(f.u); f.vo = off(f.v); f.idx = i; });
  var AO_CURVE = [0.46, 0.66, 0.83, 1.0];
  var CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
  var UVS = [];
  for (var t = 0; t < 512; t++) UVS.push(KC.tileUV(t));      // атлас 16×32 плиток
  var WHEAT_TILE = [T.wheat0, T.wheat0, T.wheat1, T.wheat1, T.wheat2, T.wheat2, T.wheat3, T.wheat4];

  // Плитка грани с учётом состояния блока
  function faceTile(b, id, meta, f) {
    var tl = b.tiles, key = FACES[f].tile;
    switch (id) {
      case B.FURNACE: if (f === FACING_FACE[meta & 3]) return meta & 4 ? T.furnaceLit : tl.front; break;
      case B.CHEST: case B.PUMPKIN: case B.JACK: case B.TABLE: case B.CONSOLE:
        if (f === FACING_FACE[meta & 3]) return tl.front; break;
      case B.ROAD_LINE: if (f === 2) return meta === 1 ? T.roadLineZ : meta === 2 ? T.crosswalk : T.roadLineX; break;
      case B.LAMP: return meta & 1 ? T.lampOn : T.lampOff;
      case B.LANDING_LIGHT: return meta & 1 ? T.landingOn : T.landingOff;
      case B.GENERATOR: if (f === FACING_FACE[meta & 3]) return meta & 4 ? T.generatorOn : tl.front; break;
      case B.RAIL_FLOOR: if (f === 2) return meta & 1 ? T.railZ : T.railX; break;
      case B.FARMLAND: if (f === 2) return meta & 1 ? T.farmlandWet : T.farmland; break;
      // лежачее бревно: meta 1 — вдоль X, 2 — вдоль Z
      case B.LOG: case B.BIRCH_LOG: case B.SPRUCE_LOG:
        if ((meta & 3) === 1) return f === 0 || f === 1 ? tl.top : tl.side;
        if ((meta & 3) === 2) return f === 4 || f === 5 ? tl.top : tl.side;
        break;
      case B.PISTON:
        var pf = meta & 7;
        if (f === pf) return meta & 8 ? T.pistonInner : T.pistonFace;
        if (f === (pf ^ 1)) return T.pistonBack;
        return T.pistonSide;
    }
    return tl[key];
  }

  // Случайный поворот текстуры по координатам — меньше заметных повторов у природных блоков
  var ROT = new Uint8Array(256);   // 1 — только верх, 2 — все грани
  [B.GRASS, B.SNOW_GRASS, B.GOLDEN_GRASS].forEach(function (id) { ROT[id] = 1; });
  [B.DIRT, B.SAND, B.GRAVEL, B.STONE, B.SNOW, B.CLAY, B.COBBLE, B.MOSSY_COBBLE, B.ASPHALT, B.ASHSTONE, B.ASH_BLOCK,
    B.CLOUD, B.LIGHT_SOIL, B.RUBBLE, B.ASTEROID, B.MAGMA, B.OBSIDIAN, B.LEAVES, B.SPRUCE_LEAVES].forEach(function (id) { ROT[id] = 2; });
  function hashI(x, y, z) {
    var h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  World.prototype.buildMesh = function (chunk) {
    var cx = chunk.cx, cz = chunk.cz, x, y, z, i;
    var ox = cx * CS, oz = cz * CS;
    var nbs = [], emitters = 0;
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      var nb = this.chunks.get((cx + dx) + ',' + (cz + dz)) || null;
      nbs.push(nb);
      if (nb) emitters += nb.emitters;
    }
    var maxY = 0;
    for (i = 0; i < 9; i++) if (nbs[i] && nbs[i].maxY > maxY) maxY = nbs[i].maxY;
    var topY = Math.min(H - 1, maxY + 1);

    // Свет от блоков: заливка по региону 3×3 чанка. Стартуем от списков светильников
    // и работаем только в полосе высот вокруг них — обычно это узкий слой.
    var hasBlockLight = false;
    var regTop = Math.min(H - 1, maxY + 1), bandLo = H, bandHi = -1;
    if (emitters > 0) {
      var qh = 0, qt = 0, seeds = [];
      for (var ci = 0; ci < 9; ci++) {
        var src = nbs[ci];
        if (!src || !src.emitters) continue;
        var bx = (ci % 3) * CS, bz = Math.floor(ci / 3) * CS, elist = src.emitterIndices();
        for (var ei = 0; ei < elist.length; ei++) {
          var idx = elist[ei], ey = idx >> 8;
          if (ey > regTop) continue;
          var ex = bx + (idx & 15), ez = bz + ((idx >> 4) & 15);
          // дальше 15 блоков от нашего чанка свет не дотянется
          var ox2 = ex < CS ? CS - ex : ex >= 2 * CS ? ex - 2 * CS + 1 : 0;
          var oz2 = ez < CS ? CS - ez : ez >= 2 * CS ? ez - 2 * CS + 1 : 0;
          if (ox2 + oz2 > 14) continue;
          var e = KC.emission(src.blocks[idx], src.meta[idx]);
          if (!e) continue;
          seeds.push(ex + ez * RW + ey * RA, e);
          if (ey < bandLo) bandLo = ey;
          if (ey > bandHi) bandHi = ey;
        }
      }
      if (seeds.length) {
        hasBlockLight = true;
        bandLo = Math.max(0, bandLo - 15); bandHi = Math.min(regTop, bandHi + 15);
        rlight.fill(0, bandLo * RA, (bandHi + 1) * RA);
        for (var si = 0; si < seeds.length; si += 2) {
          if (rlight[seeds[si]] < seeds[si + 1]) { rlight[seeds[si]] = seeds[si + 1]; queue[qt++] = seeds[si]; }
        }
        var opq = function (rx, ry, rz) {
          var c = nbs[(rx >> 4) + (rz >> 4) * 3];
          return c ? OPAQUE[c.blocks[(rx & 15) + (rz & 15) * CS + ry * LAYER]] : 0;
        };
        while (qh < qt) {
          var qi = queue[qh++], lv = rlight[qi];
          if (lv <= 1) continue;
          var qy = (qi / RA) | 0, rem = qi - qy * RA, qz = (rem / RW) | 0, qx = rem - qz * RW;
          var nl = lv - 1, ni;
          if (qx > 0) { ni = qi - 1; if (rlight[ni] < nl && !opq(qx - 1, qy, qz)) { rlight[ni] = nl; queue[qt++] = ni; } }
          if (qx < RW - 1) { ni = qi + 1; if (rlight[ni] < nl && !opq(qx + 1, qy, qz)) { rlight[ni] = nl; queue[qt++] = ni; } }
          if (qz > 0) { ni = qi - RW; if (rlight[ni] < nl && !opq(qx, qy, qz - 1)) { rlight[ni] = nl; queue[qt++] = ni; } }
          if (qz < RW - 1) { ni = qi + RW; if (rlight[ni] < nl && !opq(qx, qy, qz + 1)) { rlight[ni] = nl; queue[qt++] = ni; } }
          if (qy > bandLo) { ni = qi - RA; if (rlight[ni] < nl && !opq(qx, qy - 1, qz)) { rlight[ni] = nl; queue[qt++] = ni; } }
          if (qy < bandHi) { ni = qi + RA; if (rlight[ni] < nl && !opq(qx, qy + 1, qz)) { rlight[ni] = nl; queue[qt++] = ni; } }
          if (qt >= queue.length - 8) break;
        }
      }
    }

    for (z = 0; z < PW; z++) for (x = 0; x < PW; x++) {
      var sx = x - 1, sz = z - 1;
      var ncx = sx < 0 ? 0 : sx >= CS ? 2 : 1, ncz = sz < 0 ? 0 : sz >= CS ? 2 : 1;
      var pc = x + z * PW;
      srcChunk[pc] = nbs[ncx + ncz * 3];
      srcCol[pc] = ((sx + CS) & 15) + ((sz + CS) & 15) * CS;
    }
    var fillTop = Math.min(PH - 1, topY + 2), skyFloor = this.skyFloor || 0;
    for (var pcol = 0; pcol < PA; pcol++) {
      var s2 = srcChunk[pcol], sc = srcCol[pcol];
      var hm = s2 ? s2.hmap[sc] : 0;
      var rcol = ((pcol % PW) + CS - 1) + (((pcol / PW) | 0) + CS - 1) * RW;
      pad[pcol] = B.STONE; pmeta[pcol] = 0; psky[pcol] = 0; pblk[pcol] = 0;
      for (var py = 1; py <= fillTop; py++) {
        var wy = py - 1, pidx = pcol + py * PA;
        if (s2 && wy < H) { pad[pidx] = s2.blocks[sc + wy * LAYER]; pmeta[pidx] = s2.meta[sc + wy * LAYER]; }
        else { pad[pidx] = 0; pmeta[pidx] = 0; }
        psky[pidx] = wy >= hm ? 1 : Math.max(skyFloor, 1 - (hm - wy) * 0.13);
        pblk[pidx] = hasBlockLight && wy >= bandLo && wy <= bandHi ? LIGHT_CURVE[rlight[rcol + wy * RA]] : 0;
      }
      for (py = fillTop + 1; py < PH; py++) { pad[pcol + py * PA] = 0; psky[pcol + py * PA] = 1; pblk[pcol + py * PA] = 0; }
    }

    var ob = opaqueBuf, wb = waterBuf;
    ob.n = 0; wb.n = 0;
    for (y = 0; y <= topY; y++) for (z = 0; z < CS; z++) for (x = 0; x < CS; x++) {
      var p = (x + 1) + (z + 1) * PW + (y + 1) * PA;
      var id = pad[p];
      if (!id) continue;
      var bd = BLOCKS[id], meta = pmeta[p];
      var wx = ox + x, wz = oz + z;
      curMat = matOf(id, bd, meta);
      switch (bd.shape) {
        case 'cube': case 'cactus':
          // Сами светильники горят ровно, без теней (печь светит только наружу)
          var glow = bd.glow || id === B.JACK || ((id === B.LAMP || id === B.LANDING_LIGHT) && (meta & 1)) ? 1 : 0;
          for (var f = 0; f < 6; f++) {
            var face = FACES[f], nid = pad[p + face.no];
            if (bd.glass) { if (OPAQUE[nid] || nid === id) continue; }
            else if (OPAQUE[nid]) continue;
            if (f === 3 && y === 0) continue;
            if (bd.shape === 'cactus' && f !== 2 && f !== 3) {
              emitBox(ob, wx, y, wz, [1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16], [f], bd.tiles.side, p, 1);
              continue;
            }
            var rt = ROT[id] === 2 || (ROT[id] === 1 && f === 2) ? (hashI(wx, y, wz) >>> (f * 2)) & 3 : 0;
            emitFace(ob, face, faceTile(bd, id, meta, f), p, wx, y, wz, false, 0, glow, rt);
          }
          break;
        case 'liquid': emitLiquid(id === B.LAVA ? ob : wb, bd, id, meta, p, wx, y, wz); break;
        case 'cross':
          var ct = id === B.SAPLING && (meta & 1) ? T.saplingBirch : bd.tiles.side;
          emitCross(ob, wx, y, wz, UVS[ct], psky[p], pblk[p], id === B.SUGAR_CANE ? 0 : 0.15);
          break;
        case 'crop': emitCrop(ob, wx, y, wz, UVS[WHEAT_TILE[meta & 7]], psky[p], pblk[p]); break;
        default: emitShape(ob, bd, id, meta, p, wx, y, wz); break;
      }
    }
    return { opaque: ob.data.subarray(0, ob.n), opaqueQuads: ob.n / (4 * FLOATS),
      water: wb.data.subarray(0, wb.n), waterQuads: wb.n / (4 * FLOATS), topY: topY };
  };

  function emitFace(buf, face, tile, p, wx, wy, wz, liquid, topH, glow, rot) {
    buf.reserve(1);
    var uv = UVS[tile], a = p + face.no, k;
    var ao = [3, 3, 3, 3], sky = [1, 1, 1, 1], blk = [0, 0, 0, 0];
    for (k = 0; k < 4; k++) {
      var cu = CORNERS[k][0] ? 1 : -1, cv = CORNERS[k][1] ? 1 : -1;
      var i1 = a + cu * face.uo, i2 = a + cv * face.vo, i3 = i1 + cv * face.vo;
      if (!liquid) {
        var s1 = OCCLUDE[pad[i1]], s2 = OCCLUDE[pad[i2]], s3 = OCCLUDE[pad[i3]];
        ao[k] = (s1 && s2) ? 0 : 3 - s1 - s2 - s3;
      }
      var sum = psky[a], bs = pblk[a], cnt = 1;
      if (!OPAQUE[pad[i1]]) { sum += psky[i1]; bs += pblk[i1]; cnt++; }
      if (!OPAQUE[pad[i2]]) { sum += psky[i2]; bs += pblk[i2]; cnt++; }
      if (!OPAQUE[pad[i3]]) { sum += psky[i3]; bs += pblk[i3]; cnt++; }
      sky[k] = sum / cnt;
      blk[k] = glow ? 1 : bs / cnt;
    }
    var start = (ao[1] + ao[3] < ao[0] + ao[2]) ? 1 : 0;
    var u = face.u, v = face.v, o = face.o;
    for (var q = 0; q < 4; q++) {
      k = (start + q) & 3;
      var ci = CORNERS[k][0], cj = CORNERS[k][1];
      var px = wx + o[0] + u[0] * ci + v[0] * cj;
      var py = wy + o[1] + u[1] * ci + v[1] * cj;
      var pz = wz + o[2] + u[2] * ci + v[2] * cj;
      if (liquid && py > wy + 0.5) py = wy + topH;
      var rk = rot ? (k + rot) & 3 : k;
      buf.v(px, py, pz, CORNERS[rk][0] ? uv[2] : uv[0], CORNERS[rk][1] ? uv[1] : uv[3], pk(AO_CURVE[ao[k]], face.idx), sky[k], blk[k]);
    }
  }

  // Высота поверхности жидкости: источник и падающая — почти полный блок
  function liquidHeight(meta) {
    if (meta & 8) return 1;
    var lvl = meta & 7;
    return lvl === 0 ? 0.875 : Math.max(0.1, (8 - lvl) / 9);
  }

  function emitLiquid(buf, bd, id, meta, p, wx, wy, wz) {
    var above = pad[p + PA];
    var topH = above === id ? 1 : liquidHeight(meta);
    var glow = id === B.LAVA ? 1 : 0;
    for (var f = 0; f < 6; f++) {
      var face = FACES[f], nid = pad[p + face.no];
      if (nid === id || OPAQUE[nid]) {
        // над более низкой соседней жидкостью показываем «ступеньку»
        if (!(nid === id && f !== 2 && f !== 3 && topH > liquidHeight(pmeta[p + face.no]) + 0.05 && pad[p + face.no + PA] !== id)) continue;
      }
      if (f === 3 && wy === 0) continue;
      emitFace(buf, face, bd.tiles.side, p, wx, wy, wz, true, topH, glow);
    }
  }

  function emitCross(buf, wx, wy, wz, uv, sky, blk, inset) {
    buf.reserve(4);
    var l = 0.92, i = inset, j = 1 - inset;
    var planes = [[[wx + i, wz + i], [wx + j, wz + j]], [[wx + j, wz + i], [wx + i, wz + j]]];
    for (var p = 0; p < 2; p++) {
      var A = planes[p][0], Bp = planes[p][1];
      quad2(buf, A, Bp, wy, wy + 1, uv, l, sky, blk);
    }
  }
  // Двусторонний вертикальный квадрат между точками A и B
  function quad2(buf, A, Bp, y0, y1, uv, l, sky, blk) {
    l = pk(l, 6);
    buf.v(A[0], y0, A[1], uv[0], uv[3], l, sky, blk);
    buf.v(Bp[0], y0, Bp[1], uv[2], uv[3], l, sky, blk);
    buf.v(Bp[0], y1, Bp[1], uv[2], uv[1], l, sky, blk);
    buf.v(A[0], y1, A[1], uv[0], uv[1], l, sky, blk);
    buf.v(Bp[0], y0, Bp[1], uv[2], uv[3], l, sky, blk);
    buf.v(A[0], y0, A[1], uv[0], uv[3], l, sky, blk);
    buf.v(A[0], y1, A[1], uv[0], uv[1], l, sky, blk);
    buf.v(Bp[0], y1, Bp[1], uv[2], uv[1], l, sky, blk);
  }
  function emitCrop(buf, wx, wy, wz, uv, sky, blk) {
    buf.reserve(8);
    [0.25, 0.75].forEach(function (d) {
      quad2(buf, [wx + d, wz], [wx + d, wz + 1], wy, wy + 1, uv, 0.9, sky, blk);
      quad2(buf, [wx, wz + d], [wx + 1, wz + d], wy, wy + 1, uv, 0.9, sky, blk);
    });
  }

  // Коробка с UV «по положению в блоке»: box в долях блока, faces — какие грани рисовать
  // uvOver: { грань: [u0, v0, u1, v1] в пикселях плитки }, rotTop — поворот верхней грани
  function emitBox(buf, wx, wy, wz, box, faces, tiles, p, shadeMul, uvOver, rotTop) {
    buf.reserve(faces.length);
    var sky = psky[p], blk = pblk[p];
    for (var fi = 0; fi < faces.length; fi++) {
      var f = faces[fi], face = FACES[f];
      var tile = typeof tiles === 'number' ? tiles : tiles[f];
      if (tile === undefined || tile === null) continue;
      var uv = UVS[tile], ov = uvOver && uvOver[f];
      var shade = pk(shadeMul || 1, f);
      for (var k = 0; k < 4; k++) {
        var ci = CORNERS[k][0], cj = CORNERS[k][1];
        var pt = [0, 0, 0];
        pt[face.na] = face.ns > 0 ? box[face.na + 3] : box[face.na];
        pt[face.ua] = ((face.us > 0) === (ci === 1)) ? box[face.ua + 3] : box[face.ua];
        pt[face.va] = ((face.vs > 0) === (cj === 1)) ? box[face.va + 3] : box[face.va];
        var uu = face.us > 0 ? pt[face.ua] : 1 - pt[face.ua];
        var vv = face.vs > 0 ? pt[face.va] : 1 - pt[face.va];
        if (ov) { uu = (ov[0] + (ov[2] - ov[0]) * ci) / 16; vv = 1 - (ov[1] + (ov[3] - ov[1]) * (1 - cj)) / 16; }
        if (f === 2 && rotTop) {
          for (var r = 0; r < rotTop; r++) { var tmp = uu; uu = vv; vv = 1 - tmp; }
        }
        var tu = uv[0] + (uv[2] - uv[0]) * uu, tv = uv[3] - (uv[3] - uv[1]) * vv;
        buf.v(wx + pt[0], wy + pt[1], wz + pt[2], tu, tv, shade, sky, blk);
      }
    }
  }

  var ALL = [0, 1, 2, 3, 4, 5];
  function emitShape(buf, bd, id, meta, p, wx, wy, wz) {
    var tl = bd.tiles, dir = meta & 7, box, tiles;
    if (dir > 5) dir = 3;
    switch (bd.shape) {
      case 'torch':
        var tt = id === B.SPARK_TORCH ? ((meta & 8) ? T.sparkTorchOff : T.sparkTorchOn) : T.torch;
        var over = { 2: [7, 4, 9, 6], 3: [7, 14, 9, 16] };
        if (dir === 3 || dir === 2) box = [7 / 16, 0, 7 / 16, 9 / 16, 12 / 16, 9 / 16];
        else {
          var d = DIRS[dir];
          var cxp = 7 / 16 + d[0] * 6 / 16, czp = 7 / 16 + d[2] * 6 / 16;
          box = [cxp, 4 / 16, czp, cxp + 2 / 16, 16 / 16, czp + 2 / 16];
        }
        var sideOver = {};
        [0, 1, 4, 5].forEach(function (f) { sideOver[f] = [7, 4, 9, 16]; });
        sideOver[2] = over[2]; sideOver[3] = over[3];
        emitBox(buf, wx, wy, wz, box, ALL, tt, p, 1.05, sideOver);
        break;
      case 'ladder':
        var ld = DIRS[dir], e = 1 / 16;
        var A, Bp;
        if (ld[0]) { var lx = ld[0] > 0 ? 1 - e : e; A = [wx + lx, wz]; Bp = [wx + lx, wz + 1]; }
        else { var lz = ld[2] > 0 ? 1 - e : e; A = [wx, wz + lz]; Bp = [wx + 1, wz + lz]; }
        buf.reserve(2);
        quad2(buf, A, Bp, wy, wy + 1, UVS[T.ladder], 0.9, psky[p], pblk[p]);
        break;
      case 'wire':
        buf.reserve(1);
        var wuv = UVS[(meta & 15) ? T.wireOn : T.wireOff], yy = wy + 0.02;
        var wl = pk(1, 2), sk = psky[p], bl = Math.max(pblk[p], (meta & 15) / 30);
        buf.v(wx, yy, wz, wuv[0], wuv[3], wl, sk, bl);
        buf.v(wx, yy, wz + 1, wuv[2], wuv[3], wl, sk, bl);
        buf.v(wx + 1, yy, wz + 1, wuv[2], wuv[1], wl, sk, bl);
        buf.v(wx + 1, yy, wz, wuv[0], wuv[1], wl, sk, bl);
        break;
      case 'plate':
        box = [1 / 16, 0, 1 / 16, 15 / 16, (meta & 1) ? 0.5 / 16 : 1 / 16, 15 / 16];
        emitBox(buf, wx, wy, wz, box, ALL, T.stone, p);
        break;
      case 'button':
        emitBox(buf, wx, wy, wz, attachedBox(dir, 6, 4, (meta & 8) ? 1 : 2), ALL, T.stone, p);
        break;
      case 'lever':
        var base = attachedBox(dir, 6, 8, 3);
        emitBox(buf, wx, wy, wz, base, ALL, T.cobble, p);
        var on = meta & 8, hb;
        if (dir === 3) hb = [7 / 16, 3 / 16, on ? 9 / 16 : 5 / 16, 9 / 16, 11 / 16, on ? 11 / 16 : 7 / 16];
        else {
          var ddd = DIRS[dir], hx = 7 / 16 + ddd[0] * 4 / 16, hz = 7 / 16 + ddd[2] * 4 / 16;
          hb = [hx, on ? 3 / 16 : 7 / 16, hz, hx + 2 / 16, on ? 9 / 16 : 13 / 16, hz + 2 / 16];
        }
        emitBox(buf, wx, wy, wz, hb, ALL, T.planks, p);
        break;
      case 'door':
        box = doorBox(meta);
        tiles = (meta & 8) ? tl.top : tl.side;
        emitBox(buf, wx, wy, wz, box, ALL, tiles, p);
        break;
      case 'bed':
        tiles = [tl.side, tl.side, tl.top, tl.bottom, tl.side, tl.side];
        emitBox(buf, wx, wy, wz, [0, 0, 0, 1, 9 / 16, 1], ALL, tiles, p, 1, null, [2, 1, 0, 3][meta & 3]);
        break;
      case 'chest':
        tiles = [];
        for (var f = 0; f < 6; f++) tiles[f] = f === 2 || f === 3 ? tl.top : (f === FACING_FACE[meta & 3] ? tl.front : tl.side);
        emitBox(buf, wx, wy, wz, [1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16], ALL, tiles, p);
        break;
      case 'portal':
        emitBox(buf, wx, wy, wz, portalBox(meta), ALL, tl.side, p, 1.3);
        break;
      case 'pole':
        emitBox(buf, wx, wy, wz, POLE, ALL, tl.side, p);
        break;
      case 'model':
        // объект из коробок, повёрнутый по meta; у коробки — плитки боков, верха и «лица»
        var md = bd.model, mr = meta & 3, fr = FRONT_BY_META[mr], saveMat = curMat;
        for (var bi = 0; bi < md.boxes.length; bi++) {
          var bxs = md.boxes[bi], tt6 = bxs[6], t6 = [tt6.side, tt6.side, tt6.top, tt6.top, tt6.side, tt6.side];
          t6[fr] = tt6.front;
          curMat = bxs[7] === 'blink' ? MAT.BLINK : bxs[7] === 'glow' ? MAT.GLOW : saveMat;
          emitBox(buf, wx, wy, wz, rotBox(bxs, mr), ALL, t6, p);
        }
        curMat = saveMat;
        break;
      case 'decal':
        // плоская картинка у грани опоры; вариант рисунка — по координатам
        var vt = bd.variants ? bd.variants[hashI(wx, wy, wz) % bd.variants.length] : tl.side, ee = 0.012, db;
        switch (dir) {
          case 0: db = [1 - ee, 0, 0, 1, 1, 1]; break;
          case 1: db = [0, 0, 0, ee, 1, 1]; break;
          case 2: db = [0, 1 - ee, 0, 1, 1, 1]; break;
          case 4: db = [0, 0, 1 - ee, 1, 1, 1]; break;
          case 5: db = [0, 0, 0, 1, 1, ee]; break;
          default: db = id === B.LILY_PAD ? [0, -0.125, 0, 1, -0.11, 1] : [0, 0, 0, 1, ee, 1];
        }
        emitBox(buf, wx, wy, wz, db, [dir ^ 1], vt, p);
        break;
      case 'pistonHead':
        var hd = DIRS[dir], pb = [0, 0, 0, 1, 1, 1], arm = [6 / 16, 6 / 16, 6 / 16, 10 / 16, 10 / 16, 10 / 16];
        for (var ax = 0; ax < 3; ax++) {
          if (hd[ax] > 0) { pb[ax] = 12 / 16; arm[ax] = 0; arm[ax + 3] = 12 / 16; }
          else if (hd[ax] < 0) { pb[ax + 3] = 4 / 16; arm[ax] = 4 / 16; arm[ax + 3] = 1; }
        }
        emitBox(buf, wx, wy, wz, pb, ALL, T.pistonFace, p);
        emitBox(buf, wx, wy, wz, arm, ALL, T.planks, p);
        break;
    }
  }

  KC.CS = CS;
  KC.H = H;
  KC.WL = WL;
  KC.FLOATS = FLOATS;
  KC.MAT = MAT;
  // Освещение кадра: его заполняет game.js, читают шейдеры и сущности (свет мобов считается на процессоре)
  KC.Light = {
    sunDir: [0.3, 0.9, 0.3], sunCol: [0.52, 0.5, 0.46], ambTop: [0.56, 0.61, 0.7], ambBot: [0.38, 0.4, 0.44],
    ambCave: [0.045, 0.05, 0.06], blockCol: [1.0, 0.82, 0.6], skyDep: 1, bright: 0, fogSun: [0.8, 0.8, 0.8],
    wind: 1, time: 0
  };
  KC.DIRS = DIRS;
  KC.FACING_FACE = FACING_FACE;
  KC.EMITTER = EMITTER;
  KC.collisionBox = collisionBox;
  KC.selectionBox = selectionBox;
  KC.liquidHeight = liquidHeight;
  KC.World = World;
})(window.KC = window.KC || {});
