'use strict';

var test = require('node:test');
var assert = require('node:assert');

var genome = require('../engine/genome');
var evolve = require('../sim/evolve');
var rngLib = require('../engine/rng');
var match = require('../engine/match');
var registry = require('../strategies');
var h = require('./helpers');

var C = 'C';
var D = 'D';

/* ============================ Кодирование ============================ */

test('геном: длина 21 локус — первый ход, память-1 и память-2', function () {
  assert.strictEqual(genome.LENGTH, 21);
  assert.strictEqual(genome.MEM1_SIZE, 4);
  assert.strictEqual(genome.MEM2_SIZE, 16);
  assert.strictEqual(genome.MEM2_OFFSET + genome.MEM2_SIZE, genome.LENGTH);
});

test('геном: индексация состояний однозначна и обратима', function () {
  var seen = {};
  [C, D].forEach(function (a) {
    [C, D].forEach(function (b) {
      [C, D].forEach(function (c) {
        [C, D].forEach(function (d) {
          var idx = genome.indexMemory2(a, b, c, d);
          assert.ok(idx >= 0 && idx < 16, 'индекс вне таблицы: ' + idx);
          assert.ok(!seen[idx], 'два разных состояния дали один индекс: ' + idx);
          seen[idx] = true;
        });
      });
    });
  });
  assert.strictEqual(Object.keys(seen).length, 16, 'таблица памяти-2 должна покрываться целиком');

  var seen1 = {};
  [C, D].forEach(function (a) {
    [C, D].forEach(function (b) {
      seen1[genome.indexMemory1(a, b)] = true;
    });
  });
  assert.strictEqual(Object.keys(seen1).length, 4);
});

test('геном: классики представимы точно и ведут себя как оригиналы', function () {
  // TitForTat: первый ход C, дальше повторяю его последний ход.
  var tft = 'C';
  for (var i = 0; i < genome.MEM1_SIZE; i++) tft += (i & 1) ? D : C;
  for (var j = 0; j < genome.MEM2_SIZE; j++) tft += genome.titForTatAt(j);
  assert.ok(genome.isValid(tft));

  var evolved = genome.toStrategy(tft, { id: 'tft-genome' });
  var script = [C, D, D, C, D, C, C, D];
  var mine = h.play(evolved, h.scripted(script), 40).a;
  var theirs = h.play(evolved, h.scripted(script), 40).b;
  for (var k = 1; k < 40; k++) {
    assert.strictEqual(mine[k], theirs[k - 1], 'раунд ' + k + ': геном обязан повторять ход соперника');
  }

  // AlwaysDefect: сплошные D.
  var allD = 'D'.repeat(genome.LENGTH);
  assert.strictEqual(h.play(genome.toStrategy(allD, { id: 'd' }), h.constant(C), 30).a, 'D'.repeat(30));

  // AlwaysCooperate: сплошные C.
  var allC = 'C'.repeat(genome.LENGTH);
  assert.strictEqual(h.play(genome.toStrategy(allC, { id: 'c' }), h.constant(D), 30).a, 'C'.repeat(30));
});

test('геном: сходство считается верно на эталонах', function () {
  var tft = 'C';
  var i;
  for (i = 0; i < genome.MEM1_SIZE; i++) tft += C;
  for (i = 0; i < genome.MEM2_SIZE; i++) tft += genome.titForTatAt(i);
  var d = genome.describe(tft);
  assert.strictEqual(d.similarity.titForTat, 1, 'сам с собой — сто процентов');
  assert.ok(d.similarity.alwaysDefect === 0.5, 'TitForTat совпадает с AllD ровно в половине состояний');

  var allC = 'C'.repeat(genome.LENGTH);
  assert.strictEqual(genome.describe(allC).similarity.alwaysCooperate, 1);
  assert.strictEqual(genome.describe(allC).similarity.alwaysDefect, 0);
});

