#!/usr/bin/env node
// Генетическая эволюция стратегий с памятью на 2 раунда.
//
// Геном — 21 ген ('C'/'D'):
//   [0]      — первый ход (истории нет);
//   [1..4]   — ответ на исход единственного сыгранного раунда;
//   [5..20]  — ответ на комбинацию исходов двух последних раундов.
// Исход раунда кодируется 0..3: (я C/D)·2 + (оппонент C/D);
// состояние памяти-2: исход_предпоследнего · 4 + исход_последнего (0..15).
//
// ГА: популяция 64, 150 поколений, фитнес — средние очки за раунд против
// K=12 сидированно выбранных соперников по популяции (коэволюция), турнирный
// отбор (k=3), равномерный кроссовер (0.9), мутация гена (0.02), элита 2.
// Обоснование параметров — DECISIONS.md (D-15). Полный детерминизм по сиду.
//
//   node sim/evolve.js --seed 42 [--generations 150] [--pop 64] [--noise 0.05]
//
// Пишет results/evolve-<seed>.json; для канонического сида 42 дополнительно
// генерирует strategies/evolved/nameless.js — «Безымянного» для основной лиги.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playMatch, C, D } from '../engine/game.js';
import { mulberry32, combineSeedAll } from '../engine/rng.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RESULTS_DIR = path.join(ROOT, 'results');
const EVOLVED_DIR = path.join(ROOT, 'strategies', 'evolved');
export const CANONICAL_EVOLVE_SEED = 42;

export const GENOME_LENGTH = 21;

/** Код исхода раунда с точки зрения игрока: (мой ход, ход оппонента) → 0..3. */
export function outcomeIndex(my, opp) {
  return (my === D ? 2 : 0) + (opp === D ? 1 : 0);
}

/** Ход генома по истории фактических ходов. */
export function genomeMove(genes, mine, theirs) {
  const r = mine.length;
  if (r === 0) return genes[0];
  const last = outcomeIndex(mine[r - 1], theirs[r - 1]);
  if (r === 1) return genes[1 + last];
  const prev = outcomeIndex(mine[r - 2], theirs[r - 2]);
  return genes[5 + prev * 4 + last];
}

/** Обёртка генома под интерфейс стратегии движка. */
export function genomeStrategy(genes, id = 'genome') {
  if (genes.length !== GENOME_LENGTH || genes.some((g) => g !== C && g !== D)) {
    throw new Error('genomeStrategy: геном должен быть 21 геном C/D');
  }
  return {
    id,
    name: id,
    create() {
      return {
        move(mine, theirs) {
          return genomeMove(genes, mine, theirs);
        },
      };
    },
  };
}

export function randomGenome(rng) {
  return Array.from({ length: GENOME_LENGTH }, () => (rng() < 0.5 ? C : D));
}

/** Равномерный кроссовер: каждый ген — от случайного родителя. */
export function crossover(a, b, rng) {
  return a.map((g, i) => (rng() < 0.5 ? g : b[i]));
}

/** Мутация: каждый ген независимо инвертируется с вероятностью p. */
export function mutate(genes, rng, p) {
  return genes.map((g) => (rng() < p ? (g === C ? D : C) : g));
}

/** Турнирный отбор: k случайных кандидатов, побеждает лучший по фитнесу. */
function selectParent(pop, fitness, rng, k) {
  let best = Math.floor(rng() * pop.length);
  for (let t = 1; t < k; t++) {
    const cand = Math.floor(rng() * pop.length);
    if (fitness[cand] > fitness[best]) best = cand;
  }
  return pop[best];
}

/**
 * Полный прогон генетической эволюции. Детерминирован по сиду.
 * @returns {{ best: {genes, fitness}, history, meta }}
 */
