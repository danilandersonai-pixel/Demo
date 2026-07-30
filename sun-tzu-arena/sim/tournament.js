// Турнир «каждый с каждым» для одного поколения.
//
// Играют только живые стратегии (доля > 0). Селф-матчи (i против i, два
// независимых экземпляра) нужны репликатору: приспособленность фракции
// включает встречи с собственными сородичами. Сид каждого матча выводится
// из (seed, gen, i, j), поэтому результат не зависит от порядка матчей.

import { playMatch } from '../engine/game.js';
import { combineSeedAll } from '../engine/rng.js';

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

/**
 * @param {Array} strategies — реестр стратегий
 * @param {number[]} shares — текущие доли (0 = вымерла, не играет)
 * @param {object} opts — { seed, gen, rounds, noise }
 * @returns {{ matrix: number[][], matches: object[] }}
 *   matrix[i][j] — средние очки за раунд стратегии i против j;
 *   matches — записи для реплея: { a, b, sa, sb, ca, cb } (a < b или a === b).
 */
export function runTournament(strategies, shares, opts) {
  const { seed, gen, rounds, noise } = opts;
  const n = strategies.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  const matches = [];

  for (let i = 0; i < n; i++) {
    if (shares[i] <= 0) continue;
    for (let j = i; j < n; j++) {
      if (shares[j] <= 0) continue;
      const matchSeed = combineSeedAll(seed, gen, i, j);
      const res = playMatch(strategies[i], strategies[j], {
        rounds,
        noise,
        seed: matchSeed,
      });
      if (i === j) {
        // Селф-матч: две стороны одной фракции; берём среднее.
        matrix[i][i] = (res.avgA + res.avgB) / 2;
      } else {
        matrix[i][j] = res.avgA;
        matrix[j][i] = res.avgB;
      }
      matches.push({
        a: i,
        b: j,
        sa: round3(res.avgA),
        sb: round3(res.avgB),
        ca: round3(res.coopA),
        cb: round3(res.coopB),
      });
    }
  }

  return { matrix, matches };
}