test('геном: describe читает черты из таблицы, а не выдумывает', function () {
  var allC = 'C'.repeat(genome.LENGTH);
  var t = genome.describe(allC).traits;
  assert.strictEqual(t.nice, true);
  assert.strictEqual(t.keepsPeace, true);
  assert.strictEqual(t.retaliates, false, 'сплошное C не может мстить');
  assert.strictEqual(t.forgives, true);

  var allD = 'D'.repeat(genome.LENGTH);
  var t2 = genome.describe(allD).traits;
  assert.strictEqual(t2.nice, false);
  assert.strictEqual(t2.keepsPeace, false);
  assert.strictEqual(t2.retaliates, true);
  assert.strictEqual(t2.escapesWar, false, 'сплошное D не выходит из войны');
});

test('геном: неверная хромосома отвергается', function () {
  assert.ok(!genome.isValid('CCD'));
  assert.ok(!genome.isValid('X'.repeat(21)));
  assert.ok(!genome.isValid(null));
  assert.throws(function () { genome.toStrategy('CCD'); }, /Некорректный геном/);
});

/* ======================= Кроссовер и мутация ======================= */

test('кроссовер: каждый локус берётся у одного из родителей', function () {
  var rnd = rngLib.mulberry32(1);
  var mum = 'C'.repeat(genome.LENGTH);
  var dad = 'D'.repeat(genome.LENGTH);
  for (var trial = 0; trial < 200; trial++) {
    var child = genome.crossover(mum, dad, rnd);
    assert.strictEqual(child.length, genome.LENGTH);
    for (var i = 0; i < genome.LENGTH; i++) {
      assert.ok(child[i] === mum[i] || child[i] === dad[i],
        'локус ' + i + ' взялся ниоткуда: ' + child[i]);
    }
  }
});

test('кроссовер: от одинаковых родителей рождается их же копия', function () {
  var rnd = rngLib.mulberry32(7);
  var parent = genome.randomGenome(rngLib.mulberry32(3));
  for (var i = 0; i < 50; i++) {
    assert.strictEqual(genome.crossover(parent, parent, rnd), parent);
  }
});

test('кроссовер: берёт примерно поровну от обоих родителей', function () {
  var rnd = rngLib.mulberry32(11);
  var mum = 'C'.repeat(genome.LENGTH);
  var dad = 'D'.repeat(genome.LENGTH);
  var fromMum = 0;
  var total = 0;
  for (var t = 0; t < 500; t++) {
    var child = genome.crossover(mum, dad, rnd);
    for (var i = 0; i < genome.LENGTH; i++) {
      if (child[i] === C) fromMum += 1;
      total += 1;
    }
  }
  var share = fromMum / total;
  assert.ok(Math.abs(share - 0.5) < 0.03, 'перекос кроссовера: ' + share.toFixed(3));
});

test('мутация: при нулевой ставке ничего не меняется, при единичной — всё', function () {
  var rnd = rngLib.mulberry32(5);
  var g = genome.randomGenome(rngLib.mulberry32(9));
  assert.strictEqual(genome.mutate(g, rnd, 0), g);

  var flipped = genome.mutate(g, rnd, 1);
  for (var i = 0; i < genome.LENGTH; i++) {
    assert.notStrictEqual(flipped[i], g[i], 'локус ' + i + ' обязан был перевернуться');
  }
});

test('мутация: частота переворотов держится около заданной ставки', function () {
  var rnd = rngLib.mulberry32(13);
  var g = 'C'.repeat(genome.LENGTH);
  var rate = 0.1;
  var flips = 0;
  var trials = 2000;
  for (var t = 0; t < trials; t++) {
    var out = genome.mutate(g, rnd, rate);
    for (var i = 0; i < genome.LENGTH; i++) if (out[i] === D) flips += 1;
  }
  var observed = flips / (trials * genome.LENGTH);
  var sd = Math.sqrt(rate * (1 - rate) / (trials * genome.LENGTH));
  assert.ok(Math.abs(observed - rate) < 4 * sd,
    'частота мутаций ' + observed.toFixed(4) + ' вышла за 4σ от ' + rate);
});

test('расстояние: ноль до себя, единица до полной противоположности', function () {
  var g = genome.randomGenome(rngLib.mulberry32(17));
  assert.strictEqual(genome.distance(g, g), 0);
  var opposite = genome.mutate(g, rngLib.mulberry32(1), 1);
  assert.strictEqual(genome.distance(g, opposite), 1);
});

