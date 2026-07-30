'use strict';

/**
 * Режим «Сыграй сам» и код стратегий для браузера.
 *
 * Главный риск этого режима — расхождение двух реализаций. Противник в
 * браузере обязан быть тем же самым существом, что играет турнир: иначе разбор
 * после боя разбирает поведение, которого в лиге нет. Поэтому здесь проверяется
 * не «работает ли кнопка», а тождество:
 *
 *   1. `viz/strategies.js` не отстал от исходников — пересборка даёт байт в байт;
 *   2. состав и цвета лиги в браузере совпадают с реестром;
 *   3. каждая из 17 стратегий из бандла играет неотличимо от себя же из Node;
 *   4. пошаговый цикл поединка даёт ровно то же, что `playMatch` на том же
 *      списке приказов и том же жребии;
 *   5. разбор после боя опирается на настоящие контрфакты.
 */

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

var bundle = require('../sim/bundle');
var registry = require('../strategies');
var match = require('../engine/match');

var VIZ = path.join(__dirname, '..', 'viz');
var ARENA = path.join(VIZ, 'arena.html');
var STRATEGIES = path.join(VIZ, 'strategies.js');

/** Исполнить viz/strategies.js так же, как это сделает браузер. */
function loadCode() {
  assert.ok(fs.existsSync(STRATEGIES), 'нет viz/strategies.js — запусти node sim/bundle.js');
  var src = fs.readFileSync(STRATEGIES, 'utf8');
  var host = {};
  vm.compileFunction(src, ['window'], { filename: 'strategies.js' })(host);
  return host.ARENA_CODE;
}

var CODE = loadCode();
var DUEL_ROUNDS = 20;
var PAY = { R: 3, P: 1, T: 5, S: 0 };

/* ======================== Свежесть и форма бандла ======================== */

test('бандл: собранный файл не отстал от исходников', function () {
  // Единственная защита от самого вероятного отказа: поправили стратегию,
  // забыли пересобрать — и человек играет против прошлой версии противника.
  var fresh = bundle.build();
  var onDisk = fs.readFileSync(STRATEGIES, 'utf8');
  assert.strictEqual(onDisk, fresh,
    'viz/strategies.js устарел относительно исходников — запусти node sim/bundle.js');
});

test('бандл: подаётся присваиванием в window, без fetch и без внешних адресов', function () {
  var src = fs.readFileSync(STRATEGIES, 'utf8');
  assert.ok(/window\.ARENA_CODE\s*=/.test(src), 'код должен присваиваться в window.ARENA_CODE');
  assert.strictEqual(src.indexOf('fetch('), -1, 'fetch не работает с file://');
  assert.strictEqual(src.indexOf('http://'), -1, 'никаких внешних ресурсов');
  assert.strictEqual(src.indexOf('https://'), -1, 'никаких внешних ресурсов');

  var html = fs.readFileSync(ARENA, 'utf8');
  assert.ok(/<script src="strategies\.js"><\/script>/.test(html),
    'arena.html обязана подключать strategies.js тегом');
});

test('бандл: состав и порядок лиги совпадают с реестром', function () {
  var league = CODE.league();
  assert.strictEqual(league.length, registry.list.length);
  registry.list.forEach(function (def, i) {
    assert.strictEqual(league[i].id, def.id, 'порядок лиги разошёлся на позиции ' + i);
    assert.strictEqual(league[i].color, def.color, def.id + ': цвет разошёлся с реестром');
    assert.strictEqual(league[i].name, def.name);
    assert.strictEqual(typeof league[i].create, 'function');
  });
});

