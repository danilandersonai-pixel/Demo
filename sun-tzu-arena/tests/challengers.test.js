'use strict';

var test = require('node:test');
var assert = require('node:assert');

var registry = require('../strategies');
var challengers = require('../strategies/challengers');
var match = require('../engine/match');
var h = require('./helpers');

var C = 'C';
var D = 'D';
var byId = registry.byId;
var chById = challengers.byId;

/** Средние очки претендента против соперника, без шума если не сказано иначе. */
function vs(id, foe, opts) {
  var o = opts || {};
  return match.playMatch(chById(id), foe, {
    rounds: 200,
    noise: typeof o.noise === 'number' ? o.noise : 0,
    seed: typeof o.seed === 'number' ? o.seed : 11
  }).avgA;
}

test('претенденты: четыре участника, у каждого полное досье и уникальный id', function () {
  assert.strictEqual(challengers.list.length, 4);
  var ids = {};
  challengers.list.forEach(function (def) {
    assert.doesNotThrow(function () { registry.validate(def); }, def.id + ': досье неполно');
    assert.strictEqual(def.family, 'challenger');
    assert.ok(!ids[def.id], 'дубль id: ' + def.id);
    assert.ok(!registry.byId(def.id), def.id + ' не должен пересекаться с основной лигой');
    ids[def.id] = true;
  });
});

test('претенденты: реестр основной лиги не изменился', function () {
  // Добавление претендентов в основной реестр сдвинуло бы сиды всех матчей
  // и обесценило бы каждый прогон и каждое число в отчёте.
  assert.strictEqual(registry.list.length, 12);
  challengers.list.forEach(function (def) {
    assert.strictEqual(registry.list.indexOf(def), -1, def.id + ' просочился в основную лигу');
  });
});

test('претенденты: ни один не трогает Math.random', function () {
  var original = Math.random;
  var touched = [];
  challengers.list.forEach(function (def) {
    Math.random = function () { touched.push(def.id); return 0.5; };
    try {
      match.playMatch(def, h.constant(C), { rounds: 200, noise: 0.05, seed: 5 });
      match.playMatch(def, byId('random'), { rounds: 200, noise: 0.05, seed: 6 });
    } finally {
      Math.random = original;
    }
  });
  assert.deepStrictEqual(touched, [], 'Math.random вызывали: ' + touched.join(', '));
});

test('претенденты: возвращают только C или D и воспроизводимы', function () {
  challengers.list.forEach(function (def) {
    var one = h.play(def, byId('random'), 200, { noise: 0.05, seed: 21 });
    var two = h.play(def, byId('random'), 200, { noise: 0.05, seed: 21 });
    assert.ok(/^[CD]+$/.test(one.a), def.id + ' вернул недопустимый ход');
    assert.strictEqual(one.a, two.a, def.id + ' недетерминирован');
  });
});

test('претенденты: приёмочные пороги турнира выдержаны каждым', function () {
  // Те же четыре порога, что стояли в брифах авторов. Стратегия, не умеющая
  // ужиться с собственной копией, в эволюции обречена, поэтому самоигра здесь
  // такой же обязательный критерий, как и остальные.
  var failures = [];
  challengers.list.forEach(function (def) {
    var checks = [
      ['против Пацифиста ≥ 3.0', vs(def.id, byId('alwaysCooperate'), { noise: 0.05 }), 3.0],
      ['против Агрессора ≥ 0.9', vs(def.id, byId('alwaysDefect'), { noise: 0.05 }), 0.9],
      ['против Зеркала ≥ 2.6', vs(def.id, byId('titForTat'), { noise: 0.05 }), 2.6],
      ['с собственной копией ≥ 2.5', vs(def.id, def, { noise: 0.05 }), 2.5]
    ];
    checks.forEach(function (c) {
      if (!(c[1] >= c[2])) failures.push(def.name + ': ' + c[0] + ', получено ' + c[1].toFixed(2));
    });
  });
  assert.deepStrictEqual(failures, [], 'пороги не выдержаны:\n' + failures.join('\n'));
});

/* ==================== Поведение, заявленное в досье ==================== */

test('Контрразведка: ловит смену режима у соперника не хуже Зеркала', function () {
  // Приманка и Терпение — две стратегии лиги, меняющие режим посреди матча.
  // Заявленное преимущество Контрразведки в том, что она это замечает.
  ['feignedWeakness', 'patience'].forEach(function (foe) {
    var mine = vs('counterIntelligence', byId(foe), { noise: 0.05 });
    var mirror = match.playMatch(byId('titForTat'), byId(foe), {
      rounds: 200, noise: 0.05, seed: 11
    }).avgA;
    assert.ok(mine >= mirror - 0.15,
      'против ' + foe + ': Контрразведка ' + mine.toFixed(2) + ', Зеркало ' + mirror.toFixed(2));
  });
});