/* ========================== Генетический прогон ========================== */

test('генетика: один сид — побайтово один результат', function () {
  var a = evolve.run({ seed: 42, generations: 12, population: 16 });
  var b = evolve.run({ seed: 42, generations: 12, population: 16 });
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b), 'генетика недетерминирована');
});

test('генетика: разные сиды расходятся', function () {
  var a = evolve.run({ seed: 7, generations: 12, population: 16 });
  var b = evolve.run({ seed: 2026, generations: 12, population: 16 });
  assert.notStrictEqual(a.champion.genome + a.history[11].mean,
    b.champion.genome + b.history[11].mean);
});

test('генетика: популяция сходится и средняя приспособленность растёт', function () {
  var data = evolve.run({ seed: 42 });
  var early = data.history[5];
  var late = data.history[data.history.length - 1];
  assert.ok(late.mean > early.mean,
    'средняя приспособленность обязана вырасти: ' + early.mean + ' → ' + late.mean);
  assert.ok(late.unique < data.populationSize / 2,
    'к концу популяция обязана сойтись, различных геномов: ' + late.unique);
  assert.strictEqual(data.history.length, data.generations);
});

test('генетика: чемпион — самый многочисленный геном последнего поколения', function () {
  var data = evolve.run({ seed: 42, generations: 40, population: 32 });
  assert.strictEqual(data.champion.genome, data.finalPopulation[0].genome);
  data.finalPopulation.forEach(function (row) {
    assert.ok(row.count <= data.champion.copies, 'нашёлся более многочисленный геном');
  });
  assert.ok(genome.isValid(data.champion.genome));
  var totalCopies = data.finalPopulation.reduce(function (a, r) { return a + r.count; }, 0);
  assert.ok(totalCopies <= data.populationSize);
});

test('генетика: элита переходит в следующее поколение дословно', function () {
  // Утверждение о механизме, поэтому и проверяется механизм, а не кривая
  // приспособленности: она относительна к популяции, и её просадка между
  // поколениями законна даже при целой элите.
  var rnd = rngLib.mulberry32(101);
  var population = [];
  for (var i = 0; i < 16; i++) population.push(genome.randomGenome(rnd));
  var fitness = population.map(function (g, k) { return k * 0.1; }); // лучший — последний

  var opts = {
    seed: 1, elitism: 3, tournamentSize: 3, crossoverRate: 0.6, mutationRate: 0.05
  };
  var next = evolve.breedNext(population, fitness, opts, 0);

  assert.strictEqual(next.length, population.length, 'размер популяции обязан сохраняться');
  var top = population.slice().map(function (g, k) { return { g: g, f: fitness[k] }; })
    .sort(function (a, b) { return b.f - a.f; }).slice(0, opts.elitism);
  top.forEach(function (row, place) {
    assert.strictEqual(next[place], row.g,
      'элита места ' + (place + 1) + ' обязана перейти без единой мутации');
  });
});

test('генетика: без элитизма лучший геном может потеряться, с ним — нет', function () {
  var rnd = rngLib.mulberry32(202);
  var population = [];
  for (var i = 0; i < 24; i++) population.push(genome.randomGenome(rnd));
  var fitness = population.map(function (g, k) { return k === 0 ? 99 : 1; }); // один уникум

  var withElite = evolve.breedNext(population, fitness,
    { seed: 2, elitism: 1, tournamentSize: 2, crossoverRate: 1, mutationRate: 0.5 }, 0);
  assert.ok(withElite.indexOf(population[0]) >= 0, 'элита обязана уцелеть даже при мутации 0.5');

  var withoutElite = evolve.breedNext(population, fitness,
    { seed: 2, elitism: 0, tournamentSize: 2, crossoverRate: 1, mutationRate: 0.5 }, 0);
  assert.strictEqual(withoutElite.indexOf(population[0]), -1,
    'без элитизма уникальный геном при такой мутации не выживает — иначе тест ничего не проверяет');
});

