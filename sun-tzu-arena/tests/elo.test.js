'use strict';

/**
 * Рейтинг Эло.
 *
 * Здесь проверяется не «похоже ли на правду», а свойства, которые обязаны
 * выполняться точно: сумма рейтингов пула постоянна, симметрия обмена очками,
 * ничья не двигает равных, порядок обработки фиксирован, матч с собственной
 * копией не учитывается. Плюс главная содержательная проверка — что рейтинг
 * действительно расходится с эволюцией, и расходится в известную сторону:
 * это не курьёз, а вывод, на котором держится глава отчёта.
 */

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');

var elo = require('../sim/elo');
var registry = require('../strategies');
var tournament = require('../sim/tournament');

var RESULTS = path.join(__dirname, '..', 'results');

/* =========================== Механика рейтинга =========================== */

test('Эло: обмен очками симметричен, сумма пула постоянна', function () {
  var ids = ['a', 'b', 'c'];
  var table = elo.createTable(ids);
  function total() {
    return ids.reduce(function (acc, id) { return acc + table.rating[id]; }, 0);
  }
  var start = total();
  assert.strictEqual(start, elo.BASE * 3);

  table.record('a', 'b', 3.0, 1.0, 'test');
  assert.ok(Math.abs(total() - start) < 1e-9, 'сумма рейтингов изменилась — обмен несимметричен');
  assert.ok(table.rating.a > elo.BASE, 'победитель обязан вырасти');
  assert.ok(table.rating.b < elo.BASE, 'проигравший обязан упасть');
  assert.ok(Math.abs((table.rating.a - elo.BASE) + (table.rating.b - elo.BASE)) < 1e-9);

  table.record('b', 'c', 2.0, 2.5, 'test');
  table.record('c', 'a', 1.0, 4.0, 'test');
  assert.ok(Math.abs(total() - start) < 1e-9, 'сумма рейтингов пула обязана сохраняться всегда');
});

test('Эло: у равных ничья не двигает рейтинг, победа даёт ровно K/2', function () {
  var table = elo.createTable(['a', 'b']);
  table.record('a', 'b', 2.5, 2.5, 'test');
  assert.strictEqual(table.rating.a, elo.BASE, 'ничья равных обязана оставить рейтинг на месте');
  assert.strictEqual(table.rating.b, elo.BASE);
  assert.strictEqual(table.stat.a.draws, 1);

  table.record('a', 'b', 3.0, 1.0, 'test');
  // Ожидание равных — 0.5, исход 1, значит прирост ровно K·(1 − 0.5).
  assert.ok(Math.abs(table.rating.a - (elo.BASE + elo.K / 2)) < 1e-9,
    'победа равного над равным обязана давать ровно половину K');
});

test('Эло: ожидание считается по классической логистике с шагом 400', function () {
  assert.strictEqual(elo.expected(1500, 1500), 0.5);
  assert.ok(Math.abs(elo.expected(1900, 1500) - 10 / 11) < 1e-12,
    'разница в 400 очков обязана давать ожидание 10/11');
  assert.ok(Math.abs(elo.expected(1500, 1900) - 1 / 11) < 1e-12);
  // Сумма встречных ожиданий — единица, иначе обмен не был бы симметричным.
  assert.ok(Math.abs(elo.expected(1700, 1420) + elo.expected(1420, 1700) - 1) < 1e-12);
});

test('Эло: матч с собственной копией не учитывается', function () {
  var table = elo.createTable(['a', 'b']);
  table.record('a', 'a', 3.0, 1.0, 'test');
  assert.strictEqual(table.rating.a, elo.BASE, 'матч с копией не может двигать рейтинг');
  assert.strictEqual(table.stat.a.games, 0, 'матч с копией не может считаться партией');
});

test('Эло: исход двоичный — важен знак перевеса, а не его величина', function () {
  var small = elo.createTable(['a', 'b']);
  var big = elo.createTable(['a', 'b']);
  small.record('a', 'b', 2.501, 2.5, 'test');
  big.record('a', 'b', 5.0, 0.0, 'test');
  assert.strictEqual(small.rating.a, big.rating.a,
    'разгром и победа на волосок обязаны давать одно и то же: иначе рейтинг зависел бы ' +
    'от матрицы выплат, а на стенде их две');
});

test('Эло: рейтинг зависит от порядка встреч — потому порядок и зафиксирован', function () {
  // Это свойство самого Эло, а не дефект. Тест сторожит обратное: что порядок
  // где-то не «поплыл» незаметно. Если бы порядок ничего не решал, фиксировать
  // его в sim/elo.js было бы незачем, и следующий тест на воспроизводимость
  // ничего бы не проверял.
  var forward = elo.createTable(['a', 'b', 'c']);
  forward.record('a', 'b', 3, 1, 'test');
  forward.record('b', 'c', 3, 1, 'test');
  forward.record('c', 'a', 3, 1, 'test');

  var shuffled = elo.createTable(['a', 'b', 'c']);
  shuffled.record('c', 'a', 3, 1, 'test');
  shuffled.record('a', 'b', 3, 1, 'test');
  shuffled.record('b', 'c', 3, 1, 'test');

  assert.notStrictEqual(forward.rating.a, shuffled.rating.a,
    'на цикле побед порядок обязан менять итог — иначе фиксировать нечего');
});

