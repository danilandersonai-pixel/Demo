/* Кубокрафт — буровая установка БУ-3000 ЭУК-1М (электрическая, универсальная, кустовая).
   Один объект мира «bu3000» — это вся кустовая площадка: песчаная отсыпка, рельсовый путь,
   вышечно-лебёдочный блок и эшелон (очистка, резервуары, насосы, компрессоры, энергоблок),
   шламовый амбар, факел, склад ГСМ, вагон-городок. Здесь — компоновка и регистрация;
   симуляция и подвижные части — в rigsim.js, пульт бурильщика — в rigui.js.
   Оси: начало — устье первой скважины куста; +X — направление эшелона и передвижки
   (пробуренные скважины остаются позади, шаг 5 м); −Z — приёмный мост и стеллажи. */
(function () {
  'use strict';
  var KC = window.KC, T = KC.TILE, B = KC.B, D = KC.RigDims, Props = KC.Props, Kit = KC.RigKit;

  var L = {
    WELLS: 4, STEP: 5,
    CS: [9, 21], TANKS: [22, 40], PUMPS: [41, 55], COMP: [56, 64], POWER: [65, 77],
    TANK_X: [[22.3, 27.9], [28.1, 33.9], [34.1, 39.7]], TANK_Z: [-3.9, 4.7], TANK_Y: [1, 3.9],
    PUMP: [[44.6, -1], [51.2, -1]], SHAKER: [[11.3, 2.6], [13.5, 2.6]],
    AGIT: [[17.6, 0.6], [25.1, -1.8], [25.1, 2.6], [31, -1.8], [31, 2.6], [36.9, -1.8], [36.9, 2.6]],
    COMPR: [[58.3, -2.9], [58.3, 0.3]],
    PIT: [10, 13, 62, 27], FLARE: [-24, 28], DES: [84, 0]
  };
  L.SUC = [23.5, 29.5, 35.5];        // штурвальные колонки всасывающих задвижек (x), z = −4.5
  L.EQZ = [27.5, 33.5];              // перепускные задвижки между ёмкостями
  L.SLURRY = [[14.3, -3.7], [19.5, 0.7]];
  // Зоны управления: агрегат под прицелом (b — коробка в координатах буровой; fixed — стоит на площадке)
  L.ZONES = (function () {
    var z = [
      { t: 'rotary', b: [-1.1, 6, -1.1, 1.1, 7.7, 1.2] }, { t: 'draw', b: [-3.3, 7, 5, 3.3, 9.2, 7.7] }, { t: 'post', b: [-4.2, 7, 3.2, -2.4, 9.2, 4.2] },
      { t: 'akb', b: [2.0, 7, 1.3, 2.8, 8.9, 2.1] }, { t: 'acc', b: [-6.1, 7, 0.7, -5.1, 8.5, 1.3] }, { t: 'bop', b: [-0.8, 0, -0.8, 0.8, 4.6, 0.8] },
      { t: 'acc', b: [-14.5, 0, 13.2, -11.5, 1.7, 14.8] }, { t: 'choke', b: [-5.6, 0, 9.8, -2.4, 1.4, 11] }, { t: 'choke', b: [2.6, 0, 9.8, 5.8, 1.4, 11] },
      { t: 'trip', b: [-10.5, 0, 8.5, -8.1, 2.7, 10.9] },
      { t: 'eq', i: 'dg', b: [15.5, 4, -3.4, 17.2, 6.8, -2.0] }, { t: 'eq', i: 'ds', b: [15.1, 4, 2.4, 17.3, 6.8, 3.6] },
      { t: 'eq', i: 'dl', b: [18.1, 4, 2.4, 20.3, 6.2, 3.6] }, { t: 'eq', i: 'cf', b: [17.6, 4, -3.4, 20.5, 6, -2.2] },
      { t: 'kru', b: [65.5, 1, 3.8, 72.1, 3.3, 4.9] }, { t: 'kru', b: [65.5, 1, -0.5, 69.7, 3.3, 0.6] }, { t: 'hopper', b: [33.5, 0, -11.2, 36, 1.4, -9.8] },
      { t: 'des', b: [96.9, 0, -11.4, 103.1, 2.9, -8.6], fixed: true }
    ];
    L.PUMP.forEach(function (p, i) { z.push({ t: 'pump', i: i, b: [p[0] - 1.2, 1, p[1] - 2.6, p[0] + 1.7, 4.2, p[1] + 4.4] }); });
    L.SHAKER.forEach(function (p, i) { z.push({ t: 'sh', i: i, b: [p[0] - 1, 4, p[1] - 1.7, p[0] + 1, 5.7, p[1] + 2.3] }); });
    L.AGIT.forEach(function (p) { z.push({ t: 'eq', i: 'ag', b: [p[0] - 0.45, 4, p[1] - 0.45, p[0] + 0.45, 5.1, p[1] + 0.45] }); });
    L.TANK_X.forEach(function (t, i) { z.push({ t: 'tank', i: i, b: [t[0], 1, L.TANK_Z[0], t[1], 3.4, L.TANK_Z[1]] }); });
    L.SUC.forEach(function (x, i) { z.push({ t: 'suc', i: i, b: [x - 0.3, 4, -4.8, x + 0.3, 5.2, -4.2] }); });
    L.EQZ.forEach(function (x, i) { z.push({ t: 'eqz', i: i, b: [x - 0.3, 4, -4.8, x + 0.3, 5.2, -4.2] }); });
    L.COMPR.forEach(function (p) { z.push({ t: 'comp', b: [p[0] - 1.3, 1, p[1] - 0.7, p[0] + 1.3, 2.8, p[1] + 0.7] }); });
    return z;
  })();
  KC.RigLayout = L;

  // Эшелон: блоки на рельсовом ходу, x — относительно устья текущей скважины
  function echelon(k) {
    var g = k.g, i;
    // --- блок очистки: ёмкость-отстойник, сверху вибросита и гидроциклоны ---
    k.sled(9, -5, 21, 5, 1);
    k.mudTank(9.3, -3.9, 20.7, 4.7, 1, 3.9);
    k.deck(10, -5, 21, 5, 4, { grate: true });
    k.deck(9, -5, 10, 5, 4, { grate: true }); k.deck(10, 5, 12, 6, 4, { grate: true });
    k.rails(9, -5, 21, 5, 4, 'nz pz nx', [{ side: 'nz', a: 18, b: 19 }, { side: 'pz', a: 10, b: 12 }]);
    k.rail(12, 5, 12, 6, 4, 'px'); k.rail(10, 6, 12, 6, 4, 'pz');
    k.stairs(7, 4, 5, 'nx', 3, 1);                                      // с пола буровой на блок очистки
    k.stairs(14, 0, -6, 'px', 4, 1); k.deck(18, -6, 19, -5, 4, { grate: true });
    k.rail(18, -6, 19, -6, 4, 'nz'); k.rail(19, -6, 19, -5, 4, 'px');
    L.SHAKER.forEach(function (p) {
      k.shaker(p[0], 4, p[1]);
      g.beam([p[0], 4.25, p[1] + 2.2], [p[0], 0.6, 13.2], 0.9, 0.08, T.rgDark);          // шламовый жёлоб в амбар
      g.beam([p[0] - 0.45, 4.3, p[1] + 2.2], [p[0] - 0.45, 0.65, 13.2], 0.06, 0.25, T.rgBlue);
      g.beam([p[0] + 0.45, 4.3, p[1] + 2.2], [p[0] + 0.45, 0.65, 13.2], 0.06, 0.25, T.rgBlue);
    });
    g.beam([12.4, 0, 9], [12.4, 2.4, 9], 0.12, 0.12, T.rgBlue);
    k.degasser(16.2, 4, -2.7); k.desander(16.2, 4, 3.0); k.desilter(19.2, 4, 3.0); k.centrifuge(19.0, 4, -2.8);
    // выкидная линия от устья к ситам
    k.pipe([[0.45, 6.05, 0], [9.6, 5.85, 0], [9.6, 5.85, 0.6], [14.4, 5.75, 0.6]], 0.2, T.rgGreen);
    L.SHAKER.forEach(function (p) { k.pipe([[p[0], 5.75, 0.6], [p[0], 5.75, 1.3], [p[0], 5.62, 1.3]], 0.14, T.rgGreen); });
    k.shelter(9, -5, 21, 5, 4, 7.9, '');
    k.flood(15, 7.6, -4.6, 'pz'); k.flood(15, 7.6, 4.6, 'nz'); k.lamp(15, 2.5, -4.5);
    // --- резервуарный блок: три ёмкости бурового раствора ---
    k.sled(22, -5, 40, 5, 1);
    L.TANK_X.forEach(function (tx) { k.mudTank(tx[0], L.TANK_Z[0], tx[1], L.TANK_Z[1], L.TANK_Y[0], L.TANK_Y[1]); });
    k.deck(22, -5, 40, 5, 4, { grate: true });
    k.deck(21, -1, 22, 1, 4, { grate: true });
    k.rails(22, -5, 40, 5, 4, 'nz pz nx px', [{ side: 'nx', a: -1, b: 1 }, { side: 'px', a: -1, b: 1 }, { side: 'nz', a: 37, b: 38 }]);
    k.rail(21, -1, 22, -1, 4, 'nz'); k.rail(21, 1, 22, 1, 4, 'pz');
    L.AGIT.forEach(function (p) { k.agitator(p[0], 4, p[1]); });
    L.SUC.forEach(function (x) { k.valveStand(x, 4, -4.5, T.rgGreen); });
    L.EQZ.forEach(function (x) { k.valveStand(x, 4, -4.5, T.rgBlueLt); g.box(x - 0.2, 5.15, -4.52, x + 0.2, 5.4, -4.48, T.rgWhite); });
    // шламовые насосы: подача на дегазатор и гидроциклоны
    L.SLURRY.forEach(function (p) { k.slurryPump(p[0], 4, p[1]); });
    k.pipe([[13.75, 4.9, -3.7], [13.75, 5.6, -3.7], [16.2, 5.6, -3.7], [16.2, 5.6, -3.3]], 0.08, T.rgGreen);
    k.pipe([[18.95, 4.9, 0.7], [18.95, 5.9, 0.7], [18.95, 5.9, 2.58]], 0.08, T.rgGreen);
    for (i = 0; i < 3; i++) {                                           // гидромониторы и уровнемеры
      var tx = L.TANK_X[i][0] + 0.8;
      g.cyl('y', tx, 4, 4.2, 1.0, 0.06, T.rgGreen, { n: 6 }); g.beam([tx, 4.9, 4.2], [tx + 0.5, 4.75, 3.9], 0.07, 0.07, T.rgGreen);
      g.box(tx + 3.6, 4, -4.9, tx + 3.75, 5.3, -4.86, T.rgWhite); g.box(tx + 3.6, 4.4, -4.92, tx + 3.75, 4.5, -4.9, T.rgRed);
    }
    k.stairs(33, 0, -6, 'px', 4, 1); k.deck(37, -6, 38, -5, 4, { grate: true });
    k.rail(37, -6, 38, -6, 4, 'nz'); k.rail(38, -6, 38, -5, 4, 'px');
    k.shelter(22, -5, 40, 5, 4, 7.9, 'pz');
    k.flood(31, 7.6, -4.6, 'pz'); k.lamp(31, 2.5, -4.5); k.lamp(26, 6, 0); k.lamp(36, 6, 0);
    // трубная галерея под настилом: всасывающая и нагнетательная линии
    k.pipe([[9.6, 1.45, -4.45], [53.5, 1.45, -4.45]], 0.18, T.rgGreen, true);
    L.TANK_X.forEach(function (t2) { var mx = (t2[0] + t2[1]) / 2; k.pipe([[mx, 1.45, -4.45], [mx, 1.45, -3.9]], 0.14, T.rgGreen); k.valve(mx, 1.45, -4.15, 'z', 0.12); });
    k.pipe([[52.6, 2.75, -4.35], [9.2, 2.3, -4.35], [5.5, 1.9, -4.35], [5.5, 1.9, -1.2]], 0.1, T.rgOrange, true);
    for (i = 12; i < 52; i += 4) g.box(i, 1, -4.6, i + 0.1, 2.6, -4.2, T.rgBlue, { skip: 'tb' });
    // --- насосный блок: два УНБ-600 ---
    k.sled(41, -5, 55, 5, 1);
    k.deck(41, -5, 55, 5, 1, {});
    L.PUMP.forEach(function (p) {
      k.mudPump(p[0], 1, p[1]);
      k.pipe([[p[0] - 1.35, 2.75, p[1] - 1.7], [p[0] - 1.9, 2.75, p[1] - 1.7], [p[0] - 1.9, 2.75, -4.35]], 0.1, T.rgOrange);
      k.valve(p[0] - 1.9, 2.75, -3.6, 'z', 0.1);
      k.pipe([[p[0] + 1.3, 1.5, p[1] - 2.5], [p[0] + 1.7, 1.5, p[1] - 2.5], [p[0] + 1.7, 1.45, -4.45]], 0.16, T.rgGreen);
    });
    k.gauge(47.5, 3.1, -4.35, 'z', 0.16); g.cyl('y', 47.5, 2.8, -4.35, 0.25, 0.03, T.rgSteel, { n: 4 });
    k.stairs(47, 0, -6, 'pz', 1, 2, { noRail: true });
    k.shelter(41, -5, 55, 5, 1, 6.2, 'pz');
    k.flood(48, 5.9, -4.6, 'pz'); k.lamp(44.5, 4.5, 3); k.lamp(51, 4.5, 3);
    // --- компрессорный блок ---
    k.sled(56, -5, 64, 5, 1);
    k.deck(56, -5, 64, 5, 1, {});
    L.COMPR.forEach(function (p) { k.compressor(p[0], 1, p[1]); });
    k.receiver(62.2, 1, -3.2); k.receiver(62.2, 1, -1.2);
    g.box(60.6, 1, 1.6, 62.6, 2.5, 3.4, [T.rgBlueLt, T.rgBlueLt, T.rgBlueLt, null, T.rgBlueLt, T.rgLouver]); k.solid(60.6, 1, 1.6, 62.6, 2.5, 3.4);
    k.pipe([[59.3, 2.3, -2.9], [59.3, 2.9, -2.9], [62.2, 2.9, -2.9], [62.2, 2.9, -1.2]], 0.05, T.rgBlueLt);
    k.pipe([[62.2, 3.2, -3.2], [62.2, 3.6, -3.2], [56.3, 3.6, -4.7], [9.5, 3.6, -4.7], [6.6, 6.2, -4.7]], 0.04, T.rgBlueLt);
    k.stairs(59, 0, -6, 'pz', 1, 2, { noRail: true });
    k.shelter(56, -5, 64, 5, 1, 6.2, 'pz px');
    k.lamp(60, 4.5, 0);
    // --- энергоблок: КРУ 6 кВ, шкафы управления приводами, трансформаторы ---
    k.sled(65, -5, 77, 5, 1);
    k.deck(65, -5, 77, 5, 1, {});
    k.cabinets(65.6, 1, 3.9, 8);
    k.cabinets(65.6, 1, -0.4, 5, 'panel');
    k.transformer(73.4, 1, -1.5); k.transformer(73.4, 1, 1.9);
    g.box(71.8, 1, -3.2, 71.86, 2.8, 3.4, T.rgGrate, { skip: 'tb' }); k.solid(71.5, 1, -3.2, 72, 2.8, 3.4, 'wall', 'px');
    k.stairs(68, 0, -6, 'pz', 1, 2, { noRail: true });
    k.shelter(65, -5, 77, 5, 1, 6.2, 'pz px');
    k.lamp(69, 4.5, 1.5); k.flood(71, 5.9, -4.6, 'pz');
    // кабельная эстакада от энергоблока вдоль эшелона к буровой
    g.box(8.5, 8.3, 4.2, 65, 8.36, 4.6, T.rgGrate, { skip: 'ewsn' });
    for (i = 10; i < 65; i += 5) g.beam([i, 7.9, 4.4], [i, 8.3, 4.4], 0.06, 0.06, T.rgBlue);
    g.beam([8.5, 8.33, 4.4], [7.0, 9.6, 4.4], 0.3, 0.05, T.rgBlack);
  }

  // Приготовление раствора: силосы, гидроворонка, навес с мешками (стоит на площадке у резервуаров)
  function mixing(k) {
    var g = k.g;
    k.tankV(27, 0, -10.5, 4.2, 1.25, T.rgGrey, { legs: 2.0, cone: 1.3 });
    k.tankV(30.4, 0, -10.5, 4.2, 1.25, T.rgGrey, { legs: 2.0, cone: 1.3 });
    k.ladder(28.2, 0, -10.2, 7, 'nx');
    g.box(26, 7.9, -11.6, 31.4, 7.95, -9.4, T.rgGrate, { skip: 'ewsn' });
    k.pipe([[27, 2.0, -10.5], [27, 1.3, -10.5], [33.6, 1.3, -10.5]], 0.09, T.rgGrey);
    k.pipe([[30.4, 2.0, -10.5], [30.4, 1.3, -10.5]], 0.09, T.rgGrey);
    k.hopper(34.2, 0, -10.5);
    k.mudMixer(31, 0, -14.6);
    k.pipe([[30.1, 0.3, -13.3], [30.1, 0.3, -12.4], [32.8, 0.4, -12.4], [32.8, 0.4, -10.5]], 0.09, T.rgGreen);
    k.pipe([[32.8, 0.4, -10.5], [32.8, 0.4, -7.2], [32.8, 2.6, -7.2], [32.8, 4.4, -4.4]], 0.1, T.rgGreen);
    // навес для реагентов
    [[36.5, -13], [41.5, -13], [36.5, -8.5], [41.5, -8.5]].forEach(function (p) { g.box(p[0] - 0.07, 0, p[1] - 0.07, p[0] + 0.07, 3, p[1] + 0.07, T.rgBlue); });
    g.box(36.2, 3, -13.3, 41.8, 3.08, -8.2, T.rgSideGrey);
    k.sacks(37.4, 0, -12.2, 5); k.sacks(38.8, 0, -12.2, 5); k.sacks(40.2, 0, -12.2, 4); k.sacks(37.4, 0, -10.6, 4); k.sacks(38.8, 0, -10.6, 2);
    k.lamp(39, 2.5, -10.5);
  }

  // Неподвижное хозяйство кустовой площадки
  function padFixed(k, st) {
    var g = k.g, S = k.S, i, RX = st.slot * L.STEP;
    S.pad(-34, -34, 112, 36, -1, B.SAND, 5);
    S.block(-32, -1, -7, 108, -1, 6, B.ROAD_SLAB);
    S.block(-12, -1, -30, 11, -1, -8, B.ROAD_SLAB);
    // рельсовый путь
    [-4.25, 4.25].forEach(function (rz) {
      g.box(-31, 0.05, rz - 0.07, 107, 0.15, rz + 0.07, T.rgSteel); g.box(-31, 0, rz - 0.16, 107, 0.05, rz + 0.16, T.rgDark, { skip: 'b' });
    });
    for (i = -30; i < 107; i += 2) { g.box(i, 0, -4.6, i + 0.3, 0.04, -3.9, T.rgTimber, { skip: 'b' }); g.box(i, 0, 3.9, i + 0.3, 0.04, 4.6, T.rgTimber, { skip: 'b' }); }
    g.box(-31.3, 0, -4.6, -31, 0.6, -3.9, T.rgHazard); g.box(-31.3, 0, 3.9, -31, 0.6, 4.6, T.rgHazard);
    g.box(107, 0, -4.6, 107.3, 0.6, -3.9, T.rgHazard); g.box(107, 0, 3.9, 107.3, 0.6, 4.6, T.rgHazard);
    // скважины куста: законченные — с фонтанной арматурой, будущие — колышек на плите
    for (i = 0; i < L.WELLS; i++) {
      if (i < st.slot || (i === st.slot && st.wellDone)) k.xmasTree(i * L.STEP, 0, 0);
      else if (i > st.slot) { g.box(i * L.STEP - 0.4, 0, -0.4, i * L.STEP + 0.4, 0.05, 0.4, T.rgSlab, { skip: 'b' }); g.box(i * L.STEP - 0.04, 0, -0.04, i * L.STEP + 0.04, 0.9, 0.04, T.rgRed); }
    }
    // шахта под устьем текущей скважины
    if (!st.wellDone) S.block(RX - 1, -2, -1, RX, -1, 0, 0, 0);
    // шламовый амбар
    S.block(L.PIT[0], -2, L.PIT[1], L.PIT[2] - 1, -1, L.PIT[3] - 1, 0, 0);
    for (i = L.PIT[0]; i < L.PIT[2]; i += 4) { g.box(i, 0, L.PIT[1] - 0.6, i + 0.08, 1.0, L.PIT[1] - 0.52, T.rgYellow); }
    g.beam([L.PIT[0], 1.0, L.PIT[1] - 0.56], [L.PIT[2], 1.0, L.PIT[1] - 0.56], 0.05, 0.05, T.rgYellow);
    g.beam([L.PIT[0], 0.55, L.PIT[1] - 0.56], [L.PIT[2], 0.55, L.PIT[1] - 0.56], 0.04, 0.04, T.rgYellow);
    // факельная линия и стояк с обваловкой
    k.flare(L.FLARE[0], 0, L.FLARE[1]);
    k.pipe([[RX - 2.2, 0.3, 10], [-18, 0.3, 10], [-24, 0.3, 22], [-24, 0.3, 28]], 0.09, T.rgRed);
    { S.block(L.FLARE[0] - 4, 0, L.FLARE[1] + 4, L.FLARE[0] + 4, 0, L.FLARE[1] + 4, B.SAND, 0); S.block(L.FLARE[0] - 4, 0, L.FLARE[1] - 4, L.FLARE[0] - 4, 0, L.FLARE[1] + 4, B.SAND, 0); S.block(L.FLARE[0] + 4, 0, L.FLARE[1] + 1, L.FLARE[0] + 4, 0, L.FLARE[1] + 4, B.SAND, 0); }
    // блок дросселирования, блок глушения и станция гидроуправления ПВО
    k.manifold(RX - 4, 0, 10.4); k.manifold(RX + 4.2, 0, -10.4 + 20.8);
    k.pipe([[RX - 1.6, 1.13, 0], [RX - 2.6, 1.13, 0], [RX - 2.6, 0.85, 3.0], [RX - 2.6, 0.85, 10.4]], 0.09, T.rgRed);
    k.accumulator(RX - 13, 0, 14);
    k.pipe([[RX - 11.6, 0.2, 14], [RX - 1.5, 0.2, 14], [RX - 1.5, 0.2, 2.0], [RX - 0.8, 1.8, 0.6]], 0.035, T.rgSteel);
    k.fireBoard(RX - 15.5, 0, -11, 'x');
    // доливная ёмкость с уровнемером
    k.at(RX, 0, 0, function () {
      k.mudTank(-10.4, 8.6, -8.2, 10.8, 0.5, 2.6);
      [[-10.3, 8.7], [-8.3, 8.7], [-10.3, 10.7], [-8.3, 10.7]].forEach(function (q) { g.box(q[0] - 0.07, 0, q[1] - 0.07, q[0] + 0.07, 0.5, q[1] + 0.07, T.rgBlue); });
      g.box(-8.18, 0.6, 9.5, -8.14, 2.5, 9.7, T.rgWhite); g.box(-8.16, 1.5, 9.52, -8.12, 1.6, 9.68, T.rgRed);
      k.pipe([[-8.3, 0.8, 9.7], [-2.2, 0.8, 9.7], [-1.2, 0.9, 1.2], [-0.4, 0.6, 0.3]], 0.06, T.rgGreen);
      // канат аварийного спуска верхового и якорь
      g.beam([0.9, D.MONKEY + 1.2, -6.1], [6.5, 0.4, -31.5], 0.03, 0.03, T.rgRope);
      g.box(6.1, 0, -31.9, 6.9, 0.45, -31.1, T.rgSlab);
    });
    // ветроуказатель
    g.cyl('y', 52, 0, -17, 7, 0.06, T.rgGrey, { n: 6 });
    g.tube([52, 6.8, -17], [53.6, 6.6, -17.6], 0.24, T.rgOrange, { r1: 0.1, n: 8, caps: 0 });
    // водяная ёмкость и склад ГСМ в обваловке
    k.tankV(72, 0, 14, 4.2, 1.9, T.rgBlueLt, {});
    k.pipe([[72, 0.5, 12.1], [72, 0.5, 8], [60, 0.5, 8]], 0.08, T.rgBlueLt);
    k.tankH(86, 0, 22, 8, 1.15, T.rgGrey, 'x'); k.tankH(86, 0, 26.5, 8, 1.15, T.rgGrey, 'x');
    g.box(88, 1.1, 20.83, 92, 1.9, 20.86, T.rgRed, { skip: 'ewtbs' });
    S.block(83, 0, 19, 97, 0, 19, B.SAND, 0); S.block(83, 0, 30, 97, 0, 30, B.SAND, 0); S.block(83, 0, 19, 83, 0, 30, B.SAND, 0); S.block(97, 0, 19, 97, 0, 30, B.SAND, 0);
    k.fireBoard(81.5, 0, 24, 'x');
    // аварийная ДЭС с расходным баком
    k.des(L.DES[0] + 16, 0, L.DES[1] - 10);
    k.tankH(L.DES[0] + 20.5, 0, L.DES[1] - 10, 2.6, 0.6, T.rgYellow, 'x');
    // линия 6 кВ: опоры и провода к энергоблоку
    k.powerPole(108, 0, 10, 9.5, 'z'); k.powerPole(108, 0, 32, 9.5, 'z');
    [-0.85, 0, 0.85].forEach(function (o) {
      g.rope([108, 9.2, 10 + o], [108, 9.2, 32 + o], 0.02, T.rgBlack, 1.2, 6);
      g.rope([108, 9.2, 10 + o], [RX + 76.5, 6.6, 3 + o], 0.02, T.rgBlack, 1.0, 6);
    });
    // вагон-городок
    k.wagon(60, 0, -29, 9, 'sign'); k.wagon(60, 0, -23, 9); k.wagon(74, 0, -29, 9); k.wagon(74, 0, -23, 9); k.wagon(88, 0, -26, 8);
    k.wagon(-31, 0, -15, 7, 'sign');                                 // станция ГТИ у буровой
    g.cyl('y', -25, 3.1, -15, 2.4, 0.03, T.rgSteel, { n: 4 }); g.rope([-25, 5.4, -15], [RX - 6.9, 9.5, 2.2], 0.02, T.rgBlack, 1.4, 6);
    k.boiler(44, 0, -17);
    k.pipe([[42.5, 0.6, -16], [42.5, 0.6, -6.5], [42.5, 3.2, -5.2]], 0.06, T.rgSteel);
    k.fireBoard(71.5, 0, -20, 'z');
    S.block(58, -1, -21, 98, -1, -19, B.ROAD_SLAB, 0);
    // прожекторные мачты по углам площадки
    [[-29, -29, 'px'], [106, -31, 'nx'], [106, 33, 'nx'], [-29, 31, 'px']].forEach(function (p) {
      g.truss([p[0], 0, p[1]], [p[0], 13, p[1]], 0.6, 0.35, 0.08, 0.04, T.rgGrey, { panel: 1.0 });
      k.flood(p[0], 13.3, p[1], p[2]); k.flood(p[0], 13.3, p[1] + (p[1] < 0 ? 0.7 : -0.7), p[1] < 0 ? 'pz' : 'nz');
      k.solid(p[0] - 0.3, 0, p[1] - 0.3, p[0] + 0.3, 3, p[1] + 0.3, 'post');
    });
  }

  function layout(k, p) {
    var st = p.st, RX = st.slot * L.STEP;
    padFixed(k, st);
    k.at(RX, 0, 0, function () {
      k.substructure(); k.rigFloor(); k.mast(); k.catwalk();
      // пульт ПВО у бурильщика и машинные ключи УМК на подвесах с противовесами
      var F = D.FLOOR, g = k.g;
      k.bopPanel(-5.6, F, 1.0);
      [[-1.75, 0.95, -1], [0.55, 1.75, 1]].forEach(function (q) {
        g.box(q[0] - 0.55, F + 1.05, q[1] - 0.12, q[0] + 0.55, F + 1.3, q[1] + 0.12, T.rgRed);
        g.box(q[0] + q[2] * 0.55 - 0.16, F + 1.0, q[1] - 0.16, q[0] + q[2] * 0.55 + 0.16, F + 1.35, q[1] + 0.16, T.rgDark);
        g.beam([q[0], F + 1.3, q[1]], [q[2] * D.legX(F + 15), F + 15, 0.4], 0.025, 0.025, T.rgRope);
        g.beam([q[2] * D.legX(F + 15), F + 15, 0.4], [q[2] * (D.legX(F + 6) - 0.9), F + 6, 0.75], 0.025, 0.025, T.rgRope);
        g.box(q[2] * (D.legX(F + 6) - 0.9) - 0.14, F + 5.3, 0.61, q[2] * (D.legX(F + 6) - 0.9) + 0.14, F + 6, 0.89, T.rgDark);
      });
      if (!st.wellDone) k.bop(0, 0, 0, st.bop | 0, 6.1);
      echelon(k); mixing(k);
    });
  }

  function defaultState() {
    return { slot: 0, bop: 0, wellDone: false, v: 1 };
  }

  Props.KINDS.bu3000 = {
    name: 'Буровая установка БУ-3000 ЭУК-1М',
    init: function () { return KC.RigSim ? KC.RigSim.newState() : defaultState(); },
    bounds: function () { return [-36, -3, -36, 114, 57, 38]; },
    stamp: function (S, p) { layout(new Kit(null, S), p); },
    build: function (g, p) { layout(new Kit(g, null), p); },
    dynamic: function (g, p, env) { if (KC.RigSim) KC.RigSim.draw(g, p, env); },
    update: function (p, dt, hooks) { if (KC.RigSim) KC.RigSim.update(p, dt, hooks); },
    use: function (p, pos, ctx) { return KC.RigSim ? KC.RigSim.use(p, pos, ctx) : false; },
    hint: function (p, pos) { return KC.RigSim ? KC.RigSim.hint(p, pos) : null; },
    lights: function (p, out, cam, night) {
      var RX = p.st.slot * L.STEP, w;
      if (p.st.flare) {
        var f = 0.85 + Math.random() * 0.3;
        w = Props.world(p, L.FLARE[0], 11, L.FLARE[1]);
        out.push({ x: w[0], y: w[1], z: w[2], r: 46, col: [1.7 * f, 1.05 * f, 0.45 * f], pri: 3 });
      }
      if (!(night > 0.05)) return;
      // ночью прожекторы освещают рабочие места
      [[0, D.FLOOR + 4.3, 1.5, 26], [0, D.MONKEY + 2, -3.5, 18], [0, 4.6, -17, 22], [15, 7.4, 0, 20], [31, 7.4, 0, 20], [48, 5.7, 0, 20]].forEach(function (q) {
        w = Props.world(p, RX + q[0], q[1], q[2]);
        var dx = w[0] - cam.x, dz = w[2] - cam.z;
        if (dx * dx + dz * dz > 150 * 150) return;
        out.push({ x: w[0], y: w[1], z: w[2], r: q[3], col: [1.05 * night, 1.0 * night, 0.86 * night], pri: 1, d2: dx * dx + dz * dz });
      });
    },
    save: function (p) { return KC.RigSim ? KC.RigSim.save(p) : p.st; }
  };

  // ---- Предметы: комплект буровой -------------------------------------------------------------
  function regItem(key, id, name, sprite, prop) {
    KC.I[key] = id;
    KC.ITEMS[id] = { id: id, name: name, sprite: T[sprite], stack: 1, prop: prop };
    KC.CREATIVE.push(id);
  }
  regItem('RIG_KIT', 390, 'Комплект буровой БУ-3000', 'rgItemRig', 'bu3000');

  // Куда встанет устье: в 30 м перед игроком; отметка площадки — по рельефу, но не выше 39
  KC.Rig = {
    L: L,
    siteFor: function (world, x, z, yaw) {
      var wx = Math.round(x - Math.sin(yaw) * 34), wz = Math.round(z - Math.cos(yaw) * 34);
      return KC.Rig.siteAt(world, wx, wz);
    },
    siteAt: function (world, wx, wz) {
      var col = { h: 0, biome: 0, forest: 0 }, sum = 0, n = 0;
      for (var dz = -24; dz <= 24; dz += 12) for (var dx = -20; dx <= 90; dx += 22) { world.column(wx + dx, wz + dz, col); sum += Math.max(col.h, KC.WL); n++; }
      var y = Math.round(sum / n) + 1;
      return { x: wx, y: Math.max(KC.WL + 2, Math.min(39, y)), z: wz };
    },
    // самое ровное место в округе точки (x, z): шаг 40 м, радиус 400 м
    findSite: function (world, x, z) {
      var col = { h: 0, biome: 0, forest: 0 }, best = null, cx = Math.round(x), cz = Math.round(z);
      for (var az = -400; az <= 400; az += 40) for (var ax = -400; ax <= 400; ax += 40) {
        var mn = 99, mx = 0;
        for (var dz = -30; dz <= 30; dz += 15) for (var dx = -30; dx <= 105; dx += 15) { world.column(cx + ax + dx, cz + az + dz, col); if (col.h < mn) mn = col.h; if (col.h > mx) mx = col.h; }
        var sc = (mx - mn) + (mn < KC.WL ? 20 : 0) + (mx > 39 ? 12 : 0) + Math.hypot(ax, az) / 120;
        if (!best || sc < best.sc) best = { sc: sc, x: cx + ax, z: cz + az };
      }
      return KC.Rig.siteAt(world, best.x, best.z);
    },
    layout: layout
  };
})();
