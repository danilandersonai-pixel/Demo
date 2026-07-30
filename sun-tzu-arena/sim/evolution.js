// Репликаторная динамика.
//
// x_i' = x_i · f_i / f̄,  где  f_i = Σ_j x_j · M[i][j],  f̄ = Σ_i x_i · f_i.
// Доля растёт, если приспособленность выше средней по популяции.
// После шага доля < порога (0.5 %) обнуляется («вымирание»), затем вектор
// нормируется так, что сумма долей снова равна 1.

export const EXTINCTION_THRESHOLD = 0.005;

/**
 * @param {number[]} shares — текущие доли (сумма 1, вымершие — 0)
 * @param {number[][]} matrix — платёжная матрица поколения (средние за раунд)
 * @param {number} threshold — порог вымирания
 * @returns {{ next: number[], fitness: (number|null)[], mean: number, extinct: number[] }}
 *   fitness[i] — приспособленность живой стратегии, null для вымерших;
 *   extinct — индексы, вымершие на этом шаге.
 */
export function replicatorStep(shares, matrix, threshold = EXTINCTION_THRESHOLD) {
  const n = shares.length;

  const fitness = shares.map((x, i) => {
    if (x <= 0) return null;
    let f = 0;
    for (let j = 0; j < n; j++) {
      if (shares[j] > 0) f += shares[j] * matrix[i][j];
    }
    return f;
  });

  let mean = 0;
  for (let i = 0; i < n; i++) {
    if (fitness[i] != null) mean += shares[i] * fitness[i];
  }

  let next = shares.map((x, i) => {
    if (x <= 0 || mean <= 0) return 0;
    return (x * fitness[i]) / mean;
  });

  const extinct = [];
  next = next.map((x, i) => {
    if (x > 0 && x < threshold) {
      extinct.push(i);
      return 0;
    }
    return x;
  });

  const total = next.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    // Вырожденный случай (все выплаты нулевые) — доли не меняются.
    return { next: shares.slice(), fitness, mean, extinct: [] };
  }
  next = next.map((x) => x / total);

  return { next, fitness, mean, extinct };
}
