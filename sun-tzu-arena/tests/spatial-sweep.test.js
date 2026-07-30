'use strict';

var test = require('node:test');
var assert = require('node:assert');

var spatial = require('../sim/spatial');
var sweep = require('../sim/sweep');
var registry = require('../strategies');
var payoff = require('../engine/payoff');
var match = require('../engine/match');
var h = require('./helpers');

/* ==================== Пространственный режим ==================== */

test('территория: сетка 20×20, каждое поколение — полный кадр', function () {
  var sp = spatial.run({ seed: 42, generations: 6 });
  assert.strictEqual(sp.size, 20);
  assert.strictEqual(sp.frames.length, sp.generations + 1,
    'кадров на один больше числа поколений: последний — состояние после перенимания');
  sp.frames.forEach(function (frame) {
    assert.strictEqual(frame.grid.length, 400);
    assert.strictEqual(frame.counts.reduce(function (a, b) { return a + b; }, 0), 400,
      'клетки не могут ни исчезать, ни появляться');
  });
});

test('территория: клетка перенимает стратегию сильнейшего в окрестности', function () {
  // Проверяем само правило, а не его следствие. Составляем поле из двух
  // стратегий так, чтобы исход был предсказуем: Агрессор в море Пацифистов
  // берёт с четырёх соседей по 5.0, любой Пацифист рядом с ним — не больше
  // 3·3 + 0 = 9. Значит, соседи агрессора обязаны стать агрессорами.
  var defs = [registry.byId('alwaysCooperate'), registry.byId('alwaysDefect')];
  var sp = spatial.run({ seed: 5, generations: 2, size: 20, rounds: 40, noise: 0, strategies: defs });
  var first = sp.frames[0];
  var second = sp.frames[1];

  var grew = 0;
  var shrank = 0;
  for (var i = 0; i < 400; i++) {
    if (first.grid[i] === 0 && second.grid[i] === 1) grew += 1;
    if (first.grid[i] === 1 && second.grid[i] === 0) shrank += 1;
  }
  assert.ok(grew > 0, 'агрессия обязана распространяться по соседству');
  assert.strictEqual(shrank, 0,
    'без шума пацифизм не может отвоевать клетку у агрессии: это нарушило бы правило перенимания');
});

test('территория: сетка замкнута — у краёв тоже четыре соседа', function () {
  // Если бы края не были замкнуты, угловая клетка играла бы с двумя соседями
  // и набирала бы вдвое меньше. Проверяем через однородное поле: при одной
  // стратегии на всех очки обязаны быть одинаковы у всех клеток, включая углы.
  var defs = [registry.byId('titForTat')];
  var sp = spatial.run({ seed: 3, generations: 1, size: 20, rounds: 30, noise: 0, strategies: defs });
  assert.strictEqual(sp.frames[0].counts[0], 400, 'поле из одной стратегии');
  // meanScore — средние очки за раунд по всем клеткам и всем четырём соседям.
  // Для однородного поля из Зеркал без шума это ровно R.
  assert.strictEqual(sp.frames[0].meanScore, payoff.PAYOFF.R,
    'однородное поле Зеркал обязано давать ровно R на каждой клетке, включая угловые');
});

test('территория: при равных очках клетка сохраняет свою стратегию', function () {
  // Инерция вместо случайного выбора. Однородное поле не должно шевелиться
  // ни на клетку: все очки равны, менять не на что.
  var defs = [registry.byId('titForTat')];
  var sp = spatial.run({ seed: 9, generations: 4, size: 20, rounds: 30, noise: 0, strategies: defs });
  sp.frames.forEach(function (frame) {
    assert.strictEqual(frame.flips, 0, 'в однородном поле не должно быть ни одной смены');
  });
});

test('территория: воспроизводима и различается по сидам', function () {
  var a = JSON.stringify(spatial.run({ seed: 42, generations: 5 }));
  var b = JSON.stringify(spatial.run({ seed: 42, generations: 5 }));
  var c = JSON.stringify(spatial.run({ seed: 7, generations: 5 }));
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
});

test('территория: итоговая расстановка сходится с последним кадром', function () {
  var sp = spatial.run({ seed: 42, generations: 8 });
  var last = sp.frames[sp.frames.length - 1];
  var byId = {};
  sp.standings.forEach(function (row) { byId[row.id] = row.cells; });
  sp.strategyIds.forEach(function (id, i) {
    assert.strictEqual(byId[id], last.counts[i], id + ': расстановка разошлась с полем');
  });
  assert.strictEqual(
    sp.standings.reduce(function (a, r) { return a + r.cells; }, 0), 400
  );
});

/* ========================= Стенд устойчивости ========================= */

