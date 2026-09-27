/* Кубокрафт — интерфейс: HUD (сердца, сытость, броня, воздух, хотбар), экраны
   инвентаря, верстака, печи и сундука с курсором-стопкой, книга рецептов,
   палитра творческого режима и экран смерти. Работает мышью и пальцем. */
(function (KC) {
  'use strict';

  var ITEMS = KC.ITEMS, P = KC.Player;
  var icons = {}, hud = null;
  var hooks = {};
  var screen = null;          // null | inventory | table | furnace | chest
  var bent = null;
  var cursor = null;
  var craft2 = [null, null, null, null], craft3 = new Array(9).fill(null);
  var quickMode = false, bookOpen = false, bookAll = false;
  var lastPointer = { x: 0, y: 0 };

  function $(id) { return document.getElementById(id); }
  function iconOf(id) {
    if (!icons[id]) icons[id] = KC.makeIcon(hooks.atlas, id, 48).toDataURL();
    return icons[id];
  }
  function maxOf(s) { return KC.maxStack(s.id); }
  function same(a, b) { return a && b && a.id === b.id && (a.d || 0) === (b.d || 0) && maxOf(a) > 1; }
  function clone(s) { return s ? { id: s.id, n: s.n, d: s.d || 0 } : null; }

  // ---- Отрисовка ячейки --------------------------------------------------------------
  function fillSlot(el, s) {
    var img = el.firstChild, cnt = el.children[1], bar = el.children[2];
    if (s) {
      if (img.getAttribute('src') !== iconOf(s.id)) img.src = iconOf(s.id);
      img.hidden = false;
      cnt.textContent = s.n > 1 ? s.n : '';
      var it = ITEMS[s.id];
      if (it && it.dur && s.d) {
        var left = 1 - s.d / it.dur;
        bar.hidden = false;
        bar.firstChild.style.width = Math.max(4, left * 100) + '%';
        bar.firstChild.style.background = left > 0.5 ? '#6ad04a' : left > 0.2 ? '#e8c440' : '#e05030';
      } else bar.hidden = true;
      el.title = it ? it.name : '';
      el.setAttribute('aria-label', (it ? it.name : '') + (s.n > 1 ? ', ' + s.n : ''));
    } else {
      img.hidden = true; img.removeAttribute('src'); cnt.textContent = ''; bar.hidden = true;
      el.title = ''; el.setAttribute('aria-label', 'Пусто');
    }
  }
  function makeSlot(cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot' + (cls ? ' ' + cls : '');
    b.innerHTML = '<img alt="" hidden><span class="cnt"></span><span class="dur" hidden><i></i></span>';
    return b;
  }

  // ---- HUD ----------------------------------------------------------------------------
  function buildHud() {
    hud = KC.makeHudIcons();
    var bar = $('hotbar');
    bar.innerHTML = '';
    for (var i = 0; i < 9; i++) {
      var el = makeSlot();
      var num = document.createElement('span'); num.className = 'num'; num.textContent = i + 1;
      el.appendChild(num);
      (function (n) { el.addEventListener('click', function (e) { e.stopPropagation(); if (hooks.select) hooks.select(n); }); })(i);
      bar.appendChild(el);
    }
    ['hearts', 'food', 'armor-row', 'air-row'].forEach(function (id) {
      var row = $(id);
      row.innerHTML = '';
      for (var k = 0; k < 10; k++) row.appendChild(document.createElement('img'));
    });
  }

  var lastBars = '';
  function renderHud() {
    var bar = $('hotbar');
    for (var i = 0; i < 9; i++) {
      var el = bar.children[i];
      fillSlot(el, P.inv[i]);
      el.classList.toggle('is-active', i === P.slot);
    }
    var creative = P.creative;
    $('bars').hidden = creative;
    if (creative) return;
    var air = P.headInWater || P.air < 15;
    var key = [Math.ceil(P.hp), P.food, P.armorPoints(), air ? Math.ceil(P.air) : -1, P.effects.poison > 0, P.effects.hunger > 0].join('|');
    if (key === lastBars) return;
    lastBars = key;
    var hp = Math.ceil(P.hp), hearts = $('hearts').children;
    for (i = 0; i < 10; i++) hearts[i].src = hp >= (i + 1) * 2 ? hud.heart : hp === i * 2 + 1 ? hud.heartHalf : hud.heartEmpty;
    $('hearts').classList.toggle('is-poison', P.effects.poison > 0);
    var food = $('food').children;
    for (i = 0; i < 10; i++) food[i].src = P.food >= (i + 1) * 2 ? hud.food : P.food === i * 2 + 1 ? hud.foodHalf : hud.foodEmpty;
    $('food').classList.toggle('is-hunger', P.effects.hunger > 0);
    var ap = P.armorPoints(), arm = $('armor-row');
    arm.hidden = ap <= 0;
    for (i = 0; i < 10; i++) arm.children[i].src = ap >= (i + 1) * 2 ? hud.armor : ap === i * 2 + 1 ? hud.armorHalf : hud.armorEmpty;
    var airRow = $('air-row');
    airRow.hidden = !air;
    var bubbles = Math.ceil(P.air / 1.5);
    for (i = 0; i < 10; i++) airRow.children[i].style.visibility = i < bubbles ? 'visible' : 'hidden', airRow.children[i].src = hud.bubble;
  }

  // ---- Экраны-контейнеры -----------------------------------------------------------
  // Ссылка на ячейку: { arr, i, kind }
  function ref(arr, i, kind) { return { arr: arr, i: i, kind: kind || 'inv' }; }

  function accepts(r, s) {
    if (!s) return true;
    if (r.kind === 'armor') { var it = ITEMS[s.id]; return !!(it && it.armor && it.armor.slot === r.i); }
    if (r.kind === 'fout' || r.kind === 'result' || r.kind === 'palette') return false;
    if (r.kind === 'ffuel') { var f = ITEMS[s.id]; return !!(f && f.fuel) || s.id === KC.I.BUCKET; }
    return true;
  }

  function clickSlot(r, button, shift) {
    if (r.kind === 'result') { takeResult(shift || quickMode); return afterChange(); }
    if (r.kind === 'palette') {
      var id = r.arr[r.i];
      if (cursor) { cursor = null; return afterChange(); }
      var st = { id: id, n: button === 2 ? 1 : maxOf({ id: id }), d: 0 };
      if (shift || quickMode) { P.give(st); return afterChange(); }
      cursor = st;
      return afterChange();
    }
    if (shift || quickMode) { quickMove(r); return afterChange(); }
    var s = r.arr[r.i];
    if (button === 0) {
      if (!cursor) { if (s) { cursor = s; r.arr[r.i] = null; } }
      else if (!s) { if (accepts(r, cursor)) { if (r.kind === 'armor' && cursor.n > 1) { r.arr[r.i] = { id: cursor.id, n: 1, d: cursor.d }; cursor.n--; } else { r.arr[r.i] = cursor; cursor = null; } } }
      else if (same(s, cursor) && r.kind !== 'fout') {
        var mv = Math.min(cursor.n, maxOf(s) - s.n); s.n += mv; cursor.n -= mv; if (!cursor.n) cursor = null;
      } else if (r.kind === 'fout') {
        if (same(s, cursor) && cursor.n + s.n <= maxOf(s)) { cursor.n += s.n; r.arr[r.i] = null; }
      } else if (accepts(r, cursor) && !(r.kind === 'armor' && cursor.n > 1)) { r.arr[r.i] = cursor; cursor = s; }
    } else {
      if (!cursor) {
        if (s) { var half = Math.ceil(s.n / 2); cursor = { id: s.id, n: half, d: s.d || 0 }; s.n -= half; if (!s.n) r.arr[r.i] = null; }
      } else if (!s) {
        if (accepts(r, cursor)) { r.arr[r.i] = { id: cursor.id, n: 1, d: cursor.d || 0 }; cursor.n--; }
      } else if (same(s, cursor) && s.n < maxOf(s) && r.kind !== 'fout') { s.n++; cursor.n--; }
      if (cursor && !cursor.n) cursor = null;
    }
    afterChange();
  }

  function insertInto(arr, idxs, s) {
    var max = maxOf(s), k;
    for (k = 0; k < idxs.length && s.n; k++) {
      var t = arr[idxs[k]];
      if (t && same(t, s) && t.n < max) { var mv = Math.min(s.n, max - t.n); t.n += mv; s.n -= mv; }
    }
    for (k = 0; k < idxs.length && s.n; k++) {
      if (!arr[idxs[k]]) { var put = Math.min(s.n, max); arr[idxs[k]] = { id: s.id, n: put, d: s.d || 0 }; s.n -= put; }
    }
  }
  function range(a, b) { var r = []; for (var i = a; i < b; i++) r.push(i); return r; }

  function quickMove(r) {
    var s = r.arr[r.i];
    if (!s) return;
    if (r.kind !== 'inv') {
      var left = P.give(clone(s));
      if (left) s.n = left; else r.arr[r.i] = null;
      return;
    }
    var it = ITEMS[s.id];
    if (screen === 'chest' && bent) { insertInto(bent.slots, range(0, 27), s); }
    else if (screen === 'furnace' && bent) {
      if (KC.SMELT[s.id] !== undefined) insertInto(bent.slots, [0], s);
      else if (it && it.fuel) insertInto(bent.slots, [1], s);
      else insertInto(P.inv, r.i < 9 ? range(9, 36) : range(0, 9), s);
    } else if (it && it.armor && !P.armor[it.armor.slot] && !P.creative) {
      P.armor[it.armor.slot] = { id: s.id, n: 1, d: s.d }; s.n--;
    } else insertInto(P.inv, r.i < 9 ? range(9, 36) : range(0, 9), s);
    if (!s.n) r.arr[r.i] = null;
  }

  // ---- Крафт ---------------------------------------------------------------------------
  function grid() { return screen === 'table' ? craft3 : craft2; }
  function gridIds() { return grid().map(function (s) { return s ? s.id : 0; }); }
  function currentRecipe() {
    if (screen !== 'inventory' && screen !== 'table') return null;
    if (screen === 'inventory' && P.creative) return null;
    var g = grid(), w = g.length === 9 ? 3 : 2;
    return KC.matchRecipe(gridIds(), w, w);
  }
  function takeResult(all) {
    var rc = currentRecipe();
    if (!rc) return;
    var times = 0;
    do {
      var out = { id: rc.out, n: rc.count, d: 0 };
      if (all) { if (P.give(clone(out))) { if (hooks.drop) hooks.drop(out); } }
      else {
        if (cursor && (!same(cursor, out) || cursor.n + out.n > maxOf(out))) return;
        if (cursor) cursor.n += out.n; else cursor = out;
      }
      var g = grid();
      for (var i = 0; i < g.length; i++) {
        if (!g[i]) continue;
        var id = g[i].id;
        g[i].n--;
        if (!g[i].n) g[i] = null;
        if (id === KC.I.WATER_BUCKET || id === KC.I.LAVA_BUCKET) g[i] = { id: KC.I.BUCKET, n: 1, d: 0 };
      }
      times++;
    } while (all && times < 64 && KC.matchRecipe(gridIds(), grid().length === 9 ? 3 : 2, grid().length === 9 ? 3 : 2) === rc);
    if (hooks.sound) hooks.sound('place:wood');
  }

  // Подбор ингредиентов из инвентаря для книги рецептов
  function planIngredients(rc) {
    var counts = {};
    P.inv.forEach(function (s) { if (s) counts[s.id] = (counts[s.id] || 0) + s.n; });
    var needs = KC.recipeNeeds(rc), plan = [];
    for (var i = 0; i < needs.length; i++) {
      var opts = needs[i], best = -1;
      for (var k = 0; k < opts.length; k++) if ((counts[opts[k]] || 0) > 0 && (best < 0 || counts[opts[k]] > counts[best])) best = opts[k];
      if (best < 0) return null;
      counts[best]--;
      plan.push(best);
    }
    return plan;
  }
  function craftFromBook(rc, all) {
    if (!P.creative && !KC.recipeFits2x2(rc) && screen !== 'table') { toast('Этот рецепт — только на верстаке'); return; }
    var times = 0;
    while (times < (all ? 64 : 1)) {
      var plan = P.creative ? [] : planIngredients(rc);
      if (!plan) break;
      plan.forEach(function (id) { P.consume(id, 1); if (id === KC.I.WATER_BUCKET || id === KC.I.LAVA_BUCKET) P.give({ id: KC.I.BUCKET, n: 1 }); });
      var out = { id: rc.out, n: rc.count, d: 0 };
      var left = P.give(out);
      if (left && hooks.drop) hooks.drop({ id: rc.out, n: left, d: 0 });
      times++;
    }
    if (!times) toast('Не хватает материалов');
    else if (hooks.sound) hooks.sound('place:wood');
    afterChange();
  }

  // ---- Построение экрана ---------------------------------------------------------------
  var slotEls = [];   // [{ el, r }]
  function bindSlot(el, r) {
    slotEls.push({ el: el, r: r });
    var pressT = 0, longFired = false;
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      lastPointer.x = e.clientX; lastPointer.y = e.clientY;
      if (e.pointerType === 'mouse') { clickSlot(r, e.button === 2 ? 2 : 0, e.shiftKey); return; }
      longFired = false;
      clearTimeout(pressT);
      pressT = setTimeout(function () { longFired = true; clickSlot(r, 2, false); }, 420);
    });
    el.addEventListener('pointerup', function (e) {
      if (e.pointerType === 'mouse') return;
      clearTimeout(pressT);
      if (!longFired) clickSlot(r, 0, false);
    });
    el.addEventListener('pointercancel', function () { clearTimeout(pressT); });
  }

  function section(title, cls) {
    var wrap = document.createElement('div');
    wrap.className = 'cont-sec' + (cls ? ' ' + cls : '');
    if (title) { var h = document.createElement('h3'); h.textContent = title; wrap.appendChild(h); }
    return wrap;
  }
  function gridOf(arr, idxs, kind, cols, cls) {
    var g = document.createElement('div');
    g.className = 'slot-grid' + (cls ? ' ' + cls : '');
    g.style.setProperty('--cols', cols);
    idxs.forEach(function (i) { var el = makeSlot(); bindSlot(el, ref(arr, i, kind)); g.appendChild(el); });
    return g;
  }

  var TITLES = { inventory: 'Инвентарь', table: 'Верстак', furnace: 'Печь', chest: 'Сундук' };

  function open(kind, be, title) {
    screen = kind; bent = be || null; slotEls = [];
    $('cont-title').textContent = kind === 'inventory' && P.creative ? 'Все предметы' : title || TITLES[kind];
    var top = $('cont-top');
    top.innerHTML = '';
    var s;
    if (kind === 'inventory' && P.creative) {
      s = section('', 'cont-palette');
      var pal = document.createElement('div');
      pal.className = 'slot-grid palette';
      KC.CREATIVE.forEach(function (id, i) {
        var el = makeSlot();
        fillSlot(el, { id: id, n: 1 });
        bindSlot(el, ref(KC.CREATIVE, i, 'palette'));
        pal.appendChild(el);
      });
      s.appendChild(pal);
      top.appendChild(s);
    } else if (kind === 'inventory') {
      s = section('Броня', 'cont-armor');
      s.appendChild(gridOf(P.armor, [0, 1, 2, 3], 'armor', 1, 'armor-grid'));
      top.appendChild(s);
      top.appendChild(craftSection(craft2, 2));
    } else if (kind === 'table') {
      top.appendChild(craftSection(craft3, 3));
    } else if (kind === 'furnace') {
      s = section('Плавка', 'cont-furnace');
      var f = document.createElement('div');
      f.className = 'furnace';
      var inEl = makeSlot('f-in'), fuelEl = makeSlot('f-fuel'), outEl = makeSlot('f-out slot--big');
      bindSlot(inEl, ref(bent.slots, 0, 'fin'));
      bindSlot(fuelEl, ref(bent.slots, 1, 'ffuel'));
      bindSlot(outEl, ref(bent.slots, 2, 'fout'));
      var flame = document.createElement('div'); flame.className = 'f-flame'; flame.innerHTML = '<i></i>';
      var arrow = document.createElement('div'); arrow.className = 'f-arrow'; arrow.innerHTML = '<i></i>';
      var col = document.createElement('div'); col.className = 'f-col';
      col.appendChild(inEl); col.appendChild(flame); col.appendChild(fuelEl);
      f.appendChild(col); f.appendChild(arrow); f.appendChild(outEl);
      s.appendChild(f);
      var hint = document.createElement('p'); hint.className = 'cont-hint';
      hint.textContent = 'Сверху — что плавить (руда, песок, сырое мясо), снизу — топливо (уголь, доски).';
      s.appendChild(hint);
      top.appendChild(s);
    } else if (kind === 'chest') {
      s = section('');
      s.appendChild(gridOf(bent.slots, range(0, 27), 'chest', 9));
      top.appendChild(s);
    }
    var main = $('inv-main'), hot = $('inv-hot');
    main.innerHTML = ''; hot.innerHTML = '';
    main.appendChild(gridOf(P.inv, range(9, 36), 'inv', 9));
    hot.appendChild(gridOf(P.inv, range(0, 9), 'inv', 9));
    $('btn-book').hidden = P.creative || (kind !== 'inventory' && kind !== 'table');
    $('book').hidden = !bookOpen || $('btn-book').hidden;
    $('btn-quick').classList.toggle('is-on', quickMode);
    $('container').hidden = false;
    renderContainer();
    renderBook();
  }

  function craftSection(arr, w) {
    var s = section(w === 3 ? 'Крафт 3×3' : 'Крафт 2×2', 'cont-craft');
    var row = document.createElement('div');
    row.className = 'craft';
    row.appendChild(gridOf(arr, range(0, w * w), 'craft', w));
    var arrow = document.createElement('span'); arrow.className = 'craft-arrow'; arrow.textContent = '→';
    row.appendChild(arrow);
    var res = makeSlot('slot--big result');
    bindSlot(res, ref([null], 0, 'result'));
    row.appendChild(res);
    s.appendChild(row);
    return s;
  }

  function renderContainer() {
    if (!screen) return;
    var rc = currentRecipe();
    slotEls.forEach(function (o) {
      if (o.r.kind === 'palette') return;
      if (o.r.kind === 'result') { fillSlot(o.el, rc ? { id: rc.out, n: rc.count } : null); o.el.classList.toggle('is-ready', !!rc); return; }
      fillSlot(o.el, o.r.arr[o.r.i]);
    });
    if (screen === 'furnace' && bent) {
      var fl = document.querySelector('.f-flame i'), ar = document.querySelector('.f-arrow i');
      if (fl) fl.style.height = (bent.burnMax ? bent.burn / bent.burnMax * 100 : 0) + '%';
      if (ar) ar.style.width = (bent.cook / 200 * 100) + '%';
    }
    var cs = $('cursor-stack');
    if (cursor) {
      cs.hidden = false;
      fillSlot(cs, cursor);
      cs.style.transform = 'translate(' + (lastPointer.x - 22) + 'px,' + (lastPointer.y - 22) + 'px)';
    } else cs.hidden = true;
  }

  function renderBook() {
    var list = $('book-list');
    if ($('book').hidden) return;
    list.innerHTML = '';
    var seen = {};
    var rows = KC.RECIPES.map(function (rc) {
      var plan = planIngredients(rc);
      var fits = KC.recipeFits2x2(rc) || screen === 'table';
      return { rc: rc, ok: !!plan && fits, fits: fits };
    }).filter(function (r) { return bookAll || r.ok; });
    rows.sort(function (a, b) { return (b.ok - a.ok) || KC.itemName(a.rc.out).localeCompare(KC.itemName(b.rc.out), 'ru'); });
    rows.forEach(function (r) {
      var k = r.rc.out + ':' + KC.recipeNeeds(r.rc).map(function (o) { return o[0]; }).join(',');
      if (seen[k]) return; seen[k] = 1;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'book-item' + (r.ok ? '' : ' is-missing');
      var need = {};
      KC.recipeNeeds(r.rc).forEach(function (o) { var n = KC.itemName(o[0]); need[n] = (need[n] || 0) + 1; });
      var needTxt = Object.keys(need).map(function (n) { return need[n] + '× ' + n; }).join(', ');
      b.innerHTML = '<img alt=""><span class="bi-name"></span><span class="bi-need"></span>';
      b.querySelector('img').src = iconOf(r.rc.out);
      b.querySelector('.bi-name').textContent = KC.itemName(r.rc.out) + (r.rc.count > 1 ? ' ×' + r.rc.count : '');
      b.querySelector('.bi-need').textContent = (r.fits ? '' : 'Верстак · ') + needTxt;
      b.addEventListener('click', function (e) { craftFromBook(r.rc, e.shiftKey); });
      list.appendChild(b);
    });
    if (!list.children.length) {
      var p = document.createElement('p'); p.className = 'cont-hint';
      p.textContent = 'Пока нечего сделать. Добудьте брёвна — из них получаются доски, а из досок верстак.';
      list.appendChild(p);
    }
  }

  function afterChange() {
    renderContainer();
    renderBook();
    renderHud();
    if (hooks.invChanged) hooks.invChanged();
  }

  // Закрыть экран: вещи из сетки крафта и курсора — обратно в инвентарь
  function close() {
    if (!screen) return;
    var back = [cursor].concat(craft2, craft3);
    cursor = null;
    craft2.fill(null); craft3.fill(null);
    back.forEach(function (s) { if (s && s.n) { var left = P.give(s); if (left && hooks.drop) hooks.drop({ id: s.id, n: left, d: s.d }); } });
    screen = null; bent = null; slotEls = [];
    $('container').hidden = true;
    renderHud();
  }

  function dropCursor() {
    if (!cursor) return;
    if (!P.creative && hooks.drop) hooks.drop(cursor);
    cursor = null;
    afterChange();
  }

  function toast(t) { if (hooks.toast) hooks.toast(t); }

  function bind() {
    $('btn-cont-close').addEventListener('click', function () { if (hooks.close) hooks.close(); });
    $('btn-drop').addEventListener('click', dropCursor);
    $('btn-quick').addEventListener('click', function () { quickMode = !quickMode; $('btn-quick').classList.toggle('is-on', quickMode); });
    $('btn-book').addEventListener('click', function () { bookOpen = !bookOpen; $('book').hidden = !bookOpen; renderBook(); });
    $('book-all').addEventListener('change', function () { bookAll = $('book-all').checked; renderBook(); });
    var cont = $('container');
    cont.addEventListener('pointermove', function (e) {
      lastPointer.x = e.clientX; lastPointer.y = e.clientY;
      if (cursor) $('cursor-stack').style.transform = 'translate(' + (e.clientX - 22) + 'px,' + (e.clientY - 22) + 'px)';
    });
    // щелчок мимо окна с предметом на курсоре — выбросить
    cont.addEventListener('pointerdown', function (e) { if (e.target === cont && cursor) dropCursor(); });
    cont.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function init(h) {
    hooks = h;
    buildHud();
    bind();
  }

  KC.UI = {
    init: init, open: open, close: close, renderHud: renderHud, renderContainer: renderContainer,
    get screen() { return screen; }, get bent() { return bent; },
    tick: function () { if (screen === 'furnace') renderContainer(); },
    iconOf: iconOf, resetIcons: function () { icons = {}; }, forceHud: function () { lastBars = ''; renderHud(); }
  };
})(window.KC = window.KC || {});
