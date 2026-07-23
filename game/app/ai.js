/* «Пепел Литаний» — ИИ Стеклянного Хора.
   Никакого чтения будущих бросков: оценка позиций и целей идёт через
   ENGINE.preview — ту же математику, что видит игрок в предпросмотре. */
'use strict';
var AI = (function () {

  function typeOf(u) { return DATA.UNITS[u.type]; }

  function priorityOf(def) {
    var t = typeOf(def);
    if (t.banner) return 3;       // знамя — лакомая цель
    if (t.hero) return 3;
    if (def.heroKey) return 3;
    if (t.arty) return 2.5;       // батареи надо давить
    if (t.flamer) return 2;
    if (t.titan) return 1.5;
    return 0;
  }

  function centroid(units) {
    var x = 0, y = 0;
    units.forEach(function (u) { x += u.x; y += u.y; });
    return { x: x / units.length, y: y / units.length };
  }

  function nearestDist(x, y, units) {
    var d = 99;
    units.forEach(function (u) {
      d = Math.min(d, Math.max(Math.abs(u.x - x), Math.abs(u.y - y)));
    });
    return d;
  }

  /* сколько вражеских стволов достанет до клетки (оценка риска) */
  function exposure(b, x, y) {
    var n = 0;
    ENGINE.aliveUnits(b, 'player').forEach(function (e) {
      var t = typeOf(e);
      if (t.arty) { n += 0.5; return; } // навес достаёт почти всюду
      if (!(t.bs > 0 || t.flamer)) return;
      var r = ENGINE.effStats(e).rng;
      if (b.night) r = Math.min(r, b.night);
      var d = Math.max(Math.abs(e.x - x), Math.abs(e.y - y));
      if (d <= r && ENGINE.lineOfSight(b, e.x, e.y, x, y)) n++;
    });
    return n;
  }

  function bestShootFrom(b, u, x, y) {
    var t = typeOf(u);
    if (!(t.bs > 0 || t.flamer)) return null;
    var r = ENGINE.effStats(u).rng;
    if (b.night) r = Math.min(r, b.night);
    var ghost = { x: u.x, y: u.y };
    u.x = x; u.y = y; // временно, только для расчёта LoS/дистанций
    var best = null;
    try {
      ENGINE.aliveUnits(b, 'player').forEach(function (def) {
        var d = Math.max(Math.abs(def.x - x), Math.abs(def.y - y));
        if (d > r) return;
        if (ENGINE.isEngaged(b, def)) return;
        if (!ENGINE.lineOfSight(b, x, y, def.x, def.y)) return;
        var pv = ENGINE.preview(b, u, def, 'shoot');
        var maxM = typeOf(def).models;
        var dmgBonus = 1 + (1 - def.models / maxM) * 0.5;
        var score = pv.expKills * 2 * dmgBonus + pv.pBreak * 2.5 + priorityOf(def) * 0.6;
        if (!best || score > best.score) best = { def: def, score: score, pv: pv };
      });
    } finally {
      u.x = ghost.x; u.y = ghost.y;
    }
    return best;
  }

  function bestChargeAt(b, u, x, y) {
    var best = null;
    ENGINE.aliveUnits(b, 'player').forEach(function (def) {
      var d = Math.max(Math.abs(def.x - x), Math.abs(def.y - y));
      if (d !== 1) return;
      var ghost = { x: u.x, y: u.y };
      u.x = x; u.y = y;
      var pv;
      try { pv = ENGINE.preview(b, u, def, 'melee'); }
      finally { u.x = ghost.x; u.y = ghost.y; }
      var net = pv.expKills * 3 - (pv.back ? pv.back.exp : 0) * 1.5;
      var score = 6 + net + priorityOf(def) * 1.2 + pv.pBreak * 2;
      if (!best || score > best.score) best = { def: def, score: score };
    });
    return best;
  }

  function missionBias(b, u, x, y, m) {
    var s = 0;
    if (m.win.type === 'escort') {
      var esc = b.units.filter(function (q) { return q.type === 'svech' && q.side === 'player' && ENGINE.alive(q); })[0];
      if (esc) s -= Math.max(Math.abs(esc.x - x), Math.abs(esc.y - y)) * 0.3;
    } else if (m.win.type === 'hold') {
      var dK = 99;
      for (var yy = 0; yy < ENGINE.H; yy++) {
        for (var xx = 0; xx < ENGINE.W; xx++) {
          if (ENGINE.cellChar(b, xx, yy) === 'K') {
            dK = Math.min(dK, Math.max(Math.abs(xx - x), Math.abs(yy - y)));
          }
        }
      }
      s -= dK * 0.5;
    }
    return s;
  }

  function scoreCell(b, u, c, enemies, m, chorusCtr) {
    var t = typeOf(u);
    var s = 0;
    var ter = ENGINE.terrainAt(b, c.x, c.y);
    var cover = (ter.cover || 0) + (ter.glass ? 1 : 0);
    s += cover * 1.2;
    var nd = nearestDist(c.x, c.y, enemies);

    /* артиллерия: держит дистанцию за мёртвой зоной, бережёт себя */
    if (t.arty) {
      var want = t.arty.minRng + 2;
      s -= Math.abs(nd - want) * 1.4;
      if (nd <= t.arty.minRng) s -= 8;         // в мёртвой зоне — беда
      if (c.stay) s += 5;                       // после движения не стреляет
      s -= exposure(b, c.x, c.y) * (cover ? 0.4 : 0.9);
      return s + missionBias(b, u, c.x, c.y, m);
    }

    /* особые роли */
    if (t.jam) { // Псаломщик: держит дистанцию, глушит из-за спин
      s -= Math.abs(nd - 4) * 1.6;
      if (nd <= 1) s -= 9;
      var sh = bestShootFrom(b, u, c.x, c.y);
      if (sh) s += sh.score * 1.5;
      s -= exposure(b, c.x, c.y) * (cover ? 0.4 : 0.9);
      return s + missionBias(b, u, c.x, c.y, m);
    }
    if (u.type === 'kamerton') {
      if (m.win.type === 'killtype') { // миссия 4: камертоны прячутся
        if (c.stay) s += 6;
        s += nd * 0.6 + cover * 2;
        return s;
      }
      s -= Math.max(0, nd - 3) * 0.5; // держится за роем
      s += cover;
      var allies = ENGINE.aliveUnits(b, 'ai');
      s -= Math.max(0, Math.max(Math.abs(chorusCtr.x - c.x), Math.abs(chorusCtr.y - c.y)) - 2) * 0.8;
      return s;
    }
    if (u.type === 'pervogolos') {
      var ch = bestChargeAt(b, u, c.x, c.y);
      if (ch) {
        var isExec = ch.def.heroKey === 'exec';
        s += isExec ? -4 : ch.score; // не лезет сам под клинок Экзекутора
      }
      var sh2 = bestShootFrom(b, u, c.x, c.y);
      if (sh2) s += sh2.score;
      s -= Math.max(0, nd - 3) * 0.4;
      var execU = enemies.filter(function (e) { return e.heroKey === 'exec'; })[0];
      if (execU) {
        var dEx = Math.max(Math.abs(execU.x - c.x), Math.abs(execU.y - c.y));
        if (dEx <= 1) s -= 7;
      }
      return s + missionBias(b, u, c.x, c.y, m);
    }

    /* рукопашные */
    if (t.meleeOnly) {
      var chg = bestChargeAt(b, u, c.x, c.y);
      if (chg) s += chg.score;
      else s -= nd * 0.9; // рвётся к контакту
      s -= exposure(b, c.x, c.y) * (cover ? 0.25 : 0.5);
    } else {
      /* стрелки */
      if (!c.run) {
        var sh3 = bestShootFrom(b, u, c.x, c.y);
        if (sh3) s += sh3.score * 2;
        else s -= nd * 0.5;
      } else {
        s -= nd * 0.7;
      }
      var wantD = Math.max(2, (ENGINE.effStats(u).rng || 4) - 1);
      s -= Math.abs(nd - wantD) * 0.3;
      /* техника прёт вперёд и не боится огня пехоты; охотно давит в упор */
      if (t.vehicle) {
        var chv = bestChargeAt(b, u, c.x, c.y);
        if (chv) s += chv.score * 0.8;
        s -= Math.max(0, nd - 2) * 0.4;
        s -= exposure(b, c.x, c.y) * 0.15;
      } else {
        s -= exposure(b, c.x, c.y) * (cover ? 0.35 : 0.8);
      }
    }
    /* связность роя */
    s -= Math.max(0, Math.max(Math.abs(chorusCtr.x - c.x), Math.abs(chorusCtr.y - c.y)) - 3) * 0.4;
    return s + missionBias(b, u, c.x, c.y, m);
  }

  function unitOrder(b) {
    var enemies = ENGINE.aliveUnits(b, 'player');
    var us = ENGINE.aliveUnits(b, 'ai').slice();
    us.sort(function (a, c) {
      var ta = typeOf(a).meleeOnly ? 0 : 1;
      var tc = typeOf(c).meleeOnly ? 0 : 1;
      if (ta !== tc) return ta - tc;
      return nearestDist(a.x, a.y, enemies) - nearestDist(c.x, c.y, enemies);
    });
    return us;
  }

  /* артиллерия: лучшая точка накрытия (та же математика, что видит игрок) */
  function decideArty(b, u) {
    if (!ENGINE.canArtyFire(b, u)) return null;
    var enemies = ENGINE.aliveUnits(b, u.side === 'ai' ? 'player' : 'ai');
    var seen = {}, best = null;
    enemies.forEach(function (e) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var x = e.x + dx, y = e.y + dy;
          var k = x + ',' + y;
          if (seen[k]) continue;
          seen[k] = 1;
          if (!ENGINE.artyCellOk(b, u, x, y)) continue;
          var pv = ENGINE.artyPreview(b, u, { x: x, y: y });
          var score = 0;
          pv.rows.forEach(function (r) {
            score += r.friendly ? -2 * r.exp : r.exp + priorityOf(r.unit) * 0.3 * r.pBlast;
          });
          if (!best || score > best.score) best = { cell: { x: x, y: y }, score: score };
        }
      }
    });
    return best && best.score >= 0.4 ? best : null;
  }

  function decideMove(b, u) {
    if (ENGINE.isEngaged(b, u)) return null;
    var m = b.m;
    var enemies = ENGINE.aliveUnits(b, 'player');
    if (!enemies.length) return null;
    var t = typeOf(u);
    /* батарея, у которой есть накрытие, не двигается — стреляет */
    if (t.arty && decideArty(b, u)) return null;
    var chorus = ENGINE.aliveUnits(b, 'ai');
    var ctr = centroid(chorus);
    var walk = ENGINE.reachable(b, u, false);
    var runR = ENGINE.reachable(b, u, true);
    var cands = [{ x: u.x, y: u.y, run: false, stay: true }];
    Object.keys(walk).forEach(function (k) {
      var p = k.split(',');
      cands.push({ x: +p[0], y: +p[1], run: false });
    });
    if (t.meleeOnly || t.bs === 0) {
      Object.keys(runR).forEach(function (k) {
        if (walk[k] != null) return;
        var p = k.split(',');
        cands.push({ x: +p[0], y: +p[1], run: true });
      });
    }
    var best = null, bestS = -1e9;
    var curS = null;
    cands.forEach(function (c) {
      var s = scoreCell(b, u, c, enemies, m, ctr);
      if (c.stay) curS = s;
      if (s > bestS) { bestS = s; best = c; }
    });
    /* «не выхожу из укрытия ради мелочи»: нужен ощутимый выигрыш */
    if (best && !best.stay && curS != null) {
      var inCover = (ENGINE.terrainAt(b, u.x, u.y).cover || 0) > 0;
      if (inCover && bestS < curS + 1.2) return null;
    }
    if (!best || best.stay) return null;
    return best;
  }

  function decideShot(b, u) {
    if (!ENGINE.canShoot(b, u)) return null;
    var best = null;
    ENGINE.shootTargets(b, u).forEach(function (def) {
      var pv = ENGINE.preview(b, u, def, 'shoot');
      var maxM = typeOf(def).models;
      var dmgBonus = 1 + (1 - def.models / maxM) * 0.5;
      var score = pv.expKills * 2 * dmgBonus + pv.pBreak * 3 + priorityOf(def) * 0.7;
      if (pv.expKills < 0.05) return;
      if (!best || score > best.score) best = { def: def, score: score };
    });
    return best ? best.def : null;
  }

  function decideFights(b) {
    var fights = [];
    ENGINE.aliveUnits(b, 'ai').forEach(function (u) {
      if (u.fought) return;
      var adj = ENGINE.adjacentEnemies(b, u);
      if (!adj.length) return;
      var best = null;
      adj.forEach(function (def) {
        var pv = ENGINE.preview(b, u, def, 'melee');
        var score = pv.expKills * 2 - (pv.back ? pv.back.exp : 0) + priorityOf(def);
        if (!best || score > best.score) best = { def: def, score: score };
      });
      if (best) fights.push({ att: u, def: best.def });
    });
    return fights;
  }

  return { unitOrder: unitOrder, decideMove: decideMove, decideShot: decideShot,
           decideArty: decideArty, decideFights: decideFights };
})();
