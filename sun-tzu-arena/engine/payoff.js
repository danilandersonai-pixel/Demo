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
 *
 * Таблица передаётся параметром, а не берётся из глобальной константы. Это
 * нужно стенду устойчивости (`sim/sweep.js`), который прогоняет лигу по
 * нескольким матрицам: подменять замороженный `PAYOFF` на время прогона
 * значило бы менять глобальное состояние из-под работающего движка — приём,
 * который ломается от первой же вложенности и не выдерживает параллельных
 * прогонов. Явный параметр не ломается ни от чего.
 *
 * @param {'C'|'D'} a ход первого игрока
 * @param {'C'|'D'} b ход второго игрока
 * @param {{R:number,P:number,T:number,S:number}} [table=PAYOFF]
 * @returns {[number, number]} [очки A, очки B]
 */
function score(a, b, table) {
  var p = table || PAYOFF;
  if (a === COOPERATE) {
    return b === COOPERATE ? [p.R, p.R] : [p.S, p.T];
  }
  return b === COOPERATE ? [p.T, p.S] : [p.P, p.P];
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
