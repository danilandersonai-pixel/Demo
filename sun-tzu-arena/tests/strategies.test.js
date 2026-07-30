'use strict';

var test = require('node:test');
var assert = require('node:assert');

var registry = require('../strategies');
var match = require('../engine/match');
var h = require('./helpers');

var C = 'C';
var D = 'D';
var byId = registry.byId;

/* =============================== Реестр =============================== */

test('реестр: ядро первого сезона заморожено на двенадцати стратегиях', function () {
  // Индекс стратегии входит в сид каждого матча, поэтому ядро нельзя ни
  // переставлять, ни дополнять — иначе прогоны первого сезона перестанут
  // воспроизводиться, а числа в REPORT.md повиснут в воздухе.
  assert.strictEqual(registry.core.length, 12);
  assert.deepStrictEqual(
    registry.core.map(function (d) { return d.id; }),
    ['alwaysCooperate', 'alwaysDefect', 'random', 'titForTat', 'grimTrigger', 'pavlov',
      'knowTheEnemy', 'winWithoutFighting', 'feignedWeakness', 'patience', 'waterShape',
      'reconInForce'],
    'порядок ядра изменился — все прогоны первого сезона недействительны'
  );
  registry.core.forEach(function (def, i) {
    assert.strictEqual(registry.list[i], def, 'ядро обязано идти в начале общего списка');
  });
});

