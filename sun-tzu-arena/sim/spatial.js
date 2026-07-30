#!/usr/bin/env node
// Пространственный режим: тор 20×20, каждая клетка — агент одной из стратегий
// основной лиги. Эпоха: каждая клетка играет полный матч с четырьмя соседями
// (фон Неймана), затем перенимает стратегию лучшего по среднему счёту соседа
// (включая себя; при равенстве — себя, затем порядок С/В/Ю/З). В отличие от
// перемешанной популяции, здесь кооператоры могут выживать кластерами.
//
//   node sim/spatial.js --seed 42 [--epochs 40] [--rounds 200] [--noise 0.05]
//   node sim/spatial.js --all
//
// Пишет results/spatial-<seed>.json и перегенерирует viz/replay.js.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playMatch } from '../engine/game.js';
import { mulberry32, combineSeedAll } from '../engine/rng.js';
import { STRATEGIES } from '../strategies/index.js';
import { rebuildReplay, CANONICAL_SEEDS } from './run.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RESULTS_DIR = path.join(ROOT, 'results');

export const GRID = 20;
const DEFAULTS = { epochs: 40, noise: 0.05, rounds: 200 };

/**
 * Имя файла территории: эталонное `spatial-<seed>.json` — только при параметрах
 * по умолчанию; любое отклонение получает суффикс (та же защита, что в run.js).
 */
export function spatialFileName(seed, { noise, epochs, rounds } = DEFAULTS) {
  let name = `spatial-${seed}`;
  if (noise !== DEFAULTS.noise) name += `-noise${noise}`;
  if (epochs !== DEFAULTS.epochs) name += `-epochs${epochs}`;
  if (rounds !== DEFAULTS.rounds) name += `-rounds${rounds}`;
  return name + '.json';
}

/** Индексы четырёх соседей клетки i на торе size×size: С, В, Ю, З. */
export function neighborsOf(i, size = GRID) {
  const x = i % size;
  const y = (i - x) / size;
  const wrap = (v) => (v + size) % size;
  return [
    wrap(y - 1) * size + x, // север
    y * size + wrap(x + 1), // восток
    wrap(y + 1) * size + x, // юг
    y * size + wrap(x - 1), // запад
  ];
}

/**
 * Шаг захвата территории: клетка перенимает стратегию лучшего по счёту
 * соседа (включая себя; при равенстве приоритет: я, север, восток, юг, запад).
 */
export function adoptStep(grid, scores, size = GRID) {
  return grid.map((cur, i) => {
    let bestScore = scores[i];
    let bestStrat = cur;
    for (const n of neighborsOf(i, size)) {
      if (scores[n] > bestScore) {
        bestScore = scores[n];
        bestStrat = grid[n];
      }
    }
    return bestStrat;
  });
}

function countByStrategy(grid, n) {
  const counts = new Array(n).fill(0);
  for (const s of grid) counts[s]++;
  return counts;
}

/** Полный пространственный прогон. Детерминирован по сиду. */
export function runSpatial(options) {
  const {
    seed,
    epochs = 40,
    rounds = 200,
    noise = 0.05,
    strategies = STRATEGIES,
    size = GRID,
  } = options;
  if (!Number.isInteger(seed)) throw new Error('runSpatial: нужен целочисленный seed');
  const n = strategies.length;
  const cells = size * size;

  // Начальная карта: равномерное сидированное распределение стратегий.
  const initRng = mulberry32(combineSeedAll(seed, 0x5a7a));
  let grid = Array.from({ length: cells }, () => Math.floor(initRng() * n));

  const grids = [grid.slice()];
  const counts = [countByStrategy(grid, n)];

  for (let e = 0; e < epochs; e++) {
    const scoreSum = new Array(cells).fill(0);
    // Уникальные рёбра: вправо (dir 0) и вниз (dir 1) от каждой клетки.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        for (const dir of [0, 1]) {
          const j = dir === 0 ? y * size + ((x + 1) % size) : ((y + 1) % size) * size + x;
          const res = playMatch(strategies[grid[i]], strategies[grid[j]], {
            rounds,
            noise,
            seed: combineSeedAll(seed, e, x, y, dir),
          });
          scoreSum[i] += res.avgA;
          scoreSum[j] += res.avgB;
        }
      }
    }
    const scores = scoreSum.map((s) => s / 4);
    grid = adoptStep(grid, scores, size);
    grids.push(grid.slice());
    counts.push(countByStrategy(grid, n));
  }

  return {
    meta: { version: 1, seed, epochs, rounds, noise, size },
    strategies: strategies.map((s) => s.id),
    grids,
    counts,
  };
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS, all: false, seed: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') {
      opts.all = true;
    } else if (a === '--seed' || a === '--epochs' || a === '--rounds' || a === '--noise') {
      const num = Number(argv[++i]);
      if (Number.isNaN(num)) throw new Error(`Флагу ${a} нужно число`);
      opts[a.slice(2)] = num;
    } else {
      throw new Error(`Неизвестный аргумент: ${a} (доступны --seed, --epochs, --rounds, --noise, --all)`);
    }
  }
  if (opts.all && opts.seed != null) throw new Error('--all и --seed взаимоисключающие');
  if (!opts.all && opts.seed == null) throw new Error('Укажите --seed <число> или --all');
  if (opts.seed != null && !Number.isInteger(opts.seed)) throw new Error('--seed должен быть целым числом');
  if (!Number.isInteger(opts.epochs) || opts.epochs < 1) throw new Error('--epochs должен быть целым ≥ 1');
  if (!Number.isInteger(opts.rounds) || opts.rounds < 1) throw new Error('--rounds должен быть целым ≥ 1');
  if (!(opts.noise >= 0 && opts.noise <= 1)) throw new Error('--noise должен лежать в [0, 1]');
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const seeds = opts.all ? CANONICAL_SEEDS : [opts.seed];
  for (const seed of seeds) {
    const result = runSpatial({ seed, epochs: opts.epochs, rounds: opts.rounds, noise: opts.noise });
    const file = path.join(RESULTS_DIR, spatialFileName(seed, opts));
    fs.writeFileSync(file, JSON.stringify(result) + '\n');
    const final = result.counts[result.counts.length - 1];
    const top = final
      .map((c, i) => ({ id: STRATEGIES[i].name, c }))
      .filter((r) => r.c > 0)
      .sort((a, b) => b.c - a.c);
    console.log(`seed ${seed}: ${result.meta.epochs} эпох, финальная карта — ` +
      top.map((r) => `${r.id} ${((r.c / final.reduce((a, b) => a + b, 0)) * 100).toFixed(0)}%`).join(', '));
    console.log(`  → ${path.relative(process.cwd(), file)}`);
  }
  rebuildReplay();
  console.log('viz/replay.js обновлён (включая территории)');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