test('генетика: турнирный отбор предпочитает сильного', function () {
  var population = ['A', 'B', 'C', 'D'];
  var fitness = [1, 2, 3, 4];
  var counts = { A: 0, B: 0, C: 0, D: 0 };
  var rnd = rngLib.mulberry32(23);
  for (var i = 0; i < 4000; i++) counts[evolve.select(population, fitness, rnd, 3)] += 1;
  assert.ok(counts.D > counts.C && counts.C > counts.B && counts.B > counts.A,
    'порядок предпочтений нарушен: ' + JSON.stringify(counts));
  assert.ok(counts.A < 200, 'слабейший выбирается слишком часто: ' + counts.A);
});

test('генетика: мера разнообразия считает копии верно', function () {
  var d = evolve.diversity(['x', 'x', 'y', 'z', 'z', 'z']);
  assert.strictEqual(d.unique, 3);
  assert.strictEqual(d.counts.x, 2);
  assert.strictEqual(d.counts.z, 3);
  assert.strictEqual(d.ratio, 0.5);
});

/* =========================== «Безымянный» =========================== */

test('Безымянный: принят в лигу и играет по своей хромосоме', function () {
  var nameless = registry.byId('nameless');
  assert.ok(nameless, '«Безымянный» обязан быть в лиге');
  assert.strictEqual(nameless.family, 'evolved');
  assert.ok(genome.isValid(nameless.genome), 'у него должна быть корректная хромосома');

  // Поведение обязано совпадать с тем, что задаёт хромосома: первый ход и
  // ответ в известном состоянии памяти-2 берутся прямо из таблицы.
  var first = h.play(nameless, h.constant(C), 1).a;
  assert.strictEqual(first, nameless.genome[genome.FIRST_MOVE],
    'первый ход обязан читаться из локуса 0');

  var described = genome.describe(nameless.genome);
  assert.strictEqual(described.table.length, 16);
  assert.strictEqual(described.firstMove, nameless.genome[0]);
});

test('Безымянный: досье в файле описывает ту же хромосому, что в коде', function () {
  var fs = require('node:fs');
  var path = require('node:path');
  var file = path.join(__dirname, '..', 'strategies', 'evolved', 'nameless.js');
  var text = fs.readFileSync(file, 'utf8');
  var nameless = registry.byId('nameless');
  assert.ok(text.indexOf('Хромосома: ' + nameless.genome) >= 0,
    'в шапке файла указана не та хромосома, что в коде');
  assert.ok(text.indexOf('СГЕНЕРИРОВАН') >= 0, 'файл обязан честно сообщать, что он сгенерирован');
});

test('Безымянный: детерминирован и не трогает Math.random', function () {
  var nameless = registry.byId('nameless');
  var original = Math.random;
  var touched = false;
  Math.random = function () { touched = true; return 0.5; };
  try {
    var one = h.play(nameless, registry.byId('random'), 200, { noise: 0.05, seed: 31 });
    var two = h.play(nameless, registry.byId('random'), 200, { noise: 0.05, seed: 31 });
    assert.strictEqual(one.a, two.a);
  } finally {
    Math.random = original;
  }
  assert.strictEqual(touched, false, '«Безымянный» вызывал Math.random');
});

test('Безымянный: против лиги слабее рукописных — и это измеренный факт', function () {
  // Он отбирался против себе подобных, а не против лиги, поэтому встреча
  // с ней для него внезапна. Тест сторожит утверждение отчёта.
  var nameless = registry.byId('nameless');
  var scoreOf = function (def) {
    var sum = 0;
    registry.core.forEach(function (foe, i) {
      sum += match.playMatch(def, foe, { rounds: 200, noise: 0.05, seed: 500 + i }).avgA;
    });
    return sum / registry.core.length;
  };
  var mine = scoreOf(nameless);
  var mirror = scoreOf(registry.byId('titForTat'));
  assert.ok(mine < mirror,
    '«Безымянный» ' + mine.toFixed(3) + ' против Зеркала ' + mirror.toFixed(3) +
    ' — утверждение отчёта перестало быть верным');
});
