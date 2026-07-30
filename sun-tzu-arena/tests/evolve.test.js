// Тесты генетической эволюции: геном, кроссовер, мутация, детерминизм,
// «Безымянный».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GENOME_LENGTH,
  outcomeIndex,
  genomeMove,
  genomeStrategy,
  randomGenome,
  crossover,
  mutate,
  evolve,
  interpretGenome,
} from '../sim/evolve.js';
import { playMatch, C, D } from '../engine/game.js';
import { mulberry32 } from '../engine/rng.js';
import titForTat from '../strategies/tit-for-tat.js';
import alwaysDefect from '../strategies/always-defect.js';

// Геном, реализующий чистое Зеркало: реагирует только на последний ход оппонента.
function tftGenome() {
  const genes = new Array(GENOME_LENGTH).fill(C);
  genes[0] = C;
  for (let last = 0; last < 4; last++) {
    const resp = last & 1 ? D : C; // бит 1 — оппонент сыграл D
    genes[1 + last] = resp;
    for (let prev = 0; prev < 4; prev++) genes[5 + prev * 4 + last] = resp;
  }
  return genes;
}

test('кодирование исходов: (мой, его) → 0..3', () => {
  assert.equal(outcomeIndex(C, C), 0);
  assert.equal(outcomeIndex(C, D), 1);
  assert.equal(outcomeIndex(D, C), 2);
  assert.equal(outcomeIndex(D, D), 3);
});

test('геном-Зеркало неотличим от рукописного TitForTat в матче', () => {
  const g = genomeStrategy(tftGenome(), 'tft-genome');
  const a = playMatch(g, alwaysDefect, { rounds: 100, noise: 0.05, seed: 77 });
  const b = playMatch(titForTat, alwaysDefect, { rounds: 100, noise: 0.05, seed: 77 });
  assert.deepEqual(a.movesA, b.movesA);
  assert.deepEqual(a.movesB, b.movesB);
});

test('genomeMove использует память двух раундов', () => {
  const genes = new Array(GENOME_LENGTH).fill(C);
  genes[5 + outcomeIndex(D, D) * 4 + outcomeIndex(C, C)] = D; // только после (DD, CC)
  assert.equal(genomeMove(genes, [D, C], [D, C]), D);
  assert.equal(genomeMove(genes, [C, C], [D, C]), C, 'другой предпоследний исход — другой ген');
});

test('кроссовер берёт каждый ген у одного из родителей', () => {
  const a = new Array(GENOME_LENGTH).fill(C);
  const b = new Array(GENOME_LENGTH).fill(D);
  const childA = crossover(a, b, () => 0.4); // < 0.5 → ген родителя A
  assert.deepEqual(childA, a);
  const childB = crossover(a, b, () => 0.6);
  assert.deepEqual(childB, b);
  const mixed = crossover(a, b, mulberry32(5));
  assert.ok(mixed.every((g, i) => g === a[i] || g === b[i]));
  assert.ok(mixed.includes(C) && mixed.includes(D), 'настоящий ГПСЧ даёт смесь');
});

test('мутация: p=0 не меняет геном, p=1 инвертирует каждый ген', () => {
  const g = randomGenome(mulberry32(3));
  assert.deepEqual(mutate(g, mulberry32(4), 0), g);
  const flipped = mutate(g, mulberry32(4), 1);
  assert.ok(flipped.every((x, i) => x !== g[i]));
});

test('эволюция детерминирована: один сид — идентичный результат', () => {
  const opts = { generations: 4, popSize: 10, rounds: 20, sampleK: 3 };
  const a = evolve({ seed: 9, ...opts });
  const b = evolve({ seed: 9, ...opts });
  const c = evolve({ seed: 10, ...opts });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.best.genes.join(''), c.best.genes.join(''));
});

test('эволюция ведёт историю и валидный геном чемпиона', () => {
  const r = evolve({ seed: 2, generations: 5, popSize: 12, rounds: 20, sampleK: 3 });
  assert.equal(r.history.length, 5);
  for (const h of r.history) {
    assert.ok(h.best >= 0 && h.best <= 5 && h.mean >= 0 && h.mean <= 5);
  }
  assert.equal(r.best.genes.length, GENOME_LENGTH);
  assert.ok(r.best.genes.every((g) => g === C || g === D));
});

test('interpretGenome: геном-Зеркало опознаётся как Зеркало', () => {
  const info = interpretGenome(tftGenome());
  assert.equal(info.tftSimilarity, 1);
  assert.equal(info.firstMove, C);
  assert.equal(info.punishRate, 1);
});

test('«Безымянный» на диске соответствует каноническому прогону эволюции', async () => {
  const file = fileURLToPath(new URL('../strategies/evolved/nameless.js', import.meta.url));
  assert.ok(fs.existsSync(file), 'нет strategies/evolved/nameless.js — выполните node sim/evolve.js --seed 42');
  const mod = await import('../strategies/evolved/nameless.js');
  const s = mod.default;
  assert.equal(s.id, 'nameless');
  assert.ok(s.dossier && typeof s.dossier.genome === 'string');
  const resultFile = fileURLToPath(new URL('../results/evolve-42.json', import.meta.url));
  const saved = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  assert.equal(s.dossier.genome, saved.best.genes.join(''), 'геном в досье совпадает с results/evolve-42.json');
  // стратегия играет корректно
  const res = playMatch(s, titForTat, { rounds: 50, noise: 0.05, seed: 1 });
  assert.equal(res.movesA.length, 50);
});
