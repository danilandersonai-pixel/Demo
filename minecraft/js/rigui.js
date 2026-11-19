/* Кубокрафт — пост бурильщика: панель с вкладками. «Бурение» — приборы (ГИВ, манометр, тахометр),
   этап и операции; «Лебёдка» — ручной подъём и спуск, подача, ротор, насосы, ПВО; «Раствор» —
   мнемосхема циркуляции с ёмкостями, задвижками и расходами, оборудование очистки; «Камеры»;
   «Журнал». Плюс строка состояния буровой и подсказка по агрегату под прицелом. */
(function () {
  'use strict';
  var KC = window.KC, S = KC.RigSim, D = KC.RigDims, L = KC.RigLayout, F = D.FLOOR;
  var el = null, hud = null, cur = null, built = false, camIdx = 0, acc = 0, hudAcc = 0, shown = false, tab = 'drill', clock = 0;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // камеры: [название, откуда, куда] — относительно устья текущей скважины
  var CAMS = [
    ['От себя', null, null],
    ['Пол буровой', [-5.4, 9.3, -5.2], [0.6, 8.7, 1.5]],
    ['Ротор', [-2.3, 9.1, -2.6], [0.1, 7.7, 0.1]],
    ['Лебёдка', [-2.6, 9.7, 2.6], [0, 8.2, 6.2]],
    ['Талевый блок', 'hook', null],
    ['Балкон верхового', [-4.6, 35.4, -10], [0.5, 33.8, -2.5]],
    ['Кронблок', [-5.5, 55, -6], [0, 51.4, 0]],
    ['Устье и ПВО', [-5.5, 3.2, -4.6], [0, 2.4, 0]],
    ['Вибросита', [12.4, 6.6, 8.2], [12.4, 5.0, 2.6]],
    ['Очистка', [17.5, 7.2, -6.5], [17.5, 5, 0.5]],
    ['Ёмкости', [31, 9.4, -9.6], [31, 4, 0]],
    ['Насосы', [48, 3.6, -9.4], [48, 2.3, -1]],
    ['Амбар', [36, 8, 34], [34, 0, 18]],
    ['Мостки', [11, 5.5, -30], [0, 3.5, -14]],
    ['Общий вид', [-44, 30, -54], [18, 17, 0]]
  ];
  var TABS = [['drill', 'Бурение'], ['hoist', 'Лебёдка'], ['mud', 'Раствор'], ['cams', 'Камеры'], ['log', 'Журнал']];

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function btn(text, c, v, cls, id) {
    var b = h('button', 'btn btn--small' + (cls ? ' ' + cls : ''), text);
    b.type = 'button'; b.setAttribute('data-c', c);
    if (v !== undefined) b.setAttribute('data-v', v);
    if (id) b.id = id;
    return b;
  }
  function row(label, kids, id) {
    var r = h('div', 'rg-row'), l = h('span', 'rg-row__l', label), box = h('span', 'rg-row__c');
    kids.forEach(function (k) { box.appendChild(k); });
    r.appendChild(l); r.appendChild(box);
    if (id) r.id = id;
    return r;
  }
  function val(id) { var s = h('b', 'rg-val'); s.id = id; return s; }
  function nums(list) {
    var dl = h('dl', 'rg-nums');
    list.forEach(function (n) { dl.appendChild(h('dt', '', n[0])); var dd = h('dd'); dd.id = n[1]; dl.appendChild(dd); });
    return dl;
  }
  function canvas(id, w, hh) { var cv = h('canvas', 'rg-dials'); cv.id = id; cv.width = w; cv.height = hh; cv.setAttribute('aria-hidden', 'true'); return cv; }
  // кнопка, которая действует, пока её держат (рукоятка лебёдки)
  function hold(text, v, id) {
    var b = h('button', 'btn rg-hold', text);
    b.type = 'button'; b.id = id;
    function down(ev) { ev.preventDefault(); if (cur) { S.cmd(cur, 'hoist', v); b.classList.add('is-on'); try { b.setPointerCapture(ev.pointerId); } catch (e) { /* необязательно */ } } }
    function up() { if (cur) S.cmd(cur, 'hoist', 0); b.classList.remove('is-on'); }
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    return b;
  }

  function build() {
    el = document.getElementById('rigpanel');
    hud = document.getElementById('righud');
    if (!el) return;
    built = true;
    var head = h('div', 'rg-top');
    var hr = h('div', 'rg-head');
    hr.appendChild(h('strong', 'rg-title', 'Пост бурильщика БУ-3000'));
    hr.appendChild(btn('Закрыть', 'close'));
    head.appendChild(hr);
    var stg = h('p', 'rg-stage'); stg.id = 'rg-stage'; head.appendChild(stg);
    var lab = h('p', 'rg-label'); lab.id = 'rg-label'; head.appendChild(lab);
    var al = h('p', 'rg-alarm'); al.id = 'rg-alarm'; al.hidden = true; al.setAttribute('role', 'alert'); head.appendChild(al);
    var tb = h('div', 'rg-tabs'); tb.setAttribute('role', 'tablist');
    TABS.forEach(function (t) { var b = btn(t[1], 'tab', undefined, 'rg-tab', 'rg-tab-' + t[0]); b.setAttribute('data-tab', t[0]); b.setAttribute('role', 'tab'); tb.appendChild(b); });
    head.appendChild(tb);
    el.appendChild(head);
    var body = h('div', 'rg-body'); body.id = 'rg-body'; el.appendChild(body);
    function pane(name) { var p = h('div', 'rg-pane'); p.id = 'rg-pane-' + name; p.setAttribute('role', 'tabpanel'); body.appendChild(p); return p; }

    // --- Бурение ---
    var p1 = pane('drill');
    p1.appendChild(canvas('rg-dials', 432, 150));
    p1.appendChild(nums([['Забой', 'rg-depth'], ['Долото', 'rg-bit'], ['Мех. скорость', 'rg-rop'], ['Порода', 'rg-form'], ['Износ долота', 'rg-wear'],
      ['Свечей за пальцем', 'rg-stands'], ['Труб на стеллаже', 'rg-rack'], ['Обсадная колонна', 'rg-cas'], ['Время на скважине', 'rg-time']]));
    var c1 = h('div', 'rg-ctl');
    c1.appendChild(row('Режим', [btn('', 'auto', undefined, '', 'rg-auto')]));
    c1.appendChild(row('Скорость времени', [1, 5, 20, 60].map(function (s) { return btn('×' + s, 'speed', s, '', 'rg-sp' + s); })));
    c1.appendChild(row('Операция', [btn('', 'next', undefined, 'btn--primary', 'rg-next'), btn('Стоп', 'stop')]));
    c1.appendChild(row('Инструмент', [btn('Поднять для смены долота', 'pullOut')]));
    c1.appendChild(row('Проектный забой, м', [1800, 2600, 3000].map(function (t) { return btn(String(t), 'td', t, '', 'rg-td' + t); }), 'rg-tdrow'));
    p1.appendChild(c1);

    // --- Лебёдка и приводы ---
    var p2 = pane('hoist');
    var hb = h('div', 'rg-hoist');
    hb.appendChild(hold('▲ Подъём', 1, 'rg-up')); hb.appendChild(hold('▼ Спуск · подача', -1, 'rg-down'));
    p2.appendChild(hb);
    p2.appendChild(h('p', 'rg-note', 'Держите кнопку: крюк идёт, пока она нажата. На забое «Спуск» добавляет нагрузку на долото.'));
    p2.appendChild(nums([['Крюк над полом', 'rg-hooky'], ['Вес на крюке', 'rg-hookw'], ['Нагрузка на долото', 'rg-wobv'], ['Долото / забой', 'rg-bitv'], ['Мех. скорость', 'rg-rop2'], ['Давление на стояке', 'rg-sppv']]));
    var c2 = h('div', 'rg-ctl');
    c2.appendChild(row('Подача долота', [btn('', 'feedAuto', undefined, '', 'rg-feed')]));
    c2.appendChild(row('Нагрузка на долото, тс', [btn('−', 'wob', -1), val('rg-wobset'), btn('+', 'wob', 1)]));
    c2.appendChild(row('Ротор', [btn('', 'rotary', undefined, '', 'rg-rot'), btn('−', 'rpm', -10), val('rg-rpmset'), btn('+', 'rpm', 10)]));
    c2.appendChild(row('Насосы', [btn('', 'pump', 0, '', 'rg-p0'), btn('', 'pump', 1, '', 'rg-p1')]));
    c2.appendChild(row('Ходы насосов, в минуту', [btn('−', 'spm', -3), val('rg-spmset'), btn('+', 'spm', 3)]));
    c2.appendChild(row('Противовыбросовое', [btn('', 'bop', undefined, '', 'rg-bop'), btn('Глушение', 'kill')]));
    c2.appendChild(row('Энергия', [btn('', 'power', undefined, '', 'rg-power'), btn('', 'des', undefined, '', 'rg-des')]));
    p2.appendChild(c2);

    // --- Раствор ---
    var p3 = pane('mud');
    p3.appendChild(canvas('rg-scheme', 432, 230));
    p3.appendChild(nums([['В скважину', 'rg-fin'], ['Возврат в ёмкости', 'rg-fout'], ['Уходит в амбар', 'rg-fpit'], ['Всего в ёмкостях', 'rg-mudv'], ['Плотность', 'rg-rho'], ['Шлам в растворе', 'rg-sol'], ['В амбаре', 'rg-pit']]));
    var c3 = h('div', 'rg-ctl');
    c3.appendChild(row('Вибросита', [btn('', 'sh', 0, '', 'rg-sh0'), btn('', 'sh', 1, '', 'rg-sh1')]));
    c3.appendChild(row('Очистка', [['dg', 'Дегазатор'], ['ds', 'Пескоотделитель'], ['dl', 'Илоотделитель'], ['cf', 'Центрифуга']].map(function (q) { var b = btn(q[1], 'eq', undefined, '', 'rg-eq-' + q[0]); b.setAttribute('data-k', q[0]); return b; })));
    var bag = btn('Перемешиватели', 'eq', undefined, '', 'rg-eq-ag'); bag.setAttribute('data-k', 'ag');
    c3.appendChild(row('Ёмкости', [bag]));
    c3.appendChild(row('Всас из ёмкости', [0, 1, 2].map(function (i) { return btn('№ ' + (i + 1), 'suc', i, '', 'rg-suc' + i); })));
    c3.appendChild(row('Перепуск', [btn('1 ↔ 2', 'eqz', 0, '', 'rg-eqz0'), btn('2 ↔ 3', 'eqz', 1, '', 'rg-eqz1')]));
    c3.appendChild(row('Плотность, г/см³', [btn('−', 'rho', -0.01), val('rg-rhoset'), btn('+', 'rho', 0.01), btn('Приготовить', 'mix')]));
    p3.appendChild(c3);

    // --- Камеры ---
    var p4 = pane('cams');
    var cams = h('div', 'rg-cams');
    CAMS.forEach(function (c, i) { cams.appendChild(btn(c[0], 'cam', i, '', 'rg-cam' + i)); });
    p4.appendChild(cams);
    p4.appendChild(h('p', 'rg-note', 'Камера показывает буровую, пока открыт пульт. «От себя» — вид глазами игрока.'));
    var foot = h('div', 'rg-row'); foot.id = 'rg-foot';
    foot.appendChild(h('span', 'rg-row__l', 'Творческий режим')); foot.appendChild(btn('Демонтировать буровую', 'dismantle', undefined, '', 'rg-dis'));
    p4.appendChild(foot);

    // --- Журнал ---
    var p5 = pane('log');
    var log = h('ol', 'rg-log'); log.id = 'rg-log'; p5.appendChild(log);

    el.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button[data-c]') : null;
      if (!b || !cur) return;
      var c = b.getAttribute('data-c'), v = b.getAttribute('data-v');
      if (c === 'close') { close(); return; }
      if (c === 'tab') { setTab(b.getAttribute('data-tab')); return; }
      if (c === 'cam') { camIdx = +v; refresh(); return; }
      if (c === 'dismantle') {                 // второе нажатие подтверждает
        if (b.getAttribute('data-sure')) { var gone = cur; b.removeAttribute('data-sure'); b.textContent = 'Демонтировать буровую'; close(); cur = null; KC.Props.remove(gone); }
        else { b.setAttribute('data-sure', '1'); b.textContent = 'Точно демонтировать? Нажмите ещё раз'; }
        return;
      }
      if (c === 'eq') v = b.getAttribute('data-k'); else if (v !== null) v = +v; else v = undefined;
      S.cmd(cur, c, v);
      refresh();
    });
    // прокрутка панели пальцем не должна уходить в игру
    ['touchstart', 'touchmove', 'wheel'].forEach(function (n) { el.addEventListener(n, function (ev) { ev.stopPropagation(); }, { passive: true }); });
    setTab(tab);
  }

  function setTab(name) {
    tab = name;
    TABS.forEach(function (t) {
      var p = document.getElementById('rg-pane-' + t[0]), b = document.getElementById('rg-tab-' + t[0]);
      if (p) p.hidden = t[0] !== name;
      if (b) { b.classList.toggle('is-on', t[0] === name); b.setAttribute('aria-selected', t[0] === name ? 'true' : 'false'); }
    });
    var body = document.getElementById('rg-body'); if (body) body.scrollTop = 0;
    refresh();
  }

  function fmtTime(sec) {
    var d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), mm = Math.floor((sec % 3600) / 60);
    return d + ' сут ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function set(id, text) { var e = document.getElementById(id); if (e && e.textContent !== text) e.textContent = text; }
  function on(id, flag) { var e = document.getElementById(id); if (e) e.classList.toggle('is-on', !!flag); }
  function onoff(id, name, flag, a, b) { set(id, name + ': ' + (flag ? a : b)); on(id, flag); }

  // стрелочный прибор
  function dial(g, cx, cy, r, v, max, title, unit, v2, max2) {
    var a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, i;
    g.fillStyle = '#14181a'; g.beginPath(); g.arc(cx, cy, r + 5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#5b675e'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r + 5, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#c4bda7'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r - 3, a0, a1); g.stroke();
    g.strokeStyle = '#e2694c'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r - 3, a0 + (a1 - a0) * 0.85, a1); g.stroke();
    g.fillStyle = '#c4bda7'; g.font = '9px sans-serif'; g.textAlign = 'center';
    for (i = 0; i <= 5; i++) {
      var a = a0 + (a1 - a0) * i / 5;
      g.strokeStyle = '#c4bda7'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 9), cy + Math.sin(a) * (r - 9)); g.lineTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3)); g.stroke();
      g.fillText(String(Math.round(max * i / 5)), cx + Math.cos(a) * (r - 18), cy + Math.sin(a) * (r - 18) + 3);
    }
    function needle(val2, mx, col, len) {
      var an = a0 + (a1 - a0) * Math.max(0, Math.min(1, val2 / mx));
      g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(an) * len, cy + Math.sin(an) * len); g.stroke();
    }
    if (v2 !== undefined) needle(v2, max2, '#7ec3f0', r * 0.55);
    needle(v, max, '#f0b545', r - 10);
    g.fillStyle = '#f3eee0'; g.beginPath(); g.arc(cx, cy, 3.5, 0, Math.PI * 2); g.fill();
    g.font = 'bold 12px sans-serif'; g.fillText(v.toFixed(v < 100 ? 1 : 0) + ' ' + unit, cx, cy + r * 0.62);
    g.font = '10px sans-serif'; g.fillStyle = '#c4bda7'; g.fillText(title, cx, cy + r + 20);
  }

  // Мнемосхема циркуляции: ёмкости → насосы → скважина → сита → ёмкости (или амбар)
  function scheme(g, I, st) {
    var W = 432, i, flowOn = I.fl.inn > 0.5, spill = I.fl.pit > 0.5, pumpsOn = I.flow > 0.5;
    var MUD = '#8a6a4a', LINE = '#5b675e', ACT = '#f0b545', BAD = '#e2694c', INK = '#f3eee0', DIM = '#c4bda7';
    g.clearRect(0, 0, W, 230);
    g.lineCap = 'round'; g.textAlign = 'center';
    function pipe(pts, active, col) {
      g.strokeStyle = active ? (col || ACT) : LINE; g.lineWidth = active ? 4 : 3; g.setLineDash(active ? [9, 7] : []);
      g.lineDashOffset = active && !reduce ? -clock * 26 : 0;
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (var k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
      g.stroke(); g.setLineDash([]);
    }
    function box(x, y, w, hh, title, sub, okk) {
      g.fillStyle = '#1e2420'; g.fillRect(x, y, w, hh);
      g.strokeStyle = okk === false ? BAD : okk ? ACT : LINE; g.lineWidth = 2; g.strokeRect(x, y, w, hh);
      g.fillStyle = INK; g.font = 'bold 11px sans-serif'; g.fillText(title, x + w / 2, y + (sub ? hh / 2 - 2 : hh / 2 + 4));
      if (sub) { g.fillStyle = DIM; g.font = '10px sans-serif'; g.fillText(sub, x + w / 2, y + hh / 2 + 11); }
    }
    function valve(x, y, open2) {
      g.fillStyle = open2 ? '#5fd17a' : BAD;
      g.beginPath(); g.moveTo(x - 6, y - 5); g.lineTo(x + 6, y + 5); g.lineTo(x + 6, y - 5); g.lineTo(x - 6, y + 5); g.closePath(); g.fill();
    }
    // трубы
    var tx = [170, 262, 354];
    pipe([[52, 172], [52, 70]], flowOn);                                                   // нагнетание в скважину
    pipe([[86, 44], [150, 44]], flowOn);                                                   // выкидная линия
    pipe([[212, 60], [212, 76], [tx[0], 76], [tx[0], 92]], flowOn && I.fl.out > 0.5);      // из-под сит в ёмкость 1
    pipe([[244, 44], [330, 44]], spill, BAD);                                              // мимо сит в амбар
    for (i = 0; i < 3; i++) pipe([[tx[i], 172], [tx[i], 204]], pumpsOn && st.suc[i] && st.tank[i] > 1.5);
    pipe([[tx[2], 204], [52, 204], [52, 196]], pumpsOn);                                   // всасывающий коллектор
    for (i = 0; i < 2; i++) pipe([[tx[i] + 36, 160], [tx[i + 1] - 36, 160]], st.eqz[i] && Math.abs(st.tank[i] - st.tank[i + 1]) > 0.3, MUD);
    // узлы
    box(18, 22, 68, 46, 'Скважина', I.depth.toFixed(0) + ' м', flowOn ? true : undefined);
    var nSh = (st.eq.sh[0] ? 1 : 0) + (st.eq.sh[1] ? 1 : 0);
    box(150, 28, 94, 32, 'Сита ' + nSh + ' из 2', I.fl.out.toFixed(0) + ' л/с', nSh === 0 && flowOn ? false : nSh ? true : undefined);
    box(330, 28, 92, 32, 'Амбар', I.pit.toFixed(0) + ' м³' + (spill ? ' +' + I.fl.pit.toFixed(0) + ' л/с' : ''), spill ? false : undefined);
    box(18, 172, 68, 24, 'Насосы', I.flow.toFixed(0) + ' л/с', I.noSuc ? false : pumpsOn ? true : undefined);
    for (i = 0; i < 3; i++) {
      var x = tx[i] - 36, lv = Math.max(0, Math.min(1, st.tank[i] / 40));
      g.fillStyle = '#1e2420'; g.fillRect(x, 92, 72, 80);
      g.fillStyle = MUD; g.fillRect(x, 92 + 80 * (1 - lv), 72, 80 * lv);
      g.strokeStyle = st.tank[i] > 39.5 ? BAD : LINE; g.lineWidth = 2; g.strokeRect(x, 92, 72, 80);
      g.fillStyle = INK; g.font = 'bold 11px sans-serif'; g.fillText('Ёмкость ' + (i + 1), tx[i], 108);
      g.font = '11px sans-serif'; g.fillText(st.tank[i].toFixed(1) + ' м³', tx[i], 124);
      valve(tx[i], 186, st.suc[i]);
      if (i < 2) valve((tx[i] + tx[i + 1]) / 2, 160, st.eqz[i]);
    }
    g.fillStyle = DIM; g.font = '10px sans-serif';
    g.fillText('всас', tx[2] + 28, 190); g.fillText('перепуск', (tx[0] + tx[1]) / 2, 148);
    if (I.gain > 0.05) { g.fillStyle = BAD; g.font = 'bold 11px sans-serif'; g.fillText('приток +' + I.gain.toFixed(1) + ' м³', 52, 86); }
    g.fillStyle = DIM; g.font = '10px sans-serif'; g.fillText('в скважину ' + I.fl.inn.toFixed(0) + ' л/с', 52, 14);
  }

  function refresh() {
    if (!cur || !built) return;
    var st = cur.st, I = S.info(cur), i, cv, g;
    set('rg-stage', 'Скважина ' + I.well + ' из ' + I.wells + ' · ' + I.stage);
    set('rg-label', (I.op ? I.op + ': ' : '') + I.label);
    var al = document.getElementById('rg-alarm'), at = I.alarm === 'kick' ? 'ГНВП! Приток в скважину: +' + I.gain.toFixed(1) + ' м³. Закройте превентор и глушите скважину'
      : I.noSuc ? 'Насосы не берут раствор: откройте всасывающую задвижку' : I.fl.pit > 0.5 ? 'Раствор уходит в амбар: ' + I.fl.pit.toFixed(0) + ' л/с. Включите вибросита'
        : I.alarm === 'mud' ? 'Мало раствора в ёмкостях — приготовьте новый объём' : '';
    al.hidden = !at; if (at) al.textContent = at;
    if (tab === 'drill') {
      set('rg-depth', I.depth.toFixed(1) + ' м из ' + I.td);
      set('rg-bit', I.bit > 0 ? I.bit.toFixed(1) + ' м' : 'на поверхности');
      set('rg-rop', I.rop.toFixed(1) + ' м/ч');
      set('rg-form', I.form);
      set('rg-wear', Math.min(100, Math.round(I.wear * 100)) + ' % · долото № ' + I.bitNo);
      set('rg-stands', String(I.stands)); set('rg-rack', String(I.rack));
      set('rg-cas', I.cas > 0 ? I.cas.toFixed(0) + ' м спущено' : '—');
      set('rg-time', fmtTime(Math.max(0, I.days * 86400)));
      set('rg-auto', st.auto ? 'Автомат: мастер ведёт работы' : 'Ручной: операции по команде'); on('rg-auto', st.auto);
      [1, 5, 20, 60].forEach(function (s) { on('rg-sp' + s, st.speed === s); });
      var nx = document.getElementById('rg-next');
      nx.textContent = st.auto ? 'Идёт автоматически' : (I.next ? 'Выполнить: ' + I.next : (st.q.length ? 'Идёт: ' + (I.op || 'операция') : 'Нет операции'));
      nx.disabled = st.auto || !I.next;
      document.getElementById('rg-tdrow').hidden = !(st.stage === 0 && st.hole <= 31);
      [1800, 2600, 3000].forEach(function (t) { on('rg-td' + t, st.td === t); });
      cv = document.getElementById('rg-dials'); g = cv.getContext && cv.getContext('2d');
      if (g) {
        g.clearRect(0, 0, cv.width, cv.height);
        dial(g, 72, 62, 52, I.hook, 200, 'Вес на крюке (ГИВ) · нагрузка', 'тс', I.wob, 40);
        dial(g, 216, 62, 52, I.spp, 300, 'Давление на стояке', 'атм');
        dial(g, 360, 62, 52, I.rpm, 150, 'Ротор · момент ' + I.torque.toFixed(1) + ' кН·м', 'об/мин');
      }
    } else if (tab === 'hoist') {
      set('rg-hooky', I.hookY.toFixed(1) + ' м'); set('rg-hookw', I.hook.toFixed(1) + ' тс'); set('rg-wobv', I.wob.toFixed(1) + ' тс');
      set('rg-bitv', (I.bit > 0 ? I.bit.toFixed(1) : '0') + ' / ' + I.depth.toFixed(1) + ' м'); set('rg-rop2', I.rop.toFixed(1) + ' м/ч'); set('rg-sppv', I.spp.toFixed(0) + ' атм');
      set('rg-feed', st.feedAuto ? 'Регулятор подачи: держит нагрузку' : 'Вручную: подача кнопкой «Спуск»'); on('rg-feed', st.feedAuto);
      set('rg-wobset', String(st.wobSet)); set('rg-rpmset', String(st.rpmSet)); set('rg-spmset', String(st.spm));
      onoff('rg-rot', 'Ротор', st.rotary, 'включён', 'выключен');
      onoff('rg-p0', 'Насос 1', st.pumps[0], 'работает', 'стоит'); onoff('rg-p1', 'Насос 2', st.pumps[1], 'работает', 'стоит');
      set('rg-bop', st.bop < 2 ? 'ПВО не смонтировано' : st.bopClosed ? 'Превентор закрыт — открыть' : 'Превентор открыт — закрыть'); on('rg-bop', st.bopClosed);
      onoff('rg-power', 'Ввод 6 кВ', st.power, 'включён', 'отключён'); onoff('rg-des', 'ДЭС', st.des, 'работает', 'стоит');
      var busy = st.q.length > 0;
      document.getElementById('rg-up').disabled = busy; document.getElementById('rg-down').disabled = busy;
    } else if (tab === 'mud') {
      set('rg-fin', I.fl.inn.toFixed(1) + ' л/с'); set('rg-fout', I.fl.out.toFixed(1) + ' л/с'); set('rg-fpit', I.fl.pit.toFixed(1) + ' л/с');
      set('rg-mudv', I.mudV.toFixed(1) + ' м³' + (I.gain > 0.05 ? ' (приток +' + I.gain.toFixed(1) + ')' : ''));
      set('rg-rho', I.mudRho.toFixed(2) + ' г/см³ · по ГТН ' + I.gtn.toFixed(2));
      set('rg-sol', Math.round(I.solids * 100) + ' %'); set('rg-pit', I.pit.toFixed(0) + ' м³');
      onoff('rg-sh0', 'Сито 1', st.eq.sh[0], 'работает', 'стоит'); onoff('rg-sh1', 'Сито 2', st.eq.sh[1], 'работает', 'стоит');
      ['dg', 'ds', 'dl', 'cf', 'ag'].forEach(function (k) { on('rg-eq-' + k, st.eq[k]); });
      for (i = 0; i < 3; i++) on('rg-suc' + i, st.suc[i]);
      on('rg-eqz0', st.eqz[0]); on('rg-eqz1', st.eqz[1]);
      set('rg-rhoset', (st.rhoSet || st.mudRho).toFixed(2));
      cv = document.getElementById('rg-scheme'); g = cv.getContext && cv.getContext('2d');
      if (g) scheme(g, I, st);
    } else if (tab === 'cams') {
      for (i = 0; i < CAMS.length; i++) on('rg-cam' + i, camIdx === i);
    } else if (tab === 'log') {
      var lg = document.getElementById('rg-log'), items = st.log.slice(-24).reverse(), sig = items.length + ':' + (items[0] ? items[0][0] + items[0][1] : '');
      if (lg.getAttribute('data-sig') !== sig) {
        lg.setAttribute('data-sig', sig);
        while (lg.firstChild) lg.removeChild(lg.firstChild);
        items.forEach(function (it) { lg.appendChild(h('li', '', fmtTime(it[0]) + ' — ' + it[1])); });
        if (!items.length) lg.appendChild(h('li', '', 'Записей пока нет'));
      }
    }
  }

  function open(p) {
    if (!built) build();
    if (!el) return;
    cur = p;
    if (UI.host && UI.host.enter) UI.host.enter();
    shown = true;
    var ft = document.getElementById('rg-foot'), pl = UI.host && UI.host.creative ? UI.host.creative() : false;
    if (ft) ft.hidden = !pl;
    var bd = document.getElementById('rg-dis'); if (bd) { bd.removeAttribute('data-sure'); bd.textContent = 'Демонтировать буровую'; }
    refresh();
  }
  function close() { if (cur) S.cmd(cur, 'hoist', 0); shown = false; if (UI.host && UI.host.leave) UI.host.leave(); }

  // камера наблюдения: null — обычный вид от игрока
  function cam() {
    if (!cur || !shown) return null;
    var c = CAMS[camIdx], st = cur.st, RX = st.slot * L.STEP, from = c[1], to = c[2];
    if (!from) return null;
    if (from === 'hook') { var hy = F + st.hookY; from = [-7.5, Math.max(F + 3, hy + 1.5), -9]; to = [0, hy + 0.5, 0]; }
    var a = KC.Props.world(cur, RX + from[0], from[1], from[2]), b = KC.Props.world(cur, RX + to[0], to[1], to[2]);
    var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz) || 1;
    return { x: a[0], y: a[1], z: a[2], yaw: Math.atan2(-dx, -dz), pitch: Math.asin(dy / l) };
  }

  // вызывается каждый кадр из игры
  function tick(dt, state, e) {
    if (!built) build();
    clock += dt;
    if (shown && state === 'rig') { acc += dt; if (acc > 0.14) { acc = 0; refresh(); } }
    if (!hud) return;
    hudAcc += dt;
    if (hudAcc < 0.5) return;
    hudAcc = 0;
    var p = KC.Props.find('bu3000'), show = false;
    if (p && state === 'playing' && e) {
      var w = KC.Props.world(p, p.st.slot * L.STEP + 30, 0, 0);
      if (Math.hypot(e.x - w[0], e.z - w[2]) < 150) {
        var I = S.info(p);
        show = true;
        hud.textContent = 'БУ-3000 · скв. ' + I.well + ' · забой ' + I.depth.toFixed(0) + ' м · ' + (I.op ? I.op + ': ' : '') + I.label + (I.rop > 0.5 ? ' · ' + I.rop.toFixed(0) + ' м/ч' : '');
        hud.classList.toggle('is-alarm', !!I.alarm || I.fl.pit > 0.5 || I.noSuc);
      }
    }
    hud.hidden = !show;
  }

  var UI = { open: open, close: close, cam: cam, tick: tick, host: null, setTab: setTab, get shown() { return shown; } };
  KC.RigUI = UI;
})();
