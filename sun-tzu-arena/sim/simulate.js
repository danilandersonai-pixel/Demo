'use strict';

var rngLib = require('../engine/rng');
var registry = require('../strategies');
var tournament = require('./tournament');
var evolution = require('./evolution');
var match = require('../engine/match');

var DEFAULT_GENERATIONS = 30;
var DEFAULT_ROUNDS = 200;
var DEFAULT_NOISE = 0.05;
var DOMINATION = 0.6; // доля популяции, считающаяся доминацией

/** Мягкое сжатие в (−1, 1) без Math.tanh: только деление, значит переносимо. */
function squash(x) {
  return x / (1 + (x < 0 ? -x : x));
}

/**
 * Раскладка поля боя для одного поколения.
 *
 * Фракции с приспособленностью не ниже средней идут в «восходящую» коалицию,
 * остальные — в «закатную». Их сводят попарно, лучший против лучшего из
 * проигрывающих: дорожка 0 — это чемпион против сильнейшего из отстающих.
 * Позиция линии фронта задаётся очной разницей очков в матрице, а не общим
 * рейтингом: дорожка показывает конкретный матч, а не абстрактную силу.
 *
 * Если коалиции разной длины, лишние фракции получают дорожку без противника —
 * они наступают на пустые руины.
 *
 * @returns {{lanes: object[], intensity: number}}
 */
function buildBattle(matrix, shares, sharesAfter, fitness, avgFitness, ids) {
  var alive = [];
  for (var i = 0; i < shares.length; i++) {
    if (shares[i] > 0) alive.push(i);
  }
  alive.sort(function (a, b) {
    if (fitness[b] !== fitness[a]) return fitness[b] - fitness[a];
    return a - b; // устойчивая сортировка при равных очках
  });

  var ascendant = [];
  var declining = [];
  alive.forEach(function (idx) {
    if (fitness[idx] >= avgFitness) ascendant.push(idx);
    else declining.push(idx);
  });

  var laneCount = Math.max(ascendant.length, declining.length);
  var lanes = [];
  var intensity = 0;

  for (var k = 0; k < laneCount; k++) {
    var left = k < ascendant.length ? ascendant[k] : -1;
    var right = k < declining.length ? declining[k] : -1;

    var scoreLeft = left >= 0 && right >= 0 ? matrix[left][right] : 0;
    var scoreRight = left >= 0 && right >= 0 ? matrix[right][left] : 0;

    var front;
    if (left < 0) front = 0.12;
    else if (right < 0) front = 0.88;
    else front = 0.5 + 0.4 * squash((scoreLeft - scoreRight) / 1.5);

    var damageLeft = left >= 0 && shares[left] > 0
      ? Math.max(0, (shares[left] - sharesAfter[left]) / shares[left])
      : 0;
    var damageRight = right >= 0 && shares[right] > 0
      ? Math.max(0, (shares[right] - sharesAfter[right]) / shares[right])
      : 0;
    intensity += damageLeft + damageRight;

    lanes.push({
      left: left >= 0 ? ids[left] : null,
      right: right >= 0 ? ids[right] : null,
      leftIndex: left,
      rightIndex: right,
      front: rngLib.round(front, 4),
      scoreLeft: rngLib.round(scoreLeft, 3),
      scoreRight: rngLib.round(scoreRight, 3),
      winner: left < 0 ? (right >= 0 ? ids[right] : null)
        : right < 0 ? ids[left]
          : scoreLeft > scoreRight ? ids[left]
            : scoreRight > scoreLeft ? ids[right] : null,
      damageLeft: rngLib.round(damageLeft, 4),
      damageRight: rngLib.round(damageRight, 4)
    });
  }

  return {
    lanes: lanes,
    intensity: rngLib.round(Math.min(1, intensity / Math.max(1, laneCount)), 4)
  };
}

/**
 * Полный прогон: тридцать поколений турнира и эволюции.
 *
 * @param {object} [opts]
 * @param {number} [opts.seed=42]
 * @param {number} [opts.generations=30]
 * @param {number} [opts.rounds=200]
 * @param {number} [opts.noise=0.05]
 * @param {object[]} [opts.strategies] набор стратегий (по умолчанию — реестр лиги)
 * @param {number[]} [opts.initialShares] начальные доли (по умолчанию равные)
 * @returns {object} прогон в формате ARENA_DATA.runs[]
 */
