'use strict';

/**
 * Матрица выплат повторяющейся «дилеммы заключённого».
 *
 *                 оппонент C   оппонент D
 *   игрок C          R=3          S=0
 *   игрок D          T=5          P=1
 *
 * Классические условия дилеммы:
 *   T > R > P > S      (предать выгоднее в одном раунде)
 *   2R > T + S         (взаимное сотрудничество выгоднее чередования)
 */

var COOPERATE = 'C';
var DEFECT = 'D';

var PAYOFF = Object.freeze({
  R: 3, // Reward   — оба сотрудничают
  P: 1, // Punishment — оба предают
  T: 5, // Temptation — предал доверчивого
  S: 0 // Sucker    — тебя предали
});

/**
 * Очки за один раунд.
 * @param {'C'|'D'} a ход первого игрока
 * @param {'C'|'D'} b ход второго игрока
 * @returns {[number, number]} [очки A, очки B]
 */
function score(a, b) {
  if (a === COOPERATE) {
    return b === COOPERATE ? [PAYOFF.R, PAYOFF.R] : [PAYOFF.S, PAYOFF.T];
  }
  return b === COOPERATE ? [PAYOFF.T, PAYOFF.S] : [PAYOFF.P, PAYOFF.P];
}

/** Инверсия хода — используется шумом канала связи. */
function flip(move) {
  return move === COOPERATE ? DEFECT : COOPERATE;
}

/** Нормализация того, что вернула стратегия. Всё, кроме 'D', считается 'C'. */
function normalize(move) {
  return move === DEFECT ? DEFECT : COOPERATE;
}

/** Проверка, что дилемма — действительно дилемма. Используется в тестах. */
function isValidDilemma(p) {
  return p.T > p.R && p.R > p.P && p.P > p.S && 2 * p.R > p.T + p.S;
}

module.exports = {
  COOPERATE: COOPERATE,
  DEFECT: DEFECT,
  PAYOFF: PAYOFF,
  score: score,
  flip: flip,
  normalize: normalize,
  isValidDilemma: isValidDilemma
};
