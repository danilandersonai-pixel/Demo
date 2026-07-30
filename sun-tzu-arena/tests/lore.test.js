'use strict';

/**
 * Летописи сверяются с данными.
 *
 * `LORE.md` и `LORE-2.md` написаны как рассказы, но обещают, что каждое число
 * в них взято из `results/`. Обещание, которое никто не проверяет, живёт до
 * первого пересчёта: стоит измениться одной стратегии — и летопись начинает
 * лгать, причём убедительно, потому что выглядит она по-прежнему точной.
 *
 * Здесь числа выдираются из текста регулярками и сверяются с реальными
 * файлами. Проверяются не все — только те, что несут сюжет: если поедет
 * что-то из них, поедет и рассказ.
 */

var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');

var ROOT = path.join(__dirname, '..');
var RESULTS = path.join(ROOT, 'results');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(RESULTS, rel), 'utf8'));
}

var lore2 = fs.readFileSync(path.join(ROOT, 'LORE-2.md'), 'utf8');

function pct(share) {
  return (share * 100).toFixed(1);
}

test('LORE-2: таблица первого круга сходится с results/challengers-round1.json', function () {
  var data = readJson('challengers-round1.json');
  var names = {
    counterIntelligence: 'Контрразведка',
    quartermaster: 'Интендант',
    resonance: 'Резонанс',
    windAndMountain: 'Ветер и Гора',
    patience: 'Терпение'
  };
  data.table.forEach(function (row, i) {
    // Строка вида «| 1 | Контрразведка | 2.947 | 3.025 | 29.8% |»
    var re = new RegExp('\\|\\s*' + (i + 1) + '\\s*\\|\\s*\\*{0,2}' + names[row.id] +
      '\\*{0,2}\\s*\\|\\s*' + row.avg.toFixed(3) + '\\s*\\|');
    assert.ok(re.test(lore2),
      'в летописи нет строки первого круга: ' + (i + 1) + '. ' + names[row.id] + ' ' + row.avg);
    assert.ok(lore2.indexOf(pct(row.finalShare) + '%') >= 0,
      names[row.id] + ': доли ' + pct(row.finalShare) + '% в летописи нет');
  });
});

test('LORE-2: сдвиги между кругами посчитаны верно', function () {
  var r1 = readJson('challengers-round1.json');
  var r2 = readJson('challengers-round2.json');
  var by1 = {};
  r1.table.forEach(function (row) { by1[row.id] = row.finalShare; });

  // Заявлено: разрыв первого и второго сжался с 5.8 пункта до 0.5.
  var gap1 = (r1.table[0].finalShare - r1.table[1].finalShare) * 100;
  var gap2 = (r2.table[0].finalShare - r2.table[1].finalShare) * 100;
  assert.strictEqual(gap1.toFixed(1), '5.8', 'разрыв круга 1 изменился — поправь летопись');
  assert.strictEqual(gap2.toFixed(1), '0.5', 'разрыв круга 2 изменился — поправь летопись');
  assert.ok(/с 5\.8 пункта до \*\*0\.5\*\*/.test(lore2), 'в летописи не тот разрыв');

  // Заявлено: Ветер и Гора поднялся сильнее всех, на +3.5 пункта.
  var best = null;
  r2.table.forEach(function (row) {
    var d = (row.finalShare - by1[row.id]) * 100;
    if (!best || d > best.d) best = { id: row.id, d: d };
  });
  assert.strictEqual(best.id, 'windAndMountain', 'сильнее всех поднялся уже не Ветер и Гора');
  assert.strictEqual(best.d.toFixed(1), '3.5');
});

test('LORE-2: самая крупная правка круга 2 — Интендант против собственной копии', function () {
  var r1 = readJson('challengers-round1.json');
  var r2 = readJson('challengers-round2.json');
  var ids = r1.participants;
  var best = null;
  for (var i = 0; i < ids.length; i++) {
    for (var j = 0; j < ids.length; j++) {
      var d = Math.abs(r2.matrix[i][j] - r1.matrix[i][j]);
      if (!best || d > best.d) best = { a: ids[i], b: ids[j], d: d, from: r1.matrix[i][j], to: r2.matrix[i][j] };
    }
  }
  assert.strictEqual(best.a, 'quartermaster');
  assert.strictEqual(best.b, 'quartermaster', 'самая крупная правка больше не в матче с собственной копией');
  assert.ok(lore2.indexOf(best.from.toFixed(3) + ' → ' + best.to.toFixed(3)) >= 0,
    'в летописи не те числа правки: ожидалось ' + best.from + ' → ' + best.to);

  // И заявленное число расхождений.
  var diffs = 0;
  for (var x = 0; x < ids.length; x++) {
    for (var y = 0; y < ids.length; y++) {
      if (Math.abs(r2.matrix[x][y] - r1.matrix[x][y]) > 1e-9) diffs += 1;
    }
  }
  assert.strictEqual(diffs, 13, 'расхождений между кругами стало ' + diffs + ', а в летописи тринадцать');
});

