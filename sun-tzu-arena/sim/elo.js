'use strict';

/**
 * Рейтинг Эло по всем матчам всех режимов.
 *
 *   node sim/elo.js --seed 42
 *
 * Все прочие таблицы проекта отвечают на вопрос «кто размножится». Эта
 * отвечает на другой: «кто кого бьёт в очной ставке». Вопросы разные, и ответы
 * тоже — в этом и смысл считать рейтинг отдельно. Стратегия может выигрывать
 * почти каждую дуэль и при этом вымирать: она обыгрывает соперника, забирая у
 * него больше, чем берёт сама, а размножается тот, кто набирает много очков,
 * а не тот, кто оставляет сопернику мало. «Зеркало» не выигрывает ни одной
 * очной пары по определению — и побеждает турниры.
 *
 * ЧТО СЧИТАЕТСЯ МАТЧЕМ. Каждая сыгранная встреча пары в любом режиме:
 *
 *   лига          3 сида × 30 поколений × 136 пар
 *   претенденты   2 круга × 30 поколений × 10 пар
 *   территория    24 поколения, только пары, действительно оказавшиеся рядом
 *   стенд         24 мира × 20 поколений × 136 пар
 *
 * Матч с собственной копией в рейтинг не идёт: его исход всегда ничья по
 * построению, он не несёт сведений о силе и только разбавляет выборку.
 *
 * ЧЕГО В РЕЙТИНГЕ НЕТ — и почему. Генетический прогон исключён. Его матчи
 * идут между безымянными хромосомами, которые существуют только внутри своего
 * прогона и больше не играют ни с кем. Эло — рейтинг одного пула игроков друг
 * против друга; подмешать в него шестьдесят четыре одноразовых участника
 * значит сдвинуть оценки тем, кому просто повезло с составом собственного
 * поколения. «Безымянный» при этом в рейтинге есть — он играет в лиге,
 * на территории и на стенде наравне со всеми.
 *
 * ИСХОД МАТЧА — двоичный: победа тому, кто взял больше очков за раунд, ничья
 * при равенстве. Мысль перевести перевес в дробный результат отвергнута: тогда
 * величина зависела бы от матрицы выплат, а на стенде их две, и рейтинги из
 * разных миров перестали бы складываться.
 *
 * ПОРЯДОК ОБРАБОТКИ фиксирован (режим, сид, поколение, i, j) и является частью
 * протокола детерминизма: рейтинг Эло зависит от порядка встреч, и без
 * фиксации порядка одни и те же данные давали бы разные числа.
 */

var fs = require('fs');
var path = require('path');

var registry = require('../strategies');
var rngLib = require('../engine/rng');
var tournament = require('./tournament');
var spatial = require('./spatial');
var sweep = require('./sweep');

var ROOT = path.join(__dirname, '..');
var RESULTS_DIR = path.join(ROOT, 'results');

var BASE = 1500;
/**
 * Коэффициент K. Партий у каждого много — только в лиге по 1530 на стратегию, —
 * поэтому большой K не нужен: он раскачивал бы рейтинг на шуме, а сходимость и
 * так обеспечена объёмом. Шахматная классика для игроков с большим числом
 * партий — 10..16; взято 16, чтобы рейтинг успевал реагировать на разницу
 * условий между режимами, но не прыгал от отдельного матча.
 */
var K = 16;

var LEAGUE_SEEDS = [7, 42, 2026];