/* ======================== Сбор по режимам, целиком ======================= */

test('Эло: полный сбор воспроизводим и не зависит от того, сколько раз считать', function () {
  var opts = { seeds: [42], generations: 4, withSweep: false, spatialSeed: 3 };
  var a = elo.run(opts);
  var b = elo.run(opts);
  assert.deepStrictEqual(b.ranking, a.ranking, 'два одинаковых прогона дали разные рейтинги');
  assert.strictEqual(b.games, a.games);
});

test('Эло: партий у каждого столько же, сколько встреч в турнирах', function () {
  var defs = registry.core.slice(0, 5);
  var data = elo.run({
    strategies: defs, seeds: [42], generations: 3, withSweep: false, spatialSeed: 11
  });
  // Каждое поколение — по одной встрече с каждым, кроме себя: (n−1) партий.
  // Претенденты и территория добавляют своё, поэтому сверяем через режимы.
  data.ranking.forEach(function (row) {
    var sum = 0;
    Object.keys(row.byMode).forEach(function (mode) { sum += row.byMode[mode].games; });
    assert.strictEqual(sum, row.games, row.id + ': сумма по режимам не сходится с общим числом партий');
    assert.strictEqual(row.wins + row.draws + row.losses, row.games,
      row.id + ': победы, ничьи и поражения не дают числа партий');
  });

  var league = data.modes.filter(function (m) { return m.id === 'league'; })[0];
  assert.strictEqual(league.games, 3 * (5 * 4) / 2,
    'в лиге обязано быть по одной встрече на пару за поколение, без матчей с копией');
});

test('Эло: сумма рейтингов всей лиги остаётся стартовой после всех режимов', function () {
  var defs = registry.core.slice(0, 6);
  var data = elo.run({
    strategies: defs, seeds: [7], generations: 3, withSweep: false, spatialSeed: 5
  });
  var total = data.ranking.reduce(function (a, row) { return a + row.rating; }, 0);
  // Округление до десятой на 6 стратегиях даёт погрешность не больше 0.3.
  assert.ok(Math.abs(total - elo.BASE * defs.length) < 0.5,
    'сумма рейтингов уехала на ' + (total - elo.BASE * defs.length) + ' — где-то очки создаются из ничего');
});

test('Эло: хук onMatch отдаёт ровно те же исходы, что и матрица турнира', function () {
  // Весь сбор держится на этом хуке. Если он отдаёт не то, что попадает
  // в матрицу, рейтинг считается по одним матчам, а отчёт — по другим.
  var defs = registry.core.slice(0, 6);
  var seen = [];
  var rr = tournament.roundRobin(defs, {
    seed: 42, generation: 5, rounds: 60, noise: 0.05,
    onMatch: function (i, j, avgA, avgB) { seen.push([i, j, avgA, avgB]); }
  });
  assert.strictEqual(seen.length, rr.matches, 'хук вызван не на каждый матч');
  var offDiagonal = 0;
  seen.forEach(function (row) {
    // Диагональ пропускаем осознанно: в матче с собственной копией обе ячейки
    // матрицы — это одна и та же matrix[i][i], и она записывается дважды,
    // так что в ней остаётся avgB. Хук при этом честно отдал оба числа.
    if (row[0] === row[1]) return;
    offDiagonal += 1;
    assert.strictEqual(row[2], rr.matrix[row[0]][row[1]], 'хук отдал не то, что попало в матрицу');
    assert.strictEqual(row[3], rr.matrix[row[1]][row[0]]);
  });
  assert.strictEqual(offDiagonal, (6 * 5) / 2, 'вне диагонали обязана быть ровно пара на каждую пару');

  // И то самое свойство диагонали — явно, чтобы оно не «починилось» молча:
  // рейтинг матчи с копией не считает, а вот приспособленность считает,
  // и ей важно, какое из двух чисел там лежит.
  var self = seen.filter(function (row) { return row[0] === 0 && row[1] === 0; })[0];
  assert.strictEqual(rr.matrix[0][0], self[3],
    'в диагонали матрицы обязан оставаться второй из двух счётов матча с копией');
});

test('Эло: территория отдаёт только те пары, что действительно встретились', function () {
  var spatial = require('../sim/spatial');
  var defs = registry.core.slice(0, 4);
  var pairs = {};
  var calls = 0;
  spatial.run({
    seed: 42, generations: 3, strategies: defs,
    onMatch: function (i, j) {
      calls += 1;
      pairs[i + ':' + j] = (pairs[i + ':' + j] || 0) + 1;
    }
  });
  assert.ok(calls > 0, 'на сетке обязаны играться матчи');
  // Пара за поколение играется один раз: дальше работает кэш. Значит на пару
  // не может прийтись больше вызовов, чем поколений.
  Object.keys(pairs).forEach(function (key) {
    assert.ok(pairs[key] <= 3, key + ': пара сыграна ' + pairs[key] + ' раз за 3 поколения — кэш течёт');
  });
});