test('LORE-2: бой чемпиона с Контрразведкой описан по настоящей ленте', function () {
  var registry = require('../strategies');
  var challengers = require('../strategies/challengers');
  var match = require('../engine/match');
  var rngLib = require('../engine/rng');
  var tournament = require('../sim/tournament');
  var data = readJson('challengers-round2.json');

  var defs = [registry.byId(data.championId)].concat(challengers.list);
  var i = data.participants.indexOf('patience');
  var j = data.participants.indexOf('counterIntelligence');
  var lo = Math.min(i, j);
  var hi = Math.max(i, j);
  var res = match.playMatch(defs[lo], defs[hi], {
    rounds: data.rounds,
    noise: data.noise,
    seed: rngLib.hashSeed(tournament.DOMAIN, data.seed, 0, lo, hi),
    log: true
  });

  var count = { CC: 0, CD: 0, DC: 0, DD: 0 };
  res.log.forEach(function (e) { count[e.a + e.b] += 1; });

  // Главное утверждение всей главы: за 200 раундов ни одной взаимной войны.
  assert.strictEqual(count.DD, 0, 'взаимная война появилась — глава летописи развалилась');
  assert.strictEqual(count.CC, 155);
  assert.strictEqual(count.CD, 28);
  assert.strictEqual(count.DC, 17);
  assert.ok(/\*\*Ноль\.\*\* Ни одного раунда, где оба ударили разом/.test(lore2));

  var intended = res.log.filter(function (e) { return e.intendedA === 'D'; }).length;
  var actual = res.log.filter(function (e) { return e.a === 'D'; }).length;
  assert.strictEqual(actual, 17);
  assert.strictEqual(intended, 8, 'намеренных ударов чемпиона стало ' + intended + ', в летописи восемь');

  // Лента первых сорока раундов приведена в летописи дословно.
  var tapeB = res.log.slice(0, 40).map(function (e) { return e.b; }).join('');
  assert.ok(lore2.indexOf(tapeB) >= 0, 'лента Контрразведки в летописи разошлась с настоящей');
  var tapeA = res.log.slice(0, 40).map(function (e) { return e.a; }).join('');
  assert.ok(lore2.indexOf(tapeA) >= 0, 'лента чемпиона в летописи разошлась с настоящей');

  var sumA = 0;
  var sumB = 0;
  res.log.slice(0, 40).forEach(function (e) { sumA += e.pointsA; sumB += e.pointsB; });
  assert.ok(lore2.indexOf('**' + sumA + ' : ' + sumB + '**') >= 0,
    'счёт к сороковому раунду в летописи не тот: на деле ' + sumA + ':' + sumB);
});

test('LORE-2: расстановка в общей лиге и места в рейтинге сходятся', function () {
  var league = readJson('42.json');
  var elo = readJson('elo.json');

  // Четвёрка претендентов заняла первые четыре места — на всех трёх сидах.
  ['7', '42', '2026'].forEach(function (seed) {
    var top = readJson(seed + '.json').standings.slice(0, 4).map(function (row) { return row.id; });
    assert.deepStrictEqual(top,
      ['counterIntelligence', 'quartermaster', 'windAndMountain', 'resonance'],
      'сид ' + seed + ': четвёрка наверху изменилась — поправь летопись');
  });

  // Терпение — шестое.
  var place = league.standings.map(function (row) { return row.id; }).indexOf('patience') + 1;
  assert.strictEqual(place, 6, 'Терпение больше не шестое: в летописи шестое');
  assert.strictEqual(pct(league.standings[place - 1].share), '7.3');

  // Места по Эло, приведённые таблицей в главе VI.
  var eloPlace = {};
  elo.ranking.forEach(function (row, i) { eloPlace[row.id] = i + 1; });
  var claims = [
    ['counterIntelligence', 4, 1630.6],
    ['quartermaster', 14, 1380.2],
    ['resonance', 11, 1477.6],
    ['windAndMountain', 7, 1532.5],
    ['patience', 9, 1513.4]
  ];
  claims.forEach(function (row) {
    assert.strictEqual(eloPlace[row[0]], row[1],
      row[0] + ': место по Эло ' + eloPlace[row[0]] + ', в летописи ' + row[1]);
    var rating = elo.ranking[row[1] - 1].rating;
    assert.strictEqual(rating, row[2], row[0] + ': рейтинг ' + rating + ', в летописи ' + row[2]);
    assert.ok(lore2.indexOf(String(row[2])) >= 0, row[0] + ': рейтинга нет в тексте летописи');
  });

  // И главный поворот главы VI.
  assert.strictEqual(eloPlace.alwaysDefect, 1);
  assert.strictEqual(elo.ranking[0].wins, 8662);
  assert.strictEqual(elo.ranking[0].games, 9145);
  assert.ok(lore2.indexOf('8662') >= 0 && lore2.indexOf('9145') >= 0);
});

test('LORE: первая летопись тоже сверена с прогоном сида 7', function () {
  var lore = fs.readFileSync(path.join(ROOT, 'LORE.md'), 'utf8');
  var data = readJson('v1/7.json');

  // Заявлено: накал десятого поколения — наивысший из всех девяноста.
  var best = { gen: -1, value: -1 };
  ['7', '42', '2026'].forEach(function (seed) {
    readJson('v1/' + seed + '.json').frames.forEach(function (frame, gen) {
      if (frame.battle && frame.battle.intensity > best.value) {
        best = { seed: seed, gen: gen, value: frame.battle.intensity };
      }
    });
  });
  assert.strictEqual(best.seed, '7', 'самое напряжённое поколение теперь на другом сиде');
  // Нумерация поколений в летописи — та же, что в данных: frames[N].gen === N.
  // «Десятое поколение» — это gen 10, а не десятый по счёту кадр.
  assert.strictEqual(best.gen, 10, 'самое напряжённое поколение теперь не десятое');
  assert.strictEqual(data.frames[10].gen, 10, 'нумерация кадров разошлась с номером поколения');
  assert.ok(lore.indexOf(String(best.value)) >= 0,
    'накал в летописи не тот: на деле ' + best.value);

  // И три башни, павшие разом.
  var fallen = data.frames[10].extinct;
  assert.strictEqual(fallen.length, 3,
    'в десятом поколении пало ' + fallen.length + ' башен, а не три');
  fallen.forEach(function (id) {
    var name = require('../strategies').byId(id).name;
    assert.ok(lore.indexOf(name) >= 0, name + ' пал в ту ночь, но в летописи его нет');
  });
});
