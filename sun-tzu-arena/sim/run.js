'use strict';

/**
 * CLI симуляции.
 *
 *   node sim/run.js --seed 42 [--generations 30] [--noise 0.05]
 *   node sim/run.js --all
 *
 * Прогон с шумом по умолчанию пишет `results/<seed>.json` и перестраивает
 * `viz/replay.js`. Прогон с изменённым шумом — исследовательский: он пишет
 * `results/<seed>-noise<X>.json` и НЕ трогает реплей, чтобы визуализатор
 * всегда показывал три эталонных прогона в одинаковых условиях.
 */

var fs = require('fs');
var path = require('path');
var simulate = require('./simulate');
var spatial = require('./spatial');
var replayLib = require('./replay');
var match = require('../engine/match');

var ROOT = path.join(__dirname, '..');
var RESULTS_DIR = path.join(ROOT, 'results');
var REPLAY_FILE = path.join(ROOT, 'viz', 'replay.js');
var SPATIAL_FILE = path.join(RESULTS_DIR, 'spatial.json');
var CHALLENGERS_FILE = path.join(RESULTS_DIR, 'challengers.json');
var REFERENCE_SEEDS = [7, 42, 2026];

/** Разбор аргументов вида --key value и --flag. */
function parseArgs(argv) {
  var out = { seeds: [], all: false, generations: null, noise: null, spatial: null };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--seed') out.seeds.push(Number(argv[++i]));
    else if (a === '--generations') out.generations = Number(argv[++i]);
    else if (a === '--noise') out.noise = Number(argv[++i]);
    else if (a === '--spatial') out.spatial = true;
    else if (a === '--no-spatial') out.spatial = false;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('Неизвестный аргумент: ' + a);
  }
  return out;
}

var HELP = [
  'Арена Сунь-Цзы — эволюционный турнир стратегий',
  '',
  '  node sim/run.js --seed 42 [--generations 30] [--noise 0.05]',
  '  node sim/run.js --all            прогнать эталонные сиды 7, 42, 2026',
  '',
  'Опции:',
  '  --seed <n>          сид прогона (можно указать несколько раз)',
  '  --generations <n>   число поколений (по умолчанию 30)',
  '  --noise <p>         вероятность искажения хода (по умолчанию 0.05)',
  '  --spatial           пересчитать пространственный режим 20×20',
  '  --no-spatial        не пересчитывать пространственный режим',
  '  -h, --help          эта справка',
  '',
  'Прогон с шумом по умолчанию пишет results/<seed>.json и обновляет viz/replay.js.',
  'Прогон с другим шумом пишет results/<seed>-noise<X>.json и реплей не трогает.'
].join('\n');

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn('  ! не удалось прочитать ' + path.basename(file) + ': ' + err.message);
    return null;
  }
}

function describe(run) {
  var alive = run.standings.filter(function (s) {
    return s.share > 0;
  });
  var top = alive.slice(0, 4).map(function (s) {
    return s.id + ' ' + (s.share * 100).toFixed(1) + '%';
  });
  var verdict =
    run.outcome.type === 'domination'
      ? 'доминация ' + run.outcome.id + ' на поколении ' + run.outcome.gen
      : run.outcome.type === 'extinction'
        ? 'выжил один ' + run.outcome.id + ' на поколении ' + run.outcome.gen
        : 'сосуществование, лидер ' + run.outcome.id;
  return (
    '  исход: ' +
    verdict +
    '\n  живых фракций: ' +
    alive.length +
    ' из ' +
    run.strategyIds.length +
    '\n  топ: ' +
    top.join(', ') +
    '\n  вымирания: ' +
    (run.extinctions
      .map(function (e) {
        return e.id + '@' + e.gen;
      })
      .join(', ') || 'нет')
  );
}

function main(argv) {
  var args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    console.error('\n' + HELP);
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    console.log(HELP);
    return;
  }

  var seeds = args.all ? REFERENCE_SEEDS.slice() : args.seeds;
  if (!seeds.length) {
    console.error('Нужен --seed <n> или --all.\n');
    console.error(HELP);
    process.exitCode = 1;
    return;
  }

  var noise = args.noise === null ? match.DEFAULT_NOISE : args.noise;
  var generations = args.generations === null ? simulate.DEFAULT_GENERATIONS : args.generations;
  var isReferenceConditions = noise === match.DEFAULT_NOISE && generations === simulate.DEFAULT_GENERATIONS;

  console.log('Арена Сунь-Цзы · сиды ' + seeds.join(', ') + ' · шум ' + noise + ' · поколений ' + generations);
  console.log('');

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  var computed = {};
  seeds.forEach(function (seed) {
    var started = Date.now();
    var run = simulate.run({ seed: seed, generations: generations, noise: noise });
    var suffix = isReferenceConditions ? '' : '-noise' + noise + '-gen' + generations;
    var file = path.join(RESULTS_DIR, seed + suffix + '.json');
    fs.writeFileSync(file, replayLib.serializeJson(run), 'utf8');
    computed[seed] = run;

    console.log('seed ' + seed + ' → ' + path.relative(ROOT, file) + ' (' + (Date.now() - started) + ' мс)');
    console.log(describe(run));
    console.log('');
  });

  if (!isReferenceConditions) {
    console.log('Условия отличаются от эталонных — viz/replay.js не тронут.');
    return;
  }

  // Реплей всегда содержит все три эталонных прогона: визуализатор обязан
  // переключаться между ними, даже если пересчитан был только один.
  var runs = REFERENCE_SEEDS.map(function (seed) {
    if (computed[seed]) return computed[seed];
    var cached = readJsonIfExists(path.join(RESULTS_DIR, seed + '.json'));
    if (cached) return cached;
    console.log('seed ' + seed + ' отсутствует в results/ — досчитываю для реплея');
    var run = simulate.run({ seed: seed, generations: generations, noise: noise });
    fs.writeFileSync(path.join(RESULTS_DIR, seed + '.json'), replayLib.serializeJson(run), 'utf8');
    return run;
  });

  // Прогоны с нестандартными сидами добавляются в конец списка.
  seeds.forEach(function (seed) {
    if (REFERENCE_SEEDS.indexOf(seed) === -1) runs.push(computed[seed]);
  });

  var wantSpatial = args.spatial === null ? args.all : args.spatial;
  var spatialData = readJsonIfExists(SPATIAL_FILE);
  if (wantSpatial || !spatialData) {
    var t = Date.now();
    spatialData = spatial.run({ seed: 42, noise: noise });
    fs.writeFileSync(SPATIAL_FILE, replayLib.serializeJson(spatialData), 'utf8');
    console.log(
      'территория 20×20 → ' +
        path.relative(ROOT, SPATIAL_FILE) +
        ' (' +
        (Date.now() - t) +
        ' мс), победитель ' +
        spatialData.standings[0].id +
        ' — ' +
        spatialData.standings[0].cells +
        ' клеток'
    );
  }

  var challengers = readJsonIfExists(CHALLENGERS_FILE);

  var arenaData = replayLib.buildArenaData(runs, {
    spatial: spatialData,
    challengers: challengers
  });
  var bytes = replayLib.writeReplay(REPLAY_FILE, arenaData);
  console.log(
    'реплей → ' + path.relative(ROOT, REPLAY_FILE) + ' (' + Math.round(bytes / 1024) + ' КБ, прогонов ' + runs.length + ')'
  );
  console.log('открой viz/arena.html двойным щелчком');
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main: main, parseArgs: parseArgs, REFERENCE_SEEDS: REFERENCE_SEEDS };