/* ======================= Содержательные утверждения ====================== */

test('Эло: рейтинг очной ставки расходится с эволюцией — и в известную сторону', function () {
  var file = path.join(RESULTS, 'elo.json');
  if (!fs.existsSync(file)) {
    assert.fail('нет results/elo.json — запусти node sim/elo.js --seed 42');
  }
  var data = JSON.parse(fs.readFileSync(file, 'utf8'));
  var league = JSON.parse(fs.readFileSync(path.join(RESULTS, '42.json'), 'utf8'));

  var eloPlace = {};
  data.ranking.forEach(function (row, i) { eloPlace[row.id] = i + 1; });
  var evoPlace = {};
  league.standings.forEach(function (row, i) { evoPlace[row.id] = i + 1; });

  // Агрессор — предельный случай: он забирает у соперника больше, чем берёт
  // сам, поэтому очную ставку выигрывает почти всегда, а размножиться не может.
  assert.strictEqual(eloPlace.alwaysDefect, 1, 'Агрессор обязан быть первым по очной ставке');
  assert.strictEqual(evoPlace.alwaysDefect, league.standings.length,
    'Агрессор обязан быть последним в эволюции');
  assert.strictEqual(data.gap.id, 'alwaysDefect');
  assert.strictEqual(data.gap.elo, 1);
  assert.strictEqual(data.gap.evo, 17);

  // Пацифист — зеркальный предел: он не выигрывает почти ничего и в очной
  // ставке последний, хотя очков набирает много.
  assert.strictEqual(eloPlace.alwaysCooperate, data.ranking.length,
    'Пацифист обязан быть последним по очной ставке');

  // И главное: чемпион эволюции очную ставку не выигрывает.
  var champion = league.standings[0].id;
  assert.ok(eloPlace[champion] > 1,
    'чемпион лиги ' + champion + ' оказался первым и по Эло — сюжет отчёта разошёлся с данными');
});

test('Эло: зал славы не награждает одного и того же дважды за одно и то же', function () {
  var file = path.join(RESULTS, 'elo.json');
  var data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(data.records.length >= 5, 'разрядов зала славы должно быть не меньше пяти');

  var keys = {};
  data.records.forEach(function (rec) {
    assert.ok(!keys[rec.key], 'разряд ' + rec.key + ' задвоился');
    keys[rec.key] = true;
    assert.ok(data.strategyIds.indexOf(rec.id) >= 0, rec.key + ': награждён не участник лиги');
    assert.ok(rec.title && rec.note, rec.key + ': разряд без названия или пояснения');
  });

  // Первая версия давала четыре награды подряд одному Агрессору, потому что
  // все разряды мерили одно и то же. Сторож на повторение этой ошибки.
  var winners = {};
  data.records.forEach(function (rec) { winners[rec.id] = (winners[rec.id] || 0) + 1; });
  var most = Math.max.apply(null, Object.keys(winners).map(function (id) { return winners[id]; }));
  assert.ok(most <= 2, 'один участник забрал ' + most + ' разрядов — разряды меряют одно и то же');
  assert.ok(Object.keys(winners).length >= 4, 'в зале славы меньше четырёх разных имён');
});

test('Эло: очная сетка согласована сама с собой', function () {
  var data = JSON.parse(fs.readFileSync(path.join(RESULTS, 'elo.json'), 'utf8'));
  var n = data.strategyIds.length;
  assert.strictEqual(data.headToHead.length, n);
  for (var i = 0; i < n; i++) {
    assert.strictEqual(data.headToHead[i].length, n);
    assert.strictEqual(data.headToHead[i][i], null, 'диагональ обязана быть пустой');
    for (var j = 0; j < n; j++) {
      if (i === j) continue;
      var ab = data.headToHead[i][j];
      var ba = data.headToHead[j][i];
      assert.ok(ab !== null && ba !== null, data.strategyIds[i] + ' vs ' + data.strategyIds[j] + ': пусто');
      assert.ok(Math.abs(ab + ba - 1) < 2e-3,
        data.strategyIds[i] + ' vs ' + data.strategyIds[j] +
        ': встречные доли дают ' + (ab + ba) + ' вместо единицы');
    }
  }
});

test('Эло: доехал до визуализатора вместе со всем остальным', function () {
  var vm = require('node:vm');
  var src = fs.readFileSync(path.join(__dirname, '..', 'viz', 'replay.js'), 'utf8');
  var host = {};
  vm.compileFunction(src, ['window'], { filename: 'replay.js' })(host);
  var arena = host.ARENA_DATA;
  assert.ok(arena.elo, 'в ARENA_DATA нет рейтинга — пересобери реплей после node sim/elo.js');
  assert.strictEqual(arena.elo.ranking.length, arena.strategies.length,
    'рейтинг посчитан не для всей лиги');
  arena.elo.ranking.forEach(function (row) {
    assert.ok(arena.strategies.some(function (st) { return st.id === row.id; }),
      row.id + ': в рейтинге есть, в лиге нет');
  });
});
