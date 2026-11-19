/* Кубокрафт — подвижные части буровой: талевая система (кронблок, канат, крюкоблок, вертлюг, ведущая
   труба, буровой рукав), ротор, ключ АКБ, барабан лебёдки, колонна, свечи за пальцем, трубы на стеллажах,
   насосы, вибросита, перемешиватели, уровень раствора в ёмкостях. Рисуется каждый кадр по состоянию. */
(function () {
  'use strict';
  var KC = window.KC, T = KC.TILE, D = KC.RigDims, L = KC.RigLayout, F = D.FLOOR, S = KC.RigSim, C = S.C, Kit = KC.RigKit;

  var MOUSE = [1.35, F + 0.45, -1.7], RAT = [-1.5, F + 0.3, -1.9];
  var MDIR = (function () { var v = [1.35 - 1.9, F + 0.45 - 1.2, -1.7 + 2.6], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
  function along(p, d, s) { return [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s]; }
  function lerp(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }

  // труба с замками на концах
  function pipe(g, a, b, r, tile, joints) {
    g.tube(a, b, r, tile, { n: 6, caps: 0 });
    if (joints) {
      var l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1, d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
      g.tube(a, along(a, d, 0.35), r * 1.5, tile, { n: 6 }); g.tube(along(b, d, -0.35), b, r * 1.5, tile, { n: 6 });
    }
  }
  // место свечи за пальцем: чередуются левый и правый подсвечники
  function slot(i) {
    var side = i % 2 ? 1 : -1, k = i >> 1, row = k % 8, col = Math.floor(k / 8);
    return [side * (1.5 + col * 0.33), -5.33 + row * 0.45];
  }
  function swivel(g, x, hy, z, hang) {
    g.beam([x - 0.06, hy + 0.3, z], [x - 0.3, hy - 1.0, z], 0.07, 0.07, T.rgDark); g.beam([x + 0.06, hy + 0.3, z], [x + 0.3, hy - 1.0, z], 0.07, 0.07, T.rgDark);
    g.cyl('y', x, hy - 1.9, z, 0.9, 0.36, T.rgRed, { n: 10 });
    g.cyl('y', x, hy - 2.5, z, 0.6, 0.11, T.rgSteel, { n: 6 });
    g.tube([x + 0.3, hy - 1.25, z], [x + 0.62, hy - 0.85, z - 0.22], 0.085, T.rgRed, { n: 6 });
    return [x + 0.62, hy - 0.85, z - 0.22];
  }

  // Работник буровой: спецовка, каска. pose: 0 стоит, 1 работает руками, 2 тянется вверх (верховой)
  function man(g, x, y, z, yaw, t, pose, helm) {
    g.push().move(x, y, z).rot('y', yaw);
    var sw = pose === 1 ? Math.sin(t * 4.2 + x * 3) : 0, sv = g.mat;
    g.mat = KC.MAT.SOLID;
    g.box(-0.21, 0, -0.1, -0.02, 0.8, 0.1, T.rgBlack); g.box(0.02, 0, -0.1, 0.21, 0.8, 0.1, T.rgBlack);
    g.box(-0.25, 0.8, -0.14, 0.25, 1.42, 0.14, T.rgCoverall);
    g.box(-0.17, 1.42, -0.17, 0.17, 1.72, 0.17, T.rgSkin);
    g.box(-0.2, 1.68, -0.2, 0.2, 1.84, 0.2, helm || T.rgOrange); g.box(-0.22, 1.68, 0.2, 0.22, 1.72, 0.3, helm || T.rgOrange);
    [-1, 1].forEach(function (s) {
      var sh = [s * 0.31, 1.36, 0], hand = pose === 2 ? [s * 0.33, 1.95 + sw * 0.05, 0.25] : pose === 1 ? [s * 0.27, 1.02 + s * sw * 0.14, 0.42] : [s * 0.33, 0.82, 0.04];
      g.beam(sh, hand, 0.13, 0.13, T.rgCoverall, { caps: true });
    });
    g.mat = sv;
    g.pop();
  }
  // Вахта: бурильщик у пульта, два помощника у ротора, верховой — на балконе при СПО
  function crew(g, st, t, lit) {
    var trip = st.kelly === 'rathole' && (st.rackDir || st.hang === 'stand' || st.opName === 'Подъём инструмента' || st.opName === 'Спуск инструмента');
    var busy = st.akb > 0.05 || st.kx !== 0 || st.q.length > 0;
    lit('floor', 0, F + 2, 0);
    man(g, -3.3, F, 4.45, Math.PI, t, st.q.length || st.mode === 'drill' ? 1 : 0, T.rgWhite);
    if (busy) { man(g, -1.05, F, -0.75, -2.2, t, 1); man(g, 1.2, F, -0.95, 2.3, t + 1, 1); }
    else { man(g, -2.4, F, -1.3, -1.9, t, 0); man(g, 2.9, F, -0.6, 1.4, t, 0); }
    if (trip) { lit('monkey', 0, D.MONKEY + 1, -3); man(g, 0.2, D.MONKEY, -2.6, Math.PI * 0.5 * (st.stands % 2 ? 1 : -1), t, st.rackT > 0 ? 2 : 0); }
    else man(g, 4.4, F, 2.6, -0.6, t, 0);
    lit('pumps', 48, 3, -2);
    man(g, 47.6, 1, 2.9, 2.6, t, 0, T.rgYellow);
  }

  function draw(g, p, env) {
    var st = p.st, rt = S.rtOf(p), RX = st.slot * L.STEP, k = new Kit(g, null), hy = F + st.hookY, i, t = env.t;
    var wc = KC.Props.world(p, RX, 0, 0), camD = Math.hypot(env.cam.x - wc[0], env.cam.z - wc[2]);
    function lit(name, x, y, z) { env.lit(name, RX + x, y, z); }
    g.push().move(RX, 0, 0);

    // --- кронблок и талевый канат ---
    lit('crown', 0, D.CROWN - 4, 0);
    for (i = 0; i < 6; i++) g.disc('x', -0.75 + i * 0.3, D.CROWN, 0, 0.6, T.rgSheave, rt.sheave * (1 + i * 0.35));
    for (i = 0; i < 5; i++) {
      var lx = -0.6 + i * 0.3;
      g.beam([lx, D.CROWN, -0.55], [lx, hy + 2.55, -0.46], 0.035, 0.035, T.rgRope);
      g.beam([lx + 0.1, D.CROWN, 0.55], [lx + 0.1, hy + 2.55, 0.46], 0.035, 0.035, T.rgRope);
    }
    g.beam([-0.75, D.CROWN + 0.5, 0.35], [-0.3, F + 1.6, 6.05], 0.04, 0.04, T.rgRope);                // ходовой конец к барабану
    g.beam([0.75, D.CROWN, -0.58], [3.3, F + 0.45, -0.75], 0.04, 0.04, T.rgRope);                     // неподвижный конец
    // --- крюкоблок УТБК-5-225 ---
    lit('hook', 0, hy, -1);
    g.box(-0.55, hy + 1.6, -0.28, 0.55, hy + 3.25, 0.28, T.rgYellow);
    g.box(-0.6, hy + 3.25, -0.33, 0.6, hy + 3.35, 0.33, T.rgDark);
    g.box(-0.56, hy + 1.9, -0.29, 0.56, hy + 2.1, 0.29, T.rgHazard);
    g.disc('z', 0, hy + 2.6, -0.3, 0.48, T.rgSheave, rt.sheave * 2); g.disc('z', 0, hy + 2.6, 0.3, 0.48, T.rgSheave, rt.sheave * 2);
    g.cyl('y', 0, hy + 0.95, 0, 0.65, 0.2, T.rgDark, { n: 8 });
    g.box(-0.2, hy + 0.3, -0.13, 0.2, hy + 0.95, 0.13, T.rgDark); g.box(-0.2, hy, -0.13, 0.05, hy + 0.3, 0.13, T.rgDark);

    // --- вертлюг, ведущая труба, буровой рукав или элеватор ---
    var sy = F + 17, hoseTo = [D.legX(sy) + 0.85 - 1.3, sy + 0.2, -0.95], goose = null;
    if (st.kelly === 'rathole') {
      lit('floor', 0, F + 2, 0);
      goose = swivel(g, RAT[0], F + 3.3, RAT[2]);
      g.beam([RAT[0], F + 0.8, RAT[2]], [RAT[0] - 0.12, F + 0.2, RAT[2] - 0.18], 0.15, 0.15, T.rgSteel);
    } else {
      goose = swivel(g, 0, hy, 0);
      var tg = st.kx > 0 ? MOUSE : RAT, ak = Math.abs(st.kx), top = [0, hy - 2.5, 0];
      var bot = [tg[0] * ak, hy - C.SWL, tg[2] * ak];
      g.beam(top, bot, 0.15, 0.15, T.rgSteel, { up: [Math.cos(rt.rot), 0, Math.sin(rt.rot)] });
      if (st.kSingle) { var d1 = [bot[0] - top[0], bot[1] - top[1], bot[2] - top[2]], dl = Math.hypot(d1[0], d1[1], d1[2]); pipe(g, bot, along(bot, [d1[0] / dl, d1[1] / dl, d1[2] / dl], D.SINGLE), 0.07, T.rgRust, true); }
    }
    var hd = Math.hypot(goose[0] - hoseTo[0], goose[1] - hoseTo[1], goose[2] - hoseTo[2]);
    g.rope(hoseTo, goose, 0.085, T.rgHose, Math.sqrt(Math.max(4, 19 * 19 - hd * hd)) * 0.42, 9);
    if (st.el) {
      lit('hook', 0, hy, -1);
      g.beam([-0.12, hy + 0.3, 0], [-0.24, hy - 0.9, 0], 0.06, 0.06, T.rgDark); g.beam([0.12, hy + 0.3, 0], [0.24, hy - 0.9, 0], 0.06, 0.06, T.rgDark);
      g.box(-0.32, hy - 1.15, -0.2, 0.32, hy - 0.85, 0.2, T.rgDark);
    }

    // --- колонна в скважине: бурильная или обсадная ---
    lit('floor', 0, F + 2, 0);
    var racking = st.rackDir > 0 && st.rackT > 0, topY;
    if (st.strLen > 0) {
      topY = st.kelly === 'string' ? hy - C.SWL : st.onEl && !racking ? hy - 1.0 : F + 0.8;
      pipe(g, [0, topY, 0], [0, -1.2, 0], 0.068, T.rgRust, false);
      for (var jy = topY; jy > -1; jy -= D.SINGLE) g.cyl('y', 0, jy - 0.4, 0, 0.4, 0.1, T.rgRust, { n: 6 });
    } else if (st.casLen > 0) {
      topY = st.onEl ? hy - 1.0 : F + 0.8;
      var cr = st.casD > 200 ? 0.125 : 0.078;
      g.tube([0, topY, 0], [0, -1.2, 0], cr, T.rgDark, { n: 8, caps: 2 });
      for (var cy = topY; cy > -1; cy -= D.SINGLE) g.cyl('y', 0, cy - 0.3, 0, 0.3, cr * 1.18, T.rgDark, { n: 8 });
    }
    if (st.hang === 'casing') { var hr = st.casD > 200 ? 0.125 : 0.078; g.tube([0, hy - 1.0, 0], [0, hy - 1.0 - D.SINGLE, 0], hr, T.rgDark, { n: 8 }); }
    // клинья ПКР в роторе
    if (st.slips) for (i = 0; i < 3; i++) { var sa = i * 2.094; g.box(Math.cos(sa) * 0.17 - 0.09, F + 0.2, Math.sin(sa) * 0.17 - 0.09, Math.cos(sa) * 0.17 + 0.09, F + 0.46, Math.sin(sa) * 0.17 + 0.09, T.rgDark); }
    // стол ротора: вращается вместе с ведущей трубой
    g.push().move(0, F + 0.08, 0).rot('y', -rt.rot);
    g.cyl('y', 0, 0, 0, 0.12, 0.62, T.rgDark, { n: 10 });
    g.box(-0.34, 0.12, -0.34, 0.34, 0.16, 0.34, T.rgSteel);
    if (st.kelly === 'string') g.box(-0.24, 0.16, -0.24, 0.24, 0.5, 0.24, T.rgGreen);
    g.pop();
    // ключ АКБ-3М2: блок ключа выезжает к замку
    var ah = lerp([1.9, F + 1.0, 1.25], [0.42, F + 0.75, 0.2], st.akb);
    g.beam([2.4, F + 1.45, 1.7], [ah[0], ah[1] + 0.3, ah[2]], 0.16, 0.2, T.rgGrey);
    g.box(ah[0] - 0.5, ah[1], ah[2] - 0.4, ah[0] + 0.3, ah[1] + 0.5, ah[2] + 0.4, T.rgOrange);
    g.box(ah[0] - 0.62, ah[1] + 0.1, ah[2] - 0.3, ah[0] - 0.5, ah[1] + 0.4, ah[2] - 0.1, T.rgDark); g.box(ah[0] - 0.62, ah[1] + 0.1, ah[2] + 0.1, ah[0] - 0.5, ah[1] + 0.4, ah[2] + 0.3, T.rgDark);
    // барабан лебёдки с тормозными шкивами
    g.push().move(0, D.DRUM[1], D.DRUM[2]);
    g.cyl('x', -0.72, 0, 0, 1.44, 0.44, T.rgDrum, { n: 12, a0: rt.drum });
    g.cyl('x', -1.05, 0, 0, 0.27, 0.72, T.rgDark, { n: 12, a0: rt.drum, capTile: T.rgSheave }); g.cyl('x', 0.78, 0, 0, 0.27, 0.72, T.rgDark, { n: 12, a0: rt.drum, capTile: T.rgSheave });
    g.pop();
    // одиночка в шурфе и подача следующей с мостков
    if (st.mouse) pipe(g, along(MOUSE, MDIR, -0.3), along(MOUSE, MDIR, 1.0), 0.07, T.rgRust, false), g.tube(along(MOUSE, MDIR, 0.7), along(MOUSE, MDIR, 1.05), 0.1, T.rgRust, { n: 6 });
    if (st.feed > 0) {
      var f = st.feed, h0 = [0.3, 1.2, -14], h1 = [0.5, F + 1.3, -6.4], a0 = [0.3, 1.2, -24], hp, tp;
      if (f < 0.6) { hp = lerp(h0, h1, f / 0.6); var dd = [a0[0] - hp[0], a0[1] - hp[1], a0[2] - hp[2]], dn = Math.hypot(dd[0], dd[1], dd[2]); tp = along(hp, [dd[0] / dn, dd[1] / dn, dd[2] / dn], D.SINGLE); }
      else { var f2 = (f - 0.6) / 0.4, dd2 = [a0[0] - h1[0], a0[1] - h1[1], a0[2] - h1[2]], dn2 = Math.hypot(dd2[0], dd2[1], dd2[2]); hp = lerp(h1, along(MOUSE, MDIR, 1.0), f2); tp = lerp(along(h1, [dd2[0] / dn2, dd2[1] / dn2, dd2[2] / dn2], D.SINGLE), along(MOUSE, MDIR, 1.0 - D.SINGLE), f2); }
      pipe(g, tp, hp, 0.07, T.rgRust, true);
      g.beam(hp, [5.2, F + 1.0, 4.0], 0.025, 0.025, T.rgRope);
    }

    if (camD < 110) crew(g, st, t, lit);

    // --- свечи за пальцем ---
    if (camD < 170) {
      lit('stands', 0, F + 14, -4);
      var ns = Math.min(st.stands, 208);
      for (i = 0; i < ns; i++) { var sl = slot(i); g.tube([sl[0], F + 0.14, sl[1]], [sl[0] * 1.02, F + 0.14 + D.STAND, sl[1] + 0.12], 0.068, T.rgRust, { n: 4, caps: 2 }); }
      if (st.rackT > 0 || st.hang === 'stand') {            // свеча в руках верхового: от центра скважины к пальцу и обратно
        var s2 = slot(st.stands), kk = st.rackT, eb = st.hang === 'stand' ? hy - 1.0 - D.STAND : F + 0.8, lift = Math.sin(kk * Math.PI) * 0.5;
        pipe(g, lerp([0, eb, 0], [s2[0], F + 0.14, s2[1]], kk).map(function (v, ix) { return ix === 1 ? v + lift : v; }),
          lerp([0, eb + D.STAND, 0], [s2[0] * 1.02, F + 0.14 + D.STAND, s2[1] + 0.12], kk), 0.068, T.rgRust, true);
      }
    }
    // --- трубы на стеллажах: бурильные справа, обсадные слева ---
    if (camD < 130) {
      lit('rack', 5, 2.5, -20);
      var nr = Math.min(st.rack, 240);
      for (i = 0; i < nr; i++) { var lay = Math.floor(i / 40), px = 1.55 + (i % 40) * 0.2 + (lay % 2) * 0.1; g.tube([px, 1.06 + lay * 0.17, -26.8], [px, 1.06 + lay * 0.17, -14.3], 0.07, T.rgRust, { n: 4, caps: 2 }); }
      var nc = Math.min(st.casRack, 60), cr2 = st.casD > 200 || !st.casD ? 0.125 : 0.078;
      for (i = 0; i < nc; i++) { var cl = Math.floor(i / 28), cx = -1.6 - (i % 28) * (cr2 * 2 + 0.03) - (cl % 2) * cr2; g.tube([cx, 0.98 + cr2 + cl * cr2 * 1.8, -26.6], [cx, 0.98 + cr2 + cl * cr2 * 1.8, -14.6], cr2, T.rgDark, { n: 6, caps: 2 }); }
    }

    // --- эшелон: уровни в ёмкостях, сита, перемешиватели, насосы, лампы «работает / стоит», потоки ---
    if (camD < 200) {
      var q = S.flow(st, rt), circ = !!(st.fl && st.fl.inn > 0.5), eq = st.eq, pw = st.power, ph = t * (1.2 + q / 25);
      lit('ech', 30, 5, -2);
      L.TANK_X.forEach(function (tx, ix) {
        var lv = L.TANK_Y[0] + 0.1 + Math.max(0.02, Math.min(1, st.tank[ix] / 40)) * 2.7;
        g.box(tx[0] + 0.1, lv - 0.02, L.TANK_Z[0] + 0.1, tx[1] - 0.1, lv, L.TANK_Z[1] - 0.1, T.rgMud, { skip: 'ewsnb' });
      });
      g.box(9.4, 3.2, -3.8, 20.6, 3.22, 4.6, T.rgMud, { skip: 'ewsnb' });
      L.SHAKER.forEach(function (sp, ix) {
        var on = eq.sh[ix] && pw;
        k.shakerDyn(sp[0], 4, sp[1], t, on, circ && on);
        k.lampDyn(sp[0] - 0.7, 5.62, sp[1] - 1.3, on);
        if (!circ) return;
        g.tube([sp[0], 5.62, sp[1] - 1.3], [sp[0], 5.0, sp[1] - 1.2], 0.11, T.rgMud, { n: 6, caps: 0 });        // струя из выкидной линии
        var wdt = on ? (st.fl.pit > 1 ? 0.28 : 0) : 0.7;                                                     // мимо сит — по жёлобу в амбар
        if (wdt) {
          if (!on) g.beam([sp[0], 4.98, sp[1] - 0.8], [sp[0], 4.34, sp[1] + 2.2], wdt, 0.05, T.rgMud);
          g.beam([sp[0], 4.34, sp[1] + 2.2], [sp[0], 0.7, 13.2], wdt, 0.05, T.rgMud);
          g.tube([sp[0], 0.7, 13.2], [sp[0], -1.3, 13.6], wdt * 0.4, T.rgMud, { n: 6, caps: 0 });
        }
      });
      L.AGIT.forEach(function (ap, ix) { k.agitatorDyn(ap[0], 4, ap[1], 2.5, rt.agit + ix); k.lampDyn(ap[0], 4.98, ap[1] + 0.26, eq.ag && pw); });
      k.lampDyn(16.2, 6.68, -2.7, eq.dg && pw); k.lampDyn(16.2, 6.58, 3.0, eq.ds && pw); k.lampDyn(19.2, 6.08, 3.0, eq.dl && pw); k.lampDyn(19.0, 5.93, -2.8, eq.cf && pw);
      L.SLURRY.forEach(function (sp2, ix) { k.lampDyn(sp2[0] + 0.45, 4.92, sp2[1], pw && (ix ? eq.ds || eq.dl : eq.dg)); });
      L.SUC.forEach(function (x, ix) { k.lampDyn(x, 5.16, -4.5, st.suc[ix]); });
      L.EQZ.forEach(function (x, ix) { k.lampDyn(x, 5.42, -4.5, st.eqz[ix]); });
      lit('pumps', 48, 3, -2);
      L.PUMP.forEach(function (pp, ix) { k.mudPumpDyn(pp[0], 1, pp[1], rt.pump[ix]); k.lampDyn(pp[0], 3.38, pp[1] + 1.25, st.pumps[ix] && pw); });
      L.COMPR.forEach(function (cp, ix) { k.compressorDyn(cp[0], 1, cp[1], rt.comp * (ix ? 1 : 0.93)); });
      // потоки по трубам: белые метки бегут по ходу раствора
      if (q > 0.5) {
        var open = [0, 1, 2].filter(function (ix) { return st.suc[ix] && st.tank[ix] > 1.5; });
        if (open.length) {
          var x0 = (L.TANK_X[open[0]][0] + L.TANK_X[open[0]][1]) / 2;
          flowMarks(g, [[x0, 1.45, -3.95], [x0, 1.45, -4.45], [53.5, 1.45, -4.45]], 0.18, ph, 3);
        }
        if (circ) {
          var sx2 = D.legX(F + 17) + 0.85;
          lit('ech', 30, 5, -2);
          flowMarks(g, [[52.6, 2.75, -4.35], [9.2, 2.3, -4.35], [5.5, 1.9, -4.35], [5.5, 1.9, -1.2], [5.5, F + 1.2, -1.2], [5.5, F + 1.2, -0.95], [sx2, F + 17, -0.95]], 0.1, ph, 3);
          flowMarks(g, [[0.45, 6.05, 0], [9.6, 5.85, 0], [9.6, 5.85, 0.6], [14.4, 5.75, 0.6]], 0.2, ph * 0.7, 2.2);
        }
      }
      // цементировочные агрегаты на время цементирования
      if (st.cementing) {
        lit('cem', -9, 2, 18);
        k.cementTruck(-9, 0, 17); k.cementTruck(-9, 0, 21, 'mixer');
        g.rope([-6, 1.3, 17], [-0.6, 1.2, 0.9], 0.06, T.rgHose, 0.9, 7);
        g.rope([-7, 1.6, 20.2], [-7.5, 1.6, 17.8], 0.06, T.rgHose, 0.5, 4);
      }
    }
    g.pop();
    // шламовый амбар: уровень растёт, когда раствор уходит мимо ёмкостей
    if (camD < 220) {
      env.lit('pit', 36, 0.5, 20);
      var py = -1.5 + Math.min(1.3, (st.pit || 0) / 700 * 1.3);
      g.box(L.PIT[0], py - 0.02, L.PIT[1], L.PIT[2], py, L.PIT[3], T.rgMud, { skip: 'ewsnb' });
    }
  }

  // Метки потока вдоль трубы: короткие кольца, бегущие по ломаной
  function flowMarks(g, pts, r, phase, step) {
    var off = ((phase % step) + step) % step, c = 0, i;
    for (i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (l < 0.01) continue;
      var d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
      for (var s = off + Math.ceil((c - off) / step) * step - c; s < l - 0.3; s += step) g.tube(along(a, d, s), along(a, d, s + 0.3), r * 1.3, T.rgWhite, { n: 6, caps: 0 });
      c += l;
    }
  }

  S.draw = draw;
})();
