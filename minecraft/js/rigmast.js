/* Кубокрафт — вышечно-лебёдочный блок БУ-3000 ЭУК-1М: подвышечное основание на рельсовых тележках,
   пол буровой, А-образная мачта ВМР-45×200 с кронблочной площадкой и балконом верхового, лебёдка
   ЛБУ-1200К, ротор Р-560, пост бурильщика, ключ АКБ-3М2, приёмный мост со стеллажами.
   Начало координат — устье скважины на поверхности площадки, +X — в сторону эшелона, −Z — приёмный мост. */
(function () {
  'use strict';
  var KC = window.KC, T = KC.TILE, MAT = KC.MAT, B = KC.B, K = KC.RigKit.prototype;

  var D = {
    FLOOR: 7,               // отметка пола буровой
    FOOT: 4.6, TOPX: 1.45,  // полуразнос ног мачты у пола и у кронблочной рамы
    LEG0: 7.6, LEG1: 50.4,  // отметки низа и верха ног
    CROWN: 51.65,           // ось шкивов кронблока
    MONKEY: 33,             // балкон верхового
    DRUM: [0, 8.15, 6.2],   // ось барабана лебёдки
    STAND: 25, SINGLE: 12.5, KELLY: 14
  };
  D.legX = function (y) { return D.FOOT - (D.FOOT - D.TOPX) * (y - D.LEG0) / (D.LEG1 - D.LEG0); };
  D.legW = function (y) { return 1.3 - 0.3 * (y - D.LEG0) / (D.LEG1 - D.LEG0); };
  KC.RigDims = D;

  // ---- Подвышечное основание ---------------------------------------------------------------
  K.substructure = function () {
    var g = this.g, self = this, F = D.FLOOR, BL = T.rgBlue, xs = [-6.5, -2.5, 2.5, 6.5];
    [-1, 1].forEach(function (s) {
      var zi = s * 3.5, zo = s * 6.5;
      [zi, zo].forEach(function (zz) {
        g.box(-7, 0.55, zz - 0.22, 7, 1.0, zz + 0.22, BL);                    // нижние и верхние пояса
        g.box(-7, F - 0.6, zz - 0.2, 7, F - 0.12, zz + 0.2, BL);
        xs.forEach(function (xx) { g.box(xx - 0.16, 1.0, zz - 0.16, xx + 0.16, F - 0.6, zz + 0.16, BL); self.solid(xx - 0.1, 1, zz - 0.1, xx + 0.1, F - 1, zz + 0.1, 'post'); });
        for (var i = 0; i < 3; i++) {                                           // крестовые связи в пролётах
          g.beam([xs[i], 1.0, zz], [xs[i + 1], F - 0.6, zz], 0.12, 0.12, BL);
          g.beam([xs[i + 1], 1.0, zz], [xs[i], F - 0.6, zz], 0.12, 0.12, BL);
        }
        self.solid(-7, 0, zz - 0.4, 7, 1, zz + 0.4);
      });
      xs.forEach(function (xx) {                                                // поперечные рамы боковины
        g.box(xx - 0.14, 0.6, Math.min(zi, zo), xx + 0.14, 0.95, Math.max(zi, zo), BL);
        g.beam([xx, 1.0, zi], [xx, F - 0.6, zo], 0.1, 0.1, BL); g.beam([xx, 1.0, zo], [xx, F - 0.6, zi], 0.1, 0.1, BL);
      });
      // рельсовые тележки
      [-5, 5].forEach(function (bx) {
        var rz = s * 4.25;
        g.box(bx - 1.3, 0.22, rz - 0.3, bx + 1.3, 0.56, rz + 0.3, T.rgDark);
        [-0.8, 0.8].forEach(function (o) { g.cyl('z', bx + o, 0.43, rz - 0.1, 0.2, 0.28, T.rgSteel, { n: 10 }); });
        g.box(bx - 0.25, 0.55, Math.min(zi, s * 4.25), bx + 0.25, 0.95, Math.max(zi, s * 4.25), BL);
      });
      // площадка обслуживания ПВО на отметке 3 м
      self.deck(-2.5, s > 0 ? 3.7 : -6.3, 2.5, s > 0 ? 6.3 : -3.7, 3, { grate: true });
      self.rail(-2.5, s * 3.7, 2.5, s * 3.7, 3, s > 0 ? 'nz' : 'pz');
    });
    // балки пола: поперечные и подроторные
    xs.concat([-4.5, 0, 4.5]).forEach(function (xx) { g.box(xx - 0.15, F - 0.55, -7, xx + 0.15, F - 0.12, 9, BL); });
    [-0.95, 0.95].forEach(function (xx) { g.box(xx - 0.22, F - 0.95, -3.5, xx + 0.22, F - 0.12, 3.5, BL); });
    g.box(-7, F - 0.5, 8.7, 7, F - 0.12, 9, BL); g.box(-7, F - 0.5, -7, 7, F - 0.12, -6.7, BL);
    [-6.5, 6.5].forEach(function (xx) { g.box(xx - 0.16, 1.0, 8.6, xx + 0.16, F - 0.5, 8.9, BL); g.beam([xx, 1.0, 6.5], [xx, F - 0.6, 8.75], 0.1, 0.1, BL); });
    // лестница на площадку ПВО
    this.ladder(-3, 0, 4, 3, 'px', false);
    // шахта устья
    g.box(-1.3, -1.2, -1.3, 1.3, 0.02, -1.15, T.rgSlab); g.box(-1.3, -1.2, 1.15, 1.3, 0.02, 1.3, T.rgSlab);
    g.box(-1.3, -1.2, -1.15, -1.15, 0.02, 1.15, T.rgSlab); g.box(1.15, -1.2, -1.15, 1.3, 0.02, 1.15, T.rgSlab);
    return this;
  };

  // ---- Пол буровой, укрытие, оборудование на полу -------------------------------------------
  K.rigFloor = function () {
    var g = this.g, F = D.FLOOR, self = this, sv;
    this.deck(-7, -7, 7, 9, F, { frame: false });
    // подсвечники из бруса
    sv = g.mat; g.mat = MAT.SOLID;
    g.box(-5.9, F, -6.2, -2.1, F + 0.14, -1.5, T.rgTimber); g.box(2.1, F, -6.2, 5.9, F + 0.14, -1.5, T.rgTimber);
    g.mat = sv;
    // ограждение: спереди — с воротами к приёмному мосту
    this.rail(-7, -7, -6, -7, F, 'nz', { noHull: true }); this.rail(-5, -7, -1.3, -7, F, 'nz'); this.rail(1.3, -7, 7, -7, F, 'nz');
    this.rail(-7, -7, -7, 2, F, 'nx'); this.rail(7, -7, 7, 2, F, 'px');
    // ветровое укрытие лебёдочной части: стены и кровля с прорезью под талевый канат
    var W = T.rgSideBlue, H1 = F + 4.6;
    g.box(-7, F, 8.94, 7, H1, 9, W); this.solid(-7, F, 8.5, 7, H1, 9, 'wall', 'pz');
    g.box(-7, F, 2, -6.94, H1, 8.94, W); this.solid(-7, F, 2, -6.5, H1, 9, 'wall', 'nx');
    g.box(6.94, F, 2, 7, H1, 5, W); this.solid(6.5, F, 2, 7, H1, 5, 'wall', 'px');
    g.box(6.94, F + 2.2, 5, 7, H1, 6, W); g.box(6.94, F, 6, 7, H1, 8.94, W); this.solid(6.5, F, 6, 7, H1, 9, 'wall', 'px');
    g.box(-7, F + 3.2, 8.92, 7, F + 3.9, 8.94, T.rgSideWhite, { skip: 'ewtbs' });
    g.box(-1, F + 1.2, 9, 1, F + 2.2, 9.02, T.rgSign, { fit: true, skip: 'ewtbn' });
    g.box(-7.2, H1, 3.4, -0.75, H1 + 0.08, 9.2, T.rgSideGrey); g.box(0.75, H1, 3.4, 7.2, H1 + 0.08, 9.2, T.rgSideGrey);
    [-6.9, 6.9].forEach(function (xx) { g.box(xx - 0.07, F, 3.4, xx + 0.07, H1, 3.54, T.rgBlue); });
    g.box(-7, H1 - 0.2, 3.4, 7, H1, 3.54, T.rgBlue);
    // ротор Р-560: станина (стол вращается — подвижная часть) и кожух привода от лебёдки
    g.box(-1.0, F - 0.5, -0.95, 1.0, F + 0.08, 1.05, T.rgGreen);
    g.box(-0.28, F, 1.05, 0.28, F + 0.3, 4.95, T.rgYellow);
    // шурфы: под наращиваемую трубу и под ведущую трубу
    g.tube([1.35, F + 0.45, -1.7], [1.9, 1.2, -2.6], 0.15, T.rgDark, { n: 8, caps: 0 });
    g.tube([-1.5, F + 0.3, -1.9], [-2.2, 0.8, -3.0], 0.18, T.rgDark, { n: 8, caps: 0 });
    // ключ АКБ-3М2: колонна (блок ключа — подвижный)
    g.cyl('y', 2.4, F, 1.7, 1.75, 0.17, T.rgGrey, { n: 8 }); g.box(2.0, F, 1.3, 2.8, F + 0.12, 2.1, T.rgDark);
    this.solid(2.2, F, 1.5, 2.6, F + 1.7, 1.9, 'post');
    // вспомогательная лебёдка
    this.at(5.4, F, 4.2, function (g2) {
      g2.box(-0.7, 0, -0.5, 0.7, 0.15, 0.5, T.rgBlue); g2.box(-0.65, 0.15, -0.4, -0.45, 0.85, 0.4, T.rgGreen); g2.box(0.15, 0.15, -0.4, 0.35, 0.85, 0.4, T.rgGreen);
      g2.cyl('x', -0.45, 0.55, 0, 0.6, 0.24, T.rgDrum, { n: 8 }); this.motor(0.35, 0.5, 0, 'x', 0.45, 0.2);
      this.solid(-0.7, 0, -0.5, 0.7, 0.9, 0.5);
    });
    // пост бурильщика: пульт, индикатор веса ГИВ-6, манометр стояка
    this.at(-3.3, F, 3.7, function (g2) {
      g2.box(-0.7, 0, -0.3, 0.7, 0.95, 0.3, T.rgGrey);
      g2.quad([-0.7, 0.95, 0.3], [0.7, 0.95, 0.3], [0.7, 1.2, -0.3], [-0.7, 1.2, -0.3], T.rgPanel, null, [0, 1, 0.3]);
      g2.box(-0.7, 0.95, -0.3, 0.7, 1.2, -0.26, T.rgGrey);
      g2.cyl('y', 1.05, 0, -0.1, 1.55, 0.05, T.rgDark, { n: 6 });
      g2.box(0.7, 1.45, -0.16, 1.4, 2.15, -0.04, [T.rgDark, T.rgDark, T.rgDark, T.rgDark, T.rgGiv, T.rgDark], { fit: true });
      g2.box(-1.25, 1.35, -0.14, -0.8, 1.8, -0.06, [T.rgDark, T.rgDark, T.rgDark, T.rgDark, T.rgGauge, T.rgDark], { fit: true });
      g2.cyl('y', -1.03, 0, -0.1, 1.35, 0.04, T.rgDark, { n: 6 });
      g2.beam([0.35, 0.6, 0.3], [0.5, 1.5, 0.75], 0.06, 0.06, T.rgRed);                    // рукоятка тормоза
      this.solid(-0.7, 0, -0.3, 0.7, 1, 0.3);
    });
    // навес над постом бурильщика и механизм крепления неподвижного конца каната
    [[-4.2, 3.2], [-2.3, 3.2]].forEach(function (q) { g.box(q[0] - 0.04, F, q[1] - 0.04, q[0] + 0.04, F + 2.5, q[1] + 0.04, T.rgBlue); });
    g.quad2([-4.4, F + 2.5, 3.0], [-2.1, F + 2.5, 3.0], [-2.1, F + 2.75, 4.9], [-4.4, F + 2.75, 4.9], T.rgSideGrey, [0, 0, 1, 0, 1, 1, 0, 1]);
    g.box(3.0, F, -1.05, 3.6, F + 0.12, -0.45, T.rgDark); g.cyl('z', 3.3, F + 0.42, -1.0, 0.5, 0.3, T.rgDrum, { n: 10 });
    g.box(3.05, F + 0.12, -1.02, 3.55, F + 0.42, -0.98, T.rgRed);
    // лебёдка ЛБУ-1200К: рама, опоры вала, коробка передач, вспомогательный тормоз, главный двигатель
    this.at(0, F, 6.2, function (g2) {
      g2.box(-3.3, 0, -1.2, 3.3, 0.3, 1.4, T.rgBlue);
      [-1.3, 1.3].forEach(function (sx) { g2.box(sx - 0.15, 0.3, -0.6, sx + 0.15, 1.4, 0.6, T.rgGreen); g2.cyl('x', sx - 0.2, 1.15, 0, 0.4, 0.22, T.rgDark, { n: 8 }); });
      g2.box(-2.25, 0.3, -0.95, -1.5, 1.9, 1.1, T.rgGreen);                               // цепная коробка передач
      g2.box(-2.27, 0.6, -0.6, -2.25, 1.6, 0.6, T.rgDark, { skip: 'etbsn' });
      g2.cyl('x', -3.15, 1.15, 0, 0.85, 0.6, T.rgGrey, { n: 12 });                        // электромагнитный тормоз
      g2.box(-3.1, 0.3, -0.5, -2.35, 0.6, 0.5, T.rgBlue);
      this.motor(1.55, 1.15, 0, 'x', 1.5, 0.56);
      g2.box(1.5, 0.3, -0.6, 3.2, 0.6, 0.6, T.rgBlue);
      // кожух барабана: верх и задняя стенка, перед открыт к ротору
      g2.box(-1.12, 2.0, -0.2, 1.12, 2.06, 1.0, T.rgYellow); g2.box(-1.12, 0.3, 0.94, 1.12, 2.0, 1.0, T.rgYellow);
      g2.box(-1.12, 1.5, -0.2, -1.06, 2.0, 0.94, T.rgYellow); g2.box(1.06, 1.5, -0.2, 1.12, 2.0, 0.94, T.rgYellow);
      this.solid(-3.3, 0, -1.0, 3.3, 1.9, 1.2);
    });
    // прожекторы под кровлей и на передних стойках, свет под полом
    this.flood(-6, F + 4.2, 3.2, 'nz'); this.flood(6, F + 4.2, 3.2, 'nz'); this.flood(0, F + 4.3, 8.6, 'nz');
    this.lamp(-4, 4.5, 0); this.lamp(4, 4.5, 0); this.lamp(0, 5, -5); this.lamp(0, 5, 6);
    return this;
  };

  // ---- Мачта ВМР-45×200 -------------------------------------------------------------------------
  K.mast = function () {
    var g = this.g, self = this, F = D.FLOOR, i, s;
    var cuts = [D.LEG0, 14.6, 21.6, 28.6, 35.6, 40.6, 45.6, D.LEG1];
    var cols = [T.rgGrey, T.rgGrey, T.rgGrey, T.rgGrey, T.rgRed, T.rgWhite, T.rgRed];
    [-1, 1].forEach(function (sd) {
      g.box(sd * D.FOOT - 0.75, F, -0.75, sd * D.FOOT + 0.75, F + 0.6, 0.75, T.rgDark);          // опорный шарнир
      g.cyl('z', sd * D.FOOT, F + 0.45, -0.85, 1.7, 0.16, T.rgSteel, { n: 8 });
      self.solid(sd * D.FOOT - 0.7, F, -0.7, sd * D.FOOT + 0.7, F + 2, 0.7);
      for (i = 0; i < 7; i++) {
        var y0 = cuts[i], y1 = cuts[i + 1];
        g.truss([sd * D.legX(y0), y0, 0], [sd * D.legX(y1), y1, 0], D.legW(y0), D.legW(y1), 0.16, 0.075, cols[i], { panel: 1.45, up: [0, 0, 1] });
        var w = D.legW(y1) / 2 + 0.1, cx = sd * D.legX(y1);
        g.box(cx - w, y1 - 0.05, -w, cx + w, y1 + 0.05, w, T.rgDark, { skip: 'tb' });             // фланцы секций
      }
    });
    // козлы и подкосы: держат мачту со стороны лебёдки
    [-1, 1].forEach(function (sd) {
      var px = sd * 4.6;
      g.truss([px, F, 4.0], [px, F + 9.2, 4.0], 0.7, 0.7, 0.12, 0.06, T.rgGrey, { panel: 1.1 });
      g.beam([px, F + 9.2, 4.0], [sd * D.legX(24), 24, 0.3], 0.26, 0.26, T.rgGrey);
      g.beam([px, F + 9.2, 4.0], [px, F + 0.3, 8.4], 0.2, 0.2, T.rgGrey);
      self.solid(px - 0.35, F, 3.65, px + 0.35, F + 3, 4.35, 'post');
    });
    g.beam([-4.6, F + 9.0, 4.0], [4.6, F + 9.0, 4.0], 0.24, 0.24, T.rgGrey);
    g.beam([-4.6, F + 9.0, 4.0], [0, F + 6.2, 4.0], 0.1, 0.1, T.rgGrey); g.beam([4.6, F + 9.0, 4.0], [0, F + 6.2, 4.0], 0.1, 0.1, T.rgGrey);
    // пояса между ногами на уровне балкона и выше
    [D.MONKEY - 0.4, 42].forEach(function (yy) {
      var lx = D.legX(yy);
      g.beam([-lx, yy, 0.62], [lx, yy, 0.62], 0.14, 0.14, T.rgGrey);
    });
    // подкронблочная рама, площадка, кронблок (шкивы — подвижные), козлы для смены шкивов
    var C = D.LEG1;
    g.box(-2.0, C, -1.0, 2.0, C + 0.4, -0.7, T.rgGrey); g.box(-2.0, C, 0.7, 2.0, C + 0.4, 1.0, T.rgGrey);
    g.box(-2.0, C, -0.7, -1.7, C + 0.4, 0.7, T.rgGrey); g.box(1.7, C, -0.7, 2.0, C + 0.4, 0.7, T.rgGrey);
    this.deck(-2, -2, 2, -1, C + 0.6, { grate: true }); this.deck(-2, 1, 2, 2, C + 0.6, { grate: true });
    this.deck(-2, -1, -1, 1, C + 0.6, { grate: true }); this.deck(1, -1, 2, 1, C + 0.6, { grate: true });
    this.rails(-2, -2, 2, 2, C + 0.6, 'nz pz nx px', [{ side: 'nx', a: -0.6, b: 0.6 }]);
    [-0.95, 0.95].forEach(function (sx) { g.box(sx - 0.14, C + 0.4, -0.35, sx + 0.14, D.CROWN + 0.3, 0.35, T.rgGreen); });
    g.cyl('x', -1.15, D.CROWN, 0, 2.3, 0.1, T.rgSteel, { n: 6 });
    [-1.6, 1.6].forEach(function (sx) {
      g.beam([sx, C + 0.6, -1.6], [sx * 0.4, C + 4.0, 0], 0.1, 0.1, T.rgRed); g.beam([sx, C + 0.6, 1.6], [sx * 0.4, C + 4.0, 0], 0.1, 0.1, T.rgRed);
    });
    g.beam([-0.8, C + 4.0, 0], [0.8, C + 4.0, 0], 0.14, 0.14, T.rgRed);
    g.disc('x', 0, C + 3.7, 0, 0.25, T.rgSheave);
    g.cyl('y', 0.8, C + 4.0, 0, 2.2, 0.03, T.rgSteel, { n: 4 });                                   // молниеприёмник
    var sv = g.mat; g.mat = MAT.BLINK;                                                              // заградительные огни
    [[-1.9, -1.9], [1.9, 1.9]].forEach(function (p) { g.box(p[0] - 0.12, C + 1.75, p[1] - 0.12, p[0] + 0.12, C + 2.0, p[1] + 0.12, T.rgRedLamp); });
    g.box(-0.1, C + 4.1, -0.1, 0.1, C + 4.35, 0.1, T.rgRedLamp);
    g.mat = sv;
    // стояк манифольда по правой ноге и «гусак» под буровой рукав
    var sy = F + 17, sx2 = D.legX(sy) + 0.85;
    this.pipe([[D.FOOT + 0.9, 1.9, -1.2], [D.FOOT + 0.9, F + 1.2, -1.2], [D.FOOT + 0.9, F + 1.2, -0.95], [sx2, sy, -0.95], [sx2 - 0.9, sy + 0.5, -0.95], [sx2 - 1.3, sy + 0.2, -0.95]], 0.09, T.rgOrange);
    for (i = 10; i < sy; i += 3.5) g.beam([D.legX(i) + 0.3, i, -0.6], [D.legX(i) + 0.85, i, -0.95], 0.06, 0.06, T.rgGrey);
    this.valve(D.FOOT + 0.9, F + 0.7, -1.2, 'y', 0.09);
    // лестница-стремянка по наружной грани левой ноги с переходными площадками
    this.mastLadder();
    this.monkeyBoard();
    // растяжки мачты к якорям
    [[-27, -24], [-27, 26], [30, -26], [30, 28]].forEach(function (p) {
      var sgn = p[0] < 0 ? -1 : 1;
      g.beam([sgn * 1.9, C + 0.2, p[1] < 0 ? -0.9 : 0.9], [p[0], 0.4, p[1]], 0.045, 0.045, T.rgRope);
      g.box(p[0] - 0.6, 0, p[1] - 0.6, p[0] + 0.6, 0.5, p[1] + 0.6, T.rgSlab);
      self.solid(p[0] - 0.5, 0, p[1] - 0.5, p[0] + 0.5, 0.5, p[1] + 0.5, 'slabB');
    });
    return this;
  };
  // наклонная стремянка вдоль ноги: дуги ограждения, площадки отдыха, клетки-лазы в два ряда
  K.mastLadder = function () {
    var g = this.g, F = D.FLOOR, y, self = this;
    function lx(yy) { return -(D.legX(yy) + D.legW(yy) / 2 + 0.22); }
    var y0 = F, y1 = D.LEG1 + 1.7;
    [-0.24, 0.24].forEach(function (oz) { g.beam([lx(y0), y0, oz], [lx(y1), y1, oz], 0.05, 0.05, T.rgYellow); });
    for (y = y0 + 0.3; y < y1 - 0.9; y += 1 / 3) g.beam([lx(y), y, -0.24], [lx(y), y, 0.24], 0.035, 0.035, T.rgSteel);
    for (y = y0 + 2.4; y < y1 - 1; y += 1.3) {
      var x = lx(y);
      g.beam([x, y, -0.3], [x - 0.6, y, -0.36], 0.03, 0.05, T.rgYellow); g.beam([x - 0.6, y, -0.36], [x - 0.6, y, 0.36], 0.03, 0.05, T.rgYellow);
      g.beam([x - 0.6, y, 0.36], [x, y, 0.3], 0.03, 0.05, T.rgYellow);
      g.beam([x, y, 0], [x + 0.2, y, 0], 0.04, 0.04, T.rgGrey);
    }
    [-0.36, 0, 0.36].forEach(function (oz) { g.beam([lx(y0 + 2.4) - 0.6, y0 + 2.4, oz], [lx(y1 - 1) - 0.6, y1 - 1, oz], 0.03, 0.03, T.rgYellow); });
    for (y = Math.floor(y0); y < Math.ceil(y1 - 1.6); y++) {
      var cx = Math.floor(lx(y + 0.5) - 0.35);
      this.blockAt(cx + 0.5, y + 0.5, 0, B.RIG_CLIMB, 0); this.blockAt(cx + 0.5, y + 0.5, -0.5, B.RIG_CLIMB, 0);
      this.blockAt(cx + 1.5, y + 0.5, 0, B.RIG_CLIMB, 0); this.blockAt(cx + 1.5, y + 0.5, -0.5, B.RIG_CLIMB, 0);
    }
    // площадки отдыха у стыков секций
    [15, 24].forEach(function (py) {
      var px = Math.floor(lx(py)) - 1;
      self.deck(px, 1, px + 2, 2, py, { grate: true });
      self.rails(px, 1, px + 2, 2, py, 'pz nx px');
      g.beam([px + 1, py - 0.15, 1.5], [-D.legX(py), py - 1.6, 0.4], 0.07, 0.07, T.rgGrey);
    });
    // переход с лестницы на балкон и на кронблочную площадку
    var mx = Math.floor(lx(D.MONKEY)) - 1;
    this.deck(mx, -2, mx + 2, 1, D.MONKEY, { grate: true });
    this.rails(mx, -2, mx + 2, 1, D.MONKEY, 'nx pz');
    this.deck(-3, -1, -2, 1, D.LEG1 + 0.6, { grate: true });
    this.rails(-3, -1, -2, 1, D.LEG1 + 0.6, 'nz pz');
  };
  // Балкон верхового: центральная площадка, пальцы для свечей, укрытие
  K.monkeyBoard = function () {
    var g = this.g, M = D.MONKEY, lx = D.legX(M), z;
    var mx = Math.floor(-(lx + D.legW(M) / 2 + 0.22)) - 1;
    this.deck(mx + 2, -2, -1, -1, M, { grate: true });                       // проход вдоль ног к центральной площадке
    this.deck(-1, -6, 1, -1, M, { grate: true });
    this.rail(mx + 2, -1, -1, -1, M, 'pz'); this.rail(-1, -6, 1, -6, M, 'nz');
    this.rail(1, -1.9, 1, -1, M, 'px', { noHull: true });
    // рама и пальцы: свечи стоят между пальцами, верхи опираются на них
    [-1, 1].forEach(function (s) {
      g.beam([s * 5.7, M + 0.25, -6], [s * 5.7, M + 0.25, -2], 0.14, 0.14, T.rgGrey);
      g.beam([s * 1.0, M + 0.25, -6], [s * 5.7, M + 0.25, -6], 0.14, 0.14, T.rgGrey);
      g.beam([s * 1.0, M + 0.25, -2], [s * 5.7, M + 0.25, -2], 0.14, 0.14, T.rgGrey);
      for (z = -5.55; z < -2.2; z += 0.45) g.beam([s * 1.05, M + 0.25, z], [s * 5.65, M + 0.25, z], 0.07, 0.07, T.rgYellow);
      g.beam([s * 5.7, M + 0.25, -2], [s * lx, M + 4.5, -0.3], 0.1, 0.1, T.rgGrey);
      g.beam([s * 5.7, M + 0.25, -6], [s * lx, M - 5, -0.5], 0.1, 0.1, T.rgGrey);
      g.beam([s * 1.0, M - 0.1, -6], [s * D.legX(M - 6), M - 6, -0.5], 0.1, 0.1, T.rgGrey);
    });
    // ветрозащита балкона
    g.box(-1.6, M, -6.3, 1.6, M + 2.3, -6.24, T.rgSideBlue); g.box(-1.6, M + 2.3, -6.3, 1.6, M + 2.36, -4.6, T.rgSideGrey);
    this.flood(0, M + 2.0, -6.1, 'pz');
    this.flood(-1.5, M + 9, 0.7, 'nz');
  };

  // ---- Приёмный мост, наклонный жёлоб, стеллажи, лестницы ----------------------------------------
  K.catwalk = function () {
    var g = this.g, F = D.FLOOR, self = this, z, sv;
    // наклонный жёлоб от ворот пола к мосткам
    g.beam([-0.9, F, -7], [-0.9, 1.0, -13], 0.14, 0.3, T.rgBlue); g.beam([0.9, F, -7], [0.9, 1.0, -13], 0.14, 0.3, T.rgBlue);
    for (var k = 0; k < 8; k++) {
      var a = k / 8, b = (k + 1) / 8;
      g.quad2([-0.85, F - a * 6 - 0.05, -7 - a * 6], [0.85, F - a * 6 - 0.05, -7 - a * 6], [0.85, F - b * 6 - 0.05, -7 - b * 6], [-0.85, F - b * 6 - 0.05, -7 - b * 6], T.rgPlate);
    }
    [-10, -8.2].forEach(function (zz) { var yy = F - (-7 - zz); g.beam([-0.9, 0, zz], [-0.9, yy - 0.2, zz], 0.12, 0.12, T.rgBlue); g.beam([0.9, 0, zz], [0.9, yy - 0.2, zz], 0.12, 0.12, T.rgBlue); });
    for (var c = 0; c < 6; c++) this.solid(-1, 0, -13 + c, 1, 1 + c, -12 + c, 'full');
    // горизонтальные мостки
    this.deck(-1, -28, 1, -13, 1, {});
    for (z = -27.5; z < -13; z += 3.5) { g.box(-0.9, 0, z, -0.75, 0.8, z + 0.15, T.rgBlue); g.box(0.75, 0, z, 0.9, 0.8, z + 0.15, T.rgBlue); }
    this.stairs(-1, 0, -29, 'pz', 1, 2, { noRail: true });
    // стеллажи: по три балки с каждой стороны, упоры на концах
    [-1, 1].forEach(function (s) {
      [-15, -20.5, -26].forEach(function (zz) {
        var x0 = s > 0 ? 1.15 : -9.6, x1 = s > 0 ? 9.6 : -1.15;
        g.box(x0, 0.72, zz - 0.12, x1, 0.98, zz + 0.12, T.rgBlue);
        for (var px = x0 + 0.4; px < x1; px += 2.6) g.box(px - 0.08, 0, zz - 0.08, px + 0.08, 0.72, zz + 0.08, T.rgBlue);
        g.box(s * 9.6 - 0.08, 0.98, zz - 0.1, s * 9.6 + 0.08, 1.45, zz + 0.1, T.rgYellow);
        self.solid(x0, 0, zz - 0.4, x1, 1, zz + 0.4, 'full');
      });
    });
    // лестница с площадки на пол буровой и площадка у ворот
    this.stairs(-14, 0, -9, 'px', 7, 1);
    this.deck(-7, -9, -5, -7, F, {});
    this.rail(-7, -9, -5, -9, F, 'nz'); this.rail(-5, -9, -5, -7, F, 'px');
    g.beam([-6.9, 0, -8.9], [-6.9, F - 0.2, -8.9], 0.14, 0.14, T.rgBlue); g.beam([-5.1, 0, -8.9], [-5.1, F - 0.2, -8.9], 0.14, 0.14, T.rgBlue);
    // знаки
    sv = g.mat; g.mat = MAT.SOLID;
    g.box(-5.6, F + 0.3, -9.04, -5.0, F + 0.9, -9.0, T.rgHelm, { fit: true, skip: 'ewtbs' });
    g.mat = sv;
    return this;
  };
})();
