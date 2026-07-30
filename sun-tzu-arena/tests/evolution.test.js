'use strict';

var test = require('node:test');
var assert = require('node:assert');

var evolution = require('../sim/evolution');
var tournament = require('../sim/tournament');
var simulate = require('../sim/simulate');
var registry = require('../strategies');

function sum(a) {
  return a.reduce(function (x, y) { return x + y; }, 0);
}

test('репликатор: сумма долей после шага равна единице', function () {
  var cases = [
    { shares: evolution.uniform(12), fitness: [3, 1, 2, 2.5, 0.4, 5, 1.2, 3.3, 2.9, 0.1, 4, 2] },
    { shares: [0.9, 0.05, 0.05], fitness: [1, 4, 2] },
    { shares: [0.5, 0.5], fitness: [2, 2] }
  ];
  cases.forEach(function (c, i) {
    var out = evolution.step(c.shares, c.fitness, {});
    assert.ok(Math.abs(sum(out.shares) - 1) < 1e-12, 'случай ' + i + ': сумма ' + sum(out.shares));
  });
});

test('репликатор: доля растёт выше среднего и падает ниже среднего', function () {
  var shares = [0.25, 0.25, 0.25, 0.25];
  var fitness = [4, 3, 2, 1]; // среднее 2.5
  var out = evolution.step(shares, fitness, {});
  assert.ok(out.shares[0] > 0.25, 'сильнейший обязан вырасти');
  assert.ok(out.shares[1] > 0.25, 'выше среднего — рост');
  assert.ok(out.shares[2] < 0.25, 'ниже среднего — спад');
  assert.ok(out.shares[3] < 0.25, 'слабейший обязан упасть');
  assert.strictEqual(out.avgFitness, 2.5);
});

test('репликатор: при равных приспособленностях доли не меняются', function () {
  var shares = [0.2, 0.3, 0.5];
  var out = evolution.step(shares, [2.7, 2.7, 2.7], {});
  out.shares.forEach(function (v, i) {
    assert.ok(Math.abs(v - shares[i]) < 1e-12, 'доля ' + i + ' сдвинулась без причины');
  });
});

test('репликатор: вымирание срабатывает строго ниже порога 0.5%', function () {
  // Доля 0.004 после пересчёта окажется ниже порога и должна обнулиться.
  var shares = [0.996, 0.004];
  var fitness = [3, 0.5];
  var out = evolution.step(shares, fitness, {});
  assert.strictEqual(out.shares[1], 0, 'слабая фракция обязана вымереть');
  assert.deepStrictEqual(out.extinct, [1]);
  assert.strictEqual(out.shares[0], 1, 'после вымирания остаток нормируется до единицы');
  assert.strictEqual(evolution.EXTINCTION_THRESHOLD, 0.005);
});

test('репликатор: доля точно на пороге выживает, чуть ниже — нет', function () {
  var mk = function (small) {
    // подбираем приспособленности так, чтобы доля осталась ровно как была
    return evolution.step([1 - small, small], [1, 1], {});
  };
  assert.strictEqual(mk(0.006).shares[1] > 0, true, '0.6% должно выжить');
  assert.strictEqual(mk(0.004).shares[1], 0, '0.4% должно вымереть');
});

test('репликатор: вымершая фракция не воскресает', function () {
  var out = evolution.step([0.5, 0.5, 0], [1, 1, 99], {});
  assert.strictEqual(out.shares[2], 0, 'нулевая доля не должна ожить даже при огромной приспособленности');
});

test('репликатор: равномерное начальное распределение суммируется в единицу', function () {
  [2, 3, 12, 17].forEach(function (n) {
    var u = evolution.uniform(n);
    assert.strictEqual(u.length, n);
    assert.ok(Math.abs(sum(u) - 1) < 1e-12);
  });
});