test('реестр: вся лига проходит контракт, id и цвета уникальны', function () {
  assert.ok(registry.list.length >= 10, 'по условию нужно минимум 10 стратегий');
  assert.strictEqual(registry.list.length, registry.core.length + registry.admitted.length);

  var ids = {};
  var colors = {};
  registry.list.forEach(function (def) {
    assert.doesNotThrow(function () { registry.validate(def); }, 'досье ' + def.id + ' неполно');
    assert.ok(!ids[def.id], 'дубль id: ' + def.id);
    assert.ok(!colors[def.color], 'дубль цвета у ' + def.id + ': ' + def.color);
    assert.ok(/^#[0-9a-f]{6}$/i.test(def.color), 'цвет должен быть hex: ' + def.color);
    assert.ok(def.dossier.strengths.length >= 2, def.id + ': нужно ≥2 сильных сторон');
    assert.ok(def.dossier.weaknesses.length >= 2, def.id + ': нужно ≥2 слабых сторон');
    ids[def.id] = true;
    colors[def.color] = true;
  });

  var authored = registry.list.filter(function (d) { return d.family === 'authored'; });
  assert.ok(authored.length >= 4, 'по условию нужно минимум 4 авторские стратегии');
});

test('реестр: принятые во втором сезоне на месте и не пересекаются с ядром', function () {
  var ids = registry.admitted.map(function (d) { return d.id; });
  assert.deepStrictEqual(ids,
    ['counterIntelligence', 'quartermaster', 'resonance', 'windAndMountain', 'nameless'],
    'состав принятых изменился');
  registry.admitted.forEach(function (def) {
    assert.strictEqual(registry.core.indexOf(def), -1, def.id + ' просочился в ядро');
    assert.ok(['challenger', 'evolved'].indexOf(def.family) >= 0,
      def.id + ': принятые бывают только претендентами или выведенными');
  });
});

test('реестр: валидатор отвергает стратегию без досье и без фабрики', function () {
  assert.throws(function () {
    registry.validate({ id: 'x', latin: 'X', name: 'X', color: '#fff', glyph: 'x', family: 'f',
      tagline: 't', dossier: { principle: 'p', philosophy: 'f', strengths: [], weaknesses: ['w'], targets: 't' },
      create: function () {} });
  }, /strengths/);
  assert.throws(function () {
    registry.validate({ id: 'y', latin: 'Y', name: 'Y', color: '#fff', glyph: 'y', family: 'f',
      tagline: 't', dossier: { principle: 'p', philosophy: 'f', strengths: ['s'], weaknesses: ['w'], targets: 't' } });
  }, /create/);
});

test('вся лига: ни одна стратегия не трогает Math.random', function () {
  // Math.random ломает воспроизводимость прогона: подменяем его на ловушку.
  var original = Math.random;
  var touched = [];
  registry.list.forEach(function (def) {
    Math.random = function () { touched.push(def.id); return 0.5; };
    try {
      match.playMatch(def, h.constant(C), { rounds: 200, noise: 0.05, seed: 5 });
      match.playMatch(def, h.constant(D), { rounds: 200, noise: 0.05, seed: 6 });
    } finally {
      Math.random = original;
    }
  });
  assert.deepStrictEqual(touched, [], 'Math.random вызывали: ' + touched.join(', '));
});

/* ====================== Поведение: классика (6) ====================== */

test('Пацифист: сотрудничает всегда, что бы ни делал соперник', function () {
  assert.strictEqual(h.play(byId('alwaysCooperate'), h.constant(D), 60).a, 'C'.repeat(60));
  assert.strictEqual(h.play(byId('alwaysCooperate'), h.scripted([C, D, D, C]), 60).a, 'C'.repeat(60));
});

test('Агрессор: предаёт всегда, что бы ни делал соперник', function () {
  assert.strictEqual(h.play(byId('alwaysDefect'), h.constant(C), 60).a, 'D'.repeat(60));
  assert.strictEqual(h.play(byId('alwaysDefect'), h.constant(D), 60).a, 'D'.repeat(60));
});

test('Хаос: воспроизводим при одном сиде и даёт примерно поровну C и D', function () {
  var one = h.play(byId('random'), h.constant(C), 400, { seed: 31 }).a;
  var two = h.play(byId('random'), h.constant(C), 400, { seed: 31 }).a;
  assert.strictEqual(one, two, 'один сид — одна последовательность');

  var other = h.play(byId('random'), h.constant(C), 400, { seed: 32 }).a;
  assert.notStrictEqual(one, other, 'разные сиды должны расходиться');

  var rate = h.rateOf(one, C);
  assert.ok(Math.abs(rate - 0.5) < 0.08, 'доля сотрудничества ' + rate + ' далека от 0.5');
});

test('Зеркало: начинает с доверия и повторяет последний ход соперника', function () {
  var script = [C, C, D, C, D, D, C, D];
  var r = h.play(byId('titForTat'), h.scripted(script), 40);
  assert.strictEqual(r.a[0], C, 'первый ход — доверие');
  for (var i = 1; i < 40; i++) {
    assert.strictEqual(r.a[i], r.b[i - 1], 'раунд ' + i + ': ход должен повторять предыдущий ход соперника');
  }
});

test('Мститель: не прощает — после первого предательства не сотрудничает никогда', function () {
  // Соперник предаёт один раз на 5-м раунде и дальше безупречен.
  var r = h.play(byId('grimTrigger'), h.defectsOn([5]), 80);
  assert.strictEqual(r.a.slice(0, 6), 'C'.repeat(6), 'до измены — чистое доверие');
  assert.strictEqual(r.a.slice(6), 'D'.repeat(74), 'после измены — вечная война');
  assert.strictEqual(r.a.indexOf(C, 6), -1, 'ни одного возврата к сотрудничеству');
});

test('Прагматик: win-stay, lose-shift по всем четырём исходам', function () {
  // (мой ход, его ход) → ожидаемый следующий ход
  var cases = [
    { mine: C, opp: C, next: C }, // получил 3 — выигрыш, повторяю
    { mine: C, opp: D, next: D }, // получил 0 — проигрыш, меняю
    { mine: D, opp: C, next: D }, // получил 5 — выигрыш, повторяю
    { mine: D, opp: D, next: C } //  получил 1 — проигрыш, меняю
  ];
  cases.forEach(function (c) {
    var history = require('../engine/history').createHistory();
    history.__push(c.mine, c.opp);
    var agent = byId('pavlov').create({ random: function () { return 0.5; } });
    assert.strictEqual(
      agent.move(history), c.next,
      'после (' + c.mine + ',' + c.opp + ') ожидался ' + c.next
    );
  });
});

/* ====================== Поведение: авторские (6) ====================== */

test('Соглядатай: доит безответного, но дружит с тем, кто отвечает', function () {
  var vsNaive = h.play(byId('knowTheEnemy'), h.constant(C), 200).result;
  assert.ok(vsNaive.avgA > 4.0, 'против Пацифиста должен собирать больше 4.0, получил ' + vsNaive.avgA);

  var vsMirror = h.play(byId('knowTheEnemy'), byId('titForTat'), 200).result;
  assert.ok(vsMirror.avgA > 2.7, 'с Зеркалом должен удерживать мир, получил ' + vsMirror.avgA);

  var vsBrute = h.play(byId('knowTheEnemy'), h.constant(D), 200).result;
  assert.ok(vsBrute.avgA > 0.7, 'против Агрессора должен сдерживать, а не кормить: ' + vsBrute.avgA);
});

test('Соглядатай: ведёт разведку предательством в первых раундах', function () {
  var r = h.play(byId('knowTheEnemy'), h.constant(C), 30);
  assert.strictEqual(r.a.slice(0, 4), 'CCCC', 'открытие — четыре раунда доброй воли');
  assert.ok(r.a.slice(4, 12).indexOf(D) >= 0, 'дальше обязана быть разведка предательством');
});

test('Миротворец: прощает единичный срыв и не скатывается в месть', function () {
  var r = h.play(byId('winWithoutFighting'), h.defectsOn([40]), 120);
  assert.strictEqual(r.a.indexOf(D), -1, 'единичное предательство на фоне доброго поведения — помеха, не измена');
});

test('Миротворец: против безнадёжного переходит к чистому сдерживанию', function () {
  var r = h.play(byId('winWithoutFighting'), h.constant(D), 120);
  var tail = r.a.slice(40);
  assert.strictEqual(tail.indexOf(C), -1, 'после приговора не должно быть попыток примирения');
  assert.ok(r.result.avgA >= 0.9, 'счёт против Агрессора не должен проседать ниже P=1: ' + r.result.avgA);
});

test('Миротворец: платит контрибуцию за собственный сорвавшийся ход', function () {
  // Шум когда-нибудь исказит его C. Соперник — Зеркало, которое обязано
  // ответить. Обычная месть дала бы длинную цепочку взаимных D; покаяние
  // должно её оборвать. Проверяем, что цепочек длиннее трёх подряд не бывает.
  var r = h.play(byId('winWithoutFighting'), byId('titForTat'), 400, { noise: 0.05, seed: 4 });
  var longest = 0;
  var cur = 0;
  for (var i = 0; i < r.a.length; i++) {
    if (r.a[i] === D && r.b[i] === D) { cur += 1; if (cur > longest) longest = cur; }
    else cur = 0;
  }
  assert.ok(longest <= 3, 'самая длинная взаимная война длилась ' + longest + ' раундов');
  assert.ok(r.result.avgA > 2.4, 'с Зеркалом в шуме должен держаться выше 2.4: ' + r.result.avgA);
});

test('Приманка: восемнадцать раундов носит личину простака, затем захват', function () {
  var r = h.play(byId('feignedWeakness'), h.constant(C), 60);
  assert.strictEqual(r.a.slice(0, 18), 'C'.repeat(18), 'маска должна быть безупречной');
  assert.strictEqual(r.a[18], D, 'на 18-м раунде маска падает');
  assert.strictEqual(r.a.slice(24), 'D'.repeat(36), 'безответную жертву доит до конца');
});

test('Приманка: против огрызающегося отступает в зеркало, а не доит', function () {
  var r = h.play(byId('feignedWeakness'), byId('titForTat'), 200);
  var tail = r.a.slice(40);
  assert.ok(h.rateOf(tail, C) > 0.8, 'после отпора должна вернуться к миру, доля C = ' + h.rateOf(tail, C));
});

test('Терпение: тридцать раундов обороны без единого предательства', function () {
  [h.constant(C), h.constant(D), byId('titForTat')].forEach(function (foe) {
    var r = h.play(byId('patience'), foe, 30);
    assert.strictEqual(r.a, 'C'.repeat(30), 'фаза обороны должна быть чистой против любого соперника');
  });
});

test('Терпение: жатва наступает только против незлопамятного', function () {
  var vsNaive = h.play(byId('patience'), h.constant(C), 200);
  var harvest = vsNaive.a.slice(120);
  assert.ok(h.rateOf(harvest, D) > 0.1, 'против безответного жатва обязана начаться: ' + h.rateOf(harvest, D));

  var vsMirror = h.play(byId('patience'), byId('titForTat'), 200);
  var lateMirror = vsMirror.a.slice(120);
  assert.ok(
    h.rateOf(lateMirror, D) < h.rateOf(harvest, D),
    'против мстительного жатва должна быть заметно скромнее'
  );
});

test('Вода: принимает форму соперника — доля C следует за его долей C', function () {
  var vsNaive = h.play(byId('waterShape'), h.constant(C), 200);
  assert.ok(h.rateOf(vsNaive.a, C) > 0.9, 'с добрым течёт мирно: ' + h.rateOf(vsNaive.a, C));

  var vsBrute = h.play(byId('waterShape'), h.constant(D), 200);
  assert.ok(h.rateOf(vsBrute.a.slice(30), C) < 0.05, 'со злым застывает в предательстве');

  var vsHalf = h.play(byId('waterShape'), h.scripted([C, D]), 200);
  var rate = h.rateOf(vsHalf.a.slice(30), C);
  assert.ok(Math.abs(rate - 0.5) < 0.2, 'против чередования доля C должна быть около половины: ' + rate);
});

test('Разведка боем: зондирует рано и наращивает давление на безответного', function () {
  var r = h.play(byId('reconInForce'), h.constant(C), 200);
  assert.strictEqual(r.a.slice(0, 3), 'CCC', 'до первого зонда — добрая воля');
  assert.strictEqual(r.a[3], D, 'первый зонд на третьем раунде');
  assert.ok(h.rateOf(r.a.slice(60), D) > 0.9, 'безнаказанность должна перерасти в наступление');
});

test('Разведка боем: наказание сбивает бюджет агрессии и включает репарации', function () {
  var r = h.play(byId('reconInForce'), byId('titForTat'), 200);
  assert.ok(h.rateOf(r.a, C) > 0.8, 'против отвечающего давление должно спасть: доля C = ' + h.rateOf(r.a, C));
  assert.ok(r.result.avgA > 2.5, 'и матч должен остаться доходным: ' + r.result.avgA);
});

/* ==================== Общие требования ко всем сразу ==================== */

test('вся лига: возвращает только C или D в любых условиях', function () {
  var foes = [h.constant(C), h.constant(D), h.scripted([C, D, D, C, D]), byId('random')];
  registry.list.forEach(function (def) {
    foes.forEach(function (foe, k) {
      var r = h.play(def, foe, 200, { noise: 0.05, seed: 100 + k });
      assert.ok(/^[CD]+$/.test(r.a), def.id + ' вернул недопустимый ход');
    });
  });
});

test('вся лига: два матча с одним сидом совпадают ход в ход', function () {
  registry.list.forEach(function (def) {
    var one = h.play(def, byId('random'), 200, { noise: 0.05, seed: 55 });
    var two = h.play(def, byId('random'), 200, { noise: 0.05, seed: 55 });
    assert.strictEqual(one.a, two.a, def.id + ' недетерминирован');
    assert.strictEqual(one.b, two.b, def.id + ': недетерминирован соперник');
  });
});

test('все авторские стратегии: сдерживают Агрессора, а не кормят его', function () {
  // Все шесть авторских стратегий заявляют режим сдерживания. Порог мягкий —
  // потерять первые раунды на разведке им позволено, — но к концу матча каждая
  // обязана выйти на уровень взаимной войны, а не работать кормовой базой.
  registry.list.filter(function (d) { return d.family === 'authored'; }).forEach(function (def) {
    var r = match.playMatch(def, byId('alwaysDefect'), { rounds: 200, noise: 0, seed: 8 });
    assert.ok(r.avgA > 0.8, def.id + ' против Агрессора собрал всего ' + r.avgA);
  });
});

test('классика: три известные уязвимости перед Агрессором воспроизводятся точно', function () {
  // Это не недоработка, а определяющее свойство самих стратегий, и оно должно
  // быть зафиксировано числом: любое отклонение означает, что сломан движок.
  var vs = function (id) {
    return match.playMatch(byId(id), byId('alwaysDefect'), { rounds: 200, noise: 0, seed: 8 }).avgA;
  };
  assert.strictEqual(vs('alwaysCooperate'), 0, 'Пацифист отдаёт всё: 200 раундов по S=0');
  assert.strictEqual(vs('pavlov'), 0.5,
    'Прагматик чередует: после S=0 меняет ход, после P=1 меняет обратно — ровно (0+1)/2');
  var chaos = vs('random');
  assert.ok(Math.abs(chaos - 0.5) < 0.12,
    'Хаос сотрудничает вслепую примерно в половине раундов, получая около 0.5, а не ' + chaos);
});
