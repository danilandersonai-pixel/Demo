'use strict';

var test = require('node:test');
var assert = require('node:assert');

var payoff = require('../engine/payoff');
var rngLib = require('../engine/rng');
var historyLib = require('../engine/history');
var match = require('../engine/match');
var helpers = require('./helpers');

var C = 'C';
var D = 'D';

/* ============================ Матрица выплат ============================ */

test('матрица выплат: все четыре исхода дают ровно R/P/T/S', function () {
  assert.deepStrictEqual(payoff.score(C, C), [3, 3], 'оба сотрудничают → R');
  assert.deepStrictEqual(payoff.score(D, D), [1, 1], 'оба предают → P');
  assert.deepStrictEqual(payoff.score(D, C), [5, 0], 'предал доверчивого → T/S');
  assert.deepStrictEqual(payoff.score(C, D), [0, 5], 'тебя предали → S/T');
});

test('матрица выплат: числа совпадают с заявленными константами', function () {
  assert.strictEqual(payoff.PAYOFF.R, 3);
  assert.strictEqual(payoff.PAYOFF.P, 1);
  assert.strictEqual(payoff.PAYOFF.T, 5);
  assert.strictEqual(payoff.PAYOFF.S, 0);
});

test('матрица выплат: это действительно дилемма заключённого', function () {
  var p = payoff.PAYOFF;
  assert.ok(p.T > p.R && p.R > p.P && p.P > p.S, 'нужно T > R > P > S');
  assert.ok(2 * p.R > p.T + p.S, 'нужно 2R > T + S, иначе выгодно чередоваться');
  assert.ok(payoff.isValidDilemma(p));
});

test('матрица выплат: симметрична при обмене сторон', function () {
  [[C, C], [C, D], [D, C], [D, D]].forEach(function (pairMoves) {
    var direct = payoff.score(pairMoves[0], pairMoves[1]);
    var mirrored = payoff.score(pairMoves[1], pairMoves[0]);
    assert.deepStrictEqual(direct, [mirrored[1], mirrored[0]]);
  });
});

test('нормализация хода: всё, кроме "D", считается сотрудничеством', function () {
  assert.strictEqual(payoff.normalize('D'), D);
  assert.strictEqual(payoff.normalize('C'), C);
  assert.strictEqual(payoff.normalize(undefined), C);
  assert.strictEqual(payoff.normalize('чепуха'), C);
  assert.strictEqual(payoff.flip(C), D);
  assert.strictEqual(payoff.flip(D), C);
});

/* =================================== ГПСЧ =================================== */

test('ГПСЧ: один сид — одна и та же последовательность', function () {
  var a = rngLib.mulberry32(42);
  var b = rngLib.mulberry32(42);
  for (var i = 0; i < 500; i++) assert.strictEqual(a(), b());
});

test('ГПСЧ: разные сиды расходятся', function () {
  var a = rngLib.mulberry32(1);
  var b = rngLib.mulberry32(2);
  var same = 0;
  for (var i = 0; i < 200; i++) if (a() === b()) same += 1;
  assert.strictEqual(same, 0);
});

test('ГПСЧ: значения лежат в [0, 1) и распределены равномерно', function () {
  var r = rngLib.mulberry32(2026);
  var sum = 0;
  var n = 60000;
  for (var i = 0; i < n; i++) {
    var v = r();
    assert.ok(v >= 0 && v < 1, 'значение вне [0,1): ' + v);
    sum += v;
  }
  var mean = sum / n;
  assert.ok(Math.abs(mean - 0.5) < 0.01, 'среднее должно быть около 0.5, получено ' + mean);
});

