/* ==========================================================
   Городок — пошаговая рогалик-стратегия по мотивам TownsFolk.
   Изометрическая карта из пользовательского ассет-пака
   (assets.js): ромбические тайлы с толщиной, постройки,
   месторождения, иконки. Один IIFE, без зависимостей.
   ========================================================== */
(() => {
  'use strict';

  // ---------- Константы ----------
  const W = 11, H = 11;               // карта 11×11 ромбов
  const CX = 5, CY = 5;               // центр — ратуша
  const TW = 64, TH = 32;             // ромб тайла (логические px)
  const PADX = 8, PADY = 46;          // поля (сверху — под горы и деревья)
  const CANW = PADX * 2 + (W + H - 2) * TW / 2 + TW;      // 720
  const CANH = PADY + (W + H - 2) * TH / 2 + TH + 30;     // 426
  // внутренний масштаб канваса: на больших/чётких экранах рисуем в 3×,
  // чтобы карта оставалась резкой при десктопном увеличении
  const Z = ((window.devicePixelRatio || 1) *
    Math.max(window.screen ? screen.width : 0, window.screen ? screen.height : 0)) >= 1900 ? 3 : 2;
  const TRIBUTE_EVERY = 12;           // дань раз в 12 дней
  const TRIBUTES_TO_WIN = 5;
  const EXPLORE_TURNS_BASE = 2;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const TERRAIN_NAME = {
    grass: 'Луг', forest: 'Лес', mountain: 'Горы', water: 'Вода',
  };

  const CONTENT_NAME = {
    beast: 'Дикий зверь', fertile: 'Плодородная земля', timber: 'Строевой лес',
    ore: 'Богатая жила', fish: 'Рыбное место', tamed: 'Приручённый зверь',
  };

  const BUILDINGS = {
    townhall: { name: 'Ратуша', desc: '+2 ⚒️ и +1 🪙 в день, даёт 6 мест жителям' },
    house:  { name: 'Дом',       terr: 'grass',    cost: { prod: 12 },          desc: '+3 к лимиту жителей' },
    farm:   { name: 'Ферма',     terr: 'grass',    cost: { prod: 14 },          desc: '+4 🍞 в день (плодородие: +2)' },
    lumber: { name: 'Лесопилка', terr: 'forest',   cost: { prod: 16 },          desc: '+2 ⚒️ в день (строевой лес: +1)' },
    mine:   { name: 'Шахта',     terr: 'mountain', cost: { prod: 24 },          desc: '+2 ⚒️ и +2 🪙 в день (жила: +1 🪙)' },
    church: { name: 'Церковь',   terr: 'grass',    cost: { prod: 24, gold: 8 }, desc: '+2 ✨ в день' },
    market: { name: 'Рынок',     terr: 'grass',    cost: { prod: 20, gold: 6 }, desc: '+3 🪙 в день' },
    tavern: { name: 'Таверна',   terr: 'grass',    cost: { prod: 18, gold: 8 }, desc: 'Новые жители прибывают каждый день' },
    dock:   { name: 'Причал',    terr: 'water',    cost: { prod: 12 },          desc: '+3 🍞 в день (рыбное место: +2)' },
  };

  const TECHS = [
    { id: 'cartography', name: 'Картография',   desc: 'Разведка занимает 1 день вместо 2', icon: 't_education' },
    { id: 'crops',       name: 'Севооборот',    desc: 'Фермы дают +2 🍞', icon: 't_farming' },
    { id: 'hunting',     name: 'Охота',         desc: 'Бой со зверем без потерь, добыча +8 🍞', icon: 't_military' },
    { id: 'taming',      name: 'Приручение',    desc: 'Зверей можно приручать за 10 ✨ (+2 🍞 в день)', icon: 't_gathering' },
    { id: 'mining',      name: 'Горное дело',   desc: 'Шахты дают +2 ⚒️', icon: 't_engineering' },
    { id: 'trade',       name: 'Торговые пути', desc: 'Рынки +2 🪙, дань короне −20%', icon: 't_governance' },
    { id: 'masonry',     name: 'Каменная кладка', desc: 'Постройки дешевле на 25%', icon: 't_masonry' },
    { id: 'theology',    name: 'Богословие',    desc: 'Церкви дают +2 ✨', icon: 't_architecture' },
  ];

  // ---------- Состояние ----------
  let S = null;         // всё состояние партии
  let selected = -1;    // индекс выбранной клетки
  let modalQueue = [];  // очередь модальных окон
  let modalOpen = false;
  let placing = null;   // режим размещения постройки (ключ здания)
  let lastEventIdx = -1;

  // ---------- Сохранение партии ----------
  const SAVE_KEY = 'gorodok-save-v1';
  const SEEN_HELP_KEY = 'gorodok-seen-help';

  function saveGame() {
    try {
      const tiles = S.tiles.map(t => ({
        t: t.t, vis: t.vis, b: t.b, c: t.c, explore: t.explore, v: t.v, d: t.d,
      }));
      localStorage.setItem(SAVE_KEY, JSON.stringify(Object.assign({}, S, { tiles })));
    } catch (e) { /* приватный режим — играем без сохранений */ }
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.tiles) || data.tiles.length !== W * H || data.over) return false;
      data.tiles = data.tiles.map(t => Object.assign({ pop: 0 }, t));
      S = data;
      selected = -1;
      modalQueue = [];
      modalOpen = false;
      placing = null;
      walkers = [];
      rebuildPaths();
      document.getElementById('log').innerHTML = '';
      log(`С возвращением! Партия продолжается — день ${S.turn}.`);
      renderAll();
      return true;
    } catch (e) { return false; }
  }

  const rnd = (n) => Math.floor(Math.random() * n);
  const chance = (p) => Math.random() < p;
  const idx = (x, y) => y * W + x;
  const inMap = (x, y) => x >= 0 && x < W && y >= 0 && y < H;

  // Соседи по сторонам ромба (изометрическая = квадратная сетка)
  function neighbors4(i) {
    const x = i % W, y = (i / W) | 0, out = [];
    if (inMap(x - 1, y)) out.push(idx(x - 1, y));
    if (inMap(x + 1, y)) out.push(idx(x + 1, y));
    if (inMap(x, y - 1)) out.push(idx(x, y - 1));
    if (inMap(x, y + 1)) out.push(idx(x, y + 1));
    return out;
  }

  function neighbors8(i) {
    const x = i % W, y = (i / W) | 0, out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (inMap(x + dx, y + dy)) out.push(idx(x + dx, y + dy));
      }
    }
    return out;
  }

  // Изометрическая проекция: верхняя вершина ромба тайла
  function tileOrigin(i) {
    const x = i % W, y = (i / W) | 0;
    return {
      sx: PADX + (x - y + H - 1) * TW / 2,
      sy: PADY + (x + y) * TH / 2,
    };
  }

  // ---------- Генерация карты ----------
  function genMap() {
    const tiles = [];
    for (let i = 0; i < W * H; i++) {
      const r = Math.random();
      let t = 'grass';
      if (r > .85) t = 'water';
      else if (r > .70) t = 'mountain';
      else if (r > .48) t = 'forest';
      tiles.push({ t, vis: 0, b: null, c: null, explore: 0, v: rnd(2), pop: 0, d: null });
    }
    // Сглаживание: клетка с 50% перенимает террейн случайного соседа
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < tiles.length; i++) {
        if (chance(.5)) {
          const ns = neighbors4(i);
          tiles[i].t = tiles[ns[rnd(ns.length)]].t;
        }
      }
    }
    // Гарантии старта: центр — луг с ратушей, вокруг есть луга и лес
    const c = idx(CX, CY);
    tiles[c].t = 'grass';
    tiles[c].b = 'townhall';
    tiles[c].vis = 2;
    tiles[idx(CX - 1, CY)].t = 'grass';
    tiles[idx(CX + 1, CY)].t = 'grass';
    tiles[idx(CX, CY - 1)].t = 'forest';
    // Гарантия гор где-то на карте
    if (!tiles.some(tl => tl.t === 'mountain')) {
      tiles[idx(rnd(W), rnd(3))].t = 'mountain';
    }
    // Стартовое поселение: ратуша + соседние клетки уже освоены
    for (const n of neighbors4(c)) tiles[n].vis = 2;
    for (const s of [c, ...neighbors4(c)]) {
      for (const n of neighbors8(s)) tiles[n].vis = Math.max(tiles[n].vis, 1);
    }
    // декор лугов: загоны с овцами, стога, валуны — оживляют деревню
    for (const t of tiles) {
      if (t.t !== 'grass') continue;
      const r = Math.random();
      if (r < .18) t.d = 'pen';
      else if (r < .30) t.d = 'hay';
      else if (r < .40) t.d = 'rocks';
    }
    return tiles;
  }

  function rollContent(t) {
    const r = Math.random();
    if (t === 'grass') {
      if (r < .12) return 'treasure';
      if (r < .20) return 'ruins';
      if (r < .34) return 'beast';
      if (r < .48) return 'fertile';
    } else if (t === 'forest') {
      if (r < .10) return 'treasure';
      if (r < .26) return 'beast';
      if (r < .42) return 'timber';
    } else if (t === 'mountain') {
      if (r < .10) return 'treasure';
      if (r < .20) return 'ruins';
      if (r < .42) return 'ore';
    } else if (t === 'water') {
      if (r < .32) return 'fish';
    }
    return null;
  }

  // ---------- Новая партия ----------
  function newGame() {
    S = {
      turn: 1,
      tiles: genMap(),
      pop: 4, cap: 6,
      food: 30, prod: 14, gold: 12, faith: 2, sci: 0,
      techs: {},
      tributesPaid: 0,
      nextTribute: TRIBUTE_EVERY,
      postpones: 3,
      tributeBonus: 0,   // надбавка к дани от событий
      growth: 0,
      over: false,
      won: false,
    };
    selected = -1;
    modalQueue = [];
    modalOpen = false;
    walkers = [];
    rebuildPaths();
    document.getElementById('log').innerHTML = '';
    log('Король дал вам землю и год сроку. Стройте, исследуйте — и готовьте дань.');
    renderAll();
    saveGame();
  }

  // ---------- Утилиты состояния ----------
  function busyCitizens() {
    return S.tiles.reduce((n, t) => n + (t.explore > 0 ? 1 : 0), 0);
  }
  function freeCitizens() { return Math.max(0, S.pop - busyCitizens()); }

  function buildCost(key) {
    const base = BUILDINGS[key].cost;
    const k = S.techs.masonry ? .75 : 1;
    const out = {};
    for (const r in base) out[r] = Math.ceil(base[r] * k);
    return out;
  }

  function canAfford(cost) {
    return (!cost.prod || S.prod >= cost.prod) && (!cost.gold || S.gold >= cost.gold);
  }

  function pay(cost) {
    if (cost.prod) S.prod -= cost.prod;
    if (cost.gold) S.gold -= cost.gold;
  }

  function exploreTurns() { return S.techs.cartography ? 1 : EXPLORE_TURNS_BASE; }

  // Дневной доход по каждому ресурсу
  function income() {
    const inc = { food: 0, prod: 2, gold: 1, faith: 0 }; // ратуша
    for (const t of S.tiles) {
      if (t.vis !== 2) continue;
      if (t.c === 'tamed') inc.food += 2;
      switch (t.b) {
        case 'farm':   inc.food += 4 + (t.c === 'fertile' ? 2 : 0) + (S.techs.crops ? 2 : 0); break;
        case 'dock':   inc.food += 3 + (t.c === 'fish' ? 2 : 0); break;
        case 'lumber': inc.prod += 2 + (t.c === 'timber' ? 1 : 0); break;
        case 'mine':
          inc.prod += 2 + (S.techs.mining ? 2 : 0);
          inc.gold += 2 + (t.c === 'ore' ? 1 : 0);
          break;
        case 'market': inc.gold += 3 + (S.techs.trade ? 2 : 0); break;
        case 'church': inc.faith += 2 + (S.techs.theology ? 2 : 0); break;
      }
    }
    return inc;
  }

  function tributeDemand(n) {
    const k = S.techs.trade ? .8 : 1;
    return {
      gold: Math.ceil((10 + 12 * n + S.tributeBonus) * k),
      food: Math.ceil((8 + 6 * n) * k),
    };
  }

  // ---------- Журнал ----------
  let unreadLog = 0;

  function log(msg, cls) {
    const el = document.getElementById('log');
    const p = document.createElement('p');
    if (cls) p.className = cls;
    p.innerHTML = `<b>Д${S.turn}</b> ${msg}`;
    el.prepend(p);
    while (el.children.length > 40) el.removeChild(el.lastChild);
    const overlay = document.getElementById('log-overlay');
    if (overlay && overlay.hidden) unreadLog++;
  }

  function updateBadges() {
    const be = document.getElementById('badge-events');
    const bl = document.getElementById('badge-log');
    if (be) {
      be.hidden = modalQueue.length === 0;
      be.textContent = modalQueue.length;
    }
    if (bl) {
      bl.hidden = unreadLog === 0;
      bl.textContent = Math.min(unreadLog, 9);
    }
  }

  // Всплывающий текст над клеткой
  function floatText(i, text, cls) {
    if (reduceMotion) return;
    const wrap = document.querySelector('.map-inner');
    const scale = canvas.clientWidth / CANW;
    const { sx, sy } = tileOrigin(i);
    const el = document.createElement('span');
    el.className = 'floater' + (cls ? ` ${cls}` : '');
    el.textContent = text;
    el.style.left = `${canvas.offsetLeft + (sx + TW / 2) * scale}px`;
    el.style.top = `${canvas.offsetTop + sy * scale}px`;
    el.addEventListener('animationend', () => el.remove());
    wrap.appendChild(el);
  }

  // ---------- Ход (конец дня) ----------
  function endDay() {
    if (S.over || modalOpen) return;
    S.turn++;

    // 1. Разведка продвигается
    for (let i = 0; i < S.tiles.length; i++) {
      const t = S.tiles[i];
      if (t.explore > 0 && --t.explore === 0) revealTile(i);
    }

    // 2. Доход
    const inc = income();
    S.food += inc.food; S.prod += inc.prod; S.gold += inc.gold; S.faith += inc.faith;
    S.sci += 1;

    // 3. Прокорм и голод
    S.food -= S.pop;
    if (S.food < 0) {
      S.food = 0;
      S.pop--;
      log('Голод! Один житель умер. Стройте фермы.', 'log--bad');
    }

    // 4. Набеги зверей
    for (let i = 0; i < S.tiles.length; i++) {
      const t = S.tiles[i];
      if (t.vis === 2 && t.c === 'beast' && chance(.33)) {
        if (S.food >= 4) {
          S.food -= 4;
          log('Зверь разорил припасы: −4 🍞.', 'log--bad');
          floatText(i, '−4 🍞', 'floater--bad');
        } else {
          S.pop--;
          log('Зверь напал на жителя! −1 👥.', 'log--bad');
          floatText(i, '−1 👥', 'floater--bad');
        }
      }
    }

    // 5. Прирост населения
    if (S.pop > 0 && S.pop < S.cap && S.food >= S.pop * 2) {
      S.growth++;
      const need = S.tiles.some(t => t.vis === 2 && t.b === 'tavern') ? 1 : 2;
      if (S.growth >= need) { S.growth = 0; S.pop++; log('В городок прибыл новый житель. +1 👥', 'log--good'); }
    } else {
      S.growth = 0;
    }

    // 6. Поражение от вымирания
    if (S.pop <= 0) return gameOver('Все жители погибли. Колония пала.');

    // 7. Предупреждение о дани
    if (S.nextTribute - S.turn === 3 && !S.won) {
      log('⚠️ Через 3 дня гонец короля прибудет за данью. Готовьте припасы!', 'log--bad');
    }

    // 8. Дань или случайное событие (одно и то же не подряд)
    if (S.turn >= S.nextTribute) {
      queueTribute();
    } else if (S.turn > 3 && chance(.25)) {
      let ei = rnd(EVENTS.length);
      if (ei === lastEventIdx) ei = (ei + 1) % EVENTS.length;
      lastEventIdx = ei;
      queueEvent(EVENTS[ei]);
    }

    placing = null;
    renderAll();
    nextModal();
    saveGame();
  }

  function revealTile(i) {
    const t = S.tiles[i];
    t.vis = 2;
    t.pop = performance.now(); // анимация «появления»
    for (const n of neighbors8(i)) S.tiles[n].vis = Math.max(S.tiles[n].vis, 1);
    const c = rollContent(t.t);
    if (c === 'treasure') {
      const g = 15 + rnd(16);
      S.gold += g;
      log(`Разведчики нашли клад: +${g} 🪙!`, 'log--good');
      floatText(i, `+${g} 🪙`, 'floater--good');
    } else if (c === 'ruins') {
      S.sci += 4;
      log('В древних руинах найдены знания: +4 🔬.', 'log--good');
      floatText(i, '+4 🔬', 'floater--good');
    } else if (c) {
      t.c = c;
      if (c === 'beast') { log('Разведчики наткнулись на логово зверя!', 'log--bad'); floatText(i, '🐺!', 'floater--bad'); }
      else log(`Разведана новая земля: ${CONTENT_NAME[c].toLowerCase()}.`, 'log--good');
    } else {
      log(`Разведана новая земля (${TERRAIN_NAME[t.t].toLowerCase()}).`);
    }
  }

  function gameOver(reason) {
    S.over = true;
    renderAll();
    showModal('☠️ Колония потеряна', reason, [
      { label: '🔁 Новая попытка', fn: newGame },
    ], 'ev_plague');
  }

  // ---------- Дань короне ----------
  function queueTribute() {
    modalQueue.push(() => {
      const n = S.tributesPaid + 1;
      const d = tributeDemand(n);
      const text = `Гонец короля требует дань №${n} из ${TRIBUTES_TO_WIN}:\n` +
        `${d.gold} 🪙 и ${d.food} 🍞.\n\nОтсрочек осталось: ${S.postpones}.`;
      const buttons = [];
      buttons.push({
        label: `Заплатить (−${d.gold} 🪙, −${d.food} 🍞)`,
        disabled: S.gold < d.gold || S.food < d.food,
        fn: () => {
          S.gold -= d.gold; S.food -= d.food;
          S.tributesPaid++; S.sci += 5;
          S.tributeBonus = 0;
          S.nextTribute = S.turn + TRIBUTE_EVERY;
          log(`Дань №${n} уплачена. Король доволен. +5 🔬`, 'log--good');
          if (S.tributesPaid >= TRIBUTES_TO_WIN && !S.won) victory();
          renderAll();
          saveGame();
        },
      });
      if (S.postpones > 0) {
        buttons.push({
          label: `Просить отсрочку (+3 дня, спрос +25%)`,
          sub: `Осталось отсрочек: ${S.postpones}`,
          fn: () => {
            S.postpones--;
            S.tributeBonus += Math.ceil((10 + 12 * n) * .25);
            S.nextTribute = S.turn + 3;
            log('Король дал отсрочку, но требования выросли.', 'log--bad');
            renderAll();
            saveGame();
          },
        });
      }
      if ((S.gold < tributeDemand(n).gold || S.food < tributeDemand(n).food) && S.postpones <= 0) {
        buttons.length = 0;
        buttons.push({
          label: 'Признать поражение…',
          fn: () => gameOver('Платить нечем, отсрочек нет. Король отозвал покровительство.'),
        });
      }
      showModal('👑 Дань короне', text, buttons, 'ev_kingstax');
    });
  }

  function victory() {
    S.won = true;
    modalQueue.push(() => showModal(
      '🏆 Победа!',
      `Вы выплатили все ${TRIBUTES_TO_WIN} даней за ${S.turn} дней и заслужили милость короля.\n` +
      `Жителей: ${S.pop}. Городок процветает!\n\nМожно продолжить играть без цели или начать заново.`,
      [
        { label: '▶️ Продолжить правление', fn: () => {} },
        { label: '🔁 Новая партия', fn: newGame },
      ],
      't_governance'
    ));
  }

  // ---------- Случайные события ----------
  const EVENTS = [
    {
      title: '🚶 Странник у ворот',
      text: 'К воротам вышел измождённый путник и просит приюта.',
      img: 'ev_merchants',
      opts: [
        { label: 'Принять (−6 🍞, +1 👥)', need: { food: 6 },
          fn: () => { S.food -= 6; if (S.pop < S.cap) { S.pop++; log('Странник остался жить в городке. +1 👥', 'log--good'); } else log('Странник поел и ушёл — жить негде.'); } },
        { label: 'Прогнать (−2 ✨)',
          fn: () => { S.faith = Math.max(0, S.faith - 2); log('Странника прогнали. Люди ропщут. −2 ✨', 'log--bad'); } },
      ],
    },
    {
      title: '🛒 Торговый караван',
      text: 'Через городок проходит караван. Торговцы предлагают сделки.',
      img: 'ev_merchants',
      opts: [
        { label: 'Купить еду (−12 🪙, +18 🍞)', need: { gold: 12 },
          fn: () => { S.gold -= 12; S.food += 18; log('Куплены припасы у каравана.', 'log--good'); } },
        { label: 'Продать зерно (−12 🍞, +14 🪙)', need: { food: 12 },
          fn: () => { S.food -= 12; S.gold += 14; log('Зерно продано каравану.', 'log--good'); } },
        { label: 'Пропустить караван', fn: () => { log('Караван ушёл дальше.'); } },
      ],
    },
    {
      title: '🔥 Пожар на складе',
      text: 'Ночью загорелся склад! Огонь вот-вот перекинется на припасы.',
      img: 'fx_fire',
      opts: [
        { label: 'Тушить всем селом (−6 ⚒️)', need: { prod: 6 },
          fn: () => { S.prod -= 6; log('Пожар потушен ценой материалов.', 'log--good'); } },
        { label: 'Молиться о дожде (−8 ✨)', need: { faith: 8 },
          fn: () => { S.faith -= 8; log('Хлынул ливень — склад спасён чудом!', 'log--good'); } },
        { label: 'Спасать что успеем (−12 🍞)',
          fn: () => { S.food = Math.max(0, S.food - 12); log('Часть припасов сгорела. −12 🍞', 'log--bad'); } },
      ],
    },
    {
      title: '☀️ Засуха',
      text: 'Уже неделю ни капли дождя. Поля сохнут.',
      img: 'ev_harvest',
      opts: [
        { label: 'Молебен о дожде (−6 ✨)', need: { faith: 6 },
          fn: () => { S.faith -= 6; log('После молебна пошёл дождь. Урожай спасён.', 'log--good'); } },
        { label: 'Терпеть (−10 🍞)',
          fn: () => { S.food = Math.max(0, S.food - 10); log('Засуха погубила часть урожая. −10 🍞', 'log--bad'); } },
      ],
    },
    {
      title: '🎉 Праздник урожая',
      text: 'Жители просят устроить праздник в честь удачного сезона.',
      opts: [
        { label: 'Устроить пир (−8 🍞, +6 ✨)', need: { food: 8 },
          fn: () => { S.food -= 8; S.faith += 6; log('Праздник удался! +6 ✨', 'log--good'); } },
        { label: 'Работать как обычно (+4 ⚒️)',
          fn: () => { S.prod += 4; log('Вместо праздника — трудовой день. +4 ⚒️'); } },
      ],
    },
    {
      title: '📜 Сборщик податей',
      text: 'Королевский сборщик явился раньше срока и требует «добровольный» взнос.',
      img: 'ev_kingstax',
      opts: [
        { label: 'Заплатить (−10 🪙)', need: { gold: 10 },
          fn: () => { S.gold -= 10; log('Сборщик уехал довольный. −10 🪙', 'log--bad'); } },
        { label: 'Отказать (−4 ✨, дань +5 🪙)',
          fn: () => { S.faith = Math.max(0, S.faith - 4); S.tributeBonus += 5; log('Сборщик затаил обиду. Следующая дань выше.', 'log--bad'); } },
      ],
    },
    {
      title: '🐺 Волчий вой',
      text: 'По ночам вокруг городка воют волки. Люди боятся выходить.',
      img: 'ev_bandit',
      opts: [
        { label: 'Выставить дозор (−4 ⚒️)', need: { prod: 4 },
          fn: () => { S.prod -= 4; log('Дозор отогнал стаю.', 'log--good'); } },
        { label: 'Ничего не делать',
          fn: () => {
            const spots = S.tiles
              .map((t, i) => ({ t, i }))
              .filter(o => o.t.vis === 2 && !o.t.b && !o.t.c && o.t.t !== 'water');
            if (spots.length) {
              spots[rnd(spots.length)].t.c = 'beast';
              log('Стая поселилась у самого городка!', 'log--bad');
            } else {
              log('Волки повыли и ушли.');
            }
          } },
      ],
    },
    {
      title: '⛪ Заезжий проповедник',
      text: 'Странствующий проповедник готов прочитать проповедь на площади.',
      opts: [
        { label: 'Пожертвовать (−8 🪙, +6 ✨)', need: { gold: 8 },
          fn: () => { S.gold -= 8; S.faith += 6; log('Проповедь воодушевила жителей. +6 ✨', 'log--good'); } },
        { label: 'Выслушать бесплатно (+1 ✨)',
          fn: () => { S.faith += 1; log('Проповедник ушёл, слегка обидевшись. +1 ✨'); } },
      ],
    },
  ];

  function queueEvent(ev) {
    modalQueue.push(() => {
      const buttons = ev.opts.map(o => ({
        label: o.label,
        disabled: o.need && (
          (o.need.gold && S.gold < o.need.gold) ||
          (o.need.food && S.food < o.need.food) ||
          (o.need.prod && S.prod < o.need.prod) ||
          (o.need.faith && S.faith < o.need.faith)
        ),
        fn: () => { o.fn(); renderAll(); saveGame(); },
      }));
      showModal(ev.title, ev.text, buttons, ev.img);
    });
  }

  // ---------- Модальные окна ----------
  function showModal(title, text, buttons, imgKey) {
    modalOpen = true;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-text').textContent = text;
    const pic = document.getElementById('modal-pic');
    if (pic) {
      if (imgKey && typeof ASSETS !== 'undefined' && ASSETS[imgKey]) {
        pic.src = ASSETS[imgKey];
        pic.hidden = false;
      } else {
        pic.hidden = true;
      }
    }
    const box = document.getElementById('modal-buttons');
    box.classList.remove('is-list');
    box.innerHTML = '';
    buttons.forEach((b, bi) => {
      const btn = document.createElement('button');
      btn.className = 'btn' + (bi === 0 && buttons.length > 1 ? ' btn--primary' : '');
      btn.innerHTML = b.sub ? `${b.label}<small>${b.sub}</small>` : b.label;
      btn.disabled = !!b.disabled;
      btn.addEventListener('click', () => {
        closeModal();
        b.fn();
        renderAll();
        nextModal();
      });
      box.appendChild(btn);
    });
    document.getElementById('modal').hidden = false;
  }

  function closeModal() {
    modalOpen = false;
    document.getElementById('modal').hidden = true;
  }

  function nextModal() {
    if (!modalOpen && modalQueue.length) modalQueue.shift()();
  }

  // ---------- Технологии ----------
  function techCost() {
    const owned = Object.keys(S.techs).length;
    return Math.ceil(8 * Math.pow(1.5, owned));
  }

  function openTech() {
    if (modalOpen) return;
    const cost = techCost();
    const box = document.getElementById('modal-buttons');
    document.getElementById('modal-title').textContent = '🔬 Технологии';
    document.getElementById('modal-text').textContent =
      `Очков знаний: ${S.sci}. Следующее открытие стоит ${cost} 🔬 (дорожает с каждым).`;
    const pic = document.getElementById('modal-pic');
    if (pic) pic.hidden = true;
    box.classList.add('is-list');
    box.innerHTML = '';
    for (const t of TECHS) {
      const row = document.createElement('div');
      row.className = 'tech-row' + (S.techs[t.id] ? ' is-owned' : '');
      const info = document.createElement('div');
      info.className = 'tech-info';
      const hasIcon = t.icon && typeof ASSETS !== 'undefined' && ASSETS[t.icon];
      info.innerHTML = (hasIcon ? `<img class="tech-ico" src="${ASSETS[t.icon]}" alt="">` : '') +
                       `<div><div class="tech-name">${S.techs[t.id] ? '✅ ' : ''}${t.name}</div>` +
                       `<div class="tech-desc">${t.desc}</div></div>`;
      row.appendChild(info);
      if (!S.techs[t.id]) {
        const btn = document.createElement('button');
        btn.className = 'btn btn--small';
        btn.textContent = `${cost} 🔬`;
        btn.disabled = S.sci < cost || S.over;
        btn.addEventListener('click', () => {
          S.sci -= cost;
          S.techs[t.id] = true;
          log(`Открыта технология «${t.name}»!`, 'log--good');
          renderAll();
          saveGame();
          openTechRefresh();
        });
        row.appendChild(btn);
      }
      box.appendChild(row);
    }
    const close = document.createElement('button');
    close.className = 'btn btn--primary';
    close.textContent = 'Закрыть';
    close.addEventListener('click', () => { closeModal(); nextModal(); });
    box.appendChild(close);
    modalOpen = true;
    document.getElementById('modal').hidden = false;
  }

  function openTechRefresh() { modalOpen = false; openTech(); }

  // ---------- Действия на клетке ----------
  function startExplore(i) {
    const t = S.tiles[i];
    if (t.vis !== 1 || t.explore > 0) return;
    if (!neighbors4(i).some(n => S.tiles[n].vis === 2)) return;
    if (freeCitizens() < 1) { log('Нет свободных жителей для разведки.', 'log--bad'); return; }
    t.explore = exploreTurns();
    const dir = { grass: 'в луга', forest: 'в лес', mountain: 'в горы', water: 'на воду' };
    log(`Разведчик отправился ${dir[t.t]} (${t.explore} дн.).`);
    floatText(i, '🔦', 'floater--good');
    renderAll();
    saveGame();
  }

  function canPlace(i, key) {
    const t = S.tiles[i];
    return t.vis === 2 && !t.b && t.c !== 'beast' && t.t === BUILDINGS[key].terr;
  }

  function placeTargets(key) {
    const out = [];
    for (let i = 0; i < S.tiles.length; i++) {
      if (canPlace(i, key)) out.push(i);
    }
    return out;
  }

  function build(i, key) {
    if (i < 0 || !canPlace(i, key)) return;
    const cost = buildCost(key);
    if (!canAfford(cost)) return;
    const t = S.tiles[i];
    pay(cost);
    t.b = key;
    t.pop = performance.now();
    rebuildPaths();
    if (key === 'house') S.cap += 3;
    S.sci += 2;
    placing = null;
    selected = i;
    log(`Построен объект «${BUILDINGS[key].name}». +2 🔬`, 'log--good');
    floatText(i, '⚒️', 'floater--good');
    renderAll();
    saveGame();
  }

  function fightBeast(i) {
    const t = S.tiles[i];
    if (t.c !== 'beast') return;
    if (S.techs.hunting) {
      t.c = null;
      S.food += 8;
      log('Охотники выследили зверя без потерь. +8 🍞', 'log--good');
      floatText(i, '+8 🍞', 'floater--good');
    } else {
      if (freeCitizens() < 2) { log('Для боя нужно хотя бы 2 свободных жителя.', 'log--bad'); return; }
      S.pop--;
      t.c = null;
      log('Зверь повержен, но один житель погиб в бою. −1 👥', 'log--bad');
      floatText(i, '−1 👥', 'floater--bad');
      if (S.pop <= 0) return gameOver('Последний житель погиб в схватке со зверем.');
    }
    renderAll();
    saveGame();
  }

  function tameBeast(i) {
    const t = S.tiles[i];
    if (t.c !== 'beast' || !S.techs.taming || S.faith < 10) return;
    S.faith -= 10;
    t.c = 'tamed';
    log('Зверь приручён и теперь помогает добывать еду! +2 🍞 в день', 'log--good');
    floatText(i, '🐾', 'floater--good');
    renderAll();
    saveGame();
  }

  /* ==========================================================
     АССЕТЫ: изометрические тайлы, месторождения, постройки.
     Каждый тайл нормализуется к ширине ромба TW×Z, якорь —
     верхняя вершина ромба (ищется по самой широкой строке).
     ========================================================== */
  const RAW = {};       // исходные Image
  const TIMG = {};      // тайлы: {c, top} + варианты fog/hidden
  const BIMG = {};      // постройки
  const CIMG = {};      // существа

  const TILE_ASSET = {
    grass: ['tl_grass', 'tl_hills'],
    forest: ['tl_forest'],
    mountain: ['tl_mountain'],
    water: ['tl_lake'],
  };
  const DEPOSIT_ASSET = { ore: 'd_gold', fish: 'd_fish', timber: 'd_forest' };
  const BUILD_ASSET = {
    townhall: 'castle', house: 'house', farm: 'farm', lumber: 'sawmill',
    mine: 'mine', church: 'temple', market: 'market', tavern: 'bakery',
    dock: 'harbor',
  };
  const SMOKE_BUILDINGS = { townhall: 1, house: 1, tavern: 1, lumber: 1 };

  function scaleToWidth(img, w) {
    const h = Math.max(1, Math.round(img.height * w / img.width));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    return c;
  }

  function fitCanvas(img, maxW, maxH) {
    const s = Math.min(maxW / img.width, maxH / img.height);
    const w = Math.max(1, Math.round(img.width * s));
    const h = Math.max(1, Math.round(img.height * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    return c;
  }

  // Самая широкая непрозрачная строка = середина ромба
  function widestRow(c) {
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let best = 0, bestW = -1;
    for (let y = 0; y < c.height; y++) {
      let x0 = -1, x1 = -1;
      for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] > 40) { if (x0 < 0) x0 = x; x1 = x; }
      }
      const w = x1 - x0;
      if (w > bestW) { bestW = w; best = y; }
    }
    return best;
  }

  function darken(c, alpha) {
    const o = document.createElement('canvas');
    o.width = c.width; o.height = c.height;
    const g = o.getContext('2d');
    g.drawImage(c, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(7,11,14,${alpha})`;
    g.fillRect(0, 0, o.width, o.height);
    return o;
  }

  const OVERSCAN = 4; // тайлы чуть шире ромба, чтобы не было швов

  function prepTile(key) {
    const im = RAW[key];
    if (!im || !im.width) return null;
    const c = scaleToWidth(im, (TW + OVERSCAN) * Z);
    const top = widestRow(c) - (TH * Z) / 2;
    return { c, fog: darken(c, .55), hidden: darken(c, .8), top };
  }

  function loadAssets(done) {
    if (typeof ASSETS === 'undefined') { done(); return; }
    const keys = Object.keys(ASSETS);
    let left = keys.length;
    if (!left) { done(); return; }
    const fin = () => { if (--left === 0) done(); };
    for (const k of keys) {
      const im = new Image();
      im.onload = fin;
      im.onerror = fin;
      im.src = ASSETS[k];
      RAW[k] = im;
    }
  }

  // Запасной ромб, если ассет не загрузился
  function fallbackTile(colTop, colSide) {
    const c = document.createElement('canvas');
    c.width = TW * Z; c.height = (TH + 14) * Z;
    const g = c.getContext('2d');
    const w = TW * Z, h = TH * Z, d = 14 * Z;
    g.fillStyle = colSide;
    g.beginPath();
    g.moveTo(0, h / 2); g.lineTo(w / 2, h); g.lineTo(w, h / 2);
    g.lineTo(w, h / 2 + d); g.lineTo(w / 2, h + d); g.lineTo(0, h / 2 + d);
    g.closePath(); g.fill();
    g.fillStyle = colTop;
    g.beginPath();
    g.moveTo(w / 2, 0); g.lineTo(w, h / 2); g.lineTo(w / 2, h); g.lineTo(0, h / 2);
    g.closePath(); g.fill();
    return { c, fog: darken(c, .62), hidden: darken(c, .86), top: 0 };
  }

  function prepareAssets() {
    const fallback = {
      grass: fallbackTile('#4a6b3f', '#3a2c1c'),
      forest: fallbackTile('#3a5a32', '#3a2c1c'),
      mountain: fallbackTile('#615f52', '#3a2c1c'),
      water: fallbackTile('#27455c', '#16283a'),
    };
    for (const terr in TILE_ASSET) {
      TIMG[terr] = TILE_ASSET[terr].map(k => prepTile(k) || fallback[terr]);
      if (!TIMG[terr].length) TIMG[terr] = [fallback[terr]];
    }
    for (const c in DEPOSIT_ASSET) {
      const t = prepTile(DEPOSIT_ASSET[c]);
      if (t) TIMG[c] = t;
    }
    for (const key in BUILD_ASSET) {
      const im = RAW[BUILD_ASSET[key]];
      if (im && im.width) BIMG[key] = fitCanvas(im, 46 * Z, 52 * Z);
    }
    if (RAW.a_wolf && RAW.a_wolf.width) CIMG.beast = fitCanvas(RAW.a_wolf, 26 * Z, 26 * Z);
    if (RAW.a_deer && RAW.a_deer.width) CIMG.tamed = fitCanvas(RAW.a_deer, 26 * Z, 26 * Z);
    // иконки ресурсов, герб и угловые кнопки
    const hud = {
      'ico-pop': 'r_pop', 'ico-food': 'r_food', 'ico-prod': 'r_workers',
      'ico-gold': 'r_gold', 'ico-faith': 'r_faith', 'ico-sci': 'r_research',
      'crest': 'castle', 'ico-help': 't_education', 'ico-gear': 't_engineering',
      'ico-day': 'r_workers',
    };
    for (const id in hud) {
      const el = document.getElementById(id);
      if (el && RAW[hud[id]] && RAW[hud[id]].width) el.src = ASSETS[hud[id]];
    }
  }

  /* --- Мелкие процедурные спрайты: маркеры, дым, злаки --- */
  const sprites = {};

  function makeSprite(draw, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'));
    return c;
  }

  function px(g, color, x, y, w = 1, h = 1) {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  }

  function initSprites() {
    const cream = '#e8e0c8', outline = '#0c1112';

    sprites.qmark = makeSprite(g => {
      px(g, outline, 0, 0, 9, 12);
      px(g, cream, 2, 1, 5, 2); px(g, cream, 6, 3, 2, 2); px(g, cream, 4, 5, 2, 2);
      px(g, cream, 4, 7, 1, 1);
      px(g, cream, 4, 9, 2, 2);
    }, 9, 12);

    sprites.hourglass = makeSprite(g => {
      px(g, outline, 0, 0, 9, 12);
      px(g, '#7a5a3a', 1, 1, 7, 1); px(g, '#7a5a3a', 1, 10, 7, 1);
      px(g, '#d9a84c', 2, 2, 5, 3); px(g, '#d9a84c', 4, 5, 1, 2); px(g, '#d9a84c', 2, 7, 5, 3);
      px(g, '#efc76e', 3, 2, 2, 1);
    }, 9, 12);

    sprites.smoke = [0, 1].map(f => makeSprite(g => {
      const a = '#b2ac9e', b = '#8f8a7d';
      if (f === 0) {
        px(g, b, 3, 8, 3, 2); px(g, a, 2, 4, 4, 3); px(g, b, 4, 1, 3, 2);
      } else {
        px(g, b, 2, 8, 3, 2); px(g, a, 4, 4, 4, 3); px(g, b, 1, 0, 3, 3);
      }
    }, 10, 11));

    // обводка ромба тайла: золотая (выбор) и зелёная (размещение)
    const diamondOutline = (color) => makeSprite(g => {
      g.strokeStyle = color;
      g.lineWidth = 2 * Z;
      g.beginPath();
      g.moveTo(TW * Z / 2, Z);
      g.lineTo(TW * Z - Z, TH * Z / 2);
      g.lineTo(TW * Z / 2, TH * Z - Z);
      g.lineTo(Z, TH * Z / 2);
      g.closePath();
      g.stroke();
    }, TW * Z, TH * Z);
    sprites.select = diamondOutline('#efc76e');
    sprites.place = diamondOutline('#7fb069');
    sprites.hover = diamondOutline('rgba(226,217,194,.85)');

    // плодородная земля: золотые колосья по ромбу
    sprites.fertile = makeSprite(g => {
      for (const [x, y] of [[24, 8], [38, 12], [18, 16], [32, 20], [44, 17]]) {
        px(g, '#d9a84c', x * Z, (y - 3) * Z, Z, 3 * Z);
        px(g, '#d9a84c', (x - 1) * Z, (y - 2) * Z, Z, Z);
        px(g, '#d9a84c', (x + 1) * Z, (y - 2) * Z, Z, Z);
        px(g, '#efc76e', x * Z, (y - 3) * Z, Z, Z);
      }
    }, TW * Z, TH * Z);

    // жители 6×9: три цвета туники × два кадра шага
    const tunics = ['#8e4a3a', '#3f6d9e', '#5c7a3c'];
    sprites.walker = tunics.map(col => [0, 1].map(f => makeSprite(g => {
      px(g, '#0c1112', 1, 0, 4, 9);            // силуэт-обводка
      px(g, '#d8b58c', 2, 1, 2, 2);            // голова
      px(g, col, 1, 3, 4, 3);                  // туника
      px(g, '#2a2320', f ? 1 : 3, 6, 1, 2);    // ноги (шаг)
      px(g, '#2a2320', f ? 3 : 1, 6, 1, 3);
    }, 6, 9)));

    // --- декор лугов (в координатах ромба ×Z) ---
    const sheepAt = (g, x, y) => {
      px(g, '#0c1112', (x - 1) * Z, (y - 1) * Z, 6 * Z, 5 * Z);
      px(g, '#e8e0c8', x * Z, y * Z, 4 * Z, 3 * Z);
      px(g, '#f2ece0', x * Z, y * Z, 2 * Z, Z);
      px(g, '#8f8877', (x + 3) * Z, y * Z, Z, Z);
    };
    // загон: жерди изгороди + две овцы
    sprites.decorPen = makeSprite(g => {
      const rail = '#96744c', post = '#6b512c';
      for (const [x0, y0, x1, y1] of [[30, 9, 54, 9], [30, 15, 54, 15]]) {
        for (let x = x0; x <= x1; x += 1) px(g, rail, x * Z, (y0 + ((x - x0) % 8 === 4 ? 0 : 0)) * Z, Z, Z);
        void y1;
      }
      for (let x = 30; x <= 54; x += 6) { px(g, post, x * Z, 7 * Z, Z, 4 * Z); px(g, post, x * Z, 13 * Z, Z, 4 * Z); }
      sheepAt(g, 36, 11); sheepAt(g, 45, 12);
    }, TW * Z, TH * Z);
    // стога сена
    sprites.decorHay = makeSprite(g => {
      for (const [x, y] of [[14, 12], [22, 17]]) {
        px(g, '#0c1112', (x - 1) * Z, (y - 1) * Z, 7 * Z, 5 * Z);
        px(g, '#d9a84c', x * Z, y * Z, 5 * Z, 3 * Z);
        px(g, '#efc76e', (x + 1) * Z, (y - 1) * Z, 3 * Z, Z);
        px(g, '#efc76e', x * Z, y * Z, Z, 2 * Z);
        px(g, '#a97c2e', (x + 4) * Z, (y + 1) * Z, Z, 2 * Z);
      }
    }, TW * Z, TH * Z);
    // валуны
    sprites.decorRocks = makeSprite(g => {
      for (const [x, y, w] of [[38, 18, 5], [46, 15, 3]]) {
        px(g, '#0c1112', (x - 1) * Z, (y - 1) * Z, (w + 2) * Z, 4 * Z);
        px(g, '#6e6c60', x * Z, y * Z, w * Z, 2 * Z);
        px(g, '#8a8577', x * Z, y * Z, (w - 1) * Z, Z);
      }
    }, TW * Z, TH * Z);
  }

  const DECOR_SPRITE = { pen: 'decorPen', hay: 'decorHay', rocks: 'decorRocks' };

  // ---------- Отрисовка ----------
  const canvas = document.getElementById('map');
  canvas.width = CANW * Z;
  canvas.height = CANH * Z;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // блики на воде (два кадра)
  const SPARKS = [
    [[20, 12], [40, 18], [30, 22]],
    [[24, 14], [44, 16], [34, 24]],
  ];

  // --- Дороги между постройками (дерево кратчайших связей от ратуши) ---
  let PATHS = [];

  function rebuildPaths() {
    const nodes = [];
    for (let i = 0; i < S.tiles.length; i++) {
      if (S.tiles[i].b) nodes.push(i);
    }
    PATHS = [];
    if (nodes.length < 2) return;
    const connected = [nodes[0]];
    const rest = nodes.slice(1);
    while (rest.length) {
      let bi = 0, ba = connected[0], bd = Infinity;
      for (const a of connected) {
        const [ax, ay] = tileCenter(a);
        for (let k = 0; k < rest.length; k++) {
          const [bx, by] = tileCenter(rest[k]);
          const d = (bx - ax) ** 2 + (by - ay) ** 2;
          if (d < bd) { bd = d; bi = k; ba = a; }
        }
      }
      const b = rest.splice(bi, 1)[0];
      PATHS.push([ba, b]);
      connected.push(b);
    }
  }

  function drawPaths() {
    for (let p = 0; p < PATHS.length; p++) {
      const [a, b] = PATHS[p];
      const [ax, ay] = tileCenter(a), [bx, by] = tileCenter(b);
      const dist = Math.hypot(bx - ax, by - ay);
      const n = Math.max(2, Math.round(dist / 4));
      for (let k = 1; k < n; k++) {
        const f = k / n;
        const j = ((p * 97 + k * 31) % 5) - 2;   // детерминированный изгиб
        const xx = ax + (bx - ax) * f + j * ((by - ay) / dist);
        const yy = ay + (by - ay) * f - j * ((bx - ax) / dist) * .5;
        ctx.fillStyle = (k % 2) ? '#8a6a42' : '#7d5f3a';
        ctx.fillRect(Math.round(xx - 1) * Z, Math.round(yy) * Z, 2 * Z, Z);
        ctx.fillStyle = 'rgba(60,45,25,.5)';
        ctx.fillRect(Math.round(xx - 1) * Z, Math.round(yy + 1) * Z, 2 * Z, Z);
      }
    }
  }

  function render(now) {
    ctx.fillStyle = '#10161a';
    ctx.fillRect(0, 0, CANW * Z, CANH * Z);
    // проход 1: террейн и наземный декор (по диагоналям)
    for (let s = 0; s <= W + H - 2; s++) {
      for (let x = Math.max(0, s - H + 1); x <= Math.min(W - 1, s); x++) {
        const y = s - x;
        const i = idx(x, y);
        const t = S.tiles[i];
        const { sx, sy } = tileOrigin(i);
        // тайл: месторождение (если разведано) или террейн
        let td = null;
        if (t.vis === 2 && t.c && TIMG[t.c] && TIMG[t.c].c) td = TIMG[t.c];
        else {
          const list = TIMG[t.t];
          td = list[t.v % list.length];
        }
        const img = t.vis === 0 ? td.hidden : (t.vis === 1 ? td.fog : td.c);
        ctx.drawImage(img, (sx - OVERSCAN / 2) * Z, sy * Z - td.top);
        if (t.vis !== 2) continue;
        if (t.c === 'fertile' && !t.b) ctx.drawImage(sprites.fertile, sx * Z, sy * Z);
        if (t.d && !t.b && !t.c && sprites[DECOR_SPRITE[t.d]]) {
          ctx.drawImage(sprites[DECOR_SPRITE[t.d]], sx * Z, sy * Z);
        }
      }
    }

    // проход 1.5: дороги поверх земли, под постройками
    drawPaths();

    // проход 2: маркеры, существа, постройки, эффекты
    for (let s = 0; s <= W + H - 2; s++) {
      for (let x = Math.max(0, s - H + 1); x <= Math.min(W - 1, s); x++) {
        const y = s - x;
        const i = idx(x, y);
        const t = S.tiles[i];
        const { sx, sy } = tileOrigin(i);
        if (t.vis === 0) continue;

        if (t.vis === 1) {
          if (t.explore > 0) {
            ctx.drawImage(sprites.hourglass, (sx + TW / 2 - 4.5) * Z, (sy + 6) * Z, 9 * Z, 12 * Z);
          } else if (neighbors4(i).some(n => S.tiles[n].vis === 2)) {
            const bob = reduceMotion ? 0 : Math.round(Math.sin(now / 420 + i) * 2);
            ctx.drawImage(sprites.qmark, (sx + TW / 2 - 4.5) * Z, (sy + 5 + bob) * Z, 9 * Z, 12 * Z);
          }
        } else {
          // масштаб «появления»
          let scale = 1;
          if (!reduceMotion && t.pop && now - t.pop < 260) {
            scale = .6 + .4 * ((now - t.pop) / 260);
          }
          if (t.c && CIMG[t.c]) {
            const im = CIMG[t.c];
            const w = im.width * scale, h = im.height * scale;
            ctx.drawImage(im, sx * Z + (TW * Z - w) / 2, (sy + TH + 2) * Z - h, w, h);
          }
          if (t.b && BIMG[t.b]) {
            const im = BIMG[t.b];
            const w = im.width * scale, h = im.height * scale;
            const bx = sx * Z + (TW * Z - w) / 2;
            const by = (sy + TH + 9) * Z - h;
            ctx.drawImage(im, bx, by, w, h);
            if (SMOKE_BUILDINGS[t.b] && !reduceMotion) {
              const f = (Math.floor(now / 520) + i) % 2;
              const rise = ((Math.floor(now / 260) + i) % 3) * Z;
              ctx.globalAlpha = .7;
              ctx.drawImage(sprites.smoke[f], sx * Z + TW * Z / 2 + 6 * Z, by - 8 * Z - rise, 10 * Z, 11 * Z);
              ctx.globalAlpha = 1;
            }
          }
          // блики на воде
          if (t.t === 'water' && !t.b && !reduceMotion) {
            const f = Math.floor(now / 650) % 2;
            ctx.fillStyle = 'rgba(150,200,235,.8)';
            for (const [ox, oy] of SPARKS[(f + i) % 2]) {
              ctx.fillRect((sx + ox) * Z, (sy + oy) * Z, Z, Z);
            }
          }
        }

        if (placing && canPlace(i, placing)) {
          ctx.globalAlpha = i === hoverTile ? 1
            : (reduceMotion ? .9 : .55 + .4 * Math.sin(now / 240 + i));
          ctx.drawImage(sprites.place, sx * Z, sy * Z);
          ctx.globalAlpha = 1;
        } else if (i === selected && !placing) {
          ctx.globalAlpha = reduceMotion ? 1 : .65 + .35 * Math.sin(now / 280);
          ctx.drawImage(sprites.select, sx * Z, sy * Z);
          ctx.globalAlpha = 1;
        } else if (!placing && i === hoverTile && t.vis > 0) {
          ctx.globalAlpha = .35;
          ctx.drawImage(sprites.hover, sx * Z, sy * Z);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  // Постоянный цикл анимации (блики, «?», дым, жители, выделение).
  function loop(now) {
    render(now);
    updateWalkers(now);
    drawWalkers(now);
    requestAnimationFrame(loop);
  }

  // ---------- Инфо о выбранном тайле ----------
  function renderPanel() {
    const panel = document.getElementById('panel');
    if (placing) {
      panel.hidden = false;
      panel.innerHTML = `<h3>Стройка: ${BUILDINGS[placing].name}</h3>` +
        `<p>Коснитесь подсвеченного тайла, чтобы построить. Тап мимо — отмена.</p>`;
      return;
    }
    if (selected < 0) { panel.hidden = true; return; }
    panel.hidden = false;
    const t = S.tiles[selected];
    panel.innerHTML = '';
    const h = document.createElement('h3');
    const p = document.createElement('p');
    const btns = document.createElement('div');
    btns.className = 'panel__btns';

    if (t.vis === 1) {
      h.textContent = `${TERRAIN_NAME[t.t]} (в тумане)`;
      if (t.explore > 0) {
        p.textContent = `Разведка идёт: осталось ${t.explore} дн.`;
      } else if (neighbors4(selected).some(n => S.tiles[n].vis === 2)) {
        p.textContent = 'Что там — неизвестно, пока не пошлёшь разведчика.';
        const b = document.createElement('button');
        b.className = 'btn btn--small';
        b.innerHTML = `🔦 Разведать <span class="cost">(${exploreTurns()} дн., занимает 1 👥)</span>`;
        b.disabled = freeCitizens() < 1 || S.over;
        b.addEventListener('click', () => startExplore(selected));
        btns.appendChild(b);
      } else {
        p.textContent = 'Слишком далеко — разведайте соседний тайл.';
      }
    } else {
      h.textContent = TERRAIN_NAME[t.t] + (t.b ? ` — ${BUILDINGS[t.b].name}` : '');
      if (t.b) {
        p.textContent = BUILDINGS[t.b].desc;
      } else if (t.c === 'beast') {
        p.textContent = 'Логово зверя! Он будет разорять припасы, пока его не прогнать.';
        const fight = document.createElement('button');
        fight.className = 'btn btn--small';
        fight.innerHTML = S.techs.hunting
          ? '⚔️ Выследить <span class="cost">(без потерь, +8 🍞)</span>'
          : '⚔️ В бой <span class="cost">(−1 👥, нужно 2 свободных)</span>';
        fight.disabled = S.over || (!S.techs.hunting && freeCitizens() < 2);
        fight.addEventListener('click', () => fightBeast(selected));
        btns.appendChild(fight);
        if (S.techs.taming) {
          const tame = document.createElement('button');
          tame.className = 'btn btn--small';
          tame.innerHTML = '🐾 Приручить <span class="cost">(−10 ✨)</span>';
          tame.disabled = S.faith < 10 || S.over;
          tame.addEventListener('click', () => tameBeast(selected));
          btns.appendChild(tame);
        }
      } else {
        p.textContent = (t.c ? `${CONTENT_NAME[t.c]}. ` : '') +
          'Выберите постройку на панели внизу.';
      }
    }

    panel.appendChild(h);
    panel.appendChild(p);
    if (btns.children.length) panel.appendChild(btns);
  }

  // ---------- Панель строительства: вкладки и карточки ----------
  const BUILD_TABS = [
    { id: 'basic', name: '🏠 ЖИЛЬЁ',    keys: ['house', 'farm'] },
    { id: 'prod',  name: '⚙️ ПРОМЫСЕЛ', keys: ['lumber', 'mine', 'dock', 'market'] },
    { id: 'spec',  name: '⛪ ОСОБОЕ',   keys: ['church', 'tavern'] },
  ];
  let activeTab = 'basic';

  function costIcon(kind) {
    const key = kind === 'gold' ? 'r_gold' : 'r_workers';
    if (typeof ASSETS !== 'undefined' && ASSETS[key]) return `<img src="${ASSETS[key]}" alt="">`;
    return kind === 'gold' ? '🪙' : '⚒️';
  }

  function renderTabs() {
    const box = document.getElementById('build-tabs');
    box.innerHTML = '';
    for (const tab of BUILD_TABS) {
      const b = document.createElement('button');
      b.className = 'tab' + (tab.id === activeTab ? ' is-active' : '');
      b.textContent = tab.name;
      b.addEventListener('click', () => { activeTab = tab.id; renderTabs(); renderCards(); });
      box.appendChild(b);
    }
  }

  function renderCards() {
    const box = document.getElementById('build-cards');
    box.innerHTML = '';
    const tab = BUILD_TABS.find(t => t.id === activeTab);
    for (const key of tab.keys) {
      const b = BUILDINGS[key];
      const cost = buildCost(key);
      const card = document.createElement('button');
      card.className = 'card' + (placing === key ? ' is-active' : '');
      const img = (typeof ASSETS !== 'undefined' && ASSETS[BUILD_ASSET[key]])
        ? `<img src="${ASSETS[BUILD_ASSET[key]]}" alt="">` : '';
      const poor = !canAfford(cost);
      card.innerHTML = img +
        `<span class="card__name">${b.name}</span>` +
        `<span class="card__cost${poor ? ' is-poor' : ''}">` +
        (cost.prod ? `<span>${costIcon('prod')} ${cost.prod}</span>` : '') +
        (cost.gold ? `<span>${costIcon('gold')} ${cost.gold}</span>` : '') +
        `</span>`;
      const targets = placeTargets(key);
      card.disabled = S.over || poor || targets.length === 0;
      card.title = `${b.desc}. Ставится на: ${TERRAIN_NAME[b.terr].toLowerCase()}` +
        (targets.length === 0 ? '. Нет подходящих разведанных тайлов'
          : (poor ? '. Не хватает ресурсов' : ''));
      card.addEventListener('click', () => {
        // выбранный подходящий тайл — строим сразу, иначе режим размещения
        if (selected >= 0 && canPlace(selected, key)) { build(selected, key); return; }
        placing = placing === key ? null : key;
        renderAll();
      });
      box.appendChild(card);
    }
  }

  // ---------- Цели ----------
  function renderObjectives() {
    const box = document.getElementById('obj-list');
    const farms = S.tiles.filter(t => t.b === 'farm').length;
    const explored = S.tiles.filter(t => t.vis === 2).length - 5;
    const objs = [
      { name: 'Выплатить дани королю', n: S.tributesPaid, m: TRIBUTES_TO_WIN },
      { name: 'Построить ферму', n: Math.min(farms, 1), m: 1 },
      { name: 'Разведать земли', n: Math.max(0, Math.min(explored, 20)), m: 20 },
      { name: 'Жителей в городке', n: S.pop, m: 10 },
    ];
    box.innerHTML = '';
    for (const o of objs) {
      const row = document.createElement('div');
      row.className = 'obj' + (o.n >= o.m ? ' is-done' : '');
      row.innerHTML = `<span class="obj__box"></span>` +
        `<span class="obj__name">${o.name}</span>` +
        `<span class="obj__n">${o.n}/${o.m}</span>`;
      box.appendChild(row);
    }
  }

  // ---------- Мини-карта ----------
  const minimap = document.getElementById('minimap');
  const mctx = minimap.getContext('2d');
  const MMW = minimap.width, MMH = minimap.height;
  const MINI_COLOR = {
    grass: '#4f7a43', forest: '#33552c', mountain: '#6e6c60', water: '#2d5b80',
  };

  function renderMinimap() {
    mctx.fillStyle = '#0a0e16';
    mctx.fillRect(0, 0, MMW, MMH);
    const kx = MMW / CANW, ky = MMH / CANH;
    for (let i = 0; i < S.tiles.length; i++) {
      const t = S.tiles[i];
      const { sx, sy } = tileOrigin(i);
      let col = '#182029';
      if (t.vis === 1) col = '#243140';
      else if (t.vis === 2) col = MINI_COLOR[t.t];
      mctx.fillStyle = col;
      mctx.fillRect((sx + 8) * kx, (sy + 8) * ky, TW * kx - 1, TH * ky);
      if (t.vis === 2 && t.b) {
        mctx.fillStyle = '#eec46a';
        mctx.fillRect((sx + TW / 2 - 3) * kx, (sy + TH / 2 - 3) * ky, 2, 2);
      }
    }
    // рамка видимой области
    const wrap = document.getElementById('map-scroll');
    if (canvas.clientWidth > 0) {
      const fx = wrap.scrollLeft / canvas.clientWidth;
      const fw = Math.min(1, wrap.clientWidth / canvas.clientWidth);
      const fy = wrap.scrollTop / canvas.clientHeight;
      const fh = Math.min(1, wrap.clientHeight / canvas.clientHeight);
      mctx.strokeStyle = '#e2d9c2';
      mctx.lineWidth = 1;
      mctx.strokeRect(fx * MMW + .5, fy * MMH + .5, fw * MMW - 1, fh * MMH - 1);
    }
  }

  // ---------- Зум и прокрутка ----------
  let zoom = 1;
  const scrollBox = document.getElementById('map-scroll');

  function applyZoom(centerFrac) {
    const fit = Math.min(scrollBox.clientWidth / CANW, scrollBox.clientHeight / CANH);
    const w = Math.round(CANW * fit * zoom);
    const h = Math.round(w * CANH / CANW);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    if (centerFrac) {
      scrollBox.scrollLeft = centerFrac[0] * w - scrollBox.clientWidth / 2;
      scrollBox.scrollTop = centerFrac[1] * h - scrollBox.clientHeight / 2;
    }
    renderMinimap();
  }

  function zoomCenterFrac() {
    return [
      (scrollBox.scrollLeft + scrollBox.clientWidth / 2) / Math.max(1, canvas.clientWidth),
      (scrollBox.scrollTop + scrollBox.clientHeight / 2) / Math.max(1, canvas.clientHeight),
    ];
  }

  document.getElementById('z-in').addEventListener('click', () => {
    const c = zoomCenterFrac();
    zoom = Math.min(2.6, zoom * 1.4);
    applyZoom(c);
  });
  document.getElementById('z-out').addEventListener('click', () => {
    const c = zoomCenterFrac();
    zoom = Math.max(1, zoom / 1.4);
    applyZoom(c);
  });
  window.addEventListener('resize', () => { updateCompact(); applyZoom(); });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => { updateCompact(); applyZoom(); }, 60);
  });
  scrollBox.addEventListener('scroll', () => renderMinimap(), { passive: true });

  minimap.addEventListener('click', (e) => {
    const [fx, fy] = localFrac(e, minimap);
    scrollBox.scrollLeft = fx * canvas.clientWidth - scrollBox.clientWidth / 2;
    scrollBox.scrollTop = fy * canvas.clientHeight - scrollBox.clientHeight / 2;
  });

  // ---------- Жители на карте ----------
  let walkers = [];

  function landTiles() {
    const out = [];
    for (let i = 0; i < S.tiles.length; i++) {
      const t = S.tiles[i];
      if (t.vis === 2 && t.t !== 'water') out.push(i);
    }
    return out;
  }

  function tileCenter(i) {
    const { sx, sy } = tileOrigin(i);
    return [sx + TW / 2, sy + TH / 2];
  }

  function updateWalkers(now) {
    const land = landTiles();
    const want = Math.min(12, S.pop + 2);
    while (walkers.length < want && land.length > 1) {
      const from = land[rnd(land.length)];
      walkers.push({ from, to: from, t0: now, dur: 1, v: rnd(3), off: [rnd(17) - 8, rnd(9) - 4] });
    }
    if (walkers.length > want) walkers.length = want;
    for (const w of walkers) {
      if (now - w.t0 >= w.dur) {
        w.from = w.to;
        const opts = neighbors4(w.from).filter(n => S.tiles[n].vis === 2 && S.tiles[n].t !== 'water');
        w.to = opts.length && chance(.8) ? opts[rnd(opts.length)] : w.from;
        const [ax, ay] = tileCenter(w.from), [bx, by] = tileCenter(w.to);
        const dist = Math.hypot(bx - ax, by - ay);
        w.t0 = now;
        w.dur = 700 + dist * 55 + rnd(1200);
      }
    }
  }

  function drawWalkers(now) {
    for (const w of walkers) {
      const k = Math.min(1, (now - w.t0) / w.dur);
      const [ax, ay] = tileCenter(w.from), [bx, by] = tileCenter(w.to);
      const x = ax + (bx - ax) * k + w.off[0];
      const y = ay + (by - ay) * k + w.off[1];
      const f = w.from === w.to ? 0 : Math.floor(now / 220) % 2;
      ctx.drawImage(sprites.walker[w.v][f], (x - 3) * Z, (y - 9) * Z, 6 * Z, 9 * Z);
    }
  }

  // ---------- Верхние индикаторы ----------
  function renderHud() {
    const inc = income();
    const set = (id, v) => { document.getElementById(id).textContent = v; };
    const delta = (id, v, plus = true) => {
      const el = document.getElementById(id);
      el.textContent = `${v >= 0 && plus ? '+' : ''}${v}`;
      el.classList.toggle('is-neg', v < 0);
    };
    set('r-pop', `${S.pop}/${S.cap}`);
    delta('d-pop', freeCitizens());
    set('r-food', S.food);
    delta('d-food', inc.food - S.pop);
    set('r-prod', S.prod);
    delta('d-prod', inc.prod);
    set('r-gold', S.gold);
    delta('d-gold', inc.gold);
    set('r-faith', S.faith);
    delta('d-faith', inc.faith);
    set('r-sci', S.sci);
    delta('d-sci', 1);
    set('turn-label', S.turn);
    const left = S.nextTribute - S.turn;
    const tl = document.getElementById('tribute-label');
    const d = tributeDemand(S.tributesPaid + 1);
    tl.textContent = S.won && S.tributesPaid >= TRIBUTES_TO_WIN
      ? '👑 Король доволен'
      : `Дань: ${left} дн. (${d.gold}🪙+${d.food}🍞)`;
    tl.classList.toggle('is-soon', left <= 3 && !S.won);
    for (const id of ['btn-endday', 'btn-skip3', 'btn-bigday']) {
      document.getElementById(id).disabled = S.over;
    }
  }

  function renderAll() {
    if (reduceMotion) render(0);
    renderPanel();
    renderHud();
    renderTabs();
    renderCards();
    renderObjectives();
    renderMinimap();
    updateBadges();
  }

  // ---------- Ввод (с учётом поворота экрана в портрете) ----------
  const portraitMq = window.matchMedia('(orientation: portrait)');
  const isRotated = () => portraitMq.matches;

  // клиентские координаты → доли [0..1] внутри элемента (учёт поворота 90°)
  function localFrac(e, el) {
    const r = el.getBoundingClientRect();
    if (!isRotated()) {
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    }
    return [(e.clientY - r.top) / r.height, (r.right - e.clientX) / r.width];
  }

  function updateCompact() {
    const lh = isRotated() ? window.innerWidth : window.innerHeight;
    document.getElementById('game').classList.toggle('compact', lh < 560);
  }

  // ближайший к курсору тайл (нормированная эллиптическая метрика)
  function tileAt(e) {
    const [fx, fy] = localFrac(e, canvas);
    const mx = fx * CANW, my = fy * CANH;
    let best = -1, bestD = 1.4;
    for (let i = 0; i < S.tiles.length; i++) {
      const { sx, sy } = tileOrigin(i);
      const dx = (mx - (sx + TW / 2)) / (TW / 2);
      const dy = (my - (sy + TH / 2)) / (TH / 2);
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function selectAt(e) {
    if (S.over || modalOpen) return;
    const best = tileAt(e);

    // режим размещения: тап по подсвеченному тайлу строит, мимо — отмена
    if (placing) {
      if (best >= 0 && canPlace(best, placing) && canAfford(buildCost(placing))) {
        build(best, placing);
      } else {
        placing = null;
        renderAll();
      }
      return;
    }

    const next = (best < 0 || S.tiles[best].vis === 0) ? -1 : best;
    // повторный тап по тайлу тумана с «?» — сразу отправляем разведчика
    if (next >= 0 && next === selected && S.tiles[next].vis === 1 &&
        S.tiles[next].explore === 0 &&
        neighbors4(next).some(n => S.tiles[n].vis === 2) && freeCitizens() > 0) {
      startExplore(next);
      return;
    }
    selected = next;
    renderAll();
  }

  // перетаскивание карты + тап по тайлу (оси верны в обеих ориентациях)
  let drag = null;
  scrollBox.addEventListener('pointerdown', (e) => {
    drag = {
      x: e.clientX, y: e.clientY,
      sl: scrollBox.scrollLeft, st: scrollBox.scrollTop,
      moved: false,
    };
    scrollBox.setPointerCapture(e.pointerId);
  });
  scrollBox.addEventListener('pointermove', (e) => {
    if (!drag) {
      if (canHover) {
        const h = tileAt(e);
        if (h !== hoverTile) { hoverTile = h; if (reduceMotion) render(0); }
      }
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 8) {
      drag.moved = true;
      scrollBox.classList.add('dragging');
    }
    if (!drag.moved) return;
    const lx = isRotated() ? dy : dx;
    const ly = isRotated() ? -dx : dy;
    scrollBox.scrollLeft = drag.sl - lx;
    scrollBox.scrollTop = drag.st - ly;
  });
  scrollBox.addEventListener('pointerup', (e) => {
    // только основная кнопка: правая — для отмены (contextmenu)
    if (drag && !drag.moved && e.button === 0) selectAt(e);
    drag = null;
    scrollBox.classList.remove('dragging');
  });
  scrollBox.addEventListener('pointercancel', () => {
    drag = null;
    scrollBox.classList.remove('dragging');
  });
  scrollBox.addEventListener('pointerleave', () => {
    hoverTile = -1;
    if (reduceMotion) render(0);
  });

  // подсветка тайла под курсором (только устройства с мышью)
  const canHover = window.matchMedia('(hover: hover)').matches;
  let hoverTile = -1;

  // колесо мыши: зум к точке под курсором
  scrollBox.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    const next = Math.min(2.6, Math.max(1, zoom * factor));
    if (next === zoom) return;
    const [fx, fy] = localFrac(e, canvas);   // точка карты под курсором
    zoom = next;
    applyZoom();
    const r = scrollBox.getBoundingClientRect();
    const px = isRotated() ? e.clientY - r.top : e.clientX - r.left;
    const py = isRotated() ? r.right - e.clientX : e.clientY - r.top;
    scrollBox.scrollLeft = fx * canvas.clientWidth - px;
    scrollBox.scrollTop = fy * canvas.clientHeight - py;
  }, { passive: false });

  // правая кнопка — отмена размещения/выбора
  scrollBox.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (placing || selected >= 0) {
      placing = null;
      selected = -1;
      renderAll();
    }
  });

  // ---------- Горячие клавиши ----------
  window.addEventListener('keydown', (e) => {
    if (modalOpen) return; // модальные окна — мышью
    if (e.ctrlKey || e.metaKey || e.altKey) return; // не мешаем шорткатам браузера
    const pan = 70;
    switch (e.code) {
      case 'Space':
      case 'Enter':
        e.preventDefault();
        endDay();
        break;
      case 'Escape':
        placing = null;
        selected = -1;
        renderAll();
        break;
      case 'Digit1': case 'Digit2': case 'Digit3': {
        const tb = BUILD_TABS[+e.code.slice(-1) - 1];
        if (tb) { activeTab = tb.id; renderTabs(); renderCards(); }
        break;
      }
      case 'Equal': case 'NumpadAdd':
        document.getElementById('z-in').click();
        break;
      case 'Minus': case 'NumpadSubtract':
        document.getElementById('z-out').click();
        break;
      case 'ArrowLeft': case 'KeyA': scrollBox.scrollLeft -= pan; e.preventDefault(); break;
      case 'ArrowRight': case 'KeyD': scrollBox.scrollLeft += pan; e.preventDefault(); break;
      case 'ArrowUp': case 'KeyW': scrollBox.scrollTop -= pan; e.preventDefault(); break;
      case 'ArrowDown': case 'KeyS': scrollBox.scrollTop += pan; e.preventDefault(); break;
      case 'KeyT': document.getElementById('btn-tech').click(); break;
      case 'KeyL': document.getElementById('btn-log').click(); break;
      case 'KeyH': document.getElementById('btn-help').click(); break;
    }
  });

  // колесо над карточками — горизонтальная прокрутка
  const cardsBox = document.getElementById('build-cards');
  cardsBox.addEventListener('wheel', (e) => {
    if (!e.deltaY) return;
    e.preventDefault();
    // deltaMode: 1 — строки (Firefox), 2 — страницы
    const k = e.deltaMode === 1 ? 40 : (e.deltaMode === 2 ? cardsBox.clientWidth : 1);
    cardsBox.scrollLeft += e.deltaY * k;
  }, { passive: false });

  function skipDays(n) {
    for (let k = 0; k < n; k++) {
      if (S.over || modalOpen) break;
      endDay();
    }
  }

  document.getElementById('btn-endday').addEventListener('click', endDay);
  document.getElementById('btn-bigday').addEventListener('click', endDay);
  document.getElementById('btn-skip3').addEventListener('click', () => skipDays(3));
  document.getElementById('btn-tech').addEventListener('click', openTech);

  document.getElementById('btn-newgame').addEventListener('click', () => {
    if (modalOpen) return;
    showModal('🔁 Новая партия', 'Начать заново на новой случайной карте?\nТекущий прогресс будет потерян.', [
      { label: 'Да, начать заново', fn: newGame },
      { label: 'Отмена', fn: () => {} },
    ]);
  });

  document.getElementById('btn-events').addEventListener('click', () => {
    if (modalOpen) return;
    const n = S.tributesPaid + 1;
    const d = tributeDemand(n);
    const left = S.nextTribute - S.turn;
    const beasts = S.tiles.filter(t => t.vis === 2 && t.c === 'beast').length;
    showModal('⚜️ Вести городка',
      `Дань №${n} из ${TRIBUTES_TO_WIN}: ${d.gold} 🪙 и ${d.food} 🍞 — через ${left} дн.\n` +
      `Отсрочек осталось: ${S.postpones}.\n` +
      `Зверей у поселения: ${beasts}.\n` +
      `Свободных жителей: ${freeCitizens()} из ${S.pop}.`,
      [{ label: 'Понятно', fn: () => {} }], 'ev_kingstax');
  });

  const logOverlay = document.getElementById('log-overlay');
  document.getElementById('btn-log').addEventListener('click', () => {
    logOverlay.hidden = !logOverlay.hidden;
    if (!logOverlay.hidden) { unreadLog = 0; updateBadges(); }
  });
  document.getElementById('btn-log-close').addEventListener('click', () => {
    logOverlay.hidden = true;
  });

  document.getElementById('btn-help').addEventListener('click', () => {
    if (modalOpen) return;
    showModal('❓ Как играть',
      'Ваше поселение окружено туманом. Каждый тайл тумана скрывает сюрприз: клад, руины, ' +
      'плодородную землю — или дикого зверя.\n\n' +
      '• Коснитесь тайла с «?» рядом со своей землёй, чтобы послать разведчика.\n' +
      '• Выберите свой тайл и постройку на нижней панели: фермы кормят, дома дают жителей, ' +
      'шахты и рынки приносят производство и золото, церкви — веру.\n' +
      '• Жители едят 1 🍞 в день каждый. Голод убивает.\n' +
      '• Очки знаний 🔬 открывают технологии — с каждым открытием дороже.\n' +
      '• Раз в 12 дней король требует дань. Не заплатите — потеряете колонию. ' +
      `Выплатите ${TRIBUTES_TO_WIN} даней — победа!\n\n` +
      '⌨️ На компьютере: Пробел — новый день, колесо мыши — зум, ' +
      'стрелки/WASD — карта, 1–3 — вкладки, Esc — отмена, правая кнопка — сброс, ' +
      'T — технологии, L — летопись, H — эта справка.\n\n' +
      'Фанатская веб-версия по мотивам TownsFolk (Short Circuit Studio / MWM).',
      [{ label: 'Понятно', fn: () => {} }]);
  });

  // ---------- Старт ----------
  initSprites();
  loadAssets(() => {
    prepareAssets();
    if (!loadGame()) newGame();
    updateCompact();
    applyZoom();
    if (!reduceMotion) requestAnimationFrame(loop);
    // обучающая подсказка при первом запуске
    let seenHelp = false;
    try { seenHelp = !!localStorage.getItem(SEEN_HELP_KEY); } catch (e) { seenHelp = true; }
    if (!seenHelp && !modalOpen) {
      try { localStorage.setItem(SEEN_HELP_KEY, '1'); } catch (e) {}
      showModal('👋 Добро пожаловать в Городок!',
        'Быстрый старт:\n' +
        '1. Постройте ферму: карточка «Ферма» внизу → тап по зелёному тайлу.\n' +
        '2. Разведайте туман: два тапа по тайлу с «?».\n' +
        '3. Жмите НОВЫЙ ДЕНЬ и копите золото и еду — раз в 12 дней король берёт дань.\n\n' +
        'Прогресс сохраняется автоматически. Удачи!',
        [{ label: '▶️ Играть', fn: () => {} }], 'castle');
    }
  });
})();
