/* Кубокрафт — игрок: движение, выживание (здоровье, голод, воздух, огонь, падения),
   инвентарь, добыча, бой, использование предметов, установка блоков, сон,
   предмет в руке от первого лица и модель от третьего лица. */
(function (KC) {
  'use strict';

  var B = KC.B, I = KC.I, BLOCKS = KC.BLOCKS, ITEMS = KC.ITEMS, DIRS = KC.DIRS;
  var E = KC.Entities, M = KC.Models;
  var world = null, hooks = {};

  var EYE = 1.62, REACH = 5, ATTACK_REACH = 3.2;

  var P = {
    e: null, inv: [], armor: [], slot: 0,
    hp: 20, food: 20, sat: 5, exh: 0, air: 15,
    effects: { hunger: 0, poison: 0, regen: 0 },
    regenT: 0, starveT: 0, drownT: 0, fireT: 0, hazardT: 0, poisonT: 0, invul: 0, flash: 0,
    dead: false, deathCause: '', spawnPoint: null,
    mining: null, miningCd: 0, using: null, swing: 0, walkDist: 0, stepDist: 0,
    creative: false, sneak: false, sprinting: false
  };

  function newEnt() {
    var e = new E.Ent('player', 0, 0, 0, 0.6, 1.8);
    e.step = 0.6; e.yaw = 0; e.pitch = 0; e.fly = false;
    return e;
  }

  function reset(creative) {
    P.e = P.e || newEnt();
    P.inv = new Array(36).fill(null);
    P.armor = [null, null, null, null];
    P.slot = 0;
    P.hp = 20; P.food = 20; P.sat = 5; P.exh = 0; P.air = 15;
    P.effects = { hunger: 0, poison: 0, regen: 0 };
    P.dead = false; P.e.dead = false; P.deathCause = ''; P.spawnPoint = null;
    P.mining = null; P.using = null;
    setCreative(creative);
    if (creative) KC.DEFAULT_HOTBAR.forEach(function (id, i) { P.inv[i] = { id: id, n: 64, d: 0 }; });
  }
  function setCreative(on) {
    P.creative = !!on;
    P.e.creative = P.creative;
    if (!on) P.e.fly = false;
  }

  // ---- Инвентарь -----------------------------------------------------------------
  function same(a, b) { return a && b && a.id === b.id && (a.d || 0) === (b.d || 0) && KC.maxStack(a.id) > 1; }

  // Кладёт стопку в инвентарь; возвращает сколько не влезло
  function give(stack) {
    var n = stack.n, max = KC.maxStack(stack.id), i;
    for (i = 0; i < 36 && n > 0; i++) {
      var s = P.inv[i];
      if (s && same(s, stack) && s.n < max) { var mv = Math.min(n, max - s.n); s.n += mv; n -= mv; }
    }
    for (i = 0; i < 36 && n > 0; i++) {
      if (!P.inv[i]) { var put = Math.min(n, max); P.inv[i] = { id: stack.id, n: put, d: stack.d || 0 }; n -= put; }
    }
    if (hooks.invChanged) hooks.invChanged();
    return n;
  }
  function count(id) { var n = 0; P.inv.forEach(function (s) { if (s && s.id === id) n += s.n; }); return n; }
  function consume(id, n) {
    for (var i = 35; i >= 0 && n > 0; i--) {
      var s = P.inv[i];
      if (!s || s.id !== id) continue;
      var t = Math.min(n, s.n); s.n -= t; n -= t;
      if (!s.n) P.inv[i] = null;
    }
    if (hooks.invChanged) hooks.invChanged();
  }
  function held() { return P.inv[P.slot]; }
  function heldId() { var s = held(); return s ? s.id : 0; }
  function heldItem() { var s = held(); return s ? ITEMS[s.id] : null; }
  function useOne() {
    if (P.creative) return;
    var s = held();
    if (!s) return;
    s.n--; if (!s.n) P.inv[P.slot] = null;
    if (hooks.invChanged) hooks.invChanged();
  }
  function wearHeld(amount) {
    if (P.creative) return;
    var s = held(), it = s && ITEMS[s.id];
    if (!it || !it.dur) return;
    s.d = (s.d || 0) + amount;
    if (s.d >= it.dur) {
      P.inv[P.slot] = null;
      if (hooks.sound) hooks.sound('tool-break');
      if (hooks.toast) hooks.toast(it.name + ' сломался');
    }
    if (hooks.invChanged) hooks.invChanged();
  }
  function armorPoints() {
    var a = 0;
    P.armor.forEach(function (s) { if (s && ITEMS[s.id] && ITEMS[s.id].armor) a += ITEMS[s.id].armor.points; });
    return a;
  }

  // ---- Урон, лечение, смерть -------------------------------------------------------
  function hurt(amount, cause, source, knock) {
    if (P.creative || P.dead || amount <= 0) return false;
    if (P.invul > 0) return false;
    var armored = cause !== 'Голод' && cause !== 'Удушье' && cause !== 'Отравление' && cause !== 'Падение';
    var dmg = amount;
    if (armored) {
      dmg = amount * (1 - Math.min(20, armorPoints()) / 25);
      P.armor.forEach(function (s, i) {
        if (!s) return;
        var it = ITEMS[s.id];
        s.d = (s.d || 0) + Math.max(1, Math.floor(amount / 4));
        if (s.d >= it.dur) { P.armor[i] = null; if (hooks.toast) hooks.toast(it.name + ' развалился'); }
      });
    }
    P.hp -= dmg;
    P.invul = 0.5;
    P.flash = 0.35;
    P.exh += 0.1;
    if (hooks.sound) hooks.sound('hurt-player');
    if (source && source.x !== undefined && !knock) {
      var dx = P.e.x - source.x, dz = P.e.z - source.z, d = Math.hypot(dx, dz) || 1;
      knock = [dx / d * 5, 4, dz / d * 5];
    }
    if (knock) { P.e.vx += knock[0]; P.e.vz += knock[2]; P.e.vy = Math.max(P.e.vy, knock[1]); }
    if (P.hp <= 0) die(source && source.K ? source.K.name : cause);
    if (hooks.hudChanged) hooks.hudChanged();
    return true;
  }
  function heal(n) { P.hp = Math.min(20, P.hp + n); if (hooks.hudChanged) hooks.hudChanged(); }

  var CAUSES = {
    'Падение': 'Вы разбились, упав с высоты', 'Утонул': 'Вы утонули', 'Лава': 'Вы сгорели в лаве',
    'Огонь': 'Вы сгорели', 'Голод': 'Вы умерли от голода', 'Кактус': 'Вы укололись о кактус насмерть',
    'Взрыв': 'Вас разорвало взрывом', 'Стрела': 'Вас застрелили', 'Бездна': 'Вы упали в бездну',
    'Отравление': 'Вас доконал яд'
  };
  function die(cause) {
    if (P.dead) return;
    P.dead = true; P.e.dead = true; P.hp = 0;
    var e = P.e;
    P.deathCause = CAUSES[cause] || (cause ? cause + ' одолел вас' : 'Вы погибли');
    if (!P.creative) {
      P.inv.concat(P.armor).forEach(function (s) {
        if (s) E.dropItem(e.x, e.y + 1, e.z, s, [(Math.random() - 0.5) * 6, 3 + Math.random() * 2, (Math.random() - 0.5) * 6]);
      });
      P.inv = new Array(36).fill(null);
      P.armor = [null, null, null, null];
    }
    P.mining = null; P.using = null;
    if (hooks.onDeath) hooks.onDeath(P.deathCause);
  }
  function respawn(spawn) {
    var e = P.e;
    var bed = P.spawnPoint && world.getBlock(P.spawnPoint.x, P.spawnPoint.y, P.spawnPoint.z) === B.BED ? P.spawnPoint : null;
    if (P.spawnPoint && !bed && hooks.toast) hooks.toast('Кровать пропала — возрождение на точке появления мира');
    if (!bed) P.spawnPoint = null;
    var sp = bed ? { x: bed.x + 0.5, y: bed.y + 0.6, z: bed.z + 0.5 } : { x: spawn.x, y: spawn.h + 1, z: spawn.z };
    e.x = sp.x; e.y = sp.y; e.z = sp.z; e.vx = e.vy = e.vz = 0; e.fallDist = 0; e.fire = 0;
    P.hp = 20; P.food = 20; P.sat = 5; P.exh = 0; P.air = 15;
    P.effects = { hunger: 0, poison: 0, regen: 0 };
    P.dead = false; e.dead = false;
    return !!bed;
  }

  // ---- Движение ---------------------------------------------------------------------
  function groundUnder(x, z) { return E.boxHits(x, P.e.y - 0.55, z, P.e.w - 0.05, 0.5); }

  function move(dt, inp) {
    var e = P.e;
    E.senseLiquids(e);
    var sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
    var wx = -sy * inp.f + cy * inp.s, wz = -cy * inp.f - sy * inp.s;
    var len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; len = 1; }
    P.sneak = inp.down && !e.fly && !e.inWater;
    var canSprint = P.creative || P.food > 6;
    P.sprinting = inp.sprint && canSprint && inp.f > 0.3 && !P.sneak && !e.inWater;
    var speed = e.fly ? (inp.sprint ? 21 : 11) : e.inLava ? 1.2 : e.inWater ? 2.4 : P.sneak ? 1.3 : P.sprinting ? 5.6 : 4.3;
    if (P.using && P.using.slow) speed *= 0.35;
    var tx = wx * speed, tz = wz * speed, k;

    if (e.fly) {
      k = Math.min(1, dt * 10);
      e.vx += (tx - e.vx) * k; e.vz += (tz - e.vz) * k;
      e.vy += (((inp.jump ? 1 : 0) - (inp.down ? 1 : 0)) * 9 - e.vy) * k;
    } else if (e.inWater || e.inLava) {
      k = Math.min(1, dt * 5);
      e.vx += (tx - e.vx) * k; e.vz += (tz - e.vz) * k;
      e.vy -= (e.inLava ? 4 : 9) * dt;
      e.vy *= Math.max(0, 1 - dt * 2.2);
      if (inp.jump) e.vy = Math.min(e.vy + 26 * dt, 3.6);
    } else {
      k = Math.min(1, dt * (e.onGround ? 14 : 3.2));
      e.vx += (tx - e.vx) * k; e.vz += (tz - e.vz) * k;
      if (e.onLadder) {
        if (inp.jump || (inp.f > 0 && e.hitH)) e.vy = 2.6;
        else if (P.sneak) e.vy = 0;
        else e.vy = Math.max(e.vy - 28 * dt, -2.4);
      } else e.vy = Math.max(e.vy - 28 * dt, -55);
      if (inp.jump && e.onGround && !e.onLadder) {
        e.vy = 8.6; e.onGround = false;
        P.exh += P.sprinting ? 0.2 : 0.05;
        if (P.sprinting) { e.vx += wx * 1.5; e.vz += wz * 1.5; }
      }
    }

    // крадучись не падаем с края
    var dx = e.vx * dt, dz = e.vz * dt;
    if (P.sneak && e.onGround) {
      if (dx && !groundUnder(e.x + dx, e.z)) { e.vx = 0; }
      if (dz && !groundUnder(e.x, e.z + dz)) { e.vz = 0; }
    }

    var sx = e.x, sz = e.z, sy0 = e.y;
    var maxV = Math.max(Math.abs(e.vx), Math.abs(e.vy), Math.abs(e.vz));
    var steps = Math.max(1, Math.ceil(maxV * dt / 0.4)), sdt = dt / steps, landed = false, hitH = false;
    e.step = e.fly || !e.onGround ? 0 : 0.6;
    for (var i = 0; i < steps; i++) {
      var before = e.y;
      E.move(e, e.vx * sdt, e.vy * sdt, e.vz * sdt);
      if (e.hitH) hitH = true;
      if (e.onGround) landed = true;
      else if (e.y < before) e.fallDist += before - e.y;
    }
    e.hitH = hitH;
    if (e.fly || e.inWater || e.onLadder) e.fallDist = 0;
    if (landed) {
      if (e.fallDist > 3.2 && !P.creative) hurt(Math.ceil(e.fallDist - 3), 'Падение');
      e.fallDist = 0;
      if (e.fly && !P.creative) e.fly = false;
      if (e.fly && inp.down) e.fly = false;
    }
    e.onGround = landed;

    if (hitH && len > 0.1 && !e.fly) {
      var free = !E.boxHits(e.x + wx * 0.45, e.y + 1.05, e.z + wz * 0.45, e.w, e.h);
      if (free && e.onGround && inp.autojump) e.vy = 8.6;
      if (free && e.inWater && inp.jump) e.vy = 6.2;
    }

    var moved = Math.hypot(e.x - sx, e.z - sz);
    if (!e.fly) {
      P.exh += moved * (P.sprinting ? 0.1 : e.inWater ? 0.015 : 0);
      if (e.onGround) {
        P.stepDist += moved;
        if (P.stepDist > 1.9) {
          P.stepDist = 0;
          var under = world.getBlock(e.x, e.y - 0.2, e.z);
          if (under && hooks.sound) hooks.sound('step:' + (BLOCKS[under].mat || 'stone'));
        }
      }
    }
    P.walkDist += moved;
    P.walkAmp = Math.min(1, moved / Math.max(dt, 1e-3) / 4.3);
    if (hooks.pressPlate && world.getBlock(e.x, e.y + 0.05, e.z) === B.PLATE) hooks.pressPlate(Math.floor(e.x), Math.floor(e.y + 0.05), Math.floor(e.z));
    void sy0;
  }

  // ---- Выживание: голод, воздух, огонь, эффекты --------------------------------------
  function stats(dt, difficulty) {
    var e = P.e;
    P.invul -= dt; P.flash -= dt;
    if (P.creative) { P.hp = 20; P.food = 20; P.air = 15; e.fire = 0; return; }
    var ey = e.y + EYE, head = world.getBlock(e.x, ey, e.z);
    var under = head === B.WATER && (ey - Math.floor(ey) < 0.86 || world.getBlock(e.x, ey + 1, e.z) === B.WATER);
    P.headInWater = under;
    if (under) {
      P.air -= dt;
      if (P.air <= 0) { P.air = 0; P.drownT -= dt; if (P.drownT <= 0) { P.drownT = 1; hurt(2, 'Утонул'); } }
    } else P.air = Math.min(15, P.air + dt * 5);

    if (e.inLava) {
      e.fire = 8;
      P.fireT -= dt;
      if (P.fireT <= 0) { P.fireT = 0.5; hurt(4, 'Лава'); }
    } else if (e.fire > 0) {
      e.fire -= dt;
      if (e.inWater) e.fire = 0;
      P.fireT -= dt;
      if (P.fireT <= 0) { P.fireT = 1; hurt(1, 'Огонь'); }
    }
    // кактус колется
    P.hazardT -= dt;
    if (P.hazardT <= 0) {
      var hw = e.w / 2 + 0.06, hurtBy = false;
      for (var x = Math.floor(e.x - hw); x <= Math.floor(e.x + hw) && !hurtBy; x++)
        for (var z = Math.floor(e.z - hw); z <= Math.floor(e.z + hw) && !hurtBy; z++)
          for (var y = Math.floor(e.y); y <= Math.floor(e.y + e.h); y++) if (world.getBlock(x, y, z) === B.CACTUS) { hurtBy = true; break; }
      if (hurtBy) { P.hazardT = 0.5; hurt(1, 'Кактус'); }
    }
    // эффекты
    if (P.effects.hunger > 0) { P.effects.hunger -= dt; P.exh += 0.5 * dt; }
    if (P.effects.poison > 0) {
      P.effects.poison -= dt; P.poisonT -= dt;
      if (P.poisonT <= 0) { P.poisonT = 1.25; if (P.hp > 1) hurt(1, 'Отравление'); }
    }
    if (P.effects.regen > 0) { P.effects.regen -= dt; P.regenT += dt * 2; }
    // голод
    while (P.exh >= 4) { P.exh -= 4; if (P.sat > 0) P.sat = Math.max(0, P.sat - 1); else if (difficulty > 0) P.food = Math.max(0, P.food - 1); }
    if (difficulty === 0) {
      P.regenT += dt;
      if (P.regenT >= 1) { P.regenT = 0; if (P.hp < 20) heal(1); if (P.food < 20) P.food++; }
    } else if (P.food >= 18 && P.hp < 20) {
      P.regenT += dt;
      if (P.regenT >= 4) { P.regenT = 0; heal(1); P.exh += 6; }
    } else if (P.effects.regen > 0 && P.hp < 20) {
      if (P.regenT >= 1) { P.regenT = 0; heal(1); }
    } else if (P.food <= 0) {
      P.starveT += dt;
      if (P.starveT >= 4) {
        P.starveT = 0;
        var floor = difficulty === 1 ? 10 : difficulty === 2 ? 1 : 0;
        if (P.hp > floor) hurt(1, 'Голод');
      }
    }
    if (e.y < -30) { P.invul = 0; hurt(40, 'Бездна'); }
  }

  // ---- Добыча -------------------------------------------------------------------------
  function mine(dt, target, active) {
    P.miningCd -= dt;
    if (!active || !target || P.dead) { P.mining = null; return null; }
    var id = world.getBlock(target.x, target.y, target.z);
    if (!id || BLOCKS[id].liquid) { P.mining = null; return null; }
    var m = P.mining;
    if (!m || m.x !== target.x || m.y !== target.y || m.z !== target.z || m.id !== id) {
      if (P.miningCd > 0) return null;
      m = P.mining = { x: target.x, y: target.y, z: target.z, id: id, p: 0, soundT: 0 };
    }
    var b = BLOCKS[id];
    if (b.hardness < 0) { if (hooks.toast && m.p === 0) hooks.toast(b.name + ' не ломается'); m.p = 0.0001; return m; }
    var time = P.creative ? 0 : KC.breakTime(b, heldItem(), P.e.onGround || P.e.fly, P.headInWater);
    P.swing = Math.max(P.swing, 0.01);
    m.soundT -= dt;
    if (m.soundT <= 0 && time > 0) { m.soundT = 0.25; if (hooks.sound) hooks.sound('dig:' + b.mat, target.x + 0.5, target.y + 0.5, target.z + 0.5); if (hooks.particles) hooks.particles('block', target.x + 0.5, target.y + 0.5, target.z + 0.5, id); }
    m.p += time <= 0 ? 1 : dt / time;
    if (m.p >= 1) {
      var meta = world.getMeta(target.x, target.y, target.z);
      KC.Sim.breakBlock(target.x, target.y, target.z, !P.creative, heldItem());
      if (hooks.blockBroken) hooks.blockBroken(target.x, target.y, target.z, id, meta);
      if (!P.creative && b.hardness > 0) {
        var it = heldItem();
        if (it && it.tool) wearHeld(it.tool.kind === 'sword' ? 2 : 1);
      }
      if (P.creative && heldItem() && heldItem().tool && heldItem().tool.kind === 'sword') { /* меч в творчестве не ломает */ }
      P.exh += 0.005;
      P.mining = null;
      P.miningCd = P.creative ? 0.22 : 0.05;
    }
    return P.mining;
  }

  // ---- Бой ------------------------------------------------------------------------------
  function attack(mob) {
    if (!mob || P.dead) return;
    var it = heldItem(), e = P.e;
    var dmg = it && it.tool ? it.tool.dmg : 1;
    var crit = !e.onGround && e.vy < 0 && !e.inWater && !e.fly;
    if (crit) dmg *= 1.5;
    var dx = mob.x - e.x, dz = mob.z - e.z, d = Math.hypot(dx, dz) || 1, kb = P.sprinting ? 7 : 4.5;
    if (E.damageMob(mob, dmg, 'player', [dx / d * kb, 3.6, dz / d * kb])) {
      if (crit && hooks.particles) for (var i = 0; i < 6; i++) hooks.particles('crit', mob.x, mob.y + mob.h * 0.7, mob.z);
      if (it && it.tool) wearHeld(it.tool.kind === 'sword' ? 1 : 2);
      P.exh += 0.1;
    }
    P.swing = 0.01;
  }

  // ---- Использование (правая кнопка) ------------------------------------------------
  function toast(t) { if (hooks.toast) hooks.toast(t); }

  function facingFromYaw(yaw) {
    var fx = Math.sin(yaw), fz = Math.cos(yaw);   // направление «к игроку»
    if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 3 : 1;
    return fz > 0 ? 0 : 2;
  }
  function dirToward(v) {
    var ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
    if (ay >= ax && ay >= az) return v[1] > 0 ? 2 : 3;
    if (ax >= az) return v[0] > 0 ? 0 : 1;
    return v[2] > 0 ? 4 : 5;
  }
  function normalDir(nx, ny, nz) { for (var d = 0; d < 6; d++) if (DIRS[d][0] === nx && DIRS[d][1] === ny && DIRS[d][2] === nz) return d; return 2; }

  function cellFree(x, y, z, solid) {
    if (y < 1 || y >= KC.H || !world.isLoaded(x, z)) return false;
    var cur = world.getBlock(x, y, z);
    if (cur && !KC.REPLACEABLE[cur]) return false;
    if (!solid) return true;
    var list = E.list.concat([P.e]);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.dead || (o.type !== 'mob' && o.type !== 'player')) continue;
      var hw = o.w / 2;
      if (x + 1 > o.x - hw && x < o.x + hw && y + 1 > o.y && y < o.y + o.h && z + 1 > o.z - hw && z < o.z + hw) return false;
    }
    return true;
  }

  // Ставит блок из руки. t — цель луча {x,y,z,nx,ny,nz,id}
  function place(t, id) {
    var e = P.e, b = BLOCKS[id];
    if (!b) return false;
    var x = t.x, y = t.y, z = t.z;
    if (!KC.REPLACEABLE[t.id] || t.id === B.WATER || t.id === B.LAVA) { x += t.nx; y += t.ny; z += t.nz; }
    var solid = KC.SOLID[id] === 1;
    if (!cellFree(x, y, z, solid)) return false;
    var meta = 0, n = normalDir(t.nx, t.ny, t.nz);
    var look = [-Math.sin(e.yaw) * Math.cos(e.pitch), Math.sin(e.pitch), -Math.cos(e.yaw) * Math.cos(e.pitch)];
    switch (id) {
      case B.FURNACE: case B.CHEST: case B.PUMPKIN: case B.JACK: case B.TABLE: case B.BED:
        meta = facingFromYaw(e.yaw); break;
      case B.PISTON: meta = dirToward([-look[0], -look[1], -look[2]]); break;
      case B.LEAVES: meta = 2; break;
      case B.TORCH: case B.SPARK_TORCH:
        if (n === 3) return false;
        meta = n ^ 1; break;
      case B.LEVER: case B.BUTTON:
        if (n === 3) return false;
        meta = n ^ 1; break;
      case B.LADDER:
        if (n === 2 || n === 3) return false;
        meta = n ^ 1; break;
      case B.DOOR:
        if (!cellFree(x, y + 1, z, true)) return false;
        meta = facingFromYaw(e.yaw);
        if (!KC.OPAQUE[world.getBlock(x, y - 1, z)]) { toast('Двери нужен пол'); return false; }
        world.setBlock(x, y, z, B.DOOR, meta);
        world.setBlock(x, y + 1, z, B.DOOR, meta | 8);
        return true;
    }
    if (!KC.Sim.supported(x, y, z, id, meta)) {
      if (b.support === 'soil') toast('Нужна трава или земля');
      else if (b.support === 'farmland') toast('Семена сажают на пашню — вскопайте землю мотыгой');
      return false;
    }
    world.setBlock(x, y, z, id, meta);
    return true;
  }

  // Правая кнопка: вернуть true, если действие произошло
  function use(t, mob, begin) {
    var e = P.e, st = held(), it = st ? ITEMS[st.id] : null;
    // существа
    if (mob && begin) {
      var K = mob.K;
      if (K.passive && it && K.food.indexOf(st.id) >= 0) {
        if (mob.grow > 0) { mob.grow = Math.max(1, mob.grow - 20); useOne(); return true; }
        if (mob.breedCd <= 0 && mob.love <= 0) {
          mob.love = 30; useOne();
          if (hooks.particles) hooks.particles('heart', mob.x, mob.y + mob.h + 0.2, mob.z);
          return true;
        }
      }
      if (mob.kind === 'sheep' && st && st.id === I.SHEARS && !mob.sheared && mob.grow <= 0) {
        mob.sheared = true;
        E.dropDrops(mob.x, mob.y + 1, mob.z, [[B.WOOL_WHITE, 1 + Math.floor(Math.random() * 3)]]);
        wearHeld(1);
        if (hooks.sound) hooks.sound('place:cloth', mob.x, mob.y, mob.z);
        return true;
      }
    }
    // блоки с действием
    if (t && begin && !(P.sneak && st)) {
      var id = world.getBlock(t.x, t.y, t.z), b = BLOCKS[id];
      switch (b && b.use) {
        case 'table': if (hooks.open) hooks.open('table'); return true;
        case 'furnace': case 'chest': if (hooks.open) hooks.open(b.use, KC.Sim.getBent(t.x, t.y, t.z)); return true;
        case 'door': KC.Sim.toggleDoor(t.x, t.y, t.z); return true;
        case 'lever': KC.Sim.toggleLever(t.x, t.y, t.z); return true;
        case 'button': KC.Sim.pressButton(t.x, t.y, t.z); return true;
        case 'bed': sleep(t); return true;
        case 'tnt':
          if (st && st.id === I.FLINT_STEEL) { KC.Sim.primeTnt(t.x, t.y, t.z); wearHeld(1); return true; }
          break;
      }
    }
    if (!st) return false;
    // еда и лук — удерживаемые действия
    if (it.food) {
      if (P.food >= 20 && !it.food.always && !P.creative) { if (begin) toast('Вы не голодны'); return false; }
      if (!P.using || P.using.kind !== 'eat') P.using = { kind: 'eat', t: 0, slot: P.slot, slow: true };
      return true;
    }
    if (st.id === I.BOW) {
      if (!P.creative && !count(I.ARROW)) { if (begin) toast('Нет стрел'); return false; }
      if (!P.using || P.using.kind !== 'bow') P.using = { kind: 'bow', t: 0, slot: P.slot, slow: true };
      return true;
    }
    if (!begin) return false;
    // вёдра
    if (st.id === I.BUCKET) {
      var src = hooks.liquidTarget && hooks.liquidTarget();
      if (!src) return false;
      var lid = world.getBlock(src.x, src.y, src.z), lm = world.getMeta(src.x, src.y, src.z);
      if ((lm & 7) !== 0 || (lm & 8)) { toast('Черпать можно только из источника'); return false; }
      world.setBlock(src.x, src.y, src.z, 0, 0);
      var full = { id: lid === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET, n: 1, d: 0 };
      if (P.creative) return true;
      if (st.n === 1) P.inv[P.slot] = full; else { st.n--; if (give(full)) E.dropItem(e.x, e.y + 1, e.z, full); }
      if (hooks.sound) hooks.sound('splash', src.x, src.y, src.z);
      if (hooks.invChanged) hooks.invChanged();
      return true;
    }
    if (st.id === I.WATER_BUCKET || st.id === I.LAVA_BUCKET) {
      if (!t) return false;
      var px = t.x + t.nx, py = t.y + t.ny, pz = t.z + t.nz;
      if (KC.REPLACEABLE[t.id] && !KC.LIQUID[t.id]) { px = t.x; py = t.y; pz = t.z; }
      if (!cellFree(px, py, pz, false)) return false;
      world.setBlock(px, py, pz, st.id === I.WATER_BUCKET ? B.WATER : B.LAVA, 0);
      if (!P.creative) P.inv[P.slot] = { id: I.BUCKET, n: 1, d: 0 };
      if (hooks.sound) hooks.sound('splash', px, py, pz);
      if (hooks.invChanged) hooks.invChanged();
      return true;
    }
    if (!t) return false;
    // мотыга: вскопать землю
    if (it.tool && it.tool.kind === 'hoe') {
      var tid = world.getBlock(t.x, t.y, t.z);
      if ((tid === B.GRASS || tid === B.DIRT) && !world.getBlock(t.x, t.y + 1, t.z)) {
        world.setBlock(t.x, t.y, t.z, B.FARMLAND, 0);
        wearHeld(1);
        if (hooks.sound) hooks.sound('place:dirt', t.x + 0.5, t.y + 1, t.z + 0.5);
        return true;
      }
      return false;
    }
    var placeId = it.place !== undefined ? it.place : it.block;
    if (placeId === undefined) return false;
    if (place(t, placeId)) {
      useOne();
      P.swing = 0.01;
      if (hooks.sound) hooks.sound('place:' + (BLOCKS[placeId].mat || 'stone'), t.x + t.nx + 0.5, t.y + t.ny + 0.5, t.z + t.nz + 0.5);
      return true;
    }
    return false;
  }

  // Удерживаемые действия: еда и натяжение лука
  function updateUse(dt, holding) {
    var u = P.using;
    if (!u) return;
    if (u.slot !== P.slot || !held()) { P.using = null; return; }
    var st = held(), it = ITEMS[st.id];
    if (u.kind === 'eat') {
      if (!holding) { P.using = null; return; }
      u.t += dt;
      if (Math.floor(u.t * 5) !== Math.floor((u.t - dt) * 5) && hooks.sound) hooks.sound('eat');
      if (u.t >= 1.6) {
        var f = it.food;
        P.food = Math.min(20, P.food + f.h);
        P.sat = Math.min(P.food, P.sat + f.s);
        if (f.effect && Math.random() < (f.chance === undefined ? 1 : f.chance)) {
          if (f.effect === 'hunger') { P.effects.hunger = 30; toast('Вас мутит: голод растёт быстрее'); }
          if (f.effect === 'poison') { P.effects.poison = 4; toast('Отравление!'); }
          if (f.effect === 'regen') { P.effects.regen = 5; toast('Сила возвращается'); }
        }
        useOne();
        if (hooks.sound) hooks.sound('burp');
        P.using = null;
        if (hooks.hudChanged) hooks.hudChanged();
      }
    } else if (u.kind === 'bow') {
      u.t += dt;
      if (!holding) {
        var power = Math.min(1, u.t / 1.0);
        P.using = null;
        if (power < 0.15) return;
        var e = P.e, cp = Math.cos(e.pitch);
        var d = [-Math.sin(e.yaw) * cp, Math.sin(e.pitch), -Math.cos(e.yaw) * cp], sp = 12 + 30 * power;
        E.launchArrow(e.x + d[0] * 0.4, e.y + EYE - 0.1 + d[1] * 0.4, e.z + d[2] * 0.4, d[0] * sp, d[1] * sp, d[2] * sp, 2 + power * 4, 'player', e);
        if (!P.creative) consume(I.ARROW, 1);
        wearHeld(1);
        if (hooks.sound) hooks.sound('bow');
      }
    }
  }

  function sleep(t) {
    var e = P.e;
    P.spawnPoint = { x: t.x, y: t.y, z: t.z };
    var night = hooks.day && hooks.day() < 0.35;
    if (!night) { toast('Точка возрождения установлена. Спать можно только ночью'); return; }
    var near = E.list.some(function (m) { return m.type === 'mob' && m.K.hostile && !m.dead && Math.hypot(m.x - e.x, m.z - e.z) < 8 && Math.abs(m.y - e.y) < 5; });
    if (near) { toast('Рядом чудовища — не уснуть'); return; }
    if (hooks.sleep) hooks.sleep();
  }

  // ---- Предмет в руке (пространство камеры) -----------------------------------------
  var heldBatch = new M.Batch(64);
  var CUBE_F = [
    { na: 0, ns: 1, ua: 2, us: -1, va: 1, vs: 1, shade: 0.72, t: 'side' },
    { na: 0, ns: -1, ua: 2, us: 1, va: 1, vs: 1, shade: 0.72, t: 'side' },
    { na: 1, ns: 1, ua: 2, us: 1, va: 0, vs: 1, shade: 1.0, t: 'top' },
    { na: 1, ns: -1, ua: 0, us: 1, va: 2, vs: 1, shade: 0.5, t: 'bottom' },
    { na: 2, ns: 1, ua: 0, us: 1, va: 1, vs: 1, shade: 0.86, t: 'side' },
    { na: 2, ns: -1, ua: 0, us: -1, va: 1, vs: 1, shade: 0.86, t: 'front' }
  ];
  var CORN = [[0, 0], [1, 0], [1, 1], [0, 1]];

  function boxView(batch, min, max, uvFor, R, c, L) {
    batch.reserve(6);
    for (var f = 0; f < 6; f++) {
      var F = CUBE_F[f], uv = uvFor(f);
      if (!uv) continue;
      for (var k = 0; k < 4; k++) {
        var ci = CORN[k][0], cj = CORN[k][1], pt = [0, 0, 0];
        pt[F.na] = F.ns > 0 ? max[F.na] : min[F.na];
        pt[F.ua] = ((F.us > 0) === (ci === 1)) ? max[F.ua] : min[F.ua];
        pt[F.va] = ((F.vs > 0) === (cj === 1)) ? max[F.va] : min[F.va];
        var w = M.apply(R, pt);
        batch.v(c[0] + w[0], c[1] + w[1], c[2] + w[2], ci ? uv[2] : uv[0], cj ? uv[1] : uv[3], L[0] * F.shade, L[1] * F.shade, L[2] * F.shade);
      }
      batch.quads++;
    }
  }

  function buildHeld(t, L) {
    heldBatch.reset();
    var st = held(), it = st ? ITEMS[st.id] : null;
    var sw = P.swing > 0 ? Math.sin(Math.min(1, P.swing) * Math.PI) : 0;
    var bob = Math.sin(P.walkDist * 2.2) * 0.02 * (P.walkAmp || 0), bobY = Math.abs(Math.cos(P.walkDist * 2.2)) * 0.025 * (P.walkAmp || 0);
    var eat = P.using && P.using.kind === 'eat' ? Math.min(1, P.using.t * 3) : 0;
    var draw = P.using && P.using.kind === 'bow' ? Math.min(1, P.using.t) : 0;
    var c = [0.56 + bob - sw * 0.2 - eat * 0.32, -0.52 + bobY + sw * 0.12 + eat * (0.2 + Math.sin(t * 22) * 0.03), -0.95 - sw * 0.15 + eat * 0.25];
    if (!it) {
      var arm = M.MODELS.player.byName.armR;
      var R0 = M.rot(-0.25 + sw * 0.4, 1.35 - sw * 0.9, 0.2);
      var uvFor = function (f) {
        var r = arm.faces[f];
        return [(r.x + 0.02) / 256, (r.y + 0.02) / 256, (r.x + r.w - 0.02) / 256, (r.y + r.h - 0.02) / 256];
      };
      boxView(heldBatch, [-0.09, -0.62, -0.09], [0.09, 0.0, 0.09], uvFor, R0, [0.42 + bob - sw * 0.15, -0.5 + bobY, -0.35 - sw * 0.2], L);
      return { data: heldBatch.view().data, quads: heldBatch.quads, mob: true };
    }
    if (it.sprite === undefined && it.block !== undefined) {
      var b = BLOCKS[it.block], tl = b.tiles;
      var R = M.rot(0.78 + sw * 0.3, 0.32 - sw * 0.9, 0);
      boxView(heldBatch, [-0.2, -0.2, -0.2], [0.2, 0.2, 0.2], function (f) {
        var key = CUBE_F[f].t, tile = key === 'front' ? (tl.front !== undefined ? tl.front : tl.side) : tl[key];
        return KC.tileUV(tile);
      }, R, c, L);
    } else {
      var uv = KC.tileUV(it.sprite), s = 0.25;
      var tool = it.tool || st.id === I.BOW || st.id === I.STICK;
      var R2 = M.rot(-0.55 + draw * 0.4, -sw * 1.1, tool ? 0.1 : 0);
      var pts = [[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0]];
      var uvs = tool ? [[uv[2], uv[3]], [uv[0], uv[3]], [uv[0], uv[1]], [uv[2], uv[1]]] : [[uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]], [uv[0], uv[1]]];
      var cc = [c[0] + 0.06 - draw * 0.3, c[1] + 0.1 + draw * 0.1, c[2] + draw * 0.2];
      heldBatch.reserve(2);
      for (var side = 0; side < 2; side++) {
        for (var k = 0; k < 4; k++) {
          var kk = side ? 3 - k : k;
          var w = M.apply(R2, pts[kk]);
          heldBatch.v(cc[0] + w[0], cc[1] + w[1], cc[2] + w[2], uvs[kk][0], uvs[kk][1], L[0], L[1], L[2]);
        }
        heldBatch.quads++;
      }
    }
    return { data: heldBatch.view().data, quads: heldBatch.quads, mob: false };
  }

  // Модель игрока для вида от третьего лица
  function drawBody(batch, L) {
    var e = P.e, sw = Math.sin(P.walkDist * 2.2) * 0.9 * (P.walkAmp || 0);
    var hit = P.swing > 0 ? Math.sin(Math.min(1, P.swing) * Math.PI) * 1.2 : 0;
    var pose = {
      head: [0, e.pitch * 0.8], legR: [0, sw], legL: [0, -sw],
      armR: [0, -sw * 0.8 + hit], armL: [0, sw * 0.8]
    };
    var col = P.flash > 0 ? [L[0] * 1.2, L[1] * 0.45, L[2] * 0.45] : L;
    M.drawModel(batch, 'player', [e.x, e.y - (P.sneak ? 0.15 : 0), e.z], e.yaw, 0.94, pose, null, col, 0);
  }

  function init(w, h) { world = w; hooks = h || {}; if (!P.e) P.e = newEnt(); }

  P.init = init; P.reset = reset; P.setCreative = setCreative;
  P.give = give; P.count = count; P.consume = consume; P.held = held; P.heldId = heldId; P.heldItem = heldItem;
  P.useOne = useOne; P.wearHeld = wearHeld; P.armorPoints = armorPoints;
  P.hurt = hurt; P.heal = heal; P.die = die; P.respawn = respawn;
  P.move = move; P.stats = stats; P.mine = mine; P.attack = attack; P.use = use; P.updateUse = updateUse;
  P.buildHeld = buildHeld; P.drawBody = drawBody;
  P.EYE = EYE; P.REACH = REACH; P.ATTACK_REACH = ATTACK_REACH;
  KC.Player = P;
})(window.KC = window.KC || {});
