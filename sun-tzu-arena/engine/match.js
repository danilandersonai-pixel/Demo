'use strict';

var rngLib = require('./rng');
var payoff = require('./payoff');
var historyLib = require('./history');

var C = payoff.COOPERATE;
var D = payoff.DEFECT;

var DEFAULT_ROUNDS = 200;
var DEFAULT_NOISE = 0.05;

/**
 * Один матч: две стратегии играют `rounds` раундов повторяющейся дилеммы.
 *
 * Шум: с вероятностью `noise` ход игрока искажается на противоположный уже
 * «в канале» — то есть исполняется и наблюдается обеими сторонами (и самим
 * игроком тоже) именно искажённый ход. Это модель ошибки исполнения приказа:
 * полководец не знает, что гонец перепутал сигнал, пока не увидит последствий.
 * Броски шума для двух игроков независимы.
 *
 * Длина матча стратегиям не сообщается: в истории есть только сыгранные
 * раунды, никакого «сколько осталось».
 *
 * @param {object} defA определение стратегии A (см. strategies/index.js)
 * @param {object} defB определение стратегии B
 * @param {object} [opts]
 * @param {number} [opts.rounds=200]
 * @param {number} [opts.noise=0.05]
 * @param {number} [opts.seed=1]
 * @param {boolean} [opts.log=false] сохранить пораундовый лог (для тестов)
 * @returns {object} итоги матча
 */
function playMatch(defA, defB, opts) {
  var o = opts || {};
  var rounds = typeof o.rounds === 'number' ? o.rounds : DEFAULT_ROUNDS;
  var noise = typeof o.noise === 'number' ? o.noise : DEFAULT_NOISE;
  var seed = typeof o.seed === 'number' ? o.seed : 1;
  var keepLog = !!o.log;

  // Четыре независимых потока: шум A, шум B, монета A, монета B.
  // Раздельные потоки означают, что смена стратегии одной стороны не сдвигает
  // последовательность шума другой — прогоны остаются сопоставимыми.
  var noiseA = rngLib.mulberry32(rngLib.hashSeed(seed, 0x9e37));
  var noiseB = rngLib.mulberry32(rngLib.hashSeed(seed, 0x85eb));
  var coinA = rngLib.mulberry32(rngLib.hashSeed(seed, 0xc2b2));
  var coinB = rngLib.mulberry32(rngLib.hashSeed(seed, 0x27d4));

  var histA = historyLib.createHistory();
  var histB = historyLib.createHistory();

  var agentA = defA.create({ random: coinA });
  var agentB = defB.create({ random: coinB });

  var scoreA = 0;
  var scoreB = 0;
  var coopA = 0;
  var coopB = 0;
  var intendedCoopA = 0;
  var intendedCoopB = 0;
  var flipsA = 0;
  var flipsB = 0;
  var log = keepLog ? [] : null;

  for (var t = 0; t < rounds; t++) {
    var wantA = payoff.normalize(agentA.move(histA));
    var wantB = payoff.normalize(agentB.move(histB));

    if (wantA === C) intendedCoopA++;
    if (wantB === C) intendedCoopB++;

    var actualA = wantA;
    var actualB = wantB;
    if (noise > 0) {
      if (noiseA() < noise) {
        actualA = payoff.flip(actualA);
        flipsA++;
      }
      if (noiseB() < noise) {
        actualB = payoff.flip(actualB);
        flipsB++;
      }
    }

    var points = payoff.score(actualA, actualB);
    scoreA += points[0];
    scoreB += points[1];
    if (actualA === C) coopA++;
    if (actualB === C) coopB++;

    if (keepLog) {
      log.push({
        round: t,
        intendedA: wantA,
        intendedB: wantB,
        a: actualA,
        b: actualB,
        pointsA: points[0],
        pointsB: points[1]
      });
    }

    histA.__push(actualA, actualB);
    histB.__push(actualB, actualA);
  }

  return {
    a: defA.id,
    b: defB.id,
    rounds: rounds,
    scoreA: scoreA,
    scoreB: scoreB,
    avgA: rngLib.round(scoreA / rounds),
    avgB: rngLib.round(scoreB / rounds),
    coopA: rngLib.round(coopA / rounds),
    coopB: rngLib.round(coopB / rounds),
    intendedCoopA: rngLib.round(intendedCoopA / rounds),
    intendedCoopB: rngLib.round(intendedCoopB / rounds),
    flipsA: flipsA,
    flipsB: flipsB,
    log: log
  };
}

module.exports = {
  playMatch: playMatch,
  DEFAULT_ROUNDS: DEFAULT_ROUNDS,
  DEFAULT_NOISE: DEFAULT_NOISE,
  C: C,
  D: D
};
