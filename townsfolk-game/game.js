/* ==========================================================
   Городок — пошаговая рогалик-стратегия по мотивам TownsFolk.
   Оригинальный код и графика (спрайты рисуются процедурно).
   Гексагональная карта с «толщиной», крупные детальные
   постройки, выступающие за гекс, дым из труб, анимации.
   Один IIFE, без зависимостей и сборки.
   ========================================================== */
(() => {
  'use strict';

  // ---------- Константы ----------
  const W = 13, H = 13;               // карта 13×13 гексов
  const CX = 6, CY = 6;               // центр — ратуша
  const HW = 32, HH = 36;             // гекс: ширина × высота, px
  const ROWH = 27;                    // вертикальный шаг рядов
  const BH = 48;                      // высота спрайта постройки (выступает вверх)
  const OY = HH - BH;                 // смещение отрисовки построек (−12)
  const PAD = 6;
  const CANW = PAD * 2 + W * HW + HW / 2;      // 444
  const CANH = PAD * 2 + (H - 1) * ROWH + HH;  // 372
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
    { id: 'cartography', name: 'Картография',   desc: 'Разведка занимает 1 день вместо 2' },
    { id: 'crops',       name: 'Севооборот',    desc: 'Фермы дают +2 🍞' },
    { id: 'hunting',     name: 'Охота',         desc: 'Бой со зверем без потерь, добыча +8 🍞' },
    { id: 'taming',      name: 'Приручение',    desc: 'Зверей можно приручать за 10 ✨ (+2 🍞 в день)' },
    { id: 'mining',      name: 'Горное дело',   desc: 'Шахты дают +2 ⚒️' },
    { id: 'trade',       name: 'Торговые пути', desc: 'Рынки +2 🪙, дань короне −20%' },
    { id: 'masonry',     name: 'Каменная кладка', desc: 'Постройки дешевле на 25%' },
    { id: 'theology',    name: 'Богословие',    desc: 'Церкви дают +2 ✨' },
  ];

  // ---------- Состояние ----------
  let S = null;         // всё состояние партии
  let selected = -1;    // индекс выбранной клетки
  let modalQueue = [];  // очередь модальных окон
  let modalOpen = false;

  const rnd = (n) => Math.floor(Math.random() * n);
  const chance = (p) => Math.random() < p;
  const idx = (x, y) => y * W + x;
  const inMap = (x, y) => x >= 0 && x < W && y >= 0 && y < H;

  // Гексы, ориентация «вершиной вверх», нечётные ряды сдвинуты вправо
  function hexNeighbors(i) {
    const x = i % W, y = (i / W) | 0;
    const odd = y % 2;
    const deltas = odd
      ? [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
      : [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
    const out = [];
    for (const [dx, dy] of deltas) {
      if (inMap(x + dx, y + dy)) out.push(idx(x + dx, y + dy));
    }
    return out;
  }

  function tileOrigin(i) {
    const x = i % W, y = (i / W) | 0;
    return {
      px: PAD + x * HW + (y % 2 ? HW / 2 : 0),
      py: PAD + y * ROWH,
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
      tiles.push({ t, vis: 0, b: null, c: null, explore: 0, v: rnd(3), pop: 0 });
    }
    // Сглаживание: клетка с 50% перенимает террейн случайного соседа
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < tiles.length; i++) {
        if (chance(.5)) {
          const ns = hexNeighbors(i);
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
    for (const n of hexNeighbors(c)) tiles[n].vis = 2;
    for (const s of [c, ...hexNeighbors(c)]) {
      for (const n of hexNeighbors(s)) tiles[n].vis = Math.max(tiles[n].vis, 1);
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
      food: 25, prod: 14, gold: 12, faith: 2, sci: 0,
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
    document.getElementById('log').innerHTML = '';
    log('Король дал вам землю и год сроку. Стройте, исследуйте — и готовьте дань.');
    renderAll();
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
  function log(msg, cls) {
    const el = document.getElementById('log');
    const p = document.createElement('p');
    if (cls) p.className = cls;
    p.innerHTML = `<b>Д${S.turn}</b> ${msg}`;
    el.prepend(p);
    while (el.children.length > 40) el.removeChild(el.lastChild);
  }

  // Всплывающий текст над клеткой (как цифры урона в оригинале)
  function floatText(i, text, cls) {
    if (reduceMotion) return;
    const wrap = document.querySelector('.map-wrap');
    const scale = canvas.clientWidth / CANW;
    const { px, py } = tileOrigin(i);
    const el = document.createElement('span');
    el.className = 'floater' + (cls ? ` ${cls}` : '');
    el.textContent = text;
    el.style.left = `${canvas.offsetLeft + (px + HW / 2) * scale}px`;
    el.style.top = `${canvas.offsetTop + py * scale}px`;
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
      if (t.vis === 2 && t.c === 'beast' && chance(.4)) {
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

    // 7. Дань или случайное событие
    if (S.turn >= S.nextTribute) {
      queueTribute();
    } else if (S.turn > 3 && chance(.25)) {
      queueEvent(EVENTS[rnd(EVENTS.length)]);
    }

    renderAll();
    nextModal();
  }

  function revealTile(i) {
    const t = S.tiles[i];
    t.vis = 2;
    t.pop = performance.now(); // анимация «появления» гекса
    for (const n of hexNeighbors(i)) S.tiles[n].vis = Math.max(S.tiles[n].vis, 1);
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
    ]);
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
      showModal('👑 Дань короне', text, buttons);
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
      ]
    ));
  }

  // ---------- Случайные события ----------
  const EVENTS = [
    {
      title: '🚶 Странник у ворот',
      text: 'К воротам вышел измождённый путник и просит приюта.',
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
        fn: () => { o.fn(); renderAll(); },
      }));
      showModal(ev.title, ev.text, buttons);
    });
  }

  // ---------- Модальные окна ----------
  function showModal(title, text, buttons) {
    modalOpen = true;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-text').textContent = text;
    const box = document.getElementById('modal-buttons');
    box.innerHTML = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.innerHTML = b.sub ? `${b.label}<small>${b.sub}</small>` : b.label;
      btn.disabled = !!b.disabled;
      btn.addEventListener('click', () => {
        closeModal();
        b.fn();
        renderAll();
        nextModal();
      });
      box.appendChild(btn);
    }
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
    box.innerHTML = '';
    for (const t of TECHS) {
      const row = document.createElement('div');
      row.className = 'tech-row' + (S.techs[t.id] ? ' is-owned' : '');
      const info = document.createElement('div');
      info.innerHTML = `<div class="tech-name">${S.techs[t.id] ? '✅ ' : ''}${t.name}</div>` +
                       `<div class="tech-desc">${t.desc}</div>`;
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
    if (!hexNeighbors(i).some(n => S.tiles[n].vis === 2)) return;
    if (freeCitizens() < 1) { log('Нет свободных жителей для разведки.', 'log--bad'); return; }
    t.explore = exploreTurns();
    log(`Разведчик отправился в ${TERRAIN_NAME[t.t].toLowerCase()} (${t.explore} дн.).`);
    renderAll();
  }

  function build(i, key) {
    const t = S.tiles[i];
    const cost = buildCost(key);
    if (t.vis !== 2 || t.b || t.c === 'beast' || !canAfford(cost)) return;
    pay(cost);
    t.b = key;
    t.pop = performance.now();
    if (key === 'house') S.cap += 3;
    S.sci += 2;
    log(`Построен объект «${BUILDINGS[key].name}». +2 🔬`, 'log--good');
    floatText(i, '⚒️', 'floater--good');
    renderAll();
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
  }

  function tameBeast(i) {
    const t = S.tiles[i];
    if (t.c !== 'beast' || !S.techs.taming || S.faith < 10) return;
    S.faith -= 10;
    t.c = 'tamed';
    log('Зверь приручён и теперь помогает добывать еду! +2 🍞 в день', 'log--good');
    floatText(i, '🐾', 'floater--good');
    renderAll();
  }

  /* ==========================================================
     СПРАЙТЫ — процедурный пиксель-арт. Гекс 32×36 с «толщиной»
     (светлая поверхность + тёмный земляной борт), постройки
     32×48 с черепицей и обводкой, выступают за гекс вверх.
     ========================================================== */
  const P = {
    outline: '#0c1112',
    ink: '#1c1712',
    grass:  { base: '#46683f', dark: '#3b5834', light: '#548049', edge: '#2c4426' },
    forest: { base: '#3a5a32', dark: '#2f4a29', light: '#46683f', edge: '#24381f' },
    mountain: { base: '#615f52', dark: '#524f45', light: '#716e60', edge: '#3d3b32' },
    water:  { base: '#27455c', dark: '#203a4d', light: '#335874', edge: '#182b39',
              side: '#16283a', sideDark: '#0f1c29' },
    side: '#4a3b2a', sideDark: '#33291d',
    // дерево и стены
    wood: '#4a3524', woodMid: '#5f4630', woodLight: '#7a5a3a', woodPale: '#96744c',
    beam: '#4a3524',
    wallCream: '#ddd2ae', wallShade: '#bcae88',
    stone: '#8a857a', stoneDark: '#6e6a5f',
    gold: '#d9a84c', goldLight: '#efc76e', goldDark: '#a97c2e',
    snow: '#d8d4c8',
    cream: '#e8e0c8',
    red: '#b5484a',
  };
  const ROOF_RED  = ['#6e3428', '#8e4a3a', '#b06448'];
  const ROOF_BLUE = ['#39395a', '#4a4a6e', '#66668e'];

  const sprites = {};

  // Профиль гекса: [x0, x1] включительно для строки y (32×36)
  const HEX_A = [1, 3, 5, 7, 9, 11, 13, 14, 15];
  function hexSpan(y) {
    if (y < 9)   { const a = HEX_A[y];      return [15 - a, 16 + a]; }
    if (y >= 27) { const a = HEX_A[35 - y]; return [15 - a, 16 + a]; }
    return [0, 31];
  }

  function makeSprite(draw, w = HW, h = HH) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    draw(g);
    return c;
  }

  function px(g, color, x, y, w = 1, h = 1) {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  }

  // Гекс с «толщиной»: поверхность + земляной борт снизу + обводка
  function hexBase(g, pal, noiseN = 26) {
    const side = pal.side || P.side, sideDark = pal.sideDark || P.sideDark;
    for (let y = 0; y < HH; y++) {
      const [x0, x1] = hexSpan(y);
      let c = pal.base;
      if (y >= HH - 3) c = sideDark;
      else if (y >= HH - 6) c = side;
      px(g, c, x0, y, x1 - x0 + 1, 1);
    }
    for (let k = 0; k < noiseN; k++) {
      const y = rnd(HH - 7);
      const [x0, x1] = hexSpan(y);
      px(g, chance(.5) ? pal.dark : pal.light, x0 + rnd(x1 - x0 + 1), y);
    }
    // край поверхности над бортом
    const [e0, e1] = hexSpan(HH - 6);
    px(g, pal.edge, e0, HH - 7, e1 - e0 + 1, 1);
    // обводка
    for (let y = 0; y < HH; y++) {
      const [x0, x1] = hexSpan(y);
      px(g, P.outline, x0, y); px(g, P.outline, x1, y);
      if (y < 9 || y >= 27) { px(g, P.outline, x0 + 1, y); px(g, P.outline, x1 - 1, y); }
    }
    const [t0, t1] = hexSpan(0);
    px(g, P.outline, t0, 0, t1 - t0 + 1, 1);
    const [b0, b1] = hexSpan(HH - 1);
    px(g, P.outline, b0, HH - 1, b1 - b0 + 1, 1);
    // блик по верхним граням
    for (let y = 1; y < 8; y++) {
      const [x0, x1] = hexSpan(y);
      px(g, pal.light, x0 + 2, y); px(g, pal.light, x1 - 2, y);
    }
  }

  // Черепичная крыша: чередование рядов и колонок + конёк
  function shingles(g, x, y, w, h, cols) {
    for (let yy = 0; yy < h; yy++) {
      const phase = (yy >> 1) & 1;
      for (let xx = 0; xx < w; xx++) {
        const s = ((xx + phase * 2) >> 1) & 1;
        px(g, s ? cols[1] : cols[0], x + xx, y + yy);
      }
    }
    px(g, cols[2], x, y, w, 1);            // конёк
    px(g, P.ink, x, y + h - 1, w, 1);      // тень под свесом
  }

  // Фахверковая стена: светлая штукатурка + тёмные балки
  function timberWall(g, x, y, w, h) {
    px(g, P.wallCream, x, y, w, h);
    px(g, P.wallShade, x, y + h - 1, w, 1);
    px(g, P.beam, x, y, 1, h);
    px(g, P.beam, x + w - 1, y, 1, h);
    if (w > 10) px(g, P.beam, x + ((w / 2) | 0), y, 1, h);
    if (h > 5) px(g, P.beam, x, y + ((h / 2) | 0), w, 1);
  }

  // Бревенчатая стена
  function logWall(g, x, y, w, h) {
    for (let yy = 0; yy < h; yy++) {
      px(g, (yy >> 1) & 1 ? P.woodMid : P.woodLight, x, y + yy, w, 1);
    }
    px(g, P.wood, x, y + h - 1, w, 1);
  }

  // Светящееся окно
  function litWindow(g, x, y, w = 3, h = 3) {
    px(g, P.ink, x - 1, y - 1, w + 2, h + 2);
    px(g, P.goldLight, x, y, w, h);
    px(g, P.gold, x, y + h - 1, w, 1);
  }

  // Большая ель (11×14)
  function pineBig(g, x, y) {
    const d = '#20361f', m = '#2c4a2b', l = '#3f6b3c';
    px(g, d, x + 5, y, 1, 1);
    px(g, m, x + 4, y + 1, 3, 1);
    px(g, d, x + 3, y + 2, 5, 2);
    px(g, m, x + 2, y + 4, 7, 2);
    px(g, d, x + 1, y + 6, 9, 2);
    px(g, m, x, y + 8, 11, 2);
    px(g, l, x + 4, y + 2); px(g, l, x + 3, y + 5); px(g, l, x + 2, y + 8);
    px(g, P.wood, x + 5, y + 10, 2, 3);
    px(g, '#1a2e1f', x + 3, y + 13, 6, 1);
  }

  // Малая ель (7×9)
  function pineSmall(g, x, y) {
    const d = '#20361f', m = '#2c4a2b';
    px(g, m, x + 3, y, 1, 1);
    px(g, d, x + 2, y + 1, 3, 2);
    px(g, m, x + 1, y + 3, 5, 2);
    px(g, d, x, y + 5, 7, 2);
    px(g, P.wood, x + 3, y + 7, 1, 2);
  }

  // Овца (6×5)
  function sheep(g, x, y) {
    px(g, P.ink, x - 1, y, 6, 4);
    px(g, P.cream, x, y, 4, 3);
    px(g, '#f2ece0', x, y, 2, 1);
    px(g, '#8f8877', x + 4, y + 1, 2, 2);
    px(g, P.ink, x, y + 3, 1, 2); px(g, P.ink, x + 3, y + 3, 1, 2);
  }

  // Корова (8×6)
  function cow(g, x, y) {
    px(g, P.ink, x - 1, y - 1, 9, 6);
    px(g, P.cream, x, y, 7, 4);
    px(g, '#3a3226', x + 1, y + 1, 2, 2); px(g, '#3a3226', x + 5, y, 2, 2);
    px(g, '#c9a0a0', x + 6, y + 2, 2, 2);
    px(g, P.ink, x, y + 4, 1, 2); px(g, P.ink, x + 5, y + 4, 1, 2);
  }

  // Домик с трубой (17×13, якорь — левый верх)
  function cottage(g, x, y, withChimney) {
    px(g, P.outline, x - 2, y, 19, 13);
    if (withChimney) {
      px(g, P.outline, x + 10, y - 4, 5, 5);
      px(g, P.stone, x + 11, y - 3, 3, 4);
      px(g, P.stoneDark, x + 11, y - 1, 3, 1);
    }
    shingles(g, x - 1, y + 1, 17, 5, ROOF_RED);
    timberWall(g, x, y + 6, 15, 6);
    px(g, P.wood, x + 6, y + 8, 3, 4);
    px(g, P.goldLight, x + 8, y + 10, 1, 1);
    litWindow(g, x + 2, y + 8, 2, 2);
    litWindow(g, x + 11, y + 8, 2, 2);
  }

  function initSprites() {
    // --- Террейны (по 3 варианта) ---
    sprites.grass = [
      makeSprite(g => {
        hexBase(g, P.grass);
        sheep(g, 8, 18); sheep(g, 19, 13);
        px(g, '#c9c25a', 22, 20); px(g, '#b56a6a', 12, 10); px(g, '#548049', 11, 11);
      }),
      makeSprite(g => {
        hexBase(g, P.grass);
        cow(g, 12, 16);
        px(g, '#c9c25a', 8, 12); px(g, '#c9c25a', 22, 22);
        pineSmall(g, 20, 6);
      }),
      makeSprite(g => {
        hexBase(g, P.grass);
        sheep(g, 14, 20);
        // стожок
        px(g, P.ink, 7, 10, 8, 6);
        px(g, P.gold, 8, 12, 6, 3); px(g, P.goldLight, 9, 11, 4, 1); px(g, P.goldLight, 10, 10, 2, 1);
        px(g, '#b56a6a', 22, 14);
      }),
    ];
    sprites.forest = [
      makeSprite(g => { hexBase(g, P.forest); pineBig(g, 4, 6); pineBig(g, 17, 10); pineSmall(g, 12, 20); }),
      makeSprite(g => { hexBase(g, P.forest); pineBig(g, 10, 5); pineSmall(g, 4, 15); pineBig(g, 19, 14); }),
      makeSprite(g => { hexBase(g, P.forest); pineBig(g, 6, 12); pineSmall(g, 18, 7); pineSmall(g, 21, 18); px(g, '#7a4a3a', 8, 26, 3, 1); }),
    ];
    sprites.mountain = [
      makeSprite(g => {
        hexBase(g, P.mountain, 30);
        // главный пик
        for (let r = 0; r < 13; r++) {
          const w = 1 + r * 2, x = 14 - r;
          px(g, r < 3 ? P.snow : (r % 2 ? '#716e60' : '#615f52'), x, 7 + r, w, 1);
        }
        px(g, '#4a473e', 11, 14, 2, 5); px(g, '#4a473e', 17, 12, 1, 7);
        px(g, '#dfdbd0', 13, 8, 2, 1);
        // малый пик справа
        for (let r = 0; r < 7; r++) px(g, r < 2 ? P.snow : '#565348', 23 - r, 17 + r, 1 + r * 2, 1);
      }),
      makeSprite(g => {
        hexBase(g, P.mountain, 30);
        for (let r = 0; r < 11; r++) px(g, r < 3 ? P.snow : (r % 2 ? '#6b695c' : '#5d5b52'), 17 - r, 9 + r, 1 + r * 2, 1);
        px(g, '#4a473e', 15, 13, 1, 6);
        px(g, '#787666', 6, 22, 5, 3); px(g, '#8a8577', 7, 22, 2, 1);
      }),
      makeSprite(g => {
        hexBase(g, P.mountain, 30);
        for (let r = 0; r < 9; r++) px(g, r < 2 ? P.snow : '#6b695c', 12 - r, 10 + r, 1 + r * 2, 1);
        for (let r = 0; r < 8; r++) px(g, r < 2 ? P.snow : '#5d5b52', 22 - r, 14 + r, 1 + r * 2, 1);
        px(g, '#787666', 8, 24, 4, 2);
      }),
    ];
    // Вода — два кадра волн
    const waves = [[6, 11], [17, 15], [9, 22], [21, 25], [14, 7]];
    sprites.water = [0, 1].map(f => makeSprite(g => {
      hexBase(g, P.water, 16);
      for (const [wx, wy] of waves) {
        const ox = f ? 2 : 0;
        px(g, P.water.light, wx + ox, wy, 4, 1);
        px(g, '#4a7396', wx + ox + 1, wy, 2, 1);
        px(g, '#5d86ab', wx + ox + 1, wy, 1, 1);
      }
    }));

    // Неразведанное — почти чёрный гекс
    sprites.hidden = makeSprite(g => {
      hexBase(g, {
        base: '#121a1c', dark: '#0e1416', light: '#182225', edge: '#0c1112',
        side: '#0e1416', sideDark: '#0a0f11',
      }, 10);
    });

    /* --- Постройки 32×48 (низ спрайта = низ гекса) --- */

    sprites.townhall = makeSprite(g => {
      // большой зал старейшины: высокая красная крыша, фахверк
      px(g, P.outline, 2, 16, 28, 26);
      // фронтон крыши ступенями
      px(g, ROOF_RED[2], 12, 17, 8, 1);
      shingles(g, 8, 18, 16, 3, ROOF_RED);
      shingles(g, 5, 21, 22, 3, ROOF_RED);
      shingles(g, 3, 24, 26, 4, ROOF_RED);
      timberWall(g, 4, 28, 24, 13);
      // высокая дверь с золотым фонарём
      px(g, P.ink, 12, 31, 8, 10);
      px(g, P.woodMid, 13, 32, 6, 9);
      px(g, P.goldLight, 15, 30, 2, 1);
      litWindow(g, 6, 31, 3, 4); litWindow(g, 23, 31, 3, 4);
      // звонница на коньке с синим шатром
      px(g, P.outline, 12, 4, 8, 14);
      px(g, P.wallCream, 13, 10, 6, 7);
      px(g, P.beam, 13, 10, 1, 7); px(g, P.beam, 18, 10, 1, 7);
      px(g, P.goldLight, 14, 12, 4, 3); px(g, P.ink, 15, 12, 2, 3); // колокол
      for (let r = 0; r < 5; r++) px(g, r ? ROOF_BLUE[r % 2] : ROOF_BLUE[2], 15 - r, 5 + r, 2 + r * 2, 1);
      // штандарты по бокам входа
      px(g, P.wood, 5, 20, 1, 8); px(g, P.red, 6, 21, 3, 4); px(g, '#8e3436', 6, 24, 2, 1);
      px(g, P.wood, 26, 20, 1, 8); px(g, P.red, 23, 21, 3, 4); px(g, '#8e3436', 24, 24, 2, 1);
      // труба (дым рисуется в рендере)
      px(g, P.outline, 23, 12, 5, 7);
      px(g, P.stone, 24, 13, 3, 6); px(g, P.stoneDark, 24, 16, 3, 1);
    });

    sprites.house = makeSprite(g => {
      cottage(g, 4, 13, true);
      cottage(g, 14, 28, false);
    });

    sprites.farm = makeSprite(g => {
      // амбар
      px(g, P.outline, 17, 16, 14, 13);
      shingles(g, 18, 17, 12, 4, ROOF_RED);
      logWall(g, 19, 21, 10, 7);
      px(g, P.ink, 22, 23, 4, 5); px(g, P.woodPale, 23, 24, 2, 4);
      // золотое поле с грядками
      px(g, P.ink, 2, 27, 19, 14);
      px(g, '#6a5232', 3, 28, 17, 12);
      for (let r = 0; r < 4; r++) {
        px(g, '#54412a', 3, 30 + r * 3, 17, 1);
        for (let c = 0; c < 8; c++) {
          px(g, P.gold, 4 + c * 2, 28 + r * 3, 1, 2);
          px(g, P.goldLight, 4 + c * 2, 28 + r * 3, 1, 1);
        }
      }
      // изгородь
      px(g, P.woodPale, 22, 32, 1, 4); px(g, P.woodPale, 26, 33, 1, 4); px(g, P.woodPale, 30, 34, 1, 4);
      px(g, P.woodLight, 22, 33, 9, 1);
      // стожок
      px(g, P.ink, 22, 39, 9, 5);
      px(g, P.gold, 23, 41, 7, 2); px(g, P.goldLight, 24, 40, 5, 1); px(g, P.goldLight, 25, 39, 3, 1);
    });

    sprites.lumber = makeSprite(g => {
      pineBig(g, 2, 10);
      // изба лесоруба
      px(g, P.outline, 12, 22, 19, 17);
      shingles(g, 13, 23, 17, 5, ROOF_RED);
      logWall(g, 14, 28, 15, 10);
      px(g, P.ink, 19, 31, 4, 7); px(g, P.woodPale, 20, 32, 2, 5);
      litWindow(g, 25, 30, 3, 3);
      // труба
      px(g, P.outline, 26, 18, 4, 5);
      px(g, P.stone, 27, 19, 2, 4);
      // штабель брёвен
      px(g, P.outline, 2, 38, 11, 5);
      px(g, P.woodMid, 3, 39, 9, 1); px(g, P.woodLight, 3, 41, 9, 1);
      px(g, P.cream, 3, 39, 1, 1); px(g, P.cream, 11, 41, 1, 1);
      px(g, P.woodMid, 5, 40, 7, 1);
    });

    sprites.mine = makeSprite(g => {
      // скальный массив
      for (let r = 0; r < 14; r++) {
        const w = 4 + r * 2, x = 14 - r;
        px(g, r < 2 ? P.snow : (r % 2 ? '#6b695c' : '#5d5b52'), x, 14 + r, Math.min(w, 30 - x), 1);
      }
      px(g, '#4a473e', 9, 20, 2, 6); px(g, '#4a473e', 22, 18, 1, 8);
      // вход-штольня
      px(g, P.outline, 11, 26, 11, 14);
      px(g, '#100c08', 13, 28, 7, 12);
      px(g, P.woodLight, 11, 26, 2, 14); px(g, P.woodLight, 20, 26, 2, 14);
      px(g, P.woodLight, 11, 26, 11, 2);
      px(g, P.goldLight, 12, 30, 1, 1); // фонарь
      // рельсы и вагонетка
      px(g, '#3a382f', 14, 40, 5, 1); px(g, '#3a382f', 14, 42, 5, 1);
      px(g, P.outline, 23, 36, 8, 6);
      px(g, P.woodMid, 24, 37, 6, 4);
      px(g, P.gold, 25, 36, 4, 2); px(g, P.goldLight, 26, 36, 2, 1);
      px(g, P.ink, 24, 41, 2, 2); px(g, P.ink, 28, 41, 2, 2);
    });

    sprites.church = makeSprite(g => {
      // неф
      px(g, P.outline, 7, 25, 22, 17);
      shingles(g, 8, 26, 20, 5, ROOF_BLUE);
      px(g, P.wallCream, 9, 31, 18, 10);
      px(g, P.wallShade, 9, 39, 18, 2);
      px(g, P.ink, 15, 34, 6, 7);
      px(g, P.woodMid, 16, 35, 4, 6);
      px(g, P.gold, 16, 34, 4, 1);
      litWindow(g, 11, 33, 2, 4); litWindow(g, 23, 33, 2, 4);
      // колокольня со шпилем
      px(g, P.outline, 12, 4, 10, 22);
      px(g, P.wallCream, 13, 14, 8, 12);
      for (let r = 0; r < 7; r++) px(g, r ? ROOF_BLUE[r % 2] : ROOF_BLUE[2], 16 - r, 7 + r, 2 + r * 2, 1);
      litWindow(g, 15, 17, 3, 4);
      // золотой крест
      px(g, P.gold, 16, 0, 2, 6); px(g, P.gold, 14, 2, 6, 2);
    });

    sprites.market = makeSprite(g => {
      // навес в полоску с фестонами
      px(g, P.outline, 4, 22, 24, 6);
      for (let c = 0; c < 11; c++) px(g, c % 2 ? P.cream : P.red, 5 + c * 2, 23, 2, 4);
      for (let c = 0; c < 6; c++) px(g, c % 2 ? P.red : P.cream, 6 + c * 4, 27, 2, 1);
      // стойки и прилавок
      px(g, P.wood, 5, 28, 2, 12); px(g, P.wood, 25, 28, 2, 12);
      px(g, P.outline, 6, 33, 20, 6);
      px(g, P.woodLight, 7, 34, 18, 4);
      px(g, P.woodMid, 7, 36, 18, 1);
      // товары на прилавке
      px(g, P.gold, 9, 31, 3, 3); px(g, P.goldLight, 9, 31, 2, 1);
      px(g, '#7fa060', 14, 31, 3, 3); px(g, '#95bc74', 14, 31, 1, 1);
      px(g, P.red, 19, 31, 3, 3); px(g, '#d06264', 19, 31, 1, 1);
      // бочка
      px(g, P.outline, 27, 36, 5, 7);
      px(g, P.woodLight, 28, 37, 3, 5); px(g, P.wood, 28, 38, 3, 1); px(g, P.wood, 28, 40, 3, 1);
    });

    sprites.tavern = makeSprite(g => {
      // двухэтажный дом с выносом
      px(g, P.outline, 4, 14, 25, 28);
      shingles(g, 5, 15, 23, 6, ROOF_RED);
      timberWall(g, 6, 21, 21, 7);      // верхний этаж
      litWindow(g, 9, 23, 3, 3); litWindow(g, 21, 23, 3, 3);
      px(g, P.wood, 5, 28, 23, 1);      // балка-вынос
      timberWall(g, 8, 29, 17, 12);     // нижний этаж
      px(g, P.wood, 14, 33, 5, 8);
      px(g, P.goldLight, 17, 36, 1, 1);
      litWindow(g, 10, 32, 3, 3);
      // вывеска-кружка на кронштейне
      px(g, P.wood, 27, 24, 4, 1);
      px(g, P.wood, 30, 24, 1, 4);
      px(g, P.outline, 28, 28, 5, 5);
      px(g, P.gold, 29, 29, 3, 3); px(g, P.goldLight, 29, 29, 1, 2);
      // труба
      px(g, P.outline, 22, 10, 5, 6);
      px(g, P.stone, 23, 11, 3, 5); px(g, P.stoneDark, 23, 13, 3, 1);
    });

    sprites.dock = makeSprite(g => {
      // пирс на сваях
      px(g, P.outline, 1, 36, 16, 4);
      px(g, P.woodLight, 2, 37, 14, 2);
      px(g, P.woodMid, 5, 37, 1, 2); px(g, P.woodMid, 10, 37, 1, 2);
      px(g, P.wood, 3, 40, 2, 5); px(g, P.wood, 13, 40, 2, 5);
      // ладья со щитами
      px(g, P.outline, 13, 28, 19, 9);
      px(g, P.woodMid, 14, 30, 17, 4);
      px(g, P.woodLight, 14, 30, 17, 1);
      px(g, P.wood, 14, 34, 17, 2);
      px(g, P.wood, 13, 27, 2, 4);       // нос
      px(g, P.gold, 13, 26, 2, 2);       // фигура на носу
      // щиты по борту
      for (let s = 0; s < 3; s++) {
        const sx = 17 + s * 5;
        px(g, P.outline, sx - 1, 30, 5, 4);
        px(g, s % 2 ? P.red : P.cream, sx, 31, 3, 2);
        px(g, P.gold, sx + 1, 31, 1, 1);
      }
      // мачта с реем и свёрнутым парусом
      px(g, P.wood, 22, 12, 2, 16);
      px(g, P.woodMid, 17, 14, 12, 1);
      px(g, P.cream, 17, 15, 12, 3);
      px(g, P.wallShade, 17, 17, 12, 1);
    });

    /* --- Содержимое клеток 32×36 --- */

    sprites.beast = makeSprite(g => {
      const b = '#26221e';
      px(g, P.ink, 7, 17, 15, 8);
      px(g, b, 8, 18, 13, 6);            // тело
      px(g, b, 18, 12, 7, 7);            // голова
      px(g, b, 19, 10, 2, 2); px(g, b, 23, 10, 2, 2); // уши
      px(g, '#c93a3a', 20, 14, 2, 1); px(g, '#c93a3a', 23, 14, 1, 1); // глаза
      px(g, P.cream, 24, 17, 1, 2);      // клык
      px(g, b, 5, 19, 3, 2);             // хвост
      px(g, b, 9, 24, 2, 4); px(g, b, 17, 24, 2, 4); // лапы
      px(g, '#3a342e', 9, 19, 4, 2);     // холка
    });

    sprites.tamed = makeSprite(g => {
      const b = '#6b512c';
      px(g, P.ink, 7, 17, 15, 8);
      px(g, b, 8, 18, 13, 6);
      px(g, b, 18, 12, 7, 7);
      px(g, b, 19, 10, 2, 2); px(g, b, 23, 10, 2, 2);
      px(g, '#3f6d9e', 20, 14, 2, 1);
      px(g, b, 5, 19, 3, 2);
      px(g, b, 9, 24, 2, 4); px(g, b, 17, 24, 2, 4);
      // сердечко
      px(g, '#c93a3a', 12, 4, 2, 2); px(g, '#c93a3a', 16, 4, 2, 2);
      px(g, '#c93a3a', 12, 6, 6, 2); px(g, '#c93a3a', 14, 8, 2, 1);
    });

    sprites.fertile = makeSprite(g => {
      for (const [x, y] of [[8, 10], [19, 9], [12, 19], [22, 20]]) {
        px(g, P.gold, x + 1, y, 1, 4);
        px(g, P.gold, x - 1, y + 1, 2, 1); px(g, P.gold, x + 2, y + 1, 2, 1);
        px(g, P.goldLight, x + 1, y, 1, 1);
      }
    });

    sprites.timber = makeSprite(g => {
      px(g, P.outline, 7, 20, 19, 6);
      px(g, P.woodMid, 8, 21, 8, 2); px(g, P.woodLight, 17, 21, 8, 2);
      px(g, P.woodLight, 8, 23, 8, 2); px(g, P.woodMid, 17, 23, 8, 2);
      px(g, P.woodMid, 12, 18, 9, 2);
      px(g, P.cream, 9, 21, 1, 1); px(g, P.cream, 18, 23, 1, 1); px(g, P.cream, 13, 18, 1, 1);
    });

    sprites.ore = makeSprite(g => {
      for (const [x, y] of [[10, 12], [19, 16], [13, 22]]) {
        px(g, P.ink, x - 1, y - 1, 6, 5);
        px(g, P.gold, x, y, 4, 3);
        px(g, P.goldLight, x + 1, y, 2, 1); px(g, P.goldLight, x, y + 1, 1, 1);
      }
    });

    sprites.fish = makeSprite(g => {
      px(g, P.cream, 11, 14, 7, 3);
      px(g, P.cream, 18, 13, 2, 1); px(g, P.cream, 18, 17, 2, 1);
      px(g, P.ink, 12, 15, 1, 1);
      px(g, P.water.light, 8, 21, 9, 1);
      px(g, P.water.light, 12, 24, 6, 1);
    });

    /* --- Маркеры и эффекты --- */

    sprites.qmark = makeSprite(g => {
      const c = P.cream, o = P.outline;
      px(g, o, 0, 0, 9, 12);
      px(g, c, 2, 1, 5, 2); px(g, c, 6, 3, 2, 2); px(g, c, 4, 5, 2, 2);
      px(g, c, 4, 7, 1, 1);
      px(g, c, 4, 9, 2, 2);
    }, 9, 12);

    sprites.hourglass = makeSprite(g => {
      const o = P.outline;
      px(g, o, 0, 0, 9, 12);
      px(g, P.woodLight, 1, 1, 7, 1); px(g, P.woodLight, 1, 10, 7, 1);
      px(g, P.gold, 2, 2, 5, 3); px(g, P.gold, 4, 5, 1, 2); px(g, P.gold, 2, 7, 5, 3);
      px(g, P.goldLight, 3, 2, 2, 1);
    }, 9, 12);

    // Дым из труб — два кадра
    sprites.smoke = [0, 1].map(f => makeSprite(g => {
      const a = '#b2ac9e', b = '#8f8a7d';
      if (f === 0) {
        px(g, b, 3, 8, 3, 2); px(g, a, 2, 4, 4, 3); px(g, b, 4, 1, 3, 2);
      } else {
        px(g, b, 2, 8, 3, 2); px(g, a, 4, 4, 4, 3); px(g, b, 1, 0, 3, 3);
      }
    }, 10, 11));

    // Золотая обводка выбранного гекса
    sprites.select = makeSprite(g => {
      for (let y = 0; y < HH; y++) {
        const [x0, x1] = hexSpan(y);
        px(g, P.goldLight, x0, y); px(g, P.goldLight, x1, y);
        if (y < 9 || y >= 27) { px(g, P.goldLight, x0 + 1, y); px(g, P.goldLight, x1 - 1, y); }
      }
      const [t0, t1] = hexSpan(0);
      px(g, P.goldLight, t0, 0, t1 - t0 + 1, 1);
      const [b0, b1] = hexSpan(HH - 1);
      px(g, P.goldLight, b0, HH - 1, b1 - b0 + 1, 1);
    });

    // Туман поверх террейна
    sprites.fog = makeSprite(g => {
      g.globalAlpha = .7;
      for (let y = 0; y < HH; y++) {
        const [x0, x1] = hexSpan(y);
        px(g, '#0b1216', x0, y, x1 - x0 + 1, 1);
      }
      g.globalAlpha = 1;
      for (let k = 0; k < 14; k++) {
        const y = rnd(HH);
        const [x0, x1] = hexSpan(y);
        px(g, 'rgba(24,34,37,.85)', x0 + rnd(x1 - x0 + 1), y);
      }
    });
  }

  // Позиции дыма (в координатах спрайта 32×48) для построек с трубами
  const SMOKE_POS = {
    townhall: [23, 10],
    house: [12, 2],
    tavern: [22, 0],
    lumber: [25, 8],
  };

  // ---------- Отрисовка ----------
  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  function terrainSprite(t, now) {
    if (t.t === 'water') return sprites.water[Math.floor(now / 700) % 2];
    return sprites[t.t][t.v % sprites[t.t].length];
  }

  function render(now) {
    ctx.fillStyle = '#0c1112';
    ctx.fillRect(0, 0, CANW, CANH);
    for (let i = 0; i < S.tiles.length; i++) {
      const t = S.tiles[i];
      const { px: dx, py: dy } = tileOrigin(i);
      if (t.vis === 0) {
        ctx.drawImage(sprites.hidden, dx, dy);
        continue;
      }

      // «появление» гекса после разведки/стройки
      let scale = 1;
      if (!reduceMotion && t.pop && now - t.pop < 260) {
        scale = .6 + .4 * ((now - t.pop) / 260);
      }
      // низ спрайта прижат к низу гекса; высокие постройки уходят вверх
      const drawSpr = (img) => {
        const oy = HH - img.height;
        if (scale === 1) { ctx.drawImage(img, dx, dy + oy); return; }
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, dx + (img.width - w) / 2, dy + oy + (img.height - h) / 2, w, h);
      };

      drawSpr(terrainSprite(t, now));

      if (t.vis === 1) {
        ctx.drawImage(sprites.fog, dx, dy);
        if (t.explore > 0) {
          ctx.drawImage(sprites.hourglass, dx + 12, dy + 12);
        } else if (hexNeighbors(i).some(n => S.tiles[n].vis === 2)) {
          const bob = reduceMotion ? 0 : Math.round(Math.sin(now / 420 + i) * 2);
          ctx.drawImage(sprites.qmark, dx + 12, dy + 11 + bob);
        }
      } else {
        if (t.c && sprites[t.c]) drawSpr(sprites[t.c]);
        if (t.b) {
          drawSpr(sprites[t.b]);
          // дым из трубы
          const sp = SMOKE_POS[t.b];
          if (sp && !reduceMotion) {
            const f = (Math.floor(now / 520) + i) % 2;
            const rise = (Math.floor(now / 260) + i) % 3;
            ctx.globalAlpha = .75;
            ctx.drawImage(sprites.smoke[f], dx + sp[0], dy + OY + sp[1] - 9 - rise);
            ctx.globalAlpha = 1;
          }
        }
      }

      if (i === selected) {
        ctx.globalAlpha = reduceMotion ? 1 : .65 + .35 * Math.sin(now / 280);
        ctx.drawImage(sprites.select, dx, dy);
        ctx.globalAlpha = 1;
      }
    }
  }

  // Постоянный цикл анимации (вода, «?», дым, выделение).
  // При prefers-reduced-motion рисуем только по изменению состояния.
  function loop(now) {
    render(now);
    requestAnimationFrame(loop);
  }

  // ---------- Панель клетки ----------
  function renderPanel() {
    const panel = document.getElementById('panel');
    if (selected < 0) {
      panel.innerHTML = '<p class="panel__hint">Коснитесь гекса: «?» в тумане — разведка, своя земля — стройка.</p>';
      return;
    }
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
      } else if (hexNeighbors(selected).some(n => S.tiles[n].vis === 2)) {
        p.textContent = 'Что там — неизвестно, пока не пошлёшь разведчика.';
        const b = document.createElement('button');
        b.className = 'btn btn--small';
        b.innerHTML = `🔦 Разведать <span class="cost">(${exploreTurns()} дн., занимает 1 👥)</span>`;
        b.disabled = freeCitizens() < 1 || S.over;
        b.addEventListener('click', () => startExplore(selected));
        btns.appendChild(b);
      } else {
        p.textContent = 'Слишком далеко — разведайте соседний гекс.';
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
        p.textContent = (t.c ? `${CONTENT_NAME[t.c]}. ` : '') + 'Можно строить:';
        let any = false;
        for (const key in BUILDINGS) {
          const b = BUILDINGS[key];
          if (b.terr !== t.t) continue;
          any = true;
          const cost = buildCost(key);
          const costTxt = [cost.prod ? `${cost.prod} ⚒️` : '', cost.gold ? `${cost.gold} 🪙` : '']
            .filter(Boolean).join(' + ');
          const btn = document.createElement('button');
          btn.className = 'btn btn--small';
          btn.innerHTML = `${b.name} <span class="cost">(${costTxt})</span>`;
          btn.title = b.desc;
          btn.disabled = !canAfford(cost) || S.over;
          btn.addEventListener('click', () => build(selected, key));
          btns.appendChild(btn);
        }
        if (!any) p.textContent = 'Здесь ничего не построить.';
      }
    }

    panel.appendChild(h);
    panel.appendChild(p);
    if (btns.children.length) panel.appendChild(btns);
  }

  // ---------- Верхние индикаторы ----------
  function renderHud() {
    const inc = income();
    const set = (id, v) => { document.getElementById(id).textContent = v; };
    set('r-pop', `${freeCitizens()}/${S.pop}/${S.cap}`);
    set('r-food', `${S.food} (${inc.food - S.pop >= 0 ? '+' : ''}${inc.food - S.pop})`);
    set('r-prod', `${S.prod} (+${inc.prod})`);
    set('r-gold', `${S.gold} (+${inc.gold})`);
    set('r-faith', `${S.faith} (+${inc.faith})`);
    set('r-sci', S.sci);
    set('turn-label', `День ${S.turn}`);
    const left = S.nextTribute - S.turn;
    const tl = document.getElementById('tribute-label');
    const d = tributeDemand(S.tributesPaid + 1);
    tl.textContent = S.won && S.tributesPaid >= TRIBUTES_TO_WIN
      ? '👑 Милость короля заслужена'
      : `До дани: ${left} дн. (${d.gold} 🪙 + ${d.food} 🍞)`;
    tl.classList.toggle('is-soon', left <= 3 && !S.won);
    document.getElementById('btn-endday').disabled = S.over;
  }

  function renderAll() {
    if (reduceMotion) render(0);
    renderPanel();
    renderHud();
  }

  // ---------- Ввод ----------
  canvas.addEventListener('click', (e) => {
    if (S.over || modalOpen) return;
    const r = canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width * CANW;
    const my = (e.clientY - r.top) / r.height * CANH;
    // ближайший центр гекса
    let best = -1, bestD = 19 * 19;
    for (let i = 0; i < S.tiles.length; i++) {
      const { px, py } = tileOrigin(i);
      const dx = mx - (px + HW / 2), dy = my - (py + HH / 2);
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return;
    selected = (S.tiles[best].vis === 0) ? -1 : best;
    renderAll();
  });

  document.getElementById('btn-endday').addEventListener('click', endDay);
  document.getElementById('btn-tech').addEventListener('click', openTech);
  document.getElementById('btn-help').addEventListener('click', () => {
    if (modalOpen) return;
    showModal('❓ Как играть',
      'Ваше поселение окружено туманом. Каждый гекс тумана скрывает сюрприз: клад, руины, ' +
      'плодородную землю — или дикого зверя.\n\n' +
      '• Коснитесь гекса с «?» рядом со своей землёй, чтобы послать разведчика.\n' +
      '• На своей земле стройте: фермы кормят, дома дают жителей, шахты и рынки приносят ' +
      'производство и золото, церкви — веру.\n' +
      '• Жители едят 1 🍞 в день каждый. Голод убивает.\n' +
      '• Очки знаний 🔬 открывают технологии — с каждым открытием дороже.\n' +
      '• Раз в 12 дней король требует дань. Не заплатите — потеряете колонию. ' +
      `Выплатите ${TRIBUTES_TO_WIN} даней — победа!\n\n` +
      'Каждая партия — новая случайная карта. Удачи!',
      [{ label: 'Понятно', fn: () => {} }]);
  });

  // ---------- Старт ----------
  initSprites();
  newGame();
  if (!reduceMotion) requestAnimationFrame(loop);
})();
