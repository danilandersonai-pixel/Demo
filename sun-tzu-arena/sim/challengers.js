'use strict';

/**
 * Лига претендентов: два круга войны.
 *
 *   node sim/challengers.js --round 1     закрытый турнир и личные донесения
 *   node sim/challengers.js --round 2     то же после доработки стратегий
 *
 * Закрытый турнир: чемпион основной лиги против стратегий-претендентов.
 * Правила те же — 200 раундов, 5% шума, 30 поколений репликаторной динамики,
 * равные стартовые доли.
 *
 * После турнира каждому автору выдаётся личное донесение
 * `results/challengers/round<N>/<id>.json`: только его собственные матчи
 * (полные ленты ходов обеих сторон), его место в таблице и динамика его доли.
 * Чужие результаты и чужой код в донесение не попадают.
 *
 * Соперники-претенденты в донесении обезличены — «Соперник I», «Соперник II».
 * Это не формальность: имя вроде «Резонанс» само по себе выдаёт механику, а
 * задача автора — вывести поведение противника из ленты ходов, ровно как это
 * делают стратегии внутри игры. Чемпион основной лиги назван по имени: его код
 * лежит в открытой части репозитория и авторам не запрещён.
 */

var fs = require('fs');
var path = require('path');

var registry = require('../strategies');
var challengers = require('../strategies/challengers');
var simulate = require('./simulate');
var tournament = require('./tournament');
var match = require('../engine/match');
var payoff = require('../engine/payoff');
var replayLib = require('./replay');
var rngLib = require('../engine/rng');

var ROOT = path.join(__dirname, '..');
var RESULTS_DIR = path.join(ROOT, 'results');
var BRIEF_DIR = path.join(RESULTS_DIR, 'challengers');
var OUT_FILE = path.join(RESULTS_DIR, 'challengers.json');
var SEED = 42;
var GENERATIONS = 30;
var ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/**
 * Чемпион основной лиги — тот, кто лидирует в эталонном прогоне ядра лиги.
 * Берётся из результата, а не вписывается руками: если стратегии изменятся,
 * чемпионат автоматически пойдёт против нового чемпиона.
 */
function findChampion() {
  var file = path.join(RESULTS_DIR, 'v1', SEED + '.json');
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8')).standings[0].id;
  }
  return simulate.run({ seed: SEED, strategies: registry.core }).standings[0].id;
}

function nameOf(id) {
  var def = registry.byId(id) || challengers.byId(id);
  return def ? def.name : id;
}