export function evolve(options = {}) {
  const {
    seed,
    popSize = 64,
    generations = 150,
    rounds = 60,
    noise = 0.05,
    sampleK = 12,
    tournamentK = 3,
    crossoverRate = 0.9,
    mutationRate = 0.02,
    elite = 2,
  } = options;
  if (!Number.isInteger(seed)) throw new Error('evolve: нужен целочисленный seed');

  const initRng = mulberry32(combineSeedAll(seed, 0xe401));
  let pop = Array.from({ length: popSize }, () => randomGenome(initRng));
  const history = [];
  let bestEver = null;

  for (let g = 0; g < generations; g++) {
    // Оценка: каждый геном инициирует sampleK матчей против сидированно
    // выбранных соперников; очки копятся у обеих сторон.
    const score = new Array(popSize).fill(0);
    const played = new Array(popSize).fill(0);
    const pairRng = mulberry32(combineSeedAll(seed, 0xa11, g));
    for (let i = 0; i < popSize; i++) {
      for (let k = 0; k < sampleK; k++) {
        let j = Math.floor(pairRng() * (popSize - 1));
        if (j >= i) j++;
        const res = playMatch(genomeStrategy(pop[i], 'g' + i), genomeStrategy(pop[j], 'g' + j), {
          rounds,
          noise,
          seed: combineSeedAll(seed, g, i * popSize + j, k),
        });
        score[i] += res.avgA;
        score[j] += res.avgB;
        played[i]++;
        played[j]++;
      }
    }
    const fitness = score.map((s, i) => s / played[i]);

    const order = fitness
      .map((f, i) => ({ f, i }))
      .sort((a, b) => b.f - a.f || a.i - b.i); // тай-брейк по индексу — детерминизм
    const genBest = { gen: g + 1, best: round3(order[0].f), mean: round3(fitness.reduce((a, b) => a + b, 0) / popSize) };
    history.push(genBest);
    if (!bestEver || order[0].f > bestEver.fitness) {
      bestEver = { genes: pop[order[0].i].slice(), fitness: order[0].f, gen: g + 1 };
    }

    // Новое поколение: элита + потомки турнирного отбора.
    const breedRng = mulberry32(combineSeedAll(seed, 0xb4ee, g));
    const next = order.slice(0, elite).map((o) => pop[o.i].slice());
    while (next.length < popSize) {
      const pa = selectParent(pop, fitness, breedRng, tournamentK);
      const pb = selectParent(pop, fitness, breedRng, tournamentK);
      let child = breedRng() < crossoverRate ? crossover(pa, pb, breedRng) : pa.slice();
      child = mutate(child, breedRng, mutationRate);
      next.push(child);
    }
    pop = next;
  }

  // Чемпион — элитный геном финальной популяции (после последнего отбора
  // элита стоит первой; переоцениваем финалистов последней записью истории).
  const champion = pop[0];
  return {
    meta: { seed, popSize, generations, rounds, noise, sampleK, tournamentK, crossoverRate, mutationRate, elite },
    best: { genes: champion.slice(), lastFitness: history[history.length - 1].best },
    bestEver,
    history,
  };
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

/** Автоинтерпретация генома: на кого из классиков похоже поведение. */
export function interpretGenome(genes) {
  // Сходство по 16 состояниям памяти-2 + 4 состояниям памяти-1.
  let tft = 0;
  let pavlov = 0;
  let total = 0;
  const states = [];
  for (let last = 0; last < 4; last++) {
    const my1 = last & 2 ? D : C;
    const opp1 = last & 1 ? D : C;
    const tftMove = opp1;
    const pavMove = opp1 === C ? my1 : my1 === C ? D : C;
    if (genes[1 + last] === tftMove) tft++;
    if (genes[1 + last] === pavMove) pavlov++;
    total++;
    for (let prev = 0; prev < 4; prev++) {
      const gMove = genes[5 + prev * 4 + last];
      if (gMove === tftMove) tft++;
      if (gMove === pavMove) pavlov++;
      total++;
      states.push(gMove);
    }
  }
  const defectRate = genes.filter((g) => g === D).length / genes.length;
  // Отвечает ли предательством на предательство (состояния, где opp последний ход D)?
  let punishes = 0;
  let punishTotal = 0;
  for (let last of [1, 3]) {
    if (genes[1 + last] === D) punishes++;
    punishTotal++;
    for (let prev = 0; prev < 4; prev++) {
      if (genes[5 + prev * 4 + last] === D) punishes++;
      punishTotal++;
    }
  }
  return {
    firstMove: genes[0],
    defectRate: round3(defectRate),
    tftSimilarity: round3(tft / total),
    pavlovSimilarity: round3(pavlov / total),
    punishRate: round3(punishes / punishTotal),
  };
}

/** Генерация файла «Безымянного» для основной лиги. */
export function namelessSource(result) {
  const { genes } = result.best;
  const info = interpretGenome(genes);
  const pct = (x) => Math.round(x * 100) + ' %';
  return `// ДОСЬЕ ────────────────────────────────────────────────────────────────
// «Безымянный» (Nameless) — стратегия, выведенная генетическим отбором.
// Родословная: ${result.meta.generations} поколений, популяция ${result.meta.popSize}, сид ${result.meta.seed}
// (sim/evolve.js --seed ${result.meta.seed}). Никто её не писал: геном (память на два
// последних раунда, 21 ген) отобран турнирами, кроссовером и мутацией.
// Автоинтерпретация: первый ход — ${info.firstMove === 'C' ? 'кооперация' : 'предательство'};
// доля D в геноме ${pct(info.defectRate)}; наказывает предательство в ${pct(info.punishRate)}
// состояний; совпадение с Зеркалом ${pct(info.tftSimilarity)}, с Прагматиком ${pct(info.pavlovSimilarity)}.
// Файл сгенерирован автоматически — не редактировать вручную.
// ──────────────────────────────────────────────────────────────────────

const GENES = ${JSON.stringify(genes)};

function outcomeIndex(my, opp) {
  return (my === 'D' ? 2 : 0) + (opp === 'D' ? 1 : 0);
}

export default {
  id: 'nameless',
  name: 'Безымянный',
  epithet: 'рождённый отбором',
  color: '#c9c2ae',
  dossier: {
    quote: 'У лучшего полководца нет имени: его выковала сама война.',
    principle: 'Таблица ответов на исходы двух последних раундов, выведенная генетическим алгоритмом (${result.meta.generations} поколений коэволюции).',
    strengths: ['Поведение отобрано против живой популяции, а не придумано', 'Совпадение с Зеркалом ${pct(info.tftSimilarity)}, с Прагматиком ${pct(info.pavlovSimilarity)} — но не копия ни того, ни другого'],
    weaknesses: ['Память всего два раунда: длинные паттерны не распознаёт', 'Отбор шёл против своих — незнакомые стили могут найти дыру'],
    targets: 'Против тех, кто похож на среду его эволюции: адаптивных кооператоров.',
    genome: GENES.join(''),
  },
  create() {
    return {
      move(mine, theirs) {
        const r = mine.length;
        if (r === 0) return GENES[0];
        const last = outcomeIndex(mine[r - 1], theirs[r - 1]);
        if (r === 1) return GENES[1 + last];
        const prev = outcomeIndex(mine[r - 2], theirs[r - 2]);
        return GENES[5 + prev * 4 + last];
      },
    };
  },
};
`;
}

function parseArgs(argv) {
  const opts = { seed: null, generations: 150, pop: 64, noise: 0.05, rounds: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed' || a === '--generations' || a === '--pop' || a === '--noise' || a === '--rounds') {
      const num = Number(argv[++i]);
      if (Number.isNaN(num)) throw new Error(`Флагу ${a} нужно число`);
      opts[a.slice(2)] = num;
    } else {
      throw new Error(`Неизвестный аргумент: ${a} (доступны --seed, --generations, --pop, --noise, --rounds)`);
    }
  }
  if (opts.seed == null || !Number.isInteger(opts.seed)) throw new Error('Укажите целый --seed');
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = evolve({
    seed: opts.seed,
    popSize: opts.pop,
    generations: opts.generations,
    noise: opts.noise,
    rounds: opts.rounds,
  });
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `evolve-${opts.seed}.json`);
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  const info = interpretGenome(result.best.genes);
  console.log(`Эволюция завершена (seed ${opts.seed}): ${opts.generations} поколений, популяция ${opts.pop}`);
  console.log(`  Геном чемпиона: ${result.best.genes.join('')}`);
  console.log(`  Фитнес финала: ${result.best.lastFitness}; лучший за историю: ${round3(result.bestEver.fitness)} (g${result.bestEver.gen})`);
  console.log(`  Похожесть: Зеркало ${Math.round(info.tftSimilarity * 100)}%, Прагматик ${Math.round(info.pavlovSimilarity * 100)}%; первый ход ${info.firstMove}`);
  console.log(`  → ${path.relative(process.cwd(), out)}`);
  const isDefaultConfig =
    opts.generations === 150 && opts.pop === 64 && opts.noise === 0.05 && opts.rounds === 60;
  if (opts.seed === CANONICAL_EVOLVE_SEED && isDefaultConfig) {
    if (!fs.existsSync(EVOLVED_DIR)) fs.mkdirSync(EVOLVED_DIR, { recursive: true });
    const file = path.join(EVOLVED_DIR, 'nameless.js');
    fs.writeFileSync(file, namelessSource(result));
    console.log(`  «Безымянный» перезаписан: ${path.relative(process.cwd(), file)}`);
  } else {
    console.log('  (нестандартный сид/конфиг: strategies/evolved/nameless.js не трогаю)');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