/** Ожидаемый результат A против B по разнице рейтингов. */
function expected(ra, rb) {
  // Классическая логистика Эло с шагом 400. Math.pow здесь допустим: он не
  // участвует в игровой механике, только в аналитике поверх готовых исходов,
  // и на воспроизводимость прогонов не влияет.
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/**
 * Накопитель рейтинга. Держит текущие оценки, счёт побед и очную статистику.
 */
function createTable(ids) {
  var rating = {};
  var stat = {};
  var head = {};
  ids.forEach(function (id) {
    rating[id] = BASE;
    stat[id] = { id: id, games: 0, wins: 0, draws: 0, losses: 0, peak: BASE, low: BASE, byMode: {} };
    head[id] = {};
  });

  function ensureMode(id, mode) {
    var s = stat[id].byMode;
    if (!s[mode]) s[mode] = { games: 0, wins: 0, draws: 0, losses: 0, delta: 0 };
    return s[mode];
  }

  function ensureHead(a, b) {
    if (!head[a][b]) head[a][b] = { wins: 0, draws: 0, losses: 0 };
    return head[a][b];
  }

  return {
    rating: rating,
    stat: stat,
    head: head,
    /**
     * Один матч. `scoreA`/`scoreB` — средние очки за раунд; сравниваются
     * напрямую, потому что раундов у обоих поровну.
     */
    record: function (a, b, scoreA, scoreB, mode) {
      if (a === b) return;           // матч с собственной копией — всегда ничья
      var ra = rating[a];
      var rb = rating[b];
      var outcome = scoreA > scoreB ? 1 : (scoreA < scoreB ? 0 : 0.5);
      var deltaA = K * (outcome - expected(ra, rb));

      // Симметрично: сколько один приобрёл, столько другой потерял. Сумма
      // рейтингов пула поэтому постоянна, и «инфляции» быть не может.
      rating[a] = ra + deltaA;
      rating[b] = rb - deltaA;

      var sa = stat[a];
      var sb = stat[b];
      sa.games += 1;
      sb.games += 1;
      var ma = ensureMode(a, mode);
      var mb = ensureMode(b, mode);
      ma.games += 1;
      mb.games += 1;
      ma.delta += deltaA;
      mb.delta -= deltaA;

      var ha = ensureHead(a, b);
      var hb = ensureHead(b, a);
      if (outcome === 1) {
        sa.wins += 1; sb.losses += 1; ma.wins += 1; mb.losses += 1; ha.wins += 1; hb.losses += 1;
      } else if (outcome === 0) {
        sa.losses += 1; sb.wins += 1; ma.losses += 1; mb.wins += 1; ha.losses += 1; hb.wins += 1;
      } else {
        sa.draws += 1; sb.draws += 1; ma.draws += 1; mb.draws += 1; ha.draws += 1; hb.draws += 1;
      }

      if (rating[a] > sa.peak) sa.peak = rating[a];
      if (rating[a] < sa.low) sa.low = rating[a];
      if (rating[b] > sb.peak) sb.peak = rating[b];
      if (rating[b] < sb.low) sb.low = rating[b];
    }
  };
}

/**
 * Прогнать все режимы, скармливая каждую встречу накопителю.
 *
 * Матчи не читаются из `results/`, а переигрываются самими режимами через хук
 * `onMatch`. Так сиды выводит тот же код, что и в обычном прогоне, — второй
 * реализации вывода сидов, которая рано или поздно разойдётся с первой,
 * здесь нет.
 */
function collect(opts) {
  var o = opts || {};
  var defs = o.strategies || registry.list;
  var ids = defs.map(function (d) { return d.id; });
  var table = createTable(ids);
  var modes = [];
  var progress = o.progress || function () {};

  /* ---- Лига: три эталонных сида ---- */
  var leagueGames = 0;
  var seeds = o.seeds || LEAGUE_SEEDS;
  seeds.forEach(function (seed) {
    for (var gen = 0; gen < (o.generations || 30); gen++) {
      tournament.roundRobin(defs, {
        seed: seed,
        generation: gen,
        rounds: o.rounds || 200,
        noise: o.noise === undefined ? 0.05 : o.noise,
        onMatch: function (i, j, avgA, avgB) {
          if (i === j) return;
          table.record(ids[i], ids[j], avgA, avgB, 'league');
          leagueGames += 1;
        }
      });
    }
    progress('лига, сид ' + seed);
  });
  modes.push({ id: 'league', label: 'Лига', games: leagueGames });

  /* ---- Претенденты: два круга закрытого турнира ----
     Единственное место, где матчи читаются из записи, а не переигрываются.
     Причина в том, что переиграть круг 1 нечем: претенденты после него были
     доработаны, старого кода в репозитории нет, и `build({round: 1})` сегодня
     выдал бы числа круга 2 под ярлыком круга 1. Запись же описывает ровно те
     матчи, которые были сыграны, — она и есть здесь источник истины. */
  var chGames = 0;
  [1, 2].forEach(function (round) {
    var file = path.join(RESULTS_DIR, 'challengers-round' + round + '.json');
    if (!fs.existsSync(file)) return;
    var chData = JSON.parse(fs.readFileSync(file, 'utf8'));
    var chIds = chData.participants;
    // Круг учитывается только целиком. Если рейтинг считается по части лиги
    // (тесты, `--league core`), кого-то из участников закрытого турнира в пуле
    // нет, и записать его матчи некуда: половина круга исказила бы рейтинг
    // остальных сильнее, чем его отсутствие.
    var known = chIds.every(function (id) { return ids.indexOf(id) >= 0; });
    if (!known) return;
    chData.evolution.frames.forEach(function (frame) {
      for (var i = 0; i < chIds.length; i++) {
        for (var j = i + 1; j < chIds.length; j++) {
          table.record(chIds[i], chIds[j], frame.matrix[i][j], frame.matrix[j][i], 'challengers');
          chGames += 1;
        }
      }
    });
    progress('претенденты, круг ' + round);
  });
  modes.push({ id: 'challengers', label: 'Претенденты', games: chGames });

  /* ---- Территория ---- */
  var spGames = 0;
  spatial.run({
    seed: o.spatialSeed === undefined ? 42 : o.spatialSeed,
    strategies: defs,
    onMatch: function (i, j, avgA, avgB) {
      if (i === j) return;
      table.record(ids[i], ids[j], avgA, avgB, 'spatial');
      spGames += 1;
    }
  });
  progress('территория');
  modes.push({ id: 'spatial', label: 'Территория', games: spGames });

  /* ---- Стенд устойчивости: 24 мира ---- */
  var swGames = 0;
  if (o.withSweep !== false) {
    sweep.run({
      seed: o.seed === undefined ? 42 : o.seed,
      strategies: defs,
      generations: o.sweepGenerations,
      onMatch: function (i, j, avgA, avgB) {
        if (i === j) return;
        table.record(ids[i], ids[j], avgA, avgB, 'sweep');
        swGames += 1;
      }
    });
    progress('стенд устойчивости');
    modes.push({ id: 'sweep', label: 'Стенд', games: swGames });
  }

  return { table: table, ids: ids, modes: modes };
}

/** Свод: рейтинг, очная статистика, зал славы. */
function summarize(collected, opts) {
  var o = opts || {};
  var table = collected.table;
  var ids = collected.ids;

  var ranking = ids.map(function (id) {
    var s = table.stat[id];
    var byMode = {};
    Object.keys(s.byMode).forEach(function (mode) {
      var m = s.byMode[mode];
      byMode[mode] = {
        games: m.games,
        wins: m.wins,
        draws: m.draws,
        losses: m.losses,
        delta: rngLib.round(m.delta, 1)
      };
    });
    return {
      id: id,
      rating: rngLib.round(table.rating[id], 1),
      peak: rngLib.round(s.peak, 1),
      low: rngLib.round(s.low, 1),
      games: s.games,
      wins: s.wins,
      draws: s.draws,
      losses: s.losses,
      winRate: s.games ? rngLib.round((s.wins + s.draws / 2) / s.games, 4) : 0,
      byMode: byMode
    };
  }).sort(function (a, b) {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return a.id < b.id ? -1 : 1;
  });

  /* Очная сетка: доля побед a над b (ничья — половина). */
  var headToHead = ids.map(function (a) {
    return ids.map(function (b) {
      if (a === b) return null;
      var h = table.head[a][b];
      if (!h) return null;
      var total = h.wins + h.draws + h.losses;
      return total ? rngLib.round((h.wins + h.draws / 2) / total, 3) : null;
    });
  });

  /* ---- Зал славы ----
     Разряды подобраны так, чтобы отвечать на РАЗНЫЕ вопросы, а не на один и
     тот же с разных сторон. Первая версия давала «высший рейтинг», «чаще всех
     берёт верх» и «реже всех проигрывает» — три награды одному и тому же
     Агрессору, потому что все три меряли одно. Осталось по одному разряду на
     каждый настоящий вопрос: кто сильнее в очной ставке, кто сильнее в
     размножении, кто умеет не проигрывать, где чья земля. */
  var evoOrder = o.evolutionOrder || [];
  var records = [];
  var byId = {};
  ranking.forEach(function (row, i) { byId[row.id] = { row: row, place: i + 1 }; });

  records.push({
    key: 'rating',
    title: 'Высший рейтинг',
    id: ranking[0].id,
    value: ranking[0].rating,
    unit: '',
    note: 'по ' + ranking[0].games + ' матчам: ' + ranking[0].wins + ' побед, ' +
      ranking[0].draws + ' ничьих, ' + ranking[0].losses + ' поражений'
  });

  if (evoOrder.length && byId[evoOrder[0]]) {
    var champ = byId[evoOrder[0]];
    records.push({
      key: 'evolution',
      title: 'Чемпион эволюции',
      id: evoOrder[0],
      value: champ.place,
      unit: '-й',
      note: 'выиграл лигу, а в очной ставке всего ' + champ.place + '-й из ' +
        ranking.length + ' при рейтинге ' + champ.row.rating
    });
  }

  var byDraws = ranking.slice().sort(function (a, b) { return b.draws / b.games - a.draws / a.games; });
  records.push({
    key: 'draws',
    title: 'Чаще всех сводит вничью',
    id: byDraws[0].id,
    value: rngLib.round((byDraws[0].draws / byDraws[0].games) * 100, 1),
    unit: '%',
    note: 'столько его матчей закончились поровну — ни один не взял верх'
  });

  /* Непобеждённые пары: кому стратегия не проиграла ни одного матча. */
  var unbeaten = ranking.map(function (row) {
    var over = [];
    ids.forEach(function (b) {
      if (b === row.id) return;
      var h = table.head[row.id][b];
      if (h && h.losses === 0 && h.wins > 0) over.push(b);
    });
    return { id: row.id, over: over };
  }).sort(function (a, b) { return b.over.length - a.over.length; });
  if (unbeaten[0] && unbeaten[0].over.length) {
    records.push({
      key: 'unbeaten',
      title: 'Ни разу не проиграл',
      id: unbeaten[0].id,
      value: unbeaten[0].over.length,
      unit: '',
      note: 'столько соперников не отобрали у него ни одного матча из всех сыгранных'
    });
  }

  /* Где чья земля: кто больше всех набрал рейтинга именно в этом режиме. */
  [
    { mode: 'spatial', title: 'Хозяин территории' },
    { mode: 'sweep', title: 'Хозяин стенда' },
    { mode: 'challengers', title: 'Герой войны претендентов' }
  ].forEach(function (kind) {
    var best = null;
    ranking.forEach(function (row) {
      var m = row.byMode[kind.mode];
      if (!m || !m.games) return;
      if (!best || m.delta > best.delta) best = { id: row.id, delta: m.delta, games: m.games };
    });
    if (!best) return;
    records.push({
      key: kind.mode,
      title: kind.title,
      id: best.id,
      value: '+' + Math.round(best.delta),
      unit: '',
      note: 'столько рейтинга он набрал именно здесь, за ' + best.games + ' матчей'
    });
  });

  /* Самый большой разрыв между рейтингом и местом в эволюции: главный сюжет. */
  var gap = null;
  if (evoOrder.length) {
    ranking.forEach(function (row, i) {
      var e = evoOrder.indexOf(row.id);
      if (e < 0) return;
      var d = e - i;   // высоко в Эло, низко в эволюции
      if (!gap || Math.abs(d) > Math.abs(gap.d)) gap = { id: row.id, d: d, elo: i + 1, evo: e + 1 };
    });
  }

  return {
    base: BASE,
    k: K,
    modes: collected.modes,
    games: collected.modes.reduce(function (a, m) { return a + m.games; }, 0),
    strategyIds: ids,
    ranking: ranking,
    headToHead: headToHead,
    records: records,
    unbeaten: unbeaten.filter(function (r) { return r.over.length > 0; }),
    gap: gap
  };
}

function run(opts) {
  var o = opts || {};
  return summarize(collect(o), o);
}

/* ------------------------------------------------------------------ CLI */

function parseArgs(argv) {
  var out = { seed: 42, write: true };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--no-sweep') out.withSweep = false;
    else if (a === '--no-write') out.write = false;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('Неизвестный аргумент: ' + a);
  }
  return out;
}