test('Интендант: не проигрывает дуэль по накопленным очкам большинству лиги', function () {
  // Заявленная цель — не максимум очков, а не остаться в минусе по балансу.
  var wins = 0;
  registry.list.forEach(function (foe) {
    var r = match.playMatch(chById('quartermaster'), foe, { rounds: 200, noise: 0.05, seed: 11 });
    if (r.scoreA >= r.scoreB) wins += 1;
  });
  assert.ok(wins >= 7, 'Интендант выиграл или свёл вничью только ' + wins + ' из 12 дуэлей');
});

test('Резонанс: распознаёт безответного и при этом не вырождается в Агрессора', function () {
  assert.ok(vs('resonance', byId('alwaysCooperate')) > 4.0,
    'предсказатель обязан распознать Пацифиста');
  var withMirror = h.play(chById('resonance'), byId('titForTat'), 200, { noise: 0 });
  assert.ok(h.rateOf(withMirror.a, C) > 0.8,
    'с Зеркалом должен сотрудничать, доля C = ' + h.rateOf(withMirror.a, C));
  var withBrute = h.play(chById('resonance'), byId('alwaysDefect'), 200, { noise: 0 });
  assert.ok(h.rateOf(withBrute.a.slice(30), D) > 0.8, 'против Агрессора обязан сдерживать');
});

test('Ветер и Гора: все четыре режима достижимы против разных соперников', function () {
  // Режимы не видны снаружи, но их следы в ходах однозначны:
  // Огонь — сплошное D против безответного; Лес — сплошное C с надёжным;
  // Гора — сплошное D против безнадёжного; Ветер — отражение в начале матча.
  var fire = h.play(chById('windAndMountain'), byId('alwaysCooperate'), 200);
  assert.ok(h.rateOf(fire.a.slice(60), D) > 0.8, 'Огонь не включился против Пацифиста');

  var forest = h.play(chById('windAndMountain'), byId('titForTat'), 200);
  assert.ok(h.rateOf(forest.a.slice(60), C) > 0.85, 'Лес не включился против Зеркала');

  var mountain = h.play(chById('windAndMountain'), byId('alwaysDefect'), 200);
  assert.ok(h.rateOf(mountain.a.slice(40), D) > 0.9, 'Гора не включилась против Агрессора');

  var wind = h.play(chById('windAndMountain'), h.scripted([C, C, D, D, C, D]), 40);
  assert.ok(/[CD]/.test(wind.a) && wind.a.indexOf(C) >= 0 && wind.a.indexOf(D) >= 0,
    'Ветер должен отражать, а не залипать на одном ходе');
});

/* ======================= Закрытый турнир ======================= */

test('чемпионат: закрытый турнир считается и внутренне согласован', function () {
  var champ = require('../sim/challengers');
  var data = champ.build();

  assert.ok(registry.byId(data.championId), 'чемпион должен быть из основной лиги');
  assert.strictEqual(data.participants.length, challengers.list.length + 1);
  assert.strictEqual(data.participants[0], data.championId, 'чемпион идёт первым');
  assert.strictEqual(data.table.length, data.participants.length);
  assert.strictEqual(data.entrants.length, challengers.list.length);

  var totalShare = 0;
  data.table.forEach(function (row) {
    assert.ok(data.participants.indexOf(row.id) >= 0, 'в таблице чужой участник: ' + row.id);
    assert.ok(row.avg > 0 && row.avg <= 5, 'средний счёт вне диапазона выплат: ' + row.avg);
    assert.strictEqual(row.survived, row.finalShare > 0, 'судьба не сходится с итоговой долей');
    totalShare += row.finalShare;
  });
  assert.ok(Math.abs(totalShare - 1) < 1e-3, 'итоговые доли должны давать единицу: ' + totalShare);

  assert.strictEqual(data.evolution.generations, champ.GENERATIONS);
  assert.ok(data.verdict.length > 40, 'вердикт должен быть содержательным');
});

test('чемпионат: вердикт согласован с таблицей, а не написан от руки', function () {
  var data = require('../sim/challengers').build();
  var survivors = data.table.filter(function (row) {
    return row.survived && row.id !== data.championId;
  });
  assert.ok(
    data.verdict.indexOf('выжило ' + survivors.length) >= 0,
    'число выживших в вердикте расходится с таблицей'
  );
  survivors.forEach(function (row) {
    var def = challengers.byId(row.id);
    assert.ok(data.verdict.indexOf(def.name) >= 0, 'выживший ' + def.name + ' не упомянут в вердикте');
  });
});
