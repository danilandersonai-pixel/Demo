'use strict';

var rngLib = require('../engine/rng');
var match = require('../engine/match');
var registry = require('../strategies');

var DOMAIN = 0x53505441; // 'SPTA'
var SIZE = 20;
var GENERATIONS = 24;
var ROUNDS = 80;

/**
 * Пространственный режим: сетка SIZE×SIZE, каждая клетка — агент со своей
 * стратегией. Каждое поколение клетка играет с четырьмя соседями по
 * фон-Неймановской окрестности (тор — края замкнуты, чтобы у углов не было
 * преимущества), суммирует очки и перенимает стратегию лучшего в округе,
 * включая себя.
 *
 * Соотношение с основной лигой: там доля стратегии в популяции — число, здесь
 * это территория. Разница принципиальна. В хорошо перемешанной популяции
 * агрессор встречает всех одинаково часто; на сетке он окружён собственными
 * копиями и вынужден жить на P=1, тогда как кооператоры внутри своего кластера
 * живут на R=3. Пространство защищает сотрудничество границей — это самый
 * наглядный вывод режима.
 *
 * Два инженерных решения:
 *
 *   — Матч пары кэшируется на поколение. Исход зависит только от того, какие
 *     две стратегии встретились, а не от того, в каких клетках они сидят;
 *     без кэша каждое поколение играло бы 800 матчей вместо 78, давая ту же
 *     картину в десять раз медленнее. Побочный эффект полезен: одинаковые
 *     границы ведут себя одинаково, и фронты выглядят чисто.
 *   — Матч короче, чем в лиге (80 раундов против 200. Поколений 24 против 30):
 *     на сетке важна не тонкая настройка стратегий друг под друга, а скорость
 *     распространения территории.
 *
 * Необязательный `opts.onMatch(i, j, avgA, avgB, gen)` вызывается на каждый
 * действительно сыгранный матч — то есть один раз на пару за поколение, после
 * кэша. Соседство на сетке неполное: пары, ни разу не оказавшиеся рядом,
 * не играют вовсе, и рейтинг не должен считать их сыгранными.
 *
 * @param {object} [opts] {seed, size, generations, rounds, noise, strategies, onMatch}
 * @returns {object} данные для вкладки «Территория» визуализатора
 */
function run(opts) {
  var o = opts || {};
  var defs = o.strategies || registry.list;
  var seed = typeof o.seed === 'number' ? o.seed : 42;
  var size = typeof o.size === 'number' ? o.size : SIZE;
  var generations = typeof o.generations === 'number' ? o.generations : GENERATIONS;
  var rounds = typeof o.rounds === 'number' ? o.rounds : ROUNDS;
  var noise = typeof o.noise === 'number' ? o.noise : match.DEFAULT_NOISE;

  var n = defs.length;
  var cells = size * size;
  var ids = defs.map(function (d) {
    return d.id;
  });

  // Начальная расстановка: равномерно случайная по сидированному ГПСЧ.
  var rnd = rngLib.mulberry32(rngLib.hashSeed(DOMAIN, seed, 0));
  var grid = new Array(cells);
  for (var c = 0; c < cells; c++) {
    grid[c] = Math.floor(rnd() * n) % n;
  }

  var frames = [];

  for (var gen = 0; gen < generations; gen++) {
    // Кэш очков пары на это поколение: pairScore[i][j] — очки i против j.
    var pair = [];
    for (var i = 0; i < n; i++) pair.push(new Array(n).fill(null));

    function scoreOf(a, b) {
      if (pair[a][b] === null) {
        var lo = Math.min(a, b);
        var hi = Math.max(a, b);
        var r = match.playMatch(defs[lo], defs[hi], {
          rounds: rounds,
          noise: noise,
          seed: rngLib.hashSeed(DOMAIN, seed, gen, lo, hi)
        });
        pair[lo][hi] = r.avgA;
        pair[hi][lo] = r.avgB;
        if (o.onMatch) o.onMatch(lo, hi, r.avgA, r.avgB, gen);
      }
      return pair[a][b];
    }

    // Очки каждой клетки против четырёх соседей.
    var scores = new Array(cells);
    var x;
    var y;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        var idx = y * size + x;
        var me = grid[idx];
        var total = 0;
        total += scoreOf(me, grid[((y - 1 + size) % size) * size + x]);
        total += scoreOf(me, grid[y * size + ((x + 1) % size)]);
        total += scoreOf(me, grid[((y + 1) % size) * size + x]);
        total += scoreOf(me, grid[y * size + ((x - 1 + size) % size)]);
        scores[idx] = total;
      }
    }

    // Перенимание: лучший в окрестности, при равенстве очков — инерция.
    var next = new Array(cells);
    var flips = 0;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        var here = y * size + x;
        var bestIdx = here;
        var bestScore = scores[here];
        var neighbours = [
          ((y - 1 + size) % size) * size + x,
          y * size + ((x + 1) % size),
          ((y + 1) % size) * size + x,
          y * size + ((x - 1 + size) % size)
        ];
        for (var k = 0; k < 4; k++) {
          if (scores[neighbours[k]] > bestScore) {
            bestScore = scores[neighbours[k]];
            bestIdx = neighbours[k];
          }
        }
        next[here] = grid[bestIdx];
        if (next[here] !== grid[here]) flips += 1;
      }
    }

    var counts = new Array(n).fill(0);
    for (var q = 0; q < cells; q++) counts[grid[q]] += 1;

    frames.push({
      gen: gen,
      grid: grid.slice(),
      counts: counts,
      flips: flips,
      meanScore: rngLib.round(
        scores.reduce(function (a, b) {
          return a + b;
        }, 0) / (cells * 4),
        4
      )
    });

    grid = next;
  }

  // Финальный кадр — состояние после последнего перенимания.
  var finalCounts = new Array(n).fill(0);
  for (var f = 0; f < cells; f++) finalCounts[grid[f]] += 1;
  frames.push({ gen: generations, grid: grid.slice(), counts: finalCounts, flips: 0, meanScore: 0 });

  var order = ids
    .map(function (id, idx) {
      return { id: id, cells: finalCounts[idx] };
    })
    .sort(function (a, b) {
      if (b.cells !== a.cells) return b.cells - a.cells;
      return a.id < b.id ? -1 : 1;
    });

  return {
    seed: seed,
    size: size,
    generations: generations,
    rounds: rounds,
    noise: noise,
    strategyIds: ids,
    frames: frames,
    standings: order
  };
}

module.exports = { run: run, SIZE: SIZE, GENERATIONS: GENERATIONS, ROUNDS: ROUNDS, DOMAIN: DOMAIN };