var HELP = [
  'Рейтинг Эло «Арены Сунь-Цзы»',
  '',
  '  node sim/elo.js [--seed 42] [--no-sweep] [--no-write]',
  '',
  'Переигрывает матчи всех режимов — лига на трёх сидах, два круга',
  'претендентов, территория, 24 мира стенда — и считает рейтинг очной',
  'ставки. Результат: results/elo.json. Полный прогон занимает около',
  'двух минут: 24 мира стенда дают больше половины этого времени,',
  'и --no-sweep их пропускает.'
].join('\n');

function main(argv) {
  var args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message + '\n' + HELP);
    process.exit(1);
    return;
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  console.log('Считаю рейтинг по всем режимам. Это небыстро.');
  var evoOrder = null;
  var latest = path.join(RESULTS_DIR, '42.json');
  if (fs.existsSync(latest)) {
    evoOrder = JSON.parse(fs.readFileSync(latest, 'utf8')).standings.map(function (s) { return s.id; });
  }

  var data = run({
    seed: args.seed,
    withSweep: args.withSweep,
    evolutionOrder: evoOrder,
    progress: function (what) { console.log('  · ' + what); }
  });

  console.log('\nМатчей учтено: ' + data.games);
  data.modes.forEach(function (m) {
    console.log('  ' + m.label.padEnd(14) + String(m.games).padStart(7));
  });
  console.log('\n  #  стратегия            Эло    партий   П/Н/Пр');
  data.ranking.forEach(function (row, i) {
    var def = registry.byId(row.id);
    console.log(
      String(i + 1).padStart(3) + '  ' +
      (def ? def.name : row.id).padEnd(20) +
      String(row.rating).padStart(7) +
      String(row.games).padStart(9) + '   ' +
      row.wins + '/' + row.draws + '/' + row.losses
    );
  });
  if (data.gap) {
    console.log('\nСамый большой разрыв с эволюцией: ' + registry.byId(data.gap.id).name +
      ' — ' + data.gap.elo + '-й по Эло, ' + data.gap.evo + '-й по эволюции.');
  }

  if (args.write) {
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
    var file = path.join(RESULTS_DIR, 'elo.json');
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('\nЗаписано: results/elo.json');
    console.log('Чтобы рейтинг попал в визуализатор — node sim/run.js --all');
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  run: run,
  collect: collect,
  summarize: summarize,
  createTable: createTable,
  expected: expected,
  BASE: BASE,
  K: K
};
