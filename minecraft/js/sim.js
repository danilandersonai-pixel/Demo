/* Кубокрафт — симуляция мира с тиком 20 раз в секунду: течение воды и лавы,
   опоры (факел без стены падает), сыпучие блоки, рост растений, печи и сундуки,
   искровая сеть (провода, рычаги, кнопки, плиты, факелы, лампы, поршни, двери, динамит) и взрывы. */
(function (KC) {
  'use strict';

  var B = KC.B, I = KC.I, BLOCKS = KC.BLOCKS, DIRS = KC.DIRS;
  var OPAQUE = KC.OPAQUE;
  var world = null, hooks = {};
  var tickN = 0;
  var buckets = new Map();     // тик → [события]
  var pending = new Map();     // ключ события → тик
  var bents = new Map();       // "x,y,z" → блок-сущность (печь, сундук)
  var rsDirty = [];
  var plates = new Map();      // "x,y,z" → тик последнего нажатия
  var doorPower = new Map();

  function key(x, y, z) { return x + ',' + y + ',' + z; }
  function get(x, y, z) { return world.getBlock(x, y, z); }
  function meta(x, y, z) { return world.getMeta(x, y, z); }

  function schedule(x, y, z, type, delay) {
    var k = type + ':' + key(x, y, z), due = tickN + Math.max(1, delay);
    var cur = pending.get(k);
    if (cur !== undefined && cur <= due) return;
    pending.set(k, due);
    var b = buckets.get(due);
    if (!b) buckets.set(due, b = []);
    b.push([x, y, z, type, k]);
  }

  // ---- Жидкости -----------------------------------------------------------------
  function isLiquid(id) { return id === B.WATER || id === B.LAVA; }
  var WASHABLE = { cross: 1, crop: 1, torch: 1, wire: 1, lever: 1, button: 1, plate: 1 };
  function washable(id) { var b = BLOCKS[id]; return b && WASHABLE[b.shape]; }

  // Может ли жидкость lid затечь в клетку; попутно решает встречу воды и лавы
  function flowInto(lid, x, y, z, newMeta) {
    var t = get(x, y, z);
    if (t === B.AIR) { world.setBlock(x, y, z, lid, newMeta); return true; }
    if (washable(t)) { breakBlock(x, y, z, true); world.setBlock(x, y, z, lid, newMeta); return true; }
    if (t === lid) {
      var tm = meta(x, y, z);
      if ((tm & 7) === 0 && !(tm & 8)) return false;            // источник не трогаем
      var tl = (tm & 8) ? 0 : (tm & 7), nl = (newMeta & 8) ? 0 : (newMeta & 7);
      if (nl < tl || ((newMeta & 8) && !(tm & 8))) { world.setBlock(x, y, z, lid, newMeta); return true; }
      return false;
    }
    if (isLiquid(t) && t !== lid) {
      // вода + лава: источник лавы → обсидиан, текущая лава → булыжник
      var lavaPos = lid === B.LAVA ? null : [x, y, z];
      if (lavaPos) {
        var lm = meta(x, y, z);
        world.setBlock(x, y, z, ((lm & 7) === 0 && !(lm & 8)) ? B.OBSIDIAN : B.COBBLE, 0);
      } else world.setBlock(x, y, z, B.STONE, 0);
      if (hooks.sound) hooks.sound('fizz', x + 0.5, y + 0.5, z + 0.5);
      return false;
    }
    return false;
  }

  function updateLiquid(x, y, z) {
    var id = get(x, y, z);
    if (!isLiquid(id)) return;
    var m = meta(x, y, z), water = id === B.WATER;
    var step = water ? 1 : 2, maxL = water ? 7 : 6, delay = water ? 5 : 30;
    var level = m & 7, falling = (m & 8) !== 0;

    // лава, коснувшаяся воды, застывает
    if (!water) {
      for (var d = 0; d < 6; d++) {
        if (d === 3) continue;
        if (get(x + DIRS[d][0], y + DIRS[d][1], z + DIRS[d][2]) === B.WATER) {
          world.setBlock(x, y, z, (level === 0 && !falling) ? B.OBSIDIAN : B.COBBLE, 0);
          if (hooks.sound) hooks.sound('fizz', x + 0.5, y + 0.5, z + 0.5);
          return;
        }
      }
    }

    if (level !== 0 || falling) {
      var nm;
      if (get(x, y + 1, z) === id) nm = 8;
      else {
        var minN = 99, sources = 0;
        for (var h = 0; h < 6; h++) {
          if (h === 2 || h === 3) continue;
          var nx = x + DIRS[h][0], nz = z + DIRS[h][2];
          if (get(nx, y, nz) !== id) continue;
          var mm = meta(nx, y, nz), nl = (mm & 8) ? 0 : (mm & 7);
          if (nl === 0 && !(mm & 8)) sources++;
          if (nl < minN) minN = nl;
        }
        var below = get(x, y - 1, z), bm = meta(x, y - 1, z);
        if (water && sources >= 2 && (OPAQUE[below] || (below === id && (bm & 7) === 0 && !(bm & 8)))) nm = 0;
        else if (minN === 99 || minN + step > maxL) nm = -1;
        else nm = minN + step;
      }
      if (nm === -1) { world.setBlock(x, y, z, 0, 0); return; }
      if (nm !== m) { world.setBlock(x, y, z, id, nm); return; }
    }

    // растекание: сначала вниз, иначе в стороны
    var belowId = get(x, y - 1, z);
    if (y > 0 && (belowId === B.AIR || washable(belowId) || (belowId === id && (meta(x, y - 1, z) & 7) !== 0) || (isLiquid(belowId) && belowId !== id))) {
      flowInto(id, x, y - 1, z, 8);
      return;
    }
    var spread = falling ? step : level + step;
    if (spread > maxL) return;
    for (var s = 0; s < 6; s++) {
      if (s === 2 || s === 3) continue;
      flowInto(id, x + DIRS[s][0], y, z + DIRS[s][2], spread);
    }
    void delay;
  }

  function scheduleLiquidsAround(x, y, z) {
    for (var d = -1; d < 6; d++) {
      var px = x, py = y, pz = z;
      if (d >= 0) { px += DIRS[d][0]; py += DIRS[d][1]; pz += DIRS[d][2]; }
      var id = get(px, py, pz);
      if (isLiquid(id)) schedule(px, py, pz, 'liquid', id === B.WATER ? 5 : 30);
    }
  }

  // ---- Опоры и сыпучие блоки ---------------------------------------------------------
  function supported(x, y, z, id, m) {
    var b = BLOCKS[id];
    if (!b || !b.support) return true;
    var below = get(x, y - 1, z);
    switch (b.support) {
      case 'soil': return below === B.GRASS || below === B.DIRT || below === B.FARMLAND || below === B.SNOW_GRASS || below === B.GOLDEN_GRASS || below === B.LIGHT_SOIL;
      case 'ceiling': return OPAQUE[get(x, y + 1, z)] === 1;
      case 'ash': return below === B.ASHSTONE || below === B.ASH_BLOCK || below === B.MAGMA;
      case 'gate':
        if (m & 8) return below === id;
        return OPAQUE[below] === 1 && get(x, y + 1, z) === id;
      case 'cane': return below === B.SUGAR_CANE || below === B.GRASS || below === B.DIRT || below === B.SAND;
      case 'cactus': return below === B.CACTUS || below === B.SAND;
      case 'farmland': return below === B.FARMLAND;
      case 'floor': return OPAQUE[below] === 1;
      case 'water': return below === B.WATER;
      case 'sandy': return below === B.SAND || below === B.GRAVEL || below === B.DIRT;
      case 'attached':
        var d = DIRS[m & 7] || DIRS[3];
        return OPAQUE[get(x + d[0], y + d[1], z + d[2])] === 1;
      case 'door':
        if (m & 8) return below === B.DOOR;
        return OPAQUE[below] === 1 && get(x, y + 1, z) === B.DOOR;
    }
    return true;
  }

  function checkSupport(x, y, z) {
    var id = get(x, y, z);
    if (!id) return;
    if (!supported(x, y, z, id, meta(x, y, z))) breakBlock(x, y, z, true);
  }

  function checkFall(x, y, z) {
    var id = get(x, y, z);
    if (!BLOCKS[id] || !BLOCKS[id].falls) return;
    var below = get(x, y - 1, z);
    if (y > 0 && (below === B.AIR || isLiquid(below) || washable(below))) {
      var m = meta(x, y, z);
      world.setBlock(x, y, z, 0, 0);
      KC.Entities.spawnFalling(x, y, z, id, m);
    }
  }

  // ---- Ломание блока с дропом и содержимым -------------------------------------------
  function newBent(kind, x, y, z) {
    if (kind === 'furnace') return { type: 'furnace', x: x, y: y, z: z, slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 };
    if (kind === 'generator') return { type: 'generator', x: x, y: y, z: z, slots: [], fuel: 0 };
    return { type: 'chest', x: x, y: y, z: z, slots: new Array(27).fill(null) };
  }
  // Блок-сущность для сундука или печи; у сгенерированных сундуков добыча выдаётся лениво
  function chestBent(x, y, z) {
    var k = key(x, y, z), be = bents.get(k);
    if (be) return be;
    var id = get(x, y, z), nb = BLOCKS[id];
    if (!nb || !nb.entity) return null;
    if (nb.entity !== 'chest') be = newBent(nb.entity, x, y, z);
    else {
      var slots = new Array(27).fill(null);
      var c = world.getChunk(x >> 4, z >> 4);
      if (c && c.loot) for (var i = 0; i < c.loot.length; i++) {
        var l = c.loot[i];
        if (l[0] === x && l[1] === y && l[2] === z) { slots = KC.Gen.rollLoot(l[3], x, y, z, world.seed); break; }
      }
      be = { type: 'chest', x: x, y: y, z: z, slots: slots };
    }
    bents.set(k, be);
    return be;
  }

  function breakBlock(x, y, z, drop, tool) {
    var id = get(x, y, z);
    if (!id) return 0;
    var m = meta(x, y, z);
    if (BLOCKS[id].entity) chestBent(x, y, z);
    if (drop) KC.Entities.dropDrops(x + 0.5, y + 0.3, z + 0.5, KC.drops(id, m, tool || null, Math.random));
    var be = bents.get(key(x, y, z));
    if (be) {
      be.slots.forEach(function (s) { if (s && s.n) KC.Entities.dropItem(x + 0.5, y + 0.5, z + 0.5, s); });
      bents.delete(key(x, y, z));
    }
    world.setBlock(x, y, z, 0, 0);
    if (id === B.DOOR || (BLOCKS[id] && BLOCKS[id].portal)) {
      var oy = (m & 8) ? y - 1 : y + 1;
      if (get(x, oy, z) === id) world.setBlock(x, oy, z, 0, 0, true);
    }
    if (id === B.PISTON_HEAD) {
      var bd = DIRS[m & 7], px = x - bd[0], py = y - bd[1], pz = z - bd[2];
      if (get(px, py, pz) === B.PISTON) breakBlock(px, py, pz, drop);
    }
    if (id === B.PISTON && (m & 8)) {
      var fd = DIRS[m & 7];
      if (get(x + fd[0], y + fd[1], z + fd[2]) === B.PISTON_HEAD) world.setBlock(x + fd[0], y + fd[1], z + fd[2], 0, 0);
    }
    return id;
  }

  // ---- Реакция на любое изменение блока ------------------------------------------------
  var RS = {};
  [B.WIRE, B.LEVER, B.BUTTON, B.PLATE, B.SPARK_TORCH, B.SPARK_BLOCK, B.LAMP, B.PISTON, B.DOOR, B.TNT, B.GENERATOR].forEach(function (id) { RS[id] = 1; });

  function onChange(x, y, z, oldId, newId) {
    scheduleLiquidsAround(x, y, z);
    if (isLiquid(newId)) schedule(x, y, z, 'liquid', newId === B.WATER ? 5 : 30);
    // блок-сущности
    var nb = BLOCKS[newId];
    if (nb && nb.entity && !bents.has(key(x, y, z))) bents.set(key(x, y, z), newBent(nb.entity, x, y, z));
    if (oldId !== newId && BLOCKS[oldId] && BLOCKS[oldId].entity && !(nb && nb.entity)) bents.delete(key(x, y, z));
    // опоры и падение соседей (с задержкой в тик — чтобы не рекурсировать глубоко)
    schedule(x, y, z, 'neighbors', 1);
    // искровая сеть
    var near = RS[oldId] || RS[newId];
    if (!near) {
      for (var d = 0; d < 6 && !near; d++) if (RS[get(x + DIRS[d][0], y + DIRS[d][1], z + DIRS[d][2])]) near = true;
    }
    if (near) rsDirty.push([x, y, z]);
  }

  function checkNeighbors(x, y, z) {
    checkSupport(x, y, z);
    checkFall(x, y, z);
    for (var d = 0; d < 6; d++) {
      var nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      checkSupport(nx, ny, nz);
      checkFall(nx, ny, nz);
    }
  }

  // ---- Случайные тики: рост и увядание ---------------------------------------------
  function lightOk(x, y, z) {
    if (world.skyAt(x, y + 1, z) >= 0.6 && (!hooks.day || hooks.day() > 0.3)) return true;
    return world.blockLightAt(x, y + 1, z) >= 9;
  }
  function stackHeight(x, y, z, id) { var n = 0; while (get(x, y - n, z) === id && n < 5) n++; return n; }
  function nearWater(x, y, z, r) {
    for (var dx = -r; dx <= r; dx++) for (var dz = -r; dz <= r; dz++) for (var dy = 0; dy <= 1; dy++) {
      if (get(x + dx, y + dy, z + dz) === B.WATER) return true;
    }
    return false;
  }
  function logNear(x, y, z) {
    for (var dy = -4; dy <= 4; dy++) for (var dz = -4; dz <= 4; dz++) for (var dx = -4; dx <= 4; dx++) {
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 6) continue;
      var id = get(x + dx, y + dy, z + dz);
      if (id === B.LOG || id === B.BIRCH_LOG) return true;
    }
    return false;
  }

  function growTree(x, y, z, birch) {
    var th = 5 + Math.floor(Math.random() * 3);
    for (var ty = 1; ty <= th + 1; ty++) {
      var c = get(x, y + ty, z);
      if (c && c !== B.LEAVES) return false;
    }
    world.setBlock(x, y, z, birch ? B.BIRCH_LOG : B.LOG, 0);
    var crown = y - 1 + th;
    for (var ly = crown - 2; ly <= crown + 1; ly++) {
      var rad = ly <= crown - 1 ? 2 : 1;
      for (var dz = -rad; dz <= rad; dz++) for (var dx = -rad; dx <= rad; dx++) {
        var corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
        if (corner && (rad === 1 ? ly === crown + 1 : Math.random() < 0.55)) continue;
        if (!get(x + dx, ly, z + dz)) world.setBlock(x + dx, ly, z + dz, B.LEAVES, birch ? 1 : 0);
      }
    }
    for (var t = 1; t < th; t++) world.setBlock(x, y + t, z, birch ? B.BIRCH_LOG : B.LOG, 0);
    return true;
  }

  function randomTick(x, y, z, id) {
    var m = meta(x, y, z);
    switch (id) {
      case B.WHEAT:
        if ((m & 7) < 7 && lightOk(x, y, z)) {
          var wet = meta(x, y - 1, z) & 1;
          if (Math.random() < (wet ? 0.35 : 0.15)) world.setBlock(x, y, z, B.WHEAT, (m & 7) + 1);
        }
        break;
      case B.SAPLING:
        if (lightOk(x, y, z) && Math.random() < 0.15) growTree(x, y, z, m & 1);
        break;
      case B.FARMLAND:
        var w = nearWater(x, y, z, 4) ? 1 : 0;
        if (w !== (m & 1)) world.setBlock(x, y, z, B.FARMLAND, w);
        else if (!w && get(x, y + 1, z) !== B.WHEAT && Math.random() < 0.1) world.setBlock(x, y, z, B.DIRT, 0);
        break;
      case B.DIRT:
        if (!OPAQUE[get(x, y + 1, z)] && world.skyAt(x, y + 1, z) >= 1) {
          for (var i = 0; i < 4; i++) {
            if (get(x + Math.floor(Math.random() * 3) - 1, y + Math.floor(Math.random() * 3) - 1, z + Math.floor(Math.random() * 3) - 1) === B.GRASS) {
              world.setBlock(x, y, z, B.GRASS, 0); break;
            }
          }
        }
        break;
      case B.GRASS:
        if (OPAQUE[get(x, y + 1, z)]) world.setBlock(x, y, z, B.DIRT, 0);
        break;
      case B.LEAVES:
        if (!(m & 2) && !logNear(x, y, z)) breakBlock(x, y, z, true);
        break;
      case B.SUGAR_CANE: case B.CACTUS:
        if (!get(x, y + 1, z) && y + 1 < KC.H && stackHeight(x, y, z, id) < 3 && Math.random() < 0.2) world.setBlock(x, y + 1, z, id, 0);
        break;
      case B.FIRE:
        if (Math.random() < 0.3 || get(x, y + 1, z) === B.WATER) world.setBlock(x, y, z, 0, 0);
        break;
    }
  }

  function randomTicks(px, pz) {
    var cx0 = Math.floor(px) >> 4, cz0 = Math.floor(pz) >> 4, R = 3;
    for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) {
      var c = world.getChunk(cx0 + dx, cz0 + dz);
      if (!c || !c.mesh) continue;
      var sections = (c.maxY >> 4) + 1;
      // 8 случайных блоков на секцию за тик: пшеница созревает минут за восемь
      for (var s = 0; s < sections; s++) for (var k = 0; k < 8; k++) {
        var r = Math.random() * 4096 | 0;
        var lx = r & 15, lz = (r >> 4) & 15, ly = s * 16 + (r >> 8);
        var id = c.blocks[lx + lz * 16 + ly * 256];
        if (id === B.WHEAT || id === B.SAPLING || id === B.FARMLAND || id === B.DIRT || id === B.GRASS ||
            id === B.LEAVES || id === B.SUGAR_CANE || id === B.CACTUS || id === B.FIRE) {
          randomTick(c.cx * 16 + lx, ly, c.cz * 16 + lz, id);
        }
      }
    }
  }

  // ---- Печи ---------------------------------------------------------------------------
  function fuelTicks(stack) {
    if (!stack) return 0;
    var it = KC.ITEMS[stack.id];
    return it && it.fuel ? it.fuel : 0;
  }
  function tickFurnace(f) {
    var inp = f.slots[0], fuel = f.slots[1], out = f.slots[2];
    var res = inp ? KC.SMELT[inp.id] : undefined;
    var canCook = res !== undefined && (!out || (out.id === res && out.n < KC.maxStack(res)));
    var wasLit = f.burn > 0;
    if (f.burn > 0) f.burn--;
    if (f.burn <= 0 && canCook && fuelTicks(fuel)) {
      f.burn = f.burnMax = fuelTicks(fuel);
      if (fuel.id === I.LAVA_BUCKET) f.slots[1] = { id: I.BUCKET, n: 1, d: 0 };
      else { fuel.n--; if (!fuel.n) f.slots[1] = null; }
    }
    if (f.burn > 0 && canCook) {
      if (++f.cook >= 200) {
        f.cook = 0;
        inp.n--; if (!inp.n) f.slots[0] = null;
        if (out) out.n++; else f.slots[2] = { id: res, n: 1, d: 0 };
      }
    } else f.cook = Math.max(0, f.cook - 2);
    var lit = f.burn > 0;
    if (lit !== wasLit && get(f.x, f.y, f.z) === B.FURNACE) {
      var m = meta(f.x, f.y, f.z);
      world.setBlock(f.x, f.y, f.z, B.FURNACE, lit ? (m | 4) : (m & ~4), true);
    }
  }

  // ---- Генератор: топливо в тиках; пока работает — светит, питает провода и посадочные огни ---
  var GEN_MAX = 20 * 60 * 60;          // до трёх игровых суток (сутки — 20 минут)
  function tickGenerator(g) {
    var was = g.fuel > 0;
    if (g.fuel > 0) g.fuel--;
    var on = g.fuel > 0;
    if (on !== was || (on && tickN % 100 === 0 && !(meta(g.x, g.y, g.z) & 4))) setGenerator(g, on);
  }
  function setGenerator(g, on) {
    if (get(g.x, g.y, g.z) !== B.GENERATOR) return;
    var m = meta(g.x, g.y, g.z);
    world.setBlock(g.x, g.y, g.z, B.GENERATOR, on ? (m | 4) : (m & 3), true);
    rsDirty.push([g.x, g.y, g.z]);
    for (var dy = -2; dy <= 2; dy++) for (var dz = -10; dz <= 10; dz++) for (var dx = -10; dx <= 10; dx++) {
      if (get(g.x + dx, g.y + dy, g.z + dz) === B.LANDING_LIGHT) world.setBlock(g.x + dx, g.y + dy, g.z + dz, B.LANDING_LIGHT, on ? 1 : 0, true);
    }
    if (hooks.sound) hooks.sound(on ? 'generator-on' : 'generator-off', g.x + 0.5, g.y + 0.5, g.z + 0.5);
  }
  function fuelGenerator(x, y, z, ticks) {
    var g = chestBent(x, y, z);
    if (!g || g.type !== 'generator') return -1;
    g.fuel = Math.min(GEN_MAX, g.fuel + ticks);
    setGenerator(g, true);
    return g.fuel;
  }

  // ---- Искровая сеть -------------------------------------------------------------
  function sourceOn(id, m) {
    switch (id) {
      case B.LEVER: case B.BUTTON: return (m & 8) !== 0;
      case B.PLATE: return (m & 1) !== 0;
      case B.SPARK_TORCH: return !(m & 8);
      case B.SPARK_BLOCK: return true;
      case B.GENERATOR: return (m & 4) !== 0;
    }
    return false;
  }
  // Блок «сильно запитан»: к нему прикреплён включённый рычаг/кнопка, сверху нажата плита, снизу горит искровой факел
  function strongPowered(x, y, z) {
    for (var d = 0; d < 6; d++) {
      var nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      var id = get(nx, ny, nz);
      if (!id) continue;
      var m = meta(nx, ny, nz);
      if ((id === B.LEVER || id === B.BUTTON) && (m & 8) && (m & 7) === (d ^ 1)) return true;
      if (id === B.PLATE && d === 2 && (m & 1)) return true;
      if (id === B.SPARK_TORCH && d === 3 && !(m & 8)) return true;
    }
    return false;
  }
  function weakPowered(x, y, z) {
    if (get(x, y + 1, z) === B.WIRE && (meta(x, y + 1, z) & 15)) return true;
    for (var d = 0; d < 6; d++) {
      if (d === 2 || d === 3) continue;
      var nx = x + DIRS[d][0], nz = z + DIRS[d][2];
      if (get(nx, y, nz) === B.WIRE && (meta(nx, y, nz) & 15)) return true;
    }
    return false;
  }
  function blockPowered(x, y, z) { return OPAQUE[get(x, y, z)] === 1 && (strongPowered(x, y, z) || weakPowered(x, y, z)); }
  function wireSource(x, y, z) {
    for (var d = 0; d < 6; d++) {
      var nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      var id = get(nx, ny, nz);
      if (sourceOn(id, meta(nx, ny, nz))) return 15;
      if (OPAQUE[id] && strongPowered(nx, ny, nz)) return 15;
    }
    return 0;
  }
  function consumerPowered(x, y, z) {
    for (var d = 0; d < 6; d++) {
      var nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      var id = get(nx, ny, nz);
      if (!id) continue;
      var m = meta(nx, ny, nz);
      if (sourceOn(id, m)) {
        if (id === B.SPARK_TORCH) { var td = DIRS[m & 7] || DIRS[3]; if (nx + td[0] === x && ny + td[1] === y && nz + td[2] === z) continue; }
        return true;
      }
      if (id === B.WIRE && (m & 15) && d !== 3) return true;
      if (OPAQUE[id] && (strongPowered(nx, ny, nz) || weakPowered(nx, ny, nz))) return true;
    }
    return false;
  }
  function wireLinks(x, y, z, out) {
    for (var d = 0; d < 6; d++) {
      if (d === 2 || d === 3) continue;
      var nx = x + DIRS[d][0], nz = z + DIRS[d][2];
      if (get(nx, y, nz) === B.WIRE) out.push([nx, y, nz]);
      if (!OPAQUE[get(x, y + 1, z)] && get(nx, y + 1, nz) === B.WIRE) out.push([nx, y + 1, nz]);
      if (!OPAQUE[get(nx, y, nz)] && get(nx, y - 1, nz) === B.WIRE) out.push([nx, y - 1, nz]);
    }
  }

  function processRedstone() {
    if (!rsDirty.length) return;
    var dirty = rsDirty; rsDirty = [];
    var wires = new Map(), queue = [], i, p;
    function addWire(x, y, z) {
      var k = key(x, y, z);
      if (wires.has(k) || wires.size > 1500) return;
      wires.set(k, { x: x, y: y, z: z, p: 0 });
      queue.push([x, y, z]);
    }
    dirty.forEach(function (d) {
      for (var dy = -1; dy <= 1; dy++) for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
        if (get(d[0] + dx, d[1] + dy, d[2] + dz) === B.WIRE) addWire(d[0] + dx, d[1] + dy, d[2] + dz);
      }
    });
    var links = [];
    for (i = 0; i < queue.length; i++) {
      p = queue[i]; links.length = 0;
      wireLinks(p[0], p[1], p[2], links);
      links.forEach(function (l) { addWire(l[0], l[1], l[2]); });
    }
    // мощность: источники 15, дальше −1 на каждый блок провода
    var q = [];
    wires.forEach(function (w) { w.p = wireSource(w.x, w.y, w.z); if (w.p) q.push(w); });
    for (i = 0; i < q.length; i++) {
      var w = q[i];
      if (w.p <= 1) continue;
      links.length = 0;
      wireLinks(w.x, w.y, w.z, links);
      for (var j = 0; j < links.length; j++) {
        var n = wires.get(key(links[j][0], links[j][1], links[j][2]));
        if (n && n.p < w.p - 1) { n.p = w.p - 1; q.push(n); }
      }
    }
    var cands = new Map();
    function cand(x, y, z) { cands.set(key(x, y, z), [x, y, z]); }
    wires.forEach(function (w) {
      if ((meta(w.x, w.y, w.z) & 15) !== w.p) world.setBlock(w.x, w.y, w.z, B.WIRE, w.p, true);
    });
    wires.forEach(function (w) {
      for (var d = 0; d < 6; d++) {
        var nx = w.x + DIRS[d][0], ny = w.y + DIRS[d][1], nz = w.z + DIRS[d][2];
        cand(nx, ny, nz);
        if (OPAQUE[get(nx, ny, nz)]) for (var e = 0; e < 6; e++) cand(nx + DIRS[e][0], ny + DIRS[e][1], nz + DIRS[e][2]);
      }
    });
    dirty.forEach(function (d) {
      cand(d[0], d[1], d[2]);
      for (var k = 0; k < 6; k++) {
        var nx = d[0] + DIRS[k][0], ny = d[1] + DIRS[k][1], nz = d[2] + DIRS[k][2];
        cand(nx, ny, nz);
        for (var e = 0; e < 6; e++) cand(nx + DIRS[e][0], ny + DIRS[e][1], nz + DIRS[e][2]);
      }
    });
    cands.forEach(function (c) { evalConsumer(c[0], c[1], c[2]); });
  }

  function evalConsumer(x, y, z) {
    var id = get(x, y, z);
    if (!id) return;
    var m = meta(x, y, z), on;
    switch (id) {
      case B.LAMP:
        on = consumerPowered(x, y, z);
        if (on !== !!(m & 1)) world.setBlock(x, y, z, B.LAMP, on ? 1 : 0, true);
        break;
      case B.DOOR:
        var by = (m & 8) ? y - 1 : y;
        if (get(x, by, z) !== B.DOOR) return;
        on = consumerPowered(x, by, z) || consumerPowered(x, by + 1, z);
        var k = key(x, by, z), was = doorPower.get(k) || false;
        if (on !== was) {
          doorPower.set(k, on);
          setDoorOpen(x, by, z, on);
        }
        break;
      case B.PISTON:
        on = consumerPowered(x, y, z);
        if (on && !(m & 8)) schedule(x, y, z, 'piston', 1);
        if (!on && (m & 8)) schedule(x, y, z, 'piston', 1);
        break;
      case B.TNT:
        if (consumerPowered(x, y, z)) primeTnt(x, y, z);
        break;
      case B.SPARK_TORCH:
        var sd = DIRS[m & 7] || DIRS[3];
        var shouldOff = blockPowered(x + sd[0], y + sd[1], z + sd[2]);
        if (shouldOff !== !!(m & 8)) schedule(x, y, z, 'torch', 2);
        break;
    }
  }

  function setDoorOpen(x, y, z, open) {
    var m = meta(x, y, z);
    if (!!(m & 4) === open) return;
    var nm = open ? (m | 4) : (m & ~4);
    world.setBlock(x, y, z, B.DOOR, nm & 7, true);
    if (get(x, y + 1, z) === B.DOOR) world.setBlock(x, y + 1, z, B.DOOR, (nm & 7) | 8, true);
    if (hooks.sound) hooks.sound(open ? 'door-open' : 'door-close', x + 0.5, y + 1, z + 0.5);
  }

  // ---- Поршни -----------------------------------------------------------------------
  function immovable(id) {
    return id === B.BEDROCK || id === B.OBSIDIAN || id === B.PISTON_HEAD || id === B.FURNACE || id === B.CHEST ||
      (id === B.PISTON) || BLOCKS[id].hardness < 0 && id !== B.AIR && !isLiquid(id);
  }
  function extendPiston(x, y, z) {
    var m = meta(x, y, z), d = DIRS[m & 7], cells = [];
    var cx = x + d[0], cy = y + d[1], cz = z + d[2];
    for (var i = 0; i <= 12; i++) {
      var id = get(cx, cy, cz);
      if (cy < 0 || cy >= KC.H) return false;
      if (id === B.AIR || isLiquid(id) || washable(id)) break;
      if (immovable(id) || (id === B.PISTON && (meta(cx, cy, cz) & 8))) return false;
      if (i === 12) return false;
      cells.push([cx, cy, cz, id, meta(cx, cy, cz)]);
      cx += d[0]; cy += d[1]; cz += d[2];
    }
    var endId = get(cx, cy, cz);
    if (washable(endId)) breakBlock(cx, cy, cz, true);
    for (var j = cells.length - 1; j >= 0; j--) {
      var c = cells[j];
      world.setBlock(c[0] + d[0], c[1] + d[1], c[2] + d[2], c[3], c[4]);
    }
    world.setBlock(x + d[0], y + d[1], z + d[2], B.PISTON_HEAD, m & 7);
    world.setBlock(x, y, z, B.PISTON, m | 8, true);
    // толкаем существ, стоящих на пути
    var pushed = cells.map(function (c) { return [c[0] + d[0], c[1] + d[1], c[2] + d[2]]; });
    pushed.push([x + d[0], y + d[1], z + d[2]]);
    var ents = KC.Entities.list.slice();
    var p = hooks.player && hooks.player();
    if (p) ents.push(p);
    ents.forEach(function (e) {
      if (e.dead) return;
      for (var k = 0; k < pushed.length; k++) {
        var q = pushed[k];
        if (e.x + e.w / 2 > q[0] && e.x - e.w / 2 < q[0] + 1 && e.y + e.h > q[1] && e.y < q[1] + 1 && e.z + e.w / 2 > q[2] && e.z - e.w / 2 < q[2] + 1) {
          e.x += d[0]; e.y += d[1] > 0 ? d[1] + 0.01 : d[1]; e.z += d[2];
          break;
        }
      }
    });
    if (hooks.sound) hooks.sound('piston', x + 0.5, y + 0.5, z + 0.5);
    return true;
  }
  function retractPiston(x, y, z) {
    var m = meta(x, y, z), d = DIRS[m & 7];
    if (get(x + d[0], y + d[1], z + d[2]) === B.PISTON_HEAD) world.setBlock(x + d[0], y + d[1], z + d[2], 0, 0, true);
    world.setBlock(x, y, z, B.PISTON, m & 7, true);
    if (hooks.sound) hooks.sound('piston', x + 0.5, y + 0.5, z + 0.5);
  }

  // ---- Динамит и взрывы ------------------------------------------------------------
  function primeTnt(x, y, z, fuse) {
    if (get(x, y, z) !== B.TNT) return;
    world.setBlock(x, y, z, 0, 0);
    KC.Entities.spawnTnt(x, y, z, fuse);
  }

  var BLAST_TOOL = { tool: { kind: 'pickaxe', tier: 4, speed: 8 } };
  function explode(ex, ey, ez, power) {
    var cx = Math.floor(ex), cy = Math.floor(ey), cz = Math.floor(ez);
    var wet = isLiquid(get(cx, cy, cz));
    if (!wet) {
      var r = power * 0.9, R = Math.ceil(r), gone = [];
      for (var dy = -R; dy <= R; dy++) for (var dz = -R; dz <= R; dz++) for (var dx = -R; dx <= R; dx++) {
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > r - Math.random() * 1.1) continue;
        var x = cx + dx, y = cy + dy, z = cz + dz;
        if (y <= 0) continue;
        var id = get(x, y, z);
        if (!id || isLiquid(id)) continue;
        var b = BLOCKS[id];
        if (b.hardness < 0 || b.blastProof) continue;
        gone.push([x, y, z, id]);
      }
      // обломки разлетаются кусочками текстур разрушенных блоков
      if (hooks.particles) gone.forEach(function (g, i) { if (i % 3 === 0) for (var q = 0; q < 2; q++) hooks.particles('block', g[0] + 0.5, g[1] + 0.5, g[2] + 0.5, g[3]); });
      gone.forEach(function (g) {
        if (g[3] === B.TNT) { primeTnt(g[0], g[1], g[2], 0.5 + Math.random()); return; }
        if (BLOCKS[g[3]].explosive) { world.setBlock(g[0], g[1], g[2], 0, 0); schedule(g[0], g[1], g[2], 'blast', 4 + Math.floor(Math.random() * 6)); return; }
        breakBlock(g[0], g[1], g[2], Math.random() < 0.3, BLAST_TOOL);
      });
    }
    if (hooks.explosionHit) hooks.explosionHit(ex, ey, ez, power);
    if (KC.Entities.noise) KC.Entities.noise(ex, ey, ez, 48);
    if (hooks.particles) hooks.particles('explosion', ex, ey, ez, power);
    if (hooks.sound) hooks.sound('boom', ex, ey, ez);
  }

  // ---- Взаимодействие игрока -------------------------------------------------------
  function toggleLever(x, y, z) {
    if (get(x, y, z) !== B.LEVER) return;
    var m = meta(x, y, z);
    world.setBlock(x, y, z, B.LEVER, m ^ 8);
    if (hooks.sound) hooks.sound('click', x + 0.5, y + 0.5, z + 0.5);
  }
  function pressButton(x, y, z) {
    if (get(x, y, z) !== B.BUTTON) return;
    var m = meta(x, y, z);
    if (m & 8) return;
    world.setBlock(x, y, z, B.BUTTON, m | 8);
    schedule(x, y, z, 'button', 20);
    if (hooks.sound) hooks.sound('click', x + 0.5, y + 0.5, z + 0.5);
  }
  function toggleDoor(x, y, z) {
    var m = meta(x, y, z), by = (m & 8) ? y - 1 : y;
    if (get(x, by, z) !== B.DOOR) return;
    setDoorOpen(x, by, z, !(meta(x, by, z) & 4));
  }
  function pressPlate(x, y, z) {
    var k = key(x, y, z);
    plates.set(k, tickN);
    var m = meta(x, y, z);
    if (!(m & 1)) {
      world.setBlock(x, y, z, B.PLATE, 1);
      if (hooks.sound) hooks.sound('click', x + 0.5, y + 0.2, z + 0.5);
    }
  }
  function releasePlates() {
    plates.forEach(function (t, k) {
      if (tickN - t < 10) return;
      plates.delete(k);
      var p = k.split(',').map(Number);
      if (get(p[0], p[1], p[2]) === B.PLATE && (meta(p[0], p[1], p[2]) & 1)) {
        world.setBlock(p[0], p[1], p[2], B.PLATE, 0);
        if (hooks.sound) hooks.sound('click', p[0] + 0.5, p[1] + 0.2, p[2] + 0.5);
      }
    });
  }

  // ---- Главный тик ----------------------------------------------------------------
  function tick() {
    tickN++;
    var list = buckets.get(tickN);
    if (list) {
      buckets.delete(tickN);
      var budget = 3000;
      for (var i = 0; i < list.length; i++) {
        var ev = list[i];
        if (pending.get(ev[4]) !== tickN) continue;
        pending.delete(ev[4]);
        if (budget-- <= 0) { schedule(ev[0], ev[1], ev[2], ev[3], 1); continue; }
        var x = ev[0], y = ev[1], z = ev[2];
        switch (ev[3]) {
          case 'liquid': if (world.isLoaded(x, z)) updateLiquid(x, y, z); break;
          case 'neighbors': checkNeighbors(x, y, z); break;
          case 'blast': explode(x + 0.5, y + 0.5, z + 0.5, 3); break;
          case 'button':
            if (get(x, y, z) === B.BUTTON) { world.setBlock(x, y, z, B.BUTTON, meta(x, y, z) & 7); if (hooks.sound) hooks.sound('click', x + 0.5, y + 0.5, z + 0.5); }
            break;
          case 'torch':
            if (get(x, y, z) === B.SPARK_TORCH) {
              var m = meta(x, y, z), sd = DIRS[m & 7] || DIRS[3];
              var off = blockPowered(x + sd[0], y + sd[1], z + sd[2]);
              if (off !== !!(m & 8)) world.setBlock(x, y, z, B.SPARK_TORCH, off ? (m | 8) : (m & 7));
            }
            break;
          case 'piston':
            if (get(x, y, z) === B.PISTON) {
              var pm = meta(x, y, z), pw = consumerPowered(x, y, z);
              if (pw && !(pm & 8)) extendPiston(x, y, z);
              else if (!pw && (pm & 8)) retractPiston(x, y, z);
            }
            break;
        }
      }
    }
    bents.forEach(function (b) {
      if (!world.isLoaded(b.x, b.z)) return;
      if (b.type === 'furnace') tickFurnace(b);
      else if (b.type === 'generator') tickGenerator(b);
    });
    if (tickN % 5 === 0) releasePlates();
    var p = hooks.player && hooks.player();
    if (p) randomTicks(p.x, p.z);
    processRedstone();
  }

  // ---- Сохранение ------------------------------------------------------------------
  function serialize() {
    var out = [];
    bents.forEach(function (b) {
      var o = { t: b.type, x: b.x, y: b.y, z: b.z, s: b.slots.map(function (s) { return s ? [s.id, s.n, s.d || 0] : 0; }) };
      if (b.type === 'furnace') { o.b = b.burn; o.bm = b.burnMax; o.c = b.cook; }
      if (b.type === 'generator') o.f = b.fuel;
      out.push(o);
    });
    return out;
  }
  function restore(arr) {
    bents.clear();
    (arr || []).forEach(function (o) {
      var slots = o.s.map(function (s) { return s ? { id: s[0], n: s[1], d: s[2] } : null; });
      var b = { type: o.t, x: o.x, y: o.y, z: o.z, slots: slots };
      if (o.t === 'furnace') { b.burn = o.b || 0; b.burnMax = o.bm || 0; b.cook = o.c || 0; }
      if (o.t === 'generator') b.fuel = o.f || 0;
      bents.set(key(o.x, o.y, o.z), b);
    });
  }

  function init(w, h) {
    world = w; hooks = h || {};
    tickN = 0; buckets.clear(); pending.clear(); bents.clear(); rsDirty = []; plates.clear(); doorPower.clear();
    world.listener = onChange;
  }

  KC.Sim = {
    init: init, tick: tick, breakBlock: breakBlock, supported: supported,
    getBent: function (x, y, z) { return chestBent(x, y, z); },
    toggleLever: toggleLever, pressButton: pressButton, toggleDoor: toggleDoor, pressPlate: pressPlate,
    primeTnt: primeTnt, explode: explode, serialize: serialize, restore: restore, fuelGenerator: fuelGenerator, GEN_MAX: GEN_MAX,
    bents: bents,
    markRedstone: function (x, y, z) { rsDirty.push([x, y, z]); },
    growTree: growTree
  };
})(window.KC = window.KC || {});
