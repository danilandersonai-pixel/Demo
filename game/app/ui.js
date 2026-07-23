/* «Пепел Литаний» — весь интерфейс: экраны, поле боя, тач-обработка,
   предпросмотр вероятностей, поднос кубов, проигрывание хода ИИ. */
'use strict';
var UI = (function () {
  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var AI_DELAY = reduceMotion ? 30 : 380;

  var sel = null;          // uid выбранного юнита
  var runMode = false;     // режим «Бег»
  var orderMode = null;    // {heroUid, orderId}
  var miracleMode = null;  // id чуда, ждущего цель
  var busy = false;        // идёт ход ИИ / анимация

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function bat() { return CAMPAIGN.getBattle(); }
  function st() { return CAMPAIGN.getState(); }
  function byUid(uid) {
    var b = bat();
    if (!b) return null;
    for (var i = 0; i < b.units.length; i++) if (b.units[i].uid === uid) return b.units[i];
    return null;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ================= ЭКРАНЫ ================= */
  function show(id) {
    var scr = document.querySelectorAll('.screen');
    for (var i = 0; i < scr.length; i++) scr[i].classList.toggle('active', scr[i].id === id);
    document.body.dataset.screen = id;
    window.scrollTo(0, 0);
  }

  /* ---------- модалки ---------- */
  function openModal(content, opts) {
    opts = opts || {};
    var m = $('modal');
    var body = $('modal-body');
    body.innerHTML = '';
    if (typeof content === 'string') body.innerHTML = content;
    else body.appendChild(content);
    m.classList.add('open');
    m.dataset.noclose = opts.noClose ? '1' : '';
  }
  function closeModal() {
    $('modal').classList.remove('open');
  }

  function toast(msg, cls) {
    var box = $('toasts');
    var t = el('div', 'toast ' + (cls || ''), msg);
    box.appendChild(t);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(function () { t.classList.add('fade'); }, reduceMotion ? 1600 : 2300);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, reduceMotion ? 1900 : 2900);
  }

  /* ================= ТИТУЛ ================= */
  function renderTitle() {
    $('btn-continue').style.display = CAMPAIGN.hasSave() ? '' : 'none';
    show('s-title');
  }

  function showRules() {
    var w = el('div', 'rules');
    w.appendChild(el('h3', null, 'Канон боя'));
    DATA.TEXTS.rulesHelp.forEach(function (r) {
      var p = el('p');
      var b = el('b', null, r[0] + '. ');
      p.appendChild(b);
      p.appendChild(document.createTextNode(r[1]));
      w.appendChild(p);
    });
    var btn = el('button', 'btn wide', 'Понятно');
    btn.onclick = closeModal;
    w.appendChild(btn);
    openModal(w);
  }

  /* ================= КАМПАНИЯ: СТРАТЕГИЧЕСКАЯ КАРТА ================= */
  var selProv = null;   // выбранная провинция на карте
  var briefProv = null; // провинция, для которой открыт брифинг

  function provStatus(pid) {
    var s = st();
    if (s.pendingDefense === pid) return 'defense';
    if (s.provinces[pid] === 'player') return 'own';
    if (!s.pendingDefense && CAMPAIGN.isFrontier(pid)) return 'frontier';
    return 'far';
  }

  function renderStratMap() {
    var s = st();
    var box = $('strat-map');
    var R = 34;
    var html = '<svg id="planet-svg" viewBox="0 0 360 420" role="img" aria-label="Карта Веспер-Примы">';
    html += '<ellipse cx="180" cy="210" rx="176" ry="206" class="planet-disc"/>';
    /* дороги между соседями (каждое ребро один раз) */
    var seen = {};
    DATA.PROV_ORDER.forEach(function (pid) {
      var p = DATA.PROVINCES[pid];
      p.neighbors.forEach(function (n) {
        var key = pid < n ? pid + '|' + n : n + '|' + pid;
        if (seen[key]) return;
        seen[key] = 1;
        var q = DATA.PROVINCES[n];
        var cls = (s.provinces[pid] === 'player' && s.provinces[n] === 'player') ? ' own' : '';
        html += '<line class="prov-edge' + cls + '" x1="' + p.mx + '" y1="' + p.my +
          '" x2="' + q.mx + '" y2="' + q.my + '"/>';
      });
    });
    DATA.PROV_ORDER.forEach(function (pid) {
      var p = DATA.PROVINCES[pid];
      var stt = provStatus(pid);
      var cls = 'prov prov-' + stt + (p.capital ? ' prov-capital' : '') +
        (selProv === pid ? ' prov-sel' : '');
      var icon = s.provinces[pid] === 'player' ? '#i-candle'
        : (p.capital ? '#i-pervogolos' : '#i-oskolki');
      html += '<g class="' + cls + '" data-prov="' + pid + '" role="button" tabindex="0"' +
        ' aria-label="' + p.name + '">' +
        '<circle cx="' + p.mx + '" cy="' + p.my + '" r="' + R + '"/>' +
        '<use href="' + icon + '" x="' + (p.mx - 11) + '" y="' + (p.my - 16) + '" width="22" height="22"/>' +
        '<text class="prov-name" x="' + p.mx + '" y="' + (p.my + 18) + '">' + p.short + '</text>' +
        (s.provinces[pid] === 'player' && p.income
          ? '<text class="prov-inc" x="' + p.mx + '" y="' + (p.my + 29) + '">+' + p.income + '</text>'
          : '') +
        (stt === 'frontier' ? '<text class="prov-mark" x="' + p.mx + '" y="' + (p.my - 20) + '">⚔</text>' : '') +
        (stt === 'defense' ? '<text class="prov-mark def" x="' + p.mx + '" y="' + (p.my - 20) + '">⚠</text>' : '') +
        '</g>';
    });
    html += '</svg>';
    box.innerHTML = html;
    box.querySelectorAll('.prov').forEach(function (g) {
      var pick = function () { selProv = g.dataset.prov; renderCampaign(); };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
    });
  }

  function renderProvPanel() {
    var s = st();
    var panel = $('prov-panel');
    panel.innerHTML = '';
    if (!selProv) {
      panel.appendChild(el('p', 'panel-hint',
        s.pendingDefense
          ? 'Хор контратакует! Тап по провинции под знаком ⚠ — к обороне.'
          : 'Тап по провинции со знаком ⚔ — атаковать через соседнюю границу.'));
      return;
    }
    var p = DATA.PROVINCES[selProv];
    var stt = provStatus(selProv);
    var card = el('div', 'prov-card ' + (s.provinces[selProv] === 'player' ? 'u-candle' : 'u-chorus'));
    card.appendChild(el('div', 'prov-title', p.name +
      (s.provinces[selProv] === 'player' ? ' · под Свечой' : ' · под Хором')));
    card.appendChild(el('div', 'prov-sub', p.terrain + ' · доход ' + p.income + ' р./ход'));
    card.appendChild(el('p', 'prov-blurb', p.blurb));
    if (p.unlock && !s.flags[p.unlock.flag] && s.provinces[selProv] !== 'player') {
      card.appendChild(el('div', 'prov-unlock', '✦ ' + p.unlock.text));
    }
    if (stt === 'defense') {
      card.appendChild(el('div', 'prov-warn', '⚠ Хор контратакует эту провинцию. Оборона обязательна.'));
      var bd = el('button', 'btn wide grim-btn', '⚔ К обороне');
      bd.onclick = function () { renderBrief(selProv); };
      card.appendChild(bd);
    } else if (stt === 'frontier') {
      if (p.mission && p.mission.tagline) {
        card.appendChild(el('div', 'prov-sub', 'Задача: ' + p.mission.tagline));
      }
      var ba = el('button', 'btn wide primary', '⚔ Атаковать провинцию');
      ba.onclick = function () { renderBrief(selProv); };
      card.appendChild(ba);
    } else if (s.provinces[selProv] === 'player') {
      card.appendChild(el('div', 'prov-sub dim', 'Провинция удержана. Гарнизон читает литании.'));
    } else {
      card.appendChild(el('div', 'prov-sub dim', 'Нет общей границы — сначала пробейте путь.'));
    }
    panel.appendChild(card);
  }

  function renderCampaign() {
    var s = st();
    var alert = $('strat-alert');
    alert.innerHTML = '';
    if (s.pendingDefense) {
      alert.appendChild(el('div', 'strat-alert-line',
        '⚠ Контратака Хора: ' + DATA.PROVINCES[s.pendingDefense].name +
        '. Пока не отбита — наступление невозможно.'));
      if (provStatus(selProv) !== 'defense') selProv = s.pendingDefense;
    }
    renderStratMap();
    renderProvPanel();
    var alive = 0;
    s.roster.forEach(function (sq) { alive += sq.models; });
    $('camp-info').textContent = 'Ход ' + s.turn + ' · Реквизиция: ' + s.req +
      ' (+' + CAMPAIGN.income() + '/ход) · Штыков: ' + alive + ' · Павших: ' + s.fallen.length;
    show('s-campaign');
  }

  function renderChronicle(backTo) {
    var s = st();
    var body = $('chronicle-body');
    body.innerHTML = '';
    body.appendChild(el('h2', 'scr-title', 'Летопись похода'));
    if (!s.chronicle.length) body.appendChild(el('p', 'dim', 'Летопись пуста.'));
    s.chronicle.forEach(function (c) {
      body.appendChild(el('p', 'chron-line', '✦ ' + c.text));
    });
    if (s.fallen.length) {
      body.appendChild(el('h3', null, 'Поминальный список (' + s.fallen.length + ')'));
      var lst = el('div', 'fallen-list');
      s.fallen.forEach(function (f) {
        lst.appendChild(el('div', 'fallen-row', f.name + ' — ' + f.squad + ' · ' + f.mission));
      });
      body.appendChild(lst);
    }
    var back = el('button', 'btn wide', 'Назад');
    back.onclick = backTo || renderCampaign;
    body.appendChild(back);
    show('s-chronicle');
  }

  /* ================= БРИФИНГ + РЕКВИЗИЦИЯ ================= */
  function briefMission() {
    return CAMPAIGN.missionFor(briefProv);
  }
  function missionNeedsMissing(m) {
    /* эскорт без Свеченосца невозможен — брифинг предупредит и не выпустит */
    if (m.win && m.win.type === 'escort') {
      var s = st();
      var has = s.roster.some(function (sq) { return sq.type === m.win.unit && sq.models > 0; });
      if (!has) return 'Для эскорта нужен Свеченосец в полку (см. «Пополнение полка»).';
    }
    return null;
  }
  function renderBrief(provId) {
    briefProv = provId;
    var s = st();
    var p = DATA.PROVINCES[provId];
    var m = briefMission();
    var head = $('brief-head');
    head.innerHTML = '';
    head.appendChild(el('div', 'brief-kicker',
      (m.defense ? 'Оборона · ' : 'Стратегический ход ' + s.turn + ' · ') + p.name));
    head.appendChild(el('h2', 'scr-title', m.name));
    head.appendChild(el('p', 'brief-intro', m.intro));
    var rules = el('div', 'brief-rules');
    rules.appendChild(el('h3', null, 'Условия'));
    m.rules.forEach(function (r) { rules.appendChild(el('p', 'rule-line', '✧ ' + r)); });
    head.appendChild(rules);

    renderReqPanel();
    renderHeroPanel();
    var missing = missionNeedsMissing(m);
    var launch = $('btn-launch');
    launch.disabled = !!missing;
    var warn = $('brief-warn');
    warn.textContent = missing || '';
    warn.style.display = missing ? '' : 'none';
    show('s-brief');
  }

  function renderReqPanel() {
    var s = st();
    var panel = $('req-panel');
    panel.innerHTML = '';
    panel.appendChild(el('h3', null, 'Реквизиция: ' + s.req + ' очков'));
    var list = el('div', 'roster-list');
    s.roster.forEach(function (sq) {
      var t = DATA.UNITS[sq.type];
      var row = el('div', 'roster-row');
      var info = el('div', 'roster-info');
      info.appendChild(el('div', 'roster-name',
        sq.squadName + (sq.veteran ? ' ★' : '') + ' — ' + t.name));
      var maxM = t.models;
      info.appendChild(el('div', 'roster-sub', 'Бойцов: ' + sq.models + '/' + maxM +
        (sq.veteran ? ' · ветераны (+1 Лд)' : ' · зелёные')));
      row.appendChild(info);
      if (t.wpm === 1 && sq.models < maxM) {
        var cost = DATA.modelCost(sq.type);
        var btn = el('button', 'btn small', '+1 боец · ' + cost + ' р.');
        btn.disabled = s.req < cost;
        btn.onclick = function () {
          if (CAMPAIGN.replenishOne(sq.id)) { renderReqPanel(); }
        };
        row.appendChild(btn);
      }
      list.appendChild(row);
    });
    panel.appendChild(list);

    panel.appendChild(el('h3', null, 'Пополнение полка'));
    var buy = el('div', 'buy-list');
    CAMPAIGN.buyable().forEach(function (tid) {
      var t = DATA.UNITS[tid];
      if ((tid === 'svech' || t.unique) && CAMPAIGN.countType(tid) >= 1) return;
      if (t.arty && CAMPAIGN.countType(tid) >= 2) return;
      var btn = el('button', 'btn small' + (t.vehicle ? ' gold' : ''),
        t.name + ' · ' + t.cost + ' р.');
      btn.disabled = !CAMPAIGN.canBuy(tid);
      btn.onclick = function () {
        if (CAMPAIGN.buySquad(tid)) { renderReqPanel(); toast(t.name + ' — в строю.', 'gold'); }
      };
      buy.appendChild(btn);
    });
    panel.appendChild(buy);
    var locked = DATA.UNLOCKABLE.filter(function (u) { return !s.flags[u.flag]; });
    if (locked.length) {
      panel.appendChild(el('p', 'dim', 'Техника в трофеях провинций: ' + locked.map(function (u) {
        return DATA.UNITS[u.unit].name;
      }).join(', ') + ' — захватите Карьеры, Голгофан и «Север».'));
    }
    if (s.roster.length >= DATA.ROSTER_CAP) {
      panel.appendChild(el('p', 'dim', 'Полк полон (' + DATA.ROSTER_CAP + ' подразделений).'));
    }
  }

  function renderHeroPanel() {
    var s = st();
    var panel = $('hero-panel');
    panel.innerHTML = '';
    panel.appendChild(el('h3', null, 'Герои полка'));
    ['exec', 'deacon'].forEach(function (key) {
      var h = s.heroes[key];
      var t = DATA.UNITS[key];
      var card = el('div', 'hero-card');
      card.appendChild(el('div', 'hero-name', t.name + ' ' + h.name));
      var next = h.level < 4 ? DATA.XP_LEVELS[h.level + 1] : null;
      card.appendChild(el('div', 'hero-sub', 'Уровень ' + h.level +
        (next ? ' · опыт ' + h.xp + '/' + next : ' · предел сана') +
        (h.lineage.length ? ' · преемник (' + h.lineage.length + ')' : '')));
      if (h.traits.length) {
        var names = h.traits.map(function (id) {
          return DATA.TRAITS[key].filter(function (x) { return x.id === id; })[0].name;
        });
        card.appendChild(el('div', 'hero-traits', 'Черты: ' + names.join(', ')));
      }
      var relics = [];
      Object.keys(s.relics).forEach(function (rid) {
        if (s.relics[rid].mode === 'worn' && s.relics[rid].bearer === key) {
          relics.push(DATA.RELICS.filter(function (r) { return r.id === rid; })[0].name);
        }
      });
      if (relics.length) card.appendChild(el('div', 'hero-traits', 'Носит: ' + relics.join(', ')));
      var offer = CAMPAIGN.pendingLevel(key);
      if (offer && offer.length) {
        var up = el('button', 'btn small gold', 'Возвести в сан (ур. ' + (h.level + 1) + ')');
        up.onclick = function () { showLevelChoice(key, offer); };
        card.appendChild(up);
      }
      panel.appendChild(card);
    });
    var mir = [];
    Object.keys(s.miracles).forEach(function (mid) {
      if (s.miracles[mid] === 'ready') mir.push(DATA.MIRACLES[mid].name);
    });
    if (mir.length) panel.appendChild(el('p', 'dim', 'Чудеса в запасе: ' + mir.join(', ') + '.'));
  }

  function showLevelChoice(key, offer) {
    var w = el('div');
    w.appendChild(el('h3', null, 'Выбор черты — ' + st().heroes[key].name));
    offer.forEach(function (tr) {
      var btn = el('button', 'btn wide choice');
      btn.appendChild(el('div', 'choice-title', tr.name));
      btn.appendChild(el('div', 'choice-sub', tr.desc));
      btn.onclick = function () {
        CAMPAIGN.chooseTrait(key, tr.id);
        closeModal();
        renderHeroPanel();
        renderReqPanel();
      };
      w.appendChild(btn);
    });
    var c = el('button', 'btn wide ghost', 'Позже');
    c.onclick = closeModal;
    w.appendChild(c);
    openModal(w);
  }

  /* ================= БОЙ: построение ================= */
  function startBattleUI() {
    var b = bat();
    sel = null; runMode = false; orderMode = null; miracleMode = null; busy = false;
    buildBoard();
    show('s-battle');
    update();
    if (b.side === 'ai') { runAiTurn(); }
    else if (b.log.length <= 1) {
      toast(b.m.name + ': ' + b.m.tagline, 'gold');
    }
  }

  function buildBoard() {
    var board = $('board');
    board.innerHTML = '';
    for (var y = 0; y < ENGINE.H; y++) {
      for (var x = 0; x < ENGINE.W; x++) {
        var c = el('div', 'cell');
        c.dataset.x = x;
        c.dataset.y = y;
        board.appendChild(c);
      }
    }
    var layer = el('div');
    layer.id = 'units-layer';
    board.appendChild(layer);
    board.onclick = function (e) {
      var cell = e.target.closest('.cell');
      if (!cell) return;
      onCellTap(+cell.dataset.x, +cell.dataset.y);
    };
  }

  function cellEl(x, y) {
    return $('board').children[y * ENGINE.W + x];
  }

  /* ---------- рендер боя ---------- */
  function update() {
    var b = bat();
    if (!b) return;
    renderTop();
    renderTerrain();
    renderUnits();
    renderPhaseBar();
    renderPanel();
    renderActionBar();
    renderHighlights();
  }

  function missionStatus(b) {
    var m = b.m;
    var ai = ENGINE.aliveUnits(b, 'ai').length;
    switch (m.win.type) {
      case 'survive': return 'Выстоять: ход ' + Math.min(b.round, m.win.rounds) + '/' + m.win.rounds;
      case 'escort':
        var esc = b.units.filter(function (u) { return u.type === 'svech' && u.side === 'player'; })[0];
        return 'К алтарю · ход ' + Math.min(b.round, m.win.rounds) + '/' + m.win.rounds +
          (esc && ENGINE.alive(esc) ? ' · знамени идти ' + esc.y + ' кл.' : '');
      case 'annihilate': return 'Врагов: ' + ai;
      case 'killtype':
        var k = ENGINE.aliveUnits(b, 'ai').filter(function (u) { return u.type === m.win.unitType; }).length;
        return (m.win.label || 'Целей') + ': ' + (m.win.count - k) + '/' + m.win.count;
      case 'hold':
        return 'Держать: ход ' + Math.min(b.round, m.win.rounds) + '/' + m.win.rounds +
          (b.flags.holdLost ? ' · ХОР НА КАДИЛЕ ' + b.flags.holdLost + '/2' : '');
      case 'duel':
        var pg = b.units.filter(function (u) { return u.type === 'pervogolos'; })[0];
        var tx = b.units.filter(function (u) { return u.type === 'titan_x'; })[0];
        var parts = [];
        parts.push(pg && ENGINE.alive(pg) ? 'Первоголос: ' + pg.hp + ' ран' : 'Первоголос повержен?');
        if (tx && ENGINE.alive(tx)) parts.push('Стоголосый: ' + tx.hp + '⛨' + tx.shield);
        return parts.join(' · ');
    }
    return '';
  }

  function renderTop() {
    var b = bat();
    $('turn-info').textContent = 'Ход ' + b.round + ' · ' +
      (b.side === 'player' ? phaseName(b.phase) : 'Хор поёт…');
    $('objective-info').textContent = missionStatus(b);
  }

  function phaseName(p) {
    return { orders: 'Приказы', move: 'Движение', shoot: 'Стрельба', melee: 'Рукопашная', ai: 'Ход Хора' }[p] || p;
  }

  function renderTerrain() {
    var b = bat();
    for (var y = 0; y < ENGINE.H; y++) {
      for (var x = 0; x < ENGINE.W; x++) {
        var ch = ENGINE.cellChar(b, x, y);
        cellEl(x, y).className = 'cell t-' + (ch === '.' ? 'plain' : ch);
      }
    }
  }

  function renderUnits() {
    var b = bat();
    var layer = $('units-layer');
    var byId = {};
    for (var i = 0; i < layer.children.length; i++) byId[layer.children[i].dataset.uid] = layer.children[i];
    b.units.forEach(function (u) {
      var elT = byId[u.uid];
      delete byId[u.uid];
      if (!ENGINE.alive(u)) {
        if (elT) elT.remove();
        return;
      }
      if (!elT) {
        elT = mkToken(u);
        layer.appendChild(elT);
      }
      elT.style.left = (u.x * 100 / ENGINE.W) + '%';
      elT.style.top = (u.y * 100 / ENGINE.H) + '%';
      elT.classList.toggle('broken', u.broken);
      elT.classList.toggle('is-sel', sel === u.uid);
      elT.classList.toggle('acted', u.side === 'player' && b.side === 'player' && hasActed(b, u));
      elT.querySelector('.count').textContent = ENGINE.isChar(u) ? u.hp : u.models;
    });
    Object.keys(byId).forEach(function (k) { byId[k].remove(); });
  }

  function hasActed(b, u) {
    if (b.phase === 'move') return u.moved || u.broken;
    if (b.phase === 'shoot') {
      return u.shot || u.ran || u.broken ||
        !(ENGINE.canShoot(b, u) || ENGINE.canArtyFire(b, u));
    }
    if (b.phase === 'melee') return u.fought || u.broken || !ENGINE.adjacentEnemies(b, u).length;
    return false;
  }

  function mkToken(u) {
    var t = ENGINE.typeOf(u);
    var d = el('div', 'token side-' + (u.side === 'player' ? 'candle' : 'chorus') +
      (t.hero || u.heroKey ? ' is-hero' : ''));
    d.dataset.uid = u.uid;
    d.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><use href="#' + t.icon + '"/></svg>' +
      '<span class="count"></span>' + (u.veteran ? '<span class="vet">★</span>' : '');
    return d;
  }

  function renderPhaseBar() {
    var b = bat();
    var bar = $('phase-bar');
    bar.innerHTML = '';
    ['orders', 'move', 'shoot', 'melee'].forEach(function (p) {
      var pill = el('div', 'phase-pill' + (b.side === 'player' && b.phase === p ? ' on' : ''), phaseName(p));
      bar.appendChild(pill);
    });
    if (b.side === 'ai') {
      var pill = el('div', 'phase-pill on chorus', 'Хор');
      bar.appendChild(pill);
    }
  }

  /* ---------- карточка юнита / подсказка ---------- */
  function renderPanel() {
    var b = bat();
    var panel = $('panel-info');
    panel.innerHTML = '';
    var u = sel != null ? byUid(sel) : null;
    if (!u || !ENGINE.alive(u)) {
      var hint = busy ? 'Стеклянный Хор делает ход…' : phaseHint(b);
      panel.appendChild(el('div', 'panel-hint', hint));
      return;
    }
    var t = ENGINE.typeOf(u);
    var card = el('div', 'ucard ' + (u.side === 'player' ? 'u-candle' : 'u-chorus'));
    var ic = el('div', 'ucard-icon');
    ic.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><use href="#' + t.icon + '"/></svg>';
    card.appendChild(ic);
    var body = el('div', 'ucard-body');
    var nm = u.heroName ? t.name + ' ' + u.heroName :
      (u.squadName ? u.squadName + (u.veteran ? ' ★' : '') + ' · ' + t.name : t.name);
    body.appendChild(el('div', 'ucard-name', nm));
    var ld = ENGINE.effLd(b, u);
    var eff = ENGINE.effStats(u);
    var bsStr = t.arty ? 'Навес ' + t.arty.minRng + '–' + eff.rng
      : (t.flamer ? 'БС авто' : (t.bs ? 'БС ' + t.bs + '+' : 'БС —'));
    var stats = 'Дв ' + eff.mv + ' · ' + bsStr +
      ' · РБ ' + t.ws + '+ · С ' + eff.s + ' · Т ' + t.t +
      ' · Бр ' + Math.max(2, t.sv - (u.svBonus || 0)) + '+ · Лд ' + (t.vehicle ? '—' : ld);
    body.appendChild(el('div', 'ucard-stats', stats));
    var status = [];
    status.push(ENGINE.isChar(u) ? 'Ран: ' + u.hp + '/' + t.wpm : 'Бойцов: ' + u.models + '/' + t.models);
    if (u.shield > 0) status.push('щит ⛨' + u.shield);
    if (t.titan && ENGINE.titanStage(u) > 0) status.push(eff.stageLabel.toUpperCase());
    if (t.arty && u.moved) status.push('после движения не стреляет');
    var cov = ENGINE.terrainAt(b, u.x, u.y);
    if (cov.cover) status.push('в укрытии (+' + cov.cover + ' Бр)');
    if (cov.glass && t.faction === 'chorus') status.push('на стекле (+1 Бр)');
    if (u.broken) status.push('СЛОМЛЕН');
    if (ENGINE.isEngaged(b, u)) status.push('связан боем');
    if (u.buffs.hitBonus) status.push('благословлён (+1 попад.)');
    if (u.buffs.ldBonus) status.push('твёрдость (+2 Лд)');
    if (u.buffs.shootTwice) status.push('глас казни (×2 залп)');
    body.appendChild(el('div', 'ucard-status', status.join(' · ')));
    if (u.side === 'ai') body.appendChild(el('div', 'ucard-role', t.role));
    card.appendChild(body);
    panel.appendChild(card);
  }

  function phaseHint(b) {
    if (b.side !== 'player') return 'Стеклянный Хор делает ход…';
    switch (b.phase) {
      case 'orders': return 'Фаза приказов: литании героев и чудеса. Или сразу «Конец фазы».';
      case 'move': return 'Тап по отряду — путь; тап по клетке — идти. Встать вплотную — атака.';
      case 'shoot': return 'Тап по отряду, затем по цели — предпросмотр. Батареи: тап по клетке в кольце навеса.';
      case 'melee': return 'Тап по связанному отряду, затем по врагу — рукопашная.';
    }
    return '';
  }

  /* ---------- панель действий ---------- */
  function renderActionBar() {
    var b = bat();
    var bar = $('action-bar');
    bar.innerHTML = '';
    if (busy || b.outcome) return;
    if (b.side !== 'player') return;

    if (orderMode) {
      var hero = byUid(orderMode.heroUid);
      var jamWarn = hero && !hero.orderUnjammable && ENGINE.aliveUnits(b, 'ai').some(function (e) {
        return ENGINE.typeOf(e).jam;
      }) && !b.flags.jamUsedRound;
      bar.appendChild(el('div', 'order-hint',
        'Выберите отряд в ' + ENGINE.orderRadius(b, hero) + ' кл.' +
        (jamWarn ? ' ⚠ Псаломщик может заглушить приказ!' : '')));
      var cancel = el('button', 'btn small ghost', 'Отмена');
      cancel.onclick = function () { orderMode = null; update(); };
      bar.appendChild(cancel);
      return;
    }
    if (miracleMode) {
      bar.appendChild(el('div', 'order-hint', 'Тап по клетке — центр «Столпа пламени» (3×3).'));
      var mc = el('button', 'btn small ghost', 'Отмена');
      mc.onclick = function () { miracleMode = null; update(); };
      bar.appendChild(mc);
      return;
    }

    if (b.phase === 'orders') {
      var s = st();
      ['exec', 'deacon'].forEach(function (key) {
        var hu = b.units.filter(function (u) { return u.heroKey === key && ENGINE.alive(u); })[0];
        if (!hu || b.orderUsed[hu.uid]) return;
        var mkOrder = function (oid, label) {
          var btn = el('button', 'btn small', label);
          btn.onclick = function () { orderMode = { heroUid: hu.uid, orderId: oid }; sel = hu.uid; update(); };
          bar.appendChild(btn);
        };
        if (key === 'exec') {
          mkOrder('firm', '⚜ Твёрдость');
          if (hu.traits.indexOf('glas') >= 0 && !b.flags.glasUsed) mkOrder('glas', '⚜ Глас казни');
        } else {
          mkOrder('bless', '✚ Благословение');
        }
      });
      Object.keys(s.miracles).forEach(function (mid) {
        if (s.miracles[mid] !== 'ready') return;
        var btn = el('button', 'btn small gold', '☄ ' + DATA.MIRACLES[mid].name);
        btn.onclick = function () { armMiracle(mid); };
        bar.appendChild(btn);
      });
    }

    if (b.phase === 'move') {
      var rbtn = el('button', 'btn small' + (runMode ? ' gold' : ''), runMode ? 'Бег: ВКЛ' : 'Бег: выкл');
      rbtn.onclick = function () { runMode = !runMode; update(); };
      bar.appendChild(rbtn);
    }

    var end = el('button', 'btn small primary', b.phase === 'melee' ? 'Конец хода ▸' : 'Конец фазы ▸');
    end.onclick = endPhase;
    bar.appendChild(end);
  }

  /* ---------- подсветка ---------- */
  function clearHl() {
    var cells = $('board').querySelectorAll('.cell');
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove('hl-move', 'hl-run', 'hl-target', 'hl-order', 'hl-sel', 'hl-arty');
    }
  }

  function renderHighlights() {
    clearHl();
    var b = bat();
    if (busy || b.outcome || b.side !== 'player') return;

    if (orderMode) {
      var hero = byUid(orderMode.heroUid);
      if (hero) {
        var r = ENGINE.orderRadius(b, hero);
        ENGINE.aliveUnits(b, 'player').forEach(function (u) {
          if (u.heroKey || ENGINE.dist(hero, u) > r) return;
          if (orderMode.orderId !== 'firm' && !ENGINE.canShoot(b, u) && !ENGINE.typeOf(u).flamer) return;
          cellEl(u.x, u.y).classList.add('hl-order');
        });
      }
      return;
    }
    var u = sel != null ? byUid(sel) : null;
    if (!u || !ENGINE.alive(u)) return;
    cellEl(u.x, u.y).classList.add('hl-sel');
    if (u.side !== 'player') return;

    if (b.phase === 'move' && !u.moved && !u.broken) {
      var reach = ENGINE.reachable(b, u, runMode);
      Object.keys(reach).forEach(function (k) {
        var p = k.split(',');
        cellEl(+p[0], +p[1]).classList.add(runMode ? 'hl-run' : 'hl-move');
      });
    } else if (b.phase === 'shoot') {
      if (ENGINE.isArty(u)) {
        if (ENGINE.canArtyFire(b, u)) {
          for (var ay = 0; ay < ENGINE.H; ay++) {
            for (var ax = 0; ax < ENGINE.W; ax++) {
              if (ENGINE.artyCellOk(b, u, ax, ay)) cellEl(ax, ay).classList.add('hl-arty');
            }
          }
        }
      } else {
        ENGINE.shootTargets(b, u).forEach(function (t) {
          cellEl(t.x, t.y).classList.add('hl-target');
        });
      }
    } else if (b.phase === 'melee' && !u.fought && !u.broken) {
      ENGINE.adjacentEnemies(b, u).forEach(function (t) {
        cellEl(t.x, t.y).classList.add('hl-target');
      });
    }
  }

  /* ---------- тап по полю ---------- */
  function onCellTap(x, y) {
    var b = bat();
    if (!b || busy || b.outcome || b.side !== 'player') return;

    if (miracleMode) {
      var mid = miracleMode;
      miracleMode = null;
      CAMPAIGN.useMiracle(mid);
      ENGINE.castMiracle(b, mid, { x: x, y: y });
      CAMPAIGN.save();
      update();
      checkEnd();
      return;
    }
    var u = ENGINE.unitAt(b, x, y);

    if (orderMode) {
      var hero = byUid(orderMode.heroUid);
      if (u && u.side === 'player' && !u.heroKey && hero &&
          ENGINE.dist(hero, u) <= ENGINE.orderRadius(b, hero)) {
        var res = ENGINE.giveOrder(b, hero, orderMode.orderId, u);
        if (res.jammed) toast('♪ Хорал Тишины! Приказ заглушен.', 'grim');
        else toast('Приказ отдан: «' + ENGINE.orderName(orderMode.orderId) + '»', 'gold');
        orderMode = null;
        CAMPAIGN.save();
        update();
      } else {
        orderMode = null;
        update();
      }
      return;
    }

    var selU = sel != null ? byUid(sel) : null;

    /* артиллерия: тап по клетке в кольце навеса — предпросмотр накрытия */
    if (b.phase === 'shoot' && selU && selU.side === 'player' && ENGINE.isArty(selU) &&
        ENGINE.canArtyFire(b, selU) && ENGINE.artyCellOk(b, selU, x, y) &&
        !(u && u.side === 'player')) {
      showArtyPreview(selU, { x: x, y: y });
      return;
    }

    if (b.phase === 'move' && selU && selU.side === 'player' && !selU.moved && !selU.broken && !u) {
      var reach = ENGINE.reachable(b, selU, runMode);
      if (reach[x + ',' + y] != null) {
        ENGINE.moveUnit(b, selU, x, y, runMode);
        CAMPAIGN.save();
        update();
        checkEnd();
        return;
      }
    }

    if (u) {
      if (u.side === 'ai' && selU && selU.side === 'player') {
        if (b.phase === 'shoot' && ENGINE.shootTargets(b, selU).indexOf(u) >= 0) {
          showPreview(selU, u, 'shoot');
          return;
        }
        if (b.phase === 'melee' && !selU.fought && !selU.broken &&
            ENGINE.adjacentEnemies(b, selU).indexOf(u) >= 0) {
          showPreview(selU, u, 'melee');
          return;
        }
      }
      sel = u.uid;
      update();
      return;
    }
    sel = null;
    update();
  }

  function armMiracle(mid) {
    var b = bat();
    if (mid === 'pillar') {
      miracleMode = 'pillar';
      update();
      return;
    }
    CAMPAIGN.useMiracle(mid);
    ENGINE.castMiracle(b, mid, null);
    CAMPAIGN.save();
    update();
    checkEnd();
  }

  /* ---------- предпросмотр атаки ---------- */
  function pct(v) { return Math.round(v * 100) + '%'; }

  function showPreview(att, def, mode) {
    var b = bat();
    var pv = ENGINE.preview(b, att, def, mode);
    var w = el('div', 'preview');
    w.appendChild(el('h3', null, (mode === 'shoot' ? 'Залп' : 'Рукопашная') + ': ' +
      ENGINE.unitLabel(att) + ' → ' + ENGINE.unitLabel(def)));
    var chain = pv.prof.auto
      ? pv.prof.dice + ' автопопаданий → ранение ' + pv.prof.woundT + '+ → спас ' +
        (pv.prof.saveT > 6 ? 'нет' : pv.prof.saveT + '+')
      : pv.prof.dice + ' кубов → попадание ' + pv.prof.hitT + '+ (' + pct(pv.pHit) + ') → ранение ' +
        pv.prof.woundT + '+ (' + pct(pv.pWound) + ') → спас ' +
        (pv.prof.saveT > 6 ? 'нет' : pv.prof.saveT + '+ (провал ' + pct(pv.pFailSave) + ')');
    w.appendChild(el('div', 'pv-chain', chain));
    var expLine = 'Ожидание: ' + pv.expKills.toFixed(1) +
      (ENGINE.isChar(def) ? ' ран' : ' убитых') +
      ' · уничтожение: ' + pct(pv.pDestroy) +
      (pv.pBreak > 0 ? ' · слом морали: ' + pct(pv.pBreak) : '');
    w.appendChild(el('div', 'pv-exp', expLine));
    if (pv.back && pv.back.dice > 0) {
      w.appendChild(el('div', 'pv-back', 'Ответный удар: ~' + pv.back.dice + ' кубов, ожидание ' +
        pv.back.exp.toFixed(1) + ' потерь'));
    }
    pv.prof.notes.forEach(function (n) { w.appendChild(el('div', 'pv-note', '· ' + n)); });
    var row = el('div', 'btn-row');
    var go = el('button', 'btn primary', '⚂ Бросить кубы');
    go.onclick = function () {
      closeModal();
      if (mode === 'shoot') {
        var res = ENGINE.resolveAttack(b, att, def, 'shoot');
        logAttack(att, def, res, 'shoot');
        showTray([{ title: 'Залп', res: res, def: def }]);
      } else {
        var fight = ENGINE.resolveFight(b, att, def);
        logAttack(att, def, fight.att, 'melee');
        if (fight.back) logAttack(def, att, fight.back, 'melee');
        var secs = [{ title: 'Удар', res: fight.att, def: def }];
        if (fight.back) secs.push({ title: 'Ответ', res: fight.back, def: att });
        if (fight.loserMorale) {
          var lu = byUid(fight.loser);
          secs.morale = ENGINE.moraleMsg(lu, fight.loserMorale);
        }
        showTray(secs);
      }
    };
    var no = el('button', 'btn ghost', 'Отмена');
    no.onclick = closeModal;
    row.appendChild(go);
    row.appendChild(no);
    w.appendChild(row);
    openModal(w);
  }

  /* ---------- артиллерия: предпросмотр и результат ---------- */
  function showArtyPreview(att, cell) {
    var b = bat();
    var pv = ENGINE.artyPreview(b, att, cell);
    var w = el('div', 'preview');
    w.appendChild(el('h3', null, 'Навесной огонь: ' + ENGINE.unitLabel(att) +
      ' → (' + (cell.x + 1) + ',' + (cell.y + 1) + ')'));
    w.appendChild(el('div', 'pv-chain', pv.dice + ' снарядов С' + pv.s +
      ' по площади 3×3 · точно в цель: 67% (иначе снос на 1 клетку) · укрытия не спасают'));
    if (!pv.rows.length) {
      w.appendChild(el('div', 'pv-exp', 'В зоне накрытия никого. Снаряды уйдут в пепел.'));
    }
    pv.rows.forEach(function (r) {
      var line = ENGINE.unitLabel(r.unit) + ': накрытие ' + pct(r.pBlast) +
        ' · ожидание ' + r.exp.toFixed(1) + (ENGINE.isChar(r.unit) ? ' ран' : ' убитых');
      var e = el('div', r.friendly ? 'pv-back' : 'pv-exp',
        (r.friendly ? '⚠ СВОИ: ' : '') + line);
      w.appendChild(e);
    });
    var hasFriendly = pv.rows.some(function (r) { return r.friendly; });
    if (hasFriendly) w.appendChild(el('div', 'pv-note', '· Навес не различает своих и чужих.'));
    var row = el('div', 'btn-row');
    var go = el('button', 'btn primary', '☄ Огонь');
    go.onclick = function () {
      closeModal();
      var res = ENGINE.resolveArty(b, att, cell);
      showArtyTray(att, res);
    };
    var no = el('button', 'btn ghost', 'Отмена');
    no.onclick = closeModal;
    row.appendChild(go);
    row.appendChild(no);
    w.appendChild(row);
    openModal(w);
  }

  function showArtyTray(att, res) {
    var w = el('div', 'tray');
    w.appendChild(el('h3', null, 'Навесной огонь'));
    w.appendChild(el('div', 'pv-chain', 'Рассеивание: ' + res.scRoll +
      (res.scattered ? ' — снос! Падение: (' + (res.impact.x + 1) + ',' + (res.impact.y + 1) + ')'
                     : ' — точно в цель.')));
    if (!res.results.length) {
      w.appendChild(el('div', 'tray-result', 'Никого не накрыло. Только пепел взлетел.'));
    }
    res.results.forEach(function (r) {
      var kills = ENGINE.isChar(r.unit) ? r.woundsLost : r.kills;
      var line = (r.friendly ? '⚠ СВОИ — ' : '') + ENGINE.unitLabel(r.unit) + ': ' +
        (kills > 0 ? '−' + kills + (r.fallen.length ? ' (' + r.fallen.join(', ') + ')' : '')
                   : 'без потерь');
      if (r.destroyed) line += ' · УНИЧТОЖЕН';
      w.appendChild(el('div', 'tray-result' + (kills > 0 ? ' grim' : ''), line));
      if (r.morale) w.appendChild(el('div', 'tray-morale', ENGINE.moraleMsg(r.unit, r.morale)));
    });
    var ok = el('button', 'btn wide primary', 'Готово');
    ok.onclick = function () {
      closeModal();
      CAMPAIGN.save();
      update();
      checkEnd();
    };
    w.appendChild(ok);
    openModal(w, { noClose: true });
  }

  function diceRow(label, arr, invert) {
    var row = el('div', 'dice-row');
    row.appendChild(el('span', 'dice-label', label));
    var box = el('span', 'dice-box');
    arr.forEach(function (d, i) {
      var good = invert ? !d.ok : d.ok;
      var die = el('span', 'die ' + (good ? 'ok' : 'no'), String(d.r));
      if (!reduceMotion) die.style.animationDelay = (i * 40) + 'ms';
      box.appendChild(die);
    });
    if (!arr.length) box.appendChild(el('span', 'dim', '—'));
    row.appendChild(box);
    return row;
  }

  function showTray(secs) {
    var b = bat();
    var w = el('div', 'tray');
    secs.forEach(function (sec) {
      w.appendChild(el('h3', null, sec.title));
      var p = sec.res.prof;
      w.appendChild(diceRow('Попадания ' + (p.auto ? '(авто)' : '(' + p.hitT + '+)'), sec.res.hits));
      w.appendChild(diceRow('Ранения (' + p.woundT + '+)', sec.res.wounds));
      w.appendChild(diceRow('Спасы (' + (p.saveT > 6 ? 'нет' : p.saveT + '+') + ')', sec.res.saves, true));
      var kills = ENGINE.isChar(sec.def) ? sec.res.woundsLost : sec.res.kills;
      var line = kills > 0
        ? 'Потери: ' + kills + (sec.res.fallen.length ? ' — ' + sec.res.fallen.join(', ') : '')
        : 'Без потерь';
      if (sec.res.destroyed) line += ' · ОТРЯД УНИЧТОЖЕН';
      w.appendChild(el('div', 'tray-result' + (kills > 0 ? ' grim' : ''), line));
      if (sec.res.morale) {
        w.appendChild(el('div', 'tray-morale', ENGINE.moraleMsg(byUid(sec.res.defender), sec.res.morale)));
      }
    });
    if (secs.morale) w.appendChild(el('div', 'tray-morale', secs.morale));
    var ok = el('button', 'btn wide primary', 'Готово');
    ok.onclick = function () {
      closeModal();
      CAMPAIGN.save();
      update();
      checkEnd();
    };
    w.appendChild(ok);
    openModal(w, { noClose: true });
  }

  function rollsStr(arr) {
    return arr.map(function (d) { return d.r; }).join(',');
  }
  function logAttack(att, def, res, mode) {
    var b = bat();
    var nH = res.hits.filter(function (d) { return d.ok; }).length;
    var nW = res.wounds.filter(function (d) { return d.ok; }).length;
    var nF = res.saves.filter(function (d) { return !d.ok; }).length;
    var kills = ENGINE.isChar(def) ? res.woundsLost : res.kills;
    ENGINE.log(b, ENGINE.unitLabel(att) + ' → ' + ENGINE.unitLabel(def) +
      (mode === 'shoot' ? ' (залп)' : ' (сеча)') +
      ': попаданий ' + nH + '/' + res.hits.length + ' [' + rollsStr(res.hits) + ']' +
      ', ранений ' + nW + ' [' + rollsStr(res.wounds) + ']' +
      ', провалов спаса ' + nF + ' [' + rollsStr(res.saves) + ']' +
      ' — потери: ' + kills + (res.destroyed ? ' (уничтожен)' : ''), 'atk');
  }

  /* ---------- фазы / конец хода ---------- */
  function endPhase() {
    var b = bat();
    if (busy) return;
    if (b.outcome) { checkEnd(); return; }
    orderMode = null; miracleMode = null; runMode = false;
    var np = ENGINE.nextPhase(b);
    if (np) {
      CAMPAIGN.save();
      update();
      return;
    }
    ENGINE.startAiTurn(b);
    CAMPAIGN.save();
    update();
    runAiTurn();
  }

  function toastAttack(att, def, res) {
    var kills = ENGINE.isChar(def) ? res.woundsLost : res.kills;
    var msg = ENGINE.unitLabel(att) + ' → ' + ENGINE.unitLabel(def) + ': ' +
      (kills > 0 ? '−' + kills + (res.destroyed ? ', уничтожен!' : '') : 'без потерь');
    toast(msg, kills > 0 ? 'grim' : '');
  }

  function runAiTurn() {
    var b = bat();
    busy = true;
    sel = null;
    update();
    (async function () {
      await sleep(AI_DELAY);
      if (!b.outcome) {
        var units = AI.unitOrder(b);
        for (var i = 0; i < units.length; i++) {
          var u = units[i];
          if (!ENGINE.alive(u) || b.outcome) break;
          var mv = AI.decideMove(b, u);
          if (mv) {
            ENGINE.moveUnit(b, u, mv.x, mv.y, !!mv.run);
            update();
            await sleep(AI_DELAY * 0.8);
          }
        }
      }
      if (!b.outcome) {
        var shooters = AI.unitOrder(b);
        for (var j = 0; j < shooters.length; j++) {
          var su = shooters[j];
          if (!ENGINE.alive(su) || b.outcome) break;
          /* батареи Хора: навесной огонь */
          if (ENGINE.isArty(su)) {
            var ac = AI.decideArty(b, su);
            if (ac) {
              var ares = ENGINE.resolveArty(b, su, ac.cell);
              var totKills = 0;
              ares.results.forEach(function (r) { totKills += (r.kills || 0) + (r.woundsLost || 0); });
              toast('☄ ' + ENGINE.unitLabel(su) + ' кроет навесом: ' +
                (totKills > 0 ? '−' + totKills : 'мимо') +
                (ares.scattered ? ' (снос)' : ''), totKills > 0 ? 'grim' : '');
              ares.results.forEach(function (r) {
                if (r.morale && !r.morale.passed) toast(ENGINE.moraleMsg(r.unit, r.morale), 'grim');
              });
              update();
              await sleep(AI_DELAY * 1.5);
            }
            continue;
          }
          var tgt = AI.decideShot(b, su);
          if (tgt) {
            var res = ENGINE.resolveAttack(b, su, tgt, 'shoot');
            logAttack(su, tgt, res, 'shoot');
            toastAttack(su, tgt, res);
            if (res.morale && !res.morale.passed) {
              toast(ENGINE.moraleMsg(tgt, res.morale), 'grim');
            }
            update();
            await sleep(AI_DELAY * 1.5);
          }
        }
      }
      var guard = 0;
      while (!b.outcome && guard++ < 20) {
        var fights = AI.decideFights(b);
        if (!fights.length) break;
        var f = fights[0];
        if (!ENGINE.alive(f.att) || !ENGINE.alive(f.def)) { f.att.fought = true; continue; }
        var fr = ENGINE.resolveFight(b, f.att, f.def);
        logAttack(f.att, f.def, fr.att, 'melee');
        if (fr.back) logAttack(f.def, f.att, fr.back, 'melee');
        toastAttack(f.att, f.def, fr.att);
        if (fr.loserMorale && !fr.loserMorale.passed) {
          toast(ENGINE.moraleMsg(byUid(fr.loser), fr.loserMorale), 'grim');
        }
        update();
        await sleep(AI_DELAY * 1.5);
      }
      if (!b.outcome) {
        ENGINE.endAiTurn(b);
      }
      if (!b.outcome) {
        ENGINE.startPlayerTurn(b);
        toast('Ход ' + b.round + ': полк слушает приказы.', 'gold');
      }
      busy = false;
      CAMPAIGN.save();
      update();
      checkEnd();
    })().catch(function (err) {
      busy = false;
      /* не роняем игру: фиксируем в лог боя */
      ENGINE.log(b, 'Сбой хода Хора: ' + err.message, 'grim');
      update();
    });
  }

  /* ---------- завершение боя ---------- */
  function checkEnd() {
    var b = bat();
    if (!b || !b.outcome) return;
    busy = true;
    setTimeout(function () {
      var outcome = b.outcome;
      var report = CAMPAIGN.finishBattle(outcome.win);
      busy = false;
      showResult(report, outcome);
    }, reduceMotion ? 50 : 700);
  }

  function showResult(report, outcome) {
    var body = $('result-body');
    body.innerHTML = '';
    body.appendChild(el('h2', 'scr-title ' + (outcome.win ? 'win' : 'lose'),
      outcome.win ? 'Литания дочитана' : 'Литания оборвана'));
    body.appendChild(el('p', 'result-reason', outcome.reason));

    if (report.fallen.length || report.deserters) {
      body.appendChild(el('h3', null, 'Поминальный список миссии'));
      var lst = el('div', 'fallen-list');
      report.fallen.forEach(function (f) {
        lst.appendChild(el('div', 'fallen-row', '✝ ' + f.name + ' — ' + f.squad));
      });
      if (report.deserters) lst.appendChild(el('div', 'fallen-row dim', '… и ' + report.deserters + ' дезертиров, ушедших во тьму'));
      body.appendChild(lst);
    } else if (outcome.win) {
      body.appendChild(el('p', 'dim', 'Ни одного павшего. Писарь не верит своим свечам.'));
    }

    if (outcome.win) {
      if (!report.defense) {
        body.appendChild(el('p', 'gold-line', '⚑ Провинция «' +
          DATA.PROVINCES[report.provId].name + '» освобождена.'));
      } else {
        body.appendChild(el('p', 'gold-line', '⚑ Контратака отбита: «' +
          DATA.PROVINCES[report.provId].name + '» удержана.'));
      }
      if (report.unlock) body.appendChild(el('p', 'gold-line', '✦ ' + report.unlock));
      report.destroyedSquads.forEach(function (nm) {
        body.appendChild(el('p', 'grim-line', '⚑ Отряд ' + nm + ' стёрт из полковых списков.'));
      });
      report.successors.forEach(function (sc) {
        body.appendChild(el('p', 'grim-line', '⚑ ' + sc.old + ' догорел. Литанию подхватывает ' + sc.next +
          ' — преемник слабее, но поход продолжается.'));
      });
      if (report.sanitar) body.appendChild(el('p', 'gold-line', '✚ Санитар веры вернул из пепла: ' + report.sanitar));
      var xps = [];
      Object.keys(report.xp).forEach(function (k) {
        xps.push((k === 'exec' ? 'Экзекутор' : 'Дьякон') + ' +' + report.xp[k] + ' ОП');
      });
      var rew = 'Реквизиция: +' + report.req + ' за бой, +' + report.income +
        ' с провинций' + (xps.length ? ' · ' + xps.join(' · ') : '');
      body.appendChild(el('p', 'gold-line', rew));
      if (report.counter) {
        body.appendChild(el('p', 'grim-line', '⚠ Разведка: Хор перепевает контрнаступление — цель: ' +
          report.counter + '. Следующий бой — оборона.'));
      }
    } else if (report.provLost) {
      body.appendChild(el('p', 'grim-line', '⚑ Провинция «' + report.provLost +
        '» возвращена Хору. Её доход потерян — отбивайте, когда будете готовы.'));
      if (report.income) body.appendChild(el('p', 'gold-line',
        'Обозы с уцелевших провинций: +' + report.income + ' реквизиции.'));
    }

    var btn = el('button', 'btn wide primary',
      outcome.win ? 'Далее' : (report.provLost ? 'К карте' : 'Собраться с силами'));
    btn.onclick = function () {
      if (outcome.win) proceedAfterResult();
      else if (report.provLost) { selProv = null; renderCampaign(); }
      else renderBrief(report.provId);
    };
    body.appendChild(btn);
    show('s-result');
  }

  function proceedAfterResult() {
    var s = st();
    if (s.pendingRelic) { showRelic(s.pendingRelic); return; }
    if (s.pendingDecision) { showDecision(s.pendingDecision); return; }
    if (s.finished) { showEpilogue(); return; }
    selProv = s.pendingDefense || null;
    renderCampaign();
  }

  /* ---------- реликвии: носить или сжечь ---------- */
  function showRelic(rid) {
    var r = DATA.RELICS.filter(function (x) { return x.id === rid; })[0];
    var body = $('relic-body');
    body.innerHTML = '';
    body.appendChild(el('div', 'brief-kicker', 'Обретена реликвия'));
    body.appendChild(el('h2', 'scr-title', r.name));
    body.appendChild(el('p', 'brief-intro', r.text));

    var wearBox = el('div', 'choice-box');
    wearBox.appendChild(el('h3', null, r.wear.label));
    wearBox.appendChild(el('p', null, r.wear.effect));
    if (r.wear.pick === 'hero') {
      ['exec', 'deacon'].forEach(function (key) {
        var b1 = el('button', 'btn wide', 'Носить: ' + st().heroes[key].name);
        b1.onclick = function () { CAMPAIGN.applyRelic(rid, 'worn', key); proceedAfterResult(); };
        wearBox.appendChild(b1);
      });
    } else {
      var b2 = el('button', 'btn wide', r.wear.label);
      b2.onclick = function () { CAMPAIGN.applyRelic(rid, 'worn', 'deacon'); proceedAfterResult(); };
      wearBox.appendChild(b2);
    }
    body.appendChild(wearBox);

    var burnBox = el('div', 'choice-box burn');
    burnBox.appendChild(el('h3', null, r.burn.label));
    burnBox.appendChild(el('p', null, r.burn.effect));
    var b3 = el('button', 'btn wide grim-btn', '🔥 ' + r.burn.label);
    b3.onclick = function () { CAMPAIGN.applyRelic(rid, 'burned'); proceedAfterResult(); };
    burnBox.appendChild(b3);
    body.appendChild(burnBox);
    show('s-relic');
  }

  /* ---------- карточки решений ---------- */
  function showDecision(cardId) {
    var card = DATA.DECISIONS.filter(function (d) { return d.id === cardId; })[0];
    var body = $('decision-body');
    body.innerHTML = '';
    body.appendChild(el('div', 'brief-kicker', 'Решение командира'));
    body.appendChild(el('h2', 'scr-title', card.title));
    body.appendChild(el('p', 'brief-intro', card.text));
    ['a', 'b'].forEach(function (ch) {
      var opt = card[ch];
      var box = el('button', 'btn wide choice');
      box.appendChild(el('div', 'choice-title', opt.label));
      box.appendChild(el('div', 'choice-sub', opt.effect));
      box.onclick = function () {
        CAMPAIGN.applyDecision(cardId, ch);
        toast('Записано в летопись: ' + opt.label, 'gold');
        proceedAfterResult();
      };
      body.appendChild(box);
    });
    body.appendChild(el('p', 'dim', 'Цена написана на карточке. Скрытых последствий нет — только эти.'));
    show('s-decision');
  }

  /* ---------- эпилог ---------- */
  function showEpilogue() {
    var body = $('epilogue-body');
    body.innerHTML = '';
    body.appendChild(el('div', 'brief-kicker', 'Эпилог похода'));
    body.appendChild(el('h2', 'scr-title', 'Пепел литаний'));
    CAMPAIGN.epilogue().forEach(function (p) {
      body.appendChild(el('p', 'epi-p', p));
    });
    var b1 = el('button', 'btn wide', 'Летопись и поминальный список');
    b1.onclick = function () { renderChronicle(showEpilogue); };
    body.appendChild(b1);
    var b2 = el('button', 'btn wide primary', 'Новый поход');
    b2.onclick = function () {
      CAMPAIGN.wipe();
      CAMPAIGN.fresh();
      renderCampaign();
    };
    body.appendChild(b2);
    show('s-epilogue');
  }

  /* ---------- лог и меню боя ---------- */
  function showBattleLog() {
    var b = bat();
    var w = el('div', 'battle-log');
    w.appendChild(el('h3', null, 'Летопись боя'));
    var list = el('div', 'log-list');
    for (var i = b.log.length - 1; i >= 0; i--) {
      var e = b.log[i];
      list.appendChild(el('div', 'log-line ' + (e.cls || ''), '[' + e.r + '] ' + e.msg));
    }
    w.appendChild(list);
    var ok = el('button', 'btn wide', 'Закрыть');
    ok.onclick = closeModal;
    w.appendChild(ok);
    openModal(w);
  }

  function showBattleMenu() {
    var w = el('div');
    w.appendChild(el('h3', null, 'Полевой устав'));
    var b1 = el('button', 'btn wide', 'Продолжить бой');
    b1.onclick = closeModal;
    w.appendChild(b1);
    var b2 = el('button', 'btn wide', 'Правила');
    b2.onclick = function () { showRules(); };
    w.appendChild(b2);
    var b3 = el('button', 'btn wide grim-btn', 'Отступить (миссия провалена)');
    b3.onclick = function () {
      closeModal();
      var b = bat();
      b.outcome = { win: false, reason: 'Полк отступает. Мир остаётся Хору — до следующей попытки.' };
      checkEnd();
    };
    w.appendChild(b3);
    openModal(w);
  }

  /* ---------- инициализация ---------- */
  function init() {
    $('btn-new').onclick = function () {
      if (CAMPAIGN.hasSave()) {
        var w = el('div');
        w.appendChild(el('h3', null, 'Начать заново?'));
        w.appendChild(el('p', null, 'Текущий поход и его летопись будут преданы огню.'));
        var yes = el('button', 'btn wide grim-btn', 'Предать огню и начать');
        yes.onclick = function () {
          closeModal();
          CAMPAIGN.wipe();
          CAMPAIGN.fresh();
          renderCampaign();
        };
        var no = el('button', 'btn wide ghost', 'Отмена');
        no.onclick = closeModal;
        w.appendChild(yes);
        w.appendChild(no);
        openModal(w);
        return;
      }
      CAMPAIGN.fresh();
      renderCampaign();
    };
    $('btn-continue').onclick = function () {
      if (!CAMPAIGN.load()) { renderTitle(); return; }
      var s = st();
      if (s.finished && !CAMPAIGN.getBattle()) { showEpilogue(); return; }
      if (CAMPAIGN.getBattle()) { startBattleUI(); return; }
      renderCampaign();
    };
    $('btn-rules-title').onclick = showRules;
    $('btn-chronicle').onclick = function () { renderChronicle(renderCampaign); };
    $('btn-reset').onclick = function () {
      var w = el('div');
      w.appendChild(el('h3', null, 'Сбросить поход?'));
      var yes = el('button', 'btn wide grim-btn', 'Сбросить');
      yes.onclick = function () { closeModal(); CAMPAIGN.wipe(); renderTitle(); };
      var no = el('button', 'btn wide ghost', 'Отмена');
      no.onclick = closeModal;
      w.appendChild(yes);
      w.appendChild(no);
      openModal(w);
    };
    $('btn-back-camp').onclick = renderCampaign;
    $('btn-launch').onclick = function () {
      if (briefProv == null) { renderCampaign(); return; }
      CAMPAIGN.startMission(briefProv);
      startBattleUI();
    };
    $('btn-log').onclick = showBattleLog;
    $('btn-help').onclick = showRules;
    $('btn-menu').onclick = showBattleMenu;
    $('modal').onclick = function (e) {
      if (e.target === $('modal') && !$('modal').dataset.noclose) closeModal();
    };
  }

  return { init: init, renderTitle: renderTitle, renderCampaign: renderCampaign,
           startBattleUI: startBattleUI, show: show };
})();
