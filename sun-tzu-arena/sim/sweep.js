'use strict';

/**
 * Стенд устойчивости: одна и та же лига в разных мирах.
 *
 *   node sim/sweep.js --seed 42 [--generations 20]
 *
 * Меняются три параметра мира:
 *
 *   шум          0 / 5 / 10 / 20%
 *   длина матча  50 / 200 / 500 раундов
 *   матрица      классическая и «Затяжная война»
 *
 * Смысл — отделить чемпиона от чемпиона тепличных условий. Стратегия, которая
 * побеждает только при 5% шума и матче ровно в 200 раундов, победила не игру,
 * а конкретную настройку стенда.
 *
 * Альтернативная матрица «Затяжная война» (R=4, P=0, T=5, S=0) выбрана не
 * наугад. В классической матрице взаимная война даёт P=1, то есть хоть что-то;
 * здесь она не даёт ничего, а мир, наоборот, стоит дороже (4 вместо 3).
 * Это по-прежнему настоящая дилемма — T>R>P≥S и 2R>T+S выполнены, — но цена
 * ошибки резко вырастает: соблазн предать даёт всего +1 сверх мира вместо +2,
 * а сорвавшиеся переговоры обходятся в полный ноль. Гипотеза, которую матрица
 * проверяет: в мире, где война разорительна, а мир богат, преимущество
 * переходит от тех, кто умеет наказывать, к тем, кто умеет мириться.
 * Это ровно вторая глава трактата — «война любит победу и не любит
 * продолжительности» — переведённая в числа.
 */

var fs = require('fs');
var path = require('path');

var registry = require('../strategies');
var rngLib = require('../engine/rng');
var tournament = require('./tournament');
var evolution = require('./evolution');
var replayLib = require('./replay');

var ROOT = path.join(__dirname, '..');
var RESULTS_DIR = path.join(ROOT, 'results');

var NOISES = [0, 0.05, 0.1, 0.2];
var LENGTHS = [50, 200, 500];
var DEFAULT_GENERATIONS = 20;

var MATRICES = [
  {
    id: 'classic',
    name: 'Классическая',
    payoff: { R: 3, P: 1, T: 5, S: 0 },
    note: 'Каноническая дилемма: взаимная война даёт хоть что-то, соблазн — +2 сверх мира.'
  },
  {
    id: 'attrition',
    name: 'Затяжная война',
    payoff: { R: 4, P: 0, T: 5, S: 0 },
    note: 'Мир богаче, война не даёт ничего, соблазн всего +1 сверх мира.'
  }
];

/**
 * Один мир: полный эволюционный прогон при заданных условиях.
 *
 * Поколений здесь меньше, чем в основном режиме (20 против 30), и это
 * сознательно: миров 24, а прогон при матче в 500 раундов дороже обычного
 * в два с половиной раза. Двадцати поколений хватает, чтобы расстановка
 * определилась — в основном режиме лидер выходит вперёд к двенадцатому.
 */
function runWorld(defs, opts) {
  var n = defs.length;
  var shares = evolution.uniform(n);
  var extinctions = [];

  for (var gen = 0; gen < opts.generations; gen++) {
    var rr = tournament.roundRobin(defs, {
      seed: opts.seed,
      generation: gen,
      rounds: opts.rounds,
      noise: opts.noise,
      payoff: opts.payoff,
      onMatch: opts.onMatch
    });
    var fitness = tournament.fitnessVector(rr.matrix, shares);
    var step = evolution.step(shares, fitness, {});
    step.extinct.forEach(function (idx) {
      extinctions.push({ id: defs[idx].id, gen: gen });
    });
    shares = step.shares;
  }

  var standings = defs.map(function (def, i) {
    return { id: def.id, share: rngLib.round(shares[i], 4) };
  }).sort(function (a, b) {
    if (b.share !== a.share) return b.share - a.share;
    return a.id < b.id ? -1 : 1;
  });

  return {
    winner: standings[0].id,
    winnerShare: standings[0].share,
    alive: standings.filter(function (s) { return s.share > 0; }).length,
    shares: standings,
    extinctions: extinctions
  };
}

/**
 * Полный свип: 2 матрицы × 4 уровня шума × 3 длины матча = 24 мира.
 * Матрица передаётся движку параметром, глобальное состояние не трогается.
 */
function run(opts) {
  var o = opts || {};
  var seed = typeof o.seed === 'number' ? o.seed : 42;
  var generations = typeof o.generations === 'number' ? o.generations : DEFAULT_GENERATIONS;
  var defs = o.strategies || registry.list;
  var ids = defs.map(function (d) { return d.id; });

  var cells = [];
  MATRICES.forEach(function (matrix) {
    NOISES.forEach(function (noise) {
      LENGTHS.forEach(function (rounds) {
        var world = runWorld(defs, {
          seed: seed,
          generations: generations,
          rounds: rounds,
          noise: noise,
          payoff: matrix.payoff,
          onMatch: o.onMatch && function (i, j, avgA, avgB) {
            o.onMatch(i, j, avgA, avgB, { matrix: matrix.id, noise: noise, rounds: rounds });
          }
        });
        cells.push({
          matrix: matrix.id,
          noise: noise,
          rounds: rounds,
          winner: world.winner,
          winnerShare: world.winnerShare,
          alive: world.alive,
          shares: world.shares
        });
      });
    });
  });

  return summarize({
    seed: seed,
    generations: generations,
    strategyIds: ids,
    matrices: MATRICES,
    noises: NOISES,
    lengths: LENGTHS,
    cells: cells
  });
}

