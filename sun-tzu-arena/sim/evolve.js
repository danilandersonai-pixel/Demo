'use strict';

/**
 * Генетический режим: вывести стратегию, а не написать её.
 *
 *   node sim/evolve.js --seed 42 [--population 64] [--generations 150]
 *
 * Популяция хромосом с памятью на два раунда (см. engine/genome.js) живёт
 * своей жизнью: круговой турнир внутри популяции, турнирный отбор, равномерный
 * кроссовер, точечная мутация, элитизм. Рукописных стратегий в среде отбора
 * НЕТ — это принципиально. Если бы геномы обучались против лиги, вопрос
 * «побьёт ли выведенная стратегия рукописные» стал бы бессмысленным: она была
 * бы подогнана ровно под них. Здесь эволюция варится в собственном соку,
 * а встреча с лигой — независимая проверка после.
 *
 * Детерминизм: весь ГПСЧ выводится из (сид, поколение, назначение), а сид матча
 * пары — из самих хромосом. Один сид даёт побайтово одинаковый результат.
 */

var fs = require('fs');
var path = require('path');

var rngLib = require('../engine/rng');
var genomeLib = require('../engine/genome');
var match = require('../engine/match');

var DOMAIN = 0x45564f4c; // 'EVOL'

var DEFAULTS = {
  population: 64,
  generations: 150,
  rounds: 150,
  noise: 0.05,
  tournamentSize: 3,
  crossoverRate: 0.6,
  mutationRate: 0.01,
  elitism: 2
};

var ROOT = path.join(__dirname, '..');
var RESULTS_DIR = path.join(ROOT, 'results');

/**
 * Круговой турнир внутри популяции.
 *
 * Исход пары кэшируется по самим хромосомам: к сотому поколению популяция
 * состоит из десятка различных геномов в множестве копий, и без кэша
 * девять десятых работы были бы повторными. На воспроизводимость это не
 * влияет — сид матча выводится из хромосом, а не из номеров в списке.
 */
function evaluate(population, opts, generation, cache) {
  var n = population.length;
  var acc = new Array(n).fill(0);

  for (var i = 0; i < n; i++) {
    for (var j = i; j < n; j++) {
      var a = population[i];
      var b = population[j];
      var key = a + '|' + b;
      var res = cache[key];
      if (res === undefined) {
        var r = match.playMatch(
          genomeLib.toStrategy(a, { id: 'a' }),
          genomeLib.toStrategy(b, { id: 'b' }),
          {
            rounds: opts.rounds,
            noise: opts.noise,
            seed: rngLib.hashSeed(
              DOMAIN, opts.seed, generation, rngLib.hashString(a), rngLib.hashString(b)
            )
          }
        );
        res = [r.avgA, r.avgB];
        cache[key] = res;
      }
      acc[i] += res[0];
      if (j !== i) acc[j] += res[1];
    }
  }

  return acc.map(function (sum) { return sum / n; });
}

/** Турнирный отбор: берём tournamentSize случайных, побеждает лучший. */
function select(population, fitness, random, size) {
  var best = Math.floor(random() * population.length) % population.length;
  for (var k = 1; k < size; k++) {
    var challenger = Math.floor(random() * population.length) % population.length;
    if (fitness[challenger] > fitness[best]) best = challenger;
  }
  return population[best];
}

/** Доля различных хромосом в популяции — простая мера разнообразия. */
function diversity(population) {
  var seen = Object.create(null);
  var unique = 0;
  population.forEach(function (g) {
    if (!seen[g]) { seen[g] = 0; unique += 1; }
    seen[g] += 1;
  });
  return { unique: unique, ratio: unique / population.length, counts: seen };
}

/**
 * Полный генетический прогон.
 * @param {object} [opts] {seed, population, generations, rounds, noise, ...}
 */
