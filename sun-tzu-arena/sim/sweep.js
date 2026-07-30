#!/usr/bin/env node
// Стенд устойчивости: свип условий среды.
//
// Оси: шум {0, 5, 10, 20 %} × длина матча {50, 200, 500} × матрица выплат
// {classic, goldrush}. Каждая из 24 комбинаций — полная эволюция основной
// лиги (30 поколений). Альтернативная матрица «Золотая лихорадка»
// T=8 R=5 P=1 S=0 (обоснование — DECISIONS.md D-17): соблазн предательства
// удвоен, но и мир богаче; проверяет, выживает ли кооперация при
// сверхприбыльной агрессии. Условия дилеммы сохранены: T>R>P>S, 2R > T+S.
//
//   node sim/sweep.js --seed 42   → results/sweep-42.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulate } from './simulate.js';
import { STRATEGIES } from '../strategies/index.js';
import { PAYOFFS } from '../engine/game.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RESULTS_DIR = path.join(ROOT, 'results');

export const NOISES = [0, 0.05, 0.1, 0.2];
export const ROUNDS = [50, 200, 500];
export const MATRICES = {
  classic: PAYOFFS,
  goldrush: { R: 5, P: 1, T: 8, S: 0 },
};

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** Полный свип. Детерминирован по сиду. */
export function runSweep(seed, { generations = 30, log = () => {} } = {}) {
  const conditions = [];
  for (const matrixName of Object.keys(MATRICES)) {
    for (const noise of NOISES) {
      for (const rounds of ROUNDS) {
        const res = simulate({
          seed,
          generations,
          rounds,
          noise,
          payoffs: MATRICES[matrixName],
        });
        const winner = res.outcome.winner;
        conditions.push({
          matrix: matrixName,
          noise,
          rounds,
          winnerId: res.outcome.winnerId,
          winnerShare: res.outcome.winnerShare,
          condition: res.outcome.condition,
          aliveAtEnd: res.outcome.aliveAtEnd,
          finalShares: res.finalShares.map(round6),
        });
        log(`${matrixName} noise=${noise} rounds=${rounds} → ${res.strategies[winner].name} (${(res.outcome.winnerShare * 100).toFixed(1)}%)`);
      }
    }
  }
  return {
    meta: {
      version: 1,
      seed,
      generations,
      noises: NOISES,
      roundsList: ROUNDS,
      matrices: MATRICES,
    },
    strategies: STRATEGIES.map((s) => s.id),
    conditions,
  };
}

function main() {
  const argv = process.argv.slice(2);
  let seed = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') {
      seed = Number(argv[++i]);
    } else {
      throw new Error(`Неизвестный аргумент: ${argv[i]} (доступен --seed)`);
    }
  }
  if (seed == null || !Number.isInteger(seed)) throw new Error('Укажите целый --seed');
  const t0 = process.hrtime.bigint();
  const result = runSweep(seed, { log: (line) => console.log('  ' + line) });
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `sweep-${seed}.json`);
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  const winners = {};
  for (const c of result.conditions) winners[c.winnerId] = (winners[c.winnerId] || 0) + 1;
  console.log('\nПобеды по условиям (из ' + result.conditions.length + '):');
  for (const [id, n] of Object.entries(winners).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(2)} × ${id}`);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`\n→ ${path.relative(process.cwd(), out)} (${(ms / 1000).toFixed(1)} с)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