test('hashSeed: детерминирован и различает порядок аргументов', function () {
  assert.strictEqual(rngLib.hashSeed(1, 2, 3), rngLib.hashSeed(1, 2, 3));
  assert.notStrictEqual(rngLib.hashSeed(1, 2, 3), rngLib.hashSeed(3, 2, 1));
  assert.notStrictEqual(rngLib.hashSeed(42, 0, 0, 0), rngLib.hashSeed(42, 0, 0, 1));
  assert.ok(rngLib.hashSeed(7) >= 0 && rngLib.hashSeed(7) <= 0xffffffff);
});

test('округление: даёт стабильное число знаков и не оставляет минус-нуля', function () {
  assert.strictEqual(rngLib.round(1 / 3, 4), 0.3333);
  assert.strictEqual(rngLib.round(2.5000004, 3), 2.5);
  assert.strictEqual(rngLib.round(-0.0000001, 4), 0);
  assert.ok(!Object.is(rngLib.round(-0.0000001, 4), -0), 'минус-ноль ломает побайтовое сравнение');
});

/* ================================= История ================================= */

test('история: доступ только на чтение, внутренние массивы наружу не текут', function () {
  var h = historyLib.createHistory();
  h.__push(C, D);
  h.__push(D, D);

  var copy = h.moves();
  copy.mine.push('порча');
  assert.strictEqual(h.length, 2, 'правка копии не должна менять историю');
  assert.strictEqual(Object.keys(h).indexOf('__push'), -1, '__push должен быть неперечислимым');
});

test('история: индексы, счётчики и условные вероятности считаются верно', function () {
  var h = historyLib.createHistory();
  h.__push(C, C); // раунд 0
  h.__push(C, D); // раунд 1: после моего C он предал
  h.__push(D, D); // раунд 2: после моего C он предал
  h.__push(D, C); // раунд 3: после моего D он сотрудничал

  assert.strictEqual(h.length, 4);
  assert.strictEqual(h.mine(0), C);
  assert.strictEqual(h.opp(-1), C, 'отрицательный индекс — с конца');
  assert.strictEqual(h.lastMine(), D);
  assert.strictEqual(h.oppDefections(), 2);
  assert.strictEqual(h.oppCooperations(), 2);
  assert.strictEqual(h.myDefections(), 2);
  assert.strictEqual(h.count(C, D), 1);
  assert.strictEqual(h.oppCoopRate(), 0.5);

  // Переходы: мой ход k−1 → его ход k. Их всего три: 0→1, 1→2, 2→3.
  assert.strictEqual(h.oppSamplesAfter(C), 2, 'два перехода начались с моего C');
  assert.strictEqual(h.oppCoopAfter(C, 1), 0, 'после моего C он оба раза предал');
  assert.strictEqual(h.oppSamplesAfter(D), 1);
  assert.strictEqual(h.oppCoopAfter(D, 0), 1, 'после моего D он сотрудничал');
});

test('история: пустая история отдаёт разумные значения по умолчанию', function () {
  var h = historyLib.createHistory();
  assert.strictEqual(h.length, 0);
  assert.strictEqual(h.lastOpp(), undefined);
  assert.strictEqual(h.oppCoopRate(), 1, 'о незнакомце думаем хорошо');
  assert.strictEqual(h.oppCoopAfter(C, 0.42), 0.42, 'без наблюдений возвращается априор');
});

/* ================================== Матч ================================== */

test('матч: длится заданное число раундов и очки сходятся со средними', function () {
  var r = match.playMatch(helpers.constant(C), helpers.constant(C), { rounds: 200, noise: 0, seed: 1 });
  assert.strictEqual(r.rounds, 200);
  assert.strictEqual(r.scoreA, 600, '200 раундов по R=3');
  assert.strictEqual(r.avgA, 3);
  assert.strictEqual(r.avgB, 3);
  assert.strictEqual(r.coopA, 1);
});

test('матч: предательство доверчивого даёт ровно 5.0 против 0.0', function () {
  var r = match.playMatch(helpers.constant(D), helpers.constant(C), { rounds: 200, noise: 0, seed: 9 });
  assert.strictEqual(r.avgA, 5);
  assert.strictEqual(r.avgB, 0);
  assert.strictEqual(r.scoreA + r.scoreB, 1000);
});

