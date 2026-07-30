// ELO-рейтинг стратегий по всем сыгранным матчам всех режимов.
//
// Источники: матчи всех поколений трёх эталонных прогонов (results/<seed>.json)
// и агрегаты пар закрытого чемпионата (results/challenge.json). Матч — одна
// «партия»: победа тому, у кого средний счёт за раунд выше (допуск 1e-9 —
// ничья). Порядок обхода фиксирован (сиды по возрастанию, поколения и матчи
// по порядку записи), поэтому рейтинг детерминирован.

export const ELO_INITIAL = 1000;
export const ELO_K = 16;

function expected(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/**
 * @param {object[]} runs — разобранные results/<seed>.json (лига 2.0)
 * @param {object|null} challenge — разобранный results/challenge.json
 * @returns {{ ratings: Array<{id, rating, games, wins, draws, losses}> }}
 */
export function computeElo(runs, challenge = null) {
  const table = new Map(); // id → {rating, games, wins, draws, losses}
  const ensure = (id) => {
    if (!table.has(id)) table.set(id, { id, rating: ELO_INITIAL, games: 0, wins: 0, draws: 0, losses: 0 });
    return table.get(id);
  };

  const playGame = (idA, idB, sa, sb) => {
    if (idA === idB) return; // селф-матчи рейтинг не двигают
    const A = ensure(idA);
    const B = ensure(idB);
    const outcome = Math.abs(sa - sb) < 1e-9 ? 0.5 : sa > sb ? 1 : 0;
    const ea = expected(A.rating, B.rating);
    A.rating += ELO_K * (outcome - ea);
    B.rating += ELO_K * (1 - outcome - (1 - ea));
    A.games++;
    B.games++;
    if (outcome === 0.5) {
      A.draws++;
      B.draws++;
    } else if (outcome === 1) {
      A.wins++;
      B.losses++;
    } else {
      B.wins++;
      A.losses++;
    }
  };

  for (const run of runs) {
    const ids = run.strategies.map((s) => s.id);
    for (const gen of run.generations) {
      for (const m of gen.matches) {
        playGame(ids[m.a], ids[m.b], m.sa, m.sb);
      }
    }
  }
  if (challenge && Array.isArray(challenge.roundRobinPairs)) {
    const ids = challenge.participants.map((p) => p.id);
    for (const p of challenge.roundRobinPairs) {
      playGame(ids[p.a], ids[p.b], p.sa, p.sb);
    }
  }

  const ratings = [...table.values()]
    .map((r) => ({ ...r, rating: Math.round(r.rating) }))
    .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  return { ratings };
}
