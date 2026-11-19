/* Кубокрафт — пост бурильщика: панель с приборами (ГИВ, манометр, тахометр ротора), параметрами
   бурения и раствора, органами управления и камерами наблюдения за буровой. Плюс строка состояния
   буровой на экране во время игры. */
(function () {
  'use strict';
  var KC = window.KC, S = KC.RigSim, D = KC.RigDims, L = KC.RigLayout, F = D.FLOOR;
  var el = null, hud = null, cur = null, built = false, camIdx = 0, acc = 0, hudAcc = 0, shown = false;

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
    ['Ёмкости', [31, 9.4, -9.6], [31, 4, 0]],
    ['Насосы', [48, 3.6, -9.4], [48, 2.3, -1]],
    ['Мостки', [11, 5.5, -30], [0, 3.5, -14]],
    ['Общий вид', [-44, 30, -54], [18, 17, 0]]
  ];

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function btn(text, c, v, cls) {
    var b = h('button', 'btn btn--small' + (cls ? ' ' + cls : ''), text);
    b.type = 'button'; b.setAttribute('data-c', c);
    if (v !== undefined) b.setAttribute('data-v', v);
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

  function build() {
    el = document.getElementById('rigpanel');
    hud = document.getElementById('righud');
    if (!el) return;
    built = true;
    var head = h('div', 'rg-head');
    head.appendChild(h('strong', 'rg-title', 'БУ-3000 ЭУК-1М · пост бурильщика'));
    head.appendChild(btn('Закрыть · E', 'close'));
    el.appendChild(head);
    var stg = h('p', 'rg-stage'); stg.id = 'rg-stage'; el.appendChild(stg);
    var lab = h('p', 'rg-label'); lab.id = 'rg-label'; el.appendChild(lab);
    var al = h('p', 'rg-alarm'); al.id = 'rg-alarm'; al.hidden = true; al.setAttribute('role', 'alert'); el.appendChild(al);
    var cv = h('canvas', 'rg-dials'); cv.id = 'rg-dials'; cv.width = 432; cv.height = 150; cv.setAttribute('aria-hidden', 'true'); el.appendChild(cv);

    var nums = h('dl', 'rg-nums');
    [['Забой', 'rg-depth'], ['Долото', 'rg-bit'], ['Мех. скорость', 'rg-rop'], ['Порода', 'rg-form'], ['Раствор в ёмкостях', 'rg-mudv'], ['Плотность', 'rg-rho'],
      ['Расход', 'rg-flow'], ['Износ долота', 'rg-wear'], ['Свечей за пальцем', 'rg-stands'], ['Труб на стеллаже', 'rg-rack'], ['Обсадная колонна', 'rg-cas'], ['Время на скважине', 'rg-time']
    ].forEach(function (n) { nums.appendChild(h('dt', '', n[0])); var dd = h('dd'); dd.id = n[1]; nums.appendChild(dd); });
    el.appendChild(nums);

    var ctl = h('div', 'rg-ctl');
    var bAuto = btn('', 'auto'); bAuto.id = 'rg-auto';
    ctl.appendChild(row('Режим', [bAuto]));
    ctl.appendChild(row('Скорость времени', [1, 5, 20, 60].map(function (s) { var b = btn('×' + s, 'speed', s); b.id = 'rg-sp' + s; return b; })));
    var bNext = btn('', 'next', undefined, 'btn--primary'); bNext.id = 'rg-next';
    ctl.appendChild(row('Операция', [bNext, btn('Стоп', 'stop')]));
    ctl.appendChild(row('Нагрузка на долото, тс', [btn('−', 'wob', -1), val('rg-wobset'), btn('+', 'wob', 1)]));
    ctl.appendChild(row('Обороты ротора, об/мин', [btn('−', 'rpm', -10), val('rg-rpmset'), btn('+', 'rpm', 10)]));
    ctl.appendChild(row('Ходы насосов, в минуту', [btn('−', 'spm', -3), val('rg-spmset'), btn('+', 'spm', 3)]));
    var bP0 = btn('', 'pump', 0), bP1 = btn('', 'pump', 1), bRot = btn('', 'rotary');
    bP0.id = 'rg-p0'; bP1.id = 'rg-p1'; bRot.id = 'rg-rot';
    ctl.appendChild(row('Приводы', [bP0, bP1, bRot]));
    ctl.appendChild(row('Плотность раствора, г/см³', [btn('−', 'rho', -0.01), val('rg-rhoset'), btn('+', 'rho', 0.01), btn('Приготовить', 'mix')]));
    var bBop = btn('', 'bop'); bBop.id = 'rg-bop';
    ctl.appendChild(row('Противовыбросовое', [bBop, btn('Глушение', 'kill')]));
    ctl.appendChild(row('Инструмент', [btn('Поднять для смены долота', 'pullOut')]));
    var bPw = btn('', 'power'), bDes = btn('', 'des'); bPw.id = 'rg-power'; bDes.id = 'rg-des';
    ctl.appendChild(row('Энергия', [bPw, bDes]));
    ctl.appendChild(row('Проектный забой, м', [1800, 2600, 3000].map(function (t) { var b = btn(String(t), 'td', t); b.id = 'rg-td' + t; return b; }), 'rg-tdrow'));
    el.appendChild(ctl);

    var cams = h('div', 'rg-cams');
    cams.appendChild(h('span', 'rg-row__l', 'Камеры'));
    CAMS.forEach(function (c, i) { var b = btn(c[0], 'cam', i); b.id = 'rg-cam' + i; cams.appendChild(b); });
    el.appendChild(cams);
    var log = h('ol', 'rg-log'); log.id = 'rg-log'; el.appendChild(log);

    el.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button[data-c]') : null;
      if (!b || !cur) return;
      var c = b.getAttribute('data-c'), v = b.getAttribute('data-v');
      if (c === 'close') { close(); return; }
      if (c === 'cam') { camIdx = +v; refresh(); return; }
      S.cmd(cur, c, v === null ? undefined : +v);
      refresh();
    });
  }

  function fmtTime(sec) {
    var d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), mm = Math.floor((sec % 3600) / 60);
    return d + ' сут ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function set(id, text) { var e = document.getElementById(id); if (e && e.textContent !== text) e.textContent = text; }
  function on(id, flag) { var e = document.getElementById(id); if (e) e.classList.toggle('is-on', !!flag); }

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
    function needle(val, mx, col, len) {
      var an = a0 + (a1 - a0) * Math.max(0, Math.min(1, val / mx));
      g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(an) * len, cy + Math.sin(an) * len); g.stroke();
    }
    if (v2 !== undefined) needle(v2, max2, '#7ec3f0', r * 0.55);
    needle(v, max, '#f0b545', r - 10);
    g.fillStyle = '#f3eee0'; g.beginPath(); g.arc(cx, cy, 3.5, 0, Math.PI * 2); g.fill();
    g.font = 'bold 12px sans-serif'; g.fillText(v.toFixed(v < 100 ? 1 : 0) + ' ' + unit, cx, cy + r * 0.62);
    g.font = '10px sans-serif'; g.fillStyle = '#c4bda7'; g.fillText(title, cx, cy + r + 20);
  }

  function refresh() {
    if (!cur || !built) return;
    var st = cur.st, I = S.info(cur), i;
    set('rg-stage', 'Скважина ' + I.well + ' из ' + I.wells + ' · ' + I.stage);
    set('rg-label', (I.op ? I.op + ': ' : '') + I.label);
    var al = document.getElementById('rg-alarm'), at = I.alarm === 'kick' ? 'ГНВП! Приток в скважину: +' + I.gain.toFixed(1) + ' м³. Закройте превентор и глушите скважину'
      : I.alarm === 'mud' ? 'Мало раствора в ёмкостях — приготовьте новый объём' : '';
    al.hidden = !at; if (at) al.textContent = at;
    set('rg-depth', I.depth.toFixed(1) + ' м из ' + I.td);
    set('rg-bit', I.bit > 0 ? I.bit.toFixed(1) + ' м' : 'на поверхности');
    set('rg-rop', I.rop.toFixed(1) + ' м/ч');
    set('rg-form', I.form);
    set('rg-mudv', I.mudV.toFixed(1) + ' м³' + (I.gain > 0.05 ? ' (+' + I.gain.toFixed(1) + ')' : ''));
    set('rg-rho', I.mudRho.toFixed(2) + ' г/см³ · по ГТН ' + I.gtn.toFixed(2));
    set('rg-flow', I.flow.toFixed(1) + ' л/с');
    set('rg-wear', Math.min(100, Math.round(I.wear * 100)) + ' % · долото № ' + I.bitNo);
    set('rg-stands', String(I.stands));
    set('rg-rack', String(I.rack));
    set('rg-cas', I.cas > 0 ? I.cas.toFixed(0) + ' м спущено' : '—');
    set('rg-time', fmtTime(Math.max(0, I.days * 86400)));
    set('rg-auto', st.auto ? 'Автомат: мастер ведёт работы' : 'Ручной: операции по команде');
    on('rg-auto', st.auto);
    [1, 5, 20, 60].forEach(function (s) { on('rg-sp' + s, st.speed === s); });
    var nx = document.getElementById('rg-next');
    nx.textContent = st.auto ? 'Идёт автоматически' : (I.next ? 'Выполнить: ' + I.next : (st.q.length ? 'Идёт: ' + (I.op || 'операция') : 'Нет операции'));
    nx.disabled = st.auto || !I.next;
    set('rg-wobset', String(st.wobSet)); set('rg-rpmset', String(st.rpmSet)); set('rg-spmset', String(st.spm));
    set('rg-rhoset', (st.rhoSet || st.mudRho).toFixed(2));
    set('rg-p0', 'Насос 1: ' + (st.pumps[0] ? 'работает' : 'стоит')); on('rg-p0', st.pumps[0]);
    set('rg-p1', 'Насос 2: ' + (st.pumps[1] ? 'работает' : 'стоит')); on('rg-p1', st.pumps[1]);
    set('rg-rot', 'Ротор: ' + (st.rotary ? 'включён' : 'выключен')); on('rg-rot', st.rotary);
    set('rg-bop', st.bop < 2 ? 'ПВО не смонтировано' : st.bopClosed ? 'Превентор закрыт — открыть' : 'Превентор открыт — закрыть'); on('rg-bop', st.bopClosed);
    set('rg-power', 'Ввод 6 кВ: ' + (st.power ? 'включён' : 'отключён')); on('rg-power', st.power);
    set('rg-des', 'ДЭС: ' + (st.des ? 'работает' : 'стоит')); on('rg-des', st.des);
    document.getElementById('rg-tdrow').hidden = !(st.stage === 0 && st.hole <= 31);
    [1800, 2600, 3000].forEach(function (t) { on('rg-td' + t, st.td === t); });
    for (i = 0; i < CAMS.length; i++) on('rg-cam' + i, camIdx === i);
    var lg = document.getElementById('rg-log'), items = st.log.slice(-7).reverse(), sig = items.length + ':' + (items[0] ? items[0][0] + items[0][1] : '');
    if (lg.getAttribute('data-sig') !== sig) {
      lg.setAttribute('data-sig', sig);
      while (lg.firstChild) lg.removeChild(lg.firstChild);
      items.forEach(function (it) { lg.appendChild(h('li', '', fmtTime(it[0]) + ' — ' + it[1])); });
    }
    var cv = document.getElementById('rg-dials'), g = cv.getContext && cv.getContext('2d');
    if (g) {
      g.clearRect(0, 0, cv.width, cv.height);
      dial(g, 72, 62, 52, I.hook, 200, 'Вес на крюке (ГИВ) · нагрузка', 'тс', I.wob, 40);
      dial(g, 216, 62, 52, I.spp, 300, 'Давление на стояке', 'атм');
      dial(g, 360, 62, 52, I.rpm, 150, 'Ротор · момент ' + I.torque.toFixed(1) + ' кН·м', 'об/мин');
    }
  }

  function open(p) {
    if (!built) build();
    if (!el) return;
    cur = p;
    if (UI.host && UI.host.enter) UI.host.enter();
    shown = true;
    refresh();
  }
  function close() { shown = false; if (UI.host && UI.host.leave) UI.host.leave(); }

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
    if (shown && state === 'rig') { acc += dt; if (acc > 0.16) { acc = 0; refresh(); } }
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
        hud.classList.toggle('is-alarm', !!I.alarm);
      }
    }
    hud.hidden = !show;
  }

  var UI = { open: open, close: close, cam: cam, tick: tick, host: null, get shown() { return shown; } };
  KC.RigUI = UI;
})();