test('матч: длина матча стратегии недоступна', function () {
  var seenKeys = null;
  var spy = {
    id: 'spy',
    create: function () {
      return {
        move: function (h) {
          if (!seenKeys) seenKeys = Object.keys(h).slice();
          return C;
        }
      };
    }
  };
  match.playMatch(spy, helpers.constant(C), { rounds: 20, noise: 0, seed: 1 });
  var forbidden = seenKeys.filter(function (k) {
    return /rounds|total|remaining|limit/i.test(k);
  });
  assert.deepStrictEqual(forbidden, [], 'в истории не должно быть подсказок о длине матча');
});

test('матч: стратегия не получает ссылку на соперника', function () {
  var captured = [];
  var spy = {
    id: 'spy2',
    create: function (api) {
      captured.push(Object.keys(api));
      return { move: function () { return C; } };
    }
  };
  match.playMatch(spy, helpers.constant(D), { rounds: 5, noise: 0, seed: 1 });
  assert.deepStrictEqual(captured[0], ['random'], 'фабрике даётся только ГПСЧ');
});

/* ================================== Шум ================================== */

test('шум: при noise=0 ни один ход не искажается', function () {
  var r = match.playMatch(helpers.constant(C), helpers.constant(D), { rounds: 500, noise: 0, seed: 3 });
  assert.strictEqual(r.flipsA, 0);
  assert.strictEqual(r.flipsB, 0);
  assert.strictEqual(r.coopA, 1);
  assert.strictEqual(r.coopB, 0);
});

test('шум: при noise=1 искажается каждый ход', function () {
  var r = match.playMatch(helpers.constant(C), helpers.constant(C), { rounds: 100, noise: 1, seed: 3 });
  assert.strictEqual(r.flipsA, 100);
  assert.strictEqual(r.coopA, 0, 'все C превратились в D');
  assert.strictEqual(r.avgA, 1, 'обе стороны фактически предали — P=1');
});

test('шум: частота искажений держится около 5% в статистическом допуске', function () {
  var rounds = 200;
  var matches = 40;
  var flips = 0;
  for (var s = 0; s < matches; s++) {
    var r = match.playMatch(helpers.constant(C), helpers.constant(C), {
      rounds: rounds, noise: 0.05, seed: 1000 + s
    });
    flips += r.flipsA + r.flipsB;
  }
  var draws = rounds * matches * 2; // два независимых броска на раунд
  var rate = flips / draws;
  var sd = Math.sqrt(draws * 0.05 * 0.95) / draws;
  assert.ok(
    Math.abs(rate - 0.05) < 4 * sd,
    'частота шума ' + rate.toFixed(4) + ' вышла за 4σ от 0.05 (σ=' + sd.toFixed(5) + ')'
  );
});

test('шум: искажённый ход виден обеим сторонам, включая самого игрока', function () {
  // Игрок всегда приказывает C. Всё, что в истории оказалось D, — след помехи,
  // и он обязан быть виден самому игроку: на этом стоит механика покаяния.
  var seenOwnDefect = false;
  var watcher = {
    id: 'watcher',
    create: function () {
      return {
        move: function (h) {
          if (h.length && h.mine(-1) === D) seenOwnDefect = true;
          return C;
        }
      };
    }
  };
  var r = match.playMatch(watcher, helpers.constant(C), { rounds: 400, noise: 0.05, seed: 77 });
  assert.ok(r.flipsA > 0, 'при 400 раундах и 5% шума искажения обязаны случиться');
  assert.ok(seenOwnDefect, 'игрок должен видеть собственный сорвавшийся ход');
  assert.ok(r.intendedCoopA === 1 && r.coopA < 1, 'намерение и исполнение должны расходиться');
});