test('бандл: мини-require разрешает относительные пути как Node', function () {
  assert.strictEqual(bundle.resolvePath('strategies/evolved', '../../engine/genome'), 'engine/genome');
  assert.strictEqual(bundle.resolvePath('engine', './payoff'), 'engine/payoff');
  assert.strictEqual(bundle.resolvePath('strategies/challengers', './resonance'),
    'strategies/challengers/resonance');
  // И проверка того же на живом бандле: «Безымянный» тянет engine/genome,
  // а он лежит на два уровня выше — если бы путь разрешался иначе, модуль
  // не собрался бы вовсе.
  assert.ok(CODE.require('strategies/evolved/nameless').create);
  assert.strictEqual(CODE.require('engine/payoff').PAYOFF.R, 3);
});

/* ===================== Тождество браузера и симуляции ==================== */

test('бандл: все 17 стратегий играют неотличимо от своих оригиналов', function () {
  var league = CODE.league();
  var pairs = 0;
  for (var i = 0; i < league.length; i++) {
    for (var j = i; j < league.length; j++) {
      var opts = { rounds: 60, noise: 0.05, seed: 1234 + i * 31 + j };
      var real = match.playMatch(registry.list[i], registry.list[j], opts);
      var mirror = match.playMatch(league[i], league[j], opts);
      assert.strictEqual(mirror.scoreA, real.scoreA,
        league[i].id + ' vs ' + league[j].id + ': счёт разошёлся с оригиналом');
      assert.strictEqual(mirror.scoreB, real.scoreB,
        league[i].id + ' vs ' + league[j].id + ': счёт разошёлся с оригиналом');
      pairs += 1;
    }
  }
  assert.strictEqual(pairs, (17 * 18) / 2);
});

test('бандл: playMatch в браузере даёт то же, что playMatch в Node', function () {
  var M = CODE.require('engine/match');
  var league = CODE.league();
  var opts = { rounds: 200, noise: 0.05, seed: 777, payoff: PAY };
  var here = match.playMatch(registry.byId('patience'), registry.byId('resonance'), opts);
  var there = M.playMatch(league[9], league[14], opts);
  assert.strictEqual(league[9].id, 'patience');
  assert.strictEqual(league[14].id, 'resonance');
  assert.deepStrictEqual(
    { a: there.scoreA, b: there.scoreB, f: there.flipsA },
    { a: here.scoreA, b: here.scoreB, f: here.flipsA }
  );
});

/* ========================= Пошаговый ход поединка ======================== */

/**
 * Тот же цикл, что крутится в arena.html при нажатии кнопок: человек решает,
 * канал искажает, начисляются очки, обе истории пополняются исполненным.
 * Дублирование кода здесь осознанное — браузерный цикл нельзя импортировать, —
 * поэтому ниже отдельно проверяется, что arena.html выводит потоки из тех же
 * констант.
 */
function stepwise(orders, foeDef, seed, noise) {
  var rng = CODE.require('engine/rng');
  var P = CODE.require('engine/payoff');
  var H = CODE.require('engine/history');

  var noiseMe = rng.mulberry32(rng.hashSeed(seed, 0x9e37));
  var noiseFoe = rng.mulberry32(rng.hashSeed(seed, 0x85eb));
  var coinFoe = rng.mulberry32(rng.hashSeed(seed, 0x27d4));

  var histMe = H.createHistory();
  var histFoe = H.createHistory();
  var agent = foeDef.create({ random: coinFoe });

  var me = 0;
  var foe = 0;
  var mine = [];
  orders.forEach(function (want) {
    var wantFoe = P.normalize(agent.move(histFoe));
    var actualMe = want;
    var actualFoe = wantFoe;
    if (noise > 0) {
      if (noiseMe() < noise) actualMe = P.flip(actualMe);
      if (noiseFoe() < noise) actualFoe = P.flip(actualFoe);
    }
    var pts = P.score(actualMe, actualFoe, PAY);
    me += pts[0];
    foe += pts[1];
    mine.push(actualMe);
    histMe.__push(actualMe, actualFoe);
    histFoe.__push(actualFoe, actualMe);
  });
  return { me: me, foe: foe, mine: mine.join('') };
}