test('приспособленность: это взвешенное по долям среднее по строке матрицы', function () {
  var matrix = [
    [3, 0],
    [5, 1]
  ];
  var f = tournament.fitnessVector(matrix, [0.5, 0.5]);
  assert.strictEqual(f[0], 1.5, '(3 + 0) / 2');
  assert.strictEqual(f[1], 3, '(5 + 1) / 2');

  var pure = tournament.fitnessVector(matrix, [1, 0]);
  assert.strictEqual(pure[0], 3, 'в популяции из одних кооператоров каждый получает R');
  assert.strictEqual(pure[1], 5);
});

test('приспособленность: матч с собственной копией входит с весом своей доли', function () {
  // Агрессор в популяции из одних агрессоров обязан жить на P=1, а не на T=5.
  var matrix = [[1]];
  assert.strictEqual(tournament.fitnessVector(matrix, [1])[0], 1);
});

test('турнир: играются все пары, включая матч с самим собой', function () {
  var defs = registry.list.slice(0, 4);
  var rr = tournament.roundRobin(defs, { seed: 1, generation: 0, rounds: 20, noise: 0 });
  assert.strictEqual(rr.matches, 10, '4 стратегии → C(4,2) + 4 матчей с копией = 10');
  assert.strictEqual(rr.matrix.length, 4);
  rr.matrix.forEach(function (row) { assert.strictEqual(row.length, 4); });
});

test('турнир: сид матча не зависит от порядка перебора пар', function () {
  var defs = registry.list.slice(0, 5);
  var full = tournament.roundRobin(defs, { seed: 42, generation: 3, rounds: 60, noise: 0.05 });
  // Тот же матч, отыгранный в одиночку, обязан дать тот же результат.
  var rngLib = require('../engine/rng');
  var match = require('../engine/match');
  var solo = match.playMatch(defs[1], defs[4], {
    rounds: 60, noise: 0.05,
    seed: rngLib.hashSeed(tournament.DOMAIN, 42, 3, 1, 4)
  });
  assert.strictEqual(full.matrix[1][4], solo.avgA);
  assert.strictEqual(full.matrix[4][1], solo.avgB);
});

test('прогон: доли в каждом поколении суммируются в единицу до и после шага', function () {
  var run = simulate.run({ seed: 7, generations: 30 });
  run.frames.forEach(function (frame) {
    assert.ok(Math.abs(sum(frame.shares) - 1) < 1e-4, 'поколение ' + frame.gen + ': сумма до шага');
    assert.ok(Math.abs(sum(frame.sharesAfter) - 1) < 1e-4, 'поколение ' + frame.gen + ': сумма после шага');
  });
});

test('прогон: вымирание необратимо на протяжении всего прогона', function () {
  var run = simulate.run({ seed: 2026, generations: 30 });
  var dead = {};
  run.frames.forEach(function (frame) {
    run.strategyIds.forEach(function (id, i) {
      if (dead[id]) assert.strictEqual(frame.sharesAfter[i], 0, id + ' воскрес на поколении ' + frame.gen);
      if (frame.sharesAfter[i] === 0) dead[id] = true;
    });
  });
  assert.ok(Object.keys(dead).length > 0, 'за 30 поколений хоть кто-то обязан вымереть');
  assert.strictEqual(run.extinctions.length, Object.keys(dead).length, 'журнал вымираний должен сойтись');
});

test('прогон: прочность башни лежит в [0,1] и обнуляется вместе с фракцией', function () {
  var run = simulate.run({ seed: 42, generations: 30 });
  run.frames.forEach(function (frame) {
    frame.hp.forEach(function (v, i) {
      assert.ok(v >= 0 && v <= 1, 'hp вне диапазона: ' + v);
      if (frame.sharesAfter[i] === 0) assert.strictEqual(v, 0, 'у вымершей фракции башня должна быть разрушена');
    });
  });
});

