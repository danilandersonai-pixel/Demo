/* «Пепел Литаний» — кампания: стратегическая карта планеты (провинции, доход,
   контратаки), ростер, герои, реквизиция, реликвии, карточки решений,
   преемники, летопись, сохранения (localStorage).

   СЕЙВЫ: версия 2 («ash-litany-v2»). Старый линейный сейв v1 несовместим со
   стратегическим слоем (нет карты провинций) — миграция невозможна без
   выдумывания состояния, поэтому v1 отбрасывается и вычищается: чистый старт.
   Это решение задокументировано здесь и в migrate(). */
'use strict';
var CAMPAIGN = (function () {
  var SAVE_KEY = 'ash-litany-v2';
  var OLD_KEYS = ['ash-litany-v1'];
  var SAVE_VER = 2;
  /* после каких по счёту побед Хор контратакует (если есть куда) */
  var COUNTER_AT = [2, 5];

  var state = null;      // состояние кампании
  var battle = null;     // текущий бой (или null)
  var snapshot = null;   // слепок кампании перед боем (для «Повторить миссию»)
  var nextSquadId = 1;

  /* ---------- создание ---------- */
  function mkSquad(typeId) {
    var t = DATA.UNITS[typeId];
    var names = [];
    for (var i = 0; i < t.models; i++) names.push(DATA.genSoldierName());
    return {
      id: nextSquadId++, type: typeId, models: t.models, names: names,
      squadName: t.vehicle ? DATA.genSquadName(typeId)
        : (t.models > 1 ? DATA.genSquadName(typeId) : 'Хоругвь Св. Ольты'),
      veteran: false
    };
  }
  function mkHero(key) {
    return {
      key: key, name: DATA.genHeroName(key), level: 1, xp: 0,
      traits: [], lineage: [], alive: true, pendingChoice: null
    };
  }

  function fresh() {
    var seed = ((Date.now() & 0x7fffffff) ^ (Math.floor(Math.random() * 1e9))) >>> 0;
    RNG.seed(seed);
    nextSquadId = 1;
    var provinces = {};
    DATA.PROV_ORDER.forEach(function (pid) {
      provinces[pid] = pid === 'plats' ? 'player' : 'chorus';
    });
    state = {
      seed: seed, turn: 1, wins: 0,
      provinces: provinces, pendingDefense: null,
      roster: DATA.START_ROSTER.map(mkSquad),
      heroes: { exec: mkHero('exec'), deacon: mkHero('deacon') },
      req: 30,
      relics: {},       // id -> {mode:'worn'|'burned', bearer:'exec'|'deacon'}
      miracles: {},     // miracleId -> 'ready'|'used'
      decisions: [],    // {id, choice:'a'|'b'}
      chronicle: [],    // {turn, text}
      fallen: [],       // {name, squad, mission}
      flags: {}, ldPerm: {}, ldNext: 0,
      stats: { kills: 0, losses: 0, deserters: 0, retries: 0, lostProvinces: 0 },
      pendingDecision: null, pendingRelic: null,
      nextSquadId: 1, finished: false
    };
    state.nextSquadId = nextSquadId;
    chron('Высадка на Веспер-Приму. ' + state.heroes.exec.name + ' принимает полк; ' +
      state.heroes.deacon.name + ' благословляет порох. Впереди — восемь провинций Хора.');
    battle = null;
    snapshot = null;
    save();
  }

  function chron(text) {
    state.chronicle.push({ turn: state.turn, text: text });
  }

  /* ---------- сохранение ---------- */
  function save() {
    if (!state) return;
    state.nextSquadId = nextSquadId;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        ver: SAVE_VER, rngState: RNG.getState(),
        state: state, battle: battle, snapshot: snapshot
      }));
    } catch (e) { /* приватный режим — играем без сейвов */ }
  }
  function migrate(raw) {
    /* v2 — актуальная. v1 (линейная кампания) не мигрируется: у неё нет карты
       провинций, честная реконструкция невозможна — чистый старт. */
    if (!raw || typeof raw.ver !== 'number') return null;
    if (raw.ver === SAVE_VER) return raw;
    return null;
  }
  function purgeOld() {
    OLD_KEYS.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }
  function load() {
    purgeOld();
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { raw = null; }
    raw = migrate(raw);
    if (!raw || !raw.state) return false;
    state = raw.state;
    battle = raw.battle || null;
    snapshot = raw.snapshot || null;
    nextSquadId = state.nextSquadId || 100;
    RNG.setState(raw.rngState || state.seed);
    return true;
  }
  function hasSave() {
    try { return !!migrate(JSON.parse(localStorage.getItem(SAVE_KEY))); }
    catch (e) { return false; }
  }
  function wipe() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    purgeOld();
    state = null; battle = null; snapshot = null;
  }

  /* ---------- стратегическая карта ---------- */
  function heldBy(pid) { return state.provinces[pid]; }
  function income() {
    var sum = 0;
    DATA.PROV_ORDER.forEach(function (pid) {
      if (state.provinces[pid] === 'player') sum += DATA.PROVINCES[pid].income;
    });
    return sum;
  }
  function isFrontier(pid) { /* провинция Хора, соседняя с нашей */
    if (state.provinces[pid] !== 'chorus') return false;
    return DATA.PROVINCES[pid].neighbors.some(function (n) {
      return state.provinces[n] === 'player';
    });
  }
  function attackable() {
    if (state.pendingDefense) return []; // сначала — оборона
    return DATA.PROV_ORDER.filter(isFrontier);
  }
  function counterTargets() { /* наши провинции, соседние с Хором */
    return DATA.PROV_ORDER.filter(function (pid) {
      if (state.provinces[pid] !== 'player') return false;
      return DATA.PROVINCES[pid].neighbors.some(function (n) {
        return state.provinces[n] === 'chorus';
      });
    });
  }

  /* ---------- сборка боя ---------- */
  function heroBattleExtras(key) {
    var h = state.heroes[key];
    var ex = {
      heroKey: key, heroName: h.name, traits: h.traits.slice(),
      svBonus: 0, atkBonus: 0, orderRange: 4
    };
    if (h.traits.indexOf('neugasim') >= 0) ex.svBonus += 1;
    if (h.traits.indexOf('palach') >= 0) ex.atkBonus += 1;
    if (h.traits.indexOf('propoved') >= 0) ex.hitAura = true;
    if (h.traits.indexOf('porokh') >= 0) ex.orderSavePen = true;
    if (h.traits.indexOf('dalnoboj') >= 0) ex.orderRange = 6;
    if (state.flags.deaconRangePlus && key === 'deacon') ex.orderRange += 1;
    Object.keys(state.relics).forEach(function (rid) {
      var rel = state.relics[rid];
      if (rel.mode !== 'worn' || rel.bearer !== key) return;
      if (rid === 'kadilnica') ex.relicAura = true;
      if (rid === 'kolokol') { ex.svBonus += 1; ex.shriekImmune = true; }
      if (rid === 'psaltyr') { ex.orderUnjammable = true; ex.orderRange += 2; }
    });
    return ex;
  }

  function missionFor(provId) {
    if (state.pendingDefense === provId) return DATA.defenseMission(provId, state.wins);
    return DATA.PROVINCES[provId].mission;
  }

  function startMission(provId) {
    snapshot = JSON.parse(JSON.stringify(state));
    var mission = JSON.parse(JSON.stringify(missionFor(provId)));
    var specs = [];
    state.roster.forEach(function (sq) {
      if (sq.models <= 0) return;
      specs.push({
        type: sq.type, models: sq.models, names: sq.names,
        squadName: sq.squadName, veteran: sq.veteran, rosterId: sq.id,
        ldPerm: state.ldPerm[sq.type] || 0
      });
    });
    specs.push(heroBattleExtras('exec'));
    specs.push(heroBattleExtras('deacon'));
    specs.forEach(function (s) { if (!s.type) s.type = s.heroKey === 'exec' ? 'exec' : 'deacon'; });
    battle = ENGINE.buildBattle(provId, mission, specs, state.flags);
    battle.ldGlobal = state.ldNext || 0;
    save();
    return battle;
  }

  /* ---------- очередь событий (реликвии/решения) ---------- */
  function refreshPending(capturedProv) {
    if (!state.pendingRelic) {
      for (var i = 0; i < DATA.RELICS.length; i++) {
        var r = DATA.RELICS[i];
        if (state.relics[r.id]) continue;
        if (r.afterProv === capturedProv || state.wins >= r.afterWins) {
          state.pendingRelic = r.id;
          break;
        }
      }
    }
    if (!state.pendingDecision) {
      for (var j = 0; j < DATA.DECISIONS.length; j++) {
        var d = DATA.DECISIONS[j];
        var taken = state.decisions.some(function (x) { return x.id === d.id; });
        if (taken) continue;
        if (d.afterProv === capturedProv || state.wins >= d.afterWins) {
          state.pendingDecision = d.id;
          break;
        }
      }
    }
  }

  /* ---------- итоги боя ---------- */
  function finishBattle(win) {
    var b = battle;
    var m = b.m;
    var provId = b.provId;
    var wasDefense = b.defense;
    var prov = DATA.PROVINCES[provId];
    var report = {
      win: win, mission: m, provId: provId, defense: wasDefense,
      fallen: b.fallen.slice(), deserters: b.deserters,
      xp: {}, req: 0, income: 0, destroyedSquads: [], successors: [],
      sanitar: null, unlock: null, counter: null, provLost: null
    };

    if (!win) {
      state.stats.retries += 1;
      var retries = state.stats.retries;
      var lostProv = state.stats.lostProvinces;
      var chronCopy = state.chronicle.slice();
      state = JSON.parse(JSON.stringify(snapshot));
      state.stats.retries = retries;
      state.stats.lostProvinces = lostProv;
      state.chronicle = chronCopy;
      nextSquadId = state.nextSquadId || nextSquadId;
      if (wasDefense) {
        /* проигранная оборона: полк отходит, провинция возвращается Хору */
        state.provinces[provId] = 'chorus';
        state.pendingDefense = null;
        state.stats.lostProvinces += 1;
        state.turn += 1;
        report.provLost = prov.name;
        report.income = income();
        state.req += report.income;
        chron('⚑ ' + prov.name + ' отбита Хором. Доход провинции потерян; полк отходит с обозами.');
      } else {
        chron('Штурм «' + prov.name + '» захлебнулся. Полк отступил и перестроился.');
      }
      battle = null;
      snapshot = null;
      save();
      return report;
    }

    /* синхронизация ростера с полем боя */
    var lostModels = 0;
    state.roster = state.roster.filter(function (sq) {
      var bu = b.units.filter(function (u) { return u.rosterId === sq.id; })[0];
      if (!bu) return true;
      var before = sq.models;
      if (bu.models <= 0) {
        lostModels += before;
        report.destroyedSquads.push(sq.squadName + ' (' + DATA.UNITS[sq.type].name + ')');
        chron('Отряд ' + sq.squadName + ' перестал существовать. Полковое имя вычеркнуто.');
        return false; // отряд стёрт — имя и ветеранство потеряны
      }
      lostModels += before - bu.models;
      sq.models = bu.models;
      sq.names = bu.names.slice();
      /* одиночки и техника «выздоравливают»: раны героев лечат капелланы,
         технику чинит обряд починки. Уничтоженное — вычеркнуто выше. */
      if (DATA.UNITS[sq.type].wpm > 1) sq.models = 1;
      if (!sq.veteran) {
        sq.veteran = true; // выжившие в бою получают ветеранскую метку (+1 Лд)
      }
      return true;
    });

    /* павшие поимённо */
    b.fallen.forEach(function (f) {
      state.fallen.push({ name: f.name, squad: f.squad, mission: m.name });
    });
    state.stats.losses += lostModels;
    state.stats.deserters += b.deserters;
    var kills = 0;
    b.units.forEach(function (u) { if (u.side === 'player') kills += u.kills; });
    state.stats.kills += kills;

    /* герои: опыт, раны, преемники */
    ['exec', 'deacon'].forEach(function (key) {
      var h = state.heroes[key];
      var bu = b.units.filter(function (u) { return u.heroKey === key; })[0];
      var gained = 4 + (bu ? bu.kills : 0);
      if (b.heroDown[key]) {
        var old = h.name;
        h.lineage.push(old);
        h.name = DATA.genHeroName(key, h.lineage);
        h.level = Math.max(1, h.level - 1);
        if (h.traits.length > h.level - 1) h.traits.pop();
        h.xp = DATA.XP_LEVELS[h.level] || 0;
        report.successors.push({ key: key, old: old, next: h.name });
        chron((key === 'exec' ? 'Экзекутор ' : 'Дьякон ') + old +
          ' догорел в бою за «' + prov.name + '». Литанию подхватывает преемник: ' + h.name + '.');
      } else {
        h.xp += gained;
        report.xp[key] = gained;
      }
    });

    /* стратегический итог: захват/оборона, доход, разблокировки */
    if (wasDefense) {
      state.pendingDefense = null;
      chron('Контратака на «' + prov.name + '» отбита. Провинция удержана.');
    } else {
      state.provinces[provId] = 'player';
      state.wins += 1;
      chron('Провинция «' + prov.name + '» освобождена (' + state.wins + '-я победа похода).');
      if (prov.unlock && !state.flags[prov.unlock.flag]) {
        state.flags[prov.unlock.flag] = true;
        report.unlock = prov.unlock.text;
        chron('✦ ' + prov.unlock.text);
      }
      if (prov.capital) state.finished = true;
    }
    state.turn += 1;

    /* реквизиция: награда миссии + компенсация потерь + ДОХОД с провинций */
    var comp = Math.min(20, lostModels * 2);
    report.req = (m.reward.req || 0) + comp;
    report.income = income();
    state.req += report.req + report.income;

    /* контратака Хора: после ключевых побед, если есть фронтир */
    if (!wasDefense && !prov.capital && !state.finished &&
        COUNTER_AT.indexOf(state.wins) >= 0) {
      var targets = counterTargets();
      if (targets.length) {
        var tgt = RNG.pick(targets);
        state.pendingDefense = tgt;
        report.counter = DATA.PROVINCES[tgt].name;
        chron('⚠ Разведка: Хор перепевает контрнаступление на «' + DATA.PROVINCES[tgt].name + '».');
      }
    }

    /* Санитар веры: один павший возвращается */
    if (state.heroes.deacon.traits.indexOf('sanitar') >= 0 && b.fallen.length) {
      var worst = null, worstRatio = 1;
      state.roster.forEach(function (sq) {
        var t = DATA.UNITS[sq.type];
        if (t.wpm > 1 || sq.models >= t.models) return;
        var ratio = sq.models / t.models;
        if (!worst || ratio < worstRatio) { worst = sq; worstRatio = ratio; }
      });
      if (worst) {
        var backName = b.fallen[b.fallen.length - 1].name;
        worst.models += 1;
        worst.names.push(backName);
        report.sanitar = backName + ' (' + worst.squadName + ')';
        chron('Санитар веры вытащил из пепла ' + backName + '.');
      }
    }

    chron('«' + m.name + '»: победа. Пало ' + b.fallen.length + ', дезертировало ' + b.deserters + '.');

    /* очередь событий после боя */
    refreshPending(wasDefense ? null : provId);

    state.ldNext = 0; // модификатор Лд действовал только на этот бой
    battle = null;
    snapshot = null;
    save();
    return report;
  }

  /* ---------- решения и реликвии ---------- */
  function applyDecision(cardId, choice) {
    var card = DATA.DECISIONS.filter(function (d) { return d.id === cardId; })[0];
    if (!card) return;
    var opt = card[choice];
    var fx = opt.fx || {};
    if (fx.req) state.req += fx.req;
    if (fx.ldPerm) fx.ldPerm.forEach(function (t) { state.ldPerm[t] = (state.ldPerm[t] || 0) + 1; });
    if (fx.replenishAll) {
      state.roster.forEach(function (sq) {
        var t = DATA.UNITS[sq.type];
        if (t.wpm > 1) return;
        var add = Math.min(fx.replenishAll, t.models - sq.models);
        for (var i = 0; i < add; i++) { sq.models++; sq.names.push(DATA.genSoldierName()); }
      });
    }
    if (fx.flag) state.flags[fx.flag] = true;
    if (fx.addSquad && state.roster.length < DATA.ROSTER_CAP) state.roster.push(mkSquad(fx.addSquad));
    if (fx.xp) Object.keys(fx.xp).forEach(function (k) { state.heroes[k].xp += fx.xp[k]; });
    if (fx.ldNext) state.ldNext = fx.ldNext; else if (!('ldNext' in fx)) state.ldNext = state.ldNext || 0;
    state.decisions.push({ id: cardId, choice: choice });
    chron('Решение — «' + card.title + '»: ' + opt.label + '.');
    state.pendingDecision = null;
    refreshPending(null);
    save();
  }

  function applyRelic(relicId, mode, bearer) {
    var r = DATA.RELICS.filter(function (x) { return x.id === relicId; })[0];
    if (!r) return;
    if (mode === 'worn') {
      state.relics[relicId] = { mode: 'worn', bearer: bearer || 'exec' };
      chron('Реликвия «' + r.name + '» — носима: ' + state.heroes[state.relics[relicId].bearer].name + '.');
    } else {
      state.relics[relicId] = { mode: 'burned' };
      state.miracles[r.burn.miracle] = 'ready';
      chron('Реликвия «' + r.name + '» сожжена в жертву. Чудо «' + DATA.MIRACLES[r.burn.miracle].name + '» ждёт своего часа.');
    }
    state.pendingRelic = null;
    refreshPending(null);
    save();
  }

  function useMiracle(mid) {
    if (state.miracles[mid] === 'ready') {
      state.miracles[mid] = 'used';
      chron('Чудо «' + DATA.MIRACLES[mid].name + '» истрачено.');
      save();
      return true;
    }
    return false;
  }

  /* ---------- реквизиция: покупка и восполнение ---------- */
  function countType(typeId) {
    return state.roster.filter(function (s) { return s.type === typeId; }).length;
  }
  function buyable() {
    var list = DATA.BUYABLE.slice();
    DATA.UNLOCKABLE.forEach(function (u) {
      if (state.flags[u.flag]) list.push(u.unit);
    });
    return list;
  }
  function canBuy(typeId) {
    var t = DATA.UNITS[typeId];
    if (!t || state.roster.length >= DATA.ROSTER_CAP) return false;
    if (state.req < t.cost) return false;
    if ((typeId === 'svech' || t.unique) && countType(typeId) >= 1) return false;
    if (t.arty && countType(typeId) >= 2) return false; // артиллерия не должна доминировать
    return true;
  }
  function replenishOne(squadId) {
    var sq = state.roster.filter(function (s) { return s.id === squadId; })[0];
    if (!sq) return false;
    var t = DATA.UNITS[sq.type];
    var cost = DATA.modelCost(sq.type);
    if (sq.models >= t.models || state.req < cost) return false;
    state.req -= cost;
    sq.models += 1;
    sq.names.push(DATA.genSoldierName());
    save();
    return true;
  }
  function buySquad(typeId) {
    if (!canBuy(typeId)) return false;
    state.req -= DATA.UNITS[typeId].cost;
    state.roster.push(mkSquad(typeId));
    save();
    return true;
  }

  /* ---------- прокачка ---------- */
  function pendingLevel(key) {
    var h = state.heroes[key];
    if (h.level >= 4) return null;
    var need = DATA.XP_LEVELS[h.level + 1];
    if (h.xp >= need) {
      var pool = DATA.TRAITS[key].filter(function (t) { return h.traits.indexOf(t.id) < 0; });
      return pool.slice(0, 2);
    }
    return null;
  }
  function chooseTrait(key, traitId) {
    var h = state.heroes[key];
    if (h.level >= 4) return;
    h.level += 1;
    h.traits.push(traitId);
    var tr = DATA.TRAITS[key].filter(function (t) { return t.id === traitId; })[0];
    chron(state.heroes[key].name + ' достигает уровня ' + h.level + ': «' + tr.name + '».');
    save();
  }

  /* ---------- эпилог (одна концовка по итогам похода) ---------- */
  function epilogue() {
    var s = state;
    var out = [];
    var freed = DATA.PROV_ORDER.filter(function (pid) { return s.provinces[pid] === 'player'; }).length;
    out.push('Звезда Веспер-Крон не разгорелась. Она и не должна была: кадила лишь ' +
      'докармливают её агонию, покупая столетие за столетием. Но Веспер-Прима — свободна: ' +
      freed + ' провинций из девяти под свечой, Осколочный Престол разбит, и в этой тишине ' +
      'снова можно жечь свечи.');
    if (s.stats.lostProvinces) {
      out.push('Планета помнит и отступления: ' + s.stats.lostProvinces +
        ' раз провинции возвращались Хору, прежде чем их отпели заново.');
    }
    out.push('Цена записана писарем полка, поимённо: ' + s.fallen.length +
      ' павших, ' + s.stats.deserters + ' ушедших во тьму. ' +
      (s.fallen.length ? 'Первым в списке — ' + s.fallen[0].name + ' (' + s.fallen[0].squad +
        '), последним — ' + s.fallen[s.fallen.length - 1].name + ' (' +
        s.fallen[s.fallen.length - 1].squad + '). ' : '') +
      'Хор потерял ' + s.stats.kills + ' резонаторов-мертвецов. Никто не назовёт это милосердием.');
    var lin = [];
    ['exec', 'deacon'].forEach(function (k) {
      var h = s.heroes[k];
      if (h.lineage.length) {
        lin.push((k === 'exec' ? 'Линия Экзекутора' : 'Линия Дьякона') + ': ' +
          h.lineage.join(' → ') + ' → ' + h.name);
      }
    });
    if (lin.length) {
      out.push('Литанию несли по очереди. ' + lin.join('. ') + '. Преемник донёс то, что уронил предшественник.');
    } else {
      out.push(s.heroes.exec.name + ' и ' + s.heroes.deacon.name +
        ' прошли поход от первой свечи до последней — редкость, о которой сложат неловкое житие.');
    }
    var dec = s.decisions.map(function (d) {
      var card = DATA.DECISIONS.filter(function (c) { return c.id === d.id; })[0];
      return '«' + card.title + '» — ' + card[d.choice].label.toLowerCase();
    });
    if (dec.length) out.push('В хронике решений похода: ' + dec.join('; ') + '. Каждое — оплачено.');
    var burned = [], worn = [];
    DATA.RELICS.forEach(function (r) {
      var rec = s.relics[r.id];
      if (!rec) return;
      (rec.mode === 'burned' ? burned : worn).push(r.name);
    });
    if (worn.length) out.push('Реликвии, что несли на груди: ' + worn.join(', ') + '.');
    if (burned.length) out.push('Реликвии, что сгорели в жертву: ' + burned.join(', ') + '. Пепел литаний — тоже литания.');
    out.push('Полк грузится на транспорты — к следующему гаснущему миру. Свеча должна гореть — и кто-то должен быть фитилём.');
    return out;
  }

  return {
    fresh: fresh, save: save, load: load, hasSave: hasSave, wipe: wipe,
    getState: function () { return state; },
    getBattle: function () { return battle; },
    setBattle: function (b) { battle = b; },
    income: income, attackable: attackable, isFrontier: isFrontier,
    heldBy: heldBy, missionFor: missionFor,
    startMission: startMission, finishBattle: finishBattle,
    applyDecision: applyDecision, applyRelic: applyRelic, useMiracle: useMiracle,
    replenishOne: replenishOne, buySquad: buySquad, buyable: buyable, canBuy: canBuy,
    countType: countType,
    pendingLevel: pendingLevel, chooseTrait: chooseTrait,
    epilogue: epilogue, chron: chron
  };
})();