test('свип: альтернативная матрица — настоящая дилемма', function () {
  sweep.MATRICES.forEach(function (m) {
    assert.ok(payoff.isValidDilemma(m.payoff) || (m.payoff.P === m.payoff.S),
      m.name + ': нарушены условия дилеммы');
    assert.ok(m.payoff.T > m.payoff.R, m.name + ': предательство обязано быть соблазнительным');
    assert.ok(m.payoff.R > m.payoff.P, m.name + ': мир обязан быть выгоднее войны');
    assert.ok(2 * m.payoff.R > m.payoff.T + m.payoff.S,
      m.name + ': иначе выгодно чередоваться, а не сотрудничать');
  });
  var attrition = sweep.MATRICES[1].payoff;
  assert.deepStrictEqual(attrition, { R: 4, P: 0, T: 5, S: 0 });
});

test('свип: матрица выплат передаётся параметром и реально меняет исход', function () {
  var a = match.playMatch(h.constant('C'), h.constant('C'), { rounds: 10, noise: 0 });
  assert.strictEqual(a.avgA, 3, 'по умолчанию действует каноническая матрица');

  var b = match.playMatch(h.constant('C'), h.constant('C'), {
    rounds: 10, noise: 0, payoff: { R: 4, P: 0, T: 5, S: 0 }
  });
  assert.strictEqual(b.avgA, 4, 'переданная матрица обязана применяться');

  // И она не должна протекать наружу: глобальная константа неприкосновенна.
  assert.strictEqual(payoff.PAYOFF.R, 3, 'глобальная матрица изменилась — это утечка состояния');
  var c = match.playMatch(h.constant('C'), h.constant('C'), { rounds: 10, noise: 0 });
  assert.strictEqual(c.avgA, 3, 'после прогона с другой матрицей поведение по умолчанию поплыло');
});

test('свип: покрывает ровно заявленные условия', function () {
  var defs = registry.core.slice(0, 4);
  var data = sweep.run({ seed: 42, generations: 3, strategies: defs });
  assert.strictEqual(data.worlds, sweep.MATRICES.length * sweep.NOISES.length * sweep.LENGTHS.length);
  assert.strictEqual(data.cells.length, data.worlds);

  var combos = {};
  data.cells.forEach(function (cell) {
    var key = cell.matrix + '|' + cell.noise + '|' + cell.rounds;
    assert.ok(!combos[key], 'мир посчитан дважды: ' + key);
    combos[key] = true;
    assert.ok(sweep.NOISES.indexOf(cell.noise) >= 0);
    assert.ok(sweep.LENGTHS.indexOf(cell.rounds) >= 0);
  });
  assert.strictEqual(Object.keys(combos).length, data.worlds);
});

test('свип: агрегация сходится с ячейками', function () {
  var defs = registry.core.slice(0, 5);
  var data = sweep.run({ seed: 7, generations: 3, strategies: defs });

  var wins = {};
  var survived = {};
  data.strategyIds.forEach(function (id) { wins[id] = 0; survived[id] = 0; });
  data.cells.forEach(function (cell) {
    wins[cell.winner] += 1;
    cell.shares.forEach(function (row) { if (row.share > 0) survived[row.id] += 1; });
  });

  data.ranking.forEach(function (row) {
    assert.strictEqual(row.wins, wins[row.id], row.id + ': число побед не сходится');
    assert.strictEqual(row.survivedWorlds, survived[row.id], row.id + ': выживания не сходятся');
    assert.strictEqual(row.winsIn.length, row.wins, row.id + ': список побед не сходится со счётчиком');
  });

  var totalWins = data.ranking.reduce(function (a, r) { return a + r.wins; }, 0);
  assert.strictEqual(totalWins, data.worlds, 'у каждого мира ровно один победитель');
});

test('свип: ранжирование ставит живучего выше удачливого', function () {
  var data = sweep.summarize({
    strategyIds: ['stayer', 'flash'],
    cells: [
      { matrix: 'm', noise: 0, rounds: 50, winner: 'flash', winnerShare: 0.9,
        shares: [{ id: 'flash', share: 0.9 }, { id: 'stayer', share: 0.1 }] },
      { matrix: 'm', noise: 0, rounds: 200, winner: 'stayer', winnerShare: 0.6,
        shares: [{ id: 'stayer', share: 0.6 }, { id: 'flash', share: 0 }] },
      { matrix: 'm', noise: 0, rounds: 500, winner: 'stayer', winnerShare: 0.7,
        shares: [{ id: 'stayer', share: 0.7 }, { id: 'flash', share: 0 }] }
    ]
  });
  assert.strictEqual(data.ranking[0].id, 'stayer', 'первым идёт тот, кто выжил в большем числе миров');
  assert.strictEqual(data.ranking[0].survivedWorlds, 3);
  assert.strictEqual(data.ranking[1].survivedWorlds, 1);
});

test('свип: прогон одного мира воспроизводим', function () {
  var defs = registry.core.slice(0, 4);
  var opts = { seed: 42, generations: 4, rounds: 50, noise: 0.05, payoff: { R: 3, P: 1, T: 5, S: 0 } };
  var a = JSON.stringify(sweep.runWorld(defs, opts));
  var b = JSON.stringify(sweep.runWorld(defs, opts));
  assert.strictEqual(a, b);
});