/**
 * Свод по стратегиям: где побеждает, где выживает, насколько ровно держится.
 *
 * Главная величина — `worlds`, число миров, в которых стратегия дожила до
 * конца. Именно она отделяет живучего от тепличного: победа в одном мире
 * может быть удачей настройки, выживание в двадцати четырёх — нет.
 */
function summarize(data) {
  var total = data.cells.length;
  var stat = {};
  data.strategyIds.forEach(function (id) {
    stat[id] = { id: id, wins: 0, survived: 0, shareSum: 0, worstShare: 1, bestShare: 0, winsIn: [] };
  });

  data.cells.forEach(function (cell) {
    stat[cell.winner].wins += 1;
    stat[cell.winner].winsIn.push(cell.matrix + '/' + cell.noise + '/' + cell.rounds);
    cell.shares.forEach(function (row) {
      var s = stat[row.id];
      s.shareSum += row.share;
      if (row.share > 0) s.survived += 1;
      if (row.share < s.worstShare) s.worstShare = row.share;
      if (row.share > s.bestShare) s.bestShare = row.share;
    });
  });

  var ranking = data.strategyIds.map(function (id) {
    var s = stat[id];
    return {
      id: id,
      wins: s.wins,
      survivedWorlds: s.survived,
      worlds: total,
      meanShare: rngLib.round(s.shareSum / total, 4),
      bestShare: s.bestShare,
      worstShare: rngLib.round(s.worstShare, 4),
      winsIn: s.winsIn
    };
  }).sort(function (a, b) {
    if (b.survivedWorlds !== a.survivedWorlds) return b.survivedWorlds - a.survivedWorlds;
    if (b.meanShare !== a.meanShare) return b.meanShare - a.meanShare;
    return a.id < b.id ? -1 : 1;
  });

  data.ranking = ranking;
  data.worlds = total;
  return data;
}

function parseArgs(argv) {
  var out = { seed: 42, generations: null, write: true };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--generations') out.generations = Number(argv[++i]);
    else if (a === '--no-write') out.write = false;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('Неизвестный аргумент: ' + a);
  }
  return out;
}

var HELP = [
  'Стенд устойчивости «Арены Сунь-Цзы»',
  '',
  '  node sim/sweep.js --seed 42 [--generations 20] [--no-write]',
  '',
  'Прогоняет лигу по 24 мирам: шум 0/5/10/20%, матч 50/200/500 раундов,',
  'две матрицы выплат. Результат: results/sweep-<seed>.json.'
].join('\n');

function main(argv) {
  var args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message + '\n' + HELP);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  var started = Date.now();
  var opts = { seed: args.seed };
  if (args.generations) opts.generations = args.generations;
  var data = run(opts);
  var name = function (id) {
    var def = registry.byId(id);
    return def ? def.name : id;
  };

  console.log('Стенд устойчивости · сид ' + data.seed + ' · миров ' + data.worlds +
    ' · поколений в каждом ' + data.generations);
  console.log('');

  data.matrices.forEach(function (matrix) {
    console.log(matrix.name + ' (R=' + matrix.payoff.R + ' P=' + matrix.payoff.P +
      ' T=' + matrix.payoff.T + ' S=' + matrix.payoff.S + ')');
    var header = '        шум    ';
    data.lengths.forEach(function (len) { header += String(len + ' раундов').padStart(22); });
    console.log(header);
    data.noises.forEach(function (noise) {
      var row = '   ' + String(Math.round(noise * 100) + '%').padStart(8) + '    ';
      data.lengths.forEach(function (len) {
        var cell = data.cells.filter(function (c) {
          return c.matrix === matrix.id && c.noise === noise && c.rounds === len;
        })[0];
        row += (name(cell.winner) + ' ' + Math.round(cell.winnerShare * 100) + '%').padStart(22);
      });
      console.log(row);
    });
    console.log('');
  });

  console.log('живучесть (в скольких мирах из ' + data.worlds + ' дожил до конца):');
  data.ranking.slice(0, 8).forEach(function (row) {
    console.log('   ' + name(row.id).padEnd(16) +
      String(row.survivedWorlds).padStart(3) + '/' + row.worlds +
      '   побед ' + String(row.wins).padStart(2) +
      '   средняя доля ' + (row.meanShare * 100).toFixed(1) + '%');
  });

  console.log('');
  console.log('за ' + Math.round((Date.now() - started) / 100) / 10 + ' с');

  if (args.write) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    var file = path.join(RESULTS_DIR, 'sweep-' + data.seed + '.json');
    fs.writeFileSync(file, replayLib.serializeJson(data), 'utf8');
    console.log('→ ' + path.relative(ROOT, file));
  }
  return data;
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  run: run,
  runWorld: runWorld,
  summarize: summarize,
  parseArgs: parseArgs,
  main: main,
  MATRICES: MATRICES,
  NOISES: NOISES,
  LENGTHS: LENGTHS,
  DEFAULT_GENERATIONS: DEFAULT_GENERATIONS
};