/** Игрок из готового списка приказов — то же, что tapeDef в arena.html. */
function tapeDef(orders) {
  return {
    id: 'human',
    create: function () {
      var i = 0;
      return { move: function () { i += 1; return orders[i - 1] || 'C'; } };
    }
  };
}

test('поединок: пошаговый цикл совпадает с playMatch на том же списке приказов', function () {
  var league = CODE.league();
  var M = CODE.require('engine/match');
  var orders = 'CCDCCCDDCCCCDCCCCCCD'.split('');

  league.forEach(function (foeDef, i) {
    var seed = 900000 + i;
    var live = stepwise(orders, foeDef, seed, 0.05);
    var replay = M.playMatch(tapeDef(orders), foeDef, {
      rounds: DUEL_ROUNDS, noise: 0.05, seed: seed, payoff: PAY
    });
    assert.strictEqual(live.me, replay.scoreA, foeDef.id + ': очки человека разошлись');
    assert.strictEqual(live.foe, replay.scoreB, foeDef.id + ': очки противника разошлись');
  });
});

test('поединок: arena.html выводит потоки жребия из тех же констант', function () {
  // Страж дублирования выше: если кто-то поменяет в arena.html вывод потоков,
  // тест на совпадение с playMatch этого не заметит — он крутит свою копию.
  var html = fs.readFileSync(ARENA, 'utf8');
  ['0x9e37', '0x85eb', '0x27d4'].forEach(function (magic) {
    assert.ok(html.indexOf(magic) >= 0,
      'в arena.html нет константы потока ' + magic + ' — поединок пошёл по другому жребию');
  });
  var engine = fs.readFileSync(path.join(__dirname, '..', 'engine', 'match.js'), 'utf8');
  ['0x9e37', '0x85eb', '0x27d4'].forEach(function (magic) {
    assert.ok(engine.indexOf(magic) >= 0, 'engine/match.js больше не использует ' + magic);
  });
});

test('поединок: шум искажает приказы, и без шума — не искажает', function () {
  var league = CODE.league();
  var pacifist = league[0];
  assert.strictEqual(pacifist.id, 'alwaysCooperate');
  var orders = 'CCCCCCCCCCCCCCCCCCCC'.split('');

  var quiet = stepwise(orders, pacifist, 4242, 0);
  assert.strictEqual(quiet.mine, orders.join(''), 'без шума приказ обязан доходить дословно');
  assert.strictEqual(quiet.me, DUEL_ROUNDS * PAY.R, 'два пацифиста в тишине берут ровно R за раунд');

  // При 5% шума на 20 раундах искажения — событие вероятное, но не гарантированное
  // на любом отдельном жребии. Смотрим по сотне жребиев: хоть где-то обязано быть.
  var garbled = 0;
  for (var s = 0; s < 100; s++) {
    var noisy = stepwise(orders, pacifist, 5000 + s, 0.05);
    for (var k = 0; k < DUEL_ROUNDS; k++) if (noisy.mine[k] !== 'C') garbled += 1;
  }
  assert.ok(garbled > 40 && garbled < 160,
    'на 2000 приказов при 5% шума ожидается около сотни искажений, вышло ' + garbled);
});

/* ============================ Разбор после боя =========================== */