function run(opts) {
  var o = Object.assign({ seed: 42 }, DEFAULTS, opts || {});

  var init = rngLib.mulberry32(rngLib.hashSeed(DOMAIN, o.seed, 0xC0FFEE));
  var population = [];
  for (var p = 0; p < o.population; p++) population.push(genomeLib.randomGenome(init));

  var cache = Object.create(null);
  var history = [];

  for (var gen = 0; gen < o.generations; gen++) {
    var fitness = evaluate(population, o, gen, cache);

    var order = population.map(function (g, i) { return i; }).sort(function (x, y) {
      if (fitness[y] !== fitness[x]) return fitness[y] - fitness[x];
      return population[x] < population[y] ? -1 : population[x] > population[y] ? 1 : 0;
    });

    var bestIdx = order[0];
    var sum = fitness.reduce(function (a, b) { return a + b; }, 0);
    var div = diversity(population);

    history.push({
      gen: gen,
      best: rngLib.round(fitness[bestIdx], 4),
      mean: rngLib.round(sum / o.population, 4),
      worst: rngLib.round(fitness[order[order.length - 1]], 4),
      unique: div.unique,
      bestGenome: population[bestIdx]
    });

    if (gen === o.generations - 1) break; // последнее поколение только оценивается

    // Новое поколение: элита без изменений, остальные — потомки.
    var breed = rngLib.mulberry32(rngLib.hashSeed(DOMAIN, o.seed, gen, 0xB1DE));
    var next = [];
    for (var e = 0; e < o.elitism; e++) next.push(population[order[e]]);
    while (next.length < o.population) {
      var mum = select(population, fitness, breed, o.tournamentSize);
      var dad = select(population, fitness, breed, o.tournamentSize);
      var child = breed() < o.crossoverRate ? genomeLib.crossover(mum, dad, breed) : mum;
      next.push(genomeLib.mutate(child, breed, o.mutationRate));
    }
    population = next;
  }

  var finalFitness = evaluate(population, o, o.generations - 1, cache);
  var finalDiv = diversity(population);
  var survivors = Object.keys(finalDiv.counts)
    .map(function (g) {
      var idx = population.indexOf(g);
      return { genome: g, count: finalDiv.counts[g], fitness: rngLib.round(finalFitness[idx], 4) };
    })
    .sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      if (b.fitness !== a.fitness) return b.fitness - a.fitness;
      return a.genome < b.genome ? -1 : 1;
    });

  /*
   * Чемпион — самый многочисленный геном последнего поколения, при равенстве
   * численности решает приспособленность.
   *
   * Соблазнительно было бы взять «лучшего за весь прогон», но это ошибка:
   * приспособленность здесь относительна к своей популяции, и числа из разных
   * поколений несравнимы. В случайной стартовой популяции полно беззащитных
   * геномов, и хищник набирает на них 2.9 — больше, чем кто-либо потом наберёт
   * в популяции, научившейся отвечать. Взяв максимум по всему прогону, мы
   * выбрали бы паразита нулевого поколения и назвали бы его венцом эволюции.
   *
   * Численность такой подмены не допускает: она измеряет ровно то, что делает
   * отбор, — сколько копий генома дожило до конца.
   */
  var champion = survivors[0];

  return {
    seed: o.seed,
    populationSize: o.population,
    generations: o.generations,
    rounds: o.rounds,
    noise: o.noise,
    genomeLength: genomeLib.LENGTH,
    params: {
      tournamentSize: o.tournamentSize,
      crossoverRate: o.crossoverRate,
      mutationRate: o.mutationRate,
      elitism: o.elitism
    },
    history: history,
    champion: {
      genome: champion.genome,
      fitness: champion.fitness,
      copies: champion.count,
      shareOfPopulation: rngLib.round(champion.count / o.population, 4),
      analysis: genomeLib.describe(champion.genome)
    },
    finalPopulation: survivors.slice(0, 12),
    uniqueAtEnd: finalDiv.unique
  };
}

function parseArgs(argv) {
  var out = { seed: 42, population: null, generations: null, write: true };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--population') out.population = Number(argv[++i]);
    else if (a === '--generations') out.generations = Number(argv[++i]);
    else if (a === '--no-write') out.write = false;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('Неизвестный аргумент: ' + a);
  }
  return out;
}

var HELP = [
  'Генетический режим «Арены Сунь-Цзы»',
  '',
  '  node sim/evolve.js --seed 42 [--population 64] [--generations 150] [--no-write]',
  '',
  'Выводит стратегию с памятью на два раунда круговым турниром внутри популяции.',
  'Рукописных стратегий в среде отбора нет — встреча с лигой идёт отдельно.',
  'Результат: results/evolved-<seed>.json и strategies/evolved/nameless.js.'
].join('\n');

function main(argv) {
  var args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message + '\n');
    console.error(HELP);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  var started = Date.now();
  var opts = { seed: args.seed };
  if (args.population) opts.population = args.population;
  if (args.generations) opts.generations = args.generations;
  var data = run(opts);
  var elapsed = Date.now() - started;

  console.log('Генетический режим · сид ' + data.seed + ' · популяция ' + data.populationSize +
    ' · поколений ' + data.generations + ' · геном ' + data.genomeLength + ' локусов');
  console.log('отбор турнирный (' + data.params.tournamentSize + '), кроссовер ' +
    data.params.crossoverRate + ', мутация ' + data.params.mutationRate +
    ', элита ' + data.params.elitism);
  console.log('');

  [0, 1, 2, 5, 10, 25, 50, 75, 100, data.generations - 1].forEach(function (g) {
    if (g >= data.history.length) return;
    var row = data.history[g];
    console.log('  поколение ' + String(row.gen).padStart(3) +
      ': лучший ' + row.best.toFixed(3) +
      ', средний ' + row.mean.toFixed(3) +
      ', худший ' + row.worst.toFixed(3) +
      ', различных геномов ' + String(row.unique).padStart(2));
  });

  var a = data.champion.analysis;
  console.log('');
  console.log('чемпион: ' + data.champion.genome + ' (' + data.champion.copies + ' копий из ' +
    data.populationSize + ', приспособленность ' + data.champion.fitness.toFixed(3) + ')');
  console.log('  первый ход: ' + a.firstMove);
  console.log('  сходство с TitForTat ' + (a.similarity.titForTat * 100).toFixed(0) + '%, ' +
    'с Pavlov ' + (a.similarity.pavlov * 100).toFixed(0) + '%, ' +
    'с AlwaysCooperate ' + (a.similarity.alwaysCooperate * 100).toFixed(0) + '%, ' +
    'с AlwaysDefect ' + (a.similarity.alwaysDefect * 100).toFixed(0) + '%');
  console.log('  черты: ' + Object.keys(a.traits).filter(function (k) {
    return a.traits[k];
  }).join(', '));
  console.log('');
  console.log('за ' + elapsed + ' мс, различных геномов в конце: ' + data.uniqueAtEnd);

  if (args.write) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    var file = path.join(RESULTS_DIR, 'evolved-' + data.seed + '.json');
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('→ ' + path.relative(ROOT, file));
  }
  return data;
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  run: run,
  evaluate: evaluate,
  select: select,
  diversity: diversity,
  parseArgs: parseArgs,
  main: main,
  DEFAULTS: DEFAULTS,
  DOMAIN: DOMAIN
};
