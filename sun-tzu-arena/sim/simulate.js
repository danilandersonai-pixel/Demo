// Оркестратор: полная эволюционная симуляция одного прогона.
//
// Каждое поколение: круговой турнир живых стратегий → репликаторный шаг →
// запись среза для реплея. Симуляция всегда доигрывает все поколения;
// условие победы (доминация > 60 % или вымирание остальных) фиксируется
// в outcome с номером поколения, где оно впервые выполнено (см. DECISIONS D-07).

import { STRATEGIES } from '../strategies/index.js';
import { runTournament } from './tournament.js';
import { replicatorStep, EXTINCTION_THRESHOLD } from './evolution.js';
import { PAYOFFS } from '../engine/game.js';

export const DOMINATION_SHARE = 0.6;

function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

/**
 * @param {object} options
 *   seed        — сид прогона (обязателен)
 *   generations — число поколений (30)
 *   rounds      — раундов в матче (200)
 *   noise       — вероятность искажения хода (0.05)
 *   strategies  — реестр (по умолчанию основная лига)
 * @returns {object} результат прогона (сериализуемый, детерминированный)
 */
export function simulate(options) {
  const {
    seed,
    generations = 30,
    rounds = 200,
    noise = 0.05,
    strategies = STRATEGIES,
  } = options;
  if (!Number.isInteger(seed)) {
    throw new Error('simulate: нужен целочисленный seed');
  }

  const n = strategies.length;
  let shares = new Array(n).fill(1 / n);
  const gens = [];
  let dominationGen = null;
  let exterminationGen = null;

  for (let g = 0; g < generations; g++) {
    const { matrix, matches } = runTournament(strategies, shares, {
      seed,
      gen: g,
      rounds,
      noise,
    });
    const step = replicatorStep(shares, matrix);

    gens.push({
      gen: g + 1,
      sharesBefore: shares.map(round6),
      sharesAfter: step.next.map(round6),
      fitness: step.fitness.map((f) => (f == null ? null : round3(f))),
      meanFitness: round3(step.mean),
      extinct: step.extinct,
      matches,
    });

    shares = step.next;

    const alive = shares.filter((x) => x > 0).length;
    const maxShare = Math.max(...shares);
    if (dominationGen == null && maxShare > DOMINATION_SHARE) {
      dominationGen = g + 1;
    }
    if (exterminationGen == null && alive === 1) {
      exterminationGen = g + 1;
    }
  }

  let winner = 0;
  for (let i = 1; i < n; i++) {
    if (shares[i] > shares[winner]) winner = i;
  }
  const aliveAtEnd = shares.filter((x) => x > 0).length;
  const condition =
    exterminationGen != null
      ? 'extermination'
      : dominationGen != null
        ? 'domination'
        : 'plurality';

  return {
    meta: {
      version: 1,
      seed,
      generations,
      rounds,
      noise,
      payoffs: PAYOFFS,
      extinctionThreshold: EXTINCTION_THRESHOLD,
      dominationShare: DOMINATION_SHARE,
    },
    strategies: strategies.map((s) => ({
      id: s.id,
      name: s.name,
      epithet: s.epithet,
      color: s.color,
      dossier: s.dossier,
    })),
    generations: gens,
    finalShares: shares.map(round6),
    outcome: {
      winner,
      winnerId: strategies[winner].id,
      winnerShare: round6(shares[winner]),
      condition,
      conditionGen: exterminationGen ?? dominationGen ?? null,
      aliveAtEnd,
    },
  };
}

/** Каноническая сериализация результата (байт-в-байт воспроизводимая). */
export function serializeResult(result) {
  return JSON.stringify(result, null, 2) + '\n';
}