test('разбор: контрфакт «не бей первым» измеряет настоящую разницу', function () {
  var league = CODE.league();
  var M = CODE.require('engine/match');
  var tft = league[3];
  assert.strictEqual(tft.id, 'titForTat');

  // Против Зеркала без шума удар без повода стоит ровно двух очков: раунд
  // удара даёт +2 к R, а следующий — ответ, −3 к R и −2 относительно P.
  var seed = 31337;
  var peaceful = 'CCCCCCCCCCCCCCCCCCCC'.split('');
  var withStrike = peaceful.slice();
  withStrike[4] = 'D';

  var a = M.playMatch(tapeDef(peaceful), tft, { rounds: DUEL_ROUNDS, noise: 0, seed: seed, payoff: PAY });
  var b = M.playMatch(tapeDef(withStrike), tft, { rounds: DUEL_ROUNDS, noise: 0, seed: seed, payoff: PAY });
  assert.strictEqual(a.scoreA, DUEL_ROUNDS * PAY.R);
  assert.strictEqual(b.scoreA, a.scoreA - 1,
    'удар по Зеркалу даёт +2 сразу и −3 в ответ: чистая потеря — одно очко');
  // А в последнем раунде тот же удар бесплатен — ответить нечем.
  var lastStrike = peaceful.slice();
  lastStrike[DUEL_ROUNDS - 1] = 'D';
  var c = M.playMatch(tapeDef(lastStrike), tft, { rounds: DUEL_ROUNDS, noise: 0, seed: seed, payoff: PAY });
  assert.strictEqual(c.scoreA, a.scoreA + (PAY.T - PAY.R),
    'удар в последнем раунде обязан быть чистой прибылью — это и есть причина не считать его ошибкой');
});

test('разбор: «отдать поводья Зеркалу» — определённый и воспроизводимый контрфакт', function () {
  var league = CODE.league();
  var M = CODE.require('engine/match');
  var foeDef = league[1];
  assert.strictEqual(foeDef.id, 'alwaysDefect');

  function hybrid(prefix, tail) {
    return {
      id: 'hybrid',
      create: function (io) {
        var i = 0;
        var inner = tail.create(io);
        return {
          move: function (hist) {
            if (i < prefix.length) { i += 1; return prefix[i - 1]; }
            return inner.move(hist);
          }
        };
      }
    };
  }

  var naive = 'CCCCCCCCCCCCCCCCCCCC'.split('');
  var opts = { rounds: DUEL_ROUNDS, noise: 0, seed: 4711, payoff: PAY };
  var asIs = M.playMatch(tapeDef(naive), foeDef, opts).scoreA;
  assert.strictEqual(asIs, 0, 'двадцать раз подставиться Агрессору — это ровно ноль');

  // Зеркало с самого начала: первый раунд подставляется, дальше отвечает.
  var fromStart = M.playMatch(hybrid([], league[3]), foeDef, opts).scoreA;
  assert.strictEqual(fromStart, (DUEL_ROUNDS - 1) * PAY.P);

  // Тот же контрфакт дважды обязан дать то же самое.
  assert.strictEqual(M.playMatch(hybrid(naive.slice(0, 5), league[3]), foeDef, opts).scoreA,
    M.playMatch(hybrid(naive.slice(0, 5), league[3]), foeDef, opts).scoreA);
});

test('разбор: эталоны считаются против того же противника и того же жребия', function () {
  var league = CODE.league();
  var M = CODE.require('engine/match');
  var foeDef = league[5];
  assert.strictEqual(foeDef.id, 'pavlov');
  var opts = { rounds: DUEL_ROUNDS, noise: 0.05, seed: 20260826, payoff: PAY };

  var ids = ['titForTat', 'pavlov', 'alwaysDefect', 'alwaysCooperate', 'grimTrigger'];
  var scores = ids.map(function (id) {
    var def = null;
    league.forEach(function (row) { if (row.id === id) def = row; });
    assert.ok(def, 'эталон ' + id + ' обязан быть в лиге');
    return M.playMatch(def, foeDef, opts).scoreA;
  });
  // Повтор обязан дать то же самое: иначе таблица эталонов меняется от показа
  // к показу и сравнивать с ней бессмысленно.
  var again = ids.map(function (id) {
    var def = null;
    league.forEach(function (row) { if (row.id === id) def = row; });
    return M.playMatch(def, foeDef, opts).scoreA;
  });
  assert.deepStrictEqual(again, scores);
  scores.forEach(function (s) {
    assert.ok(s >= 0 && s <= DUEL_ROUNDS * PAY.T, 'счёт эталона вне возможных границ: ' + s);
  });
});