/** Полный расчёт закрытого турнира. */
function build(opts) {
  var o = opts || {};
  var round = o.round || 1;
  var championId = o.championId || findChampion();
  var champion = registry.byId(championId);
  if (!champion) throw new Error('Чемпион лиги не найден в реестре: ' + championId);

  var defs = [champion].concat(challengers.list);
  var ids = defs.map(function (d) { return d.id; });

  // Одиночный круговой турнир — для очных чисел таблицы и лент ходов.
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
  var championRow = table.filter(function (row) { return row.id === championId; })[0];
  var beaten = table[0].id !== championId;

  var verdict =
    'Круг ' + round + '. Из ' + challengers.list.length + ' претендентов через ' +
    GENERATIONS + ' поколений выжило ' + survivors.length + ': ' +
    (survivors.length
      ? survivors.map(function (r) { return nameOf(r.id) + ' — ' + (r.finalShare * 100).toFixed(1) + '%'; }).join(', ')
      : 'никто') +
    '. Чемпион лиги «' + nameOf(championId) + '» удержал ' +
    (championRow.finalShare * 100).toFixed(1) + '% и ' +
    (beaten ? 'уступил первое место' : 'сохранил первое место') +
    '. Выбыли: ' +
    (table.filter(function (r) { return !r.survived; })
      .map(function (r) { return nameOf(r.id); }).join(', ') || 'никто') + '.';

  return {
    round: round,
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

/**
 * Личное донесение одному автору: его матчи, его место, его кривая доли.
 * Ленты ходов переигрываются с теми же сидами, что и в турнире, поэтому
 * донесение описывает ровно те матчи, которые вошли в таблицу.
 */
function briefFor(data, entrantId) {
  var defs = [registry.byId(data.championId)].concat(challengers.list);
  var ids = data.participants;
  var me = ids.indexOf(entrantId);
  if (me < 0) throw new Error('Претендент не участвовал: ' + entrantId);

  var place = 0;
  data.table.forEach(function (row, i) {
    if (row.id === entrantId) place = i + 1;
  });
  var mine = data.table.filter(function (row) { return row.id === entrantId; })[0];

  // Обезличивание: чемпион назван, прочие претенденты — под римскими номерами
  // в порядке участия, чтобы имя не выдавало механику.
  var alias = {};
  var counter = 0;
  ids.forEach(function (id) {
    if (id === data.championId) alias[id] = nameOf(id) + ' (чемпион основной лиги)';
    else if (id === entrantId) alias[id] = 'ВЫ';
    else alias[id] = 'Соперник ' + ROMAN[counter++];
  });

  var matches = ids.map(function (oppId, j) {
    var lo = Math.min(me, j);
    var hi = Math.max(me, j);
    var r = match.playMatch(defs[lo], defs[hi], {
      rounds: data.rounds,
      noise: data.noise,
      seed: rngLib.hashSeed(tournament.DOMAIN, data.seed, 0, lo, hi),
      log: true
    });
    var iAmA = me <= j;
    var myMoves = r.log.map(function (x) { return iAmA ? x.a : x.b; }).join('');
    var theirMoves = r.log.map(function (x) { return iAmA ? x.b : x.a; }).join('');
    return {
      opponent: oppId === entrantId ? 'ВАША СОБСТВЕННАЯ КОПИЯ' : alias[oppId],
      yourAvg: iAmA ? r.avgA : r.avgB,
      theirAvg: iAmA ? r.avgB : r.avgA,
      yourScore: iAmA ? r.scoreA : r.scoreB,
      theirScore: iAmA ? r.scoreB : r.scoreA,
      yourCoopRate: iAmA ? r.coopA : r.coopB,
      theirCoopRate: iAmA ? r.coopB : r.coopA,
      yourMoves: myMoves,
      theirMoves: theirMoves
    };
  });

  var shareCurve = data.evolution.frames.map(function (frame) {
    return { gen: frame.gen, yourShare: frame.sharesAfter[me] };
  });

  return {
    round: data.round,
    you: {
      id: entrantId,
      name: nameOf(entrantId),
      place: place,
      of: ids.length,
      avgScore: mine.avg,
      vsChampion: mine.vsChampion,
      selfPlay: mine.self,
      finalShare: mine.finalShare,
      survived: mine.survived
    },
    rules: {
      rounds: data.rounds,
      noise: data.noise,
      generations: data.generations,
      payoff: { R: payoff.PAYOFF.R, P: payoff.PAYOFF.P, T: payoff.PAYOFF.T, S: payoff.PAYOFF.S }
    },
    note:
      'Это ваше личное донесение. Здесь только ваши матчи. Соперники-претенденты ' +
      'обезличены намеренно: их код вам по-прежнему недоступен, а поведение ' +
      'полагается выводить из ленты ходов. Ленты записаны по исполненным ходам, ' +
      'то есть уже с искажениями шума.',
    yourMatches: matches,
    yourShareByGeneration: shareCurve
  };
}

/** Записать турнир и личные донесения на диск. */
function persist(data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, replayLib.serializeJson(data), 'utf8');
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'challengers-round' + data.round + '.json'),
    replayLib.serializeJson(data), 'utf8'
  );

  var dir = path.join(BRIEF_DIR, 'round' + data.round);
  fs.mkdirSync(dir, { recursive: true });
  var written = [];
  challengers.list.forEach(function (def) {
    var file = path.join(dir, def.id + '.json');
    fs.writeFileSync(file, replayLib.serializeJson(briefFor(data, def.id)), 'utf8');
    written.push(file);
  });
  return written;
}

function parseArgs(argv) {
  var out = { round: 1 };
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--round') out.round = Number(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
    else throw new Error('Неизвестный аргумент: ' + argv[i]);
  }
  return out;
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
    console.log('node sim/challengers.js [--round 1|2]');
    return;
  }

  var data = build({ round: args.round });
  var briefs = persist(data);

  console.log('Лига претендентов · круг ' + data.round + ' · сид ' + data.seed +
    ' · поколений ' + data.generations);
  console.log('Чемпион основной лиги: ' + nameOf(data.championId));
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
  console.log('личные донесения:');
  briefs.forEach(function (f) { console.log('  ' + path.relative(ROOT, f)); });
  console.log('');
  console.log('→ ' + path.relative(ROOT, OUT_FILE) + '. Пересобери реплей: node sim/run.js --all');
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  build: build,
  briefFor: briefFor,
  persist: persist,
  main: main,
  parseArgs: parseArgs,
  SEED: SEED,
  GENERATIONS: GENERATIONS
};
