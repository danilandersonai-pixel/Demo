/* Кубокрафт — мир: генерация чанков, хранение правок игрока и построение мешей.
   Чанк — колонна 16×16×H блоков. Индекс блока: x + z*16 + y*256. */
(function (KC) {
  'use strict';

  var B = KC.B, BLOCKS = KC.BLOCKS;
  var OPAQUE = KC.OPAQUE, OCCLUDE = KC.OCCLUDE, LIGHTBLOCK = KC.LIGHTBLOCK, CROSS = KC.CROSS;
  var hash2 = KC.hash2, hash3 = KC.hash3;

  var CS = 16;          // размер чанка по X/Z
  var H = 96;           // высота мира
  var WL = 30;          // уровень моря (вода заполняет y ≤ WL)
  var LAYER = CS * CS;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  function Chunk(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = new Uint8Array(LAYER * H);
    this.hmap = new Uint8Array(LAYER);   // первая высота над верхним блоком, перекрывающим небо
    this.maxY = 0;                       // самый высокий непустой блок
    this.mesh = null;                    // GPU-буферы (заполняет рендерер)
    this.dirty = true;
  }

  Chunk.prototype.recalcColumn = function (x, z) {
    var b = this.blocks, h = 0;
    for (var y = H - 1; y >= 0; y--) {
      if (LIGHTBLOCK[b[x + z * CS + y * LAYER]]) { h = y + 1; break; }
    }
    this.hmap[x + z * CS] = h;
  };

  Chunk.prototype.recalcAll = function () {
    var maxY = 0, b = this.blocks;
    for (var z = 0; z < CS; z++) for (var x = 0; x < CS; x++) this.recalcColumn(x, z);
    for (var y = H - 1; y >= 0 && !maxY; y--) {
      var base = y * LAYER;
      for (var i = 0; i < LAYER; i++) if (b[base + i]) { maxY = y; break; }
    }
    this.maxY = maxY;
  };

  // ---- Мир ------------------------------------------------------------------
  function World(seed, edits) {
    this.seed = seed | 0;
    this.noise = new KC.Noise(seed);
    this.caveNoise = new KC.Noise(seed + 1013);
    this.chunks = new Map();
    this.edits = edits || {};   // "cx,cz" → { индекс: id }
    this.editsDirty = false;
    this._col = { h: 0, biome: 0, forest: 0 };
  }

  var BIOME_PLAINS = 0, BIOME_DESERT = 1, BIOME_SNOW = 2;

  World.prototype.key = function (cx, cz) { return cx + ',' + cz; };
  World.prototype.getChunk = function (cx, cz) { return this.chunks.get(cx + ',' + cz); };

  World.prototype.getBlock = function (x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= H) return 0;
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    var c = this.chunks.get((x >> 4) + ',' + (z >> 4));
    if (!c) return 0;
    return c.blocks[(x & 15) + (z & 15) * CS + y * LAYER];
  };

  World.prototype.isLoaded = function (x, z) {
    return this.chunks.has((Math.floor(x) >> 4) + ',' + (Math.floor(z) >> 4));
  };

  // Меняет блок, запоминает правку и помечает чанки на перестройку.
  // Возвращает список затронутых чанков.
  World.prototype.setBlock = function (x, y, z, id) {
    if (y < 0 || y >= H) return [];
    var cx = x >> 4, cz = z >> 4, key = cx + ',' + cz;
    var c = this.chunks.get(key);
    if (!c) return [];
    var lx = x & 15, lz = z & 15, idx = lx + lz * CS + y * LAYER;
    if (c.blocks[idx] === id) return [];
    c.blocks[idx] = id;
    c.recalcColumn(lx, lz);
    if (id && y > c.maxY) c.maxY = y;
    if (!this.edits[key]) this.edits[key] = {};
    this.edits[key][idx] = id;
    this.editsDirty = true;

    var touched = [c];
    var dxs = [0], dzs = [0];
    if (lx === 0) dxs.push(-1); else if (lx === 15) dxs.push(1);
    if (lz === 0) dzs.push(-1); else if (lz === 15) dzs.push(1);
    for (var i = 0; i < dxs.length; i++) for (var j = 0; j < dzs.length; j++) {
      if (!dxs[i] && !dzs[j]) continue;
      var n = this.chunks.get((cx + dxs[i]) + ',' + (cz + dzs[j]));
      if (n) touched.push(n);
    }
    for (i = 0; i < touched.length; i++) touched[i].dirty = true;
    return touched;
  };

  // ---- Генерация ландшафта -------------------------------------------------
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

  World.prototype.isCave = function (x, y, z) {
    var n = this.caveNoise;
    var a = n.n3(x * 0.045, y * 0.07, z * 0.045);
    var b = n.n3(x * 0.045 + 100.5, y * 0.07 + 50.5, z * 0.045 - 70.5);
    if (a * a + b * b < 0.0042) return true;
    // Редкие большие гроты глубоко внизу
    return y < 26 && n.n3(x * 0.02 + 33.3, y * 0.05, z * 0.02 - 11.1) > 0.52;
  };

  World.prototype.generate = function (cx, cz) {
    var c = new Chunk(cx, cz);
    var b = c.blocks, seed = this.seed;
    var ox = cx * CS, oz = cz * CS;
    // Площадь с запасом G блоков: кроны соседских деревьев заходят на 2 блока,
    // а для уклона под ними нужен ещё один ряд высот.
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
      return Math.max(
        Math.abs(h0 - hs[px + 1 + pz * P]), Math.abs(h0 - hs[px - 1 + pz * P]),
        Math.abs(h0 - hs[px + (pz + 1) * P]), Math.abs(h0 - hs[px + (pz - 1) * P])
      );
    }

    var self = this;
    // Какой блок лежит сверху колонны и какой под ним
    function surface(px, pz, out) {
      var i2 = px + pz * P, top = hs[i2], bm = bio[i2];
      var wx = ox + px - G, wz = oz + pz - G;
      if (top < WL) {
        var gravel = self.noise.n2(wx * 0.06 + 5.5, wz * 0.06 - 3.3) > 0.28;
        out.top = gravel ? B.GRAVEL : B.SAND; out.sub = B.SAND;
      } else if (bm === BIOME_DESERT) {
        out.top = B.SAND; out.sub = B.SAND;
      } else if (top <= WL + 1 && bm !== BIOME_SNOW) {
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

    // 1. Колонны: порода, слои, поверхность, вода, пещеры
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
          else {
            var r = hash3(wx, y, wz, seed + 77);
            if (r < 0.011) id = B.COAL;
            else if (r < 0.017 && y < 48) id = B.IRON;
          }
        } else if (y < top) id = surf.sub;
        else id = surf.top;

        // Пещеры: не трогаем дно водоёмов и нижние слои коренной породы
        if (y > 2 && id !== B.BEDROCK) {
          var limit = shallow ? top - 6 : top;
          if (y <= limit && self.isCave(wx, y, wz)) id = 0;
        }
        b[x + z * CS + y * LAYER] = id;
      }
      for (y = top + 1; y <= WL; y++) b[x + z * CS + y * LAYER] = B.WATER;
    }

    // 2. Деревья и кактусы (с учётом соседних колонн, чтобы кроны не обрезались)
    function put(lx, ly, lz, id, onlyAir) {
      if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || ly < 0 || ly >= H) return;
      var k = lx + lz * CS + ly * LAYER;
      if (onlyAir && b[k] !== 0) return;
      b[k] = id;
    }

    for (z = 1; z < P - 1; z++) for (x = 1; x < P - 1; x++) {
      var ci = x + z * P, t = hs[ci], bi = bio[ci];
      if (t <= WL + 1) continue;
      var gx = ox + x - G, gz = oz + z - G;
      var lx = x - G, lz = z - G;
      var roll = hash2(gx, gz, seed + 3);
      surface(x, z, surf);

      if (bi === BIOME_DESERT) {
        if (surf.top === B.SAND && roll < 0.005 && !self.isCave(gx, t, gz)) {
          var ch = 1 + Math.floor(hash2(gx, gz, seed + 5) * 3);
          for (var cy = 1; cy <= ch; cy++) put(lx, t + cy, lz, B.CACTUS, false);
        }
        continue;
      }
      if (surf.top !== B.GRASS && surf.top !== B.SNOW_GRASS) continue;
      var density = 0.003 + clamp(forest[ci], 0, 1) * 0.07;
      if (bi === BIOME_SNOW) density *= 0.5;
      if (roll >= density) continue;
      if (self.isCave(gx, t, gz)) continue;

      var birch = bi !== BIOME_SNOW && hash2(gx, gz, seed + 7) < 0.28;
      var th = 5 + Math.floor(hash2(gx, gz, seed + 9) * 3);   // нижний ярус листвы выше головы
      var crown = t + th;
      for (var ly = crown - 2; ly <= crown + 1; ly++) {
        var rad = ly <= crown - 1 ? 2 : 1;
        for (var dz = -rad; dz <= rad; dz++) for (var dx = -rad; dx <= rad; dx++) {
          var corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
          if (corner && (rad === 1 ? ly === crown + 1 : hash3(gx + dx, ly, gz + dz, seed) < 0.55)) continue;
          put(lx + dx, ly, lz + dz, B.LEAVES, true);
        }
      }
      for (var ty = 1; ty <= th; ty++) put(lx, t + ty, lz, birch ? B.BIRCH_LOG : B.LOG, false);
    }

    // 3. Трава и цветы
    for (z = 0; z < CS; z++) for (x = 0; x < CS; x++) {
      var ti = (x + G) + (z + G) * P, tt = hs[ti];
      if (tt <= WL || tt + 1 >= H) continue;
      if (b[x + z * CS + tt * LAYER] !== B.GRASS) continue;
      var above = x + z * CS + (tt + 1) * LAYER;
      if (b[above] !== 0) continue;
      var pr = hash2(ox + x, oz + z, seed + 11);
      var grassy = 0.06 + clamp(forest[ti] + 0.3, 0, 1) * 0.1;
      if (pr < grassy) b[above] = B.TALL_GRASS;
      else if (pr < grassy + 0.008) b[above] = B.POPPY;
      else if (pr < grassy + 0.016) b[above] = B.DANDELION;
    }

    // 4. Правки игрока поверх сгенерированного
    var ed = this.edits[cx + ',' + cz];
    if (ed) for (var k in ed) b[+k] = ed[k];

    c.recalcAll();
    this.chunks.set(cx + ',' + cz, c);
    return c;
  };

  World.prototype.hasNeighbors = function (cx, cz) {
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      if (!this.chunks.has((cx + dx) + ',' + (cz + dz))) return false;
    }
    return true;
  };

  // Точка появления: ближайшая суша к центру мира
  World.prototype.findSpawn = function () {
    var col = { h: 0, biome: 0, forest: 0 };
    for (var r = 0; r < 400; r += 4) {
      for (var a = 0; a < 16; a++) {
        var ang = a / 16 * Math.PI * 2;
        var x = Math.round(Math.cos(ang) * r) + 8, z = Math.round(Math.sin(ang) * r) + 8;
        this.column(x, z, col);
        if (col.h > WL + 2 && col.h < 60) return { x: x + 0.5, z: z + 0.5, h: col.h };
        if (r === 0) break;
      }
    }
    return { x: 8.5, z: 8.5, h: WL + 1 };
  };

  // ---- Мешер ---------------------------------------------------------------
  // Паддинг: копия чанка + по одному блоку соседей со всех сторон и слоем
  // сверху/снизу, чтобы грани и тени на стыках считались без проверок границ.
  var PW = CS + 2, PA = PW * PW, PH = H + 2;
  var pad = new Uint8Array(PA * PH);
  var psky = new Float32Array(PA * PH);
  var srcChunk = new Array(PA), srcCol = new Int32Array(PA);
  var FLOATS = 7; // x y z  u v  ao*shade  sky

  function Buf(quads) { this.data = new Float32Array(quads * 4 * FLOATS); this.n = 0; }
  Buf.prototype.reserve = function (moreQuads) {
    var need = this.n + moreQuads * 4 * FLOATS;
    if (need <= this.data.length) return;
    var nd = new Float32Array(Math.max(need, this.data.length * 2));
    nd.set(this.data.subarray(0, this.n));
    this.data = nd;
  };
  Buf.prototype.v = function (x, y, z, u, v, l, s) {
    var d = this.data, n = this.n;
    d[n] = x; d[n + 1] = y; d[n + 2] = z; d[n + 3] = u; d[n + 4] = v; d[n + 5] = l; d[n + 6] = s;
    this.n = n + 7;
  };
  var opaqueBuf = new Buf(40000), waterBuf = new Buf(8000);

  // Грани: нормаль n, оси U и V (U×V = n), базовый угол
  var FACES = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], o: [1, 0, 1], shade: 0.74, tile: 2 },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], o: [0, 0, 0], shade: 0.74, tile: 2 },
    { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], o: [0, 1, 0], shade: 1.0, tile: 0 },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], o: [0, 0, 0], shade: 0.52, tile: 1 },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], o: [0, 0, 1], shade: 0.86, tile: 2 },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], o: [1, 0, 0], shade: 0.86, tile: 2 }
  ];
  function off(v) { return v[0] + v[2] * PW + v[1] * PA; }
  FACES.forEach(function (f) { f.no = off(f.n); f.uo = off(f.u); f.vo = off(f.v); });

  var AO_CURVE = [0.46, 0.66, 0.83, 1.0];
  var CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

  // UV-прямоугольники всех плиток заранее
  var UVS = [];
  for (var t = 0; t < 64; t++) UVS.push(KC.tileUV(t));

  World.prototype.buildMesh = function (chunk) {
    var cx = chunk.cx, cz = chunk.cz, x, y, z, i;
    var ox = cx * CS, oz = cz * CS;
    var nbs = [];
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      nbs.push(this.chunks.get((cx + dx) + ',' + (cz + dz)) || null);
    }
    var maxY = 0;
    for (i = 0; i < 9; i++) if (nbs[i] && nbs[i].maxY > maxY) maxY = nbs[i].maxY;
    var topY = Math.min(H - 1, maxY + 1);

    // Соответствие колонны паддинга → чанк-источник и индекс колонны
    for (z = 0; z < PW; z++) for (x = 0; x < PW; x++) {
      var sx = x - 1, sz = z - 1;
      var ncx = sx < 0 ? 0 : sx >= CS ? 2 : 1, ncz = sz < 0 ? 0 : sz >= CS ? 2 : 1;
      var pc = x + z * PW;
      srcChunk[pc] = nbs[ncx + ncz * 3];
      srcCol[pc] = ((sx + CS) & 15) + ((sz + CS) & 15) * CS;
    }

    // Заполняем паддинг и «небесный свет» (затухает с глубиной под перекрытием)
    var fillTop = Math.min(PH - 1, topY + 2);
    for (var pcol = 0; pcol < PA; pcol++) {
      var src = srcChunk[pcol], sc = srcCol[pcol];
      var hm = src ? src.hmap[sc] : 0;
      pad[pcol] = B.STONE; psky[pcol] = 0;       // слой y = -1
      for (var py = 1; py <= fillTop; py++) {
        var wy = py - 1, pidx = pcol + py * PA;
        pad[pidx] = (src && wy < H) ? src.blocks[sc + wy * LAYER] : 0;
        psky[pidx] = wy >= hm ? 1 : Math.max(0, 1 - (hm - wy) * 0.13);
      }
      for (py = fillTop + 1; py < PH; py++) { pad[pcol + py * PA] = 0; psky[pcol + py * PA] = 1; }
    }

    var ob = opaqueBuf, wb = waterBuf;
    ob.n = 0; wb.n = 0;

    for (y = 0; y <= topY; y++) {
      for (z = 0; z < CS; z++) {
        for (x = 0; x < CS; x++) {
          var p = (x + 1) + (z + 1) * PW + (y + 1) * PA;
          var id = pad[p];
          if (!id) continue;
          var bd = BLOCKS[id];
          var wx = ox + x, wz = oz + z;

          if (bd.kind === 'cross') {
            emitCross(ob, wx, y, wz, UVS[bd.tiles[2]], psky[p]);
            continue;
          }

          var liquid = bd.kind === 'liquid';
          var waterTop = liquid && pad[p + PA] !== B.WATER;
          for (var f = 0; f < 6; f++) {
            var face = FACES[f];
            var nid = pad[p + face.no];
            if (liquid) {
              if (nid === B.WATER || OPAQUE[nid]) continue;
            } else if (bd.glass) {
              if (OPAQUE[nid] || nid === id) continue;
            } else if (OPAQUE[nid]) continue;
            if (f === 3 && y === 0) continue;
            emitFace(liquid ? wb : ob, face, bd.tiles[face.tile], p, wx, y, wz, liquid, waterTop);
          }
        }
      }
    }
    return { opaque: ob.data.subarray(0, ob.n), opaqueQuads: ob.n / (4 * FLOATS),
      water: wb.data.subarray(0, wb.n), waterQuads: wb.n / (4 * FLOATS), topY: topY };
  };

  function emitFace(buf, face, tile, p, wx, wy, wz, liquid, waterTop) {
    buf.reserve(1);
    var uv = UVS[tile];
    var a = p + face.no; // воздух перед гранью
    var ao = [3, 3, 3, 3], sky = [1, 1, 1, 1], k;
    for (k = 0; k < 4; k++) {
      var cu = CORNERS[k][0] ? 1 : -1, cv = CORNERS[k][1] ? 1 : -1;
      var i1 = a + cu * face.uo, i2 = a + cv * face.vo, i3 = i1 + cv * face.vo;
      if (!liquid) {
        var s1 = OCCLUDE[pad[i1]], s2 = OCCLUDE[pad[i2]], s3 = OCCLUDE[pad[i3]];
        ao[k] = (s1 && s2) ? 0 : 3 - s1 - s2 - s3;
      }
      // Мягкий «небесный» свет: среднее по открытым клеткам вокруг угла
      var sum = psky[a], cnt = 1;
      if (!OPAQUE[pad[i1]]) { sum += psky[i1]; cnt++; }
      if (!OPAQUE[pad[i2]]) { sum += psky[i2]; cnt++; }
      if (!OPAQUE[pad[i3]]) { sum += psky[i3]; cnt++; }
      sky[k] = sum / cnt;
    }
    // Диагональ квада проводим через более тёмную пару углов — без «ступенек»
    var start = (ao[1] + ao[3] < ao[0] + ao[2]) ? 1 : 0;
    var u = face.u, v = face.v, o = face.o;
    for (var q = 0; q < 4; q++) {
      k = (start + q) & 3;
      var ci = CORNERS[k][0], cj = CORNERS[k][1];
      var px = wx + o[0] + u[0] * ci + v[0] * cj;
      var py = wy + o[1] + u[1] * ci + v[1] * cj;
      var pz = wz + o[2] + u[2] * ci + v[2] * cj;
      if (liquid && waterTop && py > wy + 0.5) py -= 0.125;
      var tu = ci ? uv[2] : uv[0], tv = cj ? uv[1] : uv[3];
      buf.v(px, py, pz, tu, tv, face.shade * AO_CURVE[ao[k]], sky[k]);
    }
  }

  // Растение — две диагональные плоскости, каждая с двух сторон
  function emitCross(buf, wx, wy, wz, uv, sky) {
    buf.reserve(4);
    var l = 0.92, i = 0.15, j = 0.85;
    var planes = [
      [[wx + i, wz + i], [wx + j, wz + j]],
      [[wx + j, wz + i], [wx + i, wz + j]]
    ];
    for (var p = 0; p < 2; p++) {
      var A = planes[p][0], Bp = planes[p][1];
      buf.v(A[0], wy, A[1], uv[0], uv[3], l, sky);
      buf.v(Bp[0], wy, Bp[1], uv[2], uv[3], l, sky);
      buf.v(Bp[0], wy + 1, Bp[1], uv[2], uv[1], l, sky);
      buf.v(A[0], wy + 1, A[1], uv[0], uv[1], l, sky);
      // обратная сторона
      buf.v(Bp[0], wy, Bp[1], uv[2], uv[3], l, sky);
      buf.v(A[0], wy, A[1], uv[0], uv[3], l, sky);
      buf.v(A[0], wy + 1, A[1], uv[0], uv[1], l, sky);
      buf.v(Bp[0], wy + 1, Bp[1], uv[2], uv[1], l, sky);
    }
  }

  KC.CS = CS;
  KC.H = H;
  KC.WL = WL;
  KC.FLOATS = FLOATS;
  KC.World = World;
})(window.KC = window.KC || {});
