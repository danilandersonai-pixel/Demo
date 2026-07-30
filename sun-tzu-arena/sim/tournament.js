'use strict';

var rngLib = require('../engine/rng');
var match = require('../engine/match');

/** Метка домена в сиде, чтобы матчи турнира не совпали ни с какой другой выборкой. */
var DOMAIN = 0x54524e4d; // 'TRNM'

/**
 * Круговой турнир: каждый с каждым, включая матч с собственной копией.
 *
 * Сид каждого матча выводится из (seed, generation, i, j) и не зависит от
 * порядка перебора: результат конкретной пары одинаков, сколько бы матчей ни
 * было отыграно до него. Это делает турнир пересчитываемым по частям и
 * устраняет самый частый источник «плавающего» детерминизма.
 *
 * Каждое поколение играется заново с новым сидом — популяция не наследует
 * прошлые матчи. Иначе тридцать поколений отличались бы только весами
 * при одной и той же неизменной матрице, и вся драма сводилась бы к
 * арифметике; с перерозыгрышем у каждого поколения свой шум и свои случайные
 * стратегии, и линия фронта живёт.
 *
 * @param {object[]} defs определения стратегий (порядок фиксирован реестром)
 * @param {object} opts {seed, generation, rounds, noise}
 * @returns {{matrix: number[][], coop: number[][], matches: number}}
 */
function roundRobin(defs, opts) {
  var n = defs.length;
  var seed = opts.seed;
  var generation = opts.generation | 0;
  var rounds = opts.rounds;
  var noise = opts.noise;

  var matrix = [];
  var coop = [];
  var i;
  var j;
  for (i = 0; i < n; i++) {
    matrix.push(new Array(n).fill(0));
    coop.push(new Array(n).fill(0));
  }

  var played = 0;
  for (i = 0; i < n; i++) {
    for (j = i; j < n; j++) {
      var r = match.playMatch(defs[i], defs[j], {
        rounds: rounds,
        noise: noise,
        payoff: opts.payoff,
        seed: rngLib.hashSeed(DOMAIN, seed, generation, i, j)
      });
      matrix[i][j] = r.avgA;
      matrix[j][i] = r.avgB;
      coop[i][j] = r.coopA;
      coop[j][i] = r.coopB;
      played += 1;
    }
  }

  return { matrix: matrix, coop: coop, matches: played };
}

/**
 * Приспособленность стратегии в популяции: средние очки за раунд против
 * случайно встреченного соперника, взвешенно по долям.
 *
 *   f_i = Σ_j  share_j · matrix[i][j]
 *
 * Матч с собственной копией входит с весом собственной доли — это существенно:
 * именно он не даёт «Агрессору» захватить арену и ставит потолок «Соглядатаю».
 *
 * @param {number[][]} matrix
 * @param {number[]} shares
 * @returns {number[]}
 */
function fitnessVector(matrix, shares) {
  var n = shares.length;
  var out = new Array(n).fill(0);
  for (var i = 0; i < n; i++) {
    var acc = 0;
    for (var j = 0; j < n; j++) {
      if (shares[j] > 0) acc += shares[j] * matrix[i][j];
    }
    out[i] = acc;
  }
  return out;
}

/** Взвешенная по долям доля сотрудничества каждой стратегии за поколение. */
function coopVector(coop, shares) {
  var n = shares.length;
  var out = new Array(n).fill(0);
  for (var i = 0; i < n; i++) {
    var acc = 0;
    var weight = 0;
    for (var j = 0; j < n; j++) {
      if (shares[j] > 0) {
        acc += shares[j] * coop[i][j];
        weight += shares[j];
      }
    }
    out[i] = weight > 0 ? acc / weight : 0;
  }
  return out;
}

module.exports = {
  roundRobin: roundRobin,
  fitnessVector: fitnessVector,
  coopVector: coopVector,
  DOMAIN: DOMAIN
};
