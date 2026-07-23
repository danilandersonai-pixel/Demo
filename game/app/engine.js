/* «Пепел Литаний» — боевой движок. Чистые функции над объектом battle.
   Вся математика вероятностей (превью) и резолвер бросков используют один
   и тот же attackProfile — игрок и ИИ считают одинаково. */
'use strict';
var ENGINE = (function () {
  var W = 8, H = 11;

  /* ---------- базовые утилиты ---------- */
  function idx(x, y) { return y * W + x; }
  function inB(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }
  function cellChar(b, x, y) { return b.cells[idx(x, y)]; }
  function terrainAt(b, x, y) { return DATA.TERRAIN[cellChar(b, x, y)] || DATA.TERRAIN['.']; }
  function typeOf(u) { return DATA.UNITS[u.type]; }
  function alive(u) { return u.models > 0; }
  function dist(a, bb) { return Math.max(Math.abs(a.x - bb.x), Math.abs(a.y - bb.y)); }
  function unitAt(b, x, y) {
    for (var i = 0; i < b.units.length; i++) {
      var u = b.units[i];
      if (alive(u) && u.x === x && u.y === y) return u;
    }
    return null;
  }
  function aliveUnits(b, side) {
    return b.units.filter(function (u) { return alive(u) && (!side || u.side === side); });
  }
  function isEngaged(b, u) {
    return aliveUnits(b, u.side === 'player' ? 'ai' : 'player').some(function (e) {
      return dist(u, e) === 1;
    });
  }
  function adjacentEnemies(b, u) {
    return aliveUnits(b, u.side === 'player' ? 'ai' : 'player').filter(function (e) {
      return dist(u, e) === 1;
    });
  }
  function isChar(u) { return (typeOf(u).wpm || 1) > 1; }
  function isVehicle(u) { return !!typeOf(u).vehicle; }
  function isArty(u) { return !!typeOf(u).arty; }
  function missionOf(b) { return b.m; }

  /* ---------- эффективный профиль (титаны деградируют по ранам) ---------- */
  function titanStage(u) {
    var t = typeOf(u);
    if (!t.titan) return 0;
    if (u.hp >= t.titan.hi) return 0;
    if (u.hp >= t.titan.mid) return 1;
    return 2;
  }
  function effStats(u) {
    var t = typeOf(u);
    var e = { mv: t.mv, rng: t.rng || 0, shootDice: t.shootDice || 1,
              s: t.s, atk: t.atk || 1 };
    if (t.titan) {
      var st = t.titan.stages[titanStage(u)];
      e.mv = st.mv; e.rng = st.rng; e.shootDice = st.shootDice;
      e.s = st.s; e.atk = st.atk; e.stageLabel = st.label;
    }
    return e;
  }

  function log(b, msg, cls) {
    b.log.push({ r: b.round, side: b.side, msg: msg, cls: cls || '' });
    if (b.log.length > 400) b.log.shift();
  }

  /* ---------- создание юнита ---------- */
  function makeUnit(b, typeId, side, x, y, extra) {
    extra = extra || {};
    var t = DATA.UNITS[typeId];
    var u = {
      uid: b.nextUid++, type: typeId, side: side, x: x, y: y,
      models: extra.models != null ? extra.models : t.models,
      hp: t.wpm || 1,
      names: extra.names ? extra.names.slice() : [],
      broken: false, moved: false, ran: false, shot: false, fought: false, charged: false,
      buffs: {}, lostPhase: 0, testedPhase: false, kills: 0, modelsKilled: 0,
      squadName: extra.squadName || null, veteran: !!extra.veteran,
      rosterId: extra.rosterId != null ? extra.rosterId : null,
      heroKey: extra.heroKey || null, heroName: extra.heroName || null,
      traits: extra.traits ? extra.traits.slice() : [],
      svBonus: extra.svBonus || 0, atkBonus: extra.atkBonus || 0,
      relicAura: !!extra.relicAura, shriekImmune: !!extra.shriekImmune,
      hitAura: !!extra.hitAura, orderRange: extra.orderRange || 0,
      orderUnjammable: !!extra.orderUnjammable, orderSavePen: !!extra.orderSavePen,
      ldPerm: extra.ldPerm || 0,
      shield: t.shield ? t.shield.max : 0
    };
    b.units.push(u);
    return u;
  }

  function findFreeNear(b, x, y) {
    if (inB(x, y) && !terrainAt(b, x, y).impass && !unitAt(b, x, y)) return { x: x, y: y };
    for (var r = 1; r <= 4; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          var nx = x + dx, ny = y + dy;
          if (inB(nx, ny) && !terrainAt(b, nx, ny).impass && !unitAt(b, nx, ny)) {
            return { x: nx, y: ny };
          }
        }
      }
    }
    return null;
  }

  /* ---------- лидерство / резонанс ---------- */
  function effLd(b, u) {
    var t = typeOf(u);
    var ld = t.ld + (u.veteran ? 1 : 0) + (u.ldPerm || 0) + (b.ldGlobal && u.side === 'player' ? b.ldGlobal : 0);
    var aura = 0, relic = 0;
    for (var i = 0; i < b.units.length; i++) {
      var o = b.units[i];
      if (o === u || !alive(o) || o.side !== u.side) continue;
      var ot = typeOf(o);
      if (ot.aura && dist(o, u) <= ot.aura.r) aura = Math.max(aura, ot.aura.ld);
      if (o.relicAura && dist(o, u) <= 3) relic = 1;
    }
    ld += aura + relic + (u.buffs.ldBonus || 0);
    if (b.flags.nabat && u.side === 'player') ld += 2;
    return Math.min(10, ld);
  }
  function nearHeroOrBanner(b, u) {
    return b.units.some(function (o) {
      if (o === u || !alive(o) || o.side !== u.side) return false;
      var ot = typeOf(o);
      return (ot.hero || ot.banner) && dist(o, u) <= 3;
    });
  }

  /* ---------- движение ---------- */
  function reachable(b, u, run) {
    var mv = effStats(u).mv;
    var budget = mv + (run ? Math.ceil(mv / 2) : 0);
    var res = {};
    if (u.broken || isEngaged(b, u)) return res;
    var enemySide = u.side === 'player' ? 'ai' : 'player';
    var enemies = aliveUnits(b, enemySide);
    function nearEnemy(x, y) {
      return enemies.some(function (e) {
        return Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) === 1;
      });
    }
    var cost = {};
    cost[u.x + ',' + u.y] = 0;
    var open = [{ x: u.x, y: u.y, c: 0 }];
    while (open.length) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (open[i].c < open[bi].c) bi = i;
      var cur = open.splice(bi, 1)[0];
      if (cost[cur.x + ',' + cur.y] < cur.c) continue;
      if (nearEnemy(cur.x, cur.y) && !(cur.x === u.x && cur.y === u.y)) continue; // вошёл в контакт — стоп
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var nx = cur.x + dx, ny = cur.y + dy;
          if (!inB(nx, ny)) continue;
          var ter = terrainAt(b, nx, ny);
          if (ter.impass) continue;
          if (unitAt(b, nx, ny)) continue;
          var nc = cur.c + ter.cost;
          if (nc > budget) continue;
          var k = nx + ',' + ny;
          if (cost[k] == null || nc < cost[k]) {
            cost[k] = nc;
            open.push({ x: nx, y: ny, c: nc });
          }
        }
      }
    }
    delete cost[u.x + ',' + u.y];
    /* Бег — не атака: бегущий отряд не может закончить движение вплотную к врагу. */
    if (run) {
      var walkBudget = mv;
      Object.keys(cost).forEach(function (k) {
        if (cost[k] <= walkBudget) return; // до этих клеток можно дойти и шагом
        var p = k.split(',');
        if (nearEnemy(+p[0], +p[1])) delete cost[k];
      });
    }
    return cost;
  }

  function moveUnit(b, u, x, y, run) {
    u.x = x; u.y = y;
    u.moved = true;
    if (run) u.ran = true;
    if (adjacentEnemies(b, u).length) {
      u.charged = true;
      log(b, unitLabel(u) + ' идёт в атаку!', 'melee');
    }
    checkOutcome(b);
  }

  /* ---------- линия видимости ---------- */
  function lineCells(x0, y0, x1, y1) {
    var pts = [];
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx - dy, x = x0, y = y0;
    for (;;) {
      pts.push({ x: x, y: y });
      if (x === x1 && y === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return pts;
  }
  function lineOfSight(b, x0, y0, x1, y1) {
    var pts = lineCells(x0, y0, x1, y1);
    for (var i = 1; i < pts.length - 1; i++) {
      var t = terrainAt(b, pts[i].x, pts[i].y);
      if (t.blocks) return false;
    }
    return true;
  }
  function shootRange(b, u) {
    var r = effStats(u).rng;
    if (b.night) r = Math.min(r, b.night);
    return r;
  }
  function canShoot(b, u) {
    var t = typeOf(u);
    if (!(t.bs > 0 || t.flamer)) return false;
    return !u.broken && !u.ran && !u.shot && !isEngaged(b, u);
  }
  function shootTargets(b, u) {
    if (!canShoot(b, u)) return [];
    var r = shootRange(b, u);
    return aliveUnits(b, u.side === 'player' ? 'ai' : 'player').filter(function (e) {
      if (dist(u, e) > r) return false;
      if (isEngaged(b, e)) return false; // не стрелять в свалку
      return lineOfSight(b, u.x, u.y, e.x, e.y);
    });
  }

  /* ---------- артиллерия: непрямой огонь по площади ----------
     Без LoS. Рассеивание: 3+ на д6 — снаряд в цель, иначе снос на 1 клетку
     в случайную из 8 сторон. Накрывает 3×3 вокруг точки падения — И СВОИХ.
     Укрытия от навеса не спасают. После движения не стреляет. */
  var SCATTER_DIRS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

  function canArtyFire(b, u) {
    if (!isArty(u)) return false;
    return !u.broken && !u.moved && !u.ran && !u.shot && !isEngaged(b, u);
  }
  function artyRangeOf(b, u) {
    var r = typeOf(u).rng;
    if (b.night) r = Math.min(r, b.night);
    return r;
  }
  function artyCellOk(b, u, x, y) {
    if (!inB(x, y)) return false;
    var d = Math.max(Math.abs(u.x - x), Math.abs(u.y - y));
    var t = typeOf(u);
    return d >= t.arty.minRng && d <= artyRangeOf(b, u);
  }
  /* распределение точки падения: 4/6 в цель, по 1/24 на каждую из 8 соседних */
  function artyImpacts(cell) {
    var pts = [{ x: cell.x, y: cell.y, p: 4 / 6 }];
    SCATTER_DIRS.forEach(function (d) {
      pts.push({ x: cell.x + d[0], y: cell.y + d[1], p: (2 / 6) / 8 });
    });
    return pts;
  }
  function artyPreview(b, att, cell) {
    var at = typeOf(att);
    var impacts = artyImpacts(cell);
    var rows = [];
    b.units.forEach(function (w) {
      if (!alive(w)) return;
      var pBlast = 0;
      impacts.forEach(function (ip) {
        if (Math.max(Math.abs(w.x - ip.x), Math.abs(w.y - ip.y)) <= 1) pBlast += ip.p;
      });
      if (pBlast <= 0) return;
      var wT = woundTarget(at.arty.s, typeOf(w).t);
      /* укрытие игнорируется, бронепробитие навеса действует */
      var sv = Math.max(2, typeOf(w).sv - (w.svBonus || 0) + Math.max(0, at.arty.s - 5));
      var pKill = pSuccess(wT) * (sv > 6 ? 1 : Math.max(0, Math.min(1, (sv - 1) / 6)));
      rows.push({ unit: w, pBlast: pBlast, woundT: wT, saveT: sv,
                  exp: pBlast * at.arty.dice * pKill, friendly: w.side === att.side });
    });
    rows.sort(function (a, c) { return c.exp - a.exp; });
    return { dice: at.arty.dice, s: at.arty.s, rows: rows };
  }
  function resolveArty(b, att, cell) {
    var at = typeOf(att);
    var sc = RNG.d6();
    var impact = { x: cell.x, y: cell.y };
    var scattered = sc < 3;
    if (scattered) {
      var d = SCATTER_DIRS[RNG.int(8)];
      impact.x += d[0]; impact.y += d[1];
    }
    var out = { impact: impact, scattered: scattered, scRoll: sc, results: [] };
    log(b, '☄ ' + unitLabel(att) + ' бьёт навесом (' + (cell.x + 1) + ',' + (cell.y + 1) + ')' +
      (scattered ? ' — снос!' : ' — точно в цель.'), 'atk');
    b.units.slice().forEach(function (w) {
      if (!alive(w)) return;
      if (Math.max(Math.abs(w.x - impact.x), Math.abs(w.y - impact.y)) > 1) return;
      var wT = woundTarget(at.arty.s, typeOf(w).t);
      var sv = Math.max(2, typeOf(w).sv - (w.svBonus || 0) + Math.max(0, at.arty.s - 5));
      var wounds = rollPool(at.arty.dice, wT);
      var nW = wounds.filter(function (q) { return q.ok; }).length;
      var fails = 0, saves = [];
      for (var i = 0; i < nW; i++) {
        if (sv > 6) { saves.push({ r: '—', ok: false }); fails++; continue; }
        var r = RNG.d6();
        saves.push({ r: r, ok: r >= sv });
        if (r < sv) fails++;
      }
      var dmg = applyWounds(b, w, fails);
      if (w.side !== att.side) att.kills += dmg.modelsKilled;
      var row = { unit: w, wounds: wounds, saves: saves, kills: dmg.modelsKilled,
                  woundsLost: dmg.woundsLost, fallen: dmg.fallen,
                  destroyed: dmg.destroyed, friendly: w.side === att.side, morale: null };
      log(b, '· накрыт ' + unitLabel(w) + ': −' +
        (isChar(w) ? dmg.woundsLost + ' ран' : dmg.modelsKilled) +
        (dmg.destroyed ? ' (уничтожен)' : ''), dmg.modelsKilled + dmg.woundsLost > 0 ? 'grim' : '');
      if (alive(w) && !isChar(w) && !w.broken && !w.testedPhase) {
        var start = w.models + w.lostPhase;
        var need = Math.ceil(start * 0.25);
        if (w.lostPhase >= need && need > 0) {
          row.morale = moraleTest(b, w, 0, 'навесной огонь');
          log(b, moraleMsg(w, row.morale), row.morale.passed ? '' : 'grim');
        }
      }
      out.results.push(row);
    });
    att.shot = true;
    checkOutcome(b);
    return out;
  }

  /* ---------- профиль атаки (общий для превью и резолвера) ---------- */
  function woundTarget(s, t) {
    if (s >= 2 * t) return 2;
    if (s > t) return 3;
    if (s === t) return 4;
    if (2 * s <= t) return 6;
    return 5;
  }
  function coverOf(b, def) {
    var ter = terrainAt(b, def.x, def.y);
    var c = ter.cover || 0;
    if (ter.glass && typeOf(def).faction === 'chorus') c = Math.max(c, 1);
    return c;
  }
  function attackProfile(b, att, def, mode) {
    var at = typeOf(att), dt = typeOf(def);
    var ae = effStats(att);
    var notes = [];
    var p = { mode: mode, auto: false, dice: 0, hitT: 4, woundT: 4, saveT: 4, notes: notes };
    if (at.titan && titanStage(att) > 0) notes.push('Деградация сверхтяжа: ' + ae.stageLabel);

    if (mode === 'shoot') {
      if (at.flamer) {
        p.auto = true;
        p.dice = att.models * 2;
        notes.push('Пламя: автопопадание, игнорирует укрытие');
      } else {
        p.dice = isChar(att) ? ae.shootDice : att.models;
        p.hitT = at.bs;
      }
      if (att.buffs.shootTwice) { p.dice *= 2; notes.push('Глас казни: двойной залп'); }
    } else {
      p.dice = isChar(att) ? (ae.atk + (att.atkBonus || 0)) : att.models;
      p.hitT = at.ws;
    }

    if (!p.auto) {
      var mod = 0;
      if (att.buffs.hitBonus) { mod -= att.buffs.hitBonus; notes.push('Благословение: +1 к попаданию'); }
      if (b.flags.lightMiracle && att.side === 'player') { mod -= 1; notes.push('Свет истинный: +1 к попаданию'); }
      if (att.side === 'player' && !att.hitAura) {
        var nearDeacon = b.units.some(function (o) {
          return alive(o) && o.side === 'player' && o.hitAura && o !== att && dist(o, att) <= 2;
        });
        if (nearDeacon) { mod -= 1; notes.push('Проповедь Дьякона: +1 к попаданию'); }
      }
      if (!att.shriekImmune) {
        var shrieked = aliveUnits(b, att.side === 'player' ? 'ai' : 'player').some(function (e) {
          var et = typeOf(e);
          return et.shriek && dist(e, att) <= et.shriek.r;
        });
        if (shrieked) { mod += 1; notes.push('Визг Резонаторов: −1 к попаданию'); }
      }
      p.hitT = Math.min(6, Math.max(2, p.hitT + mod));
    }

    p.woundT = woundTarget(ae.s, dt.t);
    if (def.shield > 0) notes.push('Щит из звука: ' + def.shield + ' ран будут погашены');

    var sv = dt.sv - (def.svBonus || 0);
    /* бронепробитие: сила 6+ портит спас-бросок цели (С6: −1, С7: −2, С8: −3) */
    var ap = Math.max(0, ae.s - 5);
    if (ap > 0) { sv += ap; notes.push('Пробитие брони: −' + ap + ' к спасу цели'); }
    if (!(mode === 'shoot' && at.flamer) && mode === 'shoot') {
      sv -= coverOf(b, def);
      if (coverOf(b, def) > 0) notes.push('Цель в укрытии: броня ' + '+' + coverOf(b, def));
    }
    if (att.buffs.savePen && mode === 'shoot') { sv += 1; notes.push('Освящённый порох: −1 к спасу цели'); }
    p.saveT = sv < 2 ? 2 : sv; // >6 значит «нет спаса»
    return p;
  }

  /* ---------- вероятности ---------- */
  function pSuccess(target) { return Math.max(0, Math.min(1, (7 - target) / 6)); }
  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    var r = 1;
    for (var i = 0; i < k; i++) r = r * (n - i) / (i + 1);
    return r;
  }
  function binomAtLeast(n, p, k) {
    if (k <= 0) return 1;
    if (k > n) return 0;
    var s = 0;
    for (var i = k; i <= n; i++) s += comb(n, i) * Math.pow(p, i) * Math.pow(1 - p, n - i);
    return s;
  }
  function cum2d6(v) {
    var w = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
    var s = 0;
    for (var i = 2; i <= Math.min(12, v); i++) s += w[i];
    return s / 36;
  }

  function preview(b, att, def, mode) {
    var prof = attackProfile(b, att, def, mode);
    var pHit = prof.auto ? 1 : pSuccess(prof.hitT);
    var pWound = pSuccess(prof.woundT);
    var pFailSave = prof.saveT > 6 ? 1 : Math.max(0, Math.min(1, (prof.saveT - 1) / 6));
    var pKill = pHit * pWound * pFailSave;
    var pool = isChar(def) ? def.hp + (def.shield || 0) : def.models;
    var expKills = Math.min(pool, prof.dice * pKill);
    var pDestroy = binomAtLeast(prof.dice, pKill, pool);
    var pBreak = 0, moraleNeed = 0, pFailLd = 0;
    if (!isChar(def) && !def.broken) {
      var startModels = def.models + def.lostPhase;
      moraleNeed = Math.max(1, Math.ceil(startModels * 0.25) - def.lostPhase);
      pFailLd = 1 - cum2d6(effLd(b, def));
      if (!def.testedPhase) pBreak = binomAtLeast(prof.dice, pKill, moraleNeed) * pFailLd;
    }
    var back = null;
    if (mode === 'melee' && !def.broken) {
      var bp = attackProfile(b, def, att, 'melee');
      var bHit = bp.auto ? 1 : pSuccess(bp.hitT);
      var bKill = bHit * pSuccess(bp.woundT) * (bp.saveT > 6 ? 1 : Math.max(0, (bp.saveT - 1) / 6));
      var survivors = isChar(def)
        ? (expKills >= def.hp ? 0 : bp.dice)
        : Math.max(0, Math.round(def.models - expKills));
      back = { dice: survivors, pKill: bKill, exp: survivors * bKill, prof: bp };
    }
    return { prof: prof, pHit: pHit, pWound: pWound, pFailSave: pFailSave, pKill: pKill,
             expKills: expKills, pDestroy: pDestroy, pBreak: pBreak, pFailLd: pFailLd,
             moraleNeed: moraleNeed, back: back };
  }

  /* ---------- урон и потери ---------- */
  function unitLabel(u) {
    var t = typeOf(u);
    if (u.heroName) return t.name + ' ' + u.heroName;
    if (u.squadName) return u.squadName + ' (' + t.name + ')';
    return t.name;
  }

  function applyWounds(b, def, fails) {
    var res = { modelsKilled: 0, woundsLost: 0, fallen: [], destroyed: false, absorbed: 0 };
    if (fails <= 0) return res;
    if (isChar(def)) {
      /* щит-регенерация (Стоголосый): гасит раны до корпуса */
      if (def.shield > 0) {
        res.absorbed = Math.min(def.shield, fails);
        def.shield -= res.absorbed;
        fails -= res.absorbed;
        if (res.absorbed > 0) log(b, '⛨ Щит из звука гасит ' + res.absorbed + ' ран (' + unitLabel(def) + ').', 'grim');
        if (fails <= 0) return res;
      }
      var stBefore = titanStage(def);
      res.woundsLost = Math.min(def.hp, fails);
      def.hp -= res.woundsLost;
      if (def.hp <= 0) {
        def.models = 0;
        res.destroyed = true;
        res.modelsKilled = 1;
      } else {
        var t0 = typeOf(def);
        if (t0.titan) {
          var stAfter = titanStage(def);
          for (var sm = stBefore; sm < stAfter; sm++) {
            log(b, t0.titan.msgs[sm], def.side === 'ai' ? 'win' : 'grim');
          }
        }
      }
    } else {
      var kills = Math.min(fails, def.models);
      res.modelsKilled = kills;
      for (var i = 0; i < kills; i++) {
        var nm = def.names.length ? def.names.pop() : null;
        if (nm) res.fallen.push(nm);
      }
      def.models -= kills;
      def.lostPhase += kills;
      if (def.models <= 0) res.destroyed = true;
    }
    if (def.side === 'player' && res.fallen.length) {
      res.fallen.forEach(function (nm) {
        b.fallen.push({ name: nm, squad: def.squadName || typeOf(def).name });
      });
    }
    if (def.side === 'player' && res.destroyed && def.heroKey) {
      b.heroDown[def.heroKey] = true;
      log(b, '⚑ ' + unitLabel(def) + ' пал в бою. Полк продолжает бой без него.', 'grim');
      heroDeathRipple(b, def);
    }
    if (def.side === 'ai' && res.destroyed && typeOf(def).hero) heroDeathRipple(b, def);
    return res;
  }

  function heroDeathRipple(b, hero) {
    aliveUnits(b, hero.side).forEach(function (u) {
      if (u === hero || isChar(u) || u.broken || u.testedPhase) return;
      if (dist(u, hero) <= 3) {
        var m = moraleTest(b, u, 0, 'гибель героя рядом');
        log(b, moraleMsg(u, m), m.passed ? '' : 'grim');
      }
    });
  }

  /* ---------- мораль ---------- */
  function moraleTest(b, u, mod, reason) {
    var ld = Math.max(2, effLd(b, u) + (mod || 0));
    var d1 = RNG.d6(), d2 = RNG.d6();
    var roll = d1 + d2;
    u.testedPhase = true;
    var res = { roll: roll, ld: ld, passed: roll <= ld, reason: reason || '', effect: 'held', lost: 0, deserted: false, fell: false };
    if (res.passed) return res;
    if (typeOf(u).faction === 'chorus') {
      res.effect = 'shatter';
      if (isChar(u)) {
        res.lost = 1;
        applyWounds(b, u, 1);
      } else {
        var d = RNG.d3();
        res.lost = Math.min(d, u.models);
        u.models -= res.lost;
      }
    } else {
      res.effect = 'broken';
      breakUnit(b, u, res);
    }
    checkOutcome(b);
    return res;
  }

  function onBridge(b, u) {
    var m = b.m;
    return m.bridgeRows && u.y >= m.bridgeRows[0] && u.y <= m.bridgeRows[1];
  }

  function breakUnit(b, u, res) {
    if (onBridge(b, u)) {
      res.fell = true;
      var t = typeOf(u);
      while (u.names.length) b.fallen.push({ name: u.names.pop(), squad: u.squadName || t.name });
      u.models = 0;
      if (u.heroKey) { b.heroDown[u.heroKey] = true; }
      log(b, '✝ ' + unitLabel(u) + ' сломлен на мосту — и падает в пропасть.', 'grim');
      return;
    }
    u.broken = true;
    fleeMove(b, u, res);
  }

  function fleeMove(b, u, res) {
    if (u.y >= H - 1) { desert(b, u, res); return; }
    var t = typeOf(u);
    for (var s = 0; s < t.mv; s++) {
      var opts = [[u.x, u.y + 1], [u.x - 1, u.y + 1], [u.x + 1, u.y + 1], [u.x - 1, u.y], [u.x + 1, u.y]];
      var moved = false;
      for (var i = 0; i < opts.length; i++) {
        var nx = opts[i][0], ny = opts[i][1];
        if (inB(nx, ny) && !terrainAt(b, nx, ny).impass && !unitAt(b, nx, ny)) {
          u.x = nx; u.y = ny; moved = true;
          break;
        }
      }
      if (!moved || u.y >= H - 1) break;
    }
  }

  function desert(b, u, res) {
    if (res) res.deserted = true;
    b.deserters += u.models;
    log(b, '✝ ' + unitLabel(u) + ' дезертирует: ' + u.models + ' душ уходят во тьму.', 'grim');
    u.names.length = 0;
    u.models = 0;
    checkOutcome(b);
  }

  function moraleMsg(u, m) {
    var base = unitLabel(u) + ': мораль ' + m.roll + ' против Лд ' + m.ld;
    if (m.passed) return base + ' — строй держится.';
    if (m.fell) return base + ' — падение с моста!';
    if (m.deserted) return base + ' — дезертирство!';
    if (m.effect === 'shatter') return base + ' — Хор осыпается: −' + m.lost + '.';
    return base + ' — отряд сломлен и бежит!';
  }

  /* ---------- резолвер атаки ---------- */
  function rollPool(n, target) {
    var arr = [];
    for (var i = 0; i < n; i++) {
      var r = RNG.d6();
      arr.push({ r: r, ok: r >= target });
    }
    return arr;
  }

  function resolveAttack(b, att, def, mode) {
    var prof = attackProfile(b, att, def, mode);
    var out = { prof: prof, hits: [], wounds: [], saves: [], kills: 0, woundsLost: 0,
                fallen: [], destroyed: false, morale: null, attacker: att.uid, defender: def.uid };
    var nHits = 0;
    if (prof.auto) {
      for (var i = 0; i < prof.dice; i++) out.hits.push({ r: '★', ok: true });
      nHits = prof.dice;
    } else {
      out.hits = rollPool(prof.dice, prof.hitT);
      nHits = out.hits.filter(function (h) { return h.ok; }).length;
    }
    out.wounds = rollPool(nHits, prof.woundT);
    var nW = out.wounds.filter(function (w) { return w.ok; }).length;
    var fails = 0;
    for (var j = 0; j < nW; j++) {
      if (prof.saveT > 6) { out.saves.push({ r: '—', ok: false }); fails++; }
      else {
        var r = RNG.d6();
        var ok = r >= prof.saveT;
        out.saves.push({ r: r, ok: ok });
        if (!ok) fails++;
      }
    }
    var dmg = applyWounds(b, def, fails);
    out.kills = dmg.modelsKilled;
    out.woundsLost = dmg.woundsLost;
    out.fallen = dmg.fallen;
    out.destroyed = dmg.destroyed;
    att.kills += dmg.modelsKilled;
    if (mode === 'shoot') {
      if (att.buffs.shootTwice) delete att.buffs.shootTwice;
      att.shot = true;
    }
    /* дуэль финала: кто добил Первоголоса */
    if (def.type === 'pervogolos' && dmg.destroyed) {
      if (mode === 'melee' && att.heroKey === 'exec') {
        b.flags.duelDone = true;
        log(b, '⚔ Экзекутор дочитывает приговор. Первоголос рассыпается — навсегда.', 'win');
      } else {
        b.flags.pgDown = true;
        log(b, 'Первоголос рассыпан — но стекло уже ползёт обратно. Он вернётся.', 'grim');
      }
    }
    /* мораль от стрельбы: порог 25% за фазу */
    if (mode === 'shoot' && alive(def) && !isChar(def) && !def.broken && !def.testedPhase) {
      var startModels = def.models + def.lostPhase;
      var need = Math.ceil(startModels * 0.25);
      if (def.lostPhase >= need && need > 0) {
        out.morale = moraleTest(b, def, 0, 'потери от обстрела');
      }
    }
    checkOutcome(b);
    return out;
  }

  /* рукопашная: атакующий бьёт, выжившие отвечают, проигравший тестирует мораль −1 */
  function resolveFight(b, att, def) {
    var res = { att: null, back: null, loserMorale: null, loser: null };
    res.att = resolveAttack(b, att, def, 'melee');
    att.fought = true;
    var backKills = 0;
    if (alive(def) && !def.broken) {
      res.back = resolveAttack(b, def, att, 'melee');
      backKills = isChar(att) ? res.back.woundsLost : res.back.kills;
    }
    var attLoss = backKills;
    var defLoss = isChar(def) ? res.att.woundsLost : res.att.kills;
    if (alive(att) && alive(def)) {
      var loser = null;
      if (defLoss > attLoss) loser = def;
      else if (attLoss > defLoss) loser = att;
      if (loser && !isChar(loser) && !loser.broken) {
        res.loser = loser.uid;
        res.loserMorale = moraleTest(b, loser, -1, 'проиграна рукопашная');
      }
    }
    checkOutcome(b);
    return res;
  }

  /* ---------- приказы героев и чудеса ---------- */
  function orderRadius(b, hero) {
    var r = 4;
    if (hero.orderRange) r = hero.orderRange;
    return r;
  }
  function jamThreat(b, target) {
    if (b.flags.jamUsedRound) return null;
    var js = aliveUnits(b, 'ai').filter(function (e) {
      var et = typeOf(e);
      return et.jam && dist(e, target) <= et.jam.r;
    });
    return js.length ? js[0] : null;
  }
  function giveOrder(b, hero, orderId, target) {
    var res = { jammed: false, orderId: orderId };
    if (!hero.orderUnjammable) {
      var jammer = jamThreat(b, target);
      if (jammer) {
        b.flags.jamUsedRound = true;
        res.jammed = true;
        b.orderUsed[hero.uid] = true;
        if (orderId === 'glas') b.flags.glasUsed = true;
        log(b, '♪ Хорал Тишины глушит литанию: приказ «' + orderName(orderId) + '» не услышан.', 'grim');
        return res;
      }
    }
    b.orderUsed[hero.uid] = true;
    if (orderId === 'firm') {
      target.buffs.ldBonus = 2;
      if (target.broken) { target.broken = false; log(b, unitLabel(target) + ' слышит Экзекутора и встаёт в строй.', 'win'); }
      log(b, 'Приказ «Твёрдость»: ' + unitLabel(target) + ' +2 Лд.');
    } else if (orderId === 'glas') {
      b.flags.glasUsed = true;
      target.buffs.shootTwice = true;
      log(b, 'Приказ «Глас казни»: ' + unitLabel(target) + ' стреляет дважды.');
    } else if (orderId === 'bless') {
      target.buffs.hitBonus = 1;
      if (hero.orderSavePen) target.buffs.savePen = 1;
      log(b, 'Приказ «Благословение пороха»: ' + unitLabel(target) + ' +1 к попаданию' +
        (hero.orderSavePen ? ', −1 к спасу целей' : '') + '.');
    }
    return res;
  }
  function orderName(id) {
    if (id === 'firm') return 'Твёрдость';
    if (id === 'glas') return 'Глас казни';
    return 'Благословение пороха';
  }

  function castMiracle(b, mid, cell) {
    var results = [];
    if (mid === 'pillar') {
      log(b, '☄ ЧУДО: Столп пламени обрушивается на Хор!', 'win');
      aliveUnits(b, 'ai').forEach(function (e) {
        if (Math.max(Math.abs(e.x - cell.x), Math.abs(e.y - cell.y)) <= 1) {
          var fakeProfile = { woundT: woundTarget(5, typeOf(e).t), saveT: typeOf(e).sv - (e.svBonus || 0) };
          var fails = 0;
          var saves = [];
          for (var i = 0; i < 4; i++) {
            var wr = RNG.d6();
            if (wr >= fakeProfile.woundT) {
              var sr = RNG.d6();
              var ok = sr >= fakeProfile.saveT;
              saves.push(sr);
              if (!ok) fails++;
            }
          }
          var dmg = applyWounds(b, e, fails);
          results.push({ unit: e, kills: dmg.modelsKilled });
          log(b, unitLabel(e) + ' в столпе пламени: −' + (isChar(e) ? dmg.woundsLost + ' ран' : dmg.modelsKilled), 'melee');
          if (alive(e) && !isChar(e) && !e.testedPhase && e.lostPhase >= Math.ceil((e.models + e.lostPhase) * 0.25)) {
            var m = moraleTest(b, e, 0, 'столп пламени');
            log(b, moraleMsg(e, m));
          }
        }
      });
    } else if (mid === 'light') {
      b.flags.lightMiracle = true;
      log(b, '☄ ЧУДО: Свет истинный. Все отряды Державы: +1 к попаданию до конца хода.', 'win');
    } else if (mid === 'nabat') {
      b.flags.nabat = true;
      aliveUnits(b, 'player').forEach(function (u) {
        if (u.broken) { u.broken = false; log(b, unitLabel(u) + ' слышит набат и встаёт в строй.', 'win'); }
      });
      log(b, '☄ ЧУДО: Набат. +2 Лд всем до конца боя.', 'win');
    }
    checkOutcome(b);
    return results;
  }

  /* ---------- фазы и ход ---------- */
  function resetPhaseCounters(b) {
    b.units.forEach(function (u) { u.lostPhase = 0; u.testedPhase = false; });
  }

  function startPlayerTurn(b) {
    b.side = 'player';
    b.phase = 'orders';
    b.orderUsed = {};
    b.flags.jamUsedRound = false;
    b.flags.lightMiracle = false;
    var rallyLog = [];
    aliveUnits(b, 'player').forEach(function (u) {
      u.moved = false; u.ran = false; u.shot = false; u.fought = false; u.charged = false;
      u.buffs = {};
    });
    resetPhaseCounters(b);
    /* фаза морали: ретесты сломленных */
    aliveUnits(b, 'player').forEach(function (u) {
      if (!u.broken) return;
      var autoRally = b.units.some(function (o) {
        return alive(o) && o.side === 'player' && o.traits.indexOf('epitimya') >= 0 && dist(o, u) <= 3;
      });
      if (autoRally) {
        u.broken = false;
        rallyLog.push(unitLabel(u) + ' — Пламенная епитимья: встаёт в строй без броска.');
        return;
      }
      var bonus = nearHeroOrBanner(b, u) ? 2 : 0;
      var ld = Math.min(10, effLd(b, u) + bonus);
      var roll = RNG.d6() + RNG.d6();
      if (roll <= ld) {
        u.broken = false;
        rallyLog.push(unitLabel(u) + ': ралли ' + roll + '≤' + ld + ' — встаёт в строй.');
      } else {
        rallyLog.push(unitLabel(u) + ': ралли ' + roll + '>' + ld + ' — бежит дальше.');
        var res = {};
        fleeMove(b, u, res);
        if (u.y >= H - 1) desert(b, u, res);
      }
    });
    rallyLog.forEach(function (m) { log(b, m, 'morale'); });
    checkOutcome(b);
    return rallyLog;
  }

  function nextPhase(b) {
    var order = ['orders', 'move', 'shoot', 'melee'];
    var i = order.indexOf(b.phase);
    resetPhaseCounters(b);
    if (i < order.length - 1) {
      b.phase = order[i + 1];
      return b.phase;
    }
    return null; // конец хода игрока
  }

  function startAiTurn(b) {
    b.side = 'ai';
    b.phase = 'ai';
    aliveUnits(b, 'ai').forEach(function (u) {
      u.moved = false; u.ran = false; u.shot = false; u.fought = false; u.charged = false;
      u.buffs = {};
      /* щит-регенерация сверхтяжа Хора */
      var t = typeOf(u);
      if (t.shield && u.shield < t.shield.max) {
        u.shield = Math.min(t.shield.max, u.shield + t.shield.regen);
        log(b, '⛨ ' + unitLabel(u) + ': щит из звука отрастает (' + u.shield + '/' + t.shield.max + ').', 'grim');
      }
    });
    resetPhaseCounters(b);
    missionAiStart(b);
  }

  /* ---------- механика миссий ---------- */
  function missionAiStart(b) {
    var m = b.m;
    /* волны */
    (m.waves || []).forEach(function (w) {
      if (w.round === b.round && !b.flags['wave' + w.round]) {
        b.flags['wave' + w.round] = true;
        w.units.forEach(function (spec) {
          var spot = findFreeNear(b, spec.x, spec.y);
          if (spot) {
            makeUnit(b, spec.t, 'ai', spot.x, spot.y);
            log(b, '⚠ Волна Хора: ' + DATA.UNITS[spec.t].name + ' выходят из тьмы.', 'grim');
          }
        });
      }
    });
    /* призыв Камертонов (миссия 4) */
    if (m.win.type === 'killtype') {
      var cap = m.summonCap || 11;
      aliveUnits(b, 'ai').forEach(function (u) {
        if (u.type !== 'kamerton') return;
        if (aliveUnits(b, 'ai').length >= cap) return;
        var n = RNG.d3();
        var spot = findFreeNear(b, u.x, u.y);
        if (spot) {
          makeUnit(b, 'oskolki', 'ai', spot.x, spot.y, { models: Math.min(4 + n, 10) });
          log(b, '♪ Камертон звенит: из мёртвых собираются осколки (' + (4 + n) + ').', 'grim');
        }
      });
    }
    /* рост стекла (миссия 5) */
    if (m.glassGrow) {
      for (var g = 0; g < m.glassGrow; g++) {
        for (var tries = 0; tries < 30; tries++) {
          var x = RNG.int(W), y = RNG.int(H);
          if (cellChar(b, x, y) === '.') {
            b.cells[idx(x, y)] = 'G';
            break;
          }
        }
      }
      log(b, '♪ Палуба зарастает поющим стеклом.', 'grim');
      /* Хор на стекле восстанавливается */
      aliveUnits(b, 'ai').forEach(function (u) {
        var ter = terrainAt(b, u.x, u.y);
        if (ter.glass && !isChar(u) && u.models < typeOf(u).models) {
          u.models += 1;
          log(b, unitLabel(u) + ' срастается из стекла: +1.', 'grim');
        }
      });
    }
    /* Первоголос: воскрешение осколков и собственное возвращение */
    if (m.win.type === 'duel') {
      var pg = b.units.filter(function (u) { return u.type === 'pervogolos'; })[0];
      if (pg && !alive(pg) && b.flags.pgDown && !b.flags.duelDone) {
        var spot2 = findFreeNear(b, pg.x, pg.y);
        if (spot2) {
          pg.x = spot2.x; pg.y = spot2.y;
          pg.models = 1; pg.hp = 3; pg.broken = false;
          b.flags.pgDown = false;
          log(b, '♪ Стекло срастается: ПЕРВОГОЛОС ВОССТАЛ (3 раны). Только клинок Экзекутора кончит это.', 'grim');
        }
      }
      if (pg && alive(pg)) {
        var targets = aliveUnits(b, 'ai').filter(function (u) {
          return u.type === 'oskolki' && u.models < typeOf(u).models && dist(u, pg) <= 4;
        });
        if (targets.length) {
          targets.sort(function (a, c) { return a.models - c.models; });
          var heal = RNG.d3();
          var tgt = targets[0];
          tgt.models = Math.min(typeOf(tgt).models, tgt.models + heal);
          log(b, '♪ Первоголос поёт через мёртвых: ' + unitLabel(tgt) + ' +' + heal + '.', 'grim');
        }
      }
    }
  }

  function endAiTurn(b) {
    var m = b.m;
    /* удержание кадила (миссия 5) */
    if (m.win.type === 'hold') {
      var chorusOnK = aliveUnits(b, 'ai').some(function (u) { return cellChar(b, u.x, u.y) === 'K'; });
      var candleOnK = aliveUnits(b, 'player').some(function (u) { return cellChar(b, u.x, u.y) === 'K'; });
      if (chorusOnK && !candleOnK) {
        b.flags.holdLost = (b.flags.holdLost || 0) + 1;
        log(b, '⚠ Хор на Кадиле! (' + b.flags.holdLost + '/2)', 'grim');
        if (b.flags.holdLost >= 2) {
          b.outcome = { win: false, reason: 'Хор удержал Кадило. Литания оборвана.' };
          return;
        }
      } else {
        b.flags.holdLost = 0;
      }
      if (b.round >= m.win.rounds) {
        b.outcome = { win: true, reason: 'Кадило дожгло литанию. Хор отхлынул.' };
        return;
      }
    }
    if (m.win.type === 'survive' && b.round >= m.win.rounds) {
      var prot = protectedUnit(b, m);
      if (!prot || alive(prot)) {
        b.outcome = { win: true, reason: 'Резерв Державы подошёл. Линия выстояла.' };
        return;
      }
    }
    if (m.win.type === 'escort' && b.round >= m.win.rounds && !b.outcome) {
      b.outcome = { win: false, reason: 'Время вышло: реликварий не донесён до алтаря.' };
      return;
    }
    b.round += 1;
    checkOutcome(b);
  }

  function protectedUnit(b, m) {
    if (!m.protect) return null;
    return b.units.filter(function (u) { return u.type === m.protect && u.side === 'player'; })[0] || null;
  }

  function checkOutcome(b) {
    if (b.outcome) return;
    var m = b.m;
    var player = aliveUnits(b, 'player');
    var ai = aliveUnits(b, 'ai');

    if (!player.length) {
      b.outcome = { win: false, reason: 'Полк уничтожен. Свеча этого мира погасла.' };
      return;
    }
    var prot = protectedUnit(b, m);
    if (prot && !alive(prot)) {
      b.outcome = { win: false, reason: 'Свеченосец пал — знамя втоптано в пепел.' };
      return;
    }
    if (m.win.type === 'duel') {
      var execAlive = player.some(function (u) { return u.heroKey === 'exec'; });
      if (!execAlive) {
        b.outcome = { win: false, reason: 'Линия Экзекутора прервана. Некому дочитать приговор.' };
        return;
      }
      if (b.flags.duelDone) {
        b.outcome = { win: true, reason: 'Первоголос добит клинком. Хор Пояса замолкает.' };
        return;
      }
      if (!ai.length) {
        b.outcome = { win: true, reason: 'Хор истреблён до последней грани.' };
        return;
      }
    }
    if (m.win.type === 'annihilate' && !ai.length) {
      b.outcome = { win: true, reason: m.win.done || 'Хор истреблён до последней грани.' };
      return;
    }
    if (m.win.type === 'killtype') {
      var left = ai.filter(function (u) { return u.type === m.win.unitType; }).length;
      if (left === 0) {
        b.outcome = { win: true, reason: m.win.done || 'Цель миссии истреблена. Хор отхлынул.' };
        return;
      }
    }
    if (m.win.type === 'escort') {
      var esc = b.units.filter(function (u) { return u.type === m.win.unit && u.side === 'player'; })[0];
      if (esc && alive(esc) && cellChar(b, esc.x, esc.y) === m.win.cell) {
        b.outcome = { win: true, reason: 'Реликварий на алтаре. Поля снова пахнут воском, не стеклом.' };
        return;
      }
    }
    if ((m.win.type === 'survive' || m.win.type === 'hold' || m.win.type === 'escort') && !ai.length) {
      /* врагов нет и волн больше не будет? — для survive/hold досрочная победа если волны кончились */
      var wavesLeft = (m.waves || []).some(function (w) { return w.round > b.round; });
      if (!wavesLeft && m.win.type !== 'escort') {
        b.outcome = { win: true, reason: 'Хор истреблён до срока. Литания дочитана в тишине.' };
      }
    }
  }

  /* ---------- сборка боя ----------
     provId — провинция; mission — объект миссии (штурм из провинции или
     сгенерированная оборона при контратаке); хранится прямо в battle (b.m),
     поэтому сейв самодостаточен. */
  function buildBattle(provId, mission, playerUnits, campFlags) {
    campFlags = campFlags || {};
    var m = mission;
    var b = {
      provId: provId, m: m, defense: !!m.defense,
      round: 1, side: 'player', phase: 'orders',
      cells: m.map.join('').split(''),
      units: [], nextUid: 1, log: [], fallen: [], deserters: 0,
      flags: {}, orderUsed: {}, heroDown: {}, outcome: null,
      night: m.night || 0, ldGlobal: 0
    };
    var di = 0;
    playerUnits.forEach(function (spec) {
      var spot = m.deploy[di] ? { x: m.deploy[di][0], y: m.deploy[di][1] } : null;
      di++;
      if (!spot || unitAt(b, spot.x, spot.y) || terrainAt(b, spot.x, spot.y).impass) {
        spot = findFreeNear(b, spot ? spot.x : 3, spot ? spot.y : 9) || { x: 3, y: 10 };
      }
      makeUnit(b, spec.type, 'player', spot.x, spot.y, spec);
    });
    m.enemies.forEach(function (e) {
      if (e.skipIf && campFlags[e.skipIf]) return;
      makeUnit(b, e.t, 'ai', e.x, e.y);
    });
    log(b, '— ' + m.name + ' — ' + m.tagline + ' —', 'title');
    return b;
  }

  return {
    W: W, H: H, idx: idx, inB: inB, cellChar: cellChar, terrainAt: terrainAt,
    typeOf: typeOf, alive: alive, dist: dist, unitAt: unitAt, aliveUnits: aliveUnits,
    isEngaged: isEngaged, adjacentEnemies: adjacentEnemies, isChar: isChar,
    isVehicle: isVehicle, isArty: isArty, missionOf: missionOf,
    titanStage: titanStage, effStats: effStats,
    canArtyFire: canArtyFire, artyRangeOf: artyRangeOf, artyCellOk: artyCellOk,
    artyPreview: artyPreview, resolveArty: resolveArty,
    effLd: effLd, reachable: reachable, moveUnit: moveUnit,
    lineOfSight: lineOfSight, shootRange: shootRange, canShoot: canShoot,
    shootTargets: shootTargets, attackProfile: attackProfile, preview: preview,
    resolveAttack: resolveAttack, resolveFight: resolveFight, applyWounds: applyWounds,
    moraleTest: moraleTest, moraleMsg: moraleMsg, unitLabel: unitLabel,
    giveOrder: giveOrder, orderName: orderName, jamThreat: jamThreat, orderRadius: orderRadius,
    castMiracle: castMiracle,
    startPlayerTurn: startPlayerTurn, nextPhase: nextPhase,
    startAiTurn: startAiTurn, endAiTurn: endAiTurn, checkOutcome: checkOutcome,
    buildBattle: buildBattle, makeUnit: makeUnit, findFreeNear: findFreeNear,
    log: log, cum2d6: cum2d6, binomAtLeast: binomAtLeast
  };
})();