test('шум меняет чемпиона: без него побеждает Зеркало, с ним — Терпение', function () {
  // Главный вывод отчёта, зафиксированный тестом. Если правка стратегии
  // перевернёт этот результат, тест обязан упасть — и REPORT.md придётся
  // переписать по новым числам, а не оставить старые утверждения.
  [7, 42, 2026].forEach(function (seed) {
    var quiet = simulate.run({ seed: seed, generations: 30, noise: 0 });
    var noisy = simulate.run({ seed: seed, generations: 30, noise: 0.05 });

    assert.strictEqual(quiet.standings[0].id, 'titForTat',
      'сид ' + seed + ' без шума: чемпион должен быть titForTat, а не ' + quiet.standings[0].id);
    assert.strictEqual(noisy.standings[0].id, 'patience',
      'сид ' + seed + ' с шумом: чемпион должен быть patience, а не ' + noisy.standings[0].id);

    // Контринтуитивная часть: шум не размывает популяцию, а концентрирует её.
    // Без шума верхушка (Зеркало, Миротворец, Прагматик, Терпение) играет
    // между собой ровно по 3.0, их приспособленности почти неразличимы —
    // и репликатору нечего усиливать. Шум разводит их по устойчивости
    // к ложным конфликтам, и один вырывается вперёд.
    var topQuiet = Math.max.apply(null, quiet.frames[29].sharesAfter);
    var topNoisy = Math.max.apply(null, noisy.frames[29].sharesAfter);
    assert.ok(topNoisy > topQuiet,
      'сид ' + seed + ': шум должен усиливать концентрацию (' +
      topNoisy.toFixed(3) + ' против ' + topQuiet.toFixed(3) + ')');
  });
});

test('поле боя: дорожки ссылаются только на живые фракции и корректный фронт', function () {
  var run = simulate.run({ seed: 7, generations: 30 });
  run.frames.forEach(function (frame) {
    frame.battle.lanes.forEach(function (lane) {
      assert.ok(lane.front >= 0 && lane.front <= 1, 'фронт вне поля: ' + lane.front);
      [['left', 'leftIndex'], ['right', 'rightIndex']].forEach(function (pairNames) {
        var id = lane[pairNames[0]];
        var idx = lane[pairNames[1]];
        if (id === null) { assert.strictEqual(idx, -1); return; }
        assert.strictEqual(run.strategyIds[idx], id, 'индекс и id дорожки разошлись');
        assert.ok(frame.shares[idx] > 0, 'на дорожку попала вымершая фракция');
      });
      if (lane.left && lane.right) {
        var expected = lane.scoreLeft > lane.scoreRight ? lane.left
          : lane.scoreRight > lane.scoreLeft ? lane.right : null;
        assert.strictEqual(lane.winner, expected, 'перевес должен определяться очной разницей');
      }
    });
  });
});

test('поле боя: каждая живая фракция попадает ровно на одну дорожку', function () {
  var run = simulate.run({ seed: 2026, generations: 30 });
  run.frames.forEach(function (frame) {
    var seen = {};
    frame.battle.lanes.forEach(function (lane) {
      [lane.left, lane.right].forEach(function (id) {
        if (!id) return;
        assert.ok(!seen[id], id + ' занял две дорожки в поколении ' + frame.gen);
        seen[id] = true;
      });
    });
    var aliveNow = run.strategyIds.filter(function (id, i) { return frame.shares[i] > 0; });
    assert.strictEqual(Object.keys(seen).length, aliveNow.length, 'не все живые фракции вышли на поле');
  });
});

test('исход прогона: тип согласован с итоговыми долями', function () {
  [7, 42, 2026].forEach(function (seed) {
    var run = simulate.run({ seed: seed, generations: 30 });
    var last = run.frames[run.frames.length - 1];
    var top = Math.max.apply(null, last.sharesAfter);
    assert.ok(['domination', 'extinction', 'coexistence'].indexOf(run.outcome.type) >= 0);
    if (run.outcome.type === 'coexistence') {
      assert.ok(top < run.dominationThreshold, 'сосуществование при доле ' + top);
      assert.ok(last.alive > 1, 'сосуществование при одной живой фракции');
    }
    assert.strictEqual(run.standings[0].id, run.strategyIds[last.sharesAfter.indexOf(top)]);
  });
});
