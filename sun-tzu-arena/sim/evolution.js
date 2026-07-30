'use strict';

/** Доля ниже этого порога считается вымиранием. */
var EXTINCTION_THRESHOLD = 0.005;

/**
 * Один шаг дискретной репликаторной динамики.
 *
 *   share_i' = share_i · f_i / f̄,   f̄ = Σ share_j · f_j
 *
 * Доля растёт ровно тогда, когда приспособленность выше средней по популяции,
 * и падает, когда ниже. Множительная форма (а не аддитивная share + α(f−f̄))
 * выбрана потому, что при неотрицательных выплатах она сама удерживает доли
 * в [0,1] и не требует подбора шага: при выплатах 0…5 и типичной средней 2…3
 * отношение f_i/f̄ даёт 10–25% прироста за поколение — за тридцать поколений
 * этого достаточно для доминирования, но мало для мгновенного схлопывания.
 *
 * Порядок действий важен: сначала пересчёт, затем вымирание, затем нормировка.
 * Если нормировать до вымирания, сумма долей перестанет равняться единице.
 *
 * @param {number[]} shares доли, сумма 1
 * @param {number[]} fitness приспособленности
 * @param {object} [opts] {threshold}
 * @returns {{shares: number[], avgFitness: number, extinct: number[]}}
 */
function step(shares, fitness, opts) {
  var threshold = opts && typeof opts.threshold === 'number' ? opts.threshold : EXTINCTION_THRESHOLD;
  var n = shares.length;
  var i;

  var avg = 0;
  for (i = 0; i < n; i++) avg += shares[i] * fitness[i];

  var next = new Array(n);
  for (i = 0; i < n; i++) {
    next[i] = avg > 0 ? (shares[i] * fitness[i]) / avg : shares[i];
  }

  var extinct = [];
  for (i = 0; i < n; i++) {
    if (next[i] > 0 && next[i] < threshold) {
      next[i] = 0;
      extinct.push(i);
    }
  }

  var sum = 0;
  for (i = 0; i < n; i++) sum += next[i];
  if (sum > 0) {
    for (i = 0; i < n; i++) next[i] /= sum;
  }

  return { shares: next, avgFitness: avg, extinct: extinct };
}

/** Равномерное начальное распределение. */
function uniform(n) {
  var shares = new Array(n);
  for (var i = 0; i < n; i++) shares[i] = 1 / n;
  return shares;
}

module.exports = {
  step: step,
  uniform: uniform,
  EXTINCTION_THRESHOLD: EXTINCTION_THRESHOLD
};
