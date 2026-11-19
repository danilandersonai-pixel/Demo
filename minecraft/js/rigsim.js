/* Кубокрафт — работа буровой БУ-3000: технологический цикл строительства скважины и состояние
   механизмов. Глубина считается числом (1 блок = 1 м на поверхности, ствол под землёй не роется).
   Время: 1 секунда игры = 1 минута работы буровой (×1), можно ускорять.
   Операции — очереди простых шагов (ход крюка, клинья, ключ, ожидание), их выбирает «мастер»:
   в автоматическом режиме сам, в ручном — по кнопке пульта. */
(function () {
  'use strict';
  var KC = window.KC, D = KC.RigDims, L = KC.RigLayout, F = D.FLOOR;

  var UP = 17.3,          // высота крюка, при которой низ ведущей трубы стоит на замке колонны в клиньях
    KD = 4.8,             // ведущая труба ушла в ротор на всю длину — пора наращивать
    EL = 1.8,             // элеватор у замка колонны в клиньях
    SWL = 16.5;           // от крюка до низа ведущей трубы (штроп, вертлюг 2,5 м + квадрат 14 м)

  // Геологический разрез (условный, по мотивам Западной Сибири): подошва, название, буримость (м/ч),
  // эквивалент пластового давления (г/см³)
  var FORM = [
    [120, 'четвертичные пески и суглинки', 58, 1.00],
    [450, 'глины и пески палеогена', 46, 1.00],
    [900, 'глины, опоки', 34, 1.01],
    [1150, 'песчаники и алевролиты', 26, 1.02],
    [1260, 'газонасыщенные песчаники', 30, 1.09],
    [1700, 'алевролиты, глины', 22, 1.03],
    [2300, 'аргиллиты', 15, 1.04],
    [2450, 'песчаники с прослоями глин', 12, 1.07],
    [2540, 'продуктивный пласт, АВПД', 13, 1.19],
    [2800, 'продуктивные песчаники', 11, 1.10],
    [9999, 'битуминозные аргиллиты', 7, 1.12]
  ];
  // Плотность раствора по геолого-техническому наряду (пласт АВПД в наряде недооценён)
  function gtnRho(d) { return d < 450 ? 1.14 : d < 1090 ? 1.10 : d < 1300 ? 1.14 : d < 2380 ? 1.12 : 1.15; }
  function rhoPlan(st) { return Math.max(gtnRho(st.hole + 60), st.rhoHold || 0); }
  function formAt(d) { for (var i = 0; i < FORM.length; i++) if (d < FORM[i][0]) return FORM[i]; return FORM[FORM.length - 1]; }

  function stages(st) {
    return [
      { id: 'drill1', name: 'Бурение под кондуктор долотом 295,3 мм', to: 450, bit: 295 },
      { id: 'case1', name: 'Спуск кондуктора 245 мм', to: 450, d: 245 },
      { id: 'cem1', name: 'Цементирование кондуктора' },
      { id: 'bop', name: 'Монтаж колонной головки и ПВО' },
      { id: 'drill2', name: 'Бурение под эксплуатационную колонну долотом 215,9 мм', to: st.td, bit: 216 },
      { id: 'case2', name: 'Спуск эксплуатационной колонны 146 мм', to: st.td, d: 146 },
      { id: 'cem2', name: 'Цементирование эксплуатационной колонны' },
      { id: 'tree', name: 'Монтаж фонтанной арматуры' },
      { id: 'test', name: 'Освоение скважины' },
      { id: 'done', name: 'Скважина закончена' }
    ];
  }

  function newState() {
    return {
      v: 1, slot: 0, bop: 0, wellDone: false, stage: 0, td: 2600, hole: 30,
      hookY: 20, kelly: 'rathole', kx: 0, strLen: 0, slips: false, el: true, onEl: false, akb: 0, kSingle: false,
      mouse: true, feed: 0, stands: 0, rackT: 0, rackDir: 0, rack: 244, casRack: 40, casLen: 0, casD: 0,
      mode: 'idle', rpm: 0, rpmSet: 70, rotary: false, wob: 0, wobSet: 14, rop: 0, pumps: [false, false], spm: 55,
      mudV: 96, mudRho: 1.14, kick: 0, loss: 0, bopClosed: false, alarm: '', circ: false,
      bit: 0, bitNo: 1, power: true, des: false, flare: false,
      eq: { sh: [true, true], dg: true, ds: true, dl: true, cf: false, ag: true }, tank: [32, 32, 32], suc: [true, true, true], eqz: [true, true],
      solids: 0, pit: 0, hoist: 0, feedAuto: true, noSuc: false, fl: { inn: 0, out: 0, pit: 0 },
      clock: 0, wellT0: 0, speed: 5, auto: true, q: [], opName: '', label: 'Буровая готова к забуриванию', log: [], wells: []
    };
  }
  // старые сохранения: недостающие поля
  function mudDefaults(st) {
    if (!st.eq) st.eq = { sh: [true, true], dg: true, ds: true, dl: true, cf: false, ag: true };
    if (!st.tank) { var v = (st.mudV || 96) / 3; st.tank = [v, v, v]; }
    if (!st.suc) st.suc = [true, true, true];
    if (!st.eqz) st.eqz = [true, true];
    if (st.solids === undefined) st.solids = 0;
    if (st.pit === undefined) st.pit = 0;
    if (st.feedAuto === undefined) st.feedAuto = true;
    if (!st.fl) st.fl = { inn: 0, out: 0, pit: 0 };
  }
  function sumTanks(st) { return st.tank[0] + st.tank[1] + st.tank[2]; }
  // забрать раствор: сначала из ёмкостей с открытой всасывающей задвижкой
  function takeMud(st, v) {
    var open = [0, 1, 2].filter(function (i) { return st.suc[i] && st.tank[i] > 1.5; }), i;
    if (!open.length) open = [0, 1, 2].filter(function (i) { return st.tank[i] > 0.2; });
    var got = 0;
    for (i = 0; i < open.length; i++) { var a = Math.min(st.tank[open[i]], v / open.length); st.tank[open[i]] -= a; got += a; }
    return got;
  }
  function addMud(st, v) {
    for (var k = 0; k < 3 && v > 0.001; k++) {
      var room = [0, 1, 2].filter(function (i) { return st.tank[i] < 39.9; });
      if (!room.length) break;
      var part = v / room.length;
      room.forEach(function (i) { var a = Math.min(part, 40 - st.tank[i]); st.tank[i] += a; v -= a; });
    }
  }
  function scaleMud(st, total) { var cur = sumTanks(st) || 1; for (var i = 0; i < 3; i++) st.tank[i] = Math.min(40, st.tank[i] * total / cur); st.mudV = sumTanks(st); }
  function rhoEff(st) { return st.mudRho + 0.1 * (st.solids || 0); }
  function rtOf(p) {
    if (!p._rt) { mudDefaults(p.st); p.st.hoist = 0; }
    if (!p._rt) p._rt = { rot: 0, drum: 0, sheave: 0, pump: [0, 1.3], agit: 0, comp: 0, compOn: 0, snd: 0, fx: 0, lastHook: p.st.hookY, pumpK: [0, 0] };
    return p._rt;
  }
  function stageOf(st) { var s = stages(st); return s[Math.min(st.stage, s.length - 1)]; }
  function say(p, text, big) {
    var st = p.st;
    st.log.push([Math.round(st.clock), text]);
    if (st.log.length > 60) st.log.shift();
    if (p._hooks && big && p._hooks.message) p._hooks.message(text, 5);
  }

  // ---- Расчётные величины -------------------------------------------------------------------
  function buoy(st) { return 1 - st.mudRho / 7.85; }
  function stringWeight(st) {            // вес колонны в растворе, тс
    var dc = Math.min(st.strLen, 100), dp = Math.max(0, st.strLen - 100);
    return (dc * 0.156 + dp * 0.031) * buoy(st);
  }
  function casingWeight(st) { return st.casLen * (st.casD > 200 ? 0.058 : 0.027) * buoy(st); }
  function flow(st, rt) { return st.noSuc ? 0 : (rt.pumpK[0] + rt.pumpK[1]) * st.spm * 0.45; }                  // л/с
  function spp(st, rt) {                                                                        // давление на стояке, атм
    var q = flow(st, rt), d = st.kelly === 'string' ? st.strLen : 0;
    return Math.min(260, (0.05 + d * 0.00005) * q * q * rhoEff(st) / 1.1);
  }
  function bitDepth(st) {
    if (st.strLen <= 0) return 0;
    if (st.kelly === 'string') return st.strLen - (st.hookY - SWL);
    if (st.onEl) return st.strLen - (st.hookY - 1.0);
    return st.strLen - 0.8;
  }
  function hookLoad(st) {
    var w = 9;
    if (st.kelly === 'string' || st.onEl) w += (st.casLen > 0 && st.strLen === 0 ? casingWeight(st) : stringWeight(st)) - st.wob;
    else if (st.kelly === 'hook') w += 4;
    return Math.max(4, w);
  }
  function info(p) {
    var st = p.st, rt = rtOf(p), sg = stageOf(st), fm = formAt(st.hole);
    return {
      stage: sg.name, stageId: sg.id, label: st.label, op: st.opName, depth: st.hole, bit: bitDepth(st), hook: hookLoad(st), wob: st.wob, rpm: st.rpm,
      torque: st.rpm > 1 ? 2 + st.wob * 0.42 + st.strLen * 0.0025 : 0, spp: spp(st, rt), flow: flow(st, rt), rop: st.rop,
      mudV: st.mudV + st.kick, mudRho: rhoEff(st), gain: st.kick, tank: st.tank, suc: st.suc, eqz: st.eqz, eq: st.eq, solids: st.solids, pit: st.pit, fl: st.fl,
      noSuc: st.noSuc, feedAuto: st.feedAuto, kelly: st.kelly, slips: st.slips, bopClosed: st.bopClosed, pumps: st.pumps, rotary: st.rotary, power: st.power, gtn: rhoPlan(st), form: fm[1], wear: st.bit, bitNo: st.bitNo,
      stands: st.stands, rack: st.rack, cas: st.casLen, casRack: st.casRack, clock: st.clock, days: (st.clock - st.wellT0) / 86400,
      well: st.slot + 1, wells: L.WELLS, alarm: st.alarm, hookY: st.hookY, td: st.td, next: nextName(p)
    };
  }

  // ---- Очередь шагов ------------------------------------------------------------------------
  function seq(st, name) {
    var s = [], sg = stageOf(st);
    function tong(text) { s.push(['akb', 1], ['wait', 2.4, text], ['akb', 0]); }
    function offString() {                    // отвернуть ведущую трубу от колонны
      s.push(['rot', 0], ['hook', UP], ['pump', 0], ['slips', 1]);
      tong('Отворот ведущей трубы ключом АКБ-3М2');
      s.push(['kelly', 'hook']);
    }
    switch (name) {
      case 'conn':                            // наращивание одиночкой через шурф
        if (st.kelly === 'string') offString();
        s.push(['hook', UP + 0.3], ['kx', 1], ['wait', 2, 'Наворот ведущей трубы на одиночку в шурфе'], ['do', 'takeSingle'], ['hook', UP + 13.1], ['kx', 0]);
        if (st.strLen > 0) { s.push(['hook', UP + 12.5]); tong('Свинчивание и докрепление замка'); }
        s.push(['do', 'addSingle'], ['hookBy', 0.3], ['slips', 0], ['pump', 1], ['do', 'resume']);
        break;
      case 'kellyUp':                         // взять ведущую трубу из шурфа
        s.push(['el', 0], ['hook', 3.3], ['wait', 1.2, 'Вертлюг на крюке'], ['kelly', 'hook'], ['hook', 17.6]);
        break;
      case 'kellyOn':                         // навернуть ведущую трубу на колонну
        s.push(['hook', UP]); tong('Наворот ведущей трубы на колонну');
        s.push(['kelly', 'string'], ['hookBy', 0.3], ['slips', 0], ['pump', 1], ['do', 'resume']);
        break;
      case 'layKelly':                        // ведущую трубу — в шурф, на крюк элеватор
        if (st.kelly === 'string') offString();
        s.push(['hook', 17.6], ['kx', -1], ['hook', 3.3], ['kelly', 'rathole'], ['el', 1], ['kx', 0]);
        break;
      case 'pull':                            // подъём свечи
        var len = st.strLen >= 25 ? 25 : st.strLen;
        s.push(['hook', EL], ['wait', 0.7, 'Элеватор закрыт под замком'], ['latch', 1], ['slips', 0], ['hook', EL + len], ['slips', 1]);
        tong(len >= 25 ? 'Отворот свечи' : 'Отворот трубы с долотом');
        s.push(['do', len >= 25 ? 'rackStand' : 'laySingle'], ['rackWait'], ['latch', 0]);
        break;
      case 'run':                             // спуск свечи
        s.push(['hook', EL + 25.2], ['do', 'unrackStand'], ['rackWait']);
        if (st.strLen > 0) { s.push(['hook', EL + 25]); tong('Свинчивание свечи с колонной'); }
        s.push(['do', 'addStand'], ['hookBy', 0.3], ['slips', 0], ['hook', EL], ['slips', 1], ['latch', 0]);
        break;
      case 'casing':                          // обсадная труба
        s.push(['hook', EL + 12.7], ['do', 'casingUp'], ['wait', 1.0, 'Обсадная труба на элеваторе']);
        if (st.casLen > 0) tong('Свинчивание обсадной трубы');
        s.push(['do', 'addCasing'], ['slips', 0], ['hook', EL], ['slips', 1], ['latch', 0]);
        break;
      case 'circ': s.push(['rot', 0], ['hookBy', 2], ['wait', 7, 'Промывка скважины перед подъёмом', 2], ['do', 'circDone']); break;
      case 'bit': s.push(['wait', 6, 'Смена долота', 1], ['do', 'newBit']); break;
      case 'cement':
        s.push(['do', 'cemOn'], ['pump', 1], ['wait', 12, 'Цементирование: закачка тампонажного раствора и продавка', 3], ['pump', 0],
          ['wait', 10, 'ОЗЦ — ожидание затвердевания цемента', 16], ['do', 'cemented']);
        break;
      case 'bopUp': s.push(['wait', 9, 'Монтаж колонной головки и противовыбросового оборудования', 12], ['do', 'bopOn'], ['wait', 5, 'Опрессовка ПВО и колонны', 2], ['do', 'bopTested']); break;
      case 'tree': s.push(['wait', 8, 'Демонтаж ПВО', 8], ['do', 'bopOff'], ['wait', 8, 'Монтаж фонтанной арматуры', 6], ['do', 'treeOn']); break;
      case 'test': s.push(['do', 'flareOn'], ['wait', 18, 'Освоение: вызов притока, отработка скважины на факел', 36], ['do', 'flareOff'], ['do', 'wellDone']); break;
      case 'kill':
        s.push(['rot', 0], ['pump', 0], ['do', 'bopClose'], ['wait', 4, 'Скважина закрыта. Запись давлений в трубах и затрубье', 0.5], ['do', 'weightUp'],
          ['pump', 1], ['wait', 12, 'Глушение: вымыв пачки через дроссель утяжелённым раствором', 3], ['do', 'killDone']);
        break;
      case 'mix': s.push(['wait', 6, 'Приготовление раствора: гидроворонка, глинопорошок, барит', 1.5], ['do', 'mixed']); break;
      case 'move': s.push(['wait', 7, 'Передвижка буровой по рельсам на 5 м к следующей скважине куста', 8], ['do', 'moved']); break;
    }
    return { steps: s, name: OP_NAMES[name] || name, sg: sg };
  }
  var OP_NAMES = {
    conn: 'Наращивание', kellyUp: 'Подъём ведущей трубы из шурфа', kellyOn: 'Наворот ведущей трубы', layKelly: 'Ведущая труба в шурф',
    pull: 'Подъём инструмента', run: 'Спуск инструмента', casing: 'Спуск обсадной колонны', circ: 'Промывка', bit: 'Смена долота', cement: 'Цементирование',
    bopUp: 'Монтаж ПВО', tree: 'Монтаж фонтанной арматуры', test: 'Освоение', kill: 'Глушение скважины', mix: 'Приготовление раствора', move: 'Передвижка'
  };

  // Что делать дальше (мастер): имя операции, 'drill' — бурить, null — нечего
  function decide(st) {
    var sg = stageOf(st);
    if (st.kick > 0.8 && st.bop >= 2 && !st.killing) return 'kill';
    if (st.mudV < 52 && (sg.id === 'drill1' || sg.id === 'drill2')) return st.spill ? null : 'mix';   // пока раствор льётся в амбар, новый не готовим
    switch (sg.id) {
      case 'drill1': case 'drill2':
        var out = st.hole >= sg.to - 0.01 || st.bit >= 1;
        if (out) {
          if (st.strLen > 0) {
            if (st.kelly !== 'rathole') return st.circ ? 'layKelly' : 'circ';
            return 'pull';
          }
          if (st.hole >= sg.to - 0.01) return 'stage';
          return 'bit';
        }
        if (Math.abs(st.mudRho - rhoPlan(st)) > 0.015 && st.auto) return 'mix';
        if (st.kelly === 'string') return 'drill';
        if (st.kelly === 'rathole') return st.stands > 0 && st.strLen + 25 <= st.hole - 1 ? 'run' : 'kellyUp';
        return st.strLen > 0 && st.hole - (st.strLen - 0.8) <= 12.2 ? 'kellyOn' : 'conn';
      case 'case1': case 'case2':
        if (st.kelly !== 'rathole') return 'layKelly';
        return st.casLen < sg.to - 6 ? 'casing' : 'stage';
      case 'cem1': case 'cem2': return st.cemDone ? 'stage' : 'cement';
      case 'bop': return st.bop >= 2 && st.bopOk ? 'stage' : 'bopUp';
      case 'tree': return st.wellHead ? 'stage' : 'tree';
      case 'test': return st.wellDone ? 'stage' : 'test';
      case 'done': return st.slot < L.WELLS - 1 ? 'move' : null;
    }
    return null;
  }
  function nextName(p) {
    var st = p.st;
    if (st.q.length) return '';
    var d = decide(st);
    return d === 'drill' ? (st.kelly === 'string' && st.hookY <= KD + 0.05 ? 'Наращивание' : 'Бурение') : d === 'stage' ? 'Следующий этап' : d ? OP_NAMES[d] : '';
  }
  function start(p, name) {
    var st = p.st, s;
    if (st.q.length) return false;
    if (name === 'stage') { nextStage(p); return true; }
    if (name === 'drill') { st.mode = 'drill'; return true; }
    s = seq(st, name);
    if (!s.steps.length) return false;
    st.q = s.steps; st.opName = s.name; st.mode = 'op'; st.stepT = 0;
    if (name === 'kill') st.killing = true;
    return true;
  }
  function nextStage(p) {
    var st = p.st, sg;
    st.stage++; st.circ = false; st.cemDone = false;
    sg = stageOf(st);
    if (sg.id === 'case1' || sg.id === 'case2') { st.casLen = 0; st.casD = sg.d; st.casRack = Math.min(48, Math.ceil(sg.to / 12.5)); }
    if (sg.id === 'drill2') { st.bit = 0; st.bitNo++; st.spm = 36; }
    if (sg.id === 'drill1') st.spm = 55;
    say(p, 'Этап: ' + sg.name, true);
  }

  var DO = {
    takeSingle: function (p) {
      var st = p.st;
      st.kSingle = true; st.mouse = false;
      if (st.rack <= 0) {                     // стеллаж пуст: разбираем свечу или ждём завоза
        if (st.stands > 0) { st.stands--; st.rack += 2; } else { st.rack += 40; say(p, 'Завезены бурильные трубы: 40 шт.'); }
      }
      st.feed = 0.001;
    },
    addSingle: function (p) { var st = p.st; st.kSingle = false; st.strLen += D.SINGLE; st.kelly = 'string'; },
    resume: function (p) { p.st.mode = 'drill'; p.st.rotary = true; },
    rackStand: function (p) { p.st.rackT = 0.001; p.st.rackDir = 1; },
    laySingle: function (p) { var st = p.st; st.strLen = 0; st.rack++; st.onEl = false; say(p, 'Долото на поверхности'); },
    unrackStand: function (p) { var st = p.st; st.stands--; st.rackT = 1; st.rackDir = -1; st.hang = 'stand'; },
    addStand: function (p) { var st = p.st; st.strLen += D.STAND; st.onEl = true; st.hang = ''; },
    casingUp: function (p) { var st = p.st; st.casRack = Math.max(0, st.casRack - 1); st.hang = 'casing'; },
    addCasing: function (p) { var st = p.st; st.casLen += D.SINGLE; st.onEl = true; st.hang = ''; },
    circDone: function (p) { p.st.circ = true; },
    newBit: function (p) { var st = p.st; st.bit = 0; st.bitNo++; say(p, 'Навёрнуто новое долото № ' + st.bitNo); },
    cemOn: function (p) { p.st.cementing = true; },
    cemented: function (p) { var st = p.st; st.cementing = false; st.cemDone = true; st.casDone = st.casLen; st.casLen = 0; say(p, 'Колонна зацементирована, цемент поднят до устья'); },
    bopOn: function (p) { p.st.bop = 2; KC.Props.changed(p, false); },
    bopTested: function (p) { p.st.bopOk = true; say(p, 'ПВО опрессовано, герметично'); },
    bopOff: function (p) { p.st.bop = 1; p.st.bopOk = false; KC.Props.changed(p, false); },
    treeOn: function (p) { p.st.wellHead = true; },
    flareOn: function (p) { p.st.flare = true; say(p, 'Получен приток: скважина отрабатывается на факел', true); },
    flareOff: function (p) { p.st.flare = false; },
    wellDone: function (p) {
      var st = p.st, days = (st.clock - st.wellT0) / 86400;
      st.wellDone = true; st.bop = 0;
      st.wells.push({ n: st.slot + 1, td: st.td, days: Math.round(days * 10) / 10 });
      KC.Props.changed(p, false);
      say(p, 'Скважина № ' + (st.slot + 1) + ' закончена строительством: забой ' + st.td + ' м, ' + days.toFixed(1) + ' сут.', true);
      if (p._hooks && p._hooks.sound) p._hooks.sound('victory');
    },
    bopClose: function (p) { p.st.bopClosed = true; say(p, 'Превентор закрыт', true); },
    weightUp: function (p) {
      var st = p.st, need = Math.max(st.mudRho, formAt(st.hole)[3] + 0.06);
      st.mudRho = Math.round(need * 100) / 100; st.rhoHold = st.mudRho;
      say(p, 'Раствор утяжелён баритом до ' + st.mudRho.toFixed(2) + ' г/см³');
    },
    killDone: function (p) { var st = p.st; st.kick = 0; st.bopClosed = false; st.killing = false; st.alarm = ''; say(p, 'Скважина заглушена, превентор открыт. Продолжаем бурение', true); },
    mixed: function (p) {
      var st = p.st, target = st.rhoSet || rhoPlan(st), add = Math.max(0, Math.min(34, 104 - st.mudV));
      addMud(st, add); st.mudV = sumTanks(st); st.solids *= 0.6; st.mudRho = Math.round(target * 100) / 100; st.rhoSet = 0;
      say(p, 'Приготовлено ' + Math.round(add) + ' м³ раствора, плотность ' + st.mudRho.toFixed(2) + ' г/см³');
    },
    moved: function (p) {
      var st = p.st, pl = p._hooks && p._hooks.player ? p._hooks.player() : null, lp = pl ? KC.Props.local(p, pl.e.x, pl.e.y, pl.e.z) : null;
      st.slot++; st.stage = 0; st.hole = 30; st.wellDone = false; st.wellHead = false; st.bop = 0; st.bopOk = false; st.casLen = 0; st.casDone = 0; st.cemDone = false;
      st.bit = 0; st.bitNo = 1; st.wellT0 = st.clock; if (st.mudV < 90) scaleMud(st, 90); st.solids = 0; st.mudRho = 1.14; st.rhoHold = 0; st.circ = false; st.mode = 'idle';
      KC.Props.changed(p, true);
      if (lp && lp[0] > (st.slot - 1) * L.STEP - 16 && lp[0] < (st.slot - 1) * L.STEP + 80 && Math.abs(lp[2]) < 32 && lp[1] > 0.5) pl.e.x += KC.Props.rotPt(L.STEP, 0, p.r)[0];
      say(p, 'Буровая передвинута на скважину № ' + (st.slot + 1) + '. Можно забуриваться', true);
    }
  };

  function approach(v, target, step) { return v < target ? Math.min(target, v + step) : Math.max(target, v - step); }

  // Один шаг очереди: возвращает true, когда выполнен
  function step(p, s, d) {
    var st = p.st, rt = rtOf(p);
    switch (s[0]) {
      case 'hook': case 'hookBy':
        if (s[0] === 'hookBy') { s[0] = 'hook'; s[1] = st.hookY + s[1]; }
        if (!st.power) { st.label = 'Нет напряжения 6 кВ — лебёдка стоит'; return false; }
        st.hookY = approach(st.hookY, s[1], d * (st.onEl || st.kelly === 'string' ? 1.1 : 1.7));
        st.label = s[1] > st.hookY ? 'Подъём талевого блока' : 'Спуск талевого блока';
        return st.hookY === s[1];
      case 'wait':
        if (!st.stepT) { st.stepT = 0.0001; st.label = s[2]; }
        st.stepT += d;
        if (s[3]) st.clock += s[3] * 3600 * d / s[1];
        if (st.stepT >= s[1]) { st.stepT = 0; return true; }
        return false;
      case 'kx': st.kx = approach(st.kx, s[1], d * 0.9); st.label = 'Отвод инструмента ' + (s[1] ? (s[1] > 0 ? 'к шурфу' : 'к шурфу ведущей трубы') : 'на центр скважины'); return st.kx === s[1];
      case 'akb': st.akb = approach(st.akb, s[1], d * 1.6); if (st.akb === s[1]) { if (s[1] && p._hooks && p._hooks.sound) snd(p, 'door-car', 0, F + 1, 0); return true; } return false;
      case 'slips': st.slips = !!s[1]; if (p._hooks) snd(p, 'door-car', 0, F, 0); return true;
      case 'latch': st.onEl = !!s[1]; return true;
      case 'el': st.el = !!s[1]; return true;
      case 'kelly': st.kelly = s[1]; return true;
      case 'rot': st.rotary = !!s[1]; return true;
      case 'pump': st.pumps[0] = st.pumps[1] = !!s[1]; return true;
      case 'do': DO[s[1]](p); return true;
      case 'rackWait':
        st.rackT = approach(st.rackT, st.rackDir > 0 ? 1 : 0, d * 0.5);
        st.label = st.rackDir > 0 ? 'Верховой заводит свечу за палец' : 'Свеча выводится из-за пальца';
        if (st.rackDir > 0 && st.rackT === 1) { st.rackT = 0; st.rackDir = 0; st.stands++; st.strLen -= D.STAND; st.onEl = false; return true; }
        if (st.rackDir <= 0 && st.rackT === 0) { st.rackDir = 0; return true; }
        return false;
    }
    return true;
  }
  function snd(p, name, x, y, z, vol) {
    if (!p._hooks || !p._hooks.sound) return;
    var w = KC.Props.world(p, p.st.slot * L.STEP + x, y, z);
    p._hooks.sound(name, w[0], w[1], w[2], vol);
  }

  // ---- Такт симуляции -------------------------------------------------------------------------
  function update(p, dt, hooks) {
    var st = p.st, rt = rtOf(p), sg = stageOf(st);
    p._hooks = hooks;
    var d = dt * st.speed, rig = d * 60, i;            // d — «механическое» время, rig — секунды работы буровой
    st.clock += rig;

    // очередь шагов; мастер назначает новые операции
    var guard = 0;
    while (st.q.length && guard++ < 8) {
      if (!step(p, st.q[0], d)) break;
      st.q.shift();
      if (!st.q.length) { st.opName = ''; if (st.mode === 'op') st.mode = 'idle'; }
    }
    if (!st.q.length && st.auto) {
      var nx = decide(st);
      if (nx === 'drill') st.mode = 'drill'; else if (nx) start(p, nx); else if (st.mode !== 'idle') st.mode = 'idle';
    }
    if (!st.q.length && st.mode === 'idle') st.label = stageOf(st).id === 'done' ? (st.slot < L.WELLS - 1 ? 'Скважина закончена. Буровая готова к передвижке' : 'Куст разбурен: все скважины закончены') : 'Ожидание команды бурильщика';

    // приводы: насосы и ротор набирают обороты
    mudDefaults(st);
    for (i = 0; i < 2; i++) rt.pumpK[i] = approach(rt.pumpK[i], st.pumps[i] && st.power ? 1 : 0, dt * 0.8);
    var anyPump = rt.pumpK[0] + rt.pumpK[1] > 0.05, canSuck = (st.suc[0] && st.tank[0] > 1.5) || (st.suc[1] && st.tank[1] > 1.5) || (st.suc[2] && st.tank[2] > 1.5);
    if (anyPump && !canSuck && !st.noSuc) say(p, 'Насосы не берут раствор: закрыты всасывающие задвижки или пусты ёмкости', true);
    st.noSuc = anyPump && !canSuck;
    var q = flow(st, rt);
    if (spp(st, rt) >= 250 && (st.pumps[0] || st.pumps[1])) {
      st.pumps[0] = st.pumps[1] = false;
      if (st.auto) st.spm = Math.max(20, st.spm - 6);
      say(p, 'Сработал предохранительный клапан: давление выше 25 МПа. Снизьте подачу насосов', true);
    }
    st.rpm = approach(st.rpm, st.rotary && st.power && st.kelly === 'string' ? st.rpmSet : 0, dt * 45);

    // ручное управление лебёдкой: рукоятка «подъём / спуск»
    rt.fill = 0; rt.dh = 0;
    if (st.hoist && !st.q.length) {
      if (!st.power) st.label = 'Нет напряжения 6 кВ — лебёдка стоит';
      else if (st.slips && (st.kelly === 'string' || st.onEl)) st.label = 'Колонна в клиньях: снимите её с клиньев операцией';
      else if (st.hoist > 0) {
        if (st.wob > 0.3) st.wob = approach(st.wob, 0, dt * 14);
        else st.hookY = Math.min(37, st.hookY + d * 0.9);
      } else {
        var bh = st.kelly === 'string' ? Math.max(st.strLen - st.hole + SWL, KD) : (st.kelly === 'hook' ? SWL + 0.6 : EL);
        if (st.hookY > bh + 0.01) st.hookY = Math.max(bh, st.hookY - d * 0.9);
        else if (st.kelly === 'string' && st.hookY > KD + 0.02) { st.mode = 'drill'; st.wob = Math.min(28, st.wob + dt * 7); }
      }
    }

    // бурение: колонна на ведущей трубе
    st.rop = 0;
    if (st.mode === 'drill' && st.kelly === 'string' && !st.q.length) {
      var drilling = sg.id === 'drill1' || sg.id === 'drill2';
      var bottom = st.strLen - st.hole + SWL;          // высота крюка, когда долото на забое
      if (st.bopClosed) { st.label = 'Превентор закрыт'; }
      else if (st.hookY > Math.max(bottom, KD) + 0.02) {
        if (st.auto) { st.rotary = true; st.pumps[0] = st.pumps[1] = true; }
        if (st.auto || (st.feedAuto && !st.hoist)) { st.hookY = approach(st.hookY, Math.max(bottom, KD), d * 1.0); st.label = 'Проработка: допуск инструмента до забоя'; }
        else st.label = 'Долото над забоем: спускайте инструмент лебёдкой';
        st.wob = 0;
      } else if (st.hookY <= KD + 0.02 && st.hole < sg.to - 0.01 || (st.hookY <= KD + 0.02 && bottom < KD - 0.02)) {
        st.wob = approach(st.wob, 0, dt * 20); st.label = 'Ведущая труба на роторе — нужно наращивание';
        if (st.auto) start(p, 'conn');
      } else if (drilling && st.hole < sg.to && st.bit < 1.2) {
        if (st.auto) st.rotary = true;
        if (st.auto || st.feedAuto) st.wob = approach(st.wob, st.rpm > 5 && q > 5 ? st.wobSet : 0, dt * 6);
        else if (st.rpm < 5) st.wob = approach(st.wob, 0, dt * 4);
        var fm = formAt(st.hole), need = sg.bit > 250 ? 45 : 30;
        var over = Math.max(0, rhoEff(st) - fm[3] - 0.05);
        st.rop = fm[2] * Math.pow(st.wob / 15, 0.9) * Math.pow(st.rpm / 70, 0.6) * Math.max(0.25, Math.min(1.1, q / need)) * (1 - 0.8 * Math.min(1, st.bit * st.bit)) * (1 - Math.min(0.5, over * 1.6)) * (1 - 0.5 * st.solids);
        var dh = Math.min(st.rop / 3600 * rig, sg.to - st.hole, st.hookY - KD);
        if (dh > 0) {
          st.hole += dh; st.hookY -= dh;
          rt.fill = dh * (sg.bit > 250 ? 0.068 : 0.037) * 1.15; rt.dh = dh;
          if (!st.auto && !st.feedAuto) st.wob = Math.max(0, st.wob - dt * st.rop / 40 * 1.5);      // без подачи нагрузка «срабатывается»
          st.bit += dh / (sg.bit > 250 ? 620 : 1250) * (0.6 + st.wob / 30) * (1 + (fm[2] < 14 ? 0.5 : 0));
        }
        st.label = st.bit >= 1 ? 'Долото сработано — нужен подъём' : st.rpm < 5 ? 'Ротор стоит — бурения нет' : q < 5 ? 'Нет циркуляции — бурения нет' : st.wob < 1 ? 'Нет нагрузки на долото: подайте инструмент' : 'Бурение: ' + fm[1];
        if (st.hole >= sg.to - 0.01) { st.label = 'Проектный забой достигнут'; if (!st.tdSaid) { st.tdSaid = st.stage + 1; say(p, 'Достигнут забой ' + Math.round(st.hole) + ' м', true); } }
      } else st.wob = approach(st.wob, 0, dt * 20);
    } else st.wob = approach(st.wob, 0, dt * 20);
    if (st.tdSaid && st.tdSaid !== st.stage + 1) st.tdSaid = 0;

    // газонефтеводопроявление: пластовое давление выше давления столба раствора
    var open = (sg.id === 'drill2') && st.hole > 450, fm2 = formAt(st.hole);
    if (open && !st.bopClosed && rhoEff(st) < fm2[3] + 0.01) {
      st.kick += rig / 3600 * 6 * (fm2[3] + 0.03 - rhoEff(st)) / 0.05;
      if (st.kick > 0.8 && st.alarm !== 'kick') { st.alarm = 'kick'; say(p, 'Рост объёма в ёмкостях! Признаки ГНВП — закрыть превентор и глушить скважину', true); if (hooks.sound) hooks.sound('alarm'); }
      if (st.kick > 9) {                                 // выброс: превентор закрывается аварийно
        st.kick = 2; scaleMud(st, Math.max(40, st.mudV - 18)); st.pit += 18; st.clock += 86400 * 1.5; st.q = []; st.rotary = false; st.pumps[0] = st.pumps[1] = false;
        rt.blow = 6; start(p, 'kill');
        say(p, 'Выброс! Превентор закрыт аварийно, потеряно 18 м³ раствора и полторы суток', true);
      }
    }
    if (st.alarm === 'kick' && st.kick <= 0) st.alarm = '';
    if (st.mudV < 42 && st.alarm !== 'kick') st.alarm = 'mud'; else if (st.alarm === 'mud' && st.mudV >= 42) st.alarm = '';

    mudCircuit(p, rig, q, rt);

    // вращение и ходы механизмов
    rt.rot += st.rpm / 60 * Math.PI * 2 * dt;
    var dh2 = st.hookY - rt.lastHook; rt.lastHook = st.hookY;
    rt.drum += dh2 * 10 / 0.55; rt.sheave += dh2 * 1.6;
    for (i = 0; i < 2; i++) rt.pump[i] += rt.pumpK[i] * st.spm / 60 * Math.PI * 2 * dt;
    if (st.power && st.eq.ag) rt.agit += dt * 2.2;
    rt.compT = (rt.compT || 0) + dt;
    rt.compOn = st.power && (rt.compT % 26) < 9 ? 1 : 0;
    rt.comp += rt.compOn * dt * 14;
    // подача одиночки с мостков в шурф
    if (st.feed > 0) { st.feed += d * 0.16; if (st.feed >= 1) { st.feed = 0; st.mouse = true; st.rack = Math.max(0, st.rack - 1); } }

    effects(p, dt, rt, q);
  }

  // Контур раствора: всас из ёмкостей → насосы → скважина → выкидная линия → сита → ёмкости (или амбар)
  function mudCircuit(p, rig, q, rt) {
    var st = p.st, i, circ = q > 0.5 && (st.kelly === 'string' || st.cementing);
    var nSh = st.power ? (st.eq.sh[0] ? 1 : 0) + (st.eq.sh[1] ? 1 : 0) : 0;
    st.fl.inn = st.fl.out = st.fl.pit = 0;
    if (circ) {
      var dV = q * rig / 1000, frac = nSh ? Math.min(1, nSh * 30 / q) : 0.35;
      dV = takeMud(st, dV);
      var ret = Math.max(0, dV - (rt.fill || 0));
      st.tank[0] += ret * frac; st.pit += ret * (1 - frac);
      st.fl.inn = q; st.fl.out = q * frac; st.fl.pit = q * (1 - frac); st.spill = frac < 0.99;
      if (frac < 0.99 && !rt.spillSaid) { rt.spillSaid = 1; say(p, nSh ? 'Одно вибросито не справляется с расходом: часть раствора уходит в амбар' : 'Вибросита остановлены: раствор с выкидной линии уходит в амбар!', true); }
      if (frac >= 0.99) rt.spillSaid = 0;
    } else if (rt.fill) takeMud(st, rt.fill);
    // шлам: что не сняли сита и гидроциклоны, остаётся в растворе
    if (rt.dh > 0) {
      var eff = Math.min(1, (st.power ? nSh * 0.3 + (st.eq.ds ? 0.2 : 0) + (st.eq.dl ? 0.14 : 0) + (st.eq.cf ? 0.1 : 0) : 0));
      st.solids = Math.min(1, st.solids + rt.dh * 0.004 * (1 - eff));
    }
    st.solids = Math.max(0, st.solids - rig / 3600 * (st.eq.cf && st.power ? 0.03 : 0.01));
    if (st.solids > 0.35 && !rt.solSaid) { rt.solSaid = 1; say(p, 'Раствор зашламован: плотность растёт, скорость бурения падает. Проверьте сита и гидроциклоны', true); }
    if (st.solids < 0.2) rt.solSaid = 0;
    // без перемешивания утяжелитель оседает
    if ((!st.eq.ag || !st.power) && st.mudRho > 1.1) {
      st.mudRho = Math.max(1.1, st.mudRho - rig / 3600 * 0.004);
      if (!rt.agSaid) { rt.agSaid = 1; say(p, 'Перемешиватели стоят: утяжелитель оседает, плотность раствора падает', true); }
    } else rt.agSaid = 0;
    // перепуск между ёмкостями и перелив
    for (i = 0; i < 2; i++) if (st.eqz[i]) { var mv = (st.tank[i] - st.tank[i + 1]) / 2 * Math.min(1, rig / 90); st.tank[i] -= mv; st.tank[i + 1] += mv; }
    for (i = 0; i < 3; i++) if (st.tank[i] > 40) {
      st.pit += st.tank[i] - 40; st.tank[i] = 40;
      if (!rt.ovSaid) { rt.ovSaid = 1; say(p, 'Перелив ёмкости № ' + (i + 1) + ': раствор уходит в амбар. Откройте перепускную задвижку', true); }
    }
    if (st.tank[0] < 39 && st.tank[1] < 39 && st.tank[2] < 39) rt.ovSaid = 0;
    st.mudV = sumTanks(st);
  }

  // звук и частицы
  function effects(p, dt, rt, q) {
    var st = p.st, hooks = p._hooks, RX = st.slot * L.STEP, w, e;
    if (!hooks) return;
    rt.snd -= dt; rt.fx -= dt;
    if (rt.snd <= 0) {
      rt.snd = 0.34;
      if (Math.abs(rt.drumV || 0) > 0.05) snd(p, 'engine:' + Math.round(30 + Math.min(30, Math.abs(rt.drumV) * 9)), 0, F + 1.5, 6.2, 0.5);
      if (st.rpm > 5) snd(p, 'engine:' + Math.round(22 + st.rpm * 0.12), 0, F + 0.5, 0, 0.35);
      if (rt.pumpK[0] > 0.2) snd(p, 'engine:' + Math.round(18 + st.spm * 0.18), L.PUMP[0][0], 2, L.PUMP[0][1], 0.5);
      if (rt.pumpK[1] > 0.2) snd(p, 'engine:' + Math.round(19 + st.spm * 0.18), L.PUMP[1][0], 2, L.PUMP[1][1], 0.5);
      if (st.des) snd(p, 'engine:26', L.DES[0] + 16 - RX, 1.5, L.DES[1] - 10, 0.5);
    }
    rt.drumV = ((rt.drumV || 0) * 0.8) + (st.hookY - (rt.prevH === undefined ? st.hookY : rt.prevH)) / Math.max(dt, 0.001) * 0.2;
    rt.prevH = st.hookY;
    if (rt.fx <= 0 && KC.FX && KC.FX.emit) {
      rt.fx = 0.12;
      if (st.des) { w = KC.Props.world(p, L.DES[0] + 17.9, 4.3, L.DES[1] - 9.5); KC.FX.emit('smoke', w[0], w[1], w[2]); }
      if (st.flare) {
        w = KC.Props.world(p, L.FLARE[0], 10, L.FLARE[1]);
        for (var k = 0; k < 4; k++) { e = KC.FX.emit('flame', w[0], w[1] + Math.random() * 0.6, w[2]); if (e) { e.s0 = 0.9 + Math.random() * 0.6; e.s1 = 0.3; e.vy = 2.5 + Math.random() * 2; e.life = 0.7 + Math.random() * 0.5; e.vx += 0.8; } }
        if (Math.random() < 0.5) KC.FX.emit('smokeDark', w[0], w[1] + 2.5, w[2]);
      }
      if (q > 5 && st.kelly === 'string') {              // шлам с вибросит
        var sh = L.SHAKER[Math.random() < 0.5 ? 0 : 1];
        w = KC.Props.world(p, RX + sh[0] + (Math.random() - 0.5), 4.9, sh[1] + 1.9);
        e = KC.FX.emit('block', w[0], w[1], w[2], KC.B.DIRT); if (e) { e.vx *= 0.2; e.vz = 0.8 + Math.random() * 0.6; e.vy = 0.4; }
      }
      if (rt.blow > 0) {                                 // фонтан раствора из устья
        rt.blow -= 0.12;
        w = KC.Props.world(p, RX, F + 0.5, 0);
        for (var b = 0; b < 6; b++) { e = KC.FX.emit('block', w[0], w[1], w[2], KC.B.DIRT); if (e) { e.vy = 14 + Math.random() * 10; e.vx *= 1.5; e.vz *= 1.5; e.life = 2.5; } }
      }
    }
  }

  // ---- Команды пульта ---------------------------------------------------------------------------
  function clampN(v, a, b) { return v < a ? a : v > b ? b : v; }
  function cmd(p, c, v) {
    var st = p.st;
    switch (c) {
      case 'auto': st.auto = !st.auto; say(p, st.auto ? 'Автоматический режим: буровой мастер ведёт работы сам' : 'Ручной режим: операции — по команде бурильщика'); break;
      case 'speed': st.speed = v; break;
      case 'wob': st.wobSet = clampN(st.wobSet + v, 2, 26); break;
      case 'rpm': st.rpmSet = clampN(st.rpmSet + v, 30, 120); break;
      case 'spm': st.spm = clampN(st.spm + v, 20, 66); break;
      case 'pump': st.pumps[v] = !st.pumps[v]; break;
      case 'rotary': st.rotary = !st.rotary; break;
      case 'power': st.power = !st.power; say(p, st.power ? 'Подано напряжение 6 кВ' : 'Ввод 6 кВ отключён', true); break;
      case 'des': st.des = !st.des; if (p._hooks && p._hooks.sound) p._hooks.sound(st.des ? 'generator-on' : 'generator-off'); break;
      case 'bop':
        if (st.bop < 2) { say(p, 'ПВО ещё не смонтировано', true); break; }
        st.bopClosed = !st.bopClosed; say(p, st.bopClosed ? 'Превентор закрыт' : 'Превентор открыт', true);
        break;
      case 'rho': st.rhoSet = clampN(Math.round(((st.rhoSet || st.mudRho) + v) * 100) / 100, 1.02, 1.4); break;
      case 'mix': if (!start(p, 'mix')) say(p, 'Сначала закончите текущую операцию', true); break;
      case 'kill': if (st.bop >= 2) { st.q = []; start(p, 'kill'); } else say(p, 'ПВО не смонтировано', true); break;
      case 'next': var n = decide(st); if (n && !st.q.length) { if (n === 'drill' && st.hookY <= KD + 0.05) start(p, 'conn'); else start(p, n); } break;
      case 'pullOut': if (!st.q.length && st.strLen > 0) { st.bit = Math.max(st.bit, 1); say(p, 'Подъём инструмента для смены долота'); } break;
      case 'td': if (st.stage === 0 && st.hole <= 31) st.td = v; break;
      case 'hoist': st.hoist = v > 0 ? 1 : v < 0 ? -1 : 0; break;
      case 'feedAuto': st.feedAuto = !st.feedAuto; say(p, st.feedAuto ? 'Регулятор подачи долота включён' : 'Подача вручную: нагрузку держит бурильщик тормозом'); break;
      case 'sh': st.eq.sh[v] = !st.eq.sh[v]; say(p, 'Вибросито № ' + (v + 1) + (st.eq.sh[v] ? ' включено' : ' остановлено')); break;
      case 'eq': st.eq[v] = !st.eq[v]; say(p, EQ_NAMES[v] + (st.eq[v] ? ': включено' : ': остановлено')); break;
      case 'suc': st.suc[v] = !st.suc[v]; say(p, 'Всасывающая задвижка ёмкости № ' + (v + 1) + (st.suc[v] ? ' открыта' : ' закрыта')); break;
      case 'eqz': st.eqz[v] = !st.eqz[v]; say(p, 'Перепуск между ёмкостями ' + (v + 1) + ' и ' + (v + 2) + (st.eqz[v] ? ' открыт' : ' закрыт')); break;
      case 'stop': st.q = []; st.mode = 'idle'; st.rotary = false; st.akb = 0; st.kx = 0; st.rackT = 0; st.rackDir = 0; say(p, 'Стоп: операция прервана'); break;
    }
  }

  var EQ_NAMES = { dg: 'Дегазатор', ds: 'Пескоотделитель', dl: 'Илоотделитель', cf: 'Центрифуга', ag: 'Перемешиватели' };

  // Агрегат под прицелом: что это, в каком состоянии и что сделает нажатие
  function zoneInfo(p, z) {
    var st = p.st, on, name;
    function r(n, state, act, c, v) { return { name: n, state: state, act: act, c: c, v: v }; }
    switch (z.t) {
      case 'pump': on = st.pumps[z.i]; return r('Буровой насос УНБ-600 № ' + (z.i + 1), on ? 'работает, ' + st.spm + ' ход/мин' : 'остановлен', on ? 'остановить' : 'пустить', 'pump', z.i);
      case 'sh': on = st.eq.sh[z.i]; return r('Вибросито № ' + (z.i + 1), on ? 'работает' : 'остановлено', on ? 'остановить' : 'включить', 'sh', z.i);
      case 'eq': on = st.eq[z.i]; name = z.i === 'ag' ? 'Перемешиватель' : EQ_NAMES[z.i]; return r(name, on ? 'работает' : 'остановлен', on ? 'остановить' : 'включить', 'eq', z.i);
      case 'suc': on = st.suc[z.i]; return r('Всасывающая задвижка ёмкости № ' + (z.i + 1), on ? 'открыта' : 'закрыта', on ? 'закрыть' : 'открыть', 'suc', z.i);
      case 'eqz': on = st.eqz[z.i]; return r('Перепускная задвижка ёмкостей ' + (z.i + 1) + '–' + (z.i + 2), on ? 'открыта' : 'закрыта', on ? 'закрыть' : 'открыть', 'eqz', z.i);
      case 'tank': return r('Ёмкость раствора № ' + (z.i + 1), st.tank[z.i].toFixed(1) + ' из 40 м³, ' + rhoEff(st).toFixed(2) + ' г/см³', 'пост бурильщика', 'panel');
      case 'rotary': return r('Ротор Р-560', st.rpm > 1 ? Math.round(st.rpm) + ' об/мин' : 'стоит', st.rotary ? 'остановить' : 'включить', 'rotary');
      case 'draw': return r('Лебёдка ЛБУ-1200К', 'крюк на ' + st.hookY.toFixed(1) + ' м, ' + hookLoad(st).toFixed(0) + ' тс', 'пост бурильщика', 'panel');
      case 'post': return r('Пост бурильщика', st.label, 'открыть пульт', 'panel');
      case 'akb': return r('Ключ АКБ-3М2', st.akb > 0.5 ? 'на замке' : 'отведён', 'пост бурильщика', 'panel');
      case 'bop': return r(st.bop >= 2 ? 'Противовыбросовое оборудование' : 'Устье скважины', st.bop < 2 ? 'ПВО не смонтировано' : st.bopClosed ? 'превентор закрыт' : 'превентор открыт', st.bop < 2 ? 'пост бурильщика' : st.bopClosed ? 'открыть' : 'закрыть', st.bop < 2 ? 'panel' : 'bop');
      case 'acc': return r('Станция гидроуправления ПВО', st.bop < 2 ? 'ПВО не смонтировано' : st.bopClosed ? 'превентор закрыт' : 'превентор открыт', st.bop < 2 ? 'пост бурильщика' : st.bopClosed ? 'открыть превентор' : 'закрыть превентор', st.bop < 2 ? 'panel' : 'bop');
      case 'choke': return r('Блок дросселирования', st.kick > 0.8 ? 'приток +' + st.kick.toFixed(1) + ' м³' : 'задвижки закрыты', st.kick > 0.8 ? 'глушить скважину' : 'пост бурильщика', st.kick > 0.8 ? 'kill' : 'panel');
      case 'kru': return r('КРУ 6 кВ', st.power ? 'ввод включён' : 'ввод отключён', st.power ? 'отключить' : 'включить', 'power');
      case 'des': return r('Аварийная ДЭС', st.des ? 'работает' : 'стоит', st.des ? 'остановить' : 'запустить', 'des');
      case 'hopper': return r('Гидроворонка', 'плотность ' + st.mudRho.toFixed(2) + ' г/см³', 'приготовить раствор', 'mix');
      case 'comp': return r('Компрессор 4ВУ1-5/9', 'автоматический режим, 8 атм', 'пост бурильщика', 'panel');
      case 'trip': return r('Доливная ёмкость', '6 м³', 'пост бурильщика', 'panel');
    }
    return null;
  }
  function zoneAt(p, pos) {
    var zs = L.ZONES || [], RX = p.st.slot * L.STEP, x = pos[0], y = pos[1], z = pos[2], best = null, bd = 1e9;
    for (var i = 0; i < zs.length; i++) {
      var q = zs[i], ox = q.fixed ? 0 : RX, b = q.b;
      var dx = Math.max(b[0] + ox - x, 0, x - b[3] - ox), dy = Math.max(b[1] - y, 0, y - b[4]), dz = Math.max(b[2] - z, 0, z - b[5]), dd = dx * dx + dy * dy + dz * dz;
      if (dd < bd) { bd = dd; best = q; }
    }
    return bd <= 0.6 ? best : null;
  }
  function hint(p, pos) {
    var z = zoneAt(p, pos), zi = z ? zoneInfo(p, z) : null;
    return zi ? zi.name + ' — ' + zi.state + ' · ' + zi.act : 'Буровая БУ-3000 · пост бурильщика';
  }
  function use(p, pos, ctx) {
    var rt = rtOf(p), now = Date.now();
    if (now - (rt.useAt || 0) < 450) return true;          // удержание кнопки не должно щёлкать агрегатом туда-сюда
    rt.useAt = now;
    var z = zoneAt(p, pos), zi = z ? zoneInfo(p, z) : null;
    if (zi && zi.c !== 'panel') {
      cmd(p, zi.c, zi.v);
      var after = zoneInfo(p, z);
      if (p._hooks && p._hooks.toast && after) p._hooks.toast(after.name + ': ' + after.state);
      if (p._hooks && p._hooks.sound) snd(p, 'door-car', pos[0] - p.st.slot * L.STEP, pos[1], pos[2]);
      return true;
    }
    if (KC.RigUI) { KC.RigUI.open(p); return true; }
    return false;
  }

  KC.RigSim = {
    newState: newState, update: update, info: info, cmd: cmd, use: use, rtOf: rtOf, stageOf: stageOf, stages: stages,
    save: function (p) { return p.st; }, hint: hint, zoneAt: zoneAt, zoneInfo: zoneInfo, rhoEff: rhoEff, formAt: formAt, gtnRho: gtnRho, bitDepth: bitDepth, decide: decide, start: start,
    C: { UP: UP, KD: KD, EL: EL, SWL: SWL }, draw: function () {}, hookLoad: hookLoad, flow: flow
  };
})();
