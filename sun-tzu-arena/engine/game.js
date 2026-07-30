// Ядро игры: повторяющаяся дилемма заключённого с шумом.
//
// Матрица выплат:  R=3 (оба C), P=1 (оба D), T=5 (я D, он C), S=0 (я C, он D).
// Шум («дрожащая рука»): с вероятностью noise фактический ход игрока
// становится противоположным задуманному; фактический ход видят оба игрока.

import { mulberry32, combineSeed } from './rng.js';

export const C = 'C';
export const D = 'D';

export const PAYOFFS = { R: 3, P: 1, T: 5, S: 0 };

/** Выплата игроку, сыгравшему myMove против oppMove. */
export function payoff(myMove, oppMove) {
  if (myMove === C) return oppMove === C ? PAYOFFS.R : PAYOFFS.S;
  return oppMove === C ? PAYOFFS.T : PAYOFFS.P;
}

function flip(move) {
  return move === C ? D : C;
}

function assertMove(move, strategyId, round) {
  if (move !== C && move !== D) {
    throw new Error(
      `Стратегия «${strategyId}» вернула недопустимый ход ${JSON.stringify(move)} в раунде ${round}`
    );
  }
}

/**
 * Один матч между двумя стратегиями.
 *
 * @param {object} stratA — модуль стратегии ({ id, create })
 * @param {object} stratB — модуль стратегии
 * @param {object} opts
 *   rounds   — число раундов (стратегиям неизвестно), по умолчанию 200
 *   noise    — вероятность искажения хода, по умолчанию 0.05
 *   seed     — сид матча; из него выводятся три независимых потока
 *   rngNoise/rngA/rngB — необязательные переопределения потоков (для тестов)
 *
 * Стратегии видят ТОЛЬКО копии массивов фактических ходов текущего матча.
 */
export function playMatch(stratA, stratB, opts = {}) {
  const rounds = opts.rounds ?? 200;
  const noise = opts.noise ?? 0.05;
  const seed = opts.seed ?? 0;

  const rngNoise = opts.rngNoise ?? mulberry32(combineSeed(seed, 1));
  const rngA = opts.rngA ?? mulberry32(combineSeed(seed, 2));
  const rngB = opts.rngB ?? mulberry32(combineSeed(seed, 3));

  const playerA = stratA.create(rngA);
  const playerB = stratB.create(rngB);

  const movesA = [];
  const movesB = [];
  let scoreA = 0;
  let scoreB = 0;
  let coopA = 0;
  let coopB = 0;

  for (let r = 0; r < rounds; r++) {
    const intendedA = playerA.move(movesA.slice(), movesB.slice());
    const intendedB = playerB.move(movesB.slice(), movesA.slice());
    assertMove(intendedA, stratA.id, r);
    assertMove(intendedB, stratB.id, r);

    let actualA = intendedA;
    let actualB = intendedB;
    if (noise > 0) {
      if (rngNoise() < noise) actualA = flip(actualA);
      if (rngNoise() < noise) actualB = flip(actualB);
    }

    movesA.push(actualA);
    movesB.push(actualB);
    scoreA += payoff(actualA, actualB);
    scoreB += payoff(actualB, actualA);
    if (actualA === C) coopA++;
    if (actualB === C) coopB++;
  }

  return {
    rounds,
    scoreA,
    scoreB,
    avgA: scoreA / rounds,
    avgB: scoreB / rounds,
    coopA: coopA / rounds,
    coopB: coopB / rounds,
    movesA,
    movesB,
  };
}
