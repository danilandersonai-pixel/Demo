'use strict';

/**
 * Чемпионат претендентов.
 *
 *   node sim/challengers.js
 *
 * Закрытый турнир: чемпион основной лиги против четырёх стратегий-претендентов
 * из `strategies/challengers/`. Правила те же — 200 раундов, 5% шума,
 * 30 поколений репликаторной динамики, равные стартовые доли.
 *
 * Основная лига при этом не меняется: добавление стратегий в
 * `strategies/index.js` сдвинуло бы сиды матчей и обесценило бы все прогоны
 * и все числа в отчёте. Результат пишется в `results/challengers.json`
 * и подхватывается `sim/run.js` при следующей сборке реплея.
 */

var fs = require('fs');
var path = require('path');

var registry = require('../strategies');
var challengers = require('../strategies/challengers');
var simulate = require('./simulate');
var tournament = require('./tournament');
var replayLib = require('./replay');
var rngLib = require('../engine/rng');

var ROOT = path.join(__dirname, '..');
var RESULTS_DIR = path.join(ROOT, 'results');
var OUT_FILE = path.join(RESULTS_DIR, 'challengers.json');
var SEED = 42;
var GENERATIONS = 30;

/**
 * Чемпион основной лиги — тот, кто лидирует в эталонном прогоне.
 * Берётся из результата, а не вписывается руками: если стратегии изменятся,
 * чемпионат автоматически пойдёт против нового чемпиона.
 */
function findChampion() {
  var file = path.join(RESULTS_DIR, SEED + '.json');
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8')).standings[0].id;
  }
  return simulate.run({ seed: SEED }).standings[0].id;
}

function build() {
  var championId = findChampion();
  var champion = registry.byId(championId);
  if (!champion) throw new Error('Чемпион лиги не найден в реестре: ' + championId);

  var defs = [champion].concat(challengers.list);
  var ids = defs.map(function (d) { return d.id; });

  // Одиночный круговой турнир для очных чисел таблицы.
  var rr = tournament.roundRobin(defs, {
    seed: SEED,
    generation: 0,
    rounds: simulate.DEFAULT_ROUNDS,
    noise: simulate.DEFAULT_NOISE
  });

  var evolutionRun = simulate.run({
    seed: SEED,
    generations: GENERATIONS,
    strategies: defs
  });
  var last = evolutionRun.frames[evolutionRun.frames.length - 1];

  var table = ids.map(function (id, i) {
    var sum = 0;
    for (var j = 0; j < ids.length; j++) sum += rr.matrix[i][j];
    return {
      id: id,
      avg: rngLib.round(sum / ids.length, 3),
      vsChampion: rngLib.round(rr.matrix[i][0], 3),
      self: rngLib.round(rr.matrix[i][i], 3),
      finalShare: rngLib.round(last.sharesAfter[i], 4),
      survived: last.sharesAfter[i] > 0
    };
  }).sort(function (a, b) {
    if (b.finalShare !== a.finalShare) return b.finalShare - a.finalShare;
    return b.avg - a.avg;
  });

  var survivors = table.filter(function (row) {
    return row.survived && row.id !== championId;
  });
  var beatChampion = table.filter(function (row) {
    return row.id !== championId && row.finalShare > 0 &&
      row.finalShare >= table.filter(function (r) { return r.id === championId; })[0].finalShare;
  });
  var championRow = table.filter(function (row) { return row.id === championId; })[0];

  var nameOf = function (id) {
    var def = registry.byId(id) || challengers.byId(id);
    return def ? def.name : id;
  };

  var verdict =
    'Из ' + challengers.list.length + ' претендентов через ' + GENERATIONS +
    ' поколений выжило ' + survivors.length + ': ' +
    (survivors.length
      ? survivors.map(function (r) { return nameOf(r.id) + ' — ' + (r.finalShare * 100).toFixed(1) + '%'; }).join(', ')
      : 'никто') +
    '. Чемпион лиги «' + nameOf(championId) + '» удержал ' +
    (championRow.finalShare * 100).toFixed(1) + '% и ' +
    (beatChampion.length ? 'уступил первое место' : 'сохранил первое место') +
    '. Выбыли: ' +
    (table.filter(function (r) { return !r.survived; })
      .map(function (r) { return nameOf(r.id); }).join(', ') || 'никто') + '.';

  return {
    seed: SEED,
    noise: simulate.DEFAULT_NOISE,
    rounds: simulate.DEFAULT_ROUNDS,
    generations: GENERATIONS,
    championId: championId,
    participants: ids,
    entrants: registry.meta(challengers.list),
    matrix: rr.matrix.map(function (row) {
      return row.map(function (v) { return rngLib.round(v, 3); });
    }),
    table: table,
    evolution: evolutionRun,
    verdict: verdict
  };
}

function main() {
  var data = build();
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, replayLib.serializeJson(data), 'utf8');

  var nameOf = function (id) {
    var def = registry.byId(id) || challengers.byId(id);
    return def ? def.name : id;
  };

  console.log('Чемпионат претендентов · сид ' + data.seed + ' · поколений ' + data.generations);
  console.log('Чемпион лиги: ' + nameOf(data.championId));
  console.log('');
  console.log('участник           счёт  vs чемпион  сам с собой   итог  судьба');
  data.table.forEach(function (row) {
    console.log(
      nameOf(row.id).padEnd(18) +
      row.avg.toFixed(3).padStart(5) +
      row.vsChampion.toFixed(2).padStart(12) +
      row.self.toFixed(2).padStart(13) +
      (row.finalShare * 100).toFixed(1).padStart(7) + '%  ' +
      (row.survived ? 'выжил' : 'выбит')
    );
  });
  console.log('');
  console.log(data.verdict);
  console.log('');
  console.log('→ ' + path.relative(ROOT, OUT_FILE) + '. Пересобери реплей: node sim/run.js --all');
}

if (require.main === module) {
  main();
}

module.exports = { build: build, main: main, SEED: SEED, GENERATIONS: GENERATIONS };