function run(opts) {
  var o = opts || {};
  var defs = o.strategies || registry.list;
  var seed = typeof o.seed === 'number' ? o.seed : 42;
  var generations = typeof o.generations === 'number' ? o.generations : DEFAULT_GENERATIONS;
  var rounds = typeof o.rounds === 'number' ? o.rounds : DEFAULT_ROUNDS;
  var noise = typeof o.noise === 'number' ? o.noise : DEFAULT_NOISE;

  var n = defs.length;
  var ids = defs.map(function (d) {
    return d.id;
  });

  var shares = o.initialShares ? o.initialShares.slice() : evolution.uniform(n);
  var peak = shares.slice();
  var frames = [];
  var totalMatches = 0;
  var extinctionOrder = [];
  var victory = null;

  for (var gen = 0; gen < generations; gen++) {
    var rr = tournament.roundRobin(defs, {
      seed: seed,
      generation: gen,
      rounds: rounds,
      noise: noise
    });
    totalMatches += rr.matches;

    var fitness = tournament.fitnessVector(rr.matrix, shares);
    var coop = tournament.coopVector(rr.coop, shares);
    var stepResult = evolution.step(shares, fitness, {});
    var sharesAfter = stepResult.shares;

    var i;
    for (i = 0; i < n; i++) {
      if (sharesAfter[i] > peak[i]) peak[i] = sharesAfter[i];
    }

    var hp = new Array(n);
    for (i = 0; i < n; i++) {
      hp[i] = peak[i] > 0 ? rngLib.round(Math.min(1, sharesAfter[i] / peak[i]), 4) : 0;
    }

    stepResult.extinct.forEach(function (idx) {
      extinctionOrder.push({ id: ids[idx], gen: gen });
    });

    var battle = buildBattle(rr.matrix, shares, sharesAfter, fitness, stepResult.avgFitness, ids);

    var aliveAfter = 0;
    var leaderIdx = 0;
    for (i = 0; i < n; i++) {
      if (sharesAfter[i] > 0) aliveAfter += 1;
      if (sharesAfter[i] > sharesAfter[leaderIdx]) leaderIdx = i;
    }

    if (!victory) {
      if (sharesAfter[leaderIdx] >= DOMINATION) {
        victory = { type: 'domination', id: ids[leaderIdx], gen: gen };
      } else if (aliveAfter === 1) {
        victory = { type: 'extinction', id: ids[leaderIdx], gen: gen };
      }
    }

    frames.push({
      gen: gen,
      shares: shares.map(function (v) {
        return rngLib.round(v, 6);
      }),
      sharesAfter: sharesAfter.map(function (v) {
        return rngLib.round(v, 6);
      }),
      fitness: fitness.map(function (v) {
        return rngLib.round(v, 4);
      }),
      coop: coop.map(function (v) {
        return rngLib.round(v, 4);
      }),
      hp: hp,
      avgFitness: rngLib.round(stepResult.avgFitness, 4),
      alive: aliveAfter,
      extinct: stepResult.extinct.map(function (idx) {
        return ids[idx];
      }),
      leader: ids[leaderIdx],
      matrix: rr.matrix.map(function (row) {
        return row.map(function (v) {
          return rngLib.round(v, 3);
        });
      }),
      battle: battle
    });

    shares = sharesAfter;
  }

  /*
   * Дуэли последнего поколения: полные ленты ходов каждой пары.
   *
   * Нужны инспектору дуэлей в визуализаторе — покадровому реплею конкретного
   * матча. Переигрываются с теми же сидами, что и в турнире последнего
   * поколения, поэтому лента описывает ровно тот матч, который вошёл
   * в итоговую матрицу, а не похожий на него.
   *
   * Берётся одно поколение, а не все тридцать: тридцати поколений хватило бы
   * на пятнадцать мегабайт реплея ради данных, которые смотрят по одной паре
   * за раз.
   */
  var duelGen = generations - 1;
  var duels = [];
  for (var di = 0; di < n; di++) {
    for (var dj = di; dj < n; dj++) {
      var duel = match.playMatch(defs[di], defs[dj], {
        rounds: rounds,
        noise: noise,
        seed: rngLib.hashSeed(tournament.DOMAIN, seed, duelGen, di, dj),
        log: true
      });
      duels.push({
        a: ids[di],
        b: ids[dj],
        avgA: duel.avgA,
        avgB: duel.avgB,
        movesA: duel.log.map(function (x) { return x.a; }).join(''),
        movesB: duel.log.map(function (x) { return x.b; }).join(''),
        intendedA: duel.log.map(function (x) { return x.intendedA; }).join(''),
        intendedB: duel.log.map(function (x) { return x.intendedB; }).join('')
      });
    }
  }

  var last = frames[frames.length - 1];
  var finalOrder = ids
    .map(function (id, idx) {
      return { id: id, share: last.sharesAfter[idx], fitness: last.fitness[idx] };
    })
    .sort(function (a, b) {
      if (b.share !== a.share) return b.share - a.share;
      return b.fitness - a.fitness;
    });

  var outcome = victory
    ? { type: victory.type, id: victory.id, gen: victory.gen }
    : { type: 'coexistence', id: finalOrder[0].id, gen: generations - 1 };

  return {
    seed: seed,
    noise: noise,
    rounds: rounds,
    generations: generations,
    dominationThreshold: DOMINATION,
    extinctionThreshold: evolution.EXTINCTION_THRESHOLD,
    strategyIds: ids,
    frames: frames,
    outcome: outcome,
    standings: finalOrder,
    extinctions: extinctionOrder,
    duelGeneration: duelGen,
    duels: duels,
    totalMatches: totalMatches
  };
}

module.exports = {
  run: run,
  buildBattle: buildBattle,
  squash: squash,
  DEFAULT_GENERATIONS: DEFAULT_GENERATIONS,
  DEFAULT_ROUNDS: DEFAULT_ROUNDS,
  DEFAULT_NOISE: DEFAULT_NOISE,
  DOMINATION: DOMINATION
};
