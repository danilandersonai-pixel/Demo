'use strict';

/**
 * Замер времени полного прогона.
 *
 *   node sim/bench.js [--repeat 3] [--json]
 *
 * Меряет то, что реально стоит времени: один матч, круговой турнир одного
 * поколения, полный прогон на 30 поколений, пространственный режим, свип
 * устойчивости и сборку реплея. Каждый замер повторяется и берётся медиана —
 * среднее на JIT-разогреве врёт, а минимум прячет типичный случай.
 *
 * Числа отсюда попадают в AUDIT.md как «до» и «после» оптимизаций.
 */

var registry = require('../strategies');
var match = require('../engine/match');
var tournament = require('./tournament');
var simulate = require('./simulate');
var spatial = require('./spatial');
var replayLib = require('./replay');

function median(values) {
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  var mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Прогнать fn `repeat` раз, вернуть медиану в миллисекундах и объём работы. */
function measure(label, units, repeat, fn) {
  var times = [];
  for (var i = 0; i < repeat; i++) {
    var t0 = process.hrtime.bigint();
    fn(i);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  var ms = median(times);
  return { label: label, ms: Math.round(ms * 1000) / 1000, units: units, perUnit: units ? ms / units : null };
}

function parseArgs(argv) {
  var out = { repeat: 3, json: false };
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--repeat') out.repeat = Number(argv[++i]);
    else if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
    else throw new Error('Неизвестный аргумент: ' + argv[i]);
  }
  return out;
}

function run(repeat) {
  var defs = registry.list;
  var n = defs.length;
  var pairs = (n * (n + 1)) / 2;
  var results = [];

  // Разогрев JIT: без него первый замер завышен в разы и портит медиану.
  for (var w = 0; w < 3; w++) {
    tournament.roundRobin(defs, { seed: 1, generation: w, rounds: 200, noise: 0.05 });
  }

  results.push(measure('матч 200 раундов', 200, repeat * 20, function (i) {
    match.playMatch(defs[i % n], defs[(i * 7 + 3) % n], { rounds: 200, noise: 0.05, seed: i });
  }));

  results.push(measure('круговой турнир (' + pairs + ' матчей)', pairs, repeat, function (i) {
    tournament.roundRobin(defs, { seed: 42, generation: i, rounds: 200, noise: 0.05 });
  }));

  results.push(measure('полный прогон, 30 поколений', 30 * pairs, repeat, function (i) {
    simulate.run({ seed: 42 + i, generations: 30 });
  }));

  results.push(measure('пространственный режим 20×20', 1, repeat, function (i) {
    spatial.run({ seed: 42 + i });
  }));

  var runs = [7, 42, 2026].map(function (seed) { return simulate.run({ seed: seed }); });
  results.push(measure('сборка ARENA_DATA', 1, repeat, function () {
    replayLib.serializeJson(replayLib.buildArenaData(runs, {}));
  }));

  var sweep = null;
  try {
    sweep = require('./sweep');
  } catch (err) {
    sweep = null;
  }
  if (sweep) {
    results.push(measure('свип устойчивости', 1, Math.max(1, repeat - 2), function () {
      sweep.run({ seed: 42 });
    }));
  }

  var evolve = null;
  try {
    evolve = require('./evolve');
  } catch (err) {
    evolve = null;
  }
  if (evolve) {
    results.push(measure('генетика, 150 поколений', 1, Math.max(1, repeat - 2), function () {
      evolve.run({ seed: 42 });
    }));
  }

  return { strategies: n, pairs: pairs, results: results };
}

function main(argv) {
  var args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log('node sim/bench.js [--repeat 3] [--json]');
    return;
  }

  var out = run(args.repeat);

  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log('Арена Сунь-Цзы · замер производительности');
  console.log('стратегий: ' + out.strategies + ', пар в турнире: ' + out.pairs +
    ', повторов: ' + args.repeat + ', node ' + process.version);
  console.log('');
  var width = Math.max.apply(null, out.results.map(function (r) { return r.label.length; }));
  out.results.forEach(function (r) {
    var line = r.label.padEnd(width + 2) + (r.ms.toFixed(1) + ' мс').padStart(11);
    if (r.units > 1) line += '   ' + (r.perUnit * 1000).toFixed(1) + ' мкс/ед.';
    console.log(line);
  });
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { run: run, measure: measure, median: median, parseArgs: parseArgs };
